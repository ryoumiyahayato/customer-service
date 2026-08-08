-- Structured runtime state replaces the overloaded settings:* JSON key space.
-- This migration runs after 0012, so operator policies have already been repaired,
-- but every copy below remains fail-closed if legacy data is unexpectedly malformed.

CREATE TABLE IF NOT EXISTS operator_policies (
  admin_id TEXT PRIMARY KEY,
  can_create_invites INTEGER NOT NULL DEFAULT 0 CHECK (can_create_invites IN (0,1)),
  can_use_staff_chat INTEGER NOT NULL DEFAULT 0 CHECK (can_use_staff_chat IN (0,1)),
  can_upload_images INTEGER NOT NULL DEFAULT 0 CHECK (can_upload_images IN (0,1)),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS operator_presentations (
  admin_id TEXT PRIMARY KEY,
  welcome_text TEXT NOT NULL DEFAULT '您好，请问有什么可以帮您？',
  avatar_key TEXT NOT NULL DEFAULT '',
  qr_background_color TEXT NOT NULL DEFAULT '#ffffff',
  qr_accent_color TEXT NOT NULL DEFAULT '#18b868',
  qr_top_text TEXT NOT NULL DEFAULT '扫码联系客服',
  qr_bottom_text TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS session_client_metadata (
  session_id TEXT PRIMARY KEY,
  device_label TEXT NOT NULL DEFAULT '',
  approximate_location TEXT NOT NULL DEFAULT '',
  captured_at TEXT NOT NULL,
  ip_address TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS admin_session_metadata (
  session_id TEXT PRIMARY KEY,
  device_label TEXT NOT NULL DEFAULT '',
  approximate_location TEXT NOT NULL DEFAULT '',
  captured_at TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES admin_sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS admin_active_sessions (
  admin_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES admin_sessions(id) ON DELETE CASCADE
);

-- Policies: malformed, partial, duplicate-key, or non-boolean legacy rows become deny-all.
INSERT INTO operator_policies(admin_id,can_create_invites,can_use_staff_chat,can_upload_images,updated_at)
SELECT a.id,
  CASE WHEN json_valid(s.value_json)=1
    AND json_type(s.value_json,'$')='object'
    AND (SELECT COUNT(*) FROM json_each(s.value_json) WHERE key='canCreateInvites')=1
    AND json_type(s.value_json,'$.canCreateInvites') IN ('true','false')
    THEN CASE json_type(s.value_json,'$.canCreateInvites') WHEN 'true' THEN 1 ELSE 0 END ELSE 0 END,
  CASE WHEN json_valid(s.value_json)=1
    AND json_type(s.value_json,'$')='object'
    AND (SELECT COUNT(*) FROM json_each(s.value_json) WHERE key='canUseStaffChat')=1
    AND json_type(s.value_json,'$.canUseStaffChat') IN ('true','false')
    THEN CASE json_type(s.value_json,'$.canUseStaffChat') WHEN 'true' THEN 1 ELSE 0 END ELSE 0 END,
  CASE WHEN json_valid(s.value_json)=1
    AND json_type(s.value_json,'$')='object'
    AND (SELECT COUNT(*) FROM json_each(s.value_json) WHERE key='canUploadImages')=1
    AND json_type(s.value_json,'$.canUploadImages') IN ('true','false')
    THEN CASE json_type(s.value_json,'$.canUploadImages') WHEN 'true' THEN 1 ELSE 0 END ELSE 0 END,
  COALESCE(NULLIF(s.updated_at,''),datetime('now'))
FROM admins a
LEFT JOIN settings s ON s.key=('operator_policy:' || a.id)
WHERE a.role='OPERATOR'
ON CONFLICT(admin_id) DO UPDATE SET
  can_create_invites=excluded.can_create_invites,
  can_use_staff_chat=excluded.can_use_staff_chat,
  can_upload_images=excluded.can_upload_images,
  updated_at=excluded.updated_at;

-- Presentation is non-security display data. Invalid/missing fields fall back to safe defaults.
INSERT INTO operator_presentations(admin_id,welcome_text,avatar_key,qr_background_color,qr_accent_color,qr_top_text,qr_bottom_text,updated_at)
SELECT a.id,
  CASE WHEN json_valid(s.value_json)=1 AND json_type(s.value_json,'$.welcomeText')='text' THEN substr(json_extract(s.value_json,'$.welcomeText'),1,300) ELSE '您好，请问有什么可以帮您？' END,
  CASE WHEN json_valid(s.value_json)=1 AND json_type(s.value_json,'$.avatarKey')='text' THEN substr(json_extract(s.value_json,'$.avatarKey'),1,512) ELSE '' END,
  CASE WHEN json_valid(s.value_json)=1 AND json_type(s.value_json,'$.qrBackgroundColor')='text' THEN substr(json_extract(s.value_json,'$.qrBackgroundColor'),1,16) ELSE '#ffffff' END,
  CASE WHEN json_valid(s.value_json)=1 AND json_type(s.value_json,'$.qrAccentColor')='text' THEN substr(json_extract(s.value_json,'$.qrAccentColor'),1,16) ELSE '#18b868' END,
  CASE WHEN json_valid(s.value_json)=1 AND json_type(s.value_json,'$.qrTopText')='text' THEN substr(json_extract(s.value_json,'$.qrTopText'),1,18) ELSE '扫码联系客服' END,
  CASE WHEN json_valid(s.value_json)=1 AND json_type(s.value_json,'$.qrBottomText')='text' THEN substr(json_extract(s.value_json,'$.qrBottomText'),1,18) ELSE '' END,
  COALESCE(NULLIF(s.updated_at,''),datetime('now'))
FROM admins a
LEFT JOIN settings s ON s.key=('operator_presentation:' || a.id)
ON CONFLICT(admin_id) DO UPDATE SET
  welcome_text=excluded.welcome_text,
  avatar_key=excluded.avatar_key,
  qr_background_color=excluded.qr_background_color,
  qr_accent_color=excluded.qr_accent_color,
  qr_top_text=excluded.qr_top_text,
  qr_bottom_text=excluded.qr_bottom_text,
  updated_at=excluded.updated_at;

INSERT INTO session_client_metadata(session_id,device_label,approximate_location,captured_at,ip_address)
SELECT se.id,
  CASE WHEN json_valid(s.value_json)=1 AND json_type(s.value_json,'$.deviceLabel')='text' THEN substr(json_extract(s.value_json,'$.deviceLabel'),1,120) ELSE '' END,
  CASE WHEN json_valid(s.value_json)=1 AND json_type(s.value_json,'$.approximateLocation')='text' THEN substr(json_extract(s.value_json,'$.approximateLocation'),1,160) ELSE '' END,
  CASE WHEN json_valid(s.value_json)=1 AND json_type(s.value_json,'$.capturedAt')='text' THEN json_extract(s.value_json,'$.capturedAt') ELSE COALESCE(NULLIF(s.updated_at,''),datetime('now')) END,
  CASE WHEN json_valid(s.value_json)=1 AND json_type(s.value_json,'$.ipAddress')='text' THEN substr(json_extract(s.value_json,'$.ipAddress'),1,64) ELSE '' END
FROM sessions se
JOIN settings s ON s.key=('session_client_meta:' || se.id)
ON CONFLICT(session_id) DO UPDATE SET
  device_label=excluded.device_label,
  approximate_location=excluded.approximate_location,
  captured_at=excluded.captured_at,
  ip_address=excluded.ip_address;

INSERT INTO admin_session_metadata(session_id,device_label,approximate_location,captured_at)
SELECT ase.id,
  CASE WHEN json_valid(s.value_json)=1 AND json_type(s.value_json,'$.deviceLabel')='text' THEN substr(json_extract(s.value_json,'$.deviceLabel'),1,120) ELSE '' END,
  CASE WHEN json_valid(s.value_json)=1 AND json_type(s.value_json,'$.approximateLocation')='text' THEN substr(json_extract(s.value_json,'$.approximateLocation'),1,160) ELSE '' END,
  CASE WHEN json_valid(s.value_json)=1 AND json_type(s.value_json,'$.capturedAt')='text' THEN json_extract(s.value_json,'$.capturedAt') ELSE COALESCE(NULLIF(s.updated_at,''),datetime('now')) END
FROM admin_sessions ase
JOIN settings s ON s.key=('admin_session_meta:' || ase.id)
ON CONFLICT(session_id) DO UPDATE SET
  device_label=excluded.device_label,
  approximate_location=excluded.approximate_location,
  captured_at=excluded.captured_at;

INSERT INTO admin_active_sessions(admin_id,session_id,updated_at)
SELECT a.id,s.value_json,COALESCE(NULLIF(s.updated_at,''),datetime('now'))
FROM admins a
JOIN settings s ON s.key=('admin_active_session:' || a.id)
JOIN admin_sessions ase ON ase.id=s.value_json AND ase.admin_id=a.id
WHERE ase.revoked_at IS NULL
ON CONFLICT(admin_id) DO UPDATE SET session_id=excluded.session_id,updated_at=excluded.updated_at;

-- 0012 owned policy invariants in settings. Replace those triggers with typed-table invariants.
DROP TRIGGER IF EXISTS trg_admins_seed_operator_policy;
DROP TRIGGER IF EXISTS trg_admins_seed_operator_policy_on_role;
DROP TRIGGER IF EXISTS trg_operator_policy_validate_insert;
DROP TRIGGER IF EXISTS trg_operator_policy_validate_update;
DROP TRIGGER IF EXISTS trg_operator_policy_prevent_rename;
DROP TRIGGER IF EXISTS trg_operator_policy_prevent_delete;

CREATE TRIGGER IF NOT EXISTS trg_admins_seed_operator_policy
AFTER INSERT ON admins
FOR EACH ROW
WHEN NEW.role='OPERATOR'
BEGIN
  INSERT OR IGNORE INTO operator_policies(admin_id,can_create_invites,can_use_staff_chat,can_upload_images,updated_at)
  VALUES(NEW.id,1,1,1,datetime('now'));
END;

CREATE TRIGGER IF NOT EXISTS trg_admins_seed_operator_policy_on_role
AFTER UPDATE OF role ON admins
FOR EACH ROW
WHEN NEW.role='OPERATOR' AND OLD.role<>'OPERATOR'
BEGIN
  INSERT INTO operator_policies(admin_id,can_create_invites,can_use_staff_chat,can_upload_images,updated_at)
  VALUES(NEW.id,1,1,1,datetime('now'))
  ON CONFLICT(admin_id) DO UPDATE SET
    can_create_invites=1,
    can_use_staff_chat=1,
    can_upload_images=1,
    updated_at=excluded.updated_at;
END;

CREATE TRIGGER IF NOT EXISTS trg_operator_policy_prevent_delete
BEFORE DELETE ON operator_policies
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM admins a WHERE a.id=OLD.admin_id AND a.role='OPERATOR')
BEGIN
  SELECT RAISE(ABORT,'operator_policy_required');
END;

-- Delete migrated dynamic runtime keys. settings remains for true global/application settings only.
DELETE FROM settings WHERE key LIKE 'operator_policy:%';
DELETE FROM settings WHERE key LIKE 'operator_presentation:%';
DELETE FROM settings WHERE key LIKE 'session_client_meta:%';
DELETE FROM settings WHERE key LIKE 'admin_active_session:%';
DELETE FROM settings WHERE key LIKE 'admin_session_meta:%';
