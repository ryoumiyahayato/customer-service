ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS visitor_token_hash TEXT,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

ALTER TABLE chat_sessions
  ALTER COLUMN status SET DEFAULT 'open';

UPDATE chat_sessions
   SET status = lower(status)
 WHERE status IN ('OPEN', 'CLOSED');

CREATE UNIQUE INDEX IF NOT EXISTS chat_sessions_visitor_token_hash_idx
  ON chat_sessions(visitor_token_hash)
  WHERE visitor_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS chat_sessions_updated_at_idx ON chat_sessions(updated_at DESC);
CREATE INDEX IF NOT EXISTS chat_sessions_closed_at_idx ON chat_sessions(closed_at);

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS admin_id UUID REFERENCES admins(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS messages_admin_id_idx ON messages(admin_id);
