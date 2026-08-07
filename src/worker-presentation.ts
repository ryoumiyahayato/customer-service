export { ChatRoom } from './worker-business-hardening';
import businessWorker from './worker-business-hardening';
import type { Env } from './worker';
import { COOKIE_NAMES, readCookie } from './security/cookies';
import { hmacHex, verifySignedValue } from './security/signing';
import { hashSessionToken } from './security/sessionTokens';
import { consumeRateLimit } from './security/rateLimit';
import { readJsonObjectWithinLimit, requestStreamExceeds } from './security/requestLimits';
import { jsonResponse, withSecurityHeaders } from './security/responseHeaders';
import {
  normalizeOperatorPresentation,
  operatorPresentationKey,
  type OperatorPresentation,
} from './operatorPresentation';

type WorkerModule = {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
  scheduled?(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void>;
};

type AdminIdentity = {
  id: string;
  username: string;
  role: 'SUPER_ADMIN' | 'OPERATOR';
  is_disabled?: number;
};

type AdminSessionRow = {
  admin_id: string;
  created_at: string;
  last_seen_at: string | null;
  expires_at: string;
};

type OperatorRow = AdminIdentity & { display_name?: string | null };
type SettingsRow = { value_json: string };

const inner = businessWorker as WorkerModule;
const ADMIN_COOKIE = COOKIE_NAMES.admin;
const JSON_MAX_BYTES = 16 * 1024;
const AVATAR_REQUEST_MAX_BYTES = 2 * 1024 * 1024 + 64 * 1024;
const AVATAR_FILE_MAX_BYTES = 2 * 1024 * 1024;
const ADMIN_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ADMIN_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

function json(body: unknown, status = 200) { return jsonResponse(body, { status }); }
const getCookie = readCookie;
async function verifySignedId(env: Env, token?: string) { return verifySignedValue(env.SESSION_SECRET, token); }
async function tokenHash(env: Env, value: string) { return hashSessionToken(env.SESSION_SECRET, value); }

function isLocalDevHost(host: string) {
  let normalized = String(host || '').toLowerCase();
  if (normalized.startsWith('[')) normalized = normalized.slice(1).split(']')[0];
  else if (normalized.indexOf(':') === normalized.lastIndexOf(':') && normalized.includes(':')) normalized = normalized.slice(0, normalized.lastIndexOf(':'));
  return normalized === 'localhost' || normalized.endsWith('.localhost') || normalized === '127.0.0.1' || normalized === '::1';
}

function sameOriginWrite(req: Request) {
  const requestUrl = new URL(req.url);
  const expected = requestUrl.origin;
  const origin = req.headers.get('origin');
  if (origin) return origin === expected;
  const referer = req.headers.get('referer');
  if (!referer) return isLocalDevHost(requestUrl.hostname) || isLocalDevHost(req.headers.get('host') || '');
  try { return new URL(referer).origin === expected; } catch { return false; }
}

function adminSessionExpired(session: AdminSessionRow, at = Date.now()) {
  const createdAt = Date.parse(session.created_at || '');
  const lastSeenAt = Date.parse(session.last_seen_at || session.created_at || '');
  const expiresAt = Date.parse(session.expires_at || '');
  return !Number.isFinite(createdAt)
    || !Number.isFinite(lastSeenAt)
    || !Number.isFinite(expiresAt)
    || expiresAt <= at
    || at - createdAt > ADMIN_SESSION_MAX_AGE_MS
    || at - lastSeenAt > ADMIN_SESSION_IDLE_TIMEOUT_MS;
}

async function currentAdmin(env: Env, req: Request): Promise<AdminIdentity | null> {
  const sessionId = await verifySignedId(env, getCookie(req, ADMIN_COOKIE));
  if (!sessionId) return null;
  const session = await env.DB.prepare(
    `SELECT admin_id,created_at,last_seen_at,expires_at FROM admin_sessions
      WHERE id=? AND token_hash=? AND revoked_at IS NULL LIMIT 1`,
  ).bind(sessionId, await tokenHash(env, sessionId)).first<AdminSessionRow>();
  if (!session?.admin_id) return null;
  if (adminSessionExpired(session)) return null;
  return await env.DB.prepare(
    `SELECT id,username,role,is_disabled FROM admins WHERE id=? AND is_disabled=0 LIMIT 1`,
  ).bind(session.admin_id).first<AdminIdentity>();
}

async function targetOperator(env: Env, req: Request): Promise<OperatorRow | Response> {
  const admin = await currentAdmin(env, req);
  if (!admin) return json({ error: 'unauthenticated' }, 401);
  const requested = new URL(req.url).searchParams.get('operatorId')?.trim() || admin.id;
  if (requested !== admin.id && admin.role !== 'SUPER_ADMIN') return json({ error: 'forbidden' }, 403);
  const target = await env.DB.prepare(
    'SELECT id,username,display_name,role,is_disabled FROM admins WHERE id=? LIMIT 1',
  ).bind(requested).first<OperatorRow>();
  if (!target?.id || target.is_disabled) return json({ error: 'operator_not_found' }, 404);
  return target;
}

async function presentationRateLimit(env: Env, req: Request) {
  const ip = req.headers.get('cf-connecting-ip') || 'unknown';
  const key = `presentation:${ip}:${new URL(req.url).pathname}`.slice(0, 240);
  const retryAfter = await consumeRateLimit(env.DB, key, 30, 60 * 1000);
  return retryAfter === null ? null : json({ error: 'rate_limited', retryAfter }, 429);
}

async function readPresentation(env: Env, adminId: string) {
  const row = await env.DB.prepare('SELECT value_json FROM settings WHERE key=? LIMIT 1')
    .bind(operatorPresentationKey(adminId)).first<SettingsRow>();
  if (!row?.value_json) return normalizeOperatorPresentation(null);
  try { return normalizeOperatorPresentation(JSON.parse(row.value_json)); } catch { return normalizeOperatorPresentation(null); }
}

async function writePresentation(env: Env, adminId: string, value: OperatorPresentation) {
  await env.DB.prepare(
    `INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`,
  ).bind(operatorPresentationKey(adminId), JSON.stringify(value), new Date().toISOString()).run();
}

function publicPresentation(target: OperatorRow, presentation: OperatorPresentation) {
  const avatarVersion = presentation.avatarKey.split('/').pop()?.split('.')[0] || '';
  return {
    operatorId: target.id,
    displayName: String(target.display_name || target.username || '在线客服'),
    welcomeText: presentation.welcomeText,
    avatarUrl: presentation.avatarKey ? `/api/operator-avatar/${encodeURIComponent(target.id)}?v=${encodeURIComponent(avatarVersion)}` : '',
    qrBackgroundColor: presentation.qrBackgroundColor,
    qrTopText: presentation.qrTopText,
    qrBottomText: presentation.qrBottomText,
  };
}

async function handlePresentationGet(req: Request, env: Env) {
  const target = await targetOperator(env, req);
  if (target instanceof Response) return target;
  return json({ presentation: publicPresentation(target, await readPresentation(env, target.id)) });
}

async function handlePresentationPut(req: Request, env: Env) {
  if (!sameOriginWrite(req)) return json({ error: 'forbidden' }, 403);
  const limited = await presentationRateLimit(env, req);
  if (limited) return limited;
  const target = await targetOperator(env, req);
  if (target instanceof Response) return target;
  const parsed = await readJsonObjectWithinLimit(req, JSON_MAX_BYTES);
  if (parsed.tooLarge) return json({ error: 'request_too_large' }, 413);
  const current = await readPresentation(env, target.id);
  const next = normalizeOperatorPresentation({
    ...current,
    ...parsed.body,
    avatarKey: current.avatarKey,
  });
  await writePresentation(env, target.id, next);
  return json({ presentation: publicPresentation(target, next) });
}

function avatarExtension(type: string) {
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/png') return 'png';
  if (type === 'image/webp') return 'webp';
  return '';
}

async function handleAvatarUpload(req: Request, env: Env, ctx: ExecutionContext) {
  if (!sameOriginWrite(req)) return json({ error: 'forbidden' }, 403);
  const limited = await presentationRateLimit(env, req);
  if (limited) return limited;
  const target = await targetOperator(env, req);
  if (target instanceof Response) return target;
  if (await requestStreamExceeds(req, AVATAR_REQUEST_MAX_BYTES)) return json({ error: 'avatar_too_large' }, 413);
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return json({ error: 'avatar_required' }, 400);
  const ext = avatarExtension(file.type);
  if (!ext) return json({ error: 'avatar_type_not_supported' }, 400);
  if (file.size <= 0 || file.size > AVATAR_FILE_MAX_BYTES) return json({ error: 'avatar_too_large' }, 413);

  const current = await readPresentation(env, target.id);
  const key = `operator-avatars/${target.id}/${crypto.randomUUID().replace(/-/g, '')}.${ext}`;
  await env.UPLOADS.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  const next = normalizeOperatorPresentation({ ...current, avatarKey: key });
  try {
    await writePresentation(env, target.id, next);
  } catch (error) {
    await env.UPLOADS.delete(key).catch(() => {});
    throw error;
  }
  if (current.avatarKey && current.avatarKey !== key) ctx.waitUntil(env.UPLOADS.delete(current.avatarKey).catch(() => {}));
  return json({ presentation: publicPresentation(target, next) });
}

async function handleAvatarDelete(req: Request, env: Env, ctx: ExecutionContext) {
  if (!sameOriginWrite(req)) return json({ error: 'forbidden' }, 403);
  const limited = await presentationRateLimit(env, req);
  if (limited) return limited;
  const target = await targetOperator(env, req);
  if (target instanceof Response) return target;
  const current = await readPresentation(env, target.id);
  const next = normalizeOperatorPresentation({ ...current, avatarKey: '' });
  await writePresentation(env, target.id, next);
  if (current.avatarKey) ctx.waitUntil(env.UPLOADS.delete(current.avatarKey).catch(() => {}));
  return json({ presentation: publicPresentation(target, next) });
}

async function handlePublicAvatar(env: Env, adminId: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(adminId)) return withSecurityHeaders(new Response('Not found', { status: 404 }));
  const presentation = await readPresentation(env, adminId);
  if (!presentation.avatarKey || !presentation.avatarKey.startsWith(`operator-avatars/${adminId}/`)) {
    return withSecurityHeaders(new Response('Not found', { status: 404 }));
  }
  const object = await env.UPLOADS.get(presentation.avatarKey);
  if (!object) return withSecurityHeaders(new Response('Not found', { status: 404 }));
  return withSecurityHeaders(new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  }));
}

async function handleInvitePresentation(env: Env, token: string) {
  if (!/^[a-f0-9]{40}$/.test(token)) return json({ presentation: null }, 404);
  const tokenHash = await hmacHex(env.SESSION_SECRET, `invite:${token}`);
  const invite = await env.DB.prepare(
    'SELECT source_operator_id,expires_at,revoked_at FROM invite_links WHERE token_hash=? LIMIT 1',
  ).bind(tokenHash).first<{ source_operator_id: string | null; expires_at: string; revoked_at: string | null }>();
  if (!invite || invite.revoked_at || invite.expires_at <= new Date().toISOString() || !invite.source_operator_id) {
    return json({ presentation: null }, invite ? 200 : 404);
  }
  const target = await env.DB.prepare(
    'SELECT id,username,display_name,role,is_disabled FROM admins WHERE id=? AND is_disabled=0 LIMIT 1',
  ).bind(invite.source_operator_id).first<OperatorRow>();
  if (!target?.id) return json({ presentation: null });
  return json({ presentation: publicPresentation(target, await readPresentation(env, target.id)) });
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    await inner.scheduled?.(controller, env, ctx);
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    if (url.pathname === '/api/admins/presentation' && req.method === 'GET') return handlePresentationGet(req, env);
    if (url.pathname === '/api/admins/presentation' && req.method === 'PUT') return handlePresentationPut(req, env);
    if (url.pathname === '/api/admins/presentation/avatar' && req.method === 'POST') return handleAvatarUpload(req, env, ctx);
    if (url.pathname === '/api/admins/presentation/avatar' && req.method === 'DELETE') return handleAvatarDelete(req, env, ctx);
    const avatarMatch = url.pathname.match(/^\/api\/operator-avatar\/([^/]+)$/);
    if (avatarMatch && req.method === 'GET') return handlePublicAvatar(env, decodeURIComponent(avatarMatch[1]));
    const invitePresentationMatch = url.pathname.match(/^\/api\/invite-presentation\/([^/]+)$/);
    if (invitePresentationMatch && req.method === 'GET') return handleInvitePresentation(env, decodeURIComponent(invitePresentationMatch[1]));
    return inner.fetch(req, env, ctx);
  },
};
