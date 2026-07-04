ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS body_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS body_iv TEXT,
  ADD COLUMN IF NOT EXISTS body_tag TEXT,
  ADD COLUMN IF NOT EXISTS body_algorithm TEXT,
  ADD COLUMN IF NOT EXISTS body_key_version TEXT,
  ADD COLUMN IF NOT EXISTS body_plaintext_migrated_at TIMESTAMPTZ;

ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS filename_ciphertext TEXT,
  ADD COLUMN IF NOT EXISTS filename_iv TEXT,
  ADD COLUMN IF NOT EXISTS filename_tag TEXT,
  ADD COLUMN IF NOT EXISTS filename_algorithm TEXT,
  ADD COLUMN IF NOT EXISTS filename_key_version TEXT,
  ADD COLUMN IF NOT EXISTS metadata_encrypted_at TIMESTAMPTZ;
