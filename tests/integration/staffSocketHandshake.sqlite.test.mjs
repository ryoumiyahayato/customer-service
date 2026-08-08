import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerTypeScriptHooks } from '../helpers/tsExtensionLoader.mjs';
import { SqliteD1Adapter } from '../helpers/sqliteD1Adapter.mjs';

registerTypeScriptHooks();
const { default: worker } = await import('../../src/worker-final.ts');
const {
  CHAT_ROOM_STAFF_AUTH_SESSION_HEADER,
  CHAT_ROOM_STAFF_PRINCIPAL_HEADER,
} = await import('../../src/durable-objects/ChatRoom.ts');
const { COOKIE_NAMES } = await import('../../src/security/cookies.ts');
const { signValue } = await import('../../src/security/signing.ts');
const { hashSessionToken } = await import('../../src/security/sessionTokens.ts');

const SECRET = 'staff-socket-handshake-test-secret';
const NOW = new Date().toISOString();
const RECENT = new Date(Date.now() - 5 * 60 * 1000).toISOString();
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

function createDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE admins (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      display_name TEXT,
      role TEXT NOT NULL,
      is_disabled INTEGER NOT NULL DEFAULT 0,
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
    CREATE TABLE operator_policies (
      admin_id TEXT PRIMARY KEY,
      can_create_invites INTEGER NOT NULL,
      can_use_staff_chat INTEGER NOT NULL,
      can_upload_images INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return database;
}


async function addAdmin(database, id, role = 'OPERATOR') {
  database.prepare('INSERT INTO admins(id,username,display_name,role,is_disabled,last_seen_at) VALUES(?,?,?,?,0,?)').run(id, id, id, role, NOW);
  if (role === 'OPERATOR') {
    database.prepare('INSERT INTO operator_policies(admin_id,can_create_invites,can_use_staff_chat,can_upload_images,updated_at) VALUES(?,?,?,?,?)')
      .run(id, 1, 1, 1, NOW);
  }
  const sessionId = `auth-${id}`;
  database.prepare('INSERT INTO admin_sessions(id,admin_id,token_hash,created_at,last_seen_at,expires_at,revoked_at) VALUES(?,?,?,?,?,?,NULL)')
    .run(sessionId, id, await hashSessionToken(SECRET, sessionId), NOW, NOW, FUTURE);
  return { sessionId, cookie: await signValue(SECRET, sessionId) };
}

function createEnv(database, forwarded) {
  return {
    DB: new SqliteD1Adapter(database),
    SESSION_SECRET: SECRET,
    CHAT_ROOM: {
      idFromName(name) { return name; },
      get(name) {
        return {
          async fetch(request) {
            forwarded.push({ name, request });
            return new Response('joined', { status: 200 });
          },
        };
      },
    },
  };
}

function staffRequest(cookie, origin = 'https://denglu.kefuxitong.net') {
  return new Request('https://denglu.kefuxitong.net/api/ws/staff', {
    headers: {
      Upgrade: 'websocket',
      Origin: origin,
      Cookie: `${COOKIE_NAMES.admin}=${cookie}`,
    },
  });
}

function context() {
  return { waitUntil() {}, passThroughOnException() {} };
}

test('production staff websocket binds authenticated admin and backend session identity before Durable Object handoff', async () => {
  const database = createDatabase();
  try {
    const forwarded = [];
    const operator = await addAdmin(database, 'operator-a');
    database.prepare('UPDATE admin_sessions SET last_seen_at=? WHERE id=?').run(RECENT, operator.sessionId);
    database.prepare('UPDATE admins SET last_seen_at=? WHERE id=?').run(RECENT, 'operator-a');

    const response = await worker.fetch(staffRequest(operator.cookie), createEnv(database, forwarded), context());
    assert.equal(response.status, 200);
    assert.equal(forwarded.length, 1);
    assert.equal(forwarded[0].name, 'staff');
    assert.equal(forwarded[0].request.headers.get(CHAT_ROOM_STAFF_PRINCIPAL_HEADER), 'operator-a');
    assert.equal(forwarded[0].request.headers.get(CHAT_ROOM_STAFF_AUTH_SESSION_HEADER), operator.sessionId);

    const authSeen = database.prepare('SELECT last_seen_at FROM admin_sessions WHERE id=?').get(operator.sessionId).last_seen_at;
    const adminSeen = database.prepare('SELECT last_seen_at FROM admins WHERE id=?').get('operator-a').last_seen_at;
    assert.notEqual(authSeen, RECENT);
    assert.notEqual(adminSeen, RECENT);
  } finally {
    database.close();
  }
});

test('production staff websocket rejects disabled capability, revoked login session and cross-origin handshake before room handoff', async () => {
  const database = createDatabase();
  try {
    const forwarded = [];
    const operator = await addAdmin(database, 'operator-a');
    const env = createEnv(database, forwarded);

    database.prepare('UPDATE operator_policies SET can_use_staff_chat=0,updated_at=? WHERE admin_id=?')
      .run(NOW, 'operator-a');
    assert.equal((await worker.fetch(staffRequest(operator.cookie), env, context())).status, 403);
    assert.equal(forwarded.length, 0);

    database.prepare('UPDATE operator_policies SET can_use_staff_chat=1,updated_at=? WHERE admin_id=?')
      .run(NOW, 'operator-a');
    assert.equal((await worker.fetch(staffRequest(operator.cookie, 'https://evil.example'), env, context())).status, 403);
    assert.equal(forwarded.length, 0);

    database.prepare('UPDATE admin_sessions SET revoked_at=? WHERE id=?').run(NOW, operator.sessionId);
    assert.equal((await worker.fetch(staffRequest(operator.cookie), env, context())).status, 401);
    assert.equal(forwarded.length, 0);
  } finally {
    database.close();
  }
});