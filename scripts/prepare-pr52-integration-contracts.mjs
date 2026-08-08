import { readFileSync, writeFileSync } from 'node:fs';

function read(path) { return readFileSync(path, 'utf8'); }
function write(path, content) { writeFileSync(path, content); }
function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, got ${count}`);
  return source.replace(before, after);
}

{
  const path = 'tests/integration/adminRiskControls.sqlite.test.mjs';
  let s = read(path);
  s = replaceOnce(s,
`    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );`,
`    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE operator_policies (
      admin_id TEXT PRIMARY KEY,
      can_create_invites INTEGER NOT NULL DEFAULT 0,
      can_use_staff_chat INTEGER NOT NULL DEFAULT 0,
      can_upload_images INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );`,
    'admin risk typed policy fixture');
  write(path, s);
}

{
  const path = 'tests/integration/visitorChatDelivery.sqlite.test.mjs';
  let s = read(path);
  s = replaceOnce(s,
`    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT
    );`,
`    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE TABLE operator_policies (
      admin_id TEXT PRIMARY KEY,
      can_create_invites INTEGER NOT NULL DEFAULT 0,
      can_use_staff_chat INTEGER NOT NULL DEFAULT 0,
      can_upload_images INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE operator_presentations (
      admin_id TEXT PRIMARY KEY,
      welcome_text TEXT NOT NULL DEFAULT '您好，请问有什么可以帮您？',
      avatar_key TEXT NOT NULL DEFAULT '',
      qr_background_color TEXT NOT NULL DEFAULT '#ffffff',
      qr_accent_color TEXT NOT NULL DEFAULT '#18b868',
      qr_top_text TEXT NOT NULL DEFAULT '扫码联系客服',
      qr_bottom_text TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE session_client_metadata (
      session_id TEXT PRIMARY KEY,
      device_label TEXT NOT NULL DEFAULT '',
      approximate_location TEXT NOT NULL DEFAULT '',
      captured_at TEXT NOT NULL,
      ip_address TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE admin_session_metadata (
      session_id TEXT PRIMARY KEY,
      device_label TEXT NOT NULL DEFAULT '',
      approximate_location TEXT NOT NULL DEFAULT '',
      captured_at TEXT NOT NULL
    );
    CREATE TABLE admin_active_sessions (
      admin_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      updated_at TEXT NOT NULL
    );`,
    'visitor delivery structured runtime fixture');
  write(path, s);
}

{
  const path = 'tests/integration/structuredRuntimeState.sqlite.test.mjs';
  let s = read(path);
  s = s.replace(
`  assert.deepEqual(x.prepare('SELECT can_create_invites,can_use_staff_chat,can_upload_images FROM operator_policies WHERE admin_id=?').get('op'), { can_create_invites: 0, can_use_staff_chat: 1, can_upload_images: 0 });`,
`  const migratedPolicy = x.prepare('SELECT can_create_invites,can_use_staff_chat,can_upload_images FROM operator_policies WHERE admin_id=?').get('op');
  assert.equal(migratedPolicy.can_create_invites, 0);
  assert.equal(migratedPolicy.can_use_staff_chat, 1);
  assert.equal(migratedPolicy.can_upload_images, 0);`);
  s = s.replace(
`  assert.deepEqual(x.prepare('SELECT can_create_invites,can_use_staff_chat,can_upload_images FROM operator_policies WHERE admin_id=?').get('future'), { can_create_invites: 1, can_use_staff_chat: 1, can_upload_images: 1 });`,
`  const promotedPolicy = x.prepare('SELECT can_create_invites,can_use_staff_chat,can_upload_images FROM operator_policies WHERE admin_id=?').get('future');
  assert.equal(promotedPolicy.can_create_invites, 1);
  assert.equal(promotedPolicy.can_use_staff_chat, 1);
  assert.equal(promotedPolicy.can_upload_images, 1);`);
  write(path, s);
}

console.log('migrated remaining integration fixtures to structured runtime state');
