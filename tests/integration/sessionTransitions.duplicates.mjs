import assert from 'node:assert/strict';
import test from 'node:test';
import { ACTOR, T0, changes, createContext, createDatabase, expectConflict, insertSession } from '../helpers/sessionTransitionHarness.mjs';

test('reports real affected row counts and conflicts for duplicate archive and trash operations', async () => {
  const database = createDatabase();
  try {
    const { repository, service } = createContext(database);

    insertSession(database, { id: 'repo-archive', status: 'OPEN' });
    assert.equal(changes(await repository.archive('repo-archive', ACTOR.id, '2026-07-31T02:00:00.000Z')), 1);
    assert.equal(changes(await repository.archive('repo-archive', ACTOR.id, '2026-07-31T02:01:00.000Z')), 0);

    insertSession(database, { id: 'service-archive', status: 'OPEN' });
    await service.execute(ACTOR, 'service-archive', 'archive', '2026-07-31T02:00:00.000Z');
    await expectConflict(service.execute(ACTOR, 'service-archive', 'archive', '2026-07-31T02:01:00.000Z'));

    insertSession(database, { id: 'repo-trash', status: 'ARCHIVED', archivedAt: T0, closedAt: T0 });
    assert.equal(changes(await repository.moveToTrash('repo-trash', ACTOR.id, '2026-07-31T04:00:00.000Z')), 1);
    assert.equal(changes(await repository.moveToTrash('repo-trash', ACTOR.id, '2026-07-31T04:01:00.000Z')), 0);

    insertSession(database, { id: 'service-trash', status: 'ARCHIVED', archivedAt: T0, closedAt: T0 });
    await service.execute(ACTOR, 'service-trash', 'delete', '2026-07-31T04:00:00.000Z');
    await expectConflict(service.execute(ACTOR, 'service-trash', 'delete', '2026-07-31T04:01:00.000Z'));
  } finally {
    database.close();
  }
});
