import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const migration = readFileSync(
  new URL('../../migrations/0012_enforce_operator_policy_invariant.sql', import.meta.url),
  'utf8',
);

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE admins (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL
    );
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

function policy(db, id) {
  const row = db.prepare('SELECT value_json FROM settings WHERE key=?').get(`operator_policy:${id}`);
  return row ? JSON.parse(row.value_json) : null;
}

test('migration preserves valid legacy operators while repairing malformed and duplicate-key policy state', () => {
  const db = createDatabase();
  db.exec(`
    INSERT INTO admins(id,role) VALUES
      ('legacy','OPERATOR'),
      ('custom','OPERATOR'),
      ('corrupt','OPERATOR'),
      ('duplicate','OPERATOR'),
      ('super','SUPER_ADMIN');
    INSERT INTO settings(key,value_json,updated_at) VALUES
      ('operator_policy:custom','{"canCreateInvites":false,"canUseStaffChat":true,"canUploadImages":false}','2026-01-01T00:00:00Z'),
      ('operator_policy:corrupt','not-json','2026-01-01T00:00:00Z'),
      ('operator_policy:duplicate','{"canCreateInvites":false,"canCreateInvites":"oops","canUseStaffChat":true,"canUploadImages":true}','2026-01-01T00:00:00Z');
  `);

  db.exec(migration);

  assert.deepEqual(policy(db, 'legacy'), {
    canCreateInvites: true,
    canUseStaffChat: true,
    canUploadImages: true,
  });
  assert.deepEqual(policy(db, 'custom'), {
    canCreateInvites: false,
    canUseStaffChat: true,
    canUploadImages: false,
  });
  for (const id of ['corrupt', 'duplicate']) {
    assert.deepEqual(policy(db, id), {
      canCreateInvites: false,
      canUseStaffChat: false,
      canUploadImages: false,
    });
  }
  assert.equal(policy(db, 'super'), null);
  db.close();
});

test('new operators always receive an explicit legacy-compatible policy and keep an immutable principal id', () => {
  const db = createDatabase();
  db.exec(migration);
  db.prepare('INSERT INTO admins(id,role) VALUES(?,?)').run('new-op', 'OPERATOR');
  assert.deepEqual(policy(db, 'new-op'), {
    canCreateInvites: true,
    canUseStaffChat: true,
    canUploadImages: true,
  });
  assert.throws(
    () => db.prepare('UPDATE admins SET id=? WHERE id=?').run('renamed-op', 'new-op'),
    /operator_id_immutable/,
  );
  assert.deepEqual(policy(db, 'new-op'), {
    canCreateInvites: true,
    canUseStaffChat: true,
    canUploadImages: true,
  });
  assert.equal(policy(db, 'renamed-op'), null);
  db.close();
});

test('live operator policy cannot be deleted, renamed, malformed, partial, or duplicate-keyed', () => {
  const db = createDatabase();
  db.exec(migration);
  db.prepare('INSERT INTO admins(id,role) VALUES(?,?)').run('guarded', 'OPERATOR');

  assert.throws(
    () => db.prepare('DELETE FROM settings WHERE key=?').run('operator_policy:guarded'),
    /operator_policy_required/,
  );
  assert.throws(
    () => db.prepare('UPDATE settings SET key=? WHERE key=?').run('other:guarded', 'operator_policy:guarded'),
    /operator_policy_required/,
  );
  assert.throws(
    () => db.prepare('UPDATE settings SET value_json=? WHERE key=?').run('not-json', 'operator_policy:guarded'),
    /invalid_operator_policy/,
  );
  assert.throws(
    () => db.prepare('UPDATE settings SET value_json=? WHERE key=?').run('{"canUseStaffChat":true}', 'operator_policy:guarded'),
    /invalid_operator_policy/,
  );
  assert.throws(
    () => db.prepare('UPDATE settings SET value_json=? WHERE key=?').run(
      '{"canCreateInvites":false,"canCreateInvites":"oops","canUseStaffChat":true,"canUploadImages":true}',
      'operator_policy:guarded',
    ),
    /invalid_operator_policy/,
  );

  db.prepare('UPDATE settings SET value_json=? WHERE key=?').run(
    '{"canCreateInvites":false,"canUseStaffChat":false,"canUploadImages":false}',
    'operator_policy:guarded',
  );
  assert.deepEqual(policy(db, 'guarded'), {
    canCreateInvites: false,
    canUseStaffChat: false,
    canUploadImages: false,
  });
  db.close();
});
