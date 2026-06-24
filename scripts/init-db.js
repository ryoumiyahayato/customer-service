const crypto = require('crypto');
const postgres = require('postgres');

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error('POSTGRES_URL or DATABASE_URL is required.');
const sql = postgres(connectionString, { ssl: 'require', max: 1 });
const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

async function main() {
  await sql`CREATE TABLE IF NOT EXISTS admins (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('SUPER_ADMIN','OPERATOR')), must_change_password INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, visitor_key TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, last_seen_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), assigned_operator_id TEXT REFERENCES admins(id), last_operator_id TEXT REFERENCES admins(id), status TEXT NOT NULL CHECK(status IN ('PENDING','OPEN','CLOSED','ARCHIVED')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), sender_type TEXT NOT NULL CHECK(sender_type IN ('VISITOR','OPERATOR')), sender_id TEXT NOT NULL, content TEXT, message_type TEXT NOT NULL CHECK(message_type IN ('text','image')), image_path TEXT, status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','delivered','read')), created_at TEXT NOT NULL, read_at TEXT, is_read INTEGER NOT NULL DEFAULT 0)`;
  await sql`CREATE TABLE IF NOT EXISTS system_logs (id TEXT PRIMARY KEY, level TEXT NOT NULL, event TEXT NOT NULL, actor_id TEXT, message TEXT NOT NULL, created_at TEXT NOT NULL)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`;
  const existing = await sql`SELECT id FROM admins WHERE username='admin'`;
  if (!existing[0]) {
    const password = process.env.DEFAULT_ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
    const t = now();
    await sql`INSERT INTO admins VALUES (${id('admin')},'admin',${hashPassword(password)},'SUPER_ADMIN',${process.env.DEFAULT_ADMIN_PASSWORD ? 0 : 1},${t},${t})`;
    console.log(`Default admin created: username=admin password=${password}`);
  }
  console.log('Database ready.');
}

main().finally(() => sql.end());
