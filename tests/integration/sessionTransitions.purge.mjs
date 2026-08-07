import assert from 'node:assert/strict';
import test from 'node:test';
import { DomainError } from '../../src/http/errors.ts';
import { purgeTrashSessions } from '../../src/sessionLifecycle.ts';
import { ACTOR, createContext, createDatabase, insertSession, readSession } from '../helpers/sessionTransitionHarness.mjs';

async function expectRestoreUnsupported(promise) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof DomainError);
    assert.equal(error.code, 'RESTORE_NOT_SUPPORTED');
    assert.equal(error.status, 410);
    return true;
  });
}

test('trash remains irreversible before and after production purge', async () => {
  const database = createDatabase();
  try {
    insertSession(database, {
      id: 'irreversible-trash',
      status: 'ARCHIVED',
      archivedAt: '2020-01-01T00:00:00.000Z',
      closedAt: '2020-01-01T00:00:00.000Z',
      deletedAt: '2020-01-02T00:00:00.000Z',
    });

    const context = createContext(database);
    await expectRestoreUnsupported(context.service.execute(ACTOR, 'irreversible-trash', 'restore', '2026-07-31T05:00:00.000Z'));
    assert.ok(readSession(database, 'irreversible-trash').deleted_at);

    assert.deepEqual(await purgeTrashSessions({ DB: context.adapter }, 50), { purgedCount: 1 });
    assert.ok(readSession(database, 'irreversible-trash').purged_at);
    await expectRestoreUnsupported(context.service.execute(ACTOR, 'irreversible-trash', 'restore', '2026-07-31T05:01:00.000Z'));
  } finally {
    database.close();
  }
});