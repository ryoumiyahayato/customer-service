CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  display_name TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('SUPER_ADMIN','OPERATOR')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  is_disabled INTEGER NOT NULL DEFAULT 0,
  disabled_at TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_super_admin ON admins(role) WHERE role='SUPER_ADMIN';

CREATE TABLE IF NOT EXISTS visitor_accounts (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  last_login_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  visitor_key TEXT UNIQUE NOT NULL,
  account_id TEXT REFERENCES visitor_accounts(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  last_seen_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  assigned_operator_id TEXT REFERENCES admins(id),
  last_operator_id TEXT REFERENCES admins(id),
  status TEXT NOT NULL CHECK(status IN ('PENDING','OPEN','CLOSED','ARCHIVED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  deleted_by TEXT REFERENCES admins(id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_deleted_at ON sessions(deleted_at);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK(sender_type IN ('VISITOR','OPERATOR')),
  sender_id TEXT NOT NULL,
  content TEXT,
  message_type TEXT NOT NULL CHECK(message_type IN ('text','image')),
  image_path TEXT,
  status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','delivered','read','recalled')),
  created_at TEXT NOT NULL,
  read_at TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  quote_message_id TEXT,
  recalled_at TEXT,
  image_purged_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS staff_messages (
  id TEXT PRIMARY KEY,
  sender_admin_id TEXT NOT NULL REFERENCES admins(id),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_staff_messages_created ON staff_messages(created_at);

CREATE TABLE IF NOT EXISTS system_logs (
  id TEXT PRIMARY KEY,
  level TEXT NOT NULL,
  event TEXT NOT NULL,
  actor_id TEXT,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_token_hash ON admin_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_id ON admin_sessions(admin_id);

CREATE TABLE IF NOT EXISTS visitor_sessions (
  id TEXT PRIMARY KEY,
  visitor_account_id TEXT REFERENCES visitor_accounts(id) ON DELETE CASCADE,
  visitor_key TEXT,
  token_hash TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_token_hash ON visitor_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_visitor_key ON visitor_sessions(visitor_key);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
  conversation_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  object_key TEXT UNIQUE NOT NULL,
  file_name TEXT,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  created_by_type TEXT CHECK(created_by_type IN ('VISITOR','OPERATOR')),
  created_by_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_attachments_conversation_id ON attachments(conversation_id);
CREATE INDEX IF NOT EXISTS idx_attachments_created_at ON attachments(created_at);

CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);

CREATE VIEW IF NOT EXISTS conversations AS
SELECT
  s.id,
  s.user_id,
  s.assigned_operator_id,
  s.last_operator_id,
  s.status,
  s.created_at,
  s.updated_at AS last_message_at,
  s.deleted_at,
  s.deleted_by
FROM sessions s;
