export { ChatRoom } from './worker-secure';
import secureWorker from './worker-secure';
import type { Env } from './worker';
import { COOKIE_NAMES, readCookie } from './security/cookies';
import { verifySignedValue } from './security/signing';
import { hashSessionToken } from './security/sessionTokens';
import { jsonResponse } from './security/responseHeaders';
import { readJsonObjectWithinLimit } from './security/requestLimits';
import { consumeRateLimit } from './security/rateLimit';

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

type MessageSender = {
  senderType: 'OPERATOR' | 'VISITOR';
  senderId: string;
  sessionId: string;
};

type ExistingMessage = {
  id: string;
  session_id: string;
  sender_type: 'OPERATOR' | 'VISITOR';
  sender_id: string;
  message_type: string;
  image_path: string | null;
  client_message_id: string;
};

type AttachmentBinding = {
  message_id: string | null;
  conversation_id: string;
  created_by_type: string;
  created_by_id: string;
  deleted_at: string | null;
};

const inner = secureWorker as WorkerModule;
const ADMIN_COOKIE = COOKIE_NAMES.admin;
const GUEST_COOKIE = COOKIE_NAMES.guest;
const ATTACHMENT_PATH_PREFIX = '/api/attachments/';
const JSON_REQUEST_MAX_BYTES = 64 * 1024;
const ADMIN_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ADMIN_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

function json(body: unknown, status = 200) { return jsonResponse(body, { status }); }

const getCookie = readCookie;
async function verifySignedId(env: Env, token?: string) { return verifySignedValue(env.SESSION_SECRET, token); }
async function tokenHash(env: Env, value: string) { return hashSessionToken(env.SESSION_SECRET, value); }

function sameOriginWrite(req: Request) {
  const requestUrl = new URL(req.url);
  const expected = requestUrl.origin;
  const origin = req.headers.get('origin');
  if (origin) return origin === expected;
  const referer = req.headers.get('referer');
  if (!referer) return isLocalDevHost(requestUrl.hostname) || isLocalDevHost(req.headers.get('host') || '');
  try {
    return new URL(referer).origin === expected;
  } catch {
    return false;
  }
}

function isLocalDevHost(host: string) {
  let normalized = String(host || '').toLowerCase();
  if (normalized.startsWith('[')) normalized = normalized.slice(1).split(']')[0];
  else if (normalized.indexOf(':') === normalized.lastIndexOf(':') && normalized.includes(':')) {
    normalized = normalized.slice(0, normalized.lastIndexOf(':'));
  }
  return normalized === 'localhost' || normalized.endsWith('.localhost') || normalized === '127.0.0.1' || normalized === '::1';
}

async function readJsonWithinLimit(req: Request) {
  return readJsonObjectWithinLimit(req, JSON_REQUEST_MAX_BYTES);
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
      WHERE id=? AND token_hash=? AND revoked_at IS NULL
      LIMIT 1`,
  ).bind(sessionId, await tokenHash(env, sessionId)).first<AdminSessionRow>();
  if (!session?.admin_id) return null;
  if (adminSessionExpired(session)) {
    await env.DB.prepare('UPDATE admin_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE id=?').bind(new Date().toISOString(), sessionId).run();
    return null;
  }
  const admin = await env.DB.prepare(
    `SELECT id,username,role,is_disabled FROM admins WHERE id=? AND is_disabled=0 LIMIT 1`,
  ).bind(session.admin_id).first<AdminIdentity>();
  if (!admin) return null;
  const timestamp = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare('UPDATE admin_sessions SET last_seen_at=? WHERE id=? AND revoked_at IS NULL').bind(timestamp, sessionId),
    env.DB.prepare('UPDATE admins SET last_seen_at=? WHERE id=? AND is_disabled=0').bind(timestamp, admin.id),
  ]);
  return admin;
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
  const retryAfter = await consumeRateLimit(env.DB, key, 20, 60 * 1000);
  return retryAfter === null ? null : json({ error: 'rate_limited', retryAfter }, 429);
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
  const parsed = await readJsonWithinLimit(req);
  if (parsed.tooLarge) return json({ error: 'request_too_large' }, 413);
  const limited = await mutationRateLimit(env, req);
  if (limited) return limited;

  const actor = await requireSuperAdmin(env, req);
  if (actor instanceof Response) return actor;

  const body = parsed.body;
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

  if (Number(results[0]?.meta?.changes || 0) !== 1) {
    return json({ error: 'operator_state_conflict' }, 409);
  }

  ctx.waitUntil(Promise.all([
    writeOperatorDisableAudit(env, actor.id, operatorId),
    notifyAdmins(env),
  ]).catch((error) => console.error('business hardening post-disable task failed', String(error))));

  return json({
    ok: true,
    disabled: true,
    revokedSessionCount: Number(results[1]?.meta?.changes || 0),
    unassignedSessionCount: Number(results[2]?.meta?.changes || 0),
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

async function resolveMessageSender(env: Env, req: Request, body: Record<string, unknown>): Promise<MessageSender | Response> {
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!sessionId) return json({ error: 'session_required' }, 400);
  const session = await env.DB.prepare(
    'SELECT id,user_id,assigned_operator_id,status,deleted_at,purged_at FROM sessions WHERE id=? LIMIT 1',
  ).bind(sessionId).first<{
    id: string;
    user_id: string;
    assigned_operator_id: string | null;
    status: string;
    deleted_at: string | null;
    purged_at: string | null;
  }>();
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

async function existingImageRetry(
  env: Env,
  sender: MessageSender,
  body: Record<string, unknown>,
  attachmentKey: string,
): Promise<'none' | 'deduped' | 'conflict'> {
  const rawClientMessageId = typeof body.clientMessageId === 'string' ? body.clientMessageId.trim() : '';
  if (!rawClientMessageId) return 'none';
  const clientMessageId = rawClientMessageId.slice(0, 120);

  const existing = await env.DB.prepare(
    `SELECT id,session_id,sender_type,sender_id,message_type,image_path,client_message_id
       FROM messages
      WHERE session_id=? AND sender_type=? AND sender_id=? AND client_message_id=?
      LIMIT 1`,
  ).bind(sender.sessionId, sender.senderType, sender.senderId, clientMessageId).first<ExistingMessage>();
  if (!existing?.id) return 'none';

  const attachment = await env.DB.prepare(
    `SELECT message_id,conversation_id,created_by_type,created_by_id,deleted_at
       FROM attachments
      WHERE object_key=?
      LIMIT 1`,
  ).bind(attachmentKey).first<AttachmentBinding>();

  const sameMessage = existing.message_type === 'image' && existing.image_path === body.imagePath;
  const sameAttachment = Boolean(
    attachment
      && !attachment.deleted_at
      && attachment.message_id === existing.id
      && attachment.conversation_id === sender.sessionId
      && attachment.created_by_type === sender.senderType
      && attachment.created_by_id === sender.senderId,
  );
  return sameMessage && sameAttachment ? 'deduped' : 'conflict';
}

async function releaseAttachmentClaim(env: Env, attachmentKey: string, claimToken: string) {
  await env.DB.prepare(
    'UPDATE attachments SET claim_token=NULL WHERE object_key=? AND claim_token=? AND message_id IS NULL',
  ).bind(attachmentKey, claimToken).run();
}

async function handleImageMessage(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!sameOriginWrite(req)) return json({ error: 'forbidden' }, 403);
  const parsed = await readJsonWithinLimit(req);
  if (parsed.tooLarge) return json({ error: 'request_too_large' }, 413);
  const body = parsed.body;
  if (body.messageType !== 'image') return inner.fetch(req, env, ctx);

  const attachmentKey = attachmentKeyFromPath(body.imagePath);
  if (!attachmentKey) return inner.fetch(req, env, ctx);

  const sender = await resolveMessageSender(env, req, body);
  if (sender instanceof Response) return sender;

  const retry = await existingImageRetry(env, sender, body, attachmentKey);
  if (retry === 'deduped') return inner.fetch(req, env, ctx);
  if (retry === 'conflict') return json({ error: 'client_message_id_conflict' }, 409);

  const claimToken = crypto.randomUUID();
  const claimed = await env.DB.prepare(
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

  const payload = jsonObject(await response.clone().json().catch(() => null));
  const message = jsonObject(payload.message);
  const messageId = typeof message.id === 'string' ? message.id : '';
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
