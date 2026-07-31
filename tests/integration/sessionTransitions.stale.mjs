import assert from 'node:assert/strict';
import test from 'node:test';
import { ACTOR, T0, InterleavingSessionRepository, SessionRepository, SessionService, SqliteD1Adapter, changes, createDatabase, expectConflict, insertSession, readSession } from '../helpers/sessionTransitionHarness.mjs';

test('rejects stale assign and archive writes after another production archive wins', async () => {
  for (const action of ['assign', 'archive']) {
    const database = createDatabase();
    try {
      insertSession(database, { id: `race-${action}`, status: 'OPEN', assignedOperatorId: ACTOR.id });
      const adapter = new SqliteD1Adapter(database);
      const winningRepository = new SessionRepository(adapter);
      let hookCalls = 0;
      const repository = new InterleavingSessionRepository(adapter, async (writeAction, sessionId) => {
        if (writeAction !== action || hookCalls++) return;
        assert.equal(changes(await winningRepository.archive(sessionId, ACTOR.id, '2026-07-31T02:00:00.000Z')), 1);
      });
      const service = new SessionService(repository, () => true);
      await expectConflict(service.execute(ACTOR, `race-${action}`, action, '2026-07-31T02:01:00.000Z'));
      const finalState = readSession(database, `race-${action}`);
      assert.equal(finalState.status, 'ARCHIVED');
      assert.ok(finalState.archived_at);
      assert.equal(finalState.deleted_at, null);
    } finally {
      database.close();
    }
  }
});

test('rejects stale moveToTrash after production unarchive restores the session', async () => {
  const database = createDatabase();
  try {
    insertSession(database, { id: 'unarchive-delete-race', status: 'ARCHIVED', assignedOperatorId: ACTOR.id, archivedAt: T0, closedAt: T0 });
    const adapter = new SqliteD1Adapter(database);
    const winningRepository = new SessionRepository(adapter);
    let hookCalls = 0;
    const repository = new InterleavingSessionRepository(adapter, async (action, sessionId) => {
      if (action !== 'moveToTrash' || hookCalls++) return;
      assert.equal(changes(await winningRepository.unarchive(sessionId, '2026-07-31T03:00:00.000Z')), 1);
    });
    const service = new SessionService(repository, () => true);
    await expectConflict(service.execute(ACTOR, 'unarchive-delete-race', 'delete', '2026-07-31T04:00:00.000Z'));
    const finalState = readSession(database, 'unarchive-delete-race');
    assert.equal(finalState.status, 'OPEN');
    assert.equal(finalState.archived_at, null);
    assert.equal(finalState.deleted_at, null);
  } finally {
    database.close();
  }
});
