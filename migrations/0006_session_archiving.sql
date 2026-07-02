ALTER TABLE sessions ADD COLUMN archived_at TEXT;
ALTER TABLE sessions ADD COLUMN archived_by TEXT;

UPDATE sessions
SET archived_at = COALESCE(updated_at, datetime('now'))
WHERE status = 'ARCHIVED'
  AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_archived_at
ON sessions(archived_at);
