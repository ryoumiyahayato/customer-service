import crypto from 'crypto';
import postgres from 'postgres';

export const now = () => new Date().toISOString();
export const id = (prefix = 'id') => `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
let pg: ReturnType<typeof postgres> | null = null;
let ready: Promise<void> | null = null;

function getPg() {
  if (!connectionString) throw new Error('POSTGRES_URL or DATABASE_URL is required. Add a Vercel Postgres/Neon database and set the connection string in Environment Variables.');
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
  const existing = await getAdminByUsername('admin');
  if (existing) return;
  const password = process.env.DEFAULT_ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  const t = now();
  await createAdmin({ username: 'admin', password, role: 'SUPER_ADMIN', mustChangePassword: process.env.DEFAULT_ADMIN_PASSWORD ? 0 : 1, createdAt: t });
  console.log(`Default admin created: username=admin password=${password}`);
  await log('ADMIN_BOOTSTRAP', 'Default admin created');
}

async function initPostgres() {
  const sql = getPg();
  await sql`CREATE TABLE IF NOT EXISTS admins (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('SUPER_ADMIN','OPERATOR')), must_change_password INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, visitor_key TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, last_seen_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), assigned_operator_id TEXT REFERENCES admins(id), last_operator_id TEXT REFERENCES admins(id), status TEXT NOT NULL CHECK(status IN ('PENDING','OPEN','CLOSED','ARCHIVED')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), sender_type TEXT NOT NULL CHECK(sender_type IN ('VISITOR','OPERATOR')), sender_id TEXT NOT NULL, content TEXT, message_type TEXT NOT NULL CHECK(message_type IN ('text','image')), image_path TEXT, status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','delivered','read')), created_at TEXT NOT NULL, read_at TEXT, is_read INTEGER NOT NULL DEFAULT 0)`;
  await sql`CREATE TABLE IF NOT EXISTS system_logs (id TEXT PRIMARY KEY, level TEXT NOT NULL, event TEXT NOT NULL, actor_id TEXT, message TEXT NOT NULL, created_at TEXT NOT NULL)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`;
}

export async function initDb() { if (!ready) ready = (async () => { await initPostgres(); await ensureDefaultAdmin(); })(); return ready; }
export async function getAdminByUsername(username: string) { const rows = await getPg()`SELECT * FROM admins WHERE username=${username}`; return rows[0] || null; }
export async function getAdminById(adminId: string) { const rows = await getPg()`SELECT id, username, role, must_change_password FROM admins WHERE id=${adminId}`; return rows[0] || null; }
export async function listAdmins() { return [...await getPg()`SELECT id,username,role,must_change_password,created_at FROM admins ORDER BY created_at`]; }
export async function createAdmin(input: { username: string; password: string; role?: string; mustChangePassword?: number; createdAt?: string }) { const t = input.createdAt || now(); const adminId = id('admin'); const hash = hashPassword(input.password); await getPg()`INSERT INTO admins VALUES (${adminId},${input.username},${hash},${input.role || 'OPERATOR'},${input.mustChangePassword ?? 0},${t},${t})`; return adminId; }
export async function upsertVisitor(visitorId?: string) { const key = visitorId || id('visitor'); const t = now(); const sql = getPg(); let rows = await sql`SELECT * FROM users WHERE visitor_key=${key}`; let user: any = rows[0]; if (!user) { await sql`INSERT INTO users VALUES (${id('user')},${key},${`访客 ${key.slice(-6)}`},${t},${t},${t})`; rows = await sql`SELECT * FROM users WHERE visitor_key=${key}`; user = rows[0]; } else await sql`UPDATE users SET last_seen_at=${t},updated_at=${t} WHERE id=${user.id}`; return { key, user }; }
export async function getOrCreateSession(userId: string) { const t = now(); const sql = getPg(); let rows = await sql`SELECT * FROM sessions WHERE user_id=${userId} AND status != 'ARCHIVED' ORDER BY updated_at DESC LIMIT 1`; let session: any = rows[0]; if (!session || session.status === 'CLOSED') { const sid = id('sess'); await sql`INSERT INTO sessions(id,user_id,status,created_at,updated_at,last_operator_id) VALUES (${sid},${userId},'PENDING',${t},${t},NULL)`; rows = await sql`SELECT * FROM sessions WHERE id=${sid}`; session = rows[0]; } return session; }
export async function getMessages(sessionId: string) { return [...await getPg()`SELECT * FROM messages WHERE session_id=${sessionId} ORDER BY created_at`]; }
export async function listSessions() { return [...await getPg().unsafe(`SELECT s.*,u.visitor_key,u.display_name,a.username operator_name,(SELECT COUNT(*) FROM messages m WHERE m.session_id=s.id AND m.sender_type='VISITOR' AND m.is_read=0) unread_count FROM sessions s JOIN users u ON u.id=s.user_id LEFT JOIN admins a ON a.id=s.assigned_operator_id ORDER BY s.updated_at DESC`)]; }
export async function insertMessage(b: any, senderType: 'VISITOR' | 'OPERATOR', senderId: string) { const t = now(); const msg = { id: id('msg'), session_id: b.sessionId, sender_type: senderType, sender_id: senderId, content: b.content || '', message_type: b.messageType || 'text', image_path: b.imagePath || null, status: 'sent', created_at: t, read_at: null, is_read: 0 }; const sql = getPg(); await sql`INSERT INTO messages VALUES (${msg.id},${msg.session_id},${msg.sender_type},${msg.sender_id},${msg.content},${msg.message_type},${msg.image_path},${msg.status},${msg.created_at},${msg.read_at},${msg.is_read})`; await sql`UPDATE sessions SET status=CASE WHEN status='CLOSED' AND ${senderType}='VISITOR' THEN 'PENDING' ELSE status END, updated_at=${t} WHERE id=${b.sessionId}`; return msg; }
export async function assignSession(sessionId: string, adminId: string) { const t = now(); await getPg()`UPDATE sessions SET assigned_operator_id=${adminId},last_operator_id=${adminId},status='OPEN',updated_at=${t} WHERE id=${sessionId}`; }
export async function closeSession(sessionId: string) { const t = now(); await getPg()`UPDATE sessions SET status='CLOSED',assigned_operator_id=NULL,updated_at=${t} WHERE id=${sessionId}`; }
export async function markVisitorMessagesRead(sessionId: string) { const t = now(); await getPg()`UPDATE messages SET is_read=1,status='read',read_at=COALESCE(read_at,${t}) WHERE session_id=${sessionId} AND sender_type='VISITOR'`; }
export async function log(event: string, message: string, level = 'INFO', actor?: string) { try { const t = now(), lid = id('log'); await getPg()`INSERT INTO system_logs VALUES (${lid},${level},${event},${actor || null},${message},${t})`; } catch (e) { console.error(e); } }
