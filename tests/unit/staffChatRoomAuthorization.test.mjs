import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerTypeScriptHooks } from '../helpers/tsExtensionLoader.mjs';
import { SqliteD1Adapter } from '../helpers/sqliteD1Adapter.mjs';

registerTypeScriptHooks();
const {
  ChatRoom,
  createChatRoomBroadcastRequest,
} = await import('../../src/durable-objects/ChatRoom.ts');

const NOW = new Date().toISOString();
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

class TestSocket {
  constructor(attachment) {
    this.attachment = attachment;
    this.sent = [];
    this.closed = null;
  }
  deserializeAttachment() { return this.attachment; }
  send(payload) { this.sent.push(JSON.parse(payload)); }
  close(code, reason) { this.closed = { code, reason }; }
}

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

function addAdmin(database, id, role = 'OPERATOR') {
  database.prepare('INSERT INTO admins(id,username,role,is_disabled) VALUES(?,?,?,0)').run(id, id, role);
  database.prepare('INSERT INTO admin_sessions(id,admin_id,token_hash,created_at,last_seen_at,expires_at,revoked_at) VALUES(?,?,?,?,?,?,NULL)')
    .run(`staff-auth-${id}`, id, 'not-used-by-room-revalidation', NOW, NOW, FUTURE);
  if (role === 'OPERATOR') {
    database.prepare('INSERT INTO operator_policies(admin_id,can_create_invites,can_use_staff_chat,can_upload_images,updated_at) VALUES(?,?,?,?,?)')
      .run(id, 1, 1, 1, NOW);
  }
}

function staffMeta(id) {
  return { mode: 'staff', principalId: id, authSessionId: `staff-auth-${id}` };
}

function room(database, sockets) {
  return new ChatRoom({ getWebSockets() { return sockets; } }, { DB: new SqliteD1Adapter(database) });
}

async function broadcastStaff(chatRoom, id) {
  const response = await chatRoom.fetch(createChatRoomBroadcastRequest('staff', { type: 'staff:new', message: { id } }));
  assert.equal(response.status, 200);
}

test('staff broadcast fails closed for legacy anonymous sockets and accepts current authorized staff identities', async () => {
  const database = createDatabase();
  try {
    addAdmin(database, 'operator-a');
    addAdmin(database, 'super-a', 'SUPER_ADMIN');
    const operator = new TestSocket(staffMeta('operator-a'));
    const superAdmin = new TestSocket(staffMeta('super-a'));
    const legacy = new TestSocket({ mode: 'room' });

    await broadcastStaff(room(database, [operator, superAdmin, legacy]), 'first');
    assert.equal(operator.sent.length, 1);
    assert.equal(superAdmin.sent.length, 1);
    assert.deepEqual(legacy.sent, []);
    assert.deepEqual(legacy.closed, { code: 1008, reason: 'Staff access revoked' });
  } finally {
    database.close();
  }
});

test('already connected operator staff socket is cut off after capability is revoked', async () => {
  const database = createDatabase();
  try {
    addAdmin(database, 'operator-a');
    const operator = new TestSocket(staffMeta('operator-a'));
    const chatRoom = room(database, [operator]);

    await broadcastStaff(chatRoom, 'before-policy-change');
    assert.equal(operator.sent.length, 1);

    database.prepare('UPDATE operator_policies SET can_use_staff_chat=0,updated_at=? WHERE admin_id=?')
      .run(NOW, 'operator-a');
    operator.sent.length = 0;

    await broadcastStaff(chatRoom, 'after-policy-change');
    assert.deepEqual(operator.sent, []);
    assert.deepEqual(operator.closed, { code: 1008, reason: 'Staff access revoked' });
  } finally {
    database.close();
  }
});

test('already connected staff socket is cut off after backend login session is revoked', async () => {
  const database = createDatabase();
  try {
    addAdmin(database, 'operator-a');
    const operator = new TestSocket(staffMeta('operator-a'));
    const chatRoom = room(database, [operator]);

    await broadcastStaff(chatRoom, 'before-session-revoke');
    assert.equal(operator.sent.length, 1);

    database.prepare('UPDATE admin_sessions SET revoked_at=? WHERE id=?').run(NOW, 'staff-auth-operator-a');
    operator.sent.length = 0;

    await broadcastStaff(chatRoom, 'after-session-revoke');
    assert.deepEqual(operator.sent, []);
    assert.deepEqual(operator.closed, { code: 1008, reason: 'Staff access revoked' });
  } finally {
    database.close();
  }
});