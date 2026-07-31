import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

function createDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      assigned_operator_id TEXT,
      archived_at TEXT,
      archived_by TEXT,
      closed_at TEXT,
      deleted_at TEXT,
      deleted_by TEXT,
      purged_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      content TEXT NOT NULL
    );
  `);
  return database;
}

function insertSession(database, input) {
  database.prepare(`
    INSERT INTO sessions(
      id,status,assigned_operator_id,archived_at,archived_by,closed_at,
      deleted_at,deleted_by,purged_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?)
  `).run(
    input.id,
    input.status ?? 'PENDING',
    input.assignedOperatorId ?? null,
    input.archivedAt ?? null,
    input.archivedBy ?? null,
    input.closedAt ?? null,
    input.deletedAt ?? null,
    input.deletedBy ?? null,
    input.purgedAt ?? null,
    input.updatedAt ?? '2026-07-31T00:00:00.000Z',
  );
}

function readSession(database, id) {
  const row = database.prepare(`
    SELECT status,assigned_operator_id,archived_at,closed_at,deleted_at,purged_at
    FROM sessions WHERE id=?
  `).get(id);
  return row ? { ...row } : null;
}

function assign(database, id, actor = 'admin_1', timestamp = '2026-07-31T01:00:00.000Z') {
  return database.prepare(`
    UPDATE sessions
    SET assigned_operator_id=?,status='OPEN',updated_at=?
    WHERE id=?
      AND deleted_at IS NULL
      AND purged_at IS NULL
      AND archived_at IS NULL
      AND status IN ('PENDING','OPEN')
  `).run(actor, timestamp, id).changes;
}

function archive(database, id, actor = 'admin_1', timestamp = '2026-07-31T02:00:00.000Z') {
  return database.prepare(`
    UPDATE sessions
    SET status='ARCHIVED',
        closed_at=COALESCE(closed_at,?),
        archived_at=COALESCE(archived_at,?),
        archived_by=?,
        updated_at=?
    WHERE id=?
      AND deleted_at IS NULL
      AND purged_at IS NULL
      AND archived_at IS NULL
      AND status IN ('PENDING','OPEN')
  `).run(timestamp, timestamp, actor, timestamp, id).changes;
}

function unarchive(database, id, timestamp = '2026-07-31T03:00:00.000Z') {
  return database.prepare(`
    UPDATE sessions
    SET archived_at=NULL,
        archived_by=NULL,
        closed_at=NULL,
        status=CASE WHEN assigned_operator_id IS NULL THEN 'PENDING' ELSE 'OPEN' END,
        updated_at=?
    WHERE id=?
      AND deleted_at IS NULL
      AND purged_at IS NULL
      AND (archived_at IS NOT NULL OR status IN ('ARCHIVED','CLOSED'))
  `).run(timestamp, id).changes;
}

function moveToTrash(database, id, actor = 'admin_1', timestamp = '2026-07-31T04:00:00.000Z') {
  return database.prepare(`
    UPDATE sessions
    SET status='ARCHIVED',
        archived_at=COALESCE(archived_at,?),
        closed_at=COALESCE(closed_at,?),
        deleted_at=?,
        deleted_by=?,
        updated_at=?
    WHERE id=?
      AND deleted_at IS NULL
      AND purged_at IS NULL
      AND (archived_at IS NOT NULL OR status IN ('ARCHIVED','CLOSED'))
  `).run(timestamp, timestamp, timestamp, actor, timestamp, id).changes;
}

function restore(database, id, timestamp = '2026-07-31T05:00:00.000Z') {
  return database.prepare(`
    UPDATE sessions
    SET deleted_at=NULL,
        deleted_by=NULL,
        status='ARCHIVED',
        archived_at=COALESCE(archived_at,?),
        closed_at=COALESCE(closed_at,?),
        updated_at=?
    WHERE id=?
      AND deleted_at IS NOT NULL
      AND purged_at IS NULL
  `).run(timestamp, timestamp, timestamp, id).changes;
}

function claimPurge(database, id, timestamp = '2026-07-31T06:00:00.000Z') {
  return database.prepare(`
    UPDATE sessions
    SET purged_at=?,updated_at=?
    WHERE id=?
      AND deleted_at IS NOT NULL
      AND purged_at IS NULL
  `).run(timestamp, timestamp, id).changes;
}

function canReadMessages(database, sessionId) {
  return database.prepare(`
    SELECT m.id
    FROM messages m
    JOIN sessions s ON s.id=m.session_id
    WHERE m.session_id=? AND s.deleted_at IS NULL AND s.purged_at IS NULL
  `).all(sessionId).length > 0;
}

test('executes PENDING to OPEN and active to ARCHIVED transitions', () => {
  const database = createDatabase();
  try {
    insertSession(database, { id: 'pending' });
    assert.equal(assign(database, 'pending'), 1);
    assert.equal(readSession(database, 'pending').status, 'OPEN');
    assert.equal(archive(database, 'pending'), 1);
    const archived = readSession(database, 'pending');
    assert.equal(archived.status, 'ARCHIVED');
    assert.ok(archived.archived_at);
  } finally {
    database.close();
  }
});

test('archives PENDING directly and unarchives to OPEN or PENDING by assignment', () => {
  const database = createDatabase();
  try {
    insertSession(database, { id: 'assigned', assignedOperatorId: 'admin_1' });
    insertSession(database, { id: 'unassigned' });
    assert.equal(archive(database, 'assigned'), 1);
    assert.equal(archive(database, 'unassigned'), 1);
    assert.equal(unarchive(database, 'assigned'), 1);
    assert.equal(unarchive(database, 'unassigned'), 1);
    assert.equal(readSession(database, 'assigned').status, 'OPEN');
    assert.equal(readSession(database, 'unassigned').status, 'PENDING');
  } finally {
    database.close();
  }
});

test('moves archived sessions to trash and restores only to archived', () => {
  const database = createDatabase();
  try {
    insertSession(database, {
      id: 'archived',
      status: 'ARCHIVED',
      archivedAt: '2026-07-30T00:00:00.000Z',
    });
    assert.equal(moveToTrash(database, 'archived'), 1);
    assert.ok(readSession(database, 'archived').deleted_at);
    assert.equal(restore(database, 'archived'), 1);
    const restored = readSession(database, 'archived');
    assert.equal(restored.status, 'ARCHIVED');
    assert.equal(restored.deleted_at, null);
    assert.ok(restored.archived_at);
  } finally {
    database.close();
  }
});

test('claims trash for purge and prevents any later restore', () => {
  const database = createDatabase();
  try {
    insertSession(database, {
      id: 'trash',
      status: 'ARCHIVED',
      archivedAt: '2026-07-30T00:00:00.000Z',
      deletedAt: '2026-07-31T00:00:00.000Z',
    });
    assert.equal(claimPurge(database, 'trash'), 1);
    assert.ok(readSession(database, 'trash').purged_at);
    assert.equal(restore(database, 'trash'), 0);
  } finally {
    database.close();
  }
});

test('archive and trash transitions are idempotent under duplicate requests', () => {
  const database = createDatabase();
  try {
    insertSession(database, { id: 'session' });
    assert.equal(archive(database, 'session'), 1);
    assert.equal(archive(database, 'session'), 0);
    assert.equal(moveToTrash(database, 'session'), 1);
    assert.equal(moveToTrash(database, 'session'), 0);
  } finally {
    database.close();
  }
});

test('restore and purge race is resolved by guarded state ownership', () => {
  const purgeWins = createDatabase();
  const restoreWins = createDatabase();
  try {
    for (const database of [purgeWins, restoreWins]) {
      insertSession(database, {
        id: 'race',
        status: 'ARCHIVED',
        archivedAt: '2026-07-30T00:00:00.000Z',
        deletedAt: '2026-07-31T00:00:00.000Z',
      });
    }

    assert.equal(claimPurge(purgeWins, 'race'), 1);
    assert.equal(restore(purgeWins, 'race'), 0);

    assert.equal(restore(restoreWins, 'race'), 1);
    assert.equal(claimPurge(restoreWins, 'race'), 0);
  } finally {
    purgeWins.close();
    restoreWins.close();
  }
});

test('archived, trash and purged sessions cannot expose active message history', () => {
  const database = createDatabase();
  try {
    insertSession(database, { id: 'active', status: 'OPEN' });
    insertSession(database, {
      id: 'archived',
      status: 'ARCHIVED',
      archivedAt: '2026-07-30T00:00:00.000Z',
    });
    insertSession(database, {
      id: 'trash',
      status: 'ARCHIVED',
      archivedAt: '2026-07-30T00:00:00.000Z',
      deletedAt: '2026-07-31T00:00:00.000Z',
    });
    insertSession(database, {
      id: 'purged',
      status: 'ARCHIVED',
      archivedAt: '2026-07-30T00:00:00.000Z',
      deletedAt: '2026-07-31T00:00:00.000Z',
      purgedAt: '2026-07-31T01:00:00.000Z',
    });
    for (const id of ['active', 'archived', 'trash', 'purged']) {
      database.prepare('INSERT INTO messages(id,session_id,content) VALUES(?,?,?)')
        .run(`message-${id}`, id, id);
    }
    assert.equal(canReadMessages(database, 'active'), true);
    assert.equal(canReadMessages(database, 'archived'), true);
    assert.equal(canReadMessages(database, 'trash'), false);
    assert.equal(canReadMessages(database, 'purged'), false);
  } finally {
    database.close();
  }
});
