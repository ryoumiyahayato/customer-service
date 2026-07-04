ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS filename TEXT,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS attachments_deleted_at_idx ON attachments(deleted_at);

ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS history_cleared_by TEXT,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS chat_sessions_history_cleared_at_idx ON chat_sessions(history_cleared_at);
