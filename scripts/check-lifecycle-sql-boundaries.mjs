#!/usr/bin/env node

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const database = new DatabaseSync(':memory:');
database.exec(`
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    updated_at TEXT,
    deleted_at TEXT
  );
`);

const reference = '2026-07-10T12:00:00.000Z';
const cases = [
  ['before-boundary', '2026-07-09T12:01:00.000Z', 0],
  ['exact-boundary', '2026-07-09T12:00:00.000Z', 1],
  ['after-boundary', '2026-07-09T11:59:00.000Z', 1],
  ['sqlite-space-format', '2026-07-09 12:00:00', 1],
];

const insert = database.prepare('INSERT INTO sessions(id,updated_at,deleted_at) VALUES(?,?,?)');
for (const [id, timestamp] of cases) insert.run(id, timestamp, timestamp);

const activeStatement = database.prepare(
  `SELECT datetime(updated_at) <= datetime(?, '-24 hours') AS eligible
     FROM sessions WHERE id=?`,
);
const trashStatement = database.prepare(
  `SELECT datetime(deleted_at) <= datetime(?, '-24 hours') AS eligible
     FROM sessions WHERE id=?`,
);

for (const [id, , expected] of cases) {
  const active = activeStatement.get(reference, id);
  const trash = trashStatement.get(reference, id);
  assert.equal(Number(active.eligible), expected, `active cutoff mismatch for ${id}`);
  assert.equal(Number(trash.eligible), expected, `trash cutoff mismatch for ${id}`);
}

database.close();
console.log('lifecycle SQLite 23h59m / 24h / 24h01m boundary checks passed');
