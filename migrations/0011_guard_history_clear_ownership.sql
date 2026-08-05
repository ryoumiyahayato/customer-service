ALTER TABLE sessions ADD COLUMN history_clear_claimed_at TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_history_clear_claimed_at
  ON sessions(history_clear_claimed_at);

-- A current history-clear claim owns destructive access to the session.
-- Legacy and new application instances must not reactivate or purge the row
-- until the claim is released. Claims older than one hour are considered stale.
CREATE TRIGGER IF NOT EXISTS trg_sessions_block_restore_during_history_clear
BEFORE UPDATE OF status, archived_at, deleted_at ON sessions
FOR EACH ROW
WHEN OLD.history_clear_claimed_at IS NOT NULL
  AND datetime(OLD.history_clear_claimed_at) > datetime('now', '-1 hour')
  AND (
    (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL)
    OR (OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL)
    OR (
      OLD.status NOT IN ('PENDING','OPEN')
      AND NEW.status IN ('PENDING','OPEN')
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'history_clear_in_progress');
END;

CREATE TRIGGER IF NOT EXISTS trg_sessions_block_purge_during_history_clear
BEFORE UPDATE OF purged_at ON sessions
FOR EACH ROW
WHEN OLD.history_clear_claimed_at IS NOT NULL
  AND datetime(OLD.history_clear_claimed_at) > datetime('now', '-1 hour')
  AND OLD.purged_at IS NULL
  AND NEW.purged_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'history_clear_in_progress');
END;
