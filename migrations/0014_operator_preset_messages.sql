-- Preset chat content is real future chat history, not presentation chrome.
-- Each row is owned by one admin/operator and is copied into a newly consumed
-- visitor conversation in position order.
CREATE TABLE IF NOT EXISTS operator_preset_messages (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0 CHECK(position >= 0),
  message_type TEXT NOT NULL CHECK(message_type IN ('text','image')),
  content TEXT NOT NULL DEFAULT '',
  image_object_key TEXT,
  image_mime_type TEXT,
  image_byte_size INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(admin_id) REFERENCES admins(id) ON DELETE CASCADE,
  CHECK(
    (message_type='text' AND length(trim(content)) BETWEEN 1 AND 1000 AND image_object_key IS NULL)
    OR
    (message_type='image' AND content='' AND image_object_key IS NOT NULL AND image_mime_type IN ('image/jpeg','image/png','image/webp') AND image_byte_size BETWEEN 1 AND 5242880)
  )
);
CREATE INDEX IF NOT EXISTS idx_operator_preset_messages_owner_position
  ON operator_preset_messages(admin_id,position,created_at,id);

-- Preserve existing configured welcome text by converting it into the first real
-- server-authored preset message. Runtime/UI code stops reading welcome_text after
-- this migration; it remains only as migration history in operator_presentations.
INSERT INTO operator_preset_messages(id,admin_id,position,message_type,content,image_object_key,image_mime_type,image_byte_size,created_at,updated_at)
SELECT 'preset_migrated_' || substr(hex(randomblob(12)),1,24),
       p.admin_id,
       0,
       'text',
       substr(trim(p.welcome_text),1,1000),
       NULL,NULL,NULL,
       COALESCE(NULLIF(p.updated_at,''),datetime('now')),
       COALESCE(NULLIF(p.updated_at,''),datetime('now'))
FROM operator_presentations p
WHERE length(trim(p.welcome_text)) > 0
  AND NOT EXISTS (SELECT 1 FROM operator_preset_messages m WHERE m.admin_id=p.admin_id);
