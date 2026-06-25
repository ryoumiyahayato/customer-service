import crypto from 'crypto';
import postgres from 'postgres';

export const now = () => new Date().toISOString();
export const id = (prefix = 'id') => `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
let pg: ReturnType<typeof postgres> | null = null;
let ready: Promise<void> | null = null;

export function getPg() {
  if (!connectionString) throw new Error('POSTGRES_URL or DATABASE_URL is required.');
  if (!pg) pg = postgres(connectionString, { ssl: 'require', max: 1 });
  return pg;
}

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string) {
  if (!stored?.startsWith('scrypt:')) return false;
  const [, salt, hash] = stored.split(':');
  const test = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), test);
}

async function ensureDefaultAdmin() {
  const sql = getPg();
  const superRows = await sql`SELECT id FROM admins WHERE role='SUPER_ADMIN' LIMIT 1`;
  const username = process.env.DEFAULT_ADMIN_USERNAME;
  const password = process.env.DEFAULT_ADMIN_PASSWORD;
  if (!username || !password) throw new Error('DEFAULT_ADMIN_USERNAME and DEFAULT_ADMIN_PASSWORD are required for first super admin bootstrap.');
  const t = now();
  if (superRows[0]) {
    if (process.env.RESET_SUPER_ADMIN_ON_BOOTSTRAP === '1') {
      await sql`UPDATE admins SET username=${username}, password_hash=${hashPassword(password)}, must_change_password=0, is_disabled=0, updated_at=${t} WHERE id=${superRows[0].id}`;
      await log('ADMIN_BOOTSTRAP_RESET', 'Initial super admin reset from environment');
    }
    return;
  }
  await sql`INSERT INTO admins(id,username,password_hash,role,must_change_password,created_at,updated_at,is_disabled,last_seen_at) VALUES (${id('admin')},${username},${hashPassword(password)},'SUPER_ADMIN',0,${t},${t},0,${t})`;
  await log('ADMIN_BOOTSTRAP', 'Initial super admin created');
}

async function initPostgres() {
  const sql = getPg();
  await sql`CREATE TABLE IF NOT EXISTS admins (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('SUPER_ADMIN','OPERATOR')), must_change_password INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, is_disabled INTEGER NOT NULL DEFAULT 0, disabled_at TEXT, last_seen_at TEXT)`;
  await sql`CREATE TABLE IF NOT EXISTS visitor_accounts (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, display_name TEXT NOT NULL, last_login_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, visitor_key TEXT UNIQUE NOT NULL, account_id TEXT REFERENCES visitor_accounts(id) ON DELETE SET NULL, display_name TEXT NOT NULL, last_seen_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), assigned_operator_id TEXT REFERENCES admins(id), last_operator_id TEXT REFERENCES admins(id), status TEXT NOT NULL CHECK(status IN ('PENDING','OPEN','CLOSED','ARCHIVED')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, deleted_by TEXT REFERENCES admins(id))`;
  await sql`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, sender_type TEXT NOT NULL CHECK(sender_type IN ('VISITOR','OPERATOR')), sender_id TEXT NOT NULL, content TEXT, message_type TEXT NOT NULL CHECK(message_type IN ('text','image')), image_path TEXT, status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','delivered','read','recalled')), created_at TEXT NOT NULL, read_at TEXT, is_read INTEGER NOT NULL DEFAULT 0, quote_message_id TEXT, recalled_at TEXT, image_purged_at TEXT)`;
  await sql`CREATE TABLE IF NOT EXISTS staff_messages (id TEXT PRIMARY KEY, sender_admin_id TEXT NOT NULL REFERENCES admins(id), content TEXT NOT NULL, created_at TEXT NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS system_logs (id TEXT PRIMARY KEY, level TEXT NOT NULL, event TEXT NOT NULL, actor_id TEXT, message TEXT NOT NULL, created_at TEXT NOT NULL)`;
  try { await sql`ALTER TABLE admins ADD COLUMN is_disabled INTEGER NOT NULL DEFAULT 0`; } catch {}
  try { await sql`ALTER TABLE admins ADD COLUMN disabled_at TEXT`; } catch {}
  try { await sql`ALTER TABLE admins ADD COLUMN last_seen_at TEXT`; } catch {}
  try { await sql`ALTER TABLE users ADD COLUMN account_id TEXT REFERENCES visitor_accounts(id) ON DELETE SET NULL`; } catch {}
  try { await sql`ALTER TABLE sessions ADD COLUMN deleted_at TEXT`; } catch {}
  try { await sql`ALTER TABLE sessions ADD COLUMN deleted_by TEXT REFERENCES admins(id)`; } catch {}
  try { await sql`ALTER TABLE messages ADD COLUMN quote_message_id TEXT`; } catch {}
  try { await sql`ALTER TABLE messages ADD COLUMN recalled_at TEXT`; } catch {}
  try { await sql`ALTER TABLE messages ADD COLUMN image_purged_at TEXT`; } catch {}
  try { await sql`ALTER TABLE messages DROP CONSTRAINT messages_status_check`; } catch {}
  try { await sql`ALTER TABLE messages ADD CONSTRAINT messages_status_check CHECK(status IN ('sent','delivered','read','recalled'))`; } catch {}
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS one_super_admin ON admins ((role)) WHERE role='SUPER_ADMIN'`;
  await sql`CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_deleted_at ON sessions(deleted_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_visitor_accounts_last_login ON visitor_accounts(last_login_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_staff_messages_created ON staff_messages(created_at)`;
}

export async function cleanupExpiredVisitorAccounts() { const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(); await getPg()`DELETE FROM visitor_accounts WHERE last_login_at < ${cutoff}`; }
export async function cleanupDeletedSessions() { const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); await getPg()`DELETE FROM sessions WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff}`; }
export async function initDb() { if (!ready) ready = (async () => { await initPostgres(); await cleanupExpiredVisitorAccounts(); await cleanupDeletedSessions(); await ensureDefaultAdmin(); })(); return ready; }

export async function getAdminByUsername(username: string) { const rows = await getPg()`SELECT * FROM admins WHERE username=${username}`; return rows[0] || null; }
export async function getAdminById(adminId: string) { const rows = await getPg()`SELECT id, username, role, must_change_password, is_disabled, last_seen_at FROM admins WHERE id=${adminId}`; return rows[0] || null; }
export async function touchAdmin(adminId: string) { await getPg()`UPDATE admins SET last_seen_at=${now()} WHERE id=${adminId} AND is_disabled=0`; }
export async function listAdmins() { return [...await getPg()`SELECT id,username,role,must_change_password,created_at,is_disabled,disabled_at,last_seen_at FROM admins ORDER BY role DESC, created_at`]; }
export async function listOperatorAccounts() { return [...await getPg()`SELECT id,username,role,created_at,is_disabled,disabled_at,last_seen_at FROM admins WHERE role='OPERATOR' ORDER BY is_disabled, username`]; }
export function isAdminOnline(row: any) { return Boolean(row?.last_seen_at && Date.now() - new Date(row.last_seen_at).getTime() < 2 * 60 * 1000 && !row.is_disabled); }
export async function createAdmin(input: { username: string; password: string; role?: string; mustChangePassword?: number; createdAt?: string }) {
  if ((input.role || 'OPERATOR') !== 'OPERATOR') throw new Error('ONLY_OPERATOR_CAN_BE_CREATED');
  const t = input.createdAt || now(); const adminId = id('admin');
  await getPg()`INSERT INTO admins(id,username,password_hash,role,must_change_password,created_at,updated_at,is_disabled,last_seen_at) VALUES (${adminId},${input.username},${hashPassword(input.password)},'OPERATOR',${input.mustChangePassword ?? 0},${t},${t},0,NULL)`;
  return adminId;
}
export async function disableOperator(adminId: string, actorId: string) { const t = now(); const sql = getPg(); const rows = await sql`UPDATE admins SET is_disabled=1,disabled_at=${t},updated_at=${t} WHERE id=${adminId} AND role='OPERATOR' RETURNING id`; if (!rows[0]) return false; await sql`UPDATE sessions SET deleted_at=${t},deleted_by=${actorId},assigned_operator_id=NULL,updated_at=${t} WHERE deleted_at IS NULL AND (assigned_operator_id=${adminId} OR last_operator_id=${adminId})`; return true; }
export async function updateOwnAdmin(adminId: string, input: { username?: string; password?: string }) { const t = now(); let rows: any[] = []; if (input.username && input.password) rows = await getPg()`UPDATE admins SET username=${input.username},password_hash=${hashPassword(input.password)},must_change_password=0,updated_at=${t} WHERE id=${adminId} AND role='SUPER_ADMIN' RETURNING id`; else if (input.username) rows = await getPg()`UPDATE admins SET username=${input.username},updated_at=${t} WHERE id=${adminId} AND role='SUPER_ADMIN' RETURNING id`; else if (input.password) rows = await getPg()`UPDATE admins SET password_hash=${hashPassword(input.password)},must_change_password=0,updated_at=${t} WHERE id=${adminId} AND role='SUPER_ADMIN' RETURNING id`; return Boolean(rows[0]); }

export async function registerVisitorAccount(input: { username: string; password: string; displayName?: string }) { const t = now(); const accountId = id('acct'); const displayName = input.displayName || input.username; await getPg()`INSERT INTO visitor_accounts VALUES (${accountId},${input.username},${hashPassword(input.password)},${displayName},${t},${t},${t})`; return { id: accountId, username: input.username, display_name: displayName, last_login_at: t }; }
export async function loginVisitorAccount(username: string, password: string) { const rows = await getPg()`SELECT * FROM visitor_accounts WHERE username=${username}`; const account: any = rows[0]; if (!account || !verifyPassword(password, account.password_hash)) return null; const t = now(); await getPg()`UPDATE visitor_accounts SET last_login_at=${t},updated_at=${t} WHERE id=${account.id}`; return { id: account.id, username: account.username, display_name: account.display_name, last_login_at: t }; }
export async function getVisitorAccountById(accountId: string) { const rows = await getPg()`SELECT id,username,display_name,last_login_at FROM visitor_accounts WHERE id=${accountId}`; return rows[0] || null; }

export async function upsertVisitor(visitorId?: string, account?: any) {
  const key = account ? `acct_${account.id}` : (visitorId || id('visitor'));
  const t = now();
  const sql = getPg();
  let rows = await sql`SELECT * FROM users WHERE visitor_key=${key}`;
  let user: any = rows[0];
  const displayName = account?.display_name || `游客 ${key.slice(-6)}`;
  if (!user) {
    await sql`INSERT INTO users(id,visitor_key,account_id,display_name,last_seen_at,created_at,updated_at) VALUES (${id('user')},${key},${account?.id || null},${displayName},${t},${t},${t})`;
    rows = await sql`SELECT * FROM users WHERE visitor_key=${key}`;
    user = rows[0];
  } else {
    await sql`UPDATE users SET account_id=${account?.id || user.account_id},display_name=${displayName},last_seen_at=${t},updated_at=${t} WHERE id=${user.id}`;
  }
  return { key, user };
}
export async function getLatestSession(userId: string) {
  const rows = await getPg()`SELECT * FROM sessions WHERE user_id=${userId} AND status != 'ARCHIVED' AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1`;
  return rows[0] || null;
}
export async function findUserByVisitorKey(visitorKey: string) {
  if (!visitorKey) return null;
  const rows = await getPg()`SELECT * FROM users WHERE visitor_key=${visitorKey}`;
  return rows[0] || null;
}
export async function getSessionById(sessionId: string) {
  const rows = await getPg()`SELECT * FROM sessions WHERE id=${sessionId}`;
  return rows[0] || null;
}
export async function getOrCreateSession(userId: string) { const t = now(); const sql = getPg(); let rows = await sql`SELECT * FROM sessions WHERE user_id=${userId} AND status != 'ARCHIVED' AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1`; let session: any = rows[0]; if (!session || session.status === 'CLOSED') { const sid = id('sess'); await sql`INSERT INTO sessions(id,user_id,status,created_at,updated_at,last_operator_id) VALUES (${sid},${userId},'PENDING',${t},${t},NULL)`; rows = await sql`SELECT * FROM sessions WHERE id=${sid}`; session = rows[0]; } return session; }
export async function getMessages(sessionId: string) { return [...await getPg()`SELECT * FROM messages WHERE session_id=${sessionId} ORDER BY created_at`]; }
export async function listSessions(includeDeleted = false) { const where = includeDeleted ? 'WHERE EXISTS (SELECT 1 FROM messages mx WHERE mx.session_id=s.id)' : 'WHERE s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM messages mx WHERE mx.session_id=s.id)'; return [...await getPg().unsafe(`SELECT s.*,u.visitor_key,u.display_name,a.username operator_name,(SELECT COUNT(*) FROM messages m WHERE m.session_id=s.id AND m.sender_type='VISITOR' AND m.is_read=0) unread_count FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN admins a ON a.id=s.assigned_operator_id ${where} ORDER BY COALESCE(s.deleted_at,s.updated_at) DESC`)]; }
export async function insertMessage(b: any, senderType: 'VISITOR' | 'OPERATOR', senderId: string) { const t = now(); const msg = { id: id('msg'), session_id: b.sessionId, sender_type: senderType, sender_id: senderId, content: b.content || '', message_type: b.messageType || 'text', image_path: b.imagePath || null, status: 'sent', created_at: t, read_at: null, is_read: 0, quote_message_id: b.quoteMessageId || null, recalled_at: null, image_purged_at: null }; const sql = getPg(); await sql`INSERT INTO messages(id,session_id,sender_type,sender_id,content,message_type,image_path,status,created_at,read_at,is_read,quote_message_id,recalled_at,image_purged_at) VALUES (${msg.id},${msg.session_id},${msg.sender_type},${msg.sender_id},${msg.content},${msg.message_type},${msg.image_path},${msg.status},${msg.created_at},${msg.read_at},${msg.is_read},${msg.quote_message_id},${msg.recalled_at},${msg.image_purged_at})`; await sql`UPDATE sessions SET status=CASE WHEN status='CLOSED' AND ${senderType}='VISITOR' THEN 'PENDING' ELSE status END, updated_at=${t} WHERE id=${b.sessionId} AND deleted_at IS NULL`; return msg; }
export async function assignSession(sessionId: string, adminId: string) { const t = now(); await getPg()`UPDATE sessions SET assigned_operator_id=${adminId},last_operator_id=${adminId},status='OPEN',updated_at=${t} WHERE id=${sessionId} AND deleted_at IS NULL`; }
export async function closeSession(sessionId: string) { const t = now(); await getPg()`UPDATE sessions SET status='CLOSED',assigned_operator_id=NULL,updated_at=${t} WHERE id=${sessionId} AND deleted_at IS NULL`; }
export async function softDeleteSession(sessionId: string, adminId: string) { const t = now(); await getPg()`UPDATE sessions SET deleted_at=${t},deleted_by=${adminId},updated_at=${t} WHERE id=${sessionId} AND deleted_at IS NULL`; }
export async function restoreSession(sessionId: string) { const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); const rows = await getPg()`UPDATE sessions SET deleted_at=NULL,deleted_by=NULL,updated_at=${now()} WHERE id=${sessionId} AND deleted_at IS NOT NULL AND deleted_at >= ${cutoff} RETURNING id`; return Boolean(rows[0]); }
export async function markVisitorMessagesRead(sessionId: string) { const t = now(); await getPg()`UPDATE messages SET is_read=1,status='read',read_at=COALESCE(read_at,${t}) WHERE session_id=${sessionId} AND sender_type='VISITOR'`; }

export async function listStaffMessages() { return [...await getPg()`SELECT sm.*,a.username sender_name FROM staff_messages sm JOIN admins a ON a.id=sm.sender_admin_id ORDER BY sm.created_at DESC LIMIT 80`].reverse(); }
export async function addStaffMessage(adminId: string, content: string) { const t = now(); const msgId = id('staffmsg'); await getPg()`INSERT INTO staff_messages VALUES (${msgId},${adminId},${content},${t})`; return { id: msgId, sender_admin_id: adminId, content, created_at: t }; }
export async function log(event: string, message: string, level = 'INFO', actor?: string) { try { const t = now(), lid = id('log'); await getPg()`INSERT INTO system_logs VALUES (${lid},${level},${event},${actor || null},${message},${t})`; } catch (e) { console.error(e); } }



export async function recallMessage(messageId: string, adminId: string) { const t = now(); const rows = await getPg()`UPDATE messages SET status='recalled',content='',image_path=NULL,recalled_at=${t} WHERE id=${messageId} AND sender_type='OPERATOR' AND sender_id=${adminId} RETURNING id`; return Boolean(rows[0]); }
export async function purgeAdminImages(adminId: string) { const t = now(); await getPg()`UPDATE messages SET image_path=NULL,image_purged_at=${t},content='' WHERE sender_id=${adminId} AND message_type='image'`; }
export async function hardDeleteDisabledOperator(adminId: string) { const sql = getPg(); await sql`UPDATE sessions SET assigned_operator_id=NULL,last_operator_id=NULL WHERE assigned_operator_id=${adminId} OR last_operator_id=${adminId}`; const rows = await sql`DELETE FROM admins WHERE id=${adminId} AND role='OPERATOR' AND is_disabled=1 RETURNING id`; return Boolean(rows[0]); }
export async function markOperatorMessagesRead(sessionId: string) { const t = now(); await getPg()`UPDATE messages SET is_read=1,status=CASE WHEN status='sent' THEN 'read' ELSE status END,read_at=COALESCE(read_at,${t}) WHERE session_id=${sessionId} AND sender_type='OPERATOR' AND status!='recalled'`; }

export async function bindGuestToAccount(visitorKey: string, account: any) {
  if (!visitorKey || !visitorKey.startsWith('visitor_')) return;
  const accountKey = `acct_${account.id}`;
  const t = now();
  const sql = getPg();
  const accountUser = await sql`SELECT id FROM users WHERE visitor_key=${accountKey}`;
  const guestUser = await sql`SELECT id FROM users WHERE visitor_key=${visitorKey}`;
  if (!guestUser[0]) return;
  if (accountUser[0]) {
    await sql`UPDATE sessions SET user_id=${accountUser[0].id}, updated_at=${t} WHERE user_id=${guestUser[0].id}`;
    await sql`DELETE FROM users WHERE id=${guestUser[0].id}`;
  } else {
    await sql`UPDATE users SET visitor_key=${accountKey}, account_id=${account.id}, display_name=${account.display_name}, updated_at=${t} WHERE id=${guestUser[0].id}`;
  }
}

export async function deleteGuestHistory(visitorKey: string) {
  if (!visitorKey || !visitorKey.startsWith('visitor_')) return;
  await getPg()`DELETE FROM users WHERE visitor_key=${visitorKey}`;
}


