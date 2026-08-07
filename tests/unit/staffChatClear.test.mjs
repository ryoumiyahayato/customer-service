import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerTypeScriptHooks } from '../helpers/tsExtensionLoader.mjs';
import { SqliteD1Adapter } from '../helpers/sqliteD1Adapter.mjs';

registerTypeScriptHooks();
const { default: worker } = await import('../../src/worker-entry.ts');
const { COOKIE_NAMES } = await import('../../src/security/cookies.ts');
const { signValue } = await import('../../src/security/signing.ts');
const { hashSessionToken } = await import('../../src/security/sessionTokens.ts');

const SECRET = 'staff-chat-clear-test-secret';
const NOW = new Date().toISOString();
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

function createDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE admins (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      role TEXT NOT NULL,
      is_disabled INTEGER NOT NULL DEFAULT 0
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
    CREATE TABLE staff_messages (
      id TEXT PRIMARY KEY,
      sender_admin_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      reset_at INTEGER NOT NULL
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

async function insertAdmin(database, id, role) {
  const sessionId = `session-${id}`;
  database.prepare('INSERT INTO admins(id,username,role,is_disabled) VALUES(?,?,?,0)').run(id, id, role);
  database.prepare('INSERT INTO admin_sessions(id,admin_id,token_hash,created_at,last_seen_at,expires_at,revoked_at) VALUES(?,?,?,?,?,?,NULL)')
    .run(sessionId, id, await hashSessionToken(SECRET, sessionId), NOW, NOW, FUTURE);
  return await signValue(SECRET, sessionId);
}

function insertMessages(database) {
  database.prepare('INSERT INTO staff_messages(id,sender_admin_id,content,created_at) VALUES(?,?,?,?)').run('staff-1', 'operator', 'one', NOW);
  database.prepare('INSERT INTO staff_messages(id,sender_admin_id,content,created_at) VALUES(?,?,?,?)').run('staff-2', 'super', 'two', NOW);
}

function staffCount(database) {
  return Number(database.prepare('SELECT COUNT(*) count FROM staff_messages').get().count || 0);
}

function auditRows(database) {
  return database.prepare('SELECT event,actor_id,message FROM system_logs ORDER BY created_at').all();
}

function createEnv(database, broadcasts) {
  return {
    DB: new SqliteD1Adapter(database),
    SESSION_SECRET: SECRET,
    CHAT_ROOM: {
      idFromName(name) { return name; },
      get() {
        return {
          async fetch(request) {
            broadcasts.push(JSON.parse(await request.text()));
            return new Response(null, { status: 200 });
          },
        };
      },
    },
  };
}

function clearRequest(cookie, confirm = 'CLEAR_STAFF_CHAT') {
  return new Request('https://denglu.kefuxitong.net/api/staff-chat', {
    method: 'DELETE',
    headers: {
      Origin: 'https://denglu.kefuxitong.net',
      Cookie: `${COOKIE_NAMES.admin}=${cookie}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ confirm }),
  });
}

test('operator cannot clear staff chat', async () => {
  const database = createDatabase();
  try {
    const broadcasts = [];
    const cookie = await insertAdmin(database, 'operator', 'OPERATOR');
    await insertAdmin(database, 'super', 'SUPER_ADMIN');
    insertMessages(database);

    const response = await worker.fetch(clearRequest(cookie), createEnv(database, broadcasts), {});
    assert.equal(response.status, 403);
    assert.equal(staffCount(database), 2);
    assert.deepEqual(broadcasts, []);
    assert.deepEqual(auditRows(database), []);
  } finally {
    database.close();
  }
});

test('super admin must provide explicit destructive confirmation', async () => {
  const database = createDatabase();
  try {
    const broadcasts = [];
    await insertAdmin(database, 'operator', 'OPERATOR');
    const cookie = await insertAdmin(database, 'super', 'SUPER_ADMIN');
    insertMessages(database);

    const response = await worker.fetch(clearRequest(cookie, 'NO'), createEnv(database, broadcasts), {});
    assert.equal(response.status, 400);
    assert.equal(staffCount(database), 2);
    assert.deepEqual(broadcasts, []);
    assert.deepEqual(auditRows(database), []);
  } finally {
    database.close();
  }
});

test('super admin can clear all staff messages, emits a clear event, and writes an audit record without message bodies', async () => {
  const database = createDatabase();
  try {
    const broadcasts = [];
    await insertAdmin(database, 'operator', 'OPERATOR');
    const cookie = await insertAdmin(database, 'super', 'SUPER_ADMIN');
    insertMessages(database);

    const response = await worker.fetch(clearRequest(cookie), createEnv(database, broadcasts), {});
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.deleted, 2);
    assert.equal(staffCount(database), 0);
    assert.equal(broadcasts.length, 1);
    assert.equal(broadcasts[0].type, 'staff:cleared');
    assert.equal(broadcasts[0].clearedBy, 'super');

    const audits = auditRows(database);
    assert.equal(audits.length, 1);
    assert.equal(audits[0].event, 'admin.staff_chat.clear');
    assert.equal(audits[0].actor_id, 'super');
    const auditMessage = JSON.parse(audits[0].message);
    assert.equal(auditMessage.details.deleted, 2);
    assert.equal(audits[0].message.includes('one'), false);
    assert.equal(audits[0].message.includes('two'), false);
  } finally {
    database.close();
  }
});