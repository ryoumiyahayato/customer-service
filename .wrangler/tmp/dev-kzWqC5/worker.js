var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/durable-objects/ChatRoom.ts
var ChatRoom = class {
  constructor(state) {
    this.state = state;
  }
  state;
  static {
    __name(this, "ChatRoom");
  }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/broadcast") {
      const payload = await req.text();
      for (const ws of this.state.getWebSockets()) ws.send(payload);
      return new Response("ok");
    }
    if (req.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    server.send(JSON.stringify({ type: "connected", ts: Date.now() }));
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, message) {
    if (typeof message !== "string") return;
    try {
      const data = JSON.parse(message);
      if (data?.type === "ping") ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
    } catch {
    }
  }
  async webSocketClose() {
  }
  async webSocketError() {
  }
};

// src/worker.ts
var ADMIN_COOKIE = "support_admin";
var VISITOR_COOKIE = "visitor_account";
var enc = new TextEncoder();
var now = /* @__PURE__ */ __name(() => (/* @__PURE__ */ new Date()).toISOString(), "now");
var rid = /* @__PURE__ */ __name((prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`, "rid");
var json = /* @__PURE__ */ __name((body, init = {}) => new Response(JSON.stringify(body), { ...init, headers: { "Content-Type": "application/json; charset=utf-8", ...init.headers || {} } }), "json");
var getCookie = /* @__PURE__ */ __name((req, name) => (req.headers.get("cookie") || "").split(";").map((x) => x.trim()).find((x) => x.startsWith(`${name}=`))?.slice(name.length + 1), "getCookie");
var setCookie = /* @__PURE__ */ __name((name, value) => `${name}=${value}; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax; Secure`, "setCookie");
var clearCookie = /* @__PURE__ */ __name((name) => `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`, "clearCookie");
async function readJson(req) {
  return await req.json().catch(() => ({}));
}
__name(readJson, "readJson");
function b64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
__name(b64, "b64");
function unb64(value) {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
__name(unb64, "unb64");
async function hmac(secret, value) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hmac, "hmac");
async function makeToken(env, value) {
  return `${value}.${await hmac(env.SESSION_SECRET, value)}`;
}
__name(makeToken, "makeToken");
async function verifyToken(env, token) {
  if (!token) return null;
  const [value, sig] = token.split(".");
  return value && sig === await hmac(env.SESSION_SECRET, value) ? value : null;
}
__name(verifyToken, "verifyToken");
async function tokenHash(env, value) {
  return await hmac(env.SESSION_SECRET, "session:" + value);
}
__name(tokenHash, "tokenHash");
function expiresAt(days = 7) {
  return new Date(Date.now() + days * 864e5).toISOString();
}
__name(expiresAt, "expiresAt");
async function createAdminSession(env, adminId) {
  const id = rid("asess");
  await env.DB.prepare("INSERT INTO admin_sessions(id,admin_id,token_hash,created_at,expires_at) VALUES(?,?,?,?,?)").bind(id, adminId, await tokenHash(env, id), now(), expiresAt()).run();
  return await makeToken(env, id);
}
__name(createAdminSession, "createAdminSession");
async function createVisitorSession(env, accountId, visitorKey) {
  const id = rid("vsess");
  await env.DB.prepare("INSERT INTO visitor_sessions(id,visitor_account_id,visitor_key,token_hash,created_at,expires_at) VALUES(?,?,?,?,?,?)").bind(id, accountId, visitorKey || null, await tokenHash(env, id), now(), expiresAt()).run();
  return await makeToken(env, id);
}
__name(createVisitorSession, "createVisitorSession");
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 1e5, hash: "SHA-256" }, key, 256);
  return `pbkdf2:100000:${b64(salt)}:${b64(new Uint8Array(bits))}`;
}
__name(hashPassword, "hashPassword");
async function verifyPassword(password, stored) {
  if (!stored?.startsWith("pbkdf2:")) return false;
  const [, iterRaw, saltRaw, hashRaw] = stored.split(":");
  const salt = unb64(saltRaw);
  const expected = unb64(hashRaw);
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: Number(iterRaw), hash: "SHA-256" }, key, expected.length * 8);
  const actual = new Uint8Array(bits);
  let diff = actual.length ^ expected.length;
  for (let i = 0; i < Math.min(actual.length, expected.length); i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}
__name(verifyPassword, "verifyPassword");
async function ensureBootstrap(env) {
  const row = await env.DB.prepare("SELECT id FROM admins WHERE role='SUPER_ADMIN' LIMIT 1").first();
  if (row) return;
  const username = env.SUPER_ADMIN_USERNAME?.trim();
  const password = env.SUPER_ADMIN_PASSWORD;
  if (!username || !password) return;
  const t = now();
  await env.DB.prepare("INSERT INTO admins(id,username,display_name,password_hash,role,must_change_password,is_disabled,created_at,updated_at,last_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(rid("admin"), username, username, await hashPassword(password), "SUPER_ADMIN", 0, 0, t, t, t).run();
}
__name(ensureBootstrap, "ensureBootstrap");
async function currentAdmin(env, req, raw = false) {
  const sessionId = await verifyToken(env, getCookie(req, ADMIN_COOKIE));
  if (!sessionId) return null;
  const session = await env.DB.prepare("SELECT admin_id FROM admin_sessions WHERE id=? AND token_hash=? AND revoked_at IS NULL AND expires_at>?").bind(sessionId, await tokenHash(env, sessionId), now()).first();
  if (!session) return null;
  const admin = await env.DB.prepare("SELECT id,username,role,must_change_password,is_disabled,last_seen_at FROM admins WHERE id=?").bind(session.admin_id).first();
  if (!admin || !raw && admin.is_disabled) return null;
  if (!raw) await env.DB.prepare("UPDATE admins SET last_seen_at=? WHERE id=? AND is_disabled=0").bind(now(), admin.id).run();
  return admin;
}
__name(currentAdmin, "currentAdmin");
async function requireAdmin(env, req) {
  const admin = await currentAdmin(env, req);
  if (!admin) throw new Response("Unauthorized", { status: 401 });
  return admin;
}
__name(requireAdmin, "requireAdmin");
async function requireSuper(env, req) {
  const admin = await requireAdmin(env, req);
  if (admin.role !== "SUPER_ADMIN") throw new Response("Forbidden", { status: 403 });
  return admin;
}
__name(requireSuper, "requireSuper");
async function currentVisitorAccount(env, req) {
  const sessionId = await verifyToken(env, getCookie(req, VISITOR_COOKIE));
  if (!sessionId) return null;
  const session = await env.DB.prepare("SELECT visitor_account_id FROM visitor_sessions WHERE id=? AND token_hash=? AND revoked_at IS NULL AND expires_at>?").bind(sessionId, await tokenHash(env, sessionId), now()).first();
  return session?.visitor_account_id ? await env.DB.prepare("SELECT id,username,display_name,last_login_at FROM visitor_accounts WHERE id=?").bind(session.visitor_account_id).first() : null;
}
__name(currentVisitorAccount, "currentVisitorAccount");
async function rateLimit(env, req) {
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown";
  const key = `${ip}:${new URL(req.url).pathname}`.slice(0, 240);
  const reset = Math.floor(Date.now() / 6e4) * 6e4 + 6e4;
  const row = await env.DB.prepare("SELECT count,reset_at FROM rate_limits WHERE key=?").bind(key).first();
  if (!row || row.reset_at < Date.now()) {
    await env.DB.prepare("INSERT OR REPLACE INTO rate_limits(key,count,reset_at) VALUES(?,?,?)").bind(key, 1, reset).run();
    return null;
  }
  if (row.count > 120) return json({ error: "rate_limited" }, { status: 429 });
  await env.DB.prepare("UPDATE rate_limits SET count=count+1 WHERE key=?").bind(key).run();
  return null;
}
__name(rateLimit, "rateLimit");
async function upsertVisitor(env, visitorId, account) {
  const key = account ? `acct_${account.id}` : visitorId?.startsWith("visitor_") ? visitorId : rid("visitor");
  const displayName = account?.display_name || `\u7481\u57AE\uE179 ${key.slice(-6)}`;
  const t = now();
  let user = await env.DB.prepare("SELECT * FROM users WHERE visitor_key=?").bind(key).first();
  if (!user) {
    const uid = rid("user");
    await env.DB.prepare("INSERT INTO users(id,visitor_key,account_id,display_name,last_seen_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(uid, key, account?.id || null, displayName, t, t, t).run();
    user = await env.DB.prepare("SELECT * FROM users WHERE id=?").bind(uid).first();
  } else await env.DB.prepare("UPDATE users SET account_id=COALESCE(?,account_id),display_name=?,last_seen_at=?,updated_at=? WHERE id=?").bind(account?.id || null, displayName, t, t, user.id).run();
  return { key, user };
}
__name(upsertVisitor, "upsertVisitor");
async function latestSession(env, userId) {
  return await env.DB.prepare("SELECT * FROM sessions WHERE user_id=? AND status!='ARCHIVED' AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1").bind(userId).first();
}
__name(latestSession, "latestSession");
async function getOrCreateSession(env, userId) {
  let session = await latestSession(env, userId);
  if (!session || session.status === "CLOSED") {
    const t = now();
    const sid = rid("sess");
    await env.DB.prepare("INSERT INTO sessions(id,user_id,status,created_at,updated_at,last_operator_id) VALUES(?,?,?,?,?,NULL)").bind(sid, userId, "PENDING", t, t).run();
    session = await env.DB.prepare("SELECT * FROM sessions WHERE id=?").bind(sid).first();
  }
  return session;
}
__name(getOrCreateSession, "getOrCreateSession");
async function getMessages(env, sessionId, after) {
  const q = after ? env.DB.prepare("SELECT * FROM messages WHERE session_id=? AND created_at>? ORDER BY created_at").bind(sessionId, after) : env.DB.prepare("SELECT * FROM messages WHERE session_id=? ORDER BY created_at").bind(sessionId);
  return (await q.all()).results || [];
}
__name(getMessages, "getMessages");
async function visitorOwnsSession(env, req, session) {
  const url = new URL(req.url);
  const account = await currentVisitorAccount(env, req);
  const visitorId = url.searchParams.get("visitorId") || getCookie(req, "visitor_id") || "";
  const key = account ? `acct_${account.id}` : visitorId;
  if (!key) return false;
  const user = await env.DB.prepare("SELECT id FROM users WHERE visitor_key=?").bind(key).first();
  return Boolean(user && user.id === session.user_id);
}
__name(visitorOwnsSession, "visitorOwnsSession");
async function broadcast(env, room, payload) {
  await env.CHAT_ROOMS.get(env.CHAT_ROOMS.idFromName(room)).fetch("https://room/broadcast", { method: "POST", body: JSON.stringify(payload) });
}
__name(broadcast, "broadcast");
var notifyAdmins = /* @__PURE__ */ __name((env) => broadcast(env, "admin-feed", { type: "sessions:changed", ts: Date.now() }), "notifyAdmins");
async function listSessions(env, includeDeleted) {
  const where = includeDeleted ? "WHERE EXISTS (SELECT 1 FROM messages mx WHERE mx.session_id=s.id)" : "WHERE s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM messages mx WHERE mx.session_id=s.id)";
  return (await env.DB.prepare(`SELECT s.*,u.visitor_key,u.display_name,a.username operator_name,(SELECT COUNT(*) FROM messages m WHERE m.session_id=s.id AND m.sender_type='VISITOR' AND m.is_read=0) unread_count FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN admins a ON a.id=s.assigned_operator_id ${where} ORDER BY COALESCE(s.deleted_at,s.updated_at) DESC`).all()).results || [];
}
__name(listSessions, "listSessions");
async function visitorLogin(req, env, username, password) {
  const account = await env.DB.prepare("SELECT * FROM visitor_accounts WHERE username=?").bind(username).first();
  if (!account || !await verifyPassword(password, account.password_hash)) return json({ error: "Invalid credentials" }, { status: 401 });
  const t = now();
  await env.DB.prepare("UPDATE visitor_accounts SET last_login_at=?,updated_at=? WHERE id=?").bind(t, t, account.id).run();
  const safe = { id: account.id, username: account.username, display_name: account.display_name, last_login_at: t };
  return json({ type: "user", account: safe }, { headers: { "Set-Cookie": setCookie(VISITOR_COOKIE, await createVisitorSession(env, account.id)) } });
}
__name(visitorLogin, "visitorLogin");
async function createMessage(req, env) {
  const b = await readJson(req);
  const admin = await currentAdmin(env, req);
  const senderType = b.senderType || (admin ? "OPERATOR" : "VISITOR");
  let senderId = senderType === "OPERATOR" ? String(admin?.id || "") : String(b.visitorId || "");
  let sessionId = String(b.sessionId || "");
  let session = null;
  if (senderType === "OPERATOR") {
    if (!admin) return json({ error: "Unauthorized" }, { status: 401 });
    session = await env.DB.prepare("SELECT * FROM sessions WHERE id=?").bind(sessionId).first();
    if (!session || session.deleted_at) return json({ error: "Session not found" }, { status: 404 });
  } else {
    const account = await currentVisitorAccount(env, req);
    if (!account && !senderId.startsWith("visitor_")) return json({ error: "Invalid visitor identity" }, { status: 400 });
    const v = await upsertVisitor(env, senderId, account);
    senderId = v.key;
    if (sessionId) {
      const existing = await env.DB.prepare("SELECT * FROM sessions WHERE id=?").bind(sessionId).first();
      if (!existing || existing.user_id !== v.user.id || existing.deleted_at) sessionId = "";
    }
    session = sessionId ? await env.DB.prepare("SELECT * FROM sessions WHERE id=?").bind(sessionId).first() : await getOrCreateSession(env, v.user.id);
    sessionId = session.id;
  }
  const t = now();
  const msg = { id: rid("msg"), session_id: sessionId, sender_type: senderType, sender_id: senderId, content: String(b.content || ""), message_type: b.messageType === "image" ? "image" : "text", image_path: b.imagePath || null, status: "sent", created_at: t, read_at: null, is_read: 0, quote_message_id: b.quoteMessageId || null, recalled_at: null, image_purged_at: null };
  await env.DB.prepare("INSERT INTO messages(id,session_id,sender_type,sender_id,content,message_type,image_path,status,created_at,read_at,is_read,quote_message_id,recalled_at,image_purged_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(msg.id, msg.session_id, msg.sender_type, msg.sender_id, msg.content, msg.message_type, msg.image_path, msg.status, msg.created_at, msg.read_at, msg.is_read, msg.quote_message_id, msg.recalled_at, msg.image_purged_at).run();
  await env.DB.prepare("UPDATE sessions SET status=CASE WHEN status='CLOSED' AND ?='VISITOR' THEN 'PENDING' ELSE status END, updated_at=? WHERE id=?").bind(senderType, t, sessionId).run();
  session = await env.DB.prepare("SELECT * FROM sessions WHERE id=?").bind(sessionId).first();
  await broadcast(env, `conversation:${sessionId}`, { type: "message:new", conversationId: sessionId, message: msg, session });
  await notifyAdmins(env);
  return json({ message: msg, session });
}
__name(createMessage, "createMessage");
async function sessionAction(req, env, sessionId, action) {
  const admin = await requireAdmin(env, req);
  const t = now();
  if (action === "assign") await env.DB.prepare("UPDATE sessions SET assigned_operator_id=?,last_operator_id=?,status='OPEN',updated_at=? WHERE id=? AND deleted_at IS NULL").bind(admin.id, admin.id, t, sessionId).run();
  if (action === "close") await env.DB.prepare("UPDATE sessions SET status='CLOSED',assigned_operator_id=NULL,updated_at=? WHERE id=? AND deleted_at IS NULL").bind(t, sessionId).run();
  if (action === "delete") await env.DB.prepare("UPDATE sessions SET deleted_at=?,deleted_by=?,updated_at=? WHERE id=? AND deleted_at IS NULL").bind(t, admin.id, t, sessionId).run();
  if (action === "restore") await env.DB.prepare("UPDATE sessions SET deleted_at=NULL,deleted_by=NULL,updated_at=? WHERE id=?").bind(t, sessionId).run();
  const session = await env.DB.prepare("SELECT * FROM sessions WHERE id=?").bind(sessionId).first();
  await broadcast(env, `conversation:${sessionId}`, { type: "session:updated", conversationId: sessionId, session });
  await notifyAdmins(env);
  return json({ ok: true });
}
__name(sessionAction, "sessionAction");
async function bindGuest(env, visitorKey, account) {
  if (!visitorKey.startsWith("visitor_")) return;
  const accountKey = `acct_${account.id}`;
  const t = now();
  const accountUser = await env.DB.prepare("SELECT id FROM users WHERE visitor_key=?").bind(accountKey).first();
  const guestUser = await env.DB.prepare("SELECT id FROM users WHERE visitor_key=?").bind(visitorKey).first();
  if (!guestUser) return;
  if (accountUser) {
    await env.DB.prepare("UPDATE sessions SET user_id=?,updated_at=? WHERE user_id=?").bind(accountUser.id, t, guestUser.id).run();
    await env.DB.prepare("DELETE FROM users WHERE id=?").bind(guestUser.id).run();
  } else await env.DB.prepare("UPDATE users SET visitor_key=?,account_id=?,display_name=?,updated_at=? WHERE id=?").bind(accountKey, account.id, account.display_name, t, guestUser.id).run();
}
__name(bindGuest, "bindGuest");
async function upload(req, env) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "No file" }, { status: 400 });
  const allowed = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  if (!allowed[file.type]) return json({ error: "Only JPG/PNG/WebP images are allowed" }, { status: 400 });
  if (file.size > 5 * 1024 * 1024) return json({ error: "File too large" }, { status: 413 });
  const key = `${crypto.randomUUID()}.${allowed[file.type]}`;
  await env.UPLOADS.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
  return json({ path: `/api/attachments/${key}` });
}
__name(upload, "upload");
async function api(req, env) {
  await ensureBootstrap(env);
  const url = new URL(req.url);
  const path = url.pathname;
  if (req.method !== "GET" && !path.startsWith("/api/ws")) {
    const limited = await rateLimit(env, req);
    if (limited) return limited;
  }
  if (path === "/api/auth/me") {
    const admin = await currentAdmin(env, req, true);
    if (admin?.is_disabled) return json({ admin: null, disabled: true }, { status: 403, headers: { "Set-Cookie": clearCookie(ADMIN_COOKIE) } });
    return json({ admin });
  }
  if ((path === "/api/auth/logout" || path === "/api/account/logout") && req.method === "POST") return json({ ok: true }, { headers: { "Set-Cookie": clearCookie(path.includes("account") ? VISITOR_COOKIE : ADMIN_COOKIE) } });
  if ((path === "/api/auth/login" || path === "/api/login") && req.method === "POST") {
    const b = await readJson(req);
    const name = String(b.username || "").trim();
    const pass = String(b.password || "");
    const admin = await env.DB.prepare("SELECT * FROM admins WHERE username=?").bind(name).first();
    if (admin) {
      if (admin.is_disabled) return json({ error: "Disabled", disabled: true }, { status: 403 });
      if (!await verifyPassword(pass, admin.password_hash)) return json({ error: "Invalid credentials" }, { status: 401 });
      return json({ type: "admin", admin: { id: admin.id, username: admin.username, role: admin.role, must_change_password: admin.must_change_password } }, { headers: { "Set-Cookie": setCookie(ADMIN_COOKIE, await createAdminSession(env, admin.id)) } });
    }
    return path === "/api/login" ? visitorLogin(req, env, name, pass) : json({ error: "Invalid credentials" }, { status: 401 });
  }
  if (path === "/api/account/login" && req.method === "POST") {
    const b = await readJson(req);
    return visitorLogin(req, env, String(b.username || "").trim(), String(b.password || ""));
  }
  if (path === "/api/account/register" && req.method === "POST") {
    const b = await readJson(req);
    const username = String(b.username || "").trim();
    const password = String(b.password || "");
    const display = String(b.displayName || username).trim();
    if (username.length < 3 || password.length < 8) return json({ error: "Invalid account" }, { status: 400 });
    const t = now();
    const accountId = rid("acct");
    try {
      await env.DB.prepare("INSERT INTO visitor_accounts(id,username,password_hash,display_name,last_login_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(accountId, username, await hashPassword(password), display, t, t, t).run();
    } catch {
      return json({ error: "Account exists" }, { status: 409 });
    }
    const account = { id: accountId, username, display_name: display, last_login_at: t };
    if (b.claimGuest && b.visitorId) await bindGuest(env, String(b.visitorId), account);
    if (b.discardGuest && b.visitorId) await env.DB.prepare("DELETE FROM users WHERE visitor_key=?").bind(String(b.visitorId)).run();
    return json({ type: "user", account }, { headers: { "Set-Cookie": setCookie(VISITOR_COOKIE, await createVisitorSession(env, accountId, String(b.visitorId || ""))) } });
  }
  if (path === "/api/account/me") return json({ account: await currentVisitorAccount(env, req) });
  if (path === "/api/visitor" && req.method === "POST") {
    const b = await readJson(req);
    const account = await currentVisitorAccount(env, req);
    const { key, user } = await upsertVisitor(env, String(b.visitorId || ""), account);
    const session = await latestSession(env, user.id);
    if (session) await env.DB.prepare("UPDATE messages SET is_read=1,status=CASE WHEN status='sent' THEN 'read' ELSE status END,read_at=COALESCE(read_at,?) WHERE session_id=? AND sender_type='OPERATOR' AND status!='recalled'").bind(now(), session.id).run();
    return json({ visitorId: key, account, user, session, messages: session ? await getMessages(env, session.id) : [] });
  }
  if (path === "/api/messages" && req.method === "POST") return createMessage(req, env);
  if (path === "/api/sessions") {
    await requireAdmin(env, req);
    return json({ sessions: await listSessions(env, url.searchParams.get("includeDeleted") === "1") });
  }
  const sm = path.match(/^\/api\/sessions\/([^/]+)\/messages$/);
  if (sm) {
    const session = await env.DB.prepare("SELECT * FROM sessions WHERE id=?").bind(sm[1]).first();
    if (!session || session.deleted_at) return json({ messages: [] });
    const admin = await currentAdmin(env, req);
    if (admin) await env.DB.prepare("UPDATE messages SET is_read=1,status='read',read_at=COALESCE(read_at,?) WHERE session_id=? AND sender_type='VISITOR'").bind(now(), session.id).run();
    else if (!await visitorOwnsSession(env, req, session)) return json({ error: "Unauthorized" }, { status: 401 });
    return json({ messages: await getMessages(env, session.id, url.searchParams.get("after")) });
  }
  const sa = path.match(/^\/api\/sessions\/([^/]+)\/(assign|close|delete|restore)$/);
  if (sa && req.method === "POST") return sessionAction(req, env, sa[1], sa[2]);
  const rec = path.match(/^\/api\/messages\/([^/]+)\/recall$/);
  if (rec && req.method === "POST") {
    const admin = await requireAdmin(env, req);
    const t = now();
    await env.DB.prepare("UPDATE messages SET status='recalled',content='',image_path=NULL,recalled_at=? WHERE id=? AND sender_type='OPERATOR' AND sender_id=?").bind(t, rec[1], admin.id).run();
    const row = await env.DB.prepare("SELECT * FROM messages WHERE id=?").bind(rec[1]).first();
    if (row) await broadcast(env, `conversation:${row.session_id}`, { type: "message:updated", conversationId: row.session_id, message: row });
    return json({ ok: true });
  }
  if (path === "/api/messages/purge-images" && req.method === "POST") {
    const admin = await requireAdmin(env, req);
    await env.DB.prepare("UPDATE messages SET image_path=NULL,image_purged_at=?,content='' WHERE sender_id=? AND message_type='image'").bind(now(), admin.id).run();
    await notifyAdmins(env);
    return json({ ok: true });
  }
  if (path === "/api/admins" && req.method === "GET") {
    await requireSuper(env, req);
    return json({ admins: (await env.DB.prepare("SELECT id,username,role,must_change_password,created_at,is_disabled,disabled_at,last_seen_at FROM admins ORDER BY role DESC, created_at").all()).results || [] });
  }
  if (path === "/api/admins" && req.method === "POST") {
    await requireSuper(env, req);
    const b = await readJson(req);
    const username = String(b.username || "").trim();
    const password = String(b.password || "");
    const t = now();
    await env.DB.prepare("INSERT INTO admins(id,username,display_name,password_hash,role,must_change_password,is_disabled,created_at,updated_at,last_seen_at) VALUES(?,?,?,?, 'OPERATOR',0,0,?,?,NULL)").bind(rid("admin"), username, username, await hashPassword(password), t, t).run();
    return json({ ok: true });
  }
  if (path === "/api/admins/operators" && req.method === "GET") {
    await requireSuper(env, req);
    const rows = (await env.DB.prepare("SELECT id,username,role,created_at,is_disabled,disabled_at,last_seen_at FROM admins WHERE role='OPERATOR' ORDER BY is_disabled, username").all()).results || [];
    return json({ operators: rows.map((r) => ({ ...r, online: Boolean(r.last_seen_at && Date.now() - Date.parse(r.last_seen_at) < 12e4 && !r.is_disabled) })) });
  }
  if (path === "/api/admins/operators" && req.method === "DELETE") {
    const admin = await requireSuper(env, req);
    const b = await readJson(req);
    const opId = String(b.id || "");
    const t = now();
    if (b.hard) await env.DB.prepare("DELETE FROM admins WHERE id=? AND role='OPERATOR' AND is_disabled=1").bind(opId).run();
    else {
      await env.DB.prepare("UPDATE admins SET is_disabled=1,disabled_at=?,updated_at=? WHERE id=? AND role='OPERATOR'").bind(t, t, opId).run();
      await env.DB.prepare("UPDATE sessions SET deleted_at=?,deleted_by=?,assigned_operator_id=NULL,updated_at=? WHERE deleted_at IS NULL AND (assigned_operator_id=? OR last_operator_id=?)").bind(t, admin.id, t, opId, opId).run();
    }
    await notifyAdmins(env);
    return json({ ok: true });
  }
  if (path === "/api/admins/profile" && req.method === "PATCH") {
    const admin = await requireSuper(env, req);
    const b = await readJson(req);
    const username = String(b.username || "").trim();
    const password = String(b.password || "");
    const t = now();
    if (username) await env.DB.prepare("UPDATE admins SET username=?,display_name=?,updated_at=? WHERE id=?").bind(username, username, t, admin.id).run();
    if (password) await env.DB.prepare("UPDATE admins SET password_hash=?,must_change_password=0,updated_at=? WHERE id=?").bind(await hashPassword(password), t, admin.id).run();
    return json({ ok: true });
  }
  if (path === "/api/staff-chat" && req.method === "GET") {
    await requireAdmin(env, req);
    const rows = (await env.DB.prepare("SELECT sm.*,a.username sender_name FROM staff_messages sm JOIN admins a ON a.id=sm.sender_admin_id ORDER BY sm.created_at DESC LIMIT 80").all()).results || [];
    return json({ messages: rows.reverse() });
  }
  if (path === "/api/staff-chat" && req.method === "POST") {
    const admin = await requireAdmin(env, req);
    const b = await readJson(req);
    const content = String(b.content || "").trim();
    const msg = { id: rid("staffmsg"), sender_admin_id: admin.id, sender_name: admin.username, content, created_at: now() };
    await env.DB.prepare("INSERT INTO staff_messages(id,sender_admin_id,content,created_at) VALUES(?,?,?,?)").bind(msg.id, admin.id, content, msg.created_at).run();
    await broadcast(env, "staff", { type: "staff:new", message: msg });
    return json({ message: msg });
  }
  if (path === "/api/upload" && req.method === "POST") return upload(req, env);
  const att = path.match(/^\/api\/attachments\/(.+)$/);
  if (att) {
    const obj = await env.UPLOADS.get(att[1]);
    return obj ? new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable" } }) : new Response("Not found", { status: 404 });
  }
  if (path === "/api/ws/admin") {
    await requireAdmin(env, req);
    return env.CHAT_ROOMS.get(env.CHAT_ROOMS.idFromName("admin-feed")).fetch(req);
  }
  if (path === "/api/ws/staff") {
    await requireAdmin(env, req);
    return env.CHAT_ROOMS.get(env.CHAT_ROOMS.idFromName("staff")).fetch(req);
  }
  const ws = path.match(/^\/api\/ws\/conversations\/([^/]+)$/);
  if (ws) {
    const session = await env.DB.prepare("SELECT * FROM sessions WHERE id=?").bind(ws[1]).first();
    if (!session) return new Response("Not found", { status: 404 });
    if (!await currentAdmin(env, req) && !await visitorOwnsSession(env, req, session)) return new Response("Unauthorized", { status: 401 });
    return env.CHAT_ROOMS.get(env.CHAT_ROOMS.idFromName(`conversation:${ws[1]}`)).fetch(req);
  }
  return json({ error: "Not found" }, { status: 404 });
}
__name(api, "api");
var worker_default = { async fetch(req, env, ctx) {
  try {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) return await api(req, env);
    return env.ASSETS.fetch(req);
  } catch (e) {
    if (e instanceof Response) return e;
    console.error(e);
    return json({ error: "Internal error" }, { status: 500 });
  }
} };

// node_modules/.pnpm/wrangler@4.104.0_@cloudflare+workers-types@4.20260625.1/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/.pnpm/wrangler@4.104.0_@cloudflare+workers-types@4.20260625.1/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-w1yioX/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// node_modules/.pnpm/wrangler@4.104.0_@cloudflare+workers-types@4.20260625.1/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-w1yioX/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  ChatRoom,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
