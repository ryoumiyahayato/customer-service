const crypto = require('crypto');
const postgres = require('postgres');

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error('POSTGRES_URL or DATABASE_URL is required.');
const defaultAdminUsername = process.env.DEFAULT_ADMIN_USERNAME;
const defaultAdminPassword = process.env.DEFAULT_ADMIN_PASSWORD;
if (!defaultAdminUsername || !defaultAdminPassword) throw new Error('DEFAULT_ADMIN_USERNAME and DEFAULT_ADMIN_PASSWORD are required.');
const sql = postgres(connectionString, { ssl: 'require', max: 1 });
const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

async function main() {
  await sql`CREATE TABLE IF NOT EXISTS admins (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('SUPER_ADMIN','OPERATOR')), must_change_password INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, is_disabled INTEGER NOT NULL DEFAULT 0, disabled_at TEXT, last_seen_at TEXT)`;
  await sql`CREATE TABLE IF NOT EXISTS visitor_accounts (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, display_name TEXT NOT NULL, last_login_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, visitor_key TEXT UNIQUE NOT NULL, account_id TEXT REFERENCES visitor_accounts(id) ON DELETE SET NULL, display_name TEXT NOT NULL, last_seen_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), assigned_operator_id TEXT REFERENCES admins(id), last_operator_id TEXT REFERENCES admins(id), status TEXT NOT NULL CHECK(status IN ('PENDING','OPEN','CLOSED','ARCHIVED')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, deleted_by TEXT REFERENCES admins(id))`;
  await sql`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, sender_type TEXT NOT NULL CHECK(sender_type IN ('VISITOR','OPERATOR')), sender_id TEXT NOT NULL, content TEXT, message_type TEXT NOT NULL CHECK(message_type IN ('text','image')), image_path TEXT, status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','delivered','read')), created_at TEXT NOT NULL, read_at TEXT, is_read INTEGER NOT NULL DEFAULT 0)`;
  await sql`CREATE TABLE IF NOT EXISTS staff_messages (id TEXT PRIMARY KEY, sender_admin_id TEXT NOT NULL REFERENCES admins(id), content TEXT NOT NULL, created_at TEXT NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS system_logs (id TEXT PRIMARY KEY, level TEXT NOT NULL, event TEXT NOT NULL, actor_id TEXT, message TEXT NOT NULL, created_at TEXT NOT NULL)`;
  for (const statement of [
    sql`ALTER TABLE admins ADD COLUMN is_disabled INTEGER NOT NULL DEFAULT 0`,
    sql`ALTER TABLE admins ADD COLUMN disabled_at TEXT`,
    sql`ALTER TABLE admins ADD COLUMN last_seen_at TEXT`,
    sql`ALTER TABLE users ADD COLUMN account_id TEXT REFERENCES visitor_accounts(id) ON DELETE SET NULL`,
    sql`ALTER TABLE sessions ADD COLUMN deleted_at TEXT`,
    sql`ALTER TABLE sessions ADD COLUMN deleted_by TEXT REFERENCES admins(id)`
  ]) { try { await statement; } catch {} }
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS one_super_admin ON admins ((role)) WHERE role='SUPER_ADMIN'`;
  await sql`CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_deleted_at ON sessions(deleted_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_visitor_accounts_last_login ON visitor_accounts(last_login_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_staff_messages_created ON staff_messages(created_at)`;
  const visitorCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  await sql`DELETE FROM visitor_accounts WHERE last_login_at < ${visitorCutoff}`;
  const sessionCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  await sql`DELETE FROM sessions WHERE deleted_at IS NOT NULL AND deleted_at < ${sessionCutoff}`;
  const existing = await sql`SELECT id FROM admins WHERE role='SUPER_ADMIN' LIMIT 1`;
  const t = now();
  if (existing[0]) {
    if (process.env.RESET_SUPER_ADMIN_ON_BOOTSTRAP === '1') {
      await sql`UPDATE admins SET username=${defaultAdminUsername}, password_hash=${hashPassword(defaultAdminPassword)}, must_change_password=0, is_disabled=0, updated_at=${t} WHERE id=${existing[0].id}`;
      console.log(`Default super admin reset: username=${defaultAdminUsername}`);
    }
  } else {
    await sql`INSERT INTO admins(id,username,password_hash,role,must_change_password,created_at,updated_at,is_disabled,last_seen_at) VALUES (${id('admin')},${defaultAdminUsername},${hashPassword(defaultAdminPassword)},'SUPER_ADMIN',0,${t},${t},0,${t})`;
    console.log(`Default super admin created: username=${defaultAdminUsername}`);
  }
  console.log('Database ready.');
}

main().finally(() => sql.end());
