-- CLOSED is retained only for reading legacy archived rows.
-- Any row that is unarchived must return to an active state.
UPDATE sessions
SET status = CASE
      WHEN assigned_operator_id IS NULL THEN 'PENDING'
      ELSE 'OPEN'
    END,
    closed_at = NULL
WHERE status = 'CLOSED'
  AND archived_at IS NULL
  AND deleted_at IS NULL
  AND purged_at IS NULL;

-- Compatibility guard for older application builds that still write CLOSED
-- while clearing archived_at. The trigger is idempotent and stops firing after
-- the status has been normalized to PENDING or OPEN.
CREATE TRIGGER IF NOT EXISTS trg_sessions_normalize_unarchive
AFTER UPDATE OF archived_at, status ON sessions
FOR EACH ROW
WHEN NEW.status = 'CLOSED'
  AND NEW.archived_at IS NULL
  AND NEW.deleted_at IS NULL
  AND NEW.purged_at IS NULL
  AND (
    OLD.archived_at IS NOT NULL
    OR OLD.status IN ('ARCHIVED', 'CLOSED')
  )
BEGIN
  UPDATE sessions
  SET status = CASE
        WHEN NEW.assigned_operator_id IS NULL THEN 'PENDING'
        ELSE 'OPEN'
      END,
      closed_at = NULL
  WHERE id = NEW.id;
END;
