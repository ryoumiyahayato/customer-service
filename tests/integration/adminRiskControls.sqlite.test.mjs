import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerTypeScriptHooks } from '../helpers/tsExtensionLoader.mjs';
import { SqliteD1Adapter } from '../helpers/sqliteD1Adapter.mjs';

registerTypeScriptHooks();
const { default: entryWorker } = await import('../../src/worker-entry.ts');
const { default: finalWorker } = await import('../../src/worker-final.ts');
const { COOKIE_NAMES } = await import('../../src/security/cookies.ts');
const { signValue } = await import('../../src/security/signing.ts');
const { hashSessionToken } = await import('../../src/security/sessionTokens.ts');

const SECRET = 'admin-risk-controls-sqlite-secret';
const NOW = new Date().toISOString();
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

function createDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE admins (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      display_name TEXT,
      password_hash TEXT,
      role TEXT NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      is_disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_seen_at TEXT
    );
    CREATE TABLE admin_sessions (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE system_logs (
      id TEXT PRIMARY KEY,
      level TEXT NOT NULL,
      event TEXT NOT NULL,
      actor_id TEXT,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return database;
}

async function addAdmin(database, id, role) {
  database.prepare(`INSERT INTO admins(id,username,display_name,password_hash,role,must_change_password,is_disabled,created_at,updated_at,last_seen_at)
    VALUES(?,?,?,?,?,0,0,?,?,?)`).run(id, id, id, 'legacy', role, NOW, NOW, NOW);
  const sessionId = `session-${id}`;
  database.prepare(`INSERT INTO admin_sessions(id,admin_id,token_hash,created_at,last_seen_at,expires_at,revoked_at)
    VALUES(?,?,?,?,?,?,NULL)`).run(sessionId, id, await hashSessionToken(SECRET, sessionId), NOW, NOW, FUTURE);
  return {
    sessionId,
    cookie: await signValue(SECRET, sessionId),
  };
}

function env(database) {
  return {
    DB: new SqliteD1Adapter(database),
    SESSION_SECRET: SECRET,
  };
}

function request(path, cookie, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Cookie', `${COOKIE_NAMES.admin}=${cookie}`);
  headers.set('Origin', 'https://denglu.kefuxitong.net');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return new Request(`https://denglu.kefuxitong.net${path}`, { ...init, headers });
}

test('ordinary operator cannot read super-admin risk overview', async () => {
  const database = createDatabase();
  try {
    const operator = await addAdmin(database, 'operator-1', 'OPERATOR');
    const response = await entryWorker.fetch(request('/api/admin/security/overview', operator.cookie), env(database), {});
    assert.equal(response.status, 403);
  } finally {
    database.close();
  }
});

test('super admin policy update changes operator capabilities and blocks staff websocket', async () => {
  const database = createDatabase();
  try {
    const superAdmin = await addAdmin(database, 'super-1', 'SUPER_ADMIN');
    const operator = await addAdmin(database, 'operator-1', 'OPERATOR');

    const update = await entryWorker.fetch(request('/api/admin/operator-policies/operator-1', superAdmin.cookie, {
      method: 'PUT',
      body: JSON.stringify({ canCreateInvites: true, canUseStaffChat: false, canUploadImages: true }),
    }), env(database), {});
    assert.equal(update.status, 200);

    const capabilities = await entryWorker.fetch(request('/api/admin/capabilities', operator.cookie), env(database), {});
    assert.equal(capabilities.status, 200);
    const body = await capabilities.json();
    assert.equal(body.capabilities.canUseStaffChat, false);
    assert.equal(body.capabilities.canCreateInvites, true);

    const websocket = await finalWorker.fetch(request('/api/ws/staff', operator.cookie, {
      headers: { Upgrade: 'websocket' },
    }), env(database), {});
    assert.equal(websocket.status, 403);
  } finally {
    database.close();
  }
});

test('super-admin password reset revokes existing operator sessions and audits the action', async () => {
  const database = createDatabase();
  try {
    const superAdmin = await addAdmin(database, 'super-1', 'SUPER_ADMIN');
    await addAdmin(database, 'operator-1', 'OPERATOR');

    const response = await entryWorker.fetch(request('/api/admin/operators/operator-1/reset-password', superAdmin.cookie, {
      method: 'POST',
      body: JSON.stringify({ password: 'replacement-password-2026' }),
    }), env(database), {});
    assert.equal(response.status, 200);

    const operatorRow = database.prepare('SELECT password_hash,must_change_password FROM admins WHERE id=?').get('operator-1');
    assert.match(String(operatorRow.password_hash), /^pbkdf2:210000:/);
    assert.equal(Number(operatorRow.must_change_password), 1);

    const session = database.prepare('SELECT revoked_at FROM admin_sessions WHERE admin_id=?').get('operator-1');
    assert.ok(session.revoked_at);

    const audit = database.prepare("SELECT event,actor_id FROM system_logs WHERE event='security.operator_password.reset' ORDER BY created_at DESC LIMIT 1").get();
    assert.equal(audit.event, 'security.operator_password.reset');
    assert.equal(audit.actor_id, 'super-1');
  } finally {
    database.close();
  }
});
