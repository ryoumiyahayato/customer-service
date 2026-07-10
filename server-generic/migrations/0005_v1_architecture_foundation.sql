CREATE TABLE IF NOT EXISTS invite_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash TEXT NOT NULL UNIQUE,
  created_by_admin_id UUID NOT NULL REFERENCES admins(id) ON DELETE RESTRICT,
  source_admin_id UUID REFERENCES admins(id) ON DELETE SET NULL,
  session_id UUID REFERENCES chat_sessions(id) ON DELETE SET NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invite_links_active_idx
  ON invite_links(expires_at, created_at DESC)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS invite_links_created_by_idx
  ON invite_links(created_by_admin_id, created_at DESC);

CREATE INDEX IF NOT EXISTS invite_links_session_idx
  ON invite_links(session_id)
  WHERE session_id IS NOT NULL;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS client_message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS messages_sender_client_message_idx
  ON messages(session_id, sender_type, sender_id, client_message_id)
  WHERE client_message_id IS NOT NULL;

ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS purged_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES admins(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES admins(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_operator_id UUID REFERENCES admins(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS chat_sessions_purged_at_idx ON chat_sessions(purged_at);
CREATE INDEX IF NOT EXISTS chat_sessions_assigned_operator_idx ON chat_sessions(assigned_operator_id);
