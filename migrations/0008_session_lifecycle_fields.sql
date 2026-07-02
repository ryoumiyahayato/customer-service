ALTER TABLE sessions ADD COLUMN closed_at TEXT;
ALTER TABLE sessions ADD COLUMN history_cleared_at TEXT;
ALTER TABLE sessions ADD COLUMN history_cleared_by TEXT;

UPDATE sessions
SET closed_at = COALESCE(updated_at, datetime('now'))
WHERE status = 'CLOSED'
  AND closed_at IS NULL;

UPDATE sessions
SET closed_at = COALESCE(archived_at, updated_at, datetime('now'))
WHERE status = 'ARCHIVED'
  AND closed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_closed_at
ON sessions(closed_at);

CREATE INDEX IF NOT EXISTS idx_sessions_history_cleared_at
ON sessions(history_cleared_at);
