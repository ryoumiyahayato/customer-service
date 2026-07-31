import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const migration = readFileSync(
  new URL('../../migrations/0010_normalize_unarchive_state.sql', import.meta.url),
  'utf8',
);

function createDatabase() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      assigned_operator_id TEXT,
      archived_at TEXT,
      deleted_at TEXT,
      purged_at TEXT,
      closed_at TEXT,
      updated_at TEXT
    );
  `);
  return db;
}

function insertSession(db, session) {
  db.prepare(`
    INSERT INTO sessions(
      id,
      status,
      assigned_operator_id,
      archived_at,
      deleted_at,
      purged_at,
      closed_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    session.id,
    session.status,
    session.assignedOperatorId ?? null,
    session.archivedAt ?? null,
    session.deletedAt ?? null,
    session.purgedAt ?? null,
    session.closedAt ?? null,
    '2026-07-31T00:00:00.000Z',
  );
}

function readSession(db, id) {
  return db.prepare(`
    SELECT status, archived_at, deleted_at, purged_at, closed_at
    FROM sessions
    WHERE id = ?
  `).get(id);
}

test('migration repairs legacy active rows left as CLOSED', () => {
  const db = createDatabase();
  try {
    insertSession(db, {
      id: 'assigned',
      status: 'CLOSED',
      assignedOperatorId: 'admin_1',
      closedAt: '2026-07-30T00:00:00.000Z',
    });
    insertSession(db, {
      id: 'unassigned',
      status: 'CLOSED',
      closedAt: '2026-07-30T00:00:00.000Z',
    });
    insertSession(db, {
      id: 'still-archived',
      status: 'CLOSED',
      archivedAt: '2026-07-30T00:00:00.000Z',
      closedAt: '2026-07-30T00:00:00.000Z',
    });

    db.exec(migration);

    assert.deepEqual(readSession(db, 'assigned'), {
      status: 'OPEN',
      archived_at: null,
      deleted_at: null,
      purged_at: null,
      closed_at: null,
    });
    assert.deepEqual(readSession(db, 'unassigned'), {
      status: 'PENDING',
      archived_at: null,
      deleted_at: null,
      purged_at: null,
      closed_at: null,
    });
    assert.equal(readSession(db, 'still-archived').status, 'CLOSED');
  } finally {
    db.close();
  }
});

test('trigger converts an assigned unarchive transition to OPEN', () => {
  const db = createDatabase();
  try {
    db.exec(migration);
    insertSession(db, {
      id: 'assigned',
      status: 'ARCHIVED',
      assignedOperatorId: 'admin_1',
      archivedAt: '2026-07-30T00:00:00.000Z',
      closedAt: '2026-07-30T00:00:00.000Z',
    });

    db.prepare(`
      UPDATE sessions
      SET archived_at = NULL,
          status = 'CLOSED'
      WHERE id = ?
    `).run('assigned');

    assert.deepEqual(readSession(db, 'assigned'), {
      status: 'OPEN',
      archived_at: null,
      deleted_at: null,
      purged_at: null,
      closed_at: null,
    });
  } finally {
    db.close();
  }
});

test('trigger converts an unassigned unarchive transition to PENDING', () => {
  const db = createDatabase();
  try {
    db.exec(migration);
    insertSession(db, {
      id: 'unassigned',
      status: 'ARCHIVED',
      archivedAt: '2026-07-30T00:00:00.000Z',
      closedAt: '2026-07-30T00:00:00.000Z',
    });

    db.prepare(`
      UPDATE sessions
      SET archived_at = NULL,
          status = 'CLOSED'
      WHERE id = ?
    `).run('unassigned');

    assert.equal(readSession(db, 'unassigned').status, 'PENDING');
  } finally {
    db.close();
  }
});

test('trigger does not reactivate trash or purged sessions', () => {
  const db = createDatabase();
  try {
    db.exec(migration);
    insertSession(db, {
      id: 'trash',
      status: 'ARCHIVED',
      archivedAt: '2026-07-30T00:00:00.000Z',
      deletedAt: '2026-07-31T00:00:00.000Z',
    });
    insertSession(db, {
      id: 'purged',
      status: 'ARCHIVED',
      archivedAt: '2026-07-30T00:00:00.000Z',
      deletedAt: '2026-07-31T00:00:00.000Z',
      purgedAt: '2026-07-31T01:00:00.000Z',
    });

    db.prepare("UPDATE sessions SET archived_at = NULL, status = 'CLOSED' WHERE id = ?").run('trash');
    db.prepare("UPDATE sessions SET archived_at = NULL, status = 'CLOSED' WHERE id = ?").run('purged');

    assert.equal(readSession(db, 'trash').status, 'CLOSED');
    assert.equal(readSession(db, 'purged').status, 'CLOSED');
  } finally {
    db.close();
  }
});
