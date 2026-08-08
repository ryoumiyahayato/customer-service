import { readFileSync, writeFileSync } from 'node:fs';

function read(path) { return readFileSync(path, 'utf8'); }
function write(path, content) { writeFileSync(path, content); }
function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, got ${count}`);
  return source.replace(before, after);
}

// Static risk-control assertions now target the typed policy authority.
{
  const path = 'tests/unit/adminRiskControls.test.mjs';
  let s = read(path);
  s = s.replace(`  assert.match(operatorPolicy, /operator_policy:/);`, `  assert.match(operatorPolicy, /FROM operator_policies WHERE admin_id=\\?/);\n  assert.doesNotMatch(operatorPolicy, /operator_policy:/);`);
  s = s.replace(`  assert.match(chatRoom, /canUseStaffChat/);`, `  assert.match(chatRoom, /can_use_staff_chat/);`);
  write(path, s);
}

// P1 convergence asserts fail-closed typed policy, not the removed JSON parser.
{
  const path = 'tests/unit/p1ArchitectureConvergence.test.mjs';
  let s = read(path);
  s = s.replace(`  assert.match(policy, /parseStoredOperatorPolicy/);`, `  assert.match(policy, /FROM operator_policies WHERE admin_id=\\?/);\n  assert.doesNotMatch(policy, /parseStoredOperatorPolicy|operator_policy:/);`);
  write(path, s);
}

// UI regression guard follows structured active-session state and consolidated stylesheet.
{
  const path = 'tests/unit/postPr45UiRegressionGuards.test.mjs';
  let s = read(path);
  s = s.replace(`  assert.match(source, /ACTIVE_ADMIN_SESSION_PREFIX = 'admin_active_session:'/);`, `  assert.match(source, /FROM admin_active_sessions WHERE admin_id=\\?/);\n  assert.doesNotMatch(source, /admin_active_session:/);`);
  s = s.replace(`  const css = await read('src/admin/adminRegressionFixes.css');`, `  const css = await read('src/admin/adminWorkspace.css');`);
  write(path, s);
}

// Durable Object authorization fixture now owns the same typed policy table as production.
{
  const path = 'tests/unit/staffChatRoomAuthorization.test.mjs';
  let s = read(path);
  s = replaceOnce(s,
`    CREATE TABLE settings (\n      key TEXT PRIMARY KEY,\n      value_json TEXT NOT NULL,\n      updated_at TEXT NOT NULL\n    );`,
`    CREATE TABLE operator_policies (\n      admin_id TEXT PRIMARY KEY,\n      can_create_invites INTEGER NOT NULL,\n      can_use_staff_chat INTEGER NOT NULL,\n      can_upload_images INTEGER NOT NULL,\n      updated_at TEXT NOT NULL\n    );`,
    'unit staff policy schema');
  s = replaceOnce(s,
`  if (role === 'OPERATOR') {\n    database.prepare('INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?)').run(\n      \`operator_policy:${'${id}'}\`,\n      JSON.stringify({ canCreateInvites: true, canUseStaffChat: true, canUploadImages: true }),\n      NOW,\n    );\n  }`,
`  if (role === 'OPERATOR') {\n    database.prepare('INSERT INTO operator_policies(admin_id,can_create_invites,can_use_staff_chat,can_upload_images,updated_at) VALUES(?,?,?,?,?)')\n      .run(id, 1, 1, 1, NOW);\n  }`,
    'unit staff seed typed policy');
  s = replaceOnce(s,
`    database.prepare('UPDATE settings SET value_json=?,updated_at=? WHERE key=?')\n      .run(JSON.stringify({ canCreateInvites: true, canUseStaffChat: false, canUploadImages: true }), NOW, 'operator_policy:operator-a');`,
`    database.prepare('UPDATE operator_policies SET can_use_staff_chat=0,updated_at=? WHERE admin_id=?')\n      .run(NOW, 'operator-a');`,
    'unit staff revoke typed policy');
  write(path, s);
}

// WebSocket handshake integration uses typed policy state as production does.
{
  const path = 'tests/integration/staffSocketHandshake.sqlite.test.mjs';
  let s = read(path);
  s = replaceOnce(s,
`    CREATE TABLE settings (\n      key TEXT PRIMARY KEY,\n      value_json TEXT NOT NULL,\n      updated_at TEXT NOT NULL\n    );`,
`    CREATE TABLE operator_policies (\n      admin_id TEXT PRIMARY KEY,\n      can_create_invites INTEGER NOT NULL,\n      can_use_staff_chat INTEGER NOT NULL,\n      can_upload_images INTEGER NOT NULL,\n      updated_at TEXT NOT NULL\n    );`,
    'integration staff policy schema');
  s = s.replace(/\nfunction enabledPolicy\(canUseStaffChat = true\) \{[\s\S]*?\n\}\n/, '\n');
  s = replaceOnce(s,
`  if (role === 'OPERATOR') {\n    database.prepare('INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?)')\n      .run(\`operator_policy:${'${id}'}\`, enabledPolicy(true), NOW);\n  }`,
`  if (role === 'OPERATOR') {\n    database.prepare('INSERT INTO operator_policies(admin_id,can_create_invites,can_use_staff_chat,can_upload_images,updated_at) VALUES(?,?,?,?,?)')\n      .run(id, 1, 1, 1, NOW);\n  }`,
    'integration staff seed typed policy');
  s = replaceOnce(s,
`    database.prepare('UPDATE settings SET value_json=?,updated_at=? WHERE key=?')\n      .run(enabledPolicy(false), NOW, 'operator_policy:operator-a');`,
`    database.prepare('UPDATE operator_policies SET can_use_staff_chat=0,updated_at=? WHERE admin_id=?')\n      .run(NOW, 'operator-a');`,
    'integration staff deny typed policy');
  s = replaceOnce(s,
`    database.prepare('UPDATE settings SET value_json=?,updated_at=? WHERE key=?')\n      .run(enabledPolicy(true), NOW, 'operator_policy:operator-a');`,
`    database.prepare('UPDATE operator_policies SET can_use_staff_chat=1,updated_at=? WHERE admin_id=?')\n      .run(NOW, 'operator-a');`,
    'integration staff allow typed policy');
  write(path, s);
}

console.log('migrated implementation-specific tests to typed PR52 contracts');
