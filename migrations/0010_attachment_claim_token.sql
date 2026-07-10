ALTER TABLE attachments ADD COLUMN claim_token TEXT;

CREATE INDEX IF NOT EXISTS idx_attachments_unbound_claim
  ON attachments(conversation_id, object_key, created_by_type, created_by_id, message_id, claim_token)
  WHERE message_id IS NULL AND deleted_at IS NULL;
