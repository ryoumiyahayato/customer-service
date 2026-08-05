import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerTypeScriptHooks } from '../helpers/tsExtensionLoader.mjs';
import { SqliteD1Adapter } from '../helpers/sqliteD1Adapter.mjs';

registerTypeScriptHooks();
const { SessionRepository } = await import('../../src/repositories/sessionRepository.ts');
const { createHistoryClearGuard } = await import('../../src/services/historyClearGuard.ts');

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
  `);
  database.exec(readFileSync('migrations/0011_guard_history_clear_ownership.sql', 'utf8'));
  return database;
}

function executionContext() {
  return {
    waitUntil() {},
    passThroughOnException() {},
  };
}

test('history clear claim blocks production restore and purge until released', async () => {
  const database = createDatabase();
  try {
    database.prepare(`
      INSERT INTO sessions(
        id,status,assigned_operator_id,archived_at,closed_at,deleted_at,purged_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?)
    `).run(
      'session_1',
      'ARCHIVED',
      'admin_1',
      '2026-07-31T00:00:00.000Z',
      '2026-07-31T00:00:00.000Z',
      null,
      null,
      '2026-07-31T00:00:00.000Z',
    );

    let actualStarted;
    const started = new Promise((resolve) => { actualStarted = resolve; });
    let finishActual;
    const finish = new Promise((resolve) => { finishActual = resolve; });
    const inner = {
      async fetch(req) {
        if (new URL(req.url).pathname.endsWith('/dry-run')) {
          return new Response(JSON.stringify({ ok: true, eligible: true }), { status: 200 });
        }
        actualStarted();
        await finish;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    };
    const adapter = new SqliteD1Adapter(database);
    const guard = createHistoryClearGuard(inner);
    const pending = guard.fetch(
      new Request('https://example.test/api/sessions/session_1/clear-history', {
        method: 'POST',
        body: JSON.stringify({ confirm: 'CLEAR_HISTORY' }),
        headers: { 'content-type': 'application/json' },
      }),
      { DB: adapter },
      executionContext(),
    );

    await started;
    const claimed = database.prepare(
      'SELECT history_clear_claimed_at FROM sessions WHERE id=?',
    ).get('session_1');
    assert.ok(claimed.history_clear_claimed_at);

    const repository = new SessionRepository(adapter);
    const unarchive = await repository.unarchive(
      'session_1',
      new Date().toISOString(),
    );
    assert.equal(Number(unarchive.meta?.changes || 0), 0);
    assert.throws(() => database.prepare(
      'UPDATE sessions SET purged_at=?,updated_at=? WHERE id=?',
    ).run(new Date().toISOString(), new Date().toISOString(), 'session_1'), /history_clear_in_progress/);

    finishActual();
    const response = await pending;
    assert.equal(response.status, 200);
    assert.equal(database.prepare(
      'SELECT history_clear_claimed_at FROM sessions WHERE id=?',
    ).get('session_1').history_clear_claimed_at, null);

    const released = await repository.unarchive(
      'session_1',
      new Date().toISOString(),
    );
    assert.equal(Number(released.meta?.changes || 0), 1);
  } finally {
    database.close();
  }
});

test('failed dry-run authorization never claims destructive ownership', async () => {
  const database = createDatabase();
  try {
    database.prepare(`
      INSERT INTO sessions(id,status,archived_at,updated_at)
      VALUES(?,?,?,?)
    `).run('session_2', 'ARCHIVED', '2026-07-31T00:00:00.000Z', '2026-07-31T00:00:00.000Z');
    let actualCalls = 0;
    const guard = createHistoryClearGuard({
      async fetch(req) {
        if (new URL(req.url).pathname.endsWith('/dry-run')) {
          return new Response('forbidden', { status: 403 });
        }
        actualCalls += 1;
        return new Response('unexpected', { status: 500 });
      },
    });

    const response = await guard.fetch(
      new Request('https://example.test/api/sessions/session_2/clear-history', { method: 'POST' }),
      { DB: new SqliteD1Adapter(database) },
      executionContext(),
    );
    assert.equal(response.status, 403);
    assert.equal(actualCalls, 0);
    assert.equal(database.prepare(
      'SELECT history_clear_claimed_at FROM sessions WHERE id=?',
    ).get('session_2').history_clear_claimed_at, null);
  } finally {
    database.close();
  }
});
