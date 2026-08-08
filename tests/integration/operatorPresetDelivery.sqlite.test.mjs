import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerTypeScriptHooks } from '../helpers/tsExtensionLoader.mjs';
import { SqliteD1Adapter } from '../helpers/sqliteD1Adapter.mjs';

registerTypeScriptHooks();
const { default: worker } = await import('../../src/worker-production-boundary.ts');
const { hmacHex } = await import('../../src/security/signing.ts');

const SECRET = 'operator-preset-delivery-secret';
const VISITOR_ROOT = 'vx9qn7zr.org';
const ADMIN_HOST = 'denglu.kefuxitong.net';
const TOKEN = 'd'.repeat(40);
const VISITOR_HOST = `${TOKEN}.${VISITOR_ROOT}`;

function createDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE rate_limits (key TEXT PRIMARY KEY,count INTEGER NOT NULL DEFAULT 0,reset_at INTEGER NOT NULL);
    CREATE TABLE admins (
      id TEXT PRIMARY KEY,username TEXT NOT NULL,display_name TEXT,role TEXT NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 0,is_disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT,updated_at TEXT,last_seen_at TEXT
    );
    CREATE TABLE admin_sessions (
      id TEXT PRIMARY KEY,admin_id TEXT NOT NULL,token_hash TEXT NOT NULL,created_at TEXT NOT NULL,
      last_seen_at TEXT,expires_at TEXT NOT NULL,revoked_at TEXT
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY,value_json TEXT NOT NULL,updated_at TEXT);
    CREATE TABLE operator_policies (
      admin_id TEXT PRIMARY KEY,can_create_invites INTEGER NOT NULL DEFAULT 0,
      can_use_staff_chat INTEGER NOT NULL DEFAULT 0,can_upload_images INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE operator_presentations (
      admin_id TEXT PRIMARY KEY,welcome_text TEXT NOT NULL DEFAULT '',avatar_key TEXT NOT NULL DEFAULT '',
      qr_background_color TEXT NOT NULL DEFAULT '#ffffff',qr_accent_color TEXT NOT NULL DEFAULT '#18b868',
      qr_top_text TEXT NOT NULL DEFAULT '扫码联系客服',qr_bottom_text TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL
    );
    CREATE TABLE session_client_metadata (
      session_id TEXT PRIMARY KEY,device_label TEXT NOT NULL DEFAULT '',approximate_location TEXT NOT NULL DEFAULT '',
      captured_at TEXT NOT NULL,ip_address TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE admin_session_metadata (
      session_id TEXT PRIMARY KEY,device_label TEXT NOT NULL DEFAULT '',approximate_location TEXT NOT NULL DEFAULT '',captured_at TEXT NOT NULL
    );
    CREATE TABLE admin_active_sessions (admin_id TEXT PRIMARY KEY,session_id TEXT NOT NULL UNIQUE,updated_at TEXT NOT NULL);
    CREATE TABLE operator_preset_messages (
      id TEXT PRIMARY KEY,admin_id TEXT NOT NULL,position INTEGER NOT NULL DEFAULT 0,message_type TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',image_object_key TEXT,image_mime_type TEXT,image_byte_size INTEGER,
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL
    );
    CREATE TABLE operator_preset_applications (session_id TEXT PRIMARY KEY,owner_admin_id TEXT NOT NULL,applied_at TEXT NOT NULL);
    CREATE TABLE invite_links (
      id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,source_operator_id TEXT,created_by_admin_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,revoked_at TEXT,consumed_at TEXT,consumed_session_id TEXT,created_at TEXT
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY,visitor_key TEXT NOT NULL UNIQUE,account_id TEXT,display_name TEXT,last_seen_at TEXT,
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL,source_user_id TEXT,assigned_operator_id TEXT,last_operator_id TEXT,
      status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,archived_at TEXT,archived_by TEXT,
      deleted_at TEXT,deleted_by TEXT,purged_at TEXT,history_cleared_at TEXT,history_cleared_by TEXT
    );
    CREATE TABLE visitor_sessions (
      id TEXT PRIMARY KEY,visitor_account_id TEXT,visitor_key TEXT,token_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,expires_at TEXT NOT NULL,revoked_at TEXT
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,session_id TEXT NOT NULL,sender_type TEXT NOT NULL,sender_id TEXT NOT NULL,
      content TEXT NOT NULL,message_type TEXT NOT NULL,image_path TEXT,status TEXT NOT NULL,created_at TEXT NOT NULL,
      read_at TEXT,is_read INTEGER NOT NULL DEFAULT 0,quote_message_id TEXT,recalled_at TEXT,image_purged_at TEXT,
      client_message_id TEXT NOT NULL,deleted_at TEXT,
      UNIQUE(session_id,sender_type,sender_id,client_message_id)
    );
    CREATE TABLE attachments (
      id TEXT PRIMARY KEY,message_id TEXT,conversation_id TEXT NOT NULL,object_key TEXT NOT NULL UNIQUE,file_name TEXT,
      mime_type TEXT,byte_size INTEGER,created_at TEXT NOT NULL,created_by_type TEXT NOT NULL,created_by_id TEXT NOT NULL,
      expires_at TEXT,deleted_at TEXT
    );
  `);
  return database;
}

function fakeR2() {
  const objects = new Map();
  return {
    objects,
    async put(key, value, options = {}) {
      const bytes = new Uint8Array(await new Response(value).arrayBuffer());
      objects.set(key, { bytes, httpMetadata: options.httpMetadata || {} });
      return {};
    },
    async get(key) {
      const object = objects.get(key);
      if (!object) return null;
      return { body: object.bytes, size: object.bytes.byteLength, httpMetadata: object.httpMetadata };
    },
    async delete(key) { objects.delete(key); },
  };
}

function fakeRooms() {
  return {
    idFromName(name) { return name; },
    get() { return { async fetch() { return new Response('ok'); } }; },
  };
}

function environment(database, uploads) {
  return {
    DB: new SqliteD1Adapter(database),
    UPLOADS: uploads,
    CHAT_ROOM: fakeRooms(),
    ASSETS: { async fetch() { return new Response('not used', { status: 404 }); } },
    SESSION_SECRET: SECRET,
    VISITOR_ROOT_DOMAIN: VISITOR_ROOT,
    VISITOR_PUBLIC_HOSTS: VISITOR_ROOT,
    ADMIN_PUBLIC_HOST: ADMIN_HOST,
  };
}

function visitorRequest(path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Origin', `https://${VISITOR_HOST}`);
  return new Request(`https://${VISITOR_HOST}${path}`, { ...init, headers });
}

function context() {
  const pending = [];
  return {
    pending,
    waitUntil(promise) { pending.push(Promise.resolve(promise)); },
    passThroughOnException() {},
  };
}

async function seed(database, uploads) {
  const at = new Date().toISOString();
  database.prepare(`INSERT INTO admins(
    id,username,display_name,role,must_change_password,is_disabled,created_at,updated_at,last_seen_at
  ) VALUES(?,?,?,?,0,0,?,?,?)`).run('admin-owner', 'owner', 'Owner', 'SUPER_ADMIN', at, at, at);
  database.prepare(`INSERT INTO operator_presentations(
    admin_id,welcome_text,avatar_key,qr_background_color,qr_accent_color,qr_top_text,qr_bottom_text,updated_at
  ) VALUES(?,?,?,?,?,?,?,?)`).run('admin-owner', '', '', '#ffffff', '#18b868', '扫码联系客服', '', at);
  database.prepare(`INSERT INTO invite_links(
    id,token_hash,source_operator_id,created_by_admin_id,expires_at,revoked_at,consumed_at,consumed_session_id,created_at
  ) VALUES(?,?,?,?,?,NULL,NULL,NULL,?)`).run(
    'preset-invite',
    await hmacHex(SECRET, `invite:${TOKEN}`),
    null,
    'admin-owner',
    new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    at,
  );

  const png = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);
  const sourceKey = 'operator-presets/admin-owner/source.png';
  await uploads.put(sourceKey, png, { httpMetadata: { contentType: 'image/png' } });
  const insert = database.prepare(`INSERT INTO operator_preset_messages(
    id,admin_id,position,message_type,content,image_object_key,image_mime_type,image_byte_size,created_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?)`);
  insert.run('preset-text-1', 'admin-owner', 0, 'text', '您好，请告诉我您需要什么帮助。', null, null, null, at, at);
  insert.run('preset-image-1', 'admin-owner', 1, 'image', '', sourceKey, 'image/png', png.byteLength, at, at);
  insert.run('preset-text-2', 'admin-owner', 2, 'text', '也可以直接发送图片说明问题。', null, null, null, at, at);
}

test('preset text and image content is persisted and returned as ordinary operator chat history', async () => {
  const database = createDatabase();
  const uploads = fakeR2();
  const env = environment(database, uploads);
  const ctx = context();
  try {
    await seed(database, uploads);
    const response = await worker.fetch(visitorRequest(`/api/guest/${TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }), env, ctx);
    assert.equal(response.status, 200);
    const bootstrap = await response.json();
    const sessionId = bootstrap?.session?.id;
    assert.equal(typeof sessionId, 'string');

    const messages = Array.isArray(bootstrap.messages) ? bootstrap.messages : [];
    assert.equal(messages.length, 3);
    assert.deepEqual(messages.map(message => message.messageType || message.message_type), ['text', 'image', 'text']);
    assert.deepEqual(messages.map(message => message.clientMessageId || message.client_message_id), [
      'preset:preset-text-1',
      'preset:preset-image-1',
      'preset:preset-text-2',
    ]);
    assert.equal(messages[0].content, '您好，请告诉我您需要什么帮助。');
    assert.equal(messages[2].content, '也可以直接发送图片说明问题。');
    assert.match(messages[1].imagePath || messages[1].image_path || '', /^\/api\/attachments\/[0-9a-f]{32}\.png$/i);

    const stored = database.prepare(`SELECT sender_type,sender_id,message_type,content,image_path,is_read,client_message_id
      FROM messages WHERE session_id=? ORDER BY datetime(created_at),id`).all(sessionId);
    assert.equal(stored.length, 3);
    assert.equal(stored.every(row => row.sender_type === 'OPERATOR' && row.sender_id === 'admin-owner'), true);
    assert.equal(stored.every(row => Number(row.is_read) === 1), true);
    assert.deepEqual(stored.map(row => row.client_message_id), [
      'preset:preset-text-1',
      'preset:preset-image-1',
      'preset:preset-text-2',
    ]);

    const imageMessage = stored.find(row => row.message_type === 'image');
    const attachment = database.prepare(`SELECT message_id,conversation_id,object_key,created_by_type,created_by_id
      FROM attachments WHERE conversation_id=? LIMIT 1`).get(sessionId);
    const storedImageId = database.prepare(`SELECT id FROM messages WHERE session_id=? AND client_message_id='preset:preset-image-1'`).get(sessionId).id;
    assert.equal(attachment.message_id, storedImageId);
    assert.equal(attachment.conversation_id, sessionId);
    assert.equal(attachment.created_by_type, 'OPERATOR');
    assert.equal(attachment.created_by_id, 'admin-owner');
    assert.notEqual(attachment.object_key, 'operator-presets/admin-owner/source.png');
    assert.equal(Boolean(imageMessage.image_path), true);
    assert.equal(uploads.objects.size, 2);

    const applied = database.prepare('SELECT owner_admin_id FROM operator_preset_applications WHERE session_id=?').get(sessionId);
    assert.equal(applied.owner_admin_id, 'admin-owner');

    const cookie = (response.headers.get('set-cookie') || '').split(';')[0];
    const second = await worker.fetch(visitorRequest(`/api/guest/${TOKEN}`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: '{}',
    }), env, ctx);
    assert.equal(second.status, 410);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM messages WHERE session_id=?').get(sessionId).count, 3);
    assert.equal(database.prepare('SELECT COUNT(*) count FROM operator_preset_applications WHERE session_id=?').get(sessionId).count, 1);

    await Promise.allSettled(ctx.pending);
  } finally {
    database.close();
  }
});
