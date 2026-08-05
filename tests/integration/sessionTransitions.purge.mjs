import assert from 'node:assert/strict';
import test from 'node:test';
import { purgeTrashSessions } from '../../src/sessionLifecycle.ts';
import { ACTOR, changes, createContext, createDatabase, expectConflict, insertSession, readSession } from '../helpers/sessionTransitionHarness.mjs';

test('resolves restore and production purge races by database state ownership', async () => {
  const purgeWins = createDatabase();
  const restoreWins = createDatabase();
  try {
    for (const database of [purgeWins, restoreWins]) {
      insertSession(database, { id: 'race', status: 'ARCHIVED', archivedAt: '2020-01-01T00:00:00.000Z', closedAt: '2020-01-01T00:00:00.000Z', deletedAt: '2020-01-02T00:00:00.000Z' });
    }

    const purgeContext = createContext(purgeWins);
    assert.deepEqual(await purgeTrashSessions({ DB: purgeContext.adapter }, 50), { purgedCount: 1 });
    assert.equal(changes(await purgeContext.repository.restore('race', '2026-07-31T05:00:00.000Z')), 0);
    await expectConflict(purgeContext.service.execute(ACTOR, 'race', 'restore', '2026-07-31T05:01:00.000Z'));
    assert.ok(readSession(purgeWins, 'race').purged_at);

    const restoreContext = createContext(restoreWins);
    assert.equal(changes(await restoreContext.repository.restore('race', '2026-07-31T05:00:00.000Z')), 1);
    assert.deepEqual(await purgeTrashSessions({ DB: restoreContext.adapter }, 50), { purgedCount: 0 });
    const restored = readSession(restoreWins, 'race');
    assert.equal(restored.status, 'ARCHIVED');
    assert.equal(restored.deleted_at, null);
    assert.equal(restored.purged_at, null);
  } finally {
    purgeWins.close();
    restoreWins.close();
  }
});
