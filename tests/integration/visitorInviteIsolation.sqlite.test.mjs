import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerTypeScriptHooks } from '../helpers/tsExtensionLoader.mjs';
import { SqliteD1Adapter } from '../helpers/sqliteD1Adapter.mjs';

registerTypeScriptHooks();
const { default: worker } = await import('../../src/worker-public-gate.ts');
const { hmacHex, signValue } = await import('../../src/security/signing.ts');
const { hashSessionToken } = await import('../../src/security/sessionTokens.ts');
const { COOKIE_NAMES } = await import('../../src/security/cookies.ts');

const SECRET = 'visitor-invite-isolation-test-secret';
const VISITOR_ROOT = 'vx9qn7zr.org';
const ADMIN_HOST = 'denglu.kefuxitong.net';
const TOKEN = 'a'.repeat(40);
const OTHER_TOKEN = 'b'.repeat(40);
const VISITOR_HOST = `${TOKEN}.${VISITOR_ROOT}`;

function createDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE invite_links (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      source_operator_id TEXT,
      created_by_admin_id TEXT,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      consumed_at TEXT,
      consumed_session_id TEXT
    );
    CREATE TABLE visitor_sessions (
      id TEXT PRIMARY KEY,
      visitor_account_id TEXT,
      visitor_key TEXT,
      token_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    );
  `);
  return database;
}

async function insertConsumedInvite(database) {
  const tokenHash = await hmacHex(SECRET, `invite:${TOKEN}`);
  database.prepare(`
    INSERT INTO invite_links(
      id,token_hash,source_operator_id,created_by_admin_id,expires_at,revoked_at,consumed_at,consumed_session_id
    ) VALUES(?,?,?,?,?,NULL,?,?)
  `).run(
    'invite-1',
    tokenHash,
    null,
    'admin-primary',
    new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    new Date().toISOString(),
    'session-1',
  );
}

async function oldGuestCookie(database) {
  const id = 'gsess-old';
  database.prepare(`
    INSERT INTO visitor_sessions(id,visitor_account_id,visitor_key,token_hash,created_at,expires_at,revoked_at)
    VALUES(?,NULL,?,?,?, ?,NULL)
  `).run(
    id,
    'visitor-old',
    await hashSessionToken(SECRET, id),
    new Date().toISOString(),
    new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  );
  return `${COOKIE_NAMES.guest}=${await signValue(SECRET, id)}`;
}

function env(database) {
  return {
    DB: new SqliteD1Adapter(database),
    SESSION_SECRET: SECRET,
    VISITOR_ROOT_DOMAIN: VISITOR_ROOT,
    VISITOR_PUBLIC_HOSTS: VISITOR_ROOT,
    ADMIN_PUBLIC_HOST: ADMIN_HOST,
  };
}

function context() {
  return { waitUntil() {}, passThroughOnException() {} };
}

test('a consumed QR cannot be reopened even when the same token subdomain still has an old guest cookie', async () => {
  const database = createDatabase();
  try {
    await insertConsumedInvite(database);
    const cookie = await oldGuestCookie(database);
    const response = await worker.fetch(
      new Request(`https://${VISITOR_HOST}/api/guest/${TOKEN}`, {
        method: 'POST',
        headers: { Cookie: cookie, 'Content-Type': 'application/json' },
        body: '{}',
      }),
      env(database),
      context(),
    );
    assert.equal(response.status, 410);
    assert.deepEqual(await response.json(), { error: 'invite_unavailable' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally {
    database.close();
  }
});

test('token subdomain cannot consume a different invite token', async () => {
  const database = createDatabase();
  try {
    const response = await worker.fetch(
      new Request(`https://${VISITOR_HOST}/api/guest/${OTHER_TOKEN}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      }),
      env(database),
      context(),
    );
    assert.equal(response.status, 404);
  } finally {
    database.close();
  }
});

test('visitor token host cannot prefetch welcome/presentation from a token endpoint', async () => {
  const database = createDatabase();
  try {
    await insertConsumedInvite(database);
    const response = await worker.fetch(
      new Request(`https://${VISITOR_HOST}/api/invite-presentation/${TOKEN}`),
      env(database),
      context(),
    );
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally {
    database.close();
  }
});

test('admin hostname and bare visitor root cannot serve a visitor invite entry', async () => {
  const database = createDatabase();
  try {
    const admin = await worker.fetch(new Request(`https://${ADMIN_HOST}/`), env(database), context());
    assert.equal(admin.status, 404);
    const bare = await worker.fetch(new Request(`https://${VISITOR_ROOT}/`), env(database), context());
    assert.equal(bare.status, 404);
  } finally {
    database.close();
  }
});
