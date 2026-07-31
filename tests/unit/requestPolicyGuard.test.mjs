import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerTypeScriptHooks } from '../helpers/tsExtensionLoader.mjs';
import { SqliteD1Adapter } from '../helpers/sqliteD1Adapter.mjs';

registerTypeScriptHooks();
const { createRequestPolicyGuard } = await import('../../src/services/requestPolicyGuard.ts');
const { signValue } = await import('../../src/security/signing.ts');
const { hashSessionToken } = await import('../../src/security/sessionTokens.ts');

const secret = 'request-policy-test-secret';

function executionContext() {
  return {
    waitUntil() {},
    passThroughOnException() {},
  };
}

function createEnvironment() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE visitor_sessions (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL,
      visitor_key TEXT,
      revoked_at TEXT,
      expires_at TEXT NOT NULL
    );
  `);
  return {
    database,
    env: {
      DB: new SqliteD1Adapter(database),
      SESSION_SECRET: secret,
    },
  };
}

function innerWorker() {
  return {
    calls: 0,
    async fetch() {
      this.calls += 1;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  };
}

test('requires the signed current guest identity before claim or discard registration', async () => {
  const { database, env } = createEnvironment();
  try {
    const guestSessionId = 'guest_session_1';
    const visitorKey = 'visitor_owner';
    database.prepare(`
      INSERT INTO visitor_sessions(id,token_hash,visitor_key,revoked_at,expires_at)
      VALUES(?,?,?,?,?)
    `).run(
      guestSessionId,
      await hashSessionToken(secret, guestSessionId),
      visitorKey,
      null,
      '2099-01-01T00:00:00.000Z',
    );
    const signed = await signValue(secret, guestSessionId);
    const inner = innerWorker();
    const guard = createRequestPolicyGuard(inner);

    const matching = await guard.fetch(
      new Request('https://example.test/api/account/register', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `guest_session=${signed}`,
        },
        body: JSON.stringify({
          username: 'visitor',
          password: 'password',
          visitorId: visitorKey,
          claimGuest: true,
        }),
      }),
      env,
      executionContext(),
    );
    assert.equal(matching.status, 200);
    assert.equal(inner.calls, 1);

    const mismatch = await guard.fetch(
      new Request('https://example.test/api/account/register', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: `guest_session=${signed}`,
        },
        body: JSON.stringify({
          username: 'visitor2',
          password: 'password',
          visitorId: 'visitor_other',
          discardGuest: true,
        }),
      }),
      env,
      executionContext(),
    );
    assert.equal(mismatch.status, 403);
    assert.equal((await mismatch.json()).error, 'guest_identity_mismatch');
    assert.equal(inner.calls, 1);
  } finally {
    database.close();
  }
});

test('rejects weak operator and administrator passwords before runtime mutation', async () => {
  const { database, env } = createEnvironment();
  try {
    const inner = innerWorker();
    const guard = createRequestPolicyGuard(inner);
    for (const [url, method] of [
      ['https://example.test/api/admins', 'POST'],
      ['https://example.test/api/admins/profile', 'PATCH'],
    ]) {
      const response = await guard.fetch(
        new Request(url, {
          method,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password: 'short' }),
        }),
        env,
        executionContext(),
      );
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error, 'password_too_short');
    }
    assert.equal(inner.calls, 0);
  } finally {
    database.close();
  }
});
