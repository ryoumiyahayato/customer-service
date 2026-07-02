ALTER TABLE admin_sessions ADD COLUMN last_seen_at TEXT;

UPDATE admin_sessions
SET last_seen_at = COALESCE(created_at, datetime('now'))
WHERE last_seen_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_admin_sessions_last_seen_at
ON admin_sessions(last_seen_at);
