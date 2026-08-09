-- Security resource accounting and durable object-cleanup retry state.
-- This migration is append-only; prior migrations are intentionally untouched.

ALTER TABLE sessions ADD COLUMN message_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN message_bytes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN unclaimed_attachment_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN unclaimed_attachment_bytes INTEGER NOT NULL DEFAULT 0;

ALTER TABLE visitor_sessions ADD COLUMN last_seen_at TEXT;
ALTER TABLE visitor_sessions ADD COLUMN session_id TEXT;
CREATE INDEX IF NOT EXISTS visitor_sessions_session_id_idx ON visitor_sessions(session_id);

UPDATE sessions
   SET message_count = COALESCE((SELECT COUNT(*) FROM messages m WHERE m.session_id=sessions.id), 0),
       message_bytes = COALESCE((SELECT SUM(LENGTH(CAST(COALESCE(m.content,'') AS BLOB))) FROM messages m WHERE m.session_id=sessions.id), 0),
       unclaimed_attachment_count = COALESCE((SELECT COUNT(*) FROM attachments a WHERE a.conversation_id=sessions.id AND a.message_id IS NULL AND a.deleted_at IS NULL), 0),
       unclaimed_attachment_bytes = COALESCE((SELECT SUM(COALESCE(a.byte_size,0)) FROM attachments a WHERE a.conversation_id=sessions.id AND a.message_id IS NULL AND a.deleted_at IS NULL), 0);

UPDATE attachments
   SET expires_at = datetime('now', '+10 minutes')
 WHERE message_id IS NULL
   AND deleted_at IS NULL
   AND expires_at IS NULL;

CREATE TABLE IF NOT EXISTS attachment_cleanup_jobs (
  id TEXT PRIMARY KEY,
  attachment_id TEXT,
  conversation_id TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS attachment_cleanup_jobs_due_idx
  ON attachment_cleanup_jobs(next_attempt_at, completed_at);

-- A message quota reservation is consumed in the same D1 batch as the
-- message insert and counter update.  It prevents concurrent writers from
-- bypassing the session quota between a preflight read and the insert.
CREATE TABLE IF NOT EXISTS message_quota_reservations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS message_quota_reservations_session_idx
  ON message_quota_reservations(session_id);
