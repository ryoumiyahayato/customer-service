import { readFileSync, writeFileSync } from 'node:fs';

function patch(path, transform) {
  const before = readFileSync(path, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`${path}: transform made no change`);
  writeFileSync(path, after);
}

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected one match, got ${count}`);
  return source.replace(before, after);
}

patch('src/worker-final.ts', source => {
  let next = replaceOnce(
    source,
    "export { ChatRoom } from './worker-entry';\nimport worker from './worker-entry';",
    "export { ChatRoom } from './worker-preset';\nimport worker from './worker-preset';",
    'worker-final preset wrapper',
  );
  next = replaceOnce(next, '    welcomeText: presentation.welcomeText,\n', '', 'worker-final remove welcome payload');
  return next;
});

for (const path of ['src/worker-entry.ts', 'src/worker-presentation.ts']) {
  patch(path, source => replaceOnce(
    source,
    '    welcomeText: presentation.welcomeText,\n',
    '',
    `${path} remove welcome payload`,
  ));
}

patch('src/operatorPresentation.ts', source => replaceOnce(
  source,
  `  /** Legacy adapters may still read this key while PR #52 converges. It is intentionally never populated. */\n  welcomeText?: undefined;\n`,
  '',
  'remove temporary welcome compatibility field',
));

patch('tests/integration/visitorChatDelivery.sqlite.test.mjs', source => replaceOnce(
  source,
  `    CREATE TABLE admin_active_sessions (\n      admin_id TEXT PRIMARY KEY,\n      session_id TEXT NOT NULL UNIQUE,\n      updated_at TEXT NOT NULL\n    );\n`,
  `    CREATE TABLE admin_active_sessions (\n      admin_id TEXT PRIMARY KEY,\n      session_id TEXT NOT NULL UNIQUE,\n      updated_at TEXT NOT NULL\n    );\n    CREATE TABLE operator_preset_messages (\n      id TEXT PRIMARY KEY,\n      admin_id TEXT NOT NULL,\n      position INTEGER NOT NULL DEFAULT 0,\n      message_type TEXT NOT NULL,\n      content TEXT NOT NULL DEFAULT '',\n      image_object_key TEXT,\n      image_mime_type TEXT,\n      image_byte_size INTEGER,\n      created_at TEXT NOT NULL,\n      updated_at TEXT NOT NULL\n    );\n    CREATE TABLE operator_preset_applications (\n      session_id TEXT PRIMARY KEY,\n      owner_admin_id TEXT NOT NULL,\n      applied_at TEXT NOT NULL\n    );\n`,
  'visitor delivery preset tables',
));

patch('tests/integration/operatorPresetDelivery.sqlite.test.mjs', source => replaceOnce(
  source,
  'FROM messages WHERE session_id=? ORDER BY datetime(created_at),id',
  'FROM messages WHERE session_id=? ORDER BY created_at,id',
  'preset integration millisecond order',
));

console.log('PR52 preset worker integration applied');
