import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerTypeScriptHooks } from '../helpers/tsExtensionLoader.mjs';
import { SqliteD1Adapter } from '../helpers/sqliteD1Adapter.mjs';

registerTypeScriptHooks();
const { default: worker } = await import('../../src/worker-production-boundary.ts');
const { hmacHex } = await import('../../src/security/signing.ts');

const SECRET = 'visitor-delivery-integration-secret';
const VISITOR_ROOT = 'vx9qn7zr.org';
const ADMIN_HOST = 'denglu.kefuxitong.net';
const TOKEN = 'c'.repeat(40);
const VISITOR_HOST = `${TOKEN}.${VISITOR_ROOT}`;

function createDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      reset_at INTEGER NOT NULL
    );
    CREATE TABLE admins (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      display_name TEXT,
      role TEXT NOT NULL,
      is_disabled INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE TABLE invite_links (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      source_operator_id TEXT,
      created_by_admin_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      consumed_at TEXT,
      consumed_session_id TEXT,
      created_at TEXT
    );
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      visitor_key TEXT NOT NULL UNIQUE,
      account_id TEXT,
      display_name TEXT,
      last_seen_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      source_user_id TEXT,
      assigned_operator_id TEXT,
      last_operator_id TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT,
      archived_by TEXT,
      deleted_at TEXT,
      deleted_by TEXT,
      purged_at TEXT,
      history_cleared_at TEXT,
      history_cleared_by TEXT
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
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      sender_type TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      content TEXT NOT NULL,
      message_type TEXT NOT NULL,
      image_path TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      read_at TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      quote_message_id TEXT,
      recalled_at TEXT,
      image_purged_at TEXT,
      client_message_id TEXT NOT NULL,
      deleted_at TEXT,
      UNIQUE(session_id,sender_type,sender_id,client_message_id)
    );
    CREATE TABLE attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      conversation_id TEXT NOT NULL,
      object_key TEXT NOT NULL UNIQUE,
      file_name TEXT,
      mime_type TEXT,
      byte_size INTEGER,
      created_at TEXT NOT NULL,
      created_by_type TEXT NOT NULL,
      created_by_id TEXT NOT NULL,
      expires_at TEXT,
      deleted_at TEXT,
      claim_token TEXT
    );
  `);
  return database;
}

async function seedInvite(database) {
  const now = new Date().toISOString();
  database.prepare('INSERT INTO admins(id,username,display_name,role,is_disabled) VALUES(?,?,?,?,0)')
    .run('admin-owner', 'owner', 'Owner', 'SUPER_ADMIN');
  database.prepare(`
    INSERT INTO invite_links(
      id,token_hash,source_operator_id,created_by_admin_id,expires_at,revoked_at,consumed_at,consumed_session_id,created_at
    ) VALUES(?,?,?,?,?,NULL,NULL,NULL,?)
  `).run(
    'inv_delivery',
    await hmacHex(SECRET, `invite:${TOKEN}`),
    null,
    'admin-owner',
    new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    now,
  );
}

function fakeR2() {
  const objects = new Map();
  return {
    objects,
    async put(key, value, options = {}) {
      const bytes = value instanceof ReadableStream
        ? new Uint8Array(await new Response(value).arrayBuffer())
        : new Uint8Array(await new Response(value).arrayBuffer());
      objects.set(key, { bytes, httpMetadata: options.httpMetadata || {} });
      return {};
    },
    async get(key) {
      const object = objects.get(key);
      if (!object) return null;
      return { body: object.bytes, httpMetadata: object.httpMetadata };
    },
    async delete(key) {
      objects.delete(key);
    },
  };
}

function fakeRooms() {
  return {
    idFromName(name) { return name; },
    get() {
      return { async fetch() { return new Response('ok'); } };
    },
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

function context() {
  const pending = [];
  return {
    pending,
    waitUntil(promise) { pending.push(Promise.resolve(promise)); },
    passThroughOnException() {},
  };
}

function cookieFrom(response) {
  const setCookie = response.headers.get('set-cookie') || '';
  return setCookie.split(';')[0];
}

function visitorRequest(path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Origin', `https://${VISITOR_HOST}`);
  return new Request(`https://${VISITOR_HOST}${path}`, { ...init, headers });
}

test('consumed visitor invite delivers text and image messages into the same backend session', async () => {
  const database = createDatabase();
  const uploads = fakeR2();
  const env = environment(database, uploads);
  const ctx = context();
  try {
    await seedInvite(database);

    const consume = await worker.fetch(visitorRequest(`/api/guest/${TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }), env, ctx);
    assert.equal(consume.status, 200);
    const bootstrap = await consume.json();
    const sessionId = bootstrap?.session?.id;
    assert.equal(typeof sessionId, 'string');
    assert.ok(sessionId);
    const cookie = cookieFrom(consume);
    assert.match(cookie, /^__Host-guest_session=/);

    const text = await worker.fetch(visitorRequest('/api/messages', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        clientMessageId: 'visitor-text-1',
        content: '你好',
        senderType: 'VISITOR',
      }),
    }), env, ctx);
    assert.equal(text.status, 200);
    const textPayload = await text.json();
    assert.equal(textPayload?.message?.content, '你好');
    assert.equal(textPayload?.message?.senderId, null);
    const storedText = database.prepare(
      "SELECT content,sender_type FROM messages WHERE session_id=? AND client_message_id='visitor-text-1'",
    ).get(sessionId);
    assert.equal(storedText?.content, '你好');
    assert.equal(storedText?.sender_type, 'VISITOR');

    const pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]);
    const form = new FormData();
    form.append('file', new File([pngBytes], 'smoke.png', { type: 'image/png' }));
    form.append('sessionId', sessionId);
    const upload = await worker.fetch(visitorRequest(`/api/upload?sessionId=${encodeURIComponent(sessionId)}`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: form,
    }), env, ctx);
    assert.equal(upload.status, 200);
    const uploaded = await upload.json();
    assert.match(uploaded.path || '', /^\/api\/attachments\/[0-9a-f-]+\.png$/i);

    const image = await worker.fetch(visitorRequest('/api/messages', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        clientMessageId: 'visitor-image-1',
        content: '',
        senderType: 'VISITOR',
        messageType: 'image',
        imagePath: uploaded.path,
      }),
    }), env, ctx);
    assert.equal(image.status, 200);
    const imagePayload = await image.json();
    assert.equal(imagePayload?.message?.messageType, 'image');
    assert.equal(imagePayload?.message?.senderId, null);

    const storedImage = database.prepare(`
      SELECT m.id,m.message_type,a.message_id,a.conversation_id,a.created_by_type
        FROM messages m
        JOIN attachments a ON a.message_id=m.id
       WHERE m.session_id=? AND m.client_message_id='visitor-image-1'
    `).get(sessionId);
    assert.equal(storedImage?.message_type, 'image');
    assert.equal(storedImage?.message_id, storedImage?.id);
    assert.equal(storedImage?.conversation_id, sessionId);
    assert.equal(storedImage?.created_by_type, 'VISITOR');
    assert.equal(uploads.objects.size, 1);

    await Promise.allSettled(ctx.pending);
  } finally {
    database.close();
  }
});
