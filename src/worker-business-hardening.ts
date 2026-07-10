export { ChatRoom } from './worker-secure';
import secureWorker from './worker-secure';
import type { Env } from './worker';

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

type MessageSender = {
  senderType: 'OPERATOR' | 'VISITOR';
  senderId: string;
  sessionId: string;
};

const inner = secureWorker as WorkerModule;
const ADMIN_COOKIE = 'support_admin';
const GUEST_COOKIE = 'guest_session';
const ATTACHMENT_PATH_PREFIX = '/api/attachments/';
const JSON_REQUEST_MAX_BYTES = 64 * 1024;
const enc = new TextEncoder();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    },
  });
}

function getCookie(req: Request, name: string) {
  return (req.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(value));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function verifySignedId(env: Env, token?: string) {
  if (!token) return null;
  const [value, signature] = token.split('.');
  if (!value || !signature) return null;
  const expected = await hmac(env.SESSION_SECRET, value);
  if (signature.length !== expected.length) return null;
  let diff = 0;
  for (let index = 0; index < expected.length; index++) diff |= signature.charCodeAt(index) ^ expected.charCodeAt(index);
  return diff === 0 ? value : null;
}

async function tokenHash(env: Env, value: string) {
  return hmac(env.SESSION_SECRET, `session:${value}`);
}

function sameOriginWrite(req: Request) {
  const expected = new URL(req.url).origin;
  const origin = req.headers.get('origin');
  if (origin) return origin === expected;
  const referer = req.headers.get('referer');
  if (!referer) return true;
  try {
    return new URL(referer).origin === expected;
  } catch {
    return false;
  }
}

function requestBodyTooLarge(req: Request) {
  const length = Number(req.headers.get('content-length') || '0');
  return Number.isFinite(length) && length > JSON_REQUEST_MAX_BYTES;
}

async function currentAdmin(env: Env, req: Request): Promise<AdminIdentity | null> {
  const sessionId = await verifySignedId(env, getCookie(req, ADMIN_COOKIE));
  if (!sessionId) return null;
  const session = await env.DB.prepare(
    `SELECT admin_id FROM admin_sessions
      WHERE id=? AND token_hash=? AND revoked_at IS NULL AND datetime(expires_at)>datetime('now')
      LIMIT 1`,
  ).bind(sessionId, await tokenHash(env, sessionId)).first<{ admin_id: string }>();
  if (!session?.admin_id) return null;
  return await env.DB.prepare(
    `SELECT id,username,role,is_disabled FROM admins WHERE id=? AND is_disabled=0 LIMIT 1`,
  ).bind(session.admin_id).first<AdminIdentity>() || null;
}

async function requireSuperAdmin(env: Env, req: Request): Promise<AdminIdentity | Response> {
  const admin = await currentAdmin(env, req);
  if (!admin) return json({ error: 'unauthenticated' }, 401);
  if (admin.role !== 'SUPER_ADMIN') return json({ error: 'forbidden' }, 403);
  return admin;
}

async function mutationRateLimit(env: Env, req: Request) {
  const ip = req.headers.get('cf-connecting-ip') || 'unknown';
  const path = new URL(req.url).pathname;
  const key = `hardening:${ip}:${path}`.slice(0, 240);
  const nowMs = Date.now();
  const resetAt = Math.floor(nowMs / 60000) * 60000 + 60000;
  const row = await env.DB.prepare('SELECT count,reset_at FROM rate_limits WHERE key=?').bind(key).first<{ count: number; reset_at: number }>();
  if (!row || row.reset_at <= nowMs) {
    await env.DB.prepare('INSERT OR REPLACE INTO rate_limits(key,count,reset_at) VALUES(?,?,?)').bind(key, 1, resetAt).run();
    return null;
  }
  if (row.count >= 20) return json({ error: 'rate_limited' }, 429);
  await env.DB.prepare('UPDATE rate_limits SET count=count+1 WHERE key=?').bind(key).run();
  return null;
}

function auditId() {
  return `log_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

async function writeOperatorDisableAudit(env: Env, actorId: string, operatorId: string) {
  const message = JSON.stringify({
    event: 'admin.operator.disable',
    resource: operatorId,
    path: '/api/admins/operators',
    method: 'DELETE',
    details: { sessionsPreserved: true, sessionsRevoked: true },
  });
  await env.DB.prepare(
    'INSERT INTO system_logs(id,level,event,actor_id,message,created_at) VALUES(?,?,?,?,?,?)',
  ).bind(auditId(), 'INFO', 'admin.operator.disable', actorId, message, new Date().toISOString()).run();
}

async function notifyAdmins(env: Env) {
  if (!env.CHAT_ROOM) return;
  await env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName('admin-feed')).fetch('https://room/broadcast', {
    method: 'POST',
    body: JSON.stringify({ type: 'sessions:changed', ts: Date.now() }),
  });
}

async function handleOperatorDisable(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!sameOriginWrite(req)) return json({ error: 'forbidden' }, 403);
  if (requestBodyTooLarge(req)) return json({ error: 'request_too_large' }, 413);
  const limited = await mutationRateLimit(env, req);
  if (limited) return limited;

  const actor = await requireSuperAdmin(env, req);
  if (actor instanceof Response) return actor;

  const body: any = await req.json().catch(() => ({}));
  const operatorId = typeof body.id === 'string' ? body.id.trim() : '';
  if (!operatorId) return json({ error: 'operator_id_required' }, 400);
  if (body.hard) {
    return json({ error: 'operator_hard_delete_not_supported', reason: 'preserve_historical_references' }, 409);
  }

  const operator = await env.DB.prepare(
    `SELECT id,is_disabled FROM admins WHERE id=? AND role='OPERATOR' LIMIT 1`,
  ).bind(operatorId).first<{ id: string; is_disabled: number }>();
  if (!operator?.id) return json({ error: 'operator_not_found' }, 404);
  if (operator.is_disabled) return json({ error: 'operator_already_disabled' }, 409);

  const timestamp = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE admins SET is_disabled=1,disabled_at=?,updated_at=?
        WHERE id=? AND role='OPERATOR' AND is_disabled=0`,
    ).bind(timestamp, timestamp, operatorId),
    env.DB.prepare(
      `UPDATE admin_sessions SET revoked_at=COALESCE(revoked_at,?)
        WHERE admin_id=? AND revoked_at IS NULL`,
    ).bind(timestamp, operatorId),
    env.DB.prepare(
      `UPDATE sessions SET assigned_operator_id=NULL,updated_at=?
        WHERE assigned_operator_id=?`,
    ).bind(timestamp, operatorId),
  ]);

  if (Number((results[0] as any)?.meta?.changes || 0) !== 1) {
    return json({ error: 'operator_state_conflict' }, 409);
  }

  ctx.waitUntil(Promise.all([
    writeOperatorDisableAudit(env, actor.id, operatorId),
    notifyAdmins(env),
  ]).catch((error) => console.error('business hardening post-disable task failed', String(error))));

  return json({
    ok: true,
    disabled: true,
    revokedSessionCount: Number((results[1] as any)?.meta?.changes || 0),
    unassignedSessionCount: Number((results[2] as any)?.meta?.changes || 0),
  });
}

function attachmentKeyFromPath(value: unknown) {
  if (typeof value !== 'string' || !value.startsWith(ATTACHMENT_PATH_PREFIX)) return '';
  const rawKey = value.slice(ATTACHMENT_PATH_PREFIX.length);
  if (!rawKey || rawKey.includes('/') || rawKey.includes('?') || rawKey.includes('#')) return '';
  try {
    const key = decodeURIComponent(rawKey);
    return key && key.length <= 300 && !/[\/\u0000-\u001f\u007f]/.test(key) ? key : '';
  } catch {
    return '';
  }
}

async function resolveMessageSender(env: Env, req: Request, body: any): Promise<MessageSender | Response> {
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!sessionId) return json({ error: 'session_required' }, 400);
  const session = await env.DB.prepare(
    'SELECT id,user_id,assigned_operator_id,status,deleted_at,purged_at FROM sessions WHERE id=? LIMIT 1',
  ).bind(sessionId).first<any>();
  if (!session?.id) return json({ error: 'session_not_found' }, 404);
  if (session.deleted_at || session.purged_at || session.status === 'CLOSED' || session.status === 'ARCHIVED') {
    return json({ error: 'session_ended' }, 400);
  }

  const requestedType = body.senderType === 'OPERATOR' ? 'OPERATOR' : 'VISITOR';
  if (requestedType === 'OPERATOR') {
    const admin = await currentAdmin(env, req);
    if (!admin) return json({ error: 'unauthenticated' }, 401);
    if (admin.role !== 'SUPER_ADMIN' && session.assigned_operator_id !== admin.id) return json({ error: 'forbidden' }, 403);
    return { senderType: 'OPERATOR', senderId: admin.id, sessionId };
  }

  const guestSessionId = await verifySignedId(env, getCookie(req, GUEST_COOKIE));
  if (!guestSessionId) return json({ error: 'unauthenticated' }, 401);
  const guest = await env.DB.prepare(
    `SELECT visitor_key FROM visitor_sessions
      WHERE id=? AND token_hash=? AND revoked_at IS NULL
        AND datetime(expires_at)>datetime('now') AND visitor_key IS NOT NULL
      LIMIT 1`,
  ).bind(guestSessionId, await tokenHash(env, guestSessionId)).first<{ visitor_key: string }>();
  if (!guest?.visitor_key) return json({ error: 'unauthenticated' }, 401);
  const user = await env.DB.prepare('SELECT id FROM users WHERE visitor_key=? LIMIT 1').bind(guest.visitor_key).first<{ id: string }>();
  if (!user?.id || user.id !== session.user_id) return json({ error: 'forbidden' }, 403);
  return { senderType: 'VISITOR', senderId: guest.visitor_key, sessionId };
}

async function releaseAttachmentClaim(env: Env, attachmentKey: string, claimToken: string) {
  await env.DB.prepare(
    'UPDATE attachments SET claim_token=NULL WHERE object_key=? AND claim_token=? AND message_id IS NULL',
  ).bind(attachmentKey, claimToken).run();
}

async function handleImageMessage(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body: any = await req.clone().json().catch(() => ({}));
  if (body.messageType !== 'image') return inner.fetch(req, env, ctx);

  const attachmentKey = attachmentKeyFromPath(body.imagePath);
  if (!attachmentKey) return inner.fetch(req, env, ctx);

  const sender = await resolveMessageSender(env, req, body);
  if (sender instanceof Response) return sender;

  const claimToken = crypto.randomUUID();
  const claimed: any = await env.DB.prepare(
    `UPDATE attachments SET claim_token=?
      WHERE conversation_id=? AND object_key=?
        AND created_by_type=? AND created_by_id=?
        AND message_id IS NULL AND claim_token IS NULL AND deleted_at IS NULL
        AND (expires_at IS NULL OR datetime(expires_at)>datetime('now'))`,
  ).bind(claimToken, sender.sessionId, attachmentKey, sender.senderType, sender.senderId).run();
  if (Number(claimed?.meta?.changes || 0) !== 1) {
    return json({ error: 'attachment_claim_failed' }, 409);
  }

  let response: Response;
  try {
    response = await inner.fetch(req, env, ctx);
  } catch (error) {
    await releaseAttachmentClaim(env, attachmentKey, claimToken);
    throw error;
  }

  if (response.status < 200 || response.status >= 300) {
    await releaseAttachmentClaim(env, attachmentKey, claimToken);
    return response;
  }

  const payload: any = await response.clone().json().catch(() => null);
  const messageId = typeof payload?.message?.id === 'string' ? payload.message.id : '';
  const attachment = await env.DB.prepare(
    'SELECT message_id,claim_token FROM attachments WHERE object_key=? LIMIT 1',
  ).bind(attachmentKey).first<{ message_id: string | null; claim_token: string | null }>();

  if (messageId && attachment?.message_id === messageId) {
    await env.DB.prepare('UPDATE attachments SET claim_token=NULL WHERE object_key=? AND claim_token=?').bind(attachmentKey, claimToken).run();
    return response;
  }

  if (messageId && !payload?.deduped) {
    await env.DB.prepare(
      'DELETE FROM messages WHERE id=? AND session_id=? AND sender_type=? AND sender_id=?',
    ).bind(messageId, sender.sessionId, sender.senderType, sender.senderId).run();
  }
  await releaseAttachmentClaim(env, attachmentKey, claimToken);
  return json({ error: 'attachment_binding_failed' }, 409);
}

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    await inner.scheduled?.(controller, env, ctx);
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    if (url.pathname === '/api/admins/operators' && req.method === 'DELETE') {
      return handleOperatorDisable(req, env, ctx);
    }
    if (url.pathname === '/api/messages' && req.method === 'POST') {
      return handleImageMessage(req, env, ctx);
    }
    return inner.fetch(req, env, ctx);
  },
};
