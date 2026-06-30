export { ChatRoom } from './durable-objects/ChatRoom';
export interface Env {
  DB: D1Database;
  UPLOADS: R2Bucket;
  CHAT_ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
  SESSION_SECRET: string;
  SUPER_ADMIN_USERNAME?: string;
  SUPER_ADMIN_PASSWORD?: string;
  VISITOR_ROOT_DOMAIN?: string;
}

type Admin = { id: string; username: string; role: 'SUPER_ADMIN' | 'OPERATOR'; is_disabled?: number; must_change_password?: number; last_seen_at?: string };
type VisitorAccount = { id: string; username: string; display_name: string; last_login_at: string };
const ADMIN_COOKIE = 'support_admin';
const VISITOR_COOKIE = 'visitor_account';
const GUEST_COOKIE = 'guest_session';
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
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
const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(init.headers || {}) } });
const getCookie = (req: Request, name: string) => (req.headers.get('cookie') || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`))?.slice(name.length + 1);
const setCookie = (name: string, value: string) => `${name}=${value}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax; Secure`;
const clearCookie = (name: string) => `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`;
async function readJson(req: Request) { return await req.json().catch(() => ({} as any)); }
function b64(bytes: Uint8Array) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }
function unb64(value: string) { const bin = atob(value); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
async function hmac(secret: string, value: string) { const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); const sig = await crypto.subtle.sign('HMAC', key, enc.encode(value)); return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join(''); }
async function makeToken(env: Env, value: string) { return `${value}.${await hmac(env.SESSION_SECRET, value)}`; }
async function verifyToken(env: Env, token?: string) { if (!token) return null; const [value, sig] = token.split('.'); return value && sig === await hmac(env.SESSION_SECRET, value) ? value : null; }
async function tokenHash(env: Env, value: string) { return await hmac(env.SESSION_SECRET, 'session:' + value); }
function expiresAt(days = 1) { return new Date(Date.now() + days * 86400000).toISOString(); }
async function createAdminSession(env: Env, adminId: string) { const id = rid('asess'); await env.DB.prepare('INSERT INTO admin_sessions(id,admin_id,token_hash,created_at,expires_at) VALUES(?,?,?,?,?)').bind(id, adminId, await tokenHash(env, id), now(), expiresAt()).run(); return await makeToken(env, id); }
async function createVisitorSession(env: Env, accountId: string, visitorKey?: string) { const id = rid('vsess'); await env.DB.prepare('INSERT INTO visitor_sessions(id,visitor_account_id,visitor_key,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(id, accountId, visitorKey || null, await tokenHash(env, id), now(), expiresAt()).run(); return await makeToken(env, id); }
async function hashPassword(password: string) { const salt = crypto.getRandomValues(new Uint8Array(16)); const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']); const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256); return `pbkdf2:100000:${b64(salt)}:${b64(new Uint8Array(bits))}`; }
async function verifyPassword(password: string, stored: string) { if (!stored?.startsWith('pbkdf2:')) return false; const [, iterRaw, saltRaw, hashRaw] = stored.split(':'); const salt = unb64(saltRaw); const expected = unb64(hashRaw); const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']); const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: Number(iterRaw), hash: 'SHA-256' }, key, expected.length * 8); const actual = new Uint8Array(bits); let diff = actual.length ^ expected.length; for (let i = 0; i < Math.min(actual.length, expected.length); i++) diff |= actual[i] ^ expected[i]; return diff === 0; }
async function ensureBootstrap(env: Env) { const row = await env.DB.prepare("SELECT id FROM admins WHERE role='SUPER_ADMIN' LIMIT 1").first(); if (row) return; const username = env.SUPER_ADMIN_USERNAME?.trim(); const password = env.SUPER_ADMIN_PASSWORD; if (!username || !password) return; const t = now(); await env.DB.prepare('INSERT INTO admins(id,username,display_name,password_hash,role,must_change_password,is_disabled,created_at,updated_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(rid('admin'), username, username, await hashPassword(password), 'SUPER_ADMIN', 0, 0, t, t, t).run(); }
async function currentAdmin(env: Env, req: Request, raw = false) { const sessionId = await verifyToken(env, getCookie(req, ADMIN_COOKIE)); if (!sessionId) return null; const session = await env.DB.prepare('SELECT admin_id FROM admin_sessions WHERE id=? AND token_hash=? AND revoked_at IS NULL AND expires_at>?').bind(sessionId, await tokenHash(env, sessionId), now()).first<any>(); if (!session) return null; const admin = await env.DB.prepare('SELECT id,username,role,must_change_password,is_disabled,last_seen_at FROM admins WHERE id=?').bind(session.admin_id).first<Admin>(); if (!admin || (!raw && admin.is_disabled)) return null; if (!raw) await env.DB.prepare('UPDATE admins SET last_seen_at=? WHERE id=? AND is_disabled=0').bind(now(), admin.id).run(); return admin; }
async function requireAdmin(env: Env, req: Request) { const admin = await currentAdmin(env, req); if (!admin) throw new Response('Unauthorized', { status: 401 }); return admin; }
async function requireSuper(env: Env, req: Request) { const admin = await requireAdmin(env, req); if (admin.role !== 'SUPER_ADMIN') throw new Response('Forbidden', { status: 403 }); return admin; }
async function currentVisitorAccount(env: Env, req: Request) { const sessionId = await verifyToken(env, getCookie(req, VISITOR_COOKIE)); if (!sessionId) return null; const session = await env.DB.prepare('SELECT visitor_account_id FROM visitor_sessions WHERE id=? AND token_hash=? AND revoked_at IS NULL AND expires_at>?').bind(sessionId, await tokenHash(env, sessionId), now()).first<any>(); return session?.visitor_account_id ? await env.DB.prepare('SELECT id,username,display_name,last_login_at FROM visitor_accounts WHERE id=?').bind(session.visitor_account_id).first<VisitorAccount>() : null; }
async function inviteTokenHash(env: Env, value: string) { return await hmac(env.SESSION_SECRET, 'invite:' + value); }
function randomToken(bytes = 20) { const data = crypto.getRandomValues(new Uint8Array(bytes)); return [...data].map((b) => b.toString(16).padStart(2, '0')).join(''); }
const invalidInvite = () => json({ error: ERR_INVALID_INVITE }, { status: 410 });
async function createGuestSessionRecord(env: Env, visitorKey: string) {
  const id = rid('gsess');
  await env.DB.prepare('INSERT INTO visitor_sessions(id,visitor_account_id,visitor_key,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(id, null, visitorKey, await tokenHash(env, id), now(), expiresAt()).run();
  return { id, token: await makeToken(env, id) };
}
async function createGuestSession(env: Env, visitorKey: string) { return (await createGuestSessionRecord(env, visitorKey)).token; }
async function currentGuestSession(env: Env, req: Request) { const sessionId = await verifyToken(env, getCookie(req, GUEST_COOKIE)); if (!sessionId) return null; const row = await env.DB.prepare('SELECT visitor_key FROM visitor_sessions WHERE id=? AND token_hash=? AND revoked_at IS NULL AND expires_at>? AND visitor_key IS NOT NULL').bind(sessionId, await tokenHash(env, sessionId), now()).first<any>(); if (!row?.visitor_key) return null; const user = await env.DB.prepare('SELECT * FROM users WHERE visitor_key=?').bind(row.visitor_key).first<any>(); if (!user) return null; const session = await latestSession(env, user.id); if (sessionEnded(session)) return null; return { visitorKey: row.visitor_key as string, user, session }; }
function canAccessSession(admin: Admin | null, session: any) { return Boolean(admin && session && (admin.role === 'SUPER_ADMIN' || session.assigned_operator_id === admin.id)); }
function sessionEnded(session: any) { return Boolean(!session || session.deleted_at || session.status === 'CLOSED' || session.status === 'ARCHIVED'); }
function canSendMessage(admin: Admin | null, session: any) { return canAccessSession(admin, session) && !sessionEnded(session); }
function canUploadAttachment(admin: Admin | null, session: any) { return canSendMessage(admin, session); }
function canManageSession(admin: Admin | null, session: any) { return canAccessSession(admin, session); }
function canJoinConversationRoom(admin: Admin | null, session: any) { return canAccessSession(admin, session); }
async function getSessionById(env: Env, sessionId: string) { return sessionId ? await env.DB.prepare('SELECT * FROM sessions WHERE id=?').bind(sessionId).first<any>() : null; }
async function guestOwnsSession(env: Env, req: Request, session: any) { const guest = await currentGuestSession(env, req); return Boolean(guest && session && guest.session.id === session.id && guest.user.id === session.user_id); }
async function guestPayload(env: Env, guest: any, init: ResponseInit = {}) { await env.DB.prepare("UPDATE messages SET is_read=1,status=CASE WHEN status='sent' THEN 'read' ELSE status END,read_at=COALESCE(read_at,?) WHERE session_id=? AND sender_type='OPERATOR' AND status!='recalled'").bind(now(), guest.session.id).run(); return json({ visitorId: guest.visitorKey, account: null, user: guest.user, session: guest.session, messages: await getMessages(env, guest.session.id) }, init); }
async function createInviteLink(req: Request, env: Env) { const admin = await requireAdmin(env, req); const b: any = await readJson(req); let sourceOperatorId: string | null = admin.role === 'OPERATOR' ? admin.id : null; if (admin.role === 'SUPER_ADMIN' && b.sourceOperatorId) { const op = await env.DB.prepare("SELECT id FROM admins WHERE id=? AND role='OPERATOR' AND is_disabled=0").bind(String(b.sourceOperatorId)).first<any>(); if (!op) return json({ error: ERR_OPERATOR_NOT_FOUND }, { status: 400 }); sourceOperatorId = op.id; } const token = randomToken(); const t = now(); const exp = new Date(Date.now() + INVITE_TTL_MS).toISOString(); const id = rid('inv'); await env.DB.prepare('INSERT INTO invite_links(id,token_hash,source_operator_id,created_by_admin_id,expires_at,created_at) VALUES(?,?,?,?,?,?)').bind(id, await inviteTokenHash(env, token), sourceOperatorId, admin.id, exp, t).run(); return json({ invite: { id, token, url: `/g/${token}`, expires_at: exp, source_operator_id: sourceOperatorId } }); }
async function consumeInvite(req: Request, env: Env, token: string) {
  const guest = await currentGuestSession(env, req);
  const tokenHash = await inviteTokenHash(env, token);
  const invite = await env.DB.prepare('SELECT * FROM invite_links WHERE token_hash=?').bind(tokenHash).first<any>();
  const t = now();
  if (!invite || invite.revoked_at || invite.expires_at <= t) return invalidInvite();
  if (invite.consumed_at) {
    if (guest && invite.consumed_session_id === guest.session.id) return guestPayload(env, guest);
    return invalidInvite();
  }
  const sid = rid('sess');
  const claimed: any = await env.DB.prepare('UPDATE invite_links SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>?').bind(t, tokenHash, t).run();
  if (typeof claimed?.meta?.changes !== 'number' || claimed.meta.changes < 1) return invalidInvite();

  let guestSessionId: string | null = null;
  try {
    const visitorKey = rid('visitor');
    const { user } = await upsertVisitor(env, visitorKey, null);
    const source = invite.source_operator_id || null;
    const status = source ? 'OPEN' : 'PENDING';
    await env.DB.prepare('INSERT INTO sessions(id,user_id,source_user_id,assigned_operator_id,last_operator_id,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(sid, user.id, source, source, source, status, t, t).run();
    const session = await env.DB.prepare('SELECT * FROM sessions WHERE id=?').bind(sid).first<any>();
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
async function rateLimit(env: Env, req: Request) { const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || 'unknown'; const key = `${ip}:${new URL(req.url).pathname}`.slice(0, 240); const reset = Math.floor(Date.now() / 60000) * 60000 + 60000; const row = await env.DB.prepare('SELECT count,reset_at FROM rate_limits WHERE key=?').bind(key).first<{ count: number; reset_at: number }>(); if (!row || row.reset_at < Date.now()) { await env.DB.prepare('INSERT OR REPLACE INTO rate_limits(key,count,reset_at) VALUES(?,?,?)').bind(key, 1, reset).run(); return null; } if (row.count > 120) return json({ error: 'rate_limited' }, { status: 429 }); await env.DB.prepare('UPDATE rate_limits SET count=count+1 WHERE key=?').bind(key).run(); return null; }
async function upsertVisitor(env: Env, visitorId?: string, account?: VisitorAccount | null) { const key = account ? `acct_${account.id}` : (visitorId?.startsWith('visitor_') ? visitorId : rid('visitor')); const displayName = account?.display_name || `璁垮 ${key.slice(-6)}`; const t = now(); let user = await env.DB.prepare('SELECT * FROM users WHERE visitor_key=?').bind(key).first<any>(); if (!user) { const uid = rid('user'); await env.DB.prepare('INSERT INTO users(id,visitor_key,account_id,display_name,last_seen_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(uid, key, account?.id || null, displayName, t, t, t).run(); user = await env.DB.prepare('SELECT * FROM users WHERE id=?').bind(uid).first<any>(); } else await env.DB.prepare('UPDATE users SET account_id=COALESCE(?,account_id),display_name=?,last_seen_at=?,updated_at=? WHERE id=?').bind(account?.id || null, displayName, t, t, user.id).run(); return { key, user }; }
async function latestSession(env: Env, userId: string) { return await env.DB.prepare("SELECT * FROM sessions WHERE user_id=? AND status!='ARCHIVED' AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1").bind(userId).first<any>(); }
async function getOrCreateSession(env: Env, userId: string) { let session = await latestSession(env, userId); if (!session || session.status === 'CLOSED') { const t = now(); const sid = rid('sess'); await env.DB.prepare('INSERT INTO sessions(id,user_id,status,created_at,updated_at,last_operator_id) VALUES(?,?,?,?,?,NULL)').bind(sid, userId, 'PENDING', t, t).run(); session = await env.DB.prepare('SELECT * FROM sessions WHERE id=?').bind(sid).first<any>(); } return session; }
async function getMessages(env: Env, sessionId: string, after?: string | null) { const q = after ? env.DB.prepare('SELECT * FROM messages WHERE session_id=? AND created_at>? ORDER BY created_at').bind(sessionId, after) : env.DB.prepare('SELECT * FROM messages WHERE session_id=? ORDER BY created_at').bind(sessionId); return (await q.all<any>()).results || []; }
async function visitorOwnsSession(env: Env, req: Request, session: any) { return guestOwnsSession(env, req, session); }
function attachmentKeyFromPath(path?: string | null) { const prefix = '/api/attachments/'; return path?.startsWith(prefix) ? decodeURIComponent(path.slice(prefix.length)) : ''; }
async function broadcast(env: Env, room: string, payload: unknown) {
  if (!env.CHAT_ROOM) throw new Error('CHAT_ROOM Durable Object binding is missing. Check wrangler.toml and deployment config.');
  await env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(room)).fetch('https://room/broadcast', { method: 'POST', body: JSON.stringify(payload) });
}
const notifyAdmins = (env: Env) => broadcast(env, 'admin-feed', { type: 'sessions:changed', ts: Date.now() });
async function listSessions(env: Env, admin: Admin, includeDeleted: boolean) { const where = includeDeleted ? 'WHERE EXISTS (SELECT 1 FROM messages mx WHERE mx.session_id=s.id)' : 'WHERE s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM messages mx WHERE mx.session_id=s.id)'; const scoped = admin.role === 'SUPER_ADMIN' ? '' : ' AND s.assigned_operator_id=?'; const sql = `SELECT s.*,u.visitor_key,u.display_name,a.username operator_name,(SELECT COUNT(*) FROM messages m WHERE m.session_id=s.id AND m.sender_type='VISITOR' AND m.is_read=0) unread_count FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN admins a ON a.id=s.assigned_operator_id ${where}${scoped} ORDER BY COALESCE(s.deleted_at,s.updated_at) DESC`; const stmt = env.DB.prepare(sql); return (admin.role === 'SUPER_ADMIN' ? (await stmt.all<any>()).results : (await stmt.bind(admin.id).all<any>()).results) || []; }
async function visitorLogin(req: Request, env: Env, username: string, password: string) { const account = await env.DB.prepare('SELECT * FROM visitor_accounts WHERE username=?').bind(username).first<any>(); if (!account || !(await verifyPassword(password, account.password_hash))) return json({ error: 'Invalid credentials' }, { status: 401 }); const t = now(); await env.DB.prepare('UPDATE visitor_accounts SET last_login_at=?,updated_at=? WHERE id=?').bind(t, t, account.id).run(); const safe = { id: account.id, username: account.username, display_name: account.display_name, last_login_at: t }; return json({ type: 'user', account: safe }, { headers: { 'Set-Cookie': setCookie(VISITOR_COOKIE, await createVisitorSession(env, account.id)) } }); }
async function createMessage(req: Request, env: Env) { const b: any = await readJson(req); const admin = await currentAdmin(env, req); const senderType = ((b.senderType || (admin ? 'OPERATOR' : 'VISITOR')) === 'OPERATOR' ? 'OPERATOR' : 'VISITOR') as 'VISITOR' | 'OPERATOR'; let senderId = ''; let sessionId = String(b.sessionId || ''); let session: any = null; if (senderType === 'OPERATOR') { if (!admin) return json({ error: ERR_LOGIN_REQUIRED }, { status: 401 }); session = await getSessionById(env, sessionId); if (!session) return json({ error: ERR_SESSION_NOT_FOUND }, { status: 404 }); if (!canAccessSession(admin, session)) return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 }); if (!canSendMessage(admin, session)) return json({ error: ERR_SESSION_ENDED }, { status: 400 }); senderId = admin.id; } else { const guest = await currentGuestSession(env, req); if (!guest) return invalidInvite(); sessionId = sessionId || guest.session.id; session = await getSessionById(env, sessionId); if (!session || guest.session.id !== session.id || guest.user.id !== session.user_id) return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 }); if (sessionEnded(session)) return json({ error: ERR_SESSION_ENDED }, { status: 400 }); senderId = guest.visitorKey; } const rawClientId = typeof b.clientMessageId === 'string' ? b.clientMessageId.trim() : ''; const clientMessageId = rawClientId ? rawClientId.slice(0, 120) : `server:${rid('cmid')}`; const existing = await env.DB.prepare('SELECT * FROM messages WHERE session_id=? AND sender_type=? AND sender_id=? AND client_message_id=?').bind(sessionId, senderType, senderId, clientMessageId).first<any>(); if (existing) return json({ message: existing, session, deduped: true }); const t = now(); const msg = { id: rid('msg'), session_id: sessionId, sender_type: senderType, sender_id: senderId, content: String(b.content || ''), message_type: b.messageType === 'image' ? 'image' : 'text', image_path: b.imagePath || null, status: 'sent', created_at: t, read_at: null, is_read: 0, quote_message_id: b.quoteMessageId || null, recalled_at: null, image_purged_at: null, client_message_id: clientMessageId }; try { await env.DB.prepare('INSERT INTO messages(id,session_id,sender_type,sender_id,content,message_type,image_path,status,created_at,read_at,is_read,quote_message_id,recalled_at,image_purged_at,client_message_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(msg.id, msg.session_id, msg.sender_type, msg.sender_id, msg.content, msg.message_type, msg.image_path, msg.status, msg.created_at, msg.read_at, msg.is_read, msg.quote_message_id, msg.recalled_at, msg.image_purged_at, msg.client_message_id).run(); } catch (e) { const row = await env.DB.prepare('SELECT * FROM messages WHERE session_id=? AND sender_type=? AND sender_id=? AND client_message_id=?').bind(sessionId, senderType, senderId, clientMessageId).first<any>(); if (row) return json({ message: row, session, deduped: true }); throw e; } const attachmentKey = msg.message_type === 'image' ? attachmentKeyFromPath(msg.image_path) : ''; if (attachmentKey) await env.DB.prepare('UPDATE attachments SET message_id=? WHERE conversation_id=? AND object_key=? AND created_by_type=? AND created_by_id=? AND message_id IS NULL').bind(msg.id, sessionId, attachmentKey, senderType, senderId).run(); await env.DB.prepare('UPDATE sessions SET updated_at=? WHERE id=?').bind(t, sessionId).run(); session = await env.DB.prepare('SELECT * FROM sessions WHERE id=?').bind(sessionId).first<any>(); await broadcast(env, `conversation:${sessionId}`, { type: 'message:new', conversationId: sessionId, message: msg, session }); await notifyAdmins(env); return json({ message: msg, session }); }
async function sessionAction(req: Request, env: Env, sessionId: string, action: string) { const admin = await requireAdmin(env, req); const sessionBefore = await getSessionById(env, sessionId); if (!sessionBefore) return json({ error: ERR_SESSION_NOT_FOUND }, { status: 404 }); if (!canManageSession(admin, sessionBefore)) return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 }); const t = now(); if (action === 'assign') { if (sessionEnded(sessionBefore)) return json({ error: ERR_SESSION_ENDED }, { status: 400 }); await env.DB.prepare("UPDATE sessions SET assigned_operator_id=?,last_operator_id=?,status='OPEN',updated_at=? WHERE id=? AND deleted_at IS NULL").bind(admin.id, admin.id, t, sessionId).run(); } if (action === 'close') await env.DB.prepare("UPDATE sessions SET status='CLOSED',updated_at=? WHERE id=? AND deleted_at IS NULL").bind(t, sessionId).run(); if (action === 'delete') await env.DB.prepare('UPDATE sessions SET deleted_at=?,deleted_by=?,updated_at=? WHERE id=? AND deleted_at IS NULL').bind(t, admin.id, t, sessionId).run(); if (action === 'restore') await env.DB.prepare('UPDATE sessions SET deleted_at=NULL,deleted_by=NULL,updated_at=? WHERE id=?').bind(t, sessionId).run(); const session = await env.DB.prepare('SELECT * FROM sessions WHERE id=?').bind(sessionId).first<any>(); await broadcast(env, `conversation:${sessionId}`, { type: 'session:updated', conversationId: sessionId, session }); await notifyAdmins(env); return json({ ok: true }); }
async function bindGuest(env: Env, visitorKey: string, account: VisitorAccount) { if (!visitorKey.startsWith('visitor_')) return; const accountKey = `acct_${account.id}`; const t = now(); const accountUser = await env.DB.prepare('SELECT id FROM users WHERE visitor_key=?').bind(accountKey).first<any>(); const guestUser = await env.DB.prepare('SELECT id FROM users WHERE visitor_key=?').bind(visitorKey).first<any>(); if (!guestUser) return; if (accountUser) { await env.DB.prepare('UPDATE sessions SET user_id=?,updated_at=? WHERE user_id=?').bind(accountUser.id, t, guestUser.id).run(); await env.DB.prepare('DELETE FROM users WHERE id=?').bind(guestUser.id).run(); } else await env.DB.prepare('UPDATE users SET visitor_key=?,account_id=?,display_name=?,updated_at=? WHERE id=?').bind(accountKey, account.id, account.display_name, t, guestUser.id).run(); }
async function upload(req: Request, env: Env) { const url = new URL(req.url); const sessionId = String(url.searchParams.get('sessionId') || ''); if (!sessionId) return json({ error: ERR_MISSING_SESSION }, { status: 400 }); const session = await getSessionById(env, sessionId); if (!session) return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 }); const admin = await currentAdmin(env, req); let createdByType: 'VISITOR' | 'OPERATOR' = 'VISITOR'; let createdById = ''; if (admin) { if (!canAccessSession(admin, session)) return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 }); if (!canUploadAttachment(admin, session)) return json({ error: ERR_SESSION_ENDED }, { status: 400 }); createdByType = 'OPERATOR'; createdById = admin.id; } else { const guest = await currentGuestSession(env, req); if (!guest || guest.session.id !== session.id || guest.user.id !== session.user_id) return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 }); if (sessionEnded(session)) return json({ error: ERR_SESSION_ENDED }, { status: 400 }); createdById = guest.visitorKey; } const form = await req.formData(); const file = form.get('file'); if (!(file instanceof File)) return json({ error: ERR_PICK_IMAGE }, { status: 400 }); const allowed: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }; if (!allowed[file.type]) return json({ error: ERR_IMAGE_TYPE }, { status: 400 }); if (file.size > 5 * 1024 * 1024) return json({ error: ERR_IMAGE_SIZE }, { status: 413 }); const key = `${crypto.randomUUID()}.${allowed[file.type]}`; await env.UPLOADS.put(key, file.stream(), { httpMetadata: { contentType: file.type } }); const t = now(); await env.DB.prepare('INSERT INTO attachments(id,message_id,conversation_id,object_key,file_name,mime_type,byte_size,created_at,created_by_type,created_by_id,expires_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL)').bind(rid('att'), null, session.id, key, null, file.type, file.size, t, createdByType, createdById, expiresAt(7)).run(); return json({ path: `/api/attachments/${key}` }); }
async function api(req: Request, env: Env) {
  await ensureBootstrap(env);
  const url = new URL(req.url);
  const path = url.pathname;
  if (req.method !== 'GET' && !path.startsWith('/api/ws')) { const limited = await rateLimit(env, req); if (limited) return limited; }
  if (path === '/api/auth/me') { const admin = await currentAdmin(env, req, true); if (admin?.is_disabled) return json({ admin: null, disabled: true }, { status: 403, headers: { 'Set-Cookie': clearCookie(ADMIN_COOKIE) } }); return json({ admin }); }
  if ((path === '/api/auth/logout' || path === '/api/account/logout') && req.method === 'POST') return json({ ok: true }, { headers: { 'Set-Cookie': clearCookie(path.includes('account') ? VISITOR_COOKIE : ADMIN_COOKIE) } });
  if ((path === '/api/auth/login' || path === '/api/login') && req.method === 'POST') { const b: any = await readJson(req); const name = String(b.username || '').trim(); const pass = String(b.password || ''); const admin = await env.DB.prepare('SELECT * FROM admins WHERE username=?').bind(name).first<any>(); if (admin) { if (admin.is_disabled) return json({ error: 'Disabled', disabled: true }, { status: 403 }); if (!(await verifyPassword(pass, admin.password_hash))) return json({ error: 'Invalid credentials' }, { status: 401 }); return json({ type: 'admin', admin: { id: admin.id, username: admin.username, role: admin.role, must_change_password: admin.must_change_password } }, { headers: { 'Set-Cookie': setCookie(ADMIN_COOKIE, await createAdminSession(env, admin.id)) } }); } return path === '/api/login' ? visitorLogin(req, env, name, pass) : json({ error: 'Invalid credentials' }, { status: 401 }); }
  if (path === '/api/account/login' && req.method === 'POST') { const b: any = await readJson(req); return visitorLogin(req, env, String(b.username || '').trim(), String(b.password || '')); }
  if (path === '/api/account/register' && req.method === 'POST') { const b: any = await readJson(req); const username = String(b.username || '').trim(); const password = String(b.password || ''); const display = String(b.displayName || username).trim(); if (username.length < 3) return json({ error: ERR_USERNAME_SHORT }, { status: 400 }); if (password.length < 8) return json({ error: ERR_PASSWORD_SHORT }, { status: 400 }); const t = now(); const accountId = rid('acct'); try { await env.DB.prepare('INSERT INTO visitor_accounts(id,username,password_hash,display_name,last_login_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(accountId, username, await hashPassword(password), display, t, t, t).run(); } catch { return json({ error: ERR_ACCOUNT_EXISTS }, { status: 409 }); } const account = { id: accountId, username, display_name: display, last_login_at: t }; if (b.claimGuest && b.visitorId) await bindGuest(env, String(b.visitorId), account); if (b.discardGuest && b.visitorId) await env.DB.prepare('DELETE FROM users WHERE visitor_key=?').bind(String(b.visitorId)).run(); return json({ type: 'user', account }, { headers: { 'Set-Cookie': setCookie(VISITOR_COOKIE, await createVisitorSession(env, accountId, String(b.visitorId || ''))) } }); }
  if (path === '/api/account/me') return json({ account: await currentVisitorAccount(env, req) });
  if (path === '/api/invites' && req.method === 'POST') return createInviteLink(req, env);
  const guestRoute = path.match(/^\/api\/guest\/([^/]+)$/);
  if (guestRoute && req.method === 'POST') return consumeInvite(req, env, decodeURIComponent(guestRoute[1]));
  if (path === '/api/visitor' && req.method === 'POST') { const guest = await currentGuestSession(env, req); if (!guest) return invalidInvite(); return guestPayload(env, guest); }
  if (path === '/api/messages' && req.method === 'POST') return createMessage(req, env);
  if (path === '/api/sessions' && req.method === 'GET') { const admin = await requireAdmin(env, req); return json({ sessions: await listSessions(env, admin, url.searchParams.get('includeDeleted') === '1') }); }
  const sm = path.match(/^\/api\/sessions\/([^/]+)\/messages$/);
  if (sm) { const session = await getSessionById(env, sm[1]); if (!session || session.deleted_at) return json({ messages: [] }); const admin = await currentAdmin(env, req); if (admin) { if (!canAccessSession(admin, session)) return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 }); await env.DB.prepare("UPDATE messages SET is_read=1,status='read',read_at=COALESCE(read_at,?) WHERE session_id=? AND sender_type='VISITOR'").bind(now(), session.id).run(); } else if (!(await guestOwnsSession(env, req, session))) return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 }); return json({ messages: await getMessages(env, session.id, url.searchParams.get('after')) }); }
  const sa = path.match(/^\/api\/sessions\/([^/]+)\/(assign|close|delete|restore)$/);
  if (sa && req.method === 'POST') return sessionAction(req, env, sa[1], sa[2]);
  const rec = path.match(/^\/api\/messages\/([^/]+)\/recall$/);
  if (rec && req.method === 'POST') { const msg = await env.DB.prepare('SELECT * FROM messages WHERE id=?').bind(rec[1]).first<any>(); if (!msg) return json({ error: ERR_MESSAGE_NOT_FOUND }, { status: 404 }); const session = await getSessionById(env, msg.session_id); if (!session) return json({ error: ERR_SESSION_NOT_FOUND }, { status: 404 }); let authorized = false; const admin = await currentAdmin(env, req); if (admin) authorized = canAccessSession(admin, session) && msg.sender_type === 'OPERATOR' && msg.sender_id === admin.id; else if (await guestOwnsSession(env, req, session)) authorized = msg.sender_type === 'VISITOR'; if (!authorized) return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 }); if (sessionEnded(session)) return json({ error: ERR_SESSION_ENDED }, { status: 400 }); const t = now(); await env.DB.prepare("UPDATE messages SET status='recalled',content='',image_path=NULL,recalled_at=? WHERE id=?").bind(t, rec[1]).run(); const row = await env.DB.prepare('SELECT * FROM messages WHERE id=?').bind(rec[1]).first<any>(); if (row) await broadcast(env, `conversation:${row.session_id}`, { type: 'message:updated', conversationId: row.session_id, message: row }); return json({ ok: true }); }
  const del = path.match(/^\/api\/messages\/([^/]+)\/delete$/);
  if (del && req.method === 'POST') { const msg = await env.DB.prepare('SELECT * FROM messages WHERE id=?').bind(del[1]).first<any>(); if (!msg) return json({ error: ERR_MESSAGE_NOT_FOUND }, { status: 404 }); const session = await getSessionById(env, msg.session_id); if (!session) return json({ error: ERR_SESSION_NOT_FOUND }, { status: 404 }); let authorized = false; const admin = await currentAdmin(env, req); if (admin) authorized = canAccessSession(admin, session) && msg.sender_type === 'OPERATOR' && msg.sender_id === admin.id; else if (await guestOwnsSession(env, req, session)) authorized = msg.sender_type === 'VISITOR'; if (!authorized) return json({ error: ERR_NO_SESSION_ACCESS }, { status: 403 }); const t = now(); await env.DB.prepare('UPDATE messages SET deleted_at=? WHERE id=?').bind(t, del[1]).run(); await broadcast(env, `conversation:${msg.session_id}`, { type: 'message:deleted', conversationId: msg.session_id, messageId: del[1] }); return json({ ok: true }); }
  if (path === '/api/messages/purge-images' && req.method === 'POST') { const admin = await requireAdmin(env, req); await env.DB.prepare("UPDATE messages SET image_path=NULL,image_purged_at=?,content='' WHERE sender_id=? AND message_type='image'").bind(now(), admin.id).run(); await notifyAdmins(env); return json({ ok: true }); }
  if (path === '/api/admins' && req.method === 'GET') { await requireSuper(env, req); return json({ admins: (await env.DB.prepare('SELECT id,username,role,must_change_password,created_at,is_disabled,disabled_at,last_seen_at FROM admins ORDER BY role DESC, created_at').all()).results || [] }); }
  if (path === '/api/admins' && req.method === 'POST') { await requireSuper(env, req); const b: any = await readJson(req); const username = String(b.username || '').trim(); const password = String(b.password || ''); const t = now(); await env.DB.prepare("INSERT INTO admins(id,username,display_name,password_hash,role,must_change_password,is_disabled,created_at,updated_at,last_seen_at) VALUES(?,?,?,?, 'OPERATOR',0,0,?,?,NULL)").bind(rid('admin'), username, username, await hashPassword(password), t, t).run(); return json({ ok: true }); }
  if (path === '/api/admins/operators' && req.method === 'GET') { await requireSuper(env, req); const rows = (await env.DB.prepare("SELECT id,username,role,created_at,is_disabled,disabled_at,last_seen_at FROM admins WHERE role='OPERATOR' ORDER BY is_disabled, username").all<any>()).results || []; return json({ operators: rows.map(r => ({ ...r, online: Boolean(r.last_seen_at && Date.now() - Date.parse(r.last_seen_at) < 120000 && !r.is_disabled) })) }); }
  if (path === '/api/admins/operators' && req.method === 'DELETE') { const admin = await requireSuper(env, req); const b: any = await readJson(req); const opId = String(b.id || ''); const t = now(); if (b.hard) await env.DB.prepare("DELETE FROM admins WHERE id=? AND role='OPERATOR' AND is_disabled=1").bind(opId).run(); else { await env.DB.prepare("UPDATE admins SET is_disabled=1,disabled_at=?,updated_at=? WHERE id=? AND role='OPERATOR'").bind(t, t, opId).run(); await env.DB.prepare('UPDATE sessions SET deleted_at=?,deleted_by=?,assigned_operator_id=NULL,updated_at=? WHERE deleted_at IS NULL AND (assigned_operator_id=? OR last_operator_id=?)').bind(t, admin.id, t, opId, opId).run(); } await notifyAdmins(env); return json({ ok: true }); }
  if (path === '/api/admins/profile' && req.method === 'PATCH') { const admin = await requireSuper(env, req); const b: any = await readJson(req); const username = String(b.username || '').trim(); const password = String(b.password || ''); const t = now(); if (username) await env.DB.prepare('UPDATE admins SET username=?,display_name=?,updated_at=? WHERE id=?').bind(username, username, t, admin.id).run(); if (password) await env.DB.prepare('UPDATE admins SET password_hash=?,must_change_password=0,updated_at=? WHERE id=?').bind(await hashPassword(password), t, admin.id).run(); return json({ ok: true }); }
  if (path === '/api/staff-chat' && req.method === 'GET') { await requireAdmin(env, req); const rows = (await env.DB.prepare('SELECT sm.*,a.username sender_name FROM staff_messages sm JOIN admins a ON a.id=sm.sender_admin_id ORDER BY sm.created_at DESC LIMIT 80').all<any>()).results || []; return json({ messages: rows.reverse() }); }
  if (path === '/api/staff-chat' && req.method === 'POST') { const admin = await requireAdmin(env, req); const b: any = await readJson(req); const content = String(b.content || '').trim(); const msg = { id: rid('staffmsg'), sender_admin_id: admin.id, sender_name: admin.username, content, created_at: now() }; await env.DB.prepare('INSERT INTO staff_messages(id,sender_admin_id,content,created_at) VALUES(?,?,?,?)').bind(msg.id, admin.id, content, msg.created_at).run(); await broadcast(env, 'staff', { type: 'staff:new', message: msg }); return json({ message: msg }); }
  if (path === '/api/upload' && req.method === 'POST') return upload(req, env);
  const att = path.match(/^\/api\/attachments\/(.+)$/);
  if (att) { const obj = await env.UPLOADS.get(att[1]); return obj ? new Response(obj.body, { headers: { 'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' } }) : new Response('Not found', { status: 404 }); }
  if (path === '/api/ws/admin') { await requireAdmin(env, req); return env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName('admin-feed')).fetch(req); }
  if (path === '/api/ws/staff') { await requireAdmin(env, req); return env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName('staff')).fetch(req); }
  const ws = path.match(/^\/api\/ws\/conversations\/([^/]+)$/);
  if (ws) { const session = await getSessionById(env, ws[1]); if (!session) return new Response('Not found', { status: 404 }); const admin = await currentAdmin(env, req); if (admin) { if (!canJoinConversationRoom(admin, session)) return new Response(ERR_NO_SESSION_ACCESS, { status: 403 }); } else if (!(await guestOwnsSession(env, req, session))) return new Response(ERR_NO_SESSION_ACCESS, { status: 403 }); return env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(`conversation:${ws[1]}`)).fetch(req); }
  return json({ error: 'Not found' }, { status: 404 });
}


const BACKEND_HOST = 'denglu.kefuxitong.net';
const HEX_INVITE_TOKEN = /^[a-f0-9]{40}$/;
const noStoreHeaders = { 'cache-control': 'no-store' };
const empty = (status: number) => new Response(null, { status, headers: noStoreHeaders });

function withNoStore(response: Response) {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function validateInviteHost(env: Env, token: string) {
  const tokenHash = await inviteTokenHash(env, token);
  const invite = await env.DB.prepare('SELECT * FROM invite_links WHERE token_hash=?').bind(tokenHash).first<any>();
  if (!invite || invite.revoked_at || invite.expires_at <= now()) return 404;
  if (invite.consumed_at && !invite.consumed_session_id) return 410;
  if (invite.consumed_at && invite.consumed_session_id) {
    const session = await env.DB.prepare('SELECT * FROM sessions WHERE id=?').bind(invite.consumed_session_id).first<any>();
    if (!session || sessionEnded(session)) return 410;
  }
  return 200;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    try {
      const url = new URL(req.url);
      const host = url.hostname.toLowerCase();
      const pathname = url.pathname;
      const visitorRoot = (env.VISITOR_ROOT_DOMAIN || 'vx9qn7zr.org').toLowerCase();

      if (host === visitorRoot) return empty(404);

      const isBackendHost = host === BACKEND_HOST;
      const isVisitorSubdomain = host.endsWith('.' + visitorRoot);
      let visitorToken: string | null = null;

      if (isVisitorSubdomain) {
        const subdomain = host.slice(0, -(visitorRoot.length + 1));
        if (subdomain.includes('.') || !HEX_INVITE_TOKEN.test(subdomain)) return empty(404);
        visitorToken = subdomain;
        const inviteStatus = await validateInviteHost(env, visitorToken);
        if (inviteStatus !== 200) return empty(inviteStatus);
      }

      if (!isBackendHost && !visitorToken) return empty(404);

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
    } catch (e: any) {
      if (e instanceof Response) return withNoStore(e);
      console.error(e);
      return json({ error: 'Internal error' }, { status: 500 });
    }
  },
};
