ALTER TABLE messages ADD COLUMN client_message_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_dedupe
ON messages(session_id, sender_type, sender_id, client_message_id)
WHERE client_message_id IS NOT NULL;

ALTER TABLE attachments ADD COLUMN expires_at TEXT;
ALTER TABLE attachments ADD COLUMN deleted_at TEXT;

CREATE INDEX IF NOT EXISTS idx_attachments_expires_at ON attachments(expires_at);
CREATE INDEX IF NOT EXISTS idx_attachments_deleted_at ON attachments(deleted_at);
