ALTER TABLE sessions ADD COLUMN purged_at TEXT;

UPDATE sessions
SET purged_at = history_cleared_at
WHERE deleted_at IS NOT NULL
  AND history_cleared_at IS NOT NULL
  AND purged_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_purged_at
ON sessions(purged_at);
