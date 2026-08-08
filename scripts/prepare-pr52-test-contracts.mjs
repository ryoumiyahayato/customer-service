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

// Deployment test checks the new safer ordering: explicit deploy delegates before preflight build.
{
  const path = 'tests/unit/deploymentSafety.test.mjs';
  let s = read(path);
  s = s.replace(`  assert.match(wrapper, /if \\(!deployRequested\\)/);`, `  assert.match(wrapper, /if \\(deployRequested\\)/);\n  assert.ok(wrapper.indexOf('if (deployRequested)') < wrapper.indexOf("['run', 'build']"));`);
  write(path, s);
}

// Presentation unit tests no longer assert a settings key; storage is covered by typed-table integration.
{
  const path = 'tests/unit/operatorPresentation.test.mjs';
  let s = read(path);
  s = s.replace(`  normalizeOperatorPresentation,\n  operatorPresentationKey,`, `  normalizeOperatorPresentation,`);
  s = s.replace(/\ntest\('operator presentation uses a stable settings key',[\s\S]*?\n\}\);\n/, '\n');
  write(path, s);
}

// Invite presentation fixture writes the typed presentation table directly.
{
  const path = 'tests/unit/invitePresentationFallback.test.mjs';
  let s = read(path);
  s = s.replace(`const { operatorPresentationKey } = await import('../../src/operatorPresentation.ts');\n`, '');
  s = replaceOnce(s,
`    CREATE TABLE settings (\n      key TEXT PRIMARY KEY,\n      value_json TEXT NOT NULL,\n      updated_at TEXT NOT NULL\n    );`,
`    CREATE TABLE operator_presentations (\n      admin_id TEXT PRIMARY KEY,\n      welcome_text TEXT NOT NULL,\n      avatar_key TEXT NOT NULL,\n      qr_background_color TEXT NOT NULL,\n      qr_accent_color TEXT NOT NULL,\n      qr_top_text TEXT NOT NULL,\n      qr_bottom_text TEXT NOT NULL,\n      updated_at TEXT NOT NULL\n    );`,
    'invite presentation schema');
  s = replaceOnce(s,
`  database.prepare('INSERT INTO settings(key,value_json,updated_at) VALUES(?,?,?)')\n    .run(\n      operatorPresentationKey(id),\n      JSON.stringify({\n        welcomeText,\n        avatarKey: '',\n        qrBackgroundColor: '#ffffff',\n        qrAccentColor: '#18b868',\n        qrTopText: '扫码联系客服',\n        qrBottomText: '',\n      }),\n      new Date().toISOString(),\n    );`,
`  database.prepare(\`INSERT INTO operator_presentations(\n      admin_id,welcome_text,avatar_key,qr_background_color,qr_accent_color,qr_top_text,qr_bottom_text,updated_at\n    ) VALUES(?,?,?,?,?,?,?,?)\`)\n    .run(id, welcomeText, '', '#ffffff', '#18b868', '扫码联系客服', '', new Date().toISOString());`,
    'invite typed presentation seed');
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
