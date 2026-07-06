export { ChatRoom } from './worker';
import secureWorker from './worker-secure';
import type { Env } from './worker';

type WorkerModule = {
  fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
  scheduled?(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void>;
};

type AuditActor = { id: string; username: string; role: string };
type AuditEvent = { event: string; resource?: string; details?: Record<string, unknown> };

const inner = secureWorker as WorkerModule;
const ADMIN_COOKIE = 'support_admin';
const enc = new TextEncoder();

function getCookie(req: Request, name: string) {
  return (req.headers.get('cookie') || '')
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(value));
  return [...new Uint8Array(sig)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function constantTimeEqual(a: string, b: string) {
  const left = enc.encode(a);
  const right = enc.encode(b);
  let diff = left.length ^ right.length;
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i++) diff |= (left[i] || 0) ^ (right[i] || 0);
  return diff === 0;
}

async function verifySignedId(env: Env, token?: string) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [value, sig] = parts;
  if (!value || !sig) return null;
  return constantTimeEqual(sig, await hmac(env.SESSION_SECRET, value)) ? value : null;
}

async function tokenHash(env: Env, value: string) {
  return await hmac(env.SESSION_SECRET, `session:${value}`);
}

async function currentAuditActor(env: Env, req: Request): Promise<AuditActor | null> {
  const sessionId = await verifySignedId(env, getCookie(req, ADMIN_COOKIE));
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

async function readJsonBody(req: Request) {
  return await req.clone().json().catch(() => ({} as any));
}

function pickString(value: unknown, maxLength = 120) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : undefined;
}

function classifyAdminMutation(req: Request): Promise<AuditEvent | null> | AuditEvent | null {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method.toUpperCase();

  if (path === '/api/invites' && method === 'POST') return { event: 'admin.invite.create' };
  if (path === '/api/messages/purge-images' && method === 'POST') return { event: 'admin.messages.purge_images' };
  if (path === '/api/admins' && method === 'POST') {
    return readJsonBody(req).then((body) => ({
      event: 'admin.operator.create',
      details: { username: pickString(body.username) },
    }));
  }
  if (path === '/api/admins/operators' && method === 'DELETE') {
    return readJsonBody(req).then((body) => ({
      event: body.hard ? 'admin.operator.delete' : 'admin.operator.disable',
      resource: pickString(body.id),
    }));
  }
  if (path === '/api/admins/profile' && method === 'PATCH') {
    return readJsonBody(req).then((body) => ({
      event: 'admin.profile.update',
      details: {
        usernameChanged: Boolean(body.username),
        passwordChanged: Boolean(body.password),
      },
    }));
  }

  const sessionAction = path.match(/^\/api\/sessions\/([^/]+)\/(assign|close|archive|unarchive|delete|restore)$/);
  if (sessionAction && method === 'POST') return { event: `admin.session.${sessionAction[2]}`, resource: sessionAction[1] };

  const customerRemark = path.match(/^\/api\/sessions\/([^/]+)\/customer-remark$/);
  if (customerRemark && method === 'PATCH') return { event: 'admin.session.customer_remark', resource: customerRemark[1] };

  const clearHistory = path.match(/^\/api\/sessions\/([^/]+)\/clear-history$/);
  if (clearHistory && method === 'POST') return { event: 'admin.session.clear_history', resource: clearHistory[1] };

  const recallMessage = path.match(/^\/api\/messages\/([^/]+)\/recall$/);
  if (recallMessage && method === 'POST') return { event: 'admin.message.recall', resource: recallMessage[1] };

  const deleteMessage = path.match(/^\/api\/messages\/([^/]+)\/delete$/);
  if (deleteMessage && method === 'POST') return { event: 'admin.message.delete', resource: deleteMessage[1] };

  return null;
}

function auditId() {
  return `log_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

function auditMessage(event: AuditEvent, req: Request) {
  const url = new URL(req.url);
  return JSON.stringify({
    event: event.event,
    resource: event.resource || null,
    path: url.pathname,
    method: req.method.toUpperCase(),
    details: event.details || {},
  });
}

async function writeAuditLog(env: Env, actor: AuditActor, event: AuditEvent, req: Request) {
  await env.DB.prepare(
    'INSERT INTO system_logs(id,level,event,actor_id,message,created_at) VALUES(?,?,?,?,?,?)',
  ).bind(auditId(), 'INFO', event.event, actor.id, auditMessage(event, req), new Date().toISOString()).run();
}

async function auditAfterSuccess(req: Request, env: Env, response: Response, eventPromise: Promise<AuditEvent | null>) {
  if (response.status < 200 || response.status >= 300) return;
  const event = await eventPromise;
  if (!event) return;
  const actor = await currentAuditActor(env, req);
  if (!actor) return;
  await writeAuditLog(env, actor, event, req);
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    return inner.scheduled?.(controller, env, ctx);
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const auditReq = req.clone();
    const eventPromise = Promise.resolve(classifyAdminMutation(auditReq)).catch(() => null);
    const response = await inner.fetch(req, env, ctx);
    ctx.waitUntil(auditAfterSuccess(req, env, response.clone(), eventPromise).catch((error) => {
      console.error('security: audit log write failed', error);
    }));
    return response;
  },
};
