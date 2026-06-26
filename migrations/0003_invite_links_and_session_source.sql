CREATE TABLE IF NOT EXISTS invite_links (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  source_operator_id TEXT REFERENCES admins(id),
  created_by_admin_id TEXT NOT NULL REFERENCES admins(id),
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  consumed_session_id TEXT REFERENCES sessions(id),
  revoked_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_invite_links_token_hash ON invite_links(token_hash);
CREATE INDEX IF NOT EXISTS idx_invite_links_source_operator_id ON invite_links(source_operator_id);
CREATE INDEX IF NOT EXISTS idx_invite_links_expires_at ON invite_links(expires_at);

ALTER TABLE sessions ADD COLUMN source_user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_source_user_id ON sessions(source_user_id);
