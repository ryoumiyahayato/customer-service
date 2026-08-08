-- Preserve the current product behavior for operators that predate explicit policies:
-- every existing operator receives the previously implied all-enabled policy.
INSERT INTO settings(key,value_json,updated_at)
SELECT 'operator_policy:' || id,
       '{"canCreateInvites":true,"canUseStaffChat":true,"canUploadImages":true}',
       datetime('now')
FROM admins
WHERE role='OPERATOR'
ON CONFLICT(key) DO NOTHING;

-- Corrupt or partial policy rows must never become an implicit allow. Repair them to
-- an explicit deny-all state before the validation triggers below take ownership.
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
    WHEN COALESCE(json_type(value_json,'$.canCreateInvites'),'') NOT IN ('true','false') THEN 1
    WHEN COALESCE(json_type(value_json,'$.canUseStaffChat'),'') NOT IN ('true','false') THEN 1
    WHEN COALESCE(json_type(value_json,'$.canUploadImages'),'') NOT IN ('true','false') THEN 1
    ELSE 0
  END = 1;

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
  INSERT OR IGNORE INTO settings(key,value_json,updated_at)
  VALUES(
    'operator_policy:' || NEW.id,
    '{"canCreateInvites":true,"canUseStaffChat":true,"canUploadImages":true}',
    datetime('now')
  );
END;

-- Only complete boolean policy documents are accepted. This converts the existing
-- application-level permissive fallback into an unreachable state under the D1 schema.
CREATE TRIGGER IF NOT EXISTS trg_operator_policy_validate_insert
BEFORE INSERT ON settings
FOR EACH ROW
WHEN NEW.key LIKE 'operator_policy:%'
  AND CASE
    WHEN json_valid(NEW.value_json)=0 THEN 1
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
