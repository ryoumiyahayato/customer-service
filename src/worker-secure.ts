export { ChatRoom } from './worker';
import worker from './worker';
import type { Env } from './worker';
import { COOKIE_NAMES, clearSessionCookie, readCookie } from './security/cookies';
import { verifySignedValue } from './security/signing';
import { hashSessionToken } from './security/sessionTokens';
import { jsonResponse, withSecurityHeaders } from './security/responseHeaders';
import { contentLengthExceeds, requestStreamExceeds } from './security/requestLimits';
import { consumeRateLimit } from './security/rateLimit';
import { isSameOriginWrite as sharedSameOriginWrite, isSameOriginWebSocket as sharedSameOriginWebSocket } from './security/requestOrigin';

type WorkerModule = {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
  scheduled?(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void>;
};

type AuditActor = { id: string; username: string; role: string };
type AuditEvent = { event: string; resource?: string; path: string; method: string; details?: Record<string, unknown> };

const inner = worker as WorkerModule;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ADMIN_USERNAME_RE = /^[A-Za-z0-9_.@-]{3,64}$/;
const PUBLIC_USERNAME_RE = /^[A-Za-z0-9_.@-]{3,64}$/;
const ADMIN_PASSWORD_MIN_LENGTH = 12;
const PUBLIC_PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_LENGTH = 128;
const LOGIN_IP_LIMIT = 20;
const LOGIN_ACCOUNT_LIMIT = 8;
const SETUP_IP_LIMIT = 5;
const REGISTER_IP_LIMIT = 10;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const SETUP_WINDOW_MS = 10 * 60 * 1000;
const REGISTER_WINDOW_MS = 10 * 60 * 1000;
const JSON_REQUEST_MAX_BYTES = 64 * 1024;
const CHAT_MESSAGE_MAX_LENGTH = 4000;
const STAFF_MESSAGE_MAX_LENGTH = 2000;
const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
const UPLOAD_REQUEST_MAX_BYTES = 6 * 1024 * 1024;
const ATTACHMENT_PATH_PREFIX = '/api/attachments/';
const HEX_INVITE_TOKEN = /^[a-f0-9]{40}$/;
const ADMIN_COOKIE = COOKIE_NAMES.admin;
const VISITOR_COOKIE = COOKIE_NAMES.visitor;
const GUEST_COOKIE = COOKIE_NAMES.guest;
const json = jsonResponse;

const isSameOriginWrite = sharedSameOriginWrite;

function shouldProtectAgainstCsrf(req: Request) {
  const path = new URL(req.url).pathname;
  if (!path.startsWith('/api/') || path.startsWith('/api/ws')) return false;
  return !SAFE_METHODS.has(req.method.toUpperCase());
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function readJsonClone(req: Request) {
  return jsonObject(await req.clone().json().catch(() => null));
}

const isSameOriginWebSocket = sharedSameOriginWebSocket;

const getCookie = readCookie;
const clearCookie = clearSessionCookie;
async function verifySignedId(env: Env, token?: string) { return verifySignedValue(env.SESSION_SECRET, token); }
async function tokenHash(env: Env, value: string) { return hashSessionToken(env.SESSION_SECRET, value); }

async function currentGuestVisitorKey(env: Env, req: Request) {
  const sessionId = await verifySignedId(env, getCookie(req, GUEST_COOKIE));
  if (!sessionId) return null;
  const row = await env.DB.prepare(
    'SELECT visitor_key FROM visitor_sessions WHERE id=? AND token_hash=? AND revoked_at IS NULL AND expires_at>? AND visitor_key IS NOT NULL',
  ).bind(sessionId, await tokenHash(env, sessionId), new Date().toISOString()).first<{ visitor_key: string }>();
  return row?.visitor_key || null;
}

function validAdminUsername(username: string) {
  return ADMIN_USERNAME_RE.test(username);
}

function validAdminPassword(password: string) {
  return typeof password === 'string' && password.length >= ADMIN_PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
}

function invalidInput(message: string, status = 400) {
  return json({ error: message }, { status });
}

function clientIp(req: Request) {
  return (req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown').trim().slice(0, 120);
}

function rateLimitKey(value: string) {
  return value.replace(/[^A-Za-z0-9:._-]/g, '_').slice(0, 240);
}

async function consumeLimit(env: Env, key: string, limit: number, windowMs: number) {
  const retryAfter = await consumeRateLimit(env.DB, key, limit, windowMs);
  return retryAfter === null
    ? null
    : json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(retryAfter) } });
}

async function protectBootstrapConfig(env: Env) {
  const username = env.SUPER_ADMIN_USERNAME?.trim() || '';
  const password = typeof env.SUPER_ADMIN_PASSWORD === 'string' ? env.SUPER_ADMIN_PASSWORD : '';
  if (!username && !password) return null;

  const existing = await env.DB.prepare("SELECT id FROM admins WHERE role='SUPER_ADMIN' LIMIT 1").first<{ id: string }>();
  if (existing?.id) return null;

  if (!validAdminUsername(username) || !validAdminPassword(password)) {
    console.error('security: invalid SUPER_ADMIN_USERNAME/SUPER_ADMIN_PASSWORD bootstrap config; refusing unsafe auto-bootstrap');
    return json({ error: 'bootstrap_admin_config_invalid' }, { status: 500 });
  }
  return null;
}

async function protectSetupMutation(req: Request, env: Env) {
  const path = new URL(req.url).pathname;
  if (!path.startsWith('/api/setup/') || req.method === 'GET') return null;
  if (contentLengthExceeds(req, JSON_REQUEST_MAX_BYTES)) return invalidInput('请求体过大', 413);
  const limited = await consumeLimit(
    env,
    rateLimitKey(`setup:ip:${clientIp(req)}`),
    SETUP_IP_LIMIT,
    SETUP_WINDOW_MS,
  );
  if (limited) return limited;
  return null;
}

async function protectLogin(req: Request, env: Env) {
  const path = new URL(req.url).pathname;
  if (req.method !== 'POST' || !['/api/auth/login', '/api/login', '/api/account/login'].includes(path)) return null;

  if (contentLengthExceeds(req, JSON_REQUEST_MAX_BYTES)) return invalidInput('请求体过大', 413);
  const body = await readJsonClone(req);
  const username = String(body.username || '').trim().toLowerCase().slice(0, 80);
  const ipLimited = await consumeLimit(env, rateLimitKey(`login:ip:${clientIp(req)}:${path}`), LOGIN_IP_LIMIT, LOGIN_WINDOW_MS);
  if (ipLimited) return ipLimited;
  if (username) {
    const accountLimited = await consumeLimit(env, rateLimitKey(`login:account:${path}:${username}`), LOGIN_ACCOUNT_LIMIT, LOGIN_WINDOW_MS);
    if (accountLimited) return accountLimited;
  }
  return null;
}

async function protectPublicRegister(req: Request, env: Env) {
  const path = new URL(req.url).pathname;
  if (path !== '/api/account/register' || req.method !== 'POST') return null;

  if (contentLengthExceeds(req, JSON_REQUEST_MAX_BYTES)) return invalidInput('请求体过大', 413);
  const ipLimited = await consumeLimit(env, rateLimitKey(`register:ip:${clientIp(req)}`), REGISTER_IP_LIMIT, REGISTER_WINDOW_MS);
  if (ipLimited) return ipLimited;

  const body = await readJsonClone(req);
  const username = String(body.username || '').trim();
  const password = typeof body.password === 'string' ? body.password : '';
  const displayName = String(body.displayName || username).trim();
  const visitorId = typeof body.visitorId === 'string' ? body.visitorId.trim() : '';
  const wantsGuestMutation = Boolean(body.claimGuest || body.discardGuest || visitorId);
  if (!PUBLIC_USERNAME_RE.test(username)) return invalidInput('用户名必须为 3-64 位字母、数字、下划线、点、@ 或 -');
  if (password.length < PUBLIC_PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) return invalidInput(`密码长度必须为 ${PUBLIC_PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} 位`);
  if (!displayName || displayName.length > 80) return invalidInput('显示名称长度不能超过 80 位');
  if (wantsGuestMutation) {
    const currentVisitorKey = await currentGuestVisitorKey(env, req);
    if (!visitorId || visitorId !== currentVisitorKey) return json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

async function protectVisitorLogout(req: Request, env: Env) {
  const path = new URL(req.url).pathname;
  if (path !== '/api/account/logout' || req.method !== 'POST') return null;

  const sessionId = await verifySignedId(env, getCookie(req, VISITOR_COOKIE));
  if (sessionId) {
    await env.DB.prepare('UPDATE visitor_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND token_hash=?').bind(new Date().toISOString(), sessionId, await tokenHash(env, sessionId)).run();
  }
  return json({ ok: true }, { headers: { 'Set-Cookie': clearCookie(VISITOR_COOKIE) } });
}

async function protectAdminMutation(req: Request) {
  const path = new URL(req.url).pathname;
  if ((path === '/api/admins' && req.method === 'POST') || (path === '/api/admins/profile' && req.method === 'PATCH')) {
    if (contentLengthExceeds(req, JSON_REQUEST_MAX_BYTES)) return invalidInput('请求体过大', 413);
  }

  if (path === '/api/admins' && req.method === 'POST') {
    const body = await readJsonClone(req);
    const username = String(body.username || '').trim();
    const password = typeof body.password === 'string' ? body.password : '';
    if (!validAdminUsername(username)) return invalidInput('管理员用户名必须为 3-64 位字母、数字、下划线、点、@ 或 -');
    if (!validAdminPassword(password)) return invalidInput(`管理员密码长度必须为 ${ADMIN_PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} 位`);
  }

  if (path === '/api/admins/profile' && req.method === 'PATCH') {
    const body = await readJsonClone(req);
    const username = String(body.username || '').trim();
    const password = typeof body.password === 'string' ? body.password : '';
    if (username && !validAdminUsername(username)) return invalidInput('管理员用户名必须为 3-64 位字母、数字、下划线、点、@ 或 -');
    if (password && !validAdminPassword(password)) return invalidInput(`管理员密码长度必须为 ${ADMIN_PASSWORD_MIN_LENGTH}-${PASSWORD_MAX_LENGTH} 位`);
  }

  return null;
}

function attachmentKeyFromPath(path: string) {
  if (!path.startsWith(ATTACHMENT_PATH_PREFIX)) return '';
  const rawKey = path.slice(ATTACHMENT_PATH_PREFIX.length);
  if (!rawKey || rawKey.includes('/') || rawKey.includes('?') || rawKey.includes('#')) return '';
  try {
    const key = decodeURIComponent(rawKey);
    if (!key || key.length > 300 || /[\/\u0000-\u001f\u007f]/.test(key)) return '';
    return key;
  } catch {
    return '';
  }
}

async function protectMessageMutation(req: Request, env: Env) {
  const path = new URL(req.url).pathname;
  if (path === '/api/messages' && req.method === 'POST') {
    if (contentLengthExceeds(req, JSON_REQUEST_MAX_BYTES)) return invalidInput('请求体过大', 413);
    const body = await readJsonClone(req);
    const content = typeof body.content === 'string' ? body.content : '';
    if (content.length > CHAT_MESSAGE_MAX_LENGTH) return invalidInput(`消息内容不能超过 ${CHAT_MESSAGE_MAX_LENGTH} 个字符`);

    const sessionId = String(body.sessionId || '').trim();
    const imagePath = typeof body.imagePath === 'string' ? body.imagePath.trim() : '';
    const messageType = body.messageType === 'image' ? 'image' : 'text';
    if (messageType === 'image') {
      if (!sessionId) return invalidInput('缺少会话信息');
      const attachmentKey = attachmentKeyFromPath(imagePath);
      if (!attachmentKey) return invalidInput('图片路径不可用');
      const attachment = await env.DB.prepare(
        `SELECT id,expires_at FROM attachments
         WHERE object_key=? AND conversation_id=? AND message_id IS NULL AND deleted_at IS NULL
         LIMIT 1`,
      ).bind(attachmentKey, sessionId).first<{ id: string; expires_at?: string }>();
      if (!attachment?.id) return invalidInput('图片上传记录不可用');
      if (attachment.expires_at && attachment.expires_at <= new Date().toISOString()) return invalidInput('图片上传已过期，请重新上传');
    } else if (imagePath) {
      return invalidInput('文本消息不能包含图片路径');
    }

    const quoteMessageId = typeof body.quoteMessageId === 'string' ? body.quoteMessageId.trim() : '';
    if (quoteMessageId) {
      if (!sessionId || quoteMessageId.length > 120) return invalidInput('引用消息不可用');
      const quote = await env.DB.prepare('SELECT id FROM messages WHERE id=? AND session_id=? AND deleted_at IS NULL LIMIT 1').bind(quoteMessageId, sessionId).first<{ id: string }>();
      if (!quote?.id) return invalidInput('引用消息不可用');
    }

    const clientMessageId = typeof body.clientMessageId === 'string' ? body.clientMessageId.trim() : '';
    if (clientMessageId.length > 120) return invalidInput('客户端消息 ID 过长');
  }

  if (path === '/api/staff-chat' && req.method === 'POST') {
    if (contentLengthExceeds(req, JSON_REQUEST_MAX_BYTES)) return invalidInput('请求体过大', 413);
    const body = await readJsonClone(req);
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) return invalidInput('内部消息不能为空');
    if (content.length > STAFF_MESSAGE_MAX_LENGTH) return invalidInput(`内部消息不能超过 ${STAFF_MESSAGE_MAX_LENGTH} 个字符`);
  }

  return null;
}

async function protectAttachmentDownload(req: Request, env: Env) {
  const path = new URL(req.url).pathname;
  const match = path.match(/^\/api\/attachments\/(.+)$/);
  if (!match) return null;
  const method = req.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return invalidInput('Method Not Allowed', 405);

  const key = attachmentKeyFromPath(`${ATTACHMENT_PATH_PREFIX}${match[1]}`);
  if (!key) return new Response('Not found', { status: 404 });
  const attachment = await env.DB.prepare(
    'SELECT message_id,expires_at,deleted_at FROM attachments WHERE object_key=? LIMIT 1',
  ).bind(key).first<{ message_id: string | null; expires_at: string | null; deleted_at: string | null }>();
  if (attachment?.deleted_at) return new Response('Not found', { status: 404 });
  if (attachment && !attachment.message_id && attachment.expires_at && attachment.expires_at <= new Date().toISOString()) return new Response('Gone', { status: 410 });
  return null;
}

function isJpeg(bytes: Uint8Array) {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isPng(bytes: Uint8Array) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.length >= sig.length && sig.every((byte, index) => bytes[index] === byte);
}

function isWebp(bytes: Uint8Array) {
  return bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
}

function mimeMatchesMagic(mime: string, bytes: Uint8Array) {
  if (mime === 'image/jpeg') return isJpeg(bytes);
  if (mime === 'image/png') return isPng(bytes);
  if (mime === 'image/webp') return isWebp(bytes);
  return false;
}

async function protectUpload(req: Request) {
  const path = new URL(req.url).pathname;
  if (path !== '/api/upload' || req.method !== 'POST') return null;

  if (await requestStreamExceeds(req, UPLOAD_REQUEST_MAX_BYTES)) return invalidInput('上传请求过大', 413);

  const form = await req.clone().formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return invalidInput('请选择图片文件');
  if (file.size > UPLOAD_MAX_BYTES) return invalidInput('图片不能超过 5MB', 413);

  const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
  if (!allowedTypes.has(file.type)) return invalidInput('仅支持 JPG、PNG、WebP 图片');

  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (!mimeMatchesMagic(file.type, head)) return invalidInput('图片文件内容与类型不匹配');

  return null;
}

async function protectGuestInvite(req: Request) {
  const path = new URL(req.url).pathname;
  const match = path.match(/^\/api\/guest\/([^/]+)$/);
  if (!match || req.method !== 'POST') return null;
  if (!HEX_INVITE_TOKEN.test(match[1])) return new Response('Not found', { status: 404 });
  return null;
}

async function currentAuditActor(env: Env, adminCookie?: string): Promise<AuditActor | null> {
  const sessionId = await verifySignedId(env, adminCookie);
  if (!sessionId) return null;
  const session = await env.DB.prepare(
    'SELECT admin_id FROM admin_sessions WHERE id=? AND token_hash=? AND revoked_at IS NULL AND expires_at>? LIMIT 1',
  ).bind(sessionId, await tokenHash(env, sessionId), new Date().toISOString()).first<{ admin_id: string }>();
  if (!session?.admin_id) return null;
  const admin = await env.DB.prepare(
    'SELECT id,username,role FROM admins WHERE id=? AND is_disabled=0 LIMIT 1',
  ).bind(session.admin_id).first<AuditActor>();
  return admin || null;
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  return jsonObject(await req.json().catch(() => null));
}

function pickString(value: unknown, maxLength = 120) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : undefined;
}

function isAuditedAdminMutation(req: Request) {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method.toUpperCase();

  if (path === '/api/invites' && method === 'POST') return true;
  if (path === '/api/admins' && method === 'POST') return true;
  if (path === '/api/admins/operators' && method === 'DELETE') return true;
  if (path === '/api/admins/profile' && method === 'PATCH') return true;
  if (path === '/api/messages/purge-images' && method === 'POST') return true;
  if (/^\/api\/sessions\/[^/]+\/(assign|close|archive|unarchive|delete|restore)$/.test(path) && method === 'POST') return true;
  if (/^\/api\/sessions\/[^/]+\/customer-remark$/.test(path) && method === 'PATCH') return true;
  if (/^\/api\/sessions\/[^/]+\/clear-history$/.test(path) && method === 'POST') return true;
  if (/^\/api\/messages\/[^/]+\/recall$/.test(path) && method === 'POST') return true;
  if (/^\/api\/messages\/[^/]+\/delete$/.test(path) && method === 'POST') return true;

  return false;
}

function makeAuditEvent(event: string, path: string, method: string, extra: Omit<AuditEvent, 'event' | 'path' | 'method'> = {}): AuditEvent {
  return { event, path, method, ...extra };
}

async function classifyAdminMutation(req: Request): Promise<AuditEvent | null> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method.toUpperCase();

  if (path === '/api/invites' && method === 'POST') return makeAuditEvent('admin.invite.create', path, method);
  if (path === '/api/messages/purge-images' && method === 'POST') return makeAuditEvent('admin.messages.purge_images', path, method);
  if (path === '/api/admins' && method === 'POST') {
    const body = await readJsonBody(req);
    return makeAuditEvent('admin.operator.create', path, method, {
      details: { username: pickString(body.username) },
    });
  }
  if (path === '/api/admins/operators' && method === 'DELETE') {
    const body = await readJsonBody(req);
    return makeAuditEvent(body.hard ? 'admin.operator.delete' : 'admin.operator.disable', path, method, {
      resource: pickString(body.id),
    });
  }
  if (path === '/api/admins/profile' && method === 'PATCH') {
    const body = await readJsonBody(req);
    return makeAuditEvent('admin.profile.update', path, method, {
      details: {
        usernameChanged: Boolean(body.username),
        passwordChanged: Boolean(body.password),
      },
    });
  }

  const sessionAction = path.match(/^\/api\/sessions\/([^/]+)\/(assign|close|archive|unarchive|delete|restore)$/);
  if (sessionAction && method === 'POST') return makeAuditEvent(`admin.session.${sessionAction[2]}`, path, method, { resource: sessionAction[1] });

  const customerRemark = path.match(/^\/api\/sessions\/([^/]+)\/customer-remark$/);
  if (customerRemark && method === 'PATCH') return makeAuditEvent('admin.session.customer_remark', path, method, { resource: customerRemark[1] });

  const clearHistory = path.match(/^\/api\/sessions\/([^/]+)\/clear-history$/);
  if (clearHistory && method === 'POST') return makeAuditEvent('admin.session.clear_history', path, method, { resource: clearHistory[1] });

  const recallMessage = path.match(/^\/api\/messages\/([^/]+)\/recall$/);
  if (recallMessage && method === 'POST') return makeAuditEvent('admin.message.recall', path, method, { resource: recallMessage[1] });

  const deleteMessage = path.match(/^\/api\/messages\/([^/]+)\/delete$/);
  if (deleteMessage && method === 'POST') return makeAuditEvent('admin.message.delete', path, method, { resource: deleteMessage[1] });

  return null;
}

function auditId() {
  return `log_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

function auditMessage(event: AuditEvent) {
  return JSON.stringify({
    event: event.event,
    resource: event.resource || null,
    path: event.path,
    method: event.method,
    details: event.details || {},
  });
}

async function writeAuditLog(env: Env, actor: AuditActor, event: AuditEvent) {
  await env.DB.prepare(
    'INSERT INTO system_logs(id,level,event,actor_id,message,created_at) VALUES(?,?,?,?,?,?)',
  ).bind(auditId(), 'INFO', event.event, actor.id, auditMessage(event), new Date().toISOString()).run();
}

async function auditAfterSuccess(env: Env, response: Response, eventPromise: Promise<AuditEvent | null>, adminCookie?: string) {
  if (response.status < 200 || response.status >= 300) return;
  const event = await eventPromise;
  if (!event) return;
  const actor = await currentAuditActor(env, adminCookie);
  if (!actor) return;
  await writeAuditLog(env, actor, event);
}

async function preflightSecurity(req: Request, env: Env) {
  const requestUrl = new URL(req.url);
  if (requestUrl.pathname.startsWith('/api/ws') && !isSameOriginWebSocket(req)) {
    return json({ error: 'Forbidden' }, { status: 403 });
  }
  if (shouldProtectAgainstCsrf(req) && !isSameOriginWrite(req)) {
    return json({ error: 'Forbidden' }, { status: 403 });
  }

  const requestPath = new URL(req.url).pathname;
  const shouldCapApiBody = !SAFE_METHODS.has(req.method.toUpperCase()) &&
    requestPath.startsWith('/api/') && requestPath !== '/api/upload';
  if (shouldCapApiBody) {
    if (await requestStreamExceeds(req, JSON_REQUEST_MAX_BYTES)) return invalidInput('request body too large', 413);
  }

  const bootstrapRejected = await protectBootstrapConfig(env);
  if (bootstrapRejected) return bootstrapRejected;

  const setupRejected = await protectSetupMutation(req, env);
  if (setupRejected) return setupRejected;

  const guestRejected = await protectGuestInvite(req);
  if (guestRejected) return guestRejected;

  const logoutHandled = await protectVisitorLogout(req, env);
  if (logoutHandled) return logoutHandled;

  const loginLimited = await protectLogin(req, env);
  if (loginLimited) return loginLimited;

  const registerRejected = await protectPublicRegister(req, env);
  if (registerRejected) return registerRejected;

  const adminRejected = await protectAdminMutation(req);
  if (adminRejected) return adminRejected;

  const attachmentRejected = await protectAttachmentDownload(req, env);
  if (attachmentRejected) return attachmentRejected;

  const messageRejected = await protectMessageMutation(req, env);
  if (messageRejected) return messageRejected;

  const uploadRejected = await protectUpload(req);
  if (uploadRejected) return uploadRejected;

  return null;
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    await inner.scheduled?.(controller, env, ctx);
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const shouldAudit = isAuditedAdminMutation(req);
    const auditReq = shouldAudit ? (req.clone() as unknown as Request) : null;
    const adminCookie = shouldAudit ? getCookie(req, ADMIN_COOKIE) : undefined;

    const blocked = await preflightSecurity(req, env);
    if (blocked) return withSecurityHeaders(blocked);

    const eventPromise = auditReq ? classifyAdminMutation(auditReq).catch(() => null) : null;
    const response = withSecurityHeaders(await inner.fetch(req, env, ctx));
    if (eventPromise) {
      ctx.waitUntil(auditAfterSuccess(env, response, eventPromise, adminCookie).catch((error) => {
        console.error('security: audit log write failed', error);
      }));
    }
    return response;
  },
};