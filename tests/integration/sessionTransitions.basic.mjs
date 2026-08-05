import assert from 'node:assert/strict';
import test from 'node:test';
import { ACTOR, T0, createContext, createDatabase, expectConflict, insertSession } from '../helpers/sessionTransitionHarness.mjs';

test('executes basic transitions through production SessionService and SessionRepository', async () => {
  const database = createDatabase();
  try {
    const { service } = createContext(database);
    insertSession(database, { id: 'pending-assign' });
    assert.equal((await service.execute(ACTOR, 'pending-assign', 'assign', '2026-07-31T01:00:00.000Z')).status, 'OPEN');

    insertSession(database, { id: 'open-archive', status: 'OPEN', assignedOperatorId: ACTOR.id });
    assert.equal((await service.execute(ACTOR, 'open-archive', 'archive', '2026-07-31T02:00:00.000Z')).status, 'ARCHIVED');

    insertSession(database, { id: 'pending-archive' });
    assert.equal((await service.execute(ACTOR, 'pending-archive', 'archive', '2026-07-31T02:00:00.000Z')).status, 'ARCHIVED');

    insertSession(database, { id: 'assigned-unarchive', status: 'ARCHIVED', assignedOperatorId: ACTOR.id, archivedAt: T0, closedAt: T0 });
    assert.equal((await service.execute(ACTOR, 'assigned-unarchive', 'unarchive', '2026-07-31T03:00:00.000Z')).status, 'OPEN');

    insertSession(database, { id: 'unassigned-unarchive', status: 'ARCHIVED', archivedAt: T0, closedAt: T0 });
    assert.equal((await service.execute(ACTOR, 'unassigned-unarchive', 'unarchive', '2026-07-31T03:00:00.000Z')).status, 'PENDING');

    insertSession(database, { id: 'archive-trash', status: 'ARCHIVED', archivedAt: T0, closedAt: T0 });
    const trashed = await service.execute(ACTOR, 'archive-trash', 'delete', '2026-07-31T04:00:00.000Z');
    assert.ok(trashed.deleted_at);
    const restored = await service.execute(ACTOR, 'archive-trash', 'restore', '2026-07-31T05:00:00.000Z');
    assert.equal(restored.status, 'ARCHIVED');
    assert.equal(restored.deleted_at, null);
    assert.ok(restored.archived_at);
    assert.ok(restored.closed_at);

    insertSession(database, { id: 'purged-restore', status: 'ARCHIVED', archivedAt: T0, closedAt: T0, deletedAt: T0, purgedAt: T0 });
    await expectConflict(service.execute(ACTOR, 'purged-restore', 'restore', '2026-07-31T05:00:00.000Z'));
  } finally {
    database.close();
  }
});
