export { ChatRoom } from './durable-objects/ChatRoom';
import { createChatRoomBroadcastRequest, withConversationRoomAccess } from './durable-objects/ChatRoom';
import { runLifecycle } from './sessionLifecycle';
import { canSendMessage as canSendByState, isSessionEnded } from './domain/sessionState';
import { DomainError } from './http/errors';
import { SessionRepository } from './repositories/sessionRepository';
import { MessageRepository } from './repositories/messageRepository';
import { AttachmentRepository } from './repositories/attachmentRepository';
import { SessionService, type SessionAction } from './services/sessionService';
import { MessageService } from './services/messageService';
import { AttachmentService } from './services/attachmentService';
import { COOKIE_NAMES, clearSessionCookie, readCookie, serializeSessionCookie } from './security/cookies';
import { constantTimeEqual, hmacHex, signValue, verifySignedValue } from './security/signing';
import { hashSessionToken } from './security/sessionTokens';
import { SECURITY_HEADERS, jsonResponse } from './security/responseHeaders';
export interface Env {
  DB: D1Database;
  UPLOADS: R2Bucket;
  CHAT_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
  SESSION_SECRET: string;
  SETUP_TOKEN?: string;
  SUPER_ADMIN_USERNAME?: string;
  SUPER_ADMIN_PASSWORD?: string;
  VISITOR_ROOT_DOMAIN?: string;
}

type Admin = { id: string; username: string; role: 'SUPER_ADMIN' | 'OPERATOR'; is_disabled?: number; must_change_password?: number; last_seen_at?: string };
type VisitorAccount = { id: string; username: string; display_name: string; last_login_at: string };
type VisitorAccountAuthRecord = VisitorAccount & { password_hash: string };
type AdminAuthRecord = Admin & { password_hash: string };
type AdminSessionRecord = {
  id: string;
  admin_id: string;
  created_at: string;
  last_seen_at: string | null;
  expires_at: string;
};
type VisitorSessionRecord = {
  visitor_account_id?: string | null;
  visitor_key?: string | null;
};
type UserRecord = {
  id: string;
  visitor_key: string;
  account_id?: string | null;
  display_name?: string | null;
};
type SessionRecord = {
  id: string;
  user_id: string;
  status: string;
  assigned_operator_id?: string | null;
  archived_at?: string | null;
  deleted_at?: string | null;
  purged_at?: string | null;
  [key: string]: unknown;
};
type MessageRecord = {
  id: string;
  session_id: string;
  sender_type: 'VISITOR' | 'OPERATOR';
  sender_id: string;
  content: string;
  message_type: 'text' | 'image';
  image_path: string | null;
  status: string;
  created_at: string;
  read_at: string | null;
  is_read: number;
  quote_message_id: string | null;
  recalled_at: string | null;
  image_purged_at: string | null;
  client_message_id: string;
  deleted_at?: string | null;
};
type GuestContext = {
  visitorKey: string;
  user: UserRecord;
  session: SessionRecord;
};
type SessionListRecord = SessionRecord & {
  visitor_key: string;
  display_name: string | null;
  customer_remark_name: string | null;
  operator_name: string | null;
  unread_count: number;
};
type ClearHistoryMessage = Pick<MessageRecord, 'id' | 'image_path'>;
type ClearHistoryAttachment = {
  id: string;
  message_id: string | null;
  object_key: string | null;
};
type InviteRecord = {
  source_operator_id: string | null;
  expires_at: string;
  revoked_at: string | null;
  consumed_at: string | null;
  consumed_session_id: string | null;
};
type OperatorRecord = Admin & {
  created_at: string;
  disabled_at?: string | null;
};
type StaffMessageRecord = {
  id: string;
  sender_admin_id: string;
  sender_name: string;
  content: string;
  created_at: string;
};
const ADMIN_COOKIE = COOKIE_NAMES.admin;
const VISITOR_COOKIE = COOKIE_NAMES.visitor;
const GUEST_COOKIE = COOKIE_NAMES.guest;
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const ADMIN_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const ADMIN_SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const ERR_INVALID_INVITE = '\u94fe\u63a5\u5df2\u5931\u6548\uff0c\u8bf7\u8054\u7cfb\u5ba2\u670d\u91cd\u65b0\u83b7\u53d6';
const ERR_INVITE_CREATE_FAILED = '\u4f1a\u8bdd\u521b\u5efa\u5931\u8d25\uff0c\u8bf7\u91cd\u65b0\u6253\u5f00\u9080\u8bf7\u94fe\u63a5\u6216\u8054\u7cfb\u5ba2\u670d';
const ERR_NO_SESSION_ACCESS = '\u65e0\u6743\u8bbf\u95ee\u8be5\u4f1a\u8bdd';
const ERR_SESSION_ENDED = '\u4f1a\u8bdd\u5df2\u7ed3\u675f';
const ERR_LOGIN_REQUIRED = '\u8bf7\u5148\u767b\u5f55\u540e\u53f0';
const ERR_SESSION_NOT_FOUND = '\u4f1a\u8bdd\u4e0d\u5b58\u5728';
const ERR_OPERATOR_NOT_FOUND = '\u5ba2\u670d\u4e0d\u5b58\u5728';
const ERR_MESSAGE_NOT_FOUND = '\u6d88\u606f\u4e0d\u5b58\u5728';
const ERR_PICK_IMAGE = '\u8bf7\u9009\u62e9\u56fe\u7247\u6587\u4ef6';
const ERR_IMAGE_TYPE = '\u4ec5\u652f\u6301 JPG\u3001PNG\u3001WebP \u56fe\u7247';
const ERR_IMAGE_SIZE = '\u56fe\u7247\u4e0d\u80fd\u8d85\u8fc7 5MB';
const ERR_MISSING_SESSION = '\u7f3a\u5c11\u4f1a\u8bdd\u4fe1\u606f';
const ERR_USERNAME_SHORT = '\u7528\u6237\u540d\u81f3\u5c11\u9700\u8981 3 \u4e2a\u5b57\u7b26';
const ERR_PASSWORD_SHORT = '\u5bc6\u7801\u81f3\u5c11\u9700\u8981 8 \u4e2a\u5b57\u7b26';
const ERR_ACCOUNT_EXISTS = '\u8d26\u53f7\u5df2\u5b58\u5728';
const enc = new TextEncoder();
const now = () => new Date().toISOString();
const rid = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
const json = jsonResponse;
const getCookie = readCookie;
const setCookie = serializeSessionCookie;
const clearCookie = clearSessionCookie;
async function readJson(req: Request): Promise<Record<string, unknown>> {
  const body = await req.json().catch(() => null);
  return body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
}
function b64(bytes: Uint8Array) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
function unb64(value: string) { const bin = atob(value); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
async function hmac(secret: string, value: string) { return hmacHex(secret, value); }
async function makeToken(env: Env, value: string) { return signValue(env.SESSION_SECRET, value); }
async function verifyToken(env: Env, token?: string) { return verifySignedValue(env.SESSION_SECRET, token); }
async function tokenHash(env: Env, value: string) { return hashSessionToken(env.SESSION_SECRET, value); }
function expiresAt(days = 1) { return new Date(Date.now() + days * 86400000).toISOString(); }
async function createAdminSession(env: Env, adminId: string) { const id = rid('asess'); const t = now(); await env.DB.prepare('INSERT INTO admin_sessions(id,admin_id,token_hash,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?)').bind(id, adminId, await tokenHash(env, id), t, t, expiresAt()).run(); return await makeToken(env, id); }
async function createVisitorSession(env: Env, accountId: string, visitorKey?: string) { const id = rid('vsess'); await env.DB.prepare('INSERT INTO visitor_sessions(id,visitor_account_id,visitor_key,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(id, accountId, visitorKey || null, await tokenHash(env, id), now(), expiresAt()).run(); return await makeToken(env, id); }
async function hashPassword(password: string) { const salt = crypto.getRandomValues(new Uint8Array(16)); const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']); const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256); return `pbkdf2:100000:${b64(salt)}:${b64(new Uint8Array(bits))}`; }
async function verifyPassword(password: string, stored: string) { if (!stored?.startsWith('pbkdf2:')) return false; const [, iterRaw, saltRaw, hashRaw] = stored.split(':'); const salt = unb64(saltRaw); const expected = unb64(hashRaw); const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']); const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: Number(iterRaw), hash: 'SHA-256' }, key, expected.length * 8); const actual = new Uint8Array(bits); let diff = actual.length ^ expected.length; for (let i = 0; i < Math.min(actual.length, expected.length); i++) diff |= actual[i] ^ expected[i]; return diff === 0; }
async function ensureBootstrap(env: Env) { const row = await env.DB.prepare("SELECT id FROM admins WHERE role='SUPER_ADMIN' LIMIT 1").first(); if (row) return; const username = env.SUPER_ADMIN_USERNAME?.trim(); const password = env.SUPER_ADMIN_PASSWORD; if (!username || !password) return; const t = now(); await env.DB.prepare('INSERT INTO admins(id,username,display_name,password_hash,role,must_change_password,is_disabled,created_at,updated_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind('admin_primary', username, username, await hashPassword(password), 'SUPER_ADMIN', 0, 0, t, t, t).run(); }
function isAdminSessionExpired(session: AdminSessionRecord, at = Date.now()) {
  const createdAt = Date.parse(session?.created_at || '');
  const lastSeenAt = Date.parse(session?.last_seen_at || session?.created_at || '');
  const expiresAtMs = Date.parse(session?.expires_at || '');
  return !Number.isFinite(createdAt)
    || !Number.isFinite(lastSeenAt)
    || !Number.isFinite(expiresAtMs)
    || expiresAtMs <= at
    || at - createdAt > ADMIN_SESSION_MAX_AGE_MS
    || at - lastSeenAt > ADMIN_SESSION_IDLE_TIMEOUT_MS;
}
async function revokeAdminSession(env: Env, sessionId: string) { await env.DB.prepare('UPDATE admin_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE id=?').bind(now(), sessionId).run(); }
async function currentAdmin(env: Env, req: Request, raw = false) {
  const sessionId = await verifyToken(env, getCookie(req, ADMIN_COOKIE));
  if (!sessionId) return null;
  const session = await env.DB.prepare(
    'SELECT id,admin_id,created_at,last_seen_at,expires_at FROM admin_sessions WHERE id=? AND token_hash=? AND revoked_at IS NULL',
  ).bind(sessionId, await tokenHash(env, sessionId)).first<AdminSessionRecord>();
  if (!session) return null;
  const t = now();
  if (isAdminSessionExpired(session)) {
    await revokeAdminSession(env, sessionId);
    return null;
  }
  const admin = await env.DB.prepare(
    'SELECT id,username,role,must_change_password,is_disabled,last_seen_at FROM admins WHERE id=?',
  ).bind(session.admin_id).first<Admin>();
  if (!admin || (!raw && admin.is_disabled)) return null;
  await env.DB.prepare(
    'UPDATE admin_sessions SET last_seen_at=? WHERE id=? AND revoked_at IS NULL',
  ).bind(t, sessionId).run();
  if (!raw) {
    await env.DB.prepare(
      'UPDATE admins SET last_seen_at=? WHERE id=? AND is_disabled=0',
    ).bind(t, admin.id).run();
  }
  return admin;
}
async function requireAdmin(env: Env, req: Request) { const admin = await currentAdmin(env, req); if (!admin) throw new Response('Unauthorized', { status: 401 }); return admin; }
async function requireSuper(env: Env, req: Request) { const admin = await requireAdmin(env, req); if (admin.role !== 'SUPER_ADMIN') throw new Response('Forbidden', { status: 403 }); return admin; }
async function currentVisitorAccount(env: Env, req: Request) {
  const sessionId = await verifyToken(env, getCookie(req, VISITOR_COOKIE));
  if (!sessionId) return null;
  const session = await env.DB.prepare(
    'SELECT visitor_account_id FROM visitor_sessions WHERE id=? AND token_hash=? AND revoked_at IS NULL AND expires_at>?',
  ).bind(sessionId, await tokenHash(env, sessionId), now()).first<VisitorSessionRecord>();
  return session?.visitor_account_id
    ? await env.DB.prepare(
      'SELECT id,username,display_name,last_login_at FROM visitor_accounts WHERE id=?',
    ).bind(session.visitor_account_id).first<VisitorAccount>()
    : null;
}
async function inviteTokenHash(env: Env, value: string) { return await hmac(env.SESSION_SECRET, 'invite:' + value); }
function randomToken(bytes = 20) { const data = crypto.getRandomValues(new Uint8Array(bytes)); return [...data].map((b) => b.toString(16).padStart(2, '0')).join(''); }
const invalidInvite = () => json({ error: ERR_INVALID_INVITE }, { status: 410 });
async function createGuestSessionRecord(env: Env, visitorKey: string) {
  const id = rid('gsess');
  await env.DB.prepare('INSERT INTO visitor_sessions(id,visitor_account_id,visitor_key,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(id, null, visitorKey, await tokenHash(env, id), now(), expiresAt()).run();
  return { id, token: await makeToken(env, id) };
}
async function currentGuestSession(env: Env, req: Request): Promise<GuestContext | null> {
  const sessionId = await verifyToken(env, getCookie(req, GUEST_COOKIE));
  if (!sessionId) return null;
  const row = await env.DB.prepare(
    'SELECT visitor_key FROM visitor_sessions WHERE id=? AND token_hash=? AND revoked_at IS NULL AND expires_at>? AND visitor_key IS NOT NULL',
  ).bind(sessionId, await tokenHash(env, sessionId), now()).first<VisitorSessionRecord>();
  if (!row?.visitor_key) return null;
  const user = await env.DB.prepare(
    'SELECT * FROM users WHERE visitor_key=?',
  ).bind(row.visitor_key).first<UserRecord>();
  if (!user) return null;
  const session = await latestSession(env, user.id);
  if (!session || sessionEnded(session)) return null;
  return { visitorKey: row.visitor_key, user, session };
}
function canAccessSession(admin: Admin | null, session: SessionRecord | null) {
  return Boolean(admin && session && (admin.role === 'SUPER_ADMIN' || session.assigned_operator_id === admin.id));
}
function sessionEnded(session?: SessionRecord | null) {
  return isSessionEnded(session);
}
function canSendMessage(admin: Admin | null, session: SessionRecord | null) {
  return canAccessSession(admin, session) && canSendByState(session);
}
function canUploadAttachment(admin: Admin | null, session: SessionRecord | null) {
  return canSendMessage(admin, session);
}
function canManageSession(admin: Admin | null, session: SessionRecord | null) {
  return canAccessSession(admin, session);
}
function canJoinConversationRoom(admin: Admin | null, session: SessionRecord | null) {
  return canAccessSession(admin, session);
}
async function getSessionById(env: Env, sessionId: string) {
  return sessionId
    ? await env.DB.prepare('SELECT * FROM sessions WHERE id=?').bind(sessionId).first<SessionRecord>()
    : null;
}
async function guestOwnsSession(env: Env, req: Request, session: SessionRecord | null) {
  const guest = await currentGuestSession(env, req);
  return Boolean(guest && session && guest.session.id === session.id && guest.user.id === session.user_id);
}
function publicGuestSession(session: SessionRecord | null) {
  if (!session) return session;
  const { archived_at, archived_by, deleted_at, deleted_by, ...safeSession } = session;
  return safeSession;
}
function sessionForAudience(session: SessionRecord | null, admin: Admin | null) {
  return admin ? session : publicGuestSession(session);
}
async function guestPayload(env: Env, guest: GuestContext, init: ResponseInit = {}) {
  await markMessagesRead(env, guest.session.id, 'OPERATOR');
  return json({
    visitorId: guest.visitorKey,
    account: null,
    user: guest.user,
    session: publicGuestSession(guest.session),
    messages: await getMessages(env, guest.session.id),
  }, init);
}
async function createInviteLink(req: Request, env: Env) {
  const admin = await requireAdmin(env, req);
  const body = await readJson(req);
  let sourceOperatorId: string | null = admin.role === 'OPERATOR' ? admin.id : null;
  if (admin.role === 'SUPER_ADMIN' && body.sourceOperatorId) {
    const operator = await env.DB.prepare(
      "SELECT id FROM admins WHERE id=? AND role='OPERATOR' AND is_disabled=0",
    ).bind(String(body.sourceOperatorId)).first<{ id: string }>();
    if (!operator) return json({ error: ERR_OPERATOR_NOT_FOUND }, { status: 400 });
    sourceOperatorId = operator.id;
  }
  const token = randomToken();
  const t = now();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  const id = rid('inv');
  await env.DB.prepare(
    'INSERT INTO invite_links(id,token_hash,source_operator_id,created_by_admin_id,expires_at,created_at) VALUES(?,?,?,?,?,?)',
  ).bind(id, await inviteTokenHash(env, token), sourceOperatorId, admin.id, expiresAt, t).run();
  return json({
    invite: {
      id,
      token,
      url: `/g/${token}`,
      expires_at: expiresAt,
      source_operator_id: sourceOperatorId,
    },
  });
}
async function consumeInvite(req: Request, env: Env, token: string) {
  const guest = await currentGuestSession(env, req);
  const tokenHash = await inviteTokenHash(env, token);
  const invite = await env.DB.prepare('SELECT * FROM invite_links WHERE token_hash=?').bind(tokenHash).first<InviteRecord>();
  const t = now();
  if (!invite || invite.revoked_at || invite.expires_at <= t) return invalidInvite();
  if (invite.consumed_at) {
    if (guest && invite.consumed_session_id === guest.session.id) return guestPayload(env, guest);
    return invalidInvite();
  }
  const sid = rid('sess');
  const claimed = await env.DB.prepare('UPDATE invite_links SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>?').bind(t, tokenHash, t).run();
  if (typeof claimed?.meta?.changes !== 'number' || claimed.meta.changes < 1) return invalidInvite();

  let guestSessionId: string | null = null;
  try {
    const visitorKey = rid('visitor');
    const { user } = await upsertVisitor(env, visitorKey, null);
    const source = invite.source_operator_id || null;
    const status = source ? 'OPEN' : 'PENDING';
    await env.DB.prepare('INSERT INTO sessions(id,user_id,source_user_id,assigned_operator_id,last_operator_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(sid, user.id, source, source, source, status, t, t).run();
    const session = await env.DB.prepare('SELECT * FROM sessions WHERE id=?').bind(sid).first<SessionRecord>();
    if (!session) throw new Error('Failed to create guest session');
    await env.DB.prepare('UPDATE invite_links SET consumed_session_id=? WHERE token_hash=? AND consumed_at=?').bind(sid, tokenHash, t).run();
    const guestSession = await createGuestSessionRecord(env, visitorKey);
    guestSessionId = guestSession.id;
    return guestPayload(env, { visitorKey, user, session }, { headers: { 'Set-Cookie': setCookie(GUEST_COOKIE, guestSession.token) } });
  } catch (e) {
    console.error('Failed to consume invite after claim', e);
    try {
      if (guestSessionId) await env.DB.prepare('DELETE FROM visitor_sessions WHERE id=?').bind(guestSessionId).run();
    } catch (cleanupError) {
      console.error('Failed to clean up guest session after invite rollback', cleanupError);
    }
    try {
      await env.DB.prepare('UPDATE invite_links SET consumed_at=NULL,consumed_session_id=NULL WHERE token_hash=? AND consumed_at=?').bind(tokenHash, t).run();
    } catch (cleanupError) {
      console.error('Failed to roll back consumed invite token', cleanupError);
    }
    try {
      await env.DB.prepare('DELETE FROM sessions WHERE id=?').bind(sid).run();
    } catch (cleanupError) {
      console.error('Failed to clean up session after invite rollback', cleanupError);
    }
    return json({ error: ERR_INVITE_CREATE_FAILED }, { status: 500 });
  }
}
async function rateLimit(env: Env, req: Request) {
  const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'unknown';
  const key = `${ip}:${new URL(req.url).pathname}`.slice(0, 240);
  const nowMs = Date.now();
  const resetAt = Math.floor(nowMs / 60000) * 60000 + 60000;
  await env.DB.prepare('INSERT INTO rate_limits(key,count,reset_at) VALUES(?,0,?) ON CONFLICT(key) DO NOTHING')
    .bind(key, resetAt).run();
  const consumed = await env.DB.prepare(
    `UPDATE rate_limits
        SET count=CASE WHEN reset_at <= ? THEN 1 ELSE count+1 END,
            reset_at=CASE WHEN reset_at <= ? THEN ? ELSE reset_at END
      WHERE key=? AND (reset_at <= ? OR count < 120)`,
  ).bind(nowMs, nowMs, resetAt, key, nowMs).run();
  if (Number(consumed?.meta?.changes || 0) > 0) return null;
  const row = await env.DB.prepare('SELECT reset_at FROM rate_limits WHERE key=?').bind(key).first<{ reset_at: number }>();
  const retryAfter = Math.max(1, Math.ceil((Number(row?.reset_at || resetAt) - nowMs) / 1000));
  return json({ error: 'rate_limited' }, { status: 429, headers: { 'Retry-After': String(retryAfter) } });
}
async function upsertVisitor(env: Env, visitorId?: string, account?: VisitorAccount | null) {
  const key = account
    ? `acct_${account.id}`
    : (visitorId?.startsWith('visitor_') ? visitorId : rid('visitor'));
  const displayName = account?.display_name || `璁垮 ${key.slice(-6)}`;
  const t = now();
  let user = await env.DB.prepare(
    'SELECT * FROM users WHERE visitor_key=?',
  ).bind(key).first<UserRecord>();
  if (!user) {
    const userId = rid('user');
    await env.DB.prepare(
      'INSERT INTO users(id,visitor_key,account_id,display_name,last_seen_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
    ).bind(userId, key, account?.id || null, displayName, t, t, t).run();
    user = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(userId).first<UserRecord>();
  } else {
    await env.DB.prepare(
      'UPDATE users SET account_id=COALESCE(?,account_id),display_name=?,last_seen_at=?,updated_at=? WHERE id=?',
    ).bind(account?.id || null, displayName, t, t, user.id).run();
  }
  if (!user) throw new Error('visitor upsert did not return a user');
  return { key, user };
}
async function latestSession(env: Env, userId: string) {
  return await env.DB.prepare(
    "SELECT * FROM sessions WHERE user_id=? AND status!='ARCHIVED' AND deleted_at IS NULL AND purged_at IS NULL ORDER BY updated_at DESC LIMIT 1",
  ).bind(userId).first<SessionRecord>();
}
async function getMessages(env: Env, sessionId: string, after?: string | null) {
  const query = after
    ? env.DB.prepare('SELECT * FROM messages WHERE session_id=? AND created_at>? ORDER BY created_at').bind(sessionId, after)
    : env.DB.prepare('SELECT * FROM messages WHERE session_id=? ORDER BY created_at').bind(sessionId);
  return (await query.all<MessageRecord>()).results || [];
}
async function markMessagesRead(env: Env, sessionId: string, senderType: 'VISITOR' | 'OPERATOR', requestedMessageIds: string[] = []) {
  const ids = Array.from(new Set(requestedMessageIds.map((id) => String(id || '').trim()).filter(Boolean))).slice(0, 200);
  const idClause = ids.length ? ` AND id IN (${ids.map(() => '?').join(',')})` : '';
  const rows = (await env.DB.prepare(`SELECT id FROM messages WHERE session_id=? AND sender_type=? AND is_read=0 AND status!='recalled'${idClause}`).bind(sessionId, senderType, ...ids).all<{ id: string }>()).results || [];
  const readMessageIds = rows.map((row) => String(row.id || '')).filter(Boolean);
  if (!readMessageIds.length) return;
  const t = now();
  await env.DB.prepare(`UPDATE messages SET is_read=1,status=CASE WHEN status='sent' THEN 'read' ELSE status END,read_at=COALESCE(read_at,?) WHERE session_id=? AND sender_type=? AND is_read=0 AND status!='recalled'${idClause}`).bind(t, sessionId, senderType, ...ids).run();
  try {
    if (senderType === 'OPERATOR') await broadcast(env, `conversation:${sessionId}`, { type: 'messages:read', conversationId: sessionId, messageIds: readMessageIds, readAt: t, senderType });
    if (senderType === 'VISITOR') await notifyAdmins(env);
  } catch (e) {
    console.error('Failed to broadcast read status update', e);
  }
}
const ATTACHMENT_PATH_PREFIX = '/api/attachments/';
function parseAttachmentPath(path?: string | null) {
  if (typeof path !== 'string' || !path.startsWith(ATTACHMENT_PATH_PREFIX)) return { matched: false, key: '' };
  const rawKey = path.slice(ATTACHMENT_PATH_PREFIX.length);
  if (!rawKey || rawKey.includes('/') || rawKey.includes('?') || rawKey.includes('#')) return { matched: true, key: '' };
  try {
    const key = decodeURIComponent(rawKey);
    if (!key || key.length > 300 || /[\\/\u0000-\u001f\u007f]/.test(key)) return { matched: true, key: '' };
    return { matched: true, key };
  } catch {
    return { matched: true, key: '' };
  }
}
function attachmentKeyFromPath(path?: string | null) { return parseAttachmentPath(path).key; }
type AttachmentDownloadRecord = {
  object_key: string;
  conversation_id: string;
  message_id: string | null;
  mime_type: string | null;
};
async function findAttachmentForDownload(env: Env, key: string) {
  if (!key) return null;
  return await env.DB.prepare(
    `SELECT a.object_key,a.conversation_id,a.message_id,a.mime_type
       FROM attachments a
       LEFT JOIN messages m ON m.id=a.message_id
      WHERE a.object_key=?
        AND a.deleted_at IS NULL
        AND (a.message_id IS NULL OR m.session_id=a.conversation_id)
      LIMIT 1`,
  ).bind(key).first<AttachmentDownloadRecord>();
}
async function canDownloadAttachment(env: Env, req: Request, attachment: AttachmentDownloadRecord) {
  const session = await getSessionById(env, attachment.conversation_id);
  if (!session) return { allowed: false, status: 404 };

  const admin = await currentAdmin(env, req);
  if (admin) return { allowed: canAccessSession(admin, session), status: 403 };

  const guest = await currentGuestSession(env, req);
  if (guest && guest.session.id === session.id && guest.user.id === session.user_id) return { allowed: true, status: 200 };

  const hasSessionProof = Boolean(getCookie(req, ADMIN_COOKIE) || getCookie(req, GUEST_COOKIE));
  return { allowed: false, status: hasSessionProof ? 403 : 401 };
}
async function downloadAttachment(req: Request, env: Env, rawKey: string) {
  const parsed = parseAttachmentPath(`${ATTACHMENT_PATH_PREFIX}${rawKey}`);
  if (!parsed.key) return new Response('Not found', { status: 404 });

  const attachment = await findAttachmentForDownload(env, parsed.key);
  if (!attachment) return new Response('Not found', { status: 404 });

  const auth = await canDownloadAttachment(env, req, attachment);
  if (!auth.allowed) return new Response(auth.status === 401 ? 'Unauthorized' : auth.status === 403 ? 'Forbidden' : 'Not found', { status: auth.status });

  const obj = await env.UPLOADS.get(attachment.object_key);
  return obj ? new Response(obj.body, { headers: { 'Content-Type': obj.httpMetadata?.contentType || attachment.mime_type || 'application/octet-stream', 'Cache-Control': 'no-store' } }) : new Response('Not found', { status: 404 });
}
async function broadcast(env: Env, room: string, payload: unknown) {
  if (!env.CHAT_ROOM) throw new Error('CHAT_ROOM Durable Object binding is missing. Check wrangler.toml and deployment config.');
  await env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(room)).fetch(createChatRoomBroadcastRequest(room, payload));
}
const notifyAdmins = (env: Env) => broadcast(env, 'admin-feed', { type: 'sessions:changed', ts: Date.now() });
async function listSessions(env: Env, admin: Admin, includeDeleted: boolean) {
  const visible = "s.purged_at IS NULL AND (EXISTS (SELECT 1 FROM messages mx WHERE mx.session_id=s.id) OR s.status='CLOSED' OR s.status='ARCHIVED' OR s.archived_at IS NOT NULL OR s.deleted_at IS NOT NULL)";
  const where = includeDeleted
    ? `WHERE ${visible}`
    : `WHERE s.deleted_at IS NULL AND ${visible}`;
  const scoped = admin.role === 'SUPER_ADMIN' ? '' : ' AND s.assigned_operator_id=?';
  const sql = `SELECT s.*,u.visitor_key,u.display_name,cr.remark_name customer_remark_name,a.username operator_name,(SELECT COUNT(*) FROM messages m WHERE m.session_id=s.id AND m.sender_type='VISITOR' AND m.is_read=0) unread_count FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN customer_remarks cr ON cr.user_id=s.user_id LEFT JOIN admins a ON a.id=s.assigned_operator_id ${where}${scoped} ORDER BY COALESCE(s.deleted_at,s.updated_at) DESC`;
  const statement = env.DB.prepare(sql);
  return admin.role === 'SUPER_ADMIN'
    ? (await statement.all<SessionListRecord>()).results || []
    : (await statement.bind(admin.id).all<SessionListRecord>()).results || [];
}
function canClearHistory(session: SessionRecord | null) {
  return Boolean(session && !session.purged_at && (session.status === 'CLOSED' || session.status === 'ARCHIVED' || session.archived_at || session.deleted_at));
}
function clearHistoryR2Keys(messages: ClearHistoryMessage[], attachments: ClearHistoryAttachment[]) {
  const keys = new Set<string>();
  for (const attachment of attachments) {
    const key = String(attachment.object_key || '');
    if (key) keys.add(key);
  }
  for (const message of messages) {
    const parsed = parseAttachmentPath(message.image_path);
    if (parsed.key) keys.add(parsed.key);
  }
  return keys;
}
const clearHistoryCounts = (
  messages: ClearHistoryMessage[],
  attachments: ClearHistoryAttachment[],
  r2Keys = clearHistoryR2Keys(messages, attachments),
) => ({ messages: messages.length, attachments: attachments.length, r2Objects: r2Keys.size });
async function collectClearHistoryContext(env: Env, session: SessionRecord) {
  const sessionId = String(session.id || '');
  const messages = (await env.DB.prepare('SELECT id,image_path FROM messages WHERE session_id=?').bind(sessionId).all<ClearHistoryMessage>()).results || [];
  const attachments = (await env.DB.prepare('SELECT id,message_id,object_key FROM attachments WHERE conversation_id=? OR message_id IN (SELECT id FROM messages WHERE session_id=?)').bind(sessionId, sessionId).all<ClearHistoryAttachment>()).results || [];
  const r2Keys = clearHistoryR2Keys(messages, attachments);
  return { session, messages, attachments, r2Keys, counts: clearHistoryCounts(messages, attachments, r2Keys) };
}
async function deleteByIds(env: Env, table: 'attachments' | 'messages', ids: string[]) {
  for (let i = 0; i < ids.length; i += 80) {
    const chunk = ids.slice(i, i + 80);
    if (chunk.length) await env.DB.prepare(`DELETE FROM ${table} WHERE id IN (${chunk.map(() => '?').join(',')})`).bind(...chunk).run();
  }
}
function isR2NotFoundError(error: unknown) {
  const err = error as { status?: number; statusCode?: number; code?: string; name?: string; message?: string };
  const message = typeof err?.message === 'string' ? err.message : '';
  return err?.status === 404 || err?.statusCode === 404 || err?.code === 'NoSuchKey' || err?.code === 'NotFound' || err?.name === 'NoSuchKey' || err?.name === 'NotFound' || /\b404\b|not found|no such key/i.test(message);
}
async function deleteR2Object(env: Env, key: string) {
  try {
    await env.UPLOADS.delete(key);
    return true;
  } catch (error) {
    return isR2NotFoundError(error);
  }
}
async function clearSessionHistoryInternal(env: Env, ctx: Awaited<ReturnType<typeof collectClearHistoryContext>>) {
  const successAttachmentIds: string[] = [];
  const failedMessageIds = new Set<string>();
  const failedObjectKeys = new Set<string>();
  const successfulObjectKeys = new Set<string>();
  for (const key of ctx.r2Keys) {
    if (await deleteR2Object(env, key)) successfulObjectKeys.add(key);
    else failedObjectKeys.add(key);
  }
  for (const attachment of ctx.attachments) {
    const key = String(attachment.object_key || '');
    if (!key) continue;
    if (successfulObjectKeys.has(key)) {
      successAttachmentIds.push(String(attachment.id));
    } else if (failedObjectKeys.has(key) && attachment.message_id) {
      failedMessageIds.add(String(attachment.message_id));
    }
  }
  for (const message of ctx.messages) {
    const parsed = parseAttachmentPath(message.image_path);
    if (parsed.matched && !parsed.key) failedMessageIds.add(String(message.id));
    if (parsed.key && failedObjectKeys.has(parsed.key)) failedMessageIds.add(String(message.id));
  }
  const deleteMessageIds = ctx.messages.map((message) => String(message.id)).filter((id) => id && !failedMessageIds.has(id));
  await deleteByIds(env, 'attachments', successAttachmentIds);
  await deleteByIds(env, 'messages', deleteMessageIds);
  await env.DB.prepare('UPDATE sessions SET updated_at=? WHERE id=?').bind(now(), ctx.session.id).run();
  const allSucceeded = failedObjectKeys.size === 0 && failedMessageIds.size === 0 && deleteMessageIds.length === ctx.messages.length && successAttachmentIds.length === ctx.attachments.length;
  return { allSucceeded, deleted: { messages: deleteMessageIds.length, attachments: successAttachmentIds.length, r2Objects: successfulObjectKeys.size }, failed: { r2Objects: failedObjectKeys.size } };
}
async function clearSessionHistory(req: Request, env: Env, sessionId: string, dryRun: boolean) {
  const admin = await requireSuper(env, req);
  const session = await getSessionById(env, sessionId);
  if (!session) return json({ error: ERR_SESSION_NOT_FOUND }, { status: 404 });
  if (!canClearHistory(session)) return json({ error: ERR_SESSION_ENDED }, { status: 400 });
  const ctx = await collectClearHistoryContext(env, session);
  if (dryRun) return json({ ok: true, eligible: true, counts: ctx.counts });
  const body = await readJson(req);
  if (body.confirm !== 'CLEAR_HISTORY') return json({ error: 'Invalid confirmation' }, { status: 400 });
  const { allSucceeded, ...result } = await clearSessionHistoryInternal(env, ctx);
  if (allSucceeded) {
    const t = now();
    await env.DB.prepare('UPDATE sessions SET history_cleared_at=?,history_cleared_by=?,updated_at=? WHERE id=?').bind(t, admin.id, t, sessionId).run();
  }
  await notifyAdmins(env);
  return json({ ok: true, ...result });
}
async function updateCustomerRemark(req: Request, env: Env, sessionId: string) {
  const admin = await requireAdmin(env, req);
  const session = await getSessionById(env, sessionId);
  if (!session) return json({ error: ERR_SESSION_NOT_FOUND }, { status: 404 });
  if (!canAccessSession(admin, session)) return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 });
  const b = await readJson(req);
  const remarkName = String(b.remarkName || '').trim().slice(0, 40);
  const t = now();
  if (remarkName) {
    await env.DB.prepare('INSERT INTO customer_remarks(user_id,remark_name,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET remark_name=excluded.remark_name,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(session.user_id, remarkName, admin.id, t).run();
  } else {
    await env.DB.prepare('DELETE FROM customer_remarks WHERE user_id=?').bind(session.user_id).run();
  }
  await notifyAdmins(env);
  return json({ ok: true, session: { ...session, customer_remark_name: remarkName || null } });
}
async function logoutAdmin(req: Request, env: Env) {
  const sessionId = await verifyToken(env, getCookie(req, ADMIN_COOKIE));
  if (sessionId) {
    await env.DB.prepare('UPDATE admin_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND token_hash=?').bind(now(), sessionId, await tokenHash(env, sessionId)).run();
  }
  return json({ ok: true }, { headers: { 'Set-Cookie': clearCookie(ADMIN_COOKIE) } });
}
function setupError(reason: 'already_configured' | 'missing_setup_token' | 'invalid_setup_token' | 'invalid_input' | 'setup_failed', status = 400) {
  return json({ ok: false, error: 'setup_failed', reason }, { status });
}
function isLocalSetupRequest(req: Request) {
  const url = new URL(req.url);
  const host = url.hostname.toLowerCase();
  const requestHost = (req.headers.get('host') || host).toLowerCase();
  return isLocalDevHost(host) || isLocalDevHost(requestHost);
}
function isSetupApiHostAllowed(req: Request) {
  const url = new URL(req.url);
  const host = url.hostname.toLowerCase();
  const requestHost = (req.headers.get('host') || host).toLowerCase();
  return host === BACKEND_HOST || requestHost === BACKEND_HOST || isLocalDevHost(host) || isLocalDevHost(requestHost);
}
async function hasAnyAdmin(env: Env) {
  const row = await env.DB.prepare('SELECT id FROM admins LIMIT 1').first<{ id: string }>();
  return Boolean(row?.id);
}
function setupTokenRequired(env: Env, req: Request) {
  return !isLocalSetupRequest(req) || Boolean(env.SETUP_TOKEN?.trim());
}
async function validSetupToken(env: Env, provided: unknown) {
  const expected = env.SETUP_TOKEN?.trim();
  if (!expected) return false;
  const actual = typeof provided === 'string' ? provided.trim() : '';
  if (!actual) return false;
  return constantTimeEqual(await hmac(env.SESSION_SECRET, 'setup:' + actual), await hmac(env.SESSION_SECRET, 'setup:' + expected));
}
async function setupStatus(req: Request, env: Env) {
  if (await hasAnyAdmin(env)) return json({ ok: true, setupAvailable: false, requiresSetupToken: false, reason: 'already_configured' });
  const tokenRequired = setupTokenRequired(env, req);
  if (tokenRequired && !env.SETUP_TOKEN?.trim()) return json({ ok: true, setupAvailable: false, requiresSetupToken: true, reason: 'missing_setup_token' });
  return json({ ok: true, setupAvailable: true, requiresSetupToken: tokenRequired, reason: 'no_admins' });
}
async function initializeSetup(req: Request, env: Env) {
  if (await hasAnyAdmin(env)) return setupError('already_configured', 409);

  const tokenRequired = setupTokenRequired(env, req);
  if (tokenRequired && !env.SETUP_TOKEN?.trim()) return setupError('missing_setup_token', 403);
  const body = await readJson(req);
  if (tokenRequired && !(await validSetupToken(env, body.setupToken))) return setupError('invalid_setup_token', 403);

  const username = String(body.username || '').trim();
  const displayNameRaw = String(body.displayName || '').trim();
  const displayName = displayNameRaw || username;
  const password = typeof body.password === 'string' ? body.password : '';
  const confirmPassword = typeof body.confirmPassword === 'string' ? body.confirmPassword : '';

  if (!/^[A-Za-z0-9_.@-]{3,64}$/.test(username)) return setupError('invalid_input');
  if (!displayName || displayName.length > 80) return setupError('invalid_input');
  if (password.length < 12 || password !== confirmPassword) return setupError('invalid_input');
  if (await hasAnyAdmin(env)) return setupError('already_configured', 409);

  const adminId = 'admin_primary';
  const t = now();
  try {
    await env.DB.prepare('INSERT INTO admins(id,username,display_name,password_hash,role,must_change_password,is_disabled,created_at,updated_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,NULL)').bind(adminId, username, displayName, await hashPassword(password), 'SUPER_ADMIN', 0, 0, t, t).run();
  } catch {
    console.warn('setup initialize insert rejected');
    return (await hasAnyAdmin(env)) ? setupError('already_configured', 409) : setupError('setup_failed', 500);
  }

  const created = await env.DB.prepare(
    "SELECT id FROM admins WHERE id=? AND role='SUPER_ADMIN'",
  ).bind(adminId).first<{ id: string }>();
  if (!created?.id) return setupError('setup_failed', 500);
  return json({ ok: true, initialized: true, next: 'login', message: 'setup_complete_rotate_token' });
}
async function setupApi(req: Request, env: Env) {
  if (!isSetupApiHostAllowed(req)) return empty(404);
  const path = new URL(req.url).pathname;
  try {
    if (req.method !== 'GET') {
      const limited = await rateLimit(env, req);
      if (limited) return limited;
    }
    if (path === '/api/setup/status' && req.method === 'GET') return setupStatus(req, env);
    if (path === '/api/setup/initialize' && req.method === 'POST') return initializeSetup(req, env);
    return empty(404);
  } catch {
    console.error('setup api failed');
    return setupError('setup_failed', 500);
  }
}
async function visitorLogin(env: Env, username: string, password: string) {
  const account = await env.DB.prepare(
    'SELECT * FROM visitor_accounts WHERE username=?',
  ).bind(username).first<VisitorAccountAuthRecord>();
  if (!account || !(await verifyPassword(password, account.password_hash))) {
    return json({ error: 'Invalid credentials' }, { status: 401 });
  }
  const t = now();
  await env.DB.prepare(
    'UPDATE visitor_accounts SET last_login_at=?,updated_at=? WHERE id=?',
  ).bind(t, t, account.id).run();
  const safeAccount: VisitorAccount = {
    id: account.id,
    username: account.username,
    display_name: account.display_name,
    last_login_at: t,
  };
  return json({ type: 'user', account: safeAccount }, {
    headers: {
      'Set-Cookie': setCookie(VISITOR_COOKIE, await createVisitorSession(env, account.id)),
    },
  });
}

async function login(req: Request, env: Env, allowVisitorFallback: boolean) {
  const body = await readJson(req);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const admin = await env.DB.prepare(
    'SELECT * FROM admins WHERE username=?',
  ).bind(username).first<AdminAuthRecord>();
  if (!admin) {
    return allowVisitorFallback
      ? visitorLogin(env, username, password)
      : json({ error: 'Invalid credentials' }, { status: 401 });
  }
  if (admin.is_disabled) return json({ error: 'Disabled', disabled: true }, { status: 403 });
  if (!(await verifyPassword(password, admin.password_hash))) {
    return json({ error: 'Invalid credentials' }, { status: 401 });
  }
  return json({
    type: 'admin',
    admin: {
      id: admin.id,
      username: admin.username,
      role: admin.role,
      must_change_password: admin.must_change_password,
    },
  }, {
    headers: {
      'Set-Cookie': setCookie(ADMIN_COOKIE, await createAdminSession(env, admin.id)),
    },
  });
}
async function createMessage(req: Request, env: Env) {
  const body = await readJson(req);
  const admin = await currentAdmin(env, req);
  const senderType: 'VISITOR' | 'OPERATOR' =
    (body.senderType || (admin ? 'OPERATOR' : 'VISITOR')) === 'OPERATOR'
      ? 'OPERATOR'
      : 'VISITOR';
  let senderId = '';
  let sessionId = String(body.sessionId || '');
  let session: SessionRecord | null = null;

  if (senderType === 'OPERATOR') {
    if (!admin) return json({ error: ERR_LOGIN_REQUIRED }, { status: 401 });
    session = await getSessionById(env, sessionId);
    if (!session) return json({ error: ERR_SESSION_NOT_FOUND }, { status: 404 });
    if (!canAccessSession(admin, session)) return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 });
    if (!canSendMessage(admin, session)) return json({ error: ERR_SESSION_ENDED }, { status: 400 });
    senderId = admin.id;
  } else {
    const guest = await currentGuestSession(env, req);
    if (!guest) return invalidInvite();
    sessionId = sessionId || guest.session.id;
    session = await getSessionById(env, sessionId);
    if (!session || guest.session.id !== session.id || guest.user.id !== session.user_id) {
      return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 });
    }
    if (sessionEnded(session)) return json({ error: ERR_SESSION_ENDED }, { status: 400 });
    senderId = guest.visitorKey;
  }

  const rawClientId = typeof body.clientMessageId === 'string' ? body.clientMessageId.trim() : '';
  const clientMessageId = rawClientId ? rawClientId.slice(0, 120) : `server:${rid('cmid')}`;
  const service = new MessageService(new MessageRepository(env.DB), rid, now, attachmentKeyFromPath);
  const result = await service.create({
    sessionId,
    senderType,
    senderId,
    clientMessageId,
    content: String(body.content || ''),
    messageType: body.messageType === 'image' ? 'image' : 'text',
    imagePath: typeof body.imagePath === 'string' ? body.imagePath : null,
    quoteMessageId: typeof body.quoteMessageId === 'string' ? body.quoteMessageId : null,
  });
  if (result.deduped) {
    return json({ message: result.message, session: sessionForAudience(session, admin), deduped: true });
  }

  session = await getSessionById(env, sessionId);
  await broadcast(env, `conversation:${sessionId}`, {
    type: 'message:new',
    conversationId: sessionId,
    message: result.message,
    session: publicGuestSession(session),
  });
  await notifyAdmins(env);
  return json({ message: result.message, session: sessionForAudience(session, admin) });
}
async function sessionAction(req: Request, env: Env, sessionId: string, action: SessionAction) {
  const admin = await requireAdmin(env, req);
  const service = new SessionService(
    new SessionRepository(env.DB),
    (actor, session) => canManageSession(actor as Admin, session as SessionRecord),
  );
  try {
    const session = await service.execute(admin, sessionId, action, now());
    await broadcast(env, `conversation:${sessionId}`, {
      type: 'session:updated',
      conversationId: sessionId,
      session: publicGuestSession(session),
    });
    await notifyAdmins(env);
    return json({ ok: true, session });
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    if (error.code === 'SESSION_NOT_FOUND') {
      return json({ error: ERR_SESSION_NOT_FOUND, code: error.code }, { status: error.status });
    }
    if (error.code === 'FORBIDDEN') {
      return json({ error: ERR_NO_SESSION_ACCESS, code: error.code }, { status: error.status });
    }
    return json({ error: ERR_SESSION_ENDED, code: error.code }, { status: error.status });
  }
}
async function bindGuest(env: Env, visitorKey: string, account: VisitorAccount) {
  if (!visitorKey.startsWith('visitor_')) return;
  const accountKey = `acct_${account.id}`;
  const t = now();
  const accountUser = await env.DB.prepare(
    'SELECT id FROM users WHERE visitor_key=?',
  ).bind(accountKey).first<{ id: string }>();
  const guestUser = await env.DB.prepare(
    'SELECT id FROM users WHERE visitor_key=?',
  ).bind(visitorKey).first<{ id: string }>();
  if (!guestUser) return;
  if (accountUser) {
    await env.DB.prepare(
      'UPDATE sessions SET user_id=?,updated_at=? WHERE user_id=?',
    ).bind(accountUser.id, t, guestUser.id).run();
    await env.DB.prepare('DELETE FROM users WHERE id=?').bind(guestUser.id).run();
  } else {
    await env.DB.prepare(
      'UPDATE users SET visitor_key=?,account_id=?,display_name=?,updated_at=? WHERE id=?',
    ).bind(accountKey, account.id, account.display_name, t, guestUser.id).run();
  }
}

async function registerVisitorAccount(req: Request, env: Env) {
  const body = await readJson(req);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const displayName = String(body.displayName || username).trim();
  if (username.length < 3) return json({ error: ERR_USERNAME_SHORT }, { status: 400 });
  if (password.length < 8) return json({ error: ERR_PASSWORD_SHORT }, { status: 400 });

  const t = now();
  const accountId = rid('acct');
  try {
    await env.DB.prepare(
      'INSERT INTO visitor_accounts(id,username,password_hash,display_name,last_login_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)',
    ).bind(accountId, username, await hashPassword(password), displayName, t, t, t).run();
  } catch (error) {
    const existing = await env.DB.prepare(
      'SELECT id FROM visitor_accounts WHERE username=?',
    ).bind(username).first<{ id: string }>();
    if (existing) return json({ error: ERR_ACCOUNT_EXISTS }, { status: 409 });
    throw error;
  }

  const account: VisitorAccount = {
    id: accountId,
    username,
    display_name: displayName,
    last_login_at: t,
  };
  const visitorId = typeof body.visitorId === 'string' ? body.visitorId : '';
  if (body.claimGuest && visitorId) await bindGuest(env, visitorId, account);
  if (body.discardGuest && visitorId) {
    await env.DB.prepare('DELETE FROM users WHERE visitor_key=?').bind(visitorId).run();
  }
  return json({ type: 'user', account }, {
    headers: {
      'Set-Cookie': setCookie(
        VISITOR_COOKIE,
        await createVisitorSession(env, accountId, visitorId),
      ),
    },
  });
}
async function upload(req: Request, env: Env) {
  const url = new URL(req.url);
  const sessionId = String(url.searchParams.get('sessionId') || '');
  if (!sessionId) return json({ error: ERR_MISSING_SESSION }, { status: 400 });
  const session = await getSessionById(env, sessionId);
  if (!session) return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 });

  const admin = await currentAdmin(env, req);
  let createdByType: 'VISITOR' | 'OPERATOR' = 'VISITOR';
  let createdById = '';
  if (admin) {
    if (!canAccessSession(admin, session)) return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 });
    if (!canUploadAttachment(admin, session)) return json({ error: ERR_SESSION_ENDED }, { status: 400 });
    createdByType = 'OPERATOR';
    createdById = admin.id;
  } else {
    const guest = await currentGuestSession(env, req);
    if (!guest || guest.session.id !== session.id || guest.user.id !== session.user_id) {
      return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 });
    }
    if (sessionEnded(session)) return json({ error: ERR_SESSION_ENDED }, { status: 400 });
    createdById = guest.visitorKey;
  }

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: ERR_PICK_IMAGE }, { status: 400 });
  const service = new AttachmentService(new AttachmentRepository(env.DB), env.UPLOADS, rid, now);
  try {
    return json(await service.upload({ sessionId, file, createdByType, createdById }));
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    if (error.code === 'ATTACHMENT_INVALID_TYPE') return json({ error: ERR_IMAGE_TYPE }, { status: error.status });
    if (error.code === 'ATTACHMENT_TOO_LARGE') return json({ error: ERR_IMAGE_SIZE }, { status: error.status });
    throw error;
  }
}
async function api(req: Request, env: Env) {
  const url = new URL(req.url);
  const path = url.pathname;
  if (path.startsWith('/api/setup/')) return setupApi(req, env);
  await ensureBootstrap(env);
  if (req.method !== 'GET' && !path.startsWith('/api/ws')) { const limited = await rateLimit(env, req); if (limited) return limited; }
  if (path === '/api/auth/me') { const admin = await currentAdmin(env, req, true); if (admin?.is_disabled) return json({ admin: null, disabled: true }, { status: 403, headers: { 'Set-Cookie': clearCookie(ADMIN_COOKIE) } }); return json({ admin }); }
  if (path === '/api/auth/logout' && req.method === 'POST') return logoutAdmin(req, env);
  if (path === '/api/account/logout' && req.method === 'POST') return json({ ok: true }, { headers: { 'Set-Cookie': clearCookie(VISITOR_COOKIE) } });
  if ((path === '/api/auth/login' || path === '/api/login') && req.method === 'POST') {
    return login(req, env, path === '/api/login');
  }
  if (path === '/api/account/login' && req.method === 'POST') {
    const body = await readJson(req);
    return visitorLogin(env, String(body.username || '').trim(), String(body.password || ''));
  }
  if (path === '/api/account/register' && req.method === 'POST') {
    return registerVisitorAccount(req, env);
  }
  if (path === '/api/account/me') return json({ account: await currentVisitorAccount(env, req) });
  if (path === '/api/invites' && req.method === 'POST') return createInviteLink(req, env);
  const guestRoute = path.match(/^\/api\/guest\/([^/]+)$/);
  if (guestRoute && req.method === 'POST') return consumeInvite(req, env, decodeURIComponent(guestRoute[1]));
  if (path === '/api/visitor' && req.method === 'POST') { const guest = await currentGuestSession(env, req); if (!guest) return invalidInvite(); return guestPayload(env, guest); }
  if (path === '/api/messages' && req.method === 'POST') return createMessage(req, env);
  if (path === '/api/sessions' && req.method === 'GET') { const admin = await requireAdmin(env, req); return json({ sessions: await listSessions(env, admin, url.searchParams.get('includeDeleted') === '1') }); }
  const sm = path.match(/^\/api\/sessions\/([^/]+)\/messages$/);
  if (sm) { const session = await getSessionById(env, sm[1]); if (!session || session.deleted_at || session.purged_at) return json({ messages: [] }); const admin = await currentAdmin(env, req); if (admin) { if (!canAccessSession(admin, session)) return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 }); await markMessagesRead(env, session.id, 'VISITOR'); } else if (await guestOwnsSession(env, req, session)) await markMessagesRead(env, session.id, 'OPERATOR'); else return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 }); return json({ messages: await getMessages(env, session.id, url.searchParams.get('after')) }); }
  const cr = path.match(/^\/api\/sessions\/([^/]+)\/customer-read$/);
  if (cr && req.method === 'POST') {
    const session = await getSessionById(env, cr[1]);
    if (!session || session.deleted_at || session.purged_at) {
      return json({ error: ERR_SESSION_NOT_FOUND }, { status: 404 });
    }
    if (!(await guestOwnsSession(env, req, session))) {
      return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 });
    }
    const body = await readJson(req);
    const messageIds = Array.isArray(body.messageIds)
      ? body.messageIds.filter((id): id is string => typeof id === 'string')
      : [];
    await markMessagesRead(env, session.id, 'OPERATOR', messageIds);
    return json({ ok: true });
  }
  const remark = path.match(/^\/api\/sessions\/([^/]+)\/customer-remark$/);
  if (remark && req.method === 'PATCH') return updateCustomerRemark(req, env, remark[1]);
  const clearDryRun = path.match(/^\/api\/sessions\/([^/]+)\/clear-history\/dry-run$/);
  if (clearDryRun && req.method === 'POST') return clearSessionHistory(req, env, clearDryRun[1], true);
  const clearHistory = path.match(/^\/api\/sessions\/([^/]+)\/clear-history$/);
  if (clearHistory && req.method === 'POST') return clearSessionHistory(req, env, clearHistory[1], false);
  const sa = path.match(/^\/api\/sessions\/([^/]+)\/(assign|close|archive|unarchive|delete|restore)$/);
  if (sa && req.method === 'POST') return sessionAction(req, env, sa[1], sa[2] as SessionAction);
  const rec = path.match(/^\/api\/messages\/([^/]+)\/recall$/);
  if (rec && req.method === 'POST') {
    const message = await env.DB.prepare(
      'SELECT * FROM messages WHERE id=?',
    ).bind(rec[1]).first<MessageRecord>();
    if (!message) return json({ error: ERR_MESSAGE_NOT_FOUND }, { status: 404 });
    const session = await getSessionById(env, message.session_id);
    if (!session) return json({ error: ERR_SESSION_NOT_FOUND }, { status: 404 });

    const admin = await currentAdmin(env, req);
    const authorized = admin
      ? canAccessSession(admin, session)
        && message.sender_type === 'OPERATOR'
        && message.sender_id === admin.id
      : await guestOwnsSession(env, req, session) && message.sender_type === 'VISITOR';
    if (!authorized) return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 });
    if (sessionEnded(session)) return json({ error: ERR_SESSION_ENDED }, { status: 400 });

    const t = now();
    await env.DB.prepare(
      "UPDATE messages SET status='recalled',content='',image_path=NULL,recalled_at=? WHERE id=?",
    ).bind(t, message.id).run();
    const recalledMessage = await env.DB.prepare(
      'SELECT * FROM messages WHERE id=?',
    ).bind(message.id).first<MessageRecord>();
    if (recalledMessage) {
      await broadcast(env, `conversation:${recalledMessage.session_id}`, {
        type: 'message:updated',
        conversationId: recalledMessage.session_id,
        message: recalledMessage,
      });
    }
    return json({ ok: true });
  }
  const del = path.match(/^\/api\/messages\/([^/]+)\/delete$/);
  if (del && req.method === 'POST') {
    const message = await env.DB.prepare(
      'SELECT * FROM messages WHERE id=?',
    ).bind(del[1]).first<MessageRecord>();
    if (!message) return json({ error: ERR_MESSAGE_NOT_FOUND }, { status: 404 });
    const session = await getSessionById(env, message.session_id);
    if (!session) return json({ error: ERR_SESSION_NOT_FOUND }, { status: 404 });

    const admin = await currentAdmin(env, req);
    const authorized = admin
      ? canAccessSession(admin, session)
        && message.sender_type === 'OPERATOR'
        && message.sender_id === admin.id
      : await guestOwnsSession(env, req, session) && message.sender_type === 'VISITOR';
    if (!authorized) return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 });

    await env.DB.prepare(
      'UPDATE messages SET deleted_at=? WHERE id=?',
    ).bind(now(), message.id).run();
    await broadcast(env, `conversation:${message.session_id}`, {
      type: 'message:deleted',
      conversationId: message.session_id,
      messageId: message.id,
    });
    return json({ ok: true });
  }
  if (path === '/api/messages/purge-images' && req.method === 'POST') { const admin = await requireAdmin(env, req); await env.DB.prepare("UPDATE messages SET image_path=NULL,image_purged_at=?,content='' WHERE sender_id=? AND message_type='image'").bind(now(), admin.id).run(); await notifyAdmins(env); return json({ ok: true }); }
  if (path === '/api/admins' && req.method === 'GET') { await requireSuper(env, req); return json({ admins: (await env.DB.prepare('SELECT id,username,role,must_change_password,created_at,is_disabled,disabled_at,last_seen_at FROM admins ORDER BY role DESC, created_at').all()).results || [] }); }
  if (path === '/api/admins' && req.method === 'POST') {
    await requireSuper(env, req);
    const body = await readJson(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const t = now();
    await env.DB.prepare(
      "INSERT INTO admins(id,username,display_name,password_hash,role,must_change_password,is_disabled,created_at,updated_at,last_seen_at) VALUES(?,?,?,?, 'OPERATOR',0,0,?,?,NULL)",
    ).bind(rid('admin'), username, username, await hashPassword(password), t, t).run();
    return json({ ok: true });
  }
  if (path === '/api/admins/operators' && req.method === 'GET') {
    await requireSuper(env, req);
    const rows = (await env.DB.prepare(
      "SELECT id,username,role,created_at,is_disabled,disabled_at,last_seen_at FROM admins WHERE role='OPERATOR' ORDER BY is_disabled, username",
    ).all<OperatorRecord>()).results || [];
    return json({
      operators: rows.map((operator) => ({
        ...operator,
        online: Boolean(
          operator.last_seen_at
          && Date.now() - Date.parse(operator.last_seen_at) < 120000
          && !operator.is_disabled,
        ),
      })),
    });
  }
  if (path === '/api/admins/operators' && req.method === 'DELETE') {
    const admin = await requireSuper(env, req);
    const body = await readJson(req);
    const operatorId = String(body.id || '');
    const t = now();
    if (body.hard) {
      await env.DB.prepare(
        "DELETE FROM admins WHERE id=? AND role='OPERATOR' AND is_disabled=1",
      ).bind(operatorId).run();
    } else {
      await env.DB.prepare(
        "UPDATE admins SET is_disabled=1,disabled_at=?,updated_at=? WHERE id=? AND role='OPERATOR'",
      ).bind(t, t, operatorId).run();
      await env.DB.prepare(
        'UPDATE sessions SET deleted_at=?,deleted_by=?,assigned_operator_id=NULL,updated_at=? WHERE deleted_at IS NULL AND (assigned_operator_id=? OR last_operator_id=?)',
      ).bind(t, admin.id, t, operatorId, operatorId).run();
    }
    await notifyAdmins(env);
    return json({ ok: true });
  }
  if (path === '/api/admins/profile' && req.method === 'PATCH') {
    const admin = await requireSuper(env, req);
    const body = await readJson(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const t = now();
    if (username) {
      await env.DB.prepare(
        'UPDATE admins SET username=?,display_name=?,updated_at=? WHERE id=?',
      ).bind(username, username, t, admin.id).run();
    }
    if (password) {
      await env.DB.prepare(
        'UPDATE admins SET password_hash=?,must_change_password=0,updated_at=? WHERE id=?',
      ).bind(await hashPassword(password), t, admin.id).run();
    }
    return json({ ok: true });
  }
  if (path === '/api/staff-chat' && req.method === 'GET') {
    await requireAdmin(env, req);
    const rows = (await env.DB.prepare(
      'SELECT sm.*,a.username sender_name FROM staff_messages sm JOIN admins a ON a.id=sm.sender_admin_id ORDER BY sm.created_at DESC LIMIT 80',
    ).all<StaffMessageRecord>()).results || [];
    return json({ messages: rows.reverse() });
  }
  if (path === '/api/staff-chat' && req.method === 'POST') {
    const admin = await requireAdmin(env, req);
    const body = await readJson(req);
    const message: StaffMessageRecord = {
      id: rid('staffmsg'),
      sender_admin_id: admin.id,
      sender_name: admin.username,
      content: String(body.content || '').trim(),
      created_at: now(),
    };
    await env.DB.prepare(
      'INSERT INTO staff_messages(id,sender_admin_id,content,created_at) VALUES(?,?,?,?)',
    ).bind(message.id, admin.id, message.content, message.created_at).run();
    await broadcast(env, 'staff', { type: 'staff:new', message });
    return json({ message });
  }
  if (path === '/api/upload' && req.method === 'POST') return upload(req, env);
  const att = path.match(/^\/api\/attachments\/(.+)$/);
  if (att) return downloadAttachment(req, env, att[1]);
  if (path === '/api/ws/admin') { await requireAdmin(env, req); return env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName('admin-feed')).fetch(req); }
  if (path === '/api/ws/staff') { await requireAdmin(env, req); return env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName('staff')).fetch(req); }
  const ws = path.match(/^\/api\/ws\/conversations\/([^/]+)$/);
  if (ws) {
    const session = await getSessionById(env, ws[1]);
    if (!session) return new Response('Not found', { status: 404 });
    const admin = await currentAdmin(env, req);
    if (admin) {
      if (!canJoinConversationRoom(admin, session)) return new Response(ERR_NO_SESSION_ACCESS, { status: 403 });
      const authSessionId = await verifyToken(env, getCookie(req, ADMIN_COOKIE));
      if (!authSessionId) return new Response(ERR_NO_SESSION_ACCESS, { status: 403 });
      return env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(`conversation:${ws[1]}`)).fetch(
        withConversationRoomAccess(req, session.id, 'admin', admin.id, authSessionId),
      );
    }
    const guest = await currentGuestSession(env, req);
    if (!guest || guest.session.id !== session.id || guest.user.id !== session.user_id) {
      return new Response(ERR_NO_SESSION_ACCESS, { status: 403 });
    }
    const authSessionId = await verifyToken(env, getCookie(req, GUEST_COOKIE));
    if (!authSessionId) return new Response(ERR_NO_SESSION_ACCESS, { status: 403 });
    return env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(`conversation:${ws[1]}`)).fetch(
      withConversationRoomAccess(req, session.id, 'guest', guest.user.id, authSessionId),
    );
  }
  return json({ error: 'Not found' }, { status: 404 });
}


const BACKEND_HOST = 'denglu.kefuxitong.net';
const HEX_INVITE_TOKEN = /^[a-f0-9]{40}$/;
const noStoreHeaders = { 'cache-control': 'no-store', 'strict-transport-security': SECURITY_HEADERS['Strict-Transport-Security'] };
const empty = (status: number) => new Response(null, { status, headers: noStoreHeaders });

function isLocalDevHost(host: string) {
  let normalized = host.toLowerCase();
  if (normalized.startsWith('[')) normalized = normalized.slice(1).split(']')[0];
  else if (normalized.indexOf(':') === normalized.lastIndexOf(':') && normalized.includes(':')) normalized = normalized.slice(0, normalized.lastIndexOf(':'));
  return normalized === 'localhost' || normalized.endsWith('.localhost') || normalized === '127.0.0.1' || normalized === '0.0.0.0' || normalized === '::1';
}

function withNoStore(response: Response) {
  if ((response as Response & { webSocket?: unknown }).webSocket) return response;
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store');
  headers.set('strict-transport-security', SECURITY_HEADERS['Strict-Transport-Security']);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function validateInviteHost(env: Env, token: string) {
  const tokenHash = await inviteTokenHash(env, token);
  const invite = await env.DB.prepare(
    'SELECT * FROM invite_links WHERE token_hash=?',
  ).bind(tokenHash).first<InviteRecord>();
  if (!invite || invite.revoked_at || invite.expires_at <= now()) return 404;
  if (invite.consumed_at && !invite.consumed_session_id) return 410;
  if (invite.consumed_at && invite.consumed_session_id) {
    const session = await env.DB.prepare(
      'SELECT * FROM sessions WHERE id=?',
    ).bind(invite.consumed_session_id).first<SessionRecord>();
    if (!session || sessionEnded(session)) return 410;
  }
  return 200;
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
    try {
      const result = await runLifecycle(env);
      console.log(JSON.stringify({
        mode: 'lifecycle:scheduled',
        archivedCount: result.archivedCount,
        purgedCount: result.purgedCount,
        errorCount: result.errorCount,
      }));
    } catch (error) {
      console.error(JSON.stringify({
        mode: 'lifecycle:scheduled',
        error: 'scheduled lifecycle failed',
        detail: String(error),
      }));
    }
  },
  async fetch(req: Request, env: Env) {
    try {
      const url = new URL(req.url);
      const host = url.hostname.toLowerCase();
      const requestHost = (req.headers.get('host') || host).toLowerCase();
      if (url.protocol === 'http:' && !isLocalDevHost(host) && !isLocalDevHost(requestHost)) {
        url.protocol = 'https:';
        return new Response(null, { status: 308, headers: { ...noStoreHeaders, Location: url.toString() } });
      }
      const pathname = url.pathname;
      const visitorRoot = (env.VISITOR_ROOT_DOMAIN || 'vx9qn7zr.org').toLowerCase();
      const isLocalHost = isLocalDevHost(host) || isLocalDevHost(requestHost);
      const isSetupApiPath = pathname.startsWith('/api/setup/');
      const isBackendHost = host === BACKEND_HOST;

      if (isSetupApiPath && !isBackendHost && !isLocalHost) return empty(404);

      if (host === visitorRoot) return empty(404);

      const isVisitorSubdomain = host.endsWith('.' + visitorRoot);
      let visitorToken: string | null = null;

      if (isVisitorSubdomain) {
        const subdomain = host.slice(0, -(visitorRoot.length + 1));
        if (subdomain.includes('.') || !HEX_INVITE_TOKEN.test(subdomain)) return empty(404);
        visitorToken = subdomain;
        const inviteStatus = await validateInviteHost(env, visitorToken);
        if (inviteStatus !== 200) return empty(inviteStatus);
      }

      if (!isBackendHost && !visitorToken && !(isSetupApiPath && isLocalHost)) return empty(404);

      if (pathname === '/ws') {
        return isBackendHost ? new Response('Forbidden', { status: 403, headers: noStoreHeaders }) : empty(404);
      }

      if (pathname.startsWith('/api/')) {
        if (visitorToken && /^\/api\/(auth|admin|operator)(\/|$)/.test(pathname)) return empty(404);
        return withNoStore(await api(req, env));
      }

      if (isBackendHost || visitorToken) {
        const assetsResp = await env.ASSETS.fetch(req);
        return withNoStore(assetsResp);
      }

      return empty(404);
    } catch (error) {
      if (error instanceof Response) return withNoStore(error);
      console.error(error);
      return json({ error: 'Internal error' }, { status: 500 });
    }
  },
};
