import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerTypeScriptHooks } from '../helpers/tsExtensionLoader.mjs';
import { SqliteD1Adapter } from '../helpers/sqliteD1Adapter.mjs';

registerTypeScriptHooks();
const {
  CHAT_ROOM_AUTH_SESSION_HEADER,
  CHAT_ROOM_PRINCIPAL_ID_HEADER,
  CHAT_ROOM_PRINCIPAL_TYPE_HEADER,
  CHAT_ROOM_SESSION_HEADER,
  ChatRoom,
  createChatRoomBroadcastRequest,
} = await import('../../src/durable-objects/ChatRoom.ts');
const { default: worker } = await import('../../src/worker-business-hardening.ts');
const { signValue } = await import('../../src/security/signing.ts');
const { hashSessionToken } = await import('../../src/security/sessionTokens.ts');

const SECRET = 'chat-room-authorization-test-secret';
const NOW = new Date().toISOString();
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

class TestSocket {
  constructor(attachment) {
    this.attachment = attachment;
    this.sent = [];
    this.closed = null;
  }

  deserializeAttachment() {
    return this.attachment;
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  close(code, reason) {
    this.closed = { code, reason };
  }
}

function conversationMeta(sessionId, principalType, principalId, authSessionId = `room-auth-${principalId}`) {
  return { mode: 'conversation', sessionId, principalType, principalId, authSessionId };
}

function createDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE admins (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      role TEXT NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 0,
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
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      visitor_key TEXT NOT NULL,
      account_id TEXT,
      display_name TEXT,
      last_seen_at TEXT,
      created_at TEXT,
      updated_at TEXT
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
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      assigned_operator_id TEXT,
      status TEXT NOT NULL,
      archived_at TEXT,
      deleted_at TEXT,
      purged_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      reset_at INTEGER NOT NULL
    );
  `);
  return database;
}

function insertIdentity(database, { id, role = 'OPERATOR', disabled = 0 }) {
  database.prepare('INSERT INTO admins(id,username,role,is_disabled,last_seen_at) VALUES(?,?,?,?,?)')
    .run(id, id, role, disabled, NOW);
  database.prepare(
    'INSERT INTO admin_sessions(id,admin_id,token_hash,created_at,last_seen_at,expires_at,revoked_at) VALUES(?,?,?,?,?,?,NULL)',
  ).run(`room-auth-${id}`, id, 'test-token-hash', NOW, NOW, FUTURE);
}

function insertGuestIdentity(database, userId) {
  const visitorKey = `visitor-${userId}`;
  database.prepare('INSERT INTO users(id,visitor_key,created_at,updated_at) VALUES(?,?,?,?)')
    .run(userId, visitorKey, NOW, NOW);
  database.prepare(
    'INSERT INTO visitor_sessions(id,visitor_key,token_hash,created_at,expires_at,revoked_at) VALUES(?,?,?,?,?,NULL)',
  ).run(`room-auth-${userId}`, visitorKey, 'test-token-hash', NOW, FUTURE);
}

function insertSession(database, id, userId, operatorId) {
  database.prepare('INSERT INTO sessions(id,user_id,assigned_operator_id,status,updated_at) VALUES(?,?,?,?,?)')
    .run(id, userId, operatorId, 'OPEN', NOW);
}

function room(database, sockets) {
  const state = {
    getWebSockets() { return sockets; },
  };
  return new ChatRoom(state, { DB: new SqliteD1Adapter(database) });
}

async function broadcast(chatRoom, sessionId, payload) {
  const response = await chatRoom.fetch(createChatRoomBroadcastRequest(`conversation:${sessionId}`, payload));
  assert.equal(response.status, 200);
}

test('revalidates established conversation sockets against current assignment before every broadcast', async () => {
  const database = createDatabase();
  try {
    insertIdentity(database, { id: 'operator-a' });
    insertIdentity(database, { id: 'operator-b' });
    insertIdentity(database, { id: 'super-admin', role: 'SUPER_ADMIN' });
    insertGuestIdentity(database, 'guest-user');
    insertSession(database, 'session-a', 'guest-user', 'operator-a');

    const operatorA = new TestSocket(conversationMeta('session-a', 'admin', 'operator-a'));
    const superAdmin = new TestSocket(conversationMeta('session-a', 'admin', 'super-admin'));
    const guest = new TestSocket(conversationMeta('session-a', 'guest', 'guest-user'));
    const sockets = [operatorA, superAdmin, guest];
    const chatRoom = room(database, sockets);

    await broadcast(chatRoom, 'session-a', {
      type: 'message:new',
      conversationId: 'session-a',
      message: { id: 'before-transfer' },
    });
    assert.equal(operatorA.sent.length, 1, 'current operator receives before transfer');
    assert.equal(superAdmin.sent.length, 1, 'super admin receives before transfer');
    assert.equal(guest.sent.length, 1, 'guest receives before transfer');

    const operatorB = new TestSocket(conversationMeta('session-a', 'admin', 'operator-b'));
    sockets.push(operatorB);
    database.prepare('UPDATE sessions SET assigned_operator_id=? WHERE id=?').run('operator-b', 'session-a');
    operatorA.sent.length = 0;
    superAdmin.sent.length = 0;
    guest.sent.length = 0;

    await broadcast(chatRoom, 'session-a', {
      type: 'message:new',
      conversationId: 'session-a',
      message: { id: 'after-transfer' },
    });
    assert.deepEqual(operatorA.sent, []);
    assert.deepEqual(operatorA.closed, { code: 1008, reason: 'Session access revoked' });
    assert.equal(operatorB.sent.length, 1, 'new operator receives after transfer');
    assert.equal(superAdmin.sent.length, 1, 'super admin remains authorized');
    assert.equal(guest.sent.length, 1, 'guest message behavior remains authorized');
  } finally {
    database.close();
  }
});

test('applies the same current ACL to every protected session event and rejects legacy room metadata', async () => {
  const events = [
    { type: 'messages:read', conversationId: 'session-a', messageIds: ['message-1'] },
    { type: 'message:updated', conversationId: 'session-a', message: { id: 'message-1' } },
    { type: 'message:deleted', conversationId: 'session-a', messageId: 'message-1' },
    { type: 'session:updated', conversationId: 'session-a', session: { id: 'session-a' } },
  ];

  for (const event of events) {
    const database = createDatabase();
    try {
      insertIdentity(database, { id: 'operator-a' });
      insertIdentity(database, { id: 'operator-b' });
      insertSession(database, 'session-a', 'guest-user', 'operator-b');
      const staleA = new TestSocket(conversationMeta('session-a', 'admin', 'operator-a'));
      const operatorB = new TestSocket(conversationMeta('session-a', 'admin', 'operator-b'));
      const legacy = new TestSocket({ mode: 'room' });
      await broadcast(room(database, [staleA, operatorB, legacy]), 'session-a', event);
      assert.deepEqual(staleA.sent, [], `${event.type}: stale operator must not receive`);
      assert.equal(staleA.closed?.code, 1008, `${event.type}: stale operator is disconnected`);
      assert.equal(operatorB.sent.length, 1, `${event.type}: current operator receives`);
      assert.equal(legacy.closed?.code, 1008, `${event.type}: pre-fix metadata fails closed`);
    } finally {
      database.close();
    }
  }
});

test('a reassignment in one session does not revoke an authorized connection to another session', async () => {
  const database = createDatabase();
  try {
    insertIdentity(database, { id: 'operator-a' });
    insertIdentity(database, { id: 'operator-b' });
    insertSession(database, 'session-a', 'guest-a', 'operator-b');
    insertSession(database, 'session-b', 'guest-b', 'operator-a');
    const operatorAOnB = new TestSocket(conversationMeta('session-b', 'admin', 'operator-a'));
    await broadcast(room(database, [operatorAOnB]), 'session-b', {
      type: 'message:new',
      conversationId: 'session-b',
      message: { id: 'other-session-message' },
    });
    assert.equal(operatorAOnB.sent.length, 1);
    assert.equal(operatorAOnB.closed, null);
  } finally {
    database.close();
  }
});

function executionContext() {
  return {
    waitUntil(promise) { return promise; },
    passThroughOnException() {},
  };
}

async function addAdminSession(database, adminId) {
  const sessionId = `auth-${adminId}`;
  database.prepare(
    'INSERT INTO admin_sessions(id,admin_id,token_hash,created_at,last_seen_at,expires_at,revoked_at) VALUES(?,?,?,?,?,?,NULL)',
  ).run(sessionId, adminId, await hashSessionToken(SECRET, sessionId), NOW, NOW, FUTURE);
  return `support_admin=${await signValue(SECRET, sessionId)}`;
}

async function addGuestSession(database, visitorKey) {
  const sessionId = `auth-${visitorKey}`;
  database.prepare(
    'INSERT INTO visitor_sessions(id,visitor_key,token_hash,created_at,expires_at,revoked_at) VALUES(?,?,?,?,?,NULL)',
  ).run(sessionId, visitorKey, await hashSessionToken(SECRET, sessionId), NOW, FUTURE);
  return `guest_session=${await signValue(SECRET, sessionId)}`;
}

function request(path, cookie, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('origin', 'https://denglu.kefuxitong.net');
  if (cookie) headers.set('cookie', cookie);
  return new Request(`https://denglu.kefuxitong.net${path}`, { ...init, headers });
}

test('production WebSocket handshake and HTTP paths use current ownership after reconnect', async () => {
  const database = createDatabase();
  try {
    insertIdentity(database, { id: 'operator-a' });
    insertIdentity(database, { id: 'operator-b' });
    insertIdentity(database, { id: 'super-admin', role: 'SUPER_ADMIN' });
    database.prepare('INSERT INTO users(id,visitor_key,created_at,updated_at) VALUES(?,?,?,?)')
      .run('guest-user', 'visitor-1', NOW, NOW);
    insertSession(database, 'session-a', 'guest-user', 'operator-a');
    insertSession(database, 'session-b', 'guest-user-2', 'operator-a');

    const cookies = {
      a: await addAdminSession(database, 'operator-a'),
      b: await addAdminSession(database, 'operator-b'),
      super: await addAdminSession(database, 'super-admin'),
      guest: await addGuestSession(database, 'visitor-1'),
    };
    const forwarded = [];
    const env = {
      DB: new SqliteD1Adapter(database),
      SESSION_SECRET: SECRET,
      CHAT_ROOM: {
        idFromName(name) { return name; },
        get(name) {
          return {
            async fetch(forwardedRequest) {
              forwarded.push({ name, request: forwardedRequest });
              return new Response('joined', { status: 200 });
            },
          };
        },
      },
    };
    const open = (sessionId, cookie) => worker.fetch(
      request(`/api/ws/conversations/${sessionId}`, cookie, { headers: { upgrade: 'websocket' } }),
      env,
      executionContext(),
    );

    assert.equal((await open('session-a', cookies.a)).status, 200, 'A initially joins owned session');
    assert.equal(forwarded.at(-1).request.headers.get(CHAT_ROOM_SESSION_HEADER), 'session-a');
    assert.equal(forwarded.at(-1).request.headers.get(CHAT_ROOM_PRINCIPAL_TYPE_HEADER), 'admin');
    assert.equal(forwarded.at(-1).request.headers.get(CHAT_ROOM_PRINCIPAL_ID_HEADER), 'operator-a');
    assert.equal(forwarded.at(-1).request.headers.get(CHAT_ROOM_AUTH_SESSION_HEADER), 'auth-operator-a');

    database.prepare('UPDATE sessions SET assigned_operator_id=? WHERE id=?').run('operator-b', 'session-a');
    const forwardedBeforeDeniedReconnect = forwarded.length;
    assert.equal((await open('session-a', cookies.a)).status, 403, 'A reconnect is denied after transfer');
    assert.equal(forwarded.length, forwardedBeforeDeniedReconnect, 'denied reconnect never reaches the room');
    assert.equal((await open('session-a', cookies.b)).status, 200, 'B can join after transfer');
    assert.equal((await open('session-a', cookies.super)).status, 200, 'super admin remains authorized');
    assert.equal((await open('session-a', cookies.guest)).status, 200, 'guest remains authorized');
    assert.equal((await open('session-b', cookies.a)).status, 200, 'A remains authorized for a different owned session');

    const staleMessage = await worker.fetch(request('/api/messages', cookies.a, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'session-a',
        senderType: 'OPERATOR',
        content: 'stale owner must not write',
        clientMessageId: 'stale-owner-message',
      }),
    }), env, executionContext());
    assert.equal(staleMessage.status, 403, 'HTTP message ownership remains enforced');

    const staleRemark = await worker.fetch(request('/api/sessions/session-a/customer-remark', cookies.a, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ remarkName: 'stale owner must not write' }),
    }), env, executionContext());
    assert.equal(staleRemark.status, 403, 'customer remark ownership remains enforced');
  } finally {
    database.close();
  }
});
