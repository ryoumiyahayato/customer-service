-- Preserve the current product behavior for operators that predate explicit policies:
-- every existing operator receives the previously implied all-enabled policy.
INSERT INTO settings(key,value_json,updated_at)
SELECT 'operator_policy:' || id,
       '{"canCreateInvites":true,"canUseStaffChat":true,"canUploadImages":true}',
       datetime('now')
FROM admins
WHERE role='OPERATOR'
ON CONFLICT(key) DO NOTHING;

-- Corrupt, partial, non-object, or duplicate-key policy rows must never become an
-- implicit allow. Repair them to an explicit deny-all state before the validation
-- triggers below take ownership.
UPDATE settings
SET value_json='{"canCreateInvites":false,"canUseStaffChat":false,"canUploadImages":false}',
    updated_at=datetime('now')
WHERE key LIKE 'operator_policy:%'
  AND EXISTS (
    SELECT 1 FROM admins a
    WHERE a.id=substr(settings.key, length('operator_policy:') + 1)
      AND a.role='OPERATOR'
  )
  AND CASE
    WHEN json_valid(value_json)=0 THEN 1
    WHEN COALESCE(json_type(value_json,'$'),'')<>'object' THEN 1
    WHEN (SELECT COUNT(*) FROM json_each(CASE WHEN json_valid(value_json) THEN value_json ELSE '{}' END) WHERE key='canCreateInvites')<>1 THEN 1
    WHEN (SELECT COUNT(*) FROM json_each(CASE WHEN json_valid(value_json) THEN value_json ELSE '{}' END) WHERE key='canUseStaffChat')<>1 THEN 1
    WHEN (SELECT COUNT(*) FROM json_each(CASE WHEN json_valid(value_json) THEN value_json ELSE '{}' END) WHERE key='canUploadImages')<>1 THEN 1
    WHEN COALESCE(json_type(value_json,'$.canCreateInvites'),'') NOT IN ('true','false') THEN 1
    WHEN COALESCE(json_type(value_json,'$.canUseStaffChat'),'') NOT IN ('true','false') THEN 1
    WHEN COALESCE(json_type(value_json,'$.canUploadImages'),'') NOT IN ('true','false') THEN 1
    ELSE 0
  END = 1;

-- Operator IDs are stable security principals. Renaming one would orphan its mandatory
-- operator_policy:<id> row and can also invalidate historical ownership references, so
-- D1 rejects that state transition rather than attempting a cascading identity rewrite.
CREATE TRIGGER IF NOT EXISTS trg_operator_id_immutable
BEFORE UPDATE OF id ON admins
FOR EACH ROW
WHEN NEW.id<>OLD.id AND (OLD.role='OPERATOR' OR NEW.role='OPERATOR')
BEGIN
  SELECT RAISE(ABORT, 'operator_id_immutable');
END;

-- New operator creation must always create an explicit policy row in the same DB
-- transaction as the INSERT statement that creates the account.
CREATE TRIGGER IF NOT EXISTS trg_admins_seed_operator_policy
AFTER INSERT ON admins
FOR EACH ROW
WHEN NEW.role='OPERATOR'
BEGIN
  INSERT OR IGNORE INTO settings(key,value_json,updated_at)
  VALUES(
    'operator_policy:' || NEW.id,
    '{"canCreateInvites":true,"canUseStaffChat":true,"canUploadImages":true}',
    datetime('now')
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_admins_seed_operator_policy_on_role
AFTER UPDATE OF role ON admins
FOR EACH ROW
WHEN NEW.role='OPERATOR' AND OLD.role<>'OPERATOR'
BEGIN
  -- Promotion must establish a known-valid policy even if a stale pre-migration row
  -- already exists for this stable principal. Silently preserving malformed JSON would
  -- leave the newly promoted operator in an indeterminate capability state.
  INSERT INTO settings(key,value_json,updated_at)
  VALUES(
    'operator_policy:' || NEW.id,
    '{"canCreateInvites":true,"canUseStaffChat":true,"canUploadImages":true}',
    datetime('now')
  )
  ON CONFLICT(key) DO UPDATE SET
    value_json=excluded.value_json,
    updated_at=excluded.updated_at;
END;

-- Only complete boolean policy documents with exactly one occurrence of each required
-- capability key are accepted. Duplicate JSON keys are explicitly rejected because
-- SQLite path lookup and JavaScript JSON.parse can otherwise disagree about which
-- duplicate value is authoritative.
CREATE TRIGGER IF NOT EXISTS trg_operator_policy_validate_insert
BEFORE INSERT ON settings
FOR EACH ROW
WHEN NEW.key LIKE 'operator_policy:%'
  AND CASE
    WHEN json_valid(NEW.value_json)=0 THEN 1
    WHEN COALESCE(json_type(NEW.value_json,'$'),'')<>'object' THEN 1
    WHEN (SELECT COUNT(*) FROM json_each(CASE WHEN json_valid(NEW.value_json) THEN NEW.value_json ELSE '{}' END) WHERE key='canCreateInvites')<>1 THEN 1
    WHEN (SELECT COUNT(*) FROM json_each(CASE WHEN json_valid(NEW.value_json) THEN NEW.value_json ELSE '{}' END) WHERE key='canUseStaffChat')<>1 THEN 1
    WHEN (SELECT COUNT(*) FROM json_each(CASE WHEN json_valid(NEW.value_json) THEN NEW.value_json ELSE '{}' END) WHERE key='canUploadImages')<>1 THEN 1
    WHEN COALESCE(json_type(NEW.value_json,'$.canCreateInvites'),'') NOT IN ('true','false') THEN 1
    WHEN COALESCE(json_type(NEW.value_json,'$.canUseStaffChat'),'') NOT IN ('true','false') THEN 1
    WHEN COALESCE(json_type(NEW.value_json,'$.canUploadImages'),'') NOT IN ('true','false') THEN 1
    ELSE 0
  END = 1
BEGIN
  SELECT RAISE(ABORT, 'invalid_operator_policy');
END;

CREATE TRIGGER IF NOT EXISTS trg_operator_policy_validate_update
BEFORE UPDATE OF value_json ON settings
FOR EACH ROW
WHEN NEW.key LIKE 'operator_policy:%'
  AND CASE
    WHEN json_valid(NEW.value_json)=0 THEN 1
    WHEN COALESCE(json_type(NEW.value_json,'$'),'')<>'object' THEN 1
    WHEN (SELECT COUNT(*) FROM json_each(CASE WHEN json_valid(NEW.value_json) THEN NEW.value_json ELSE '{}' END) WHERE key='canCreateInvites')<>1 THEN 1
    WHEN (SELECT COUNT(*) FROM json_each(CASE WHEN json_valid(NEW.value_json) THEN NEW.value_json ELSE '{}' END) WHERE key='canUseStaffChat')<>1 THEN 1
    WHEN (SELECT COUNT(*) FROM json_each(CASE WHEN json_valid(NEW.value_json) THEN NEW.value_json ELSE '{}' END) WHERE key='canUploadImages')<>1 THEN 1
    WHEN COALESCE(json_type(NEW.value_json,'$.canCreateInvites'),'') NOT IN ('true','false') THEN 1
    WHEN COALESCE(json_type(NEW.value_json,'$.canUseStaffChat'),'') NOT IN ('true','false') THEN 1
    WHEN COALESCE(json_type(NEW.value_json,'$.canUploadImages'),'') NOT IN ('true','false') THEN 1
    ELSE 0
  END = 1
BEGIN
  SELECT RAISE(ABORT, 'invalid_operator_policy');
END;

-- Policy rows for live operators are mandatory and cannot be renamed away or deleted.
CREATE TRIGGER IF NOT EXISTS trg_operator_policy_prevent_rename
BEFORE UPDATE OF key ON settings
FOR EACH ROW
WHEN OLD.key LIKE 'operator_policy:%'
  AND NEW.key<>OLD.key
  AND EXISTS (
    SELECT 1 FROM admins a
    WHERE a.id=substr(OLD.key, length('operator_policy:') + 1)
      AND a.role='OPERATOR'
  )
BEGIN
  SELECT RAISE(ABORT, 'operator_policy_required');
END;

CREATE TRIGGER IF NOT EXISTS trg_operator_policy_prevent_delete
BEFORE DELETE ON settings
FOR EACH ROW
WHEN OLD.key LIKE 'operator_policy:%'
  AND EXISTS (
    SELECT 1 FROM admins a
    WHERE a.id=substr(OLD.key, length('operator_policy:') + 1)
      AND a.role='OPERATOR'
  )
BEGIN
  SELECT RAISE(ABORT, 'operator_policy_required');
END;
