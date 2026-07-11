import Database from 'better-sqlite3';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(dataDir, { recursive: true });
export const db = new Database(process.env.DATABASE_PATH || path.join(dataDir, 'support.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDb() {
  db.exec(`
CREATE TABLE IF NOT EXISTS admins (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('SUPER_ADMIN','OPERATOR')), must_change_password INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, visitor_key TEXT UNIQUE NOT NULL, display_name TEXT NOT NULL, last_seen_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, assigned_operator_id TEXT, last_operator_id TEXT, status TEXT NOT NULL CHECK(status IN ('PENDING','OPEN','CLOSED','ARCHIVED')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(assigned_operator_id) REFERENCES admins(id), FOREIGN KEY(last_operator_id) REFERENCES admins(id));
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, sender_type TEXT NOT NULL CHECK(sender_type IN ('VISITOR','OPERATOR')), sender_id TEXT NOT NULL, content TEXT, message_type TEXT NOT NULL CHECK(message_type IN ('text','image')), image_path TEXT, status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','delivered','read')), created_at TEXT NOT NULL, read_at TEXT, is_read INTEGER NOT NULL DEFAULT 0, FOREIGN KEY(session_id) REFERENCES sessions(id));
CREATE TABLE IF NOT EXISTS system_logs (id TEXT PRIMARY KEY, level TEXT NOT NULL, event TEXT NOT NULL, actor_id TEXT, message TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
`);
  ensureDefaultAdmin();
}
export const now = () => new Date().toISOString();
export const id = (prefix='id') => `${prefix}_${crypto.randomBytes(12).toString('hex')}`;
export function log(event:string, message:string, level='INFO', actor?:string){db.prepare('INSERT INTO system_logs VALUES (?,?,?,?,?,?)').run(id('log'), level, event, actor||null, message, now());}
function ensureDefaultAdmin(){
 const row = db.prepare('SELECT id FROM admins WHERE username=?').get('admin');
 if(!row){const password=crypto.randomBytes(9).toString('base64url'); const t=now(); db.prepare('INSERT INTO admins VALUES (?,?,?,?,?,?,?)').run(id('admin'),'admin',bcrypt.hashSync(password,10),'SUPER_ADMIN',1,t,t); console.log(`Default admin created: username=admin password=${password}`); log('ADMIN_BOOTSTRAP','Default admin created');}
}
initDb();
