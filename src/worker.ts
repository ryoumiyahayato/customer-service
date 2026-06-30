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
const DOMAIN = 'vx9qn7zr.org';

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store' },
  });
}

function nullResponse(status: number): Response {
  return new Response(null, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

// --- Guest token helpers ---
function makeToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function b64(buf: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

const enc = new TextEncoder();

async function hmac(secret: string, value: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function isVisitorHost(host: string): boolean {
  // Normalize: strip port if present
  const h = host.includes(':') ? host.split(':')[0] : host;
  // Match exactly DOMAIN or *.DOMAIN
  return h === DOMAIN || h.endsWith('.' + DOMAIN);
}

function isValidHex40(s: string): boolean {
  return /^[0-9a-f]{40}$/i.test(s);
}

function extractInviteId(hostname: string): string | null {
  const h = hostname.includes(':') ? hostname.split(':')[0] : hostname;
  const parts = h.split('.');
  if (parts.length >= 3 && parts[parts.length - 2] + '.' + parts[parts.length - 1] === DOMAIN) {
    const sub = parts.slice(0, -2).join('.');
    if (isValidHex40(sub)) return sub.toLowerCase();
  }
  return null;
}

// ---- Route parsing ----
function matchRoute(path: string, method: string): { handler: string; params: Record<string, string> } | null {
  const u = new URL(path, 'http://x');
  const p = u.pathname;
  const m = method.toUpperCase();

  // Admin API
  if (p === '/api/admin/login' && m === 'POST') return { handler: 'adminLogin', params: {} };
  if (p === '/api/admin/logout' && m === 'POST') return { handler: 'adminLogout', params: {} };
  if (p === '/api/admin/me') return { handler: 'adminMe', params: {} };
  if (p === '/api/admin/password' && m === 'PUT') return { handler: 'adminChangePassword', params: {} };
  if (p === '/api/admin/invites' && m === 'GET') return { handler: 'adminListInvites', params: {} };
  if (p === '/api/admin/invites' && m === 'POST') return { handler: 'adminCreateInvite', params: {} };
  if (p.match(/^\/api\/admin\/invites\/[^/]+$/) && m === 'DELETE') return { handler: 'adminDeleteInvite', params: {} };
  if (p === '/api/admin/operators' && m === 'GET') return { handler: 'adminListOperators', params: {} };
  if (p === '/api/admin/operators' && m === 'POST') return { handler: 'adminCreateOperator', params: {} };
  if (p.match(/^\/api\/admin\/operators\/[^/]+$/) && m === 'PUT') return { handler: 'adminUpdateOperator', params: {} };
  if (p.match(/^\/api\/admin\/operators\/[^/]+$/) && m === 'DELETE') return { handler: 'adminDeleteOperator', params: {} };
  if (p === '/api/admin/sessions' && m === 'GET') return { handler: 'adminListSessions', params: {} };
  if (p.match(/^\/api\/admin\/sessions\/[^/]+\/end$/) && m === 'POST') return { handler: 'adminEndSession', params: {} };
  if (p.match(/^\/api\/admin\/sessions\/[^/]+$/) && m === 'GET') return { handler: 'adminGetSession', params: {} };
  if (p.match(/^\/api\/admin\/sessions\/[^/]+\/messages$/) && m === 'GET') return { handler: 'adminGetMessages', params: {} };
  if (p.match(/^\/api\/admin\/sessions\/[^/]+\/messages$/) && m === 'POST') return { handler: 'adminSendMessage', params: {} };
  if (p.match(/^\/api\/admin\/uploads$/) && m === 'POST') return { handler: 'adminUpload', params: {} };

  // Visitor / guest API
  if (p === '/api/guest/invite' && m === 'POST') return { handler: 'guestResolveInvite', params: {} };
  if (p === '/api/guest/session' && m === 'GET') return { handler: 'guestGetSession', params: {} };
  if (p === '/api/guest/messages' && m === 'GET') return { handler: 'guestGetMessages', params: {} };
  if (p === '/api/guest/messages' && m === 'POST') return { handler: 'guestSendMessage', params: {} };
  if (p === '/api/guest/upload' && m === 'POST') return { handler: 'guestUpload', params: {} };
  if (p === '/api/guest/operator-typing' && m === 'POST') return { handler: 'guestOperatorTyping', params: {} };
  if (p === '/api/visitor/login' && m === 'POST') return { handler: 'visitorLogin', params: {} };
  if (p === '/api/visitor/me') return { handler: 'visitorMe', params: {} };
  if (p === '/api/auth/me') return { handler: 'authMe', params: {} };
  if (p === '/api/auth/visitor' && m === 'POST') return { handler: 'authVisitor', params: {} };

  if (p === '/api/health') return { handler: 'health', params: {} };
  return null;
}

// ---- Cookie helpers ----
function getCookie(req: Request, name: string): string | null {
  const c = req.headers.get('Cookie');
  if (!c) return null;
  for (const part of c.split(';')) {
    const kv = part.trim().split('=');
    if (kv[0] === name) return decodeURIComponent(kv.slice(1).join('='));
  }
  return null;
}

function setCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

function delCookie(name: string): string {
  return `${name}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

// ---- Admin auth ----
async function getAdminFromRequest(req: Request, env: Env): Promise<Admin | null> {
  const token = getCookie(req, ADMIN_COOKIE);
  if (!token) return null;
  const row: any = await env.DB.prepare('SELECT id, username, role, is_disabled, must_change_password, last_seen_at FROM admins WHERE token = ? AND is_disabled = 0').bind(token).first();
  return row as Admin | null;
}

// ---- Visitor / guest auth ----
async function getGuestSession(req: Request, env: Env): Promise<string | null> {
  const token = getCookie(req, GUEST_COOKIE);
  if (!token) return null;
  const row: any = await env.DB.prepare('SELECT id FROM guest_sessions WHERE token = ? AND expires_at > datetime(\'now\')').bind(token).first();
  return row?.id || null;
}

async function getVisitorAccount(req: Request, env: Env): Promise<VisitorAccount | null> {
  const token = getCookie(req, VISITOR_COOKIE);
  if (!token) return null;
  const row: any = await env.DB.prepare('SELECT id, username, display_name, last_login_at FROM visitor_accounts WHERE token = ? AND is_disabled = 0').bind(token).first();
  return row as VisitorAccount | null;
}

// ---- Admin handlers ----
async function adminLogin(req: Request, env: Env): Promise<Response> {
  // ...
  const body: any = await req.json();
  const { username, password } = body;
  if (!username || !password) return json({ error: '\u7528\u6237\u540d\u548c\u5bc6\u7801\u4e0d\u80fd\u4e3a\u7a7a' }, 400);
  const row: any = await env.DB.prepare('SELECT id, username, role, password_hash, is_disabled, must_change_password FROM admins WHERE username = ?').bind(username).first();
  if (!row) return json({ error: '\u7528\u6237\u540d\u6216\u5bc6\u7801\u9519\u8bef' }, 401);
  if (row.is_disabled) return json({ error: '\u8d26\u6237\u5df2\u7981\u7528' }, 403);
  const passMatch = row.password_hash?.startsWith('pbkdf2:') ? await verifyPassword(password, row.password_hash) : row.password_hash === password;
  if (!passMatch) return json({ error: '\u7528\u6237\u540d\u6216\u5bc6\u7801\u9519\u8bef' }, 401);
  const token = makeToken();
  await env.DB.prepare('UPDATE admins SET token = ?, last_seen_at = datetime(\'now\') WHERE id = ?').bind(token, row.id).run();
  const h = new Headers();
  h.set('content-type', 'application/json;charset=utf-8');
  h.set('set-cookie', setCookie(ADMIN_COOKIE, token, 86400));
  h.set('cache-control', 'no-store');
  return new Response(JSON.stringify({ id: row.id, username: row.username, role: row.role, must_change_password: !!row.must_change_password }), { status: 200, headers: h });
}

async function adminLogout(req: Request, env: Env): Promise<Response> {
  const admin = await getAdminFromRequest(req, env);
  if (admin) await env.DB.prepare('UPDATE admins SET token = NULL WHERE id = ?').bind(admin.id).run();
  const h = new Headers();
  h.set('set-cookie', delCookie(ADMIN_COOKIE));
  h.set('cache-control', 'no-store');
  return new Response(null, { status: 200, headers: h });
}

async function adminMe(req: Request, env: Env): Promise<Response> {
  const admin = await getAdminFromRequest(req, env);
  if (!admin) return json({ error: ERR_LOGIN_REQUIRED }, 401);
  return json({ id: admin.id, username: admin.username, role: admin.role, must_change_password: !!admin.must_change_password });
}

async function adminChangePassword(req: Request, env: Env): Promise<Response> {
  const admin = await getAdminFromRequest(req, env);
  if (!admin) return json({ error: ERR_LOGIN_REQUIRED }, 401);
  const body: any = await req.json();
  const { old_password, new_password } = body;
  if (!old_password || !new_password) return json({ error: '\u5bc6\u7801\u4e0d\u80fd\u4e3a\u7a7a' }, 400);
  const row: any = await env.DB.prepare('SELECT password_hash FROM admins WHERE id = ?').bind(admin.id).first();
  if (!row) return json({ error: '\u7528\u6237\u4e0d\u5b58\u5728' }, 404);
  const passMatch = row.password_hash?.startsWith('pbkdf2:') ? await verifyPassword(old_password, row.password_hash) : row.password_hash === old_password;
  if (!passMatch) return json({ error: '\u65e7\u5bc6\u7801\u9519\u8bef' }, 403);
  const hash = await hashPassword(new_password);
  await env.DB.prepare('UPDATE admins SET password_hash = ?, must_change_password = 0, token = NULL WHERE id = ?').bind(hash, admin.id).run();
  const h = new Headers();
  h.set('content-type', 'application/json;charset=utf-8');
  h.set('set-cookie', delCookie(ADMIN_COOKIE));
  h.set('cache-control', 'no-store');
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: h });
}

// ---- Session helpers ----
async function getSessionById(env: Env, sessionId: string) {
  return env.DB.prepare('SELECT id, operator_id, status, source, invite_id, visitor_account_id, guest_token, created_at, ended_at, ended_by, metadata FROM chat_sessions WHERE id = ?').bind(sessionId).first();
}

async function requireSessionAccess(req: Request, env: Env, sessionId: string): Promise<{ admin?: Admin; visitor?: VisitorAccount; guestId?: string; session: any } | Response> {
  const admin = await getAdminFromRequest(req, env);
  if (admin) {
    const session = await getSessionById(env, sessionId);
    if (!session) return json({ error: ERR_SESSION_NOT_FOUND }, 404);
    return { admin, session };
  }
  // check guest token
  const guestId = await getGuestSession(req, env);
  if (guestId) {
    const session: any = await env.DB.prepare('SELECT id, operator_id, status, source, invite_id, visitor_account_id, guest_token, created_at, ended_at, ended_by, metadata FROM chat_sessions WHERE id = ? AND guest_token = ?').bind(sessionId, guestId).first();
    if (!session) return json({ error: ERR_NO_SESSION_ACCESS }, 403);
    return { guestId, session };
  }
  // check visitor account
  const visitor = await getVisitorAccount(req, env);
  if (visitor) {
    const session: any = await env.DB.prepare('SELECT id, operator_id, status, source, invite_id, visitor_account_id, guest_token, created_at, ended_at, ended_by, metadata FROM chat_sessions WHERE id = ? AND visitor_account_id = ?').bind(sessionId, visitor.id).first();
    if (!session) return json({ error: ERR_NO_SESSION_ACCESS }, 403);
    return { visitor, session };
  }
  return json({ error: ERR_LOGIN_REQUIRED }, 401);
}

// ---- Admin session handlers ----
async function adminListSessions(req: Request, env: Env): Promise<Response> {
  const admin = await getAdminFromRequest(req, env);
  if (!admin) return json({ error: ERR_LOGIN_REQUIRED }, 401);
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') || '';
  const source = searchParams.get('source') || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')));
  const offset = (page - 1) * limit;
  const where: string[] = [];
  const bind: any[] = [];
  if (status) { where.push('s.status = ?'); bind.push(status); }
  if (source) { where.push('s.source = ?'); bind.push(source); }
  if (admin.role !== 'SUPER_ADMIN') { where.push('s.operator_id = ?'); bind.push(admin.id); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const sessions = await env.DB.prepare(`SELECT s.*, a.username as operator_name FROM chat_sessions s LEFT JOIN admins a ON s.operator_id = a.id ${w} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`).bind(...bind, limit, offset).all();
  const total: any = await env.DB.prepare(`SELECT COUNT(*) as cnt FROM chat_sessions s ${w}`).bind(...bind).first();
  return json({ sessions: sessions.results, total: total?.cnt || 0, page, limit });
}

async function adminGetSession(req: Request, env: Env, sessionId: string): Promise<Response> {
  const result = await requireSessionAccess(req, env, sessionId);
  if (result instanceof Response) return result;
  return json(result.session);
}

async function adminEndSession(req: Request, env: Env, sessionId: string): Promise<Response> {
  const result = await requireSessionAccess(req, env, sessionId);
  if (result instanceof Response) return result;
  if (result.session.status === 'ended') return json({ error: ERR_SESSION_ENDED }, 400);
  await env.DB.prepare("UPDATE chat_sessions SET status = 'ended', ended_at = datetime('now'), ended_by = ? WHERE id = ?").bind(result.admin?.id || null, sessionId).run();
  return json({ ok: true });
}

async function adminGetMessages(req: Request, env: Env, sessionId: string): Promise<Response> {
  const result = await requireSessionAccess(req, env, sessionId);
  if (result instanceof Response) return result;
  const { searchParams } = new URL(req.url);
  const before = searchParams.get('before') || '';
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')));
  let rows;
  if (before) {
    rows = await env.DB.prepare('SELECT m.*, a.username as sender_name FROM messages m LEFT JOIN admins a ON m.sender_id = a.id WHERE m.session_id = ? AND m.created_at < ? ORDER BY m.created_at DESC LIMIT ?').bind(sessionId, before, limit).all();
  } else {
    rows = await env.DB.prepare('SELECT m.*, a.username as sender_name FROM messages m LEFT JOIN admins a ON m.sender_id = a.id WHERE m.session_id = ? ORDER BY m.created_at DESC LIMIT ?').bind(sessionId, limit).all();
  }
  return json({ messages: (rows.results || []).reverse() });
}

async function adminSendMessage(req: Request, env: Env, sessionId: string): Promise<Response> {
  const result = await requireSessionAccess(req, env, sessionId);
  if (result instanceof Response) return result;
  if (result.session.status === 'ended') return json({ error: ERR_SESSION_ENDED }, 400);
  const body: any = await req.json();
  const content = (body.content || '').trim();
  if (!content && !body.image_url) return json({ error: '\u6d88\u606f\u4e0d\u80fd\u4e3a\u7a7a' }, 400);
  const sender_type = result.admin ? 'operator' : (result.visitor ? 'visitor' : 'guest');
  const sender_name = result.admin?.username || result.visitor?.display_name || '';
  const msgId = makeToken();
  const imageUrl = body.image_url || null;
  await env.DB.prepare('INSERT INTO messages (id, session_id, sender_type, sender_id, sender_name, content, image_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))').bind(msgId, sessionId, sender_type, result.admin?.id || result.visitor?.id || result.guestId || '', sender_name, content, imageUrl).run();
  const msg = { id: msgId, session_id: sessionId, sender_type, sender_id: result.admin?.id || result.visitor?.id || '', sender_name, content, image_url: imageUrl, created_at: new Date().toISOString() };
  // notify DO
  const doId = env.CHAT_ROOM.idFromName(sessionId);
  const stub = env.CHAT_ROOM.get(doId);
  try { await stub.fetch('http://dummy/message', { method: 'POST', body: JSON.stringify(msg) }); } catch {}
  return json(msg, 201);
}

async function adminUpload(req: Request, env: Env): Promise<Response> {
  const admin = await getAdminFromRequest(req, env);
  if (!admin) return json({ error: ERR_LOGIN_REQUIRED }, 401);
  const form = await req.formData();
  const file = form.get('file') as File | null;
  if (!file) return json({ error: ERR_PICK_IMAGE }, 400);
  if (!file.type.startsWith('image/')) return json({ error: ERR_IMAGE_TYPE }, 400);
  if (file.size > 5 * 1024 * 1024) return json({ error: ERR_IMAGE_SIZE }, 400);
  const key = `uploads/${makeToken()}.${file.name.split('.').pop() || 'jpg'}`;
  await env.UPLOADS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return json({ url: `/${key}` });
}

// ---- Invite handlers ----
async function adminCreateInvite(req: Request, env: Env): Promise<Response> {
  const admin = await getAdminFromRequest(req, env);
  if (!admin) return json({ error: ERR_LOGIN_REQUIRED }, 401);
  const body: any = await req.json();
  const source = body.source || 'web';
  const note = body.note || '';
  const inviteId = makeToken().slice(0, 40);
  await env.DB.prepare('INSERT INTO invites (id, admin_id, source, note, created_at) VALUES (?, ?, ?, ?, datetime(\'now\'))').bind(inviteId, admin.id, source, note).run();
  return json({ id: inviteId, url: `https://${inviteId}.${env.VISITOR_ROOT_DOMAIN || DOMAIN}/` }, 201);
}

async function adminListInvites(req: Request, env: Env): Promise<Response> {
  const admin = await getAdminFromRequest(req, env);
  if (!admin) return json({ error: ERR_LOGIN_REQUIRED }, 401);
  const rows = await env.DB.prepare('SELECT i.*, a.username as created_by FROM invites i LEFT JOIN admins a ON i.admin_id = a.id WHERE i.deleted_at IS NULL ORDER BY i.created_at DESC LIMIT 100').all();
  return json({ invites: rows.results || [] });
}

async function adminDeleteInvite(req: Request, env: Env, inviteId: string): Promise<Response> {
  const admin = await getAdminFromRequest(req, env);
  if (!admin) return json({ error: ERR_LOGIN_REQUIRED }, 401);
  await env.DB.prepare("UPDATE invites SET deleted_at = datetime('now') WHERE id = ? AND deleted_at IS NULL").bind(inviteId).run();
  return json({ ok: true });
}

// ---- Operator handlers ----
async function adminListOperators(req: Request, env: Env): Promise<Response> {
  const admin = await getAdminFromRequest(req, env);
  if (!admin || admin.role !== 'SUPER_ADMIN') return json({ error: ERR_LOGIN_REQUIRED }, 401);
  const rows = await env.DB.prepare('SELECT id, username, role, is_disabled, must_change_password, last_seen_at, created_at FROM admins ORDER BY created_at DESC').all();
  return json({ operators: rows.results || [] });
}

async function adminCreateOperator(req: Request, env: Env): Promise<Response> {
  const admin = await getAdminFromRequest(req, env);
  if (!admin || admin.role !== 'SUPER_ADMIN') return json({ error: ERR_LOGIN_REQUIRED }, 401);
  const body: any = await req.json();
  const { username, password } = body;
  if (!username || !password) return json({ error: '\u7528\u6237\u540d\u548c\u5bc6\u7801\u4e0d\u80fd\u4e3a\u7a7a' }, 400);
  const existing: any = await env.DB.prepare('SELECT id FROM admins WHERE username = ?').bind(username).first();
  if (existing) return json({ error: '\u7528\u6237\u540d\u5df2\u5b58\u5728' }, 409);
  const hash = await hashPassword(password);
  const newId = makeToken();
  await env.DB.prepare("INSERT INTO admins (id, username, password_hash, role, must_change_password, created_at) VALUES (?, ?, ?, 'OPERATOR', 1, datetime('now'))").bind(newId, username, hash).run();
  return json({ id: newId, username }, 201);
}

async function adminUpdateOperator(req: Request, env: Env, operatorId: string): Promise<Response> {
  const admin = await getAdminFromRequest(req, env);
  if (!admin || admin.role !== 'SUPER_ADMIN') return json({ error: ERR_LOGIN_REQUIRED }, 401);
  const body: any = await req.json();
  const { password, is_disabled } = body;
  if (password) {
    const hash = await hashPassword(password);
    await env.DB.prepare('UPDATE admins SET password_hash = ?, must_change_password = 1, token = NULL WHERE id = ?').bind(hash, operatorId).run();
  }
  if (is_disabled !== undefined) {
    await env.DB.prepare('UPDATE admins SET is_disabled = ? WHERE id = ?').bind(is_disabled ? 1 : 0, operatorId).run();
  }
  return json({ ok: true });
}

async function adminDeleteOperator(req: Request, env: Env, operatorId: string): Promise<Response> {
  const admin = await getAdminFromRequest(req, env);
  if (!admin || admin.role !== 'SUPER_ADMIN') return json({ error: ERR_LOGIN_REQUIRED }, 401);
  await env.DB.prepare('DELETE FROM admins WHERE id = ?').bind(operatorId).run();
  return json({ ok: true });
}

// ---- Guest / visitor API handlers ----
async function guestResolveInvite(req: Request, env: Env, hostname: string): Promise<Response> {
  const body: any = await req.json();
  const inviteId = (body.invite_id || '').toLowerCase();
  if (!isValidHex40(inviteId)) return json({ error: ERR_INVALID_INVITE }, 404);
  
  // Verify the invite exists and is not deleted
  const invite: any = await env.DB.prepare('SELECT id, admin_id, source, created_at FROM invites WHERE id = ? AND deleted_at IS NULL').bind(inviteId).first();
  if (!invite) return json({ error: ERR_INVALID_INVITE }, 410);
  
  // Check invite TTL
  const age = Date.now() - new Date(invite.created_at + 'Z').getTime();
  if (age > INVITE_TTL_MS) return json({ error: ERR_INVALID_INVITE }, 410);
  
  // Create or update guest session
  const guestToken = makeToken();
  const sessionId = makeToken();
  await env.DB.prepare("INSERT INTO guest_sessions (id, token, invite_id, created_at, expires_at) VALUES (?, ?, ?, datetime('now'), datetime('now', '+1 day'))").bind(sessionId, guestToken, inviteId).run();
  await env.DB.prepare("INSERT INTO chat_sessions (id, operator_id, status, source, invite_id, guest_token, created_at) VALUES (?, ?, 'waiting', ?, ?, ?, datetime('now'))").bind(sessionId, invite.admin_id, invite.source, inviteId, sessionId).run();
  const header = new Headers();
  header.set('content-type', 'application/json;charset=utf-8');
  header.set('set-cookie', setCookie(GUEST_COOKIE, guestToken, 86400));
  header.set('cache-control', 'no-store');
  return new Response(JSON.stringify({ session_id: sessionId, operator_id: invite.admin_id, invite_id: inviteId }), { status: 200, headers: header });
}

async function guestGetSession(req: Request, env: Env): Promise<Response> {
  const guestId = await getGuestSession(req, env);
  if (!guestId) return json({ error: ERR_LOGIN_REQUIRED }, 401);
  const session: any = await env.DB.prepare('SELECT * FROM chat_sessions WHERE guest_token = ?').bind(guestId).first();
  if (!session) return json({ error: ERR_SESSION_NOT_FOUND }, 404);
  return json(session);
}

async function guestGetMessages(req: Request, env: Env): Promise<Response> {
  const guestId = await getGuestSession(req, env);
  if (!guestId) return json({ error: ERR_LOGIN_REQUIRED }, 401);
  const session: any = await env.DB.prepare('SELECT id FROM chat_sessions WHERE guest_token = ?').bind(guestId).first();
  if (!session) return json({ error: ERR_SESSION_NOT_FOUND }, 404);
  const { searchParams } = new URL(req.url);
  const before = searchParams.get('before') || '';
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')));
  let rows;
  if (before) {
    rows = await env.DB.prepare('SELECT m.*, a.username as sender_name FROM messages m LEFT JOIN admins a ON m.sender_id = a.id WHERE m.session_id = ? AND m.created_at < ? ORDER BY m.created_at DESC LIMIT ?').bind(session.id, before, limit).all();
  } else {
    rows = await env.DB.prepare('SELECT m.*, a.username as sender_name FROM messages m LEFT JOIN admins a ON m.sender_id = a.id WHERE m.session_id = ? ORDER BY m.created_at DESC LIMIT ?').bind(session.id, limit).all();
  }
  return json({ messages: (rows.results || []).reverse() });
}

async function guestSendMessage(req: Request, env: Env): Promise<Response> {
  const guestId = await getGuestSession(req, env);
  if (!guestId) return json({ error: ERR_LOGIN_REQUIRED }, 401);
  const session: any = await env.DB.prepare('SELECT * FROM chat_sessions WHERE guest_token = ?').bind(guestId).first();
  if (!session) return json({ error: ERR_SESSION_NOT_FOUND }, 404);
  if (session.status === 'ended') return json({ error: ERR_SESSION_ENDED }, 400);
  const body: any = await req.json();
  const content = (body.content || '').trim();
  if (!content && !body.image_url) return json({ error: '\u6d88\u606f\u4e0d\u80fd\u4e3a\u7a7a' }, 400);
  const msgId = makeToken();
  const imageUrl = body.image_url || null;
  await env.DB.prepare('INSERT INTO messages (id, session_id, sender_type, sender_id, sender_name, content, image_url, created_at) VALUES (?, ?, \'guest\', ?, \'\', ?, ?, datetime(\'now\'))').bind(msgId, session.id, guestId, content, imageUrl).run();
  const msg = { id: msgId, session_id: session.id, sender_type: 'guest', sender_id: guestId, sender_name: '', content, image_url: imageUrl, created_at: new Date().toISOString() };
  const doId = env.CHAT_ROOM.idFromName(session.id);
  const stub = env.CHAT_ROOM.get(doId);
  try { await stub.fetch('http://dummy/message', { method: 'POST', body: JSON.stringify(msg) }); } catch {}
  return json(msg, 201);
}

async function guestUpload(req: Request, env: Env): Promise<Response> {
  const guestId = await getGuestSession(req, env);
  if (!guestId) return json({ error: ERR_LOGIN_REQUIRED }, 401);
  const form = await req.formData();
  const file = form.get('file') as File | null;
  if (!file) return json({ error: ERR_PICK_IMAGE }, 400);
  if (!file.type.startsWith('image/')) return json({ error: ERR_IMAGE_TYPE }, 400);
  if (file.size > 5 * 1024 * 1024) return json({ error: ERR_IMAGE_SIZE }, 400);
  const key = `uploads/${makeToken()}.${file.name.split('.').pop() || 'jpg'}`;
  await env.UPLOADS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return json({ url: `/${key}` });
}

async function guestOperatorTyping(req: Request, env: Env): Promise<Response> {
  const guestId = await getGuestSession(req, env);
  if (!guestId) return json({ error: ERR_LOGIN_REQUIRED }, 401);
  const session: any = await env.DB.prepare('SELECT id FROM chat_sessions WHERE guest_token = ?').bind(guestId).first();
  if (!session) return json({ error: ERR_SESSION_NOT_FOUND }, 404);
  const body: any = await req.json();
  const doId = env.CHAT_ROOM.idFromName(session.id);
  const stub = env.CHAT_ROOM.get(doId);
  try { await stub.fetch('http://dummy/typing', { method: 'POST', body: JSON.stringify({ is_operator: false, typing: body.typing }) }); } catch {}
  return json({ ok: true });
}

async function visitorLogin(req: Request, env: Env): Promise<Response> {
  // Placeholder for visitor login
  return json({ error: 'Not implemented' }, 501);
}

async function visitorMe(req: Request, env: Env): Promise<Response> {
  const visitor = await getVisitorAccount(req, env);
  if (!visitor) return json({ error: ERR_LOGIN_REQUIRED }, 401);
  return json(visitor);
}

async function authMe(req: Request, env: Env): Promise<Response> {
  // Check admin auth first
  const admin = await getAdminFromRequest(req, env);
  if (admin) return json({ admin: { id: admin.id, username: admin.username, role: admin.role } });
  // Check visitor auth
  const visitor = await getVisitorAccount(req, env);
  if (visitor) return json({ visitor });
  return json({ admin: null });
}

async function authVisitor(req: Request, env: Env): Promise<Response> {
  const body: any = await req.json();
  const { invite_id } = body;
  const id = (invite_id || '').toLowerCase();
  if (!id || !isValidHex40(id)) return json({ error: ERR_INVALID_INVITE }, 400);
  const invite: any = await env.DB.prepare('SELECT id, source, created_at FROM invites WHERE id = ? AND deleted_at IS NULL').bind(id).first();
  if (!invite) return json({ error: ERR_INVALID_INVITE }, 404);
  return json({ id: invite.id, source: invite.source });
}

async function health(): Promise<Response> {
  return json({ status: 'ok' });
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return `pbkdf2:100000:${b64(salt)}:${b64(new Uint8Array(bits))}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored?.startsWith('pbkdf2:')) return false;
  const [, iterRaw, saltRaw, hashRaw] = stored.split(':');
  const salt = unb64(saltRaw);
  const expected = unb64(hashRaw);
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt.buffer as ArrayBuffer, iterations: Number(iterRaw), hash: 'SHA-256' }, key, expected.length * 8);
  const actual = new Uint8Array(bits);
  let diff = actual.length ^ expected.length;
  for (let i = 0; i < Math.min(actual.length, expected.length); i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

// ---- Main entry ----
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const hostname = url.hostname;
    const pathname = url.pathname;

    // =========================================================
    // Always block non-visitor /api/* on the root domain
    // Only admin-facing API allowed on root domain.
    // =========================================================
    if (pathname.startsWith('/api/')) {
      // If this is a visitor domain host but not root domain, block API access entirely
      // (visitors shouldn't call admin API)
      if (hostname !== DOMAIN && hostname.endsWith('.' + DOMAIN)) {
        return nullResponse(404);
      }
    }

    // =========================================================
    // Visitor domain gate: *.vx9qn7zr.org
    // =========================================================
    if (hostname !== DOMAIN && hostname.endsWith('.' + DOMAIN)) {
      // Extract the subdomain
      const subdomain = hostname.slice(0, -DOMAIN.length - 1); // remove ".vx9qn7zr.org"

      // Block any non-40hex subdomain immediately
      if (subdomain !== '' && !isValidHex40(subdomain)) {
        return nullResponse(404);
      }

      // For 40-hex subdomains, check if invite exists and is valid
      if (isValidHex40(subdomain)) {
        const inviteId = subdomain.toLowerCase();
        
        // Check the invite in DB
        const invite: any = await env.DB.prepare('SELECT id, created_at, deleted_at FROM invites WHERE id = ?').bind(inviteId).first().catch(() => null);
        
        // If invite doesn't exist or is deleted → 410 Gone
        if (!invite || invite.deleted_at !== null) {
          return nullResponse(410);
        }
        
        // If invite is expired (older than 24h) → 410 Gone
        try {
          const age = Date.now() - new Date(invite.created_at + 'Z').getTime();
          if (isNaN(age) || age > INVITE_TTL_MS) {
            return nullResponse(410);
          }
        } catch {
          // If date parsing fails, treat as expired
          return nullResponse(410);
        }
        
        // Valid invite — check if there's already a session for this invite
        const session: any = await env.DB.prepare('SELECT id, status FROM chat_sessions WHERE invite_id = ? AND status = \'active\'').bind(inviteId).first().catch(() => null);
        
        // If session exists and is active, pass through to SPA
        // If no session yet, also pass through (will be created by frontend)
        // Allow the ASSETS fetch to proceed
      } else {
        // This case shouldn't happen since we validated above
        return nullResponse(404);
      }
    }

    // =========================================================
    // Non-API requests: serve SPA assets or admin app
    // =========================================================
    try {
      // Fetch asset response
      const assetResponse = await env.ASSETS.fetch(request);
      
      // Clone and add no-cache headers to prevent Cloudflare edge cache
      // from serving stale SPA for visitor subdomains
      const headers = new Headers(assetResponse.headers);
      headers.set('cache-control', 'no-cache, no-store, must-revalidate');
      headers.set('pragma', 'no-cache');
      headers.set('expires', '0');
      
      return new Response(assetResponse.body, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers,
      });
    } catch (e) {
      // If ASSETS fails, return 404
      return nullResponse(404);
    }
  },
};