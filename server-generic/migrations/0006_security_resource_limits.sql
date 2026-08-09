-- Security resource accounting, visitor capability sessions, and cleanup retry state.
-- This is a new migration. Existing migration files remain immutable.

ALTER TABLE admin_sessions
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;

ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS message_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS message_bytes BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unclaimed_attachment_count BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unclaimed_attachment_bytes BIGINT NOT NULL DEFAULT 0;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recalled_at TIMESTAMPTZ;

ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS visitor_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS visitor_sessions_chat_session_idx ON visitor_sessions(chat_session_id);
CREATE INDEX IF NOT EXISTS visitor_sessions_expiry_idx ON visitor_sessions(expires_at) WHERE revoked_at IS NULL;

INSERT INTO visitor_sessions(chat_session_id, token_hash, created_at, last_seen_at, expires_at)
SELECT id, visitor_token_hash, created_at, now(), now() + interval '30 days'
  FROM chat_sessions
 WHERE visitor_token_hash IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM visitor_sessions vs WHERE vs.token_hash=chat_sessions.visitor_token_hash);

CREATE TABLE IF NOT EXISTS attachment_cleanup_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id UUID,
  chat_session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  storage_key TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_error TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attachment_cleanup_jobs_due_idx
  ON attachment_cleanup_jobs(next_attempt_at, completed_at);

CREATE TABLE IF NOT EXISTS system_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  level TEXT NOT NULL,
  event TEXT NOT NULL,
  actor_id TEXT,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
