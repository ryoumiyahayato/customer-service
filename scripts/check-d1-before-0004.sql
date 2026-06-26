-- Preflight checks before applying migrations/0004_message_dedupe_and_attachment_expiry.sql.
-- Run these against the target D1 database before any remote 0004 apply.
-- This file is read-only guidance; do not pipe it into a production migration apply.

-- 1) Confirm whether 0004 columns already exist.
PRAGMA table_info(messages);
PRAGMA table_info(attachments);

-- Required manual checks from the PRAGMA output:
-- - messages.client_message_id must NOT exist before applying 0004.
-- - attachments.expires_at must NOT exist before applying 0004.
-- - attachments.deleted_at must NOT exist before applying 0004.
-- If any of those fields already exist, do not rerun 0004 as-is. Use a patch migration
-- for only the missing pieces, or repair the D1 migration state manually after verifying schema.

-- 2) Confirm no duplicate non-null client_message_id rows exist before creating the unique index.
SELECT session_id, sender_type, sender_id, client_message_id, COUNT(*) AS c
FROM messages
WHERE client_message_id IS NOT NULL
GROUP BY session_id, sender_type, sender_id, client_message_id
HAVING c > 1;

-- Decision rules:
-- - If all three fields are absent and the duplicate query returns zero rows, 0004 can be applied.
-- - If fields are partially present, do not apply 0004 again; create a targeted patch migration
--   or manually reconcile migration state after confirming the real schema.
-- - If the duplicate query returns any rows, fix or merge those duplicates before creating
--   idx_messages_client_dedupe.
-- - Prefer testing 0004 on local or staging D1 first. Do not run remote production apply until
--   these checks have been reviewed.
