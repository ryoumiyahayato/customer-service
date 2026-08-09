import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerTypeScriptHooks } from '../helpers/tsExtensionLoader.mjs';
import { SqliteD1Adapter } from '../helpers/sqliteD1Adapter.mjs';

registerTypeScriptHooks();
const { default: worker } = await import('../../src/worker-production-boundary.ts');
const { hmacHex, signValue } = await import('../../src/security/signing.ts');
const { hashSessionToken } = await import('../../src/security/sessionTokens.ts');
const { COOKIE_NAMES } = await import('../../src/security/cookies.ts');

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
      must_change_password INTEGER NOT NULL DEFAULT 0,
      is_disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT,
      updated_at TEXT,
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
      updated_at TEXT
    );
    CREATE TABLE operator_policies (
      admin_id TEXT PRIMARY KEY,
      can_create_invites INTEGER NOT NULL DEFAULT 0,
      can_use_staff_chat INTEGER NOT NULL DEFAULT 0,
      can_upload_images INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE operator_presentations (
      admin_id TEXT PRIMARY KEY,
      welcome_text TEXT NOT NULL DEFAULT '您好，请问有什么可以帮您？',
      avatar_key TEXT NOT NULL DEFAULT '',
      qr_background_color TEXT NOT NULL DEFAULT '#ffffff',
      qr_accent_color TEXT NOT NULL DEFAULT '#18b868',
      qr_top_text TEXT NOT NULL DEFAULT '扫码联系客服',
      qr_bottom_text TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE session_client_metadata (
      session_id TEXT PRIMARY KEY,
      device_label TEXT NOT NULL DEFAULT '',
      approximate_location TEXT NOT NULL DEFAULT '',
      captured_at TEXT NOT NULL,
      ip_address TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE admin_session_metadata (
      session_id TEXT PRIMARY KEY,
      device_label TEXT NOT NULL DEFAULT '',
      approximate_location TEXT NOT NULL DEFAULT '',
      captured_at TEXT NOT NULL
    );
    CREATE TABLE admin_active_sessions (
      admin_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE operator_preset_messages (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      message_type TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      image_object_key TEXT,
      image_mime_type TEXT,
      image_byte_size INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE operator_preset_applications (
      session_id TEXT PRIMARY KEY,
      owner_admin_id TEXT NOT NULL,
      applied_at TEXT NOT NULL
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
      deleted_at TEXT
    );
  `);
  return database;
}

async function seedInvite(database) {
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO admins(id,username,display_name,role,must_change_password,is_disabled,created_at,updated_at,last_seen_at)
    VALUES(?,?,?,?,0,0,?,?,?)
  `).run('admin-owner', 'owner', 'Owner', 'SUPER_ADMIN', now, now, now);
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

async function seedAdminCookie(database) {
  const sessionId = 'asess_delivery_admin';
  const createdAt = new Date().toISOString();
  database.prepare(`
    INSERT INTO admin_sessions(id,admin_id,token_hash,created_at,last_seen_at,expires_at,revoked_at)
    VALUES(?,?,?,?,?,?,NULL)
  `).run(
    sessionId,
    'admin-owner',
    await hashSessionToken(SECRET, sessionId),
    createdAt,
    createdAt,
    new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  );
  return `${COOKIE_NAMES.admin}=${await signValue(SECRET, sessionId)}`;
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

function adminRequest(path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Origin', `https://${ADMIN_HOST}`);
  return new Request(`https://${ADMIN_HOST}${path}`, { ...init, headers });
}

function pngForm(sessionId, filename) {
  const pngBytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  ]);
  const form = new FormData();
  form.append('file', new File([pngBytes], filename, { type: 'image/png' }));
  form.append('sessionId', sessionId);
  return form;
}

test('pre-0010 database still delivers visitor and administrator images into the same backend session', async () => {
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
    assert.equal(textPayload?.message?.clientMessageId, 'visitor-text-1');

    const upload = await worker.fetch(visitorRequest(`/api/upload?sessionId=${encodeURIComponent(sessionId)}`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: pngForm(sessionId, 'visitor.png'),
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
    assert.equal(imagePayload?.message?.clientMessageId, 'visitor-image-1');

    const adminCookie = await seedAdminCookie(database);
    const visitorTextRow = database.prepare(
      'SELECT id,is_read FROM messages WHERE session_id=? AND client_message_id=?',
    ).get(sessionId, 'visitor-text-1');
    assert.equal(Number(visitorTextRow.is_read), 0);

    const messagesBeforeGet = Number(database.prepare(
      'SELECT is_read FROM messages WHERE id=?',
    ).get(visitorTextRow.id).is_read);
    const readOnlyGet = await worker.fetch(adminRequest(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: 'GET',
      headers: { Cookie: adminCookie },
    }), env, ctx);
    assert.equal(readOnlyGet.status, 200);
    assert.equal(Number(database.prepare(
      'SELECT is_read FROM messages WHERE id=?',
    ).get(visitorTextRow.id).is_read), messagesBeforeGet);

    const crossSiteRead = await worker.fetch(new Request(
      `https://${ADMIN_HOST}/api/sessions/${encodeURIComponent(sessionId)}/read`,
      {
        method: 'POST',
        headers: {
          Cookie: adminCookie,
          Origin: 'https://evil.example',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messageIds: [visitorTextRow.id] }),
      },
    ), env, ctx);
    assert.equal(crossSiteRead.status, 403);
    assert.equal(Number(database.prepare(
      'SELECT is_read FROM messages WHERE id=?',
    ).get(visitorTextRow.id).is_read), 0);

    const sameOriginRead = await worker.fetch(adminRequest(`/api/sessions/${encodeURIComponent(sessionId)}/read`, {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageIds: [visitorTextRow.id] }),
    }), env, ctx);
    assert.equal(sameOriginRead.status, 200);
    assert.equal(Number(database.prepare(
      'SELECT is_read FROM messages WHERE id=?',
    ).get(visitorTextRow.id).is_read), 1);

    const adminUpload = await worker.fetch(adminRequest(`/api/upload?sessionId=${encodeURIComponent(sessionId)}`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: pngForm(sessionId, 'admin.png'),
    }), env, ctx);
    assert.equal(adminUpload.status, 200);
    const adminUploaded = await adminUpload.json();
    assert.match(adminUploaded.path || '', /^\/api\/attachments\/[0-9a-f-]+\.png$/i);

    const adminImageSend = await worker.fetch(adminRequest('/api/messages', {
      method: 'POST',
      headers: { Cookie: adminCookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        clientMessageId: 'admin-image-1',
        content: '',
        senderType: 'OPERATOR',
        messageType: 'image',
        imagePath: adminUploaded.path,
      }),
    }), env, ctx);
    assert.equal(adminImageSend.status, 200);
    const adminImagePayload = await adminImageSend.json();
    assert.equal(adminImagePayload?.message?.messageType || adminImagePayload?.message?.message_type, 'image');
    assert.equal(adminImagePayload?.message?.clientMessageId || adminImagePayload?.message?.client_message_id, 'admin-image-1');

    const storedImages = database.prepare(`
      SELECT m.id,m.client_message_id,m.sender_type,a.message_id,a.conversation_id,a.created_by_type
        FROM messages m
        JOIN attachments a ON a.message_id=m.id
       WHERE m.session_id=? AND m.message_type='image'
       ORDER BY m.client_message_id
    `).all(sessionId);
    assert.equal(storedImages.length, 2);
    assert.deepEqual(storedImages.map(row => row.client_message_id), ['admin-image-1', 'visitor-image-1']);
    assert.equal(storedImages.every(row => row.message_id === row.id), true);
    assert.equal(storedImages.every(row => row.conversation_id === sessionId), true);
    assert.equal(uploads.objects.size, 2);

    const adminMessages = await worker.fetch(adminRequest(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: 'GET',
      headers: { Cookie: adminCookie },
    }), env, ctx);
    assert.equal(adminMessages.status, 200);
    const adminPayload = await adminMessages.json();
    assert.equal(adminPayload?.messages?.length, 3);
    const adminText = adminPayload.messages.find(message => message.clientMessageId === 'visitor-text-1' || message.client_message_id === 'visitor-text-1');
    const visitorImage = adminPayload.messages.find(message => message.clientMessageId === 'visitor-image-1' || message.client_message_id === 'visitor-image-1');
    const administratorImage = adminPayload.messages.find(message => message.clientMessageId === 'admin-image-1' || message.client_message_id === 'admin-image-1');
    assert.equal(adminText?.content, '你好');
    assert.equal(adminText?.senderType || adminText?.sender_type, 'VISITOR');
    assert.equal(visitorImage?.messageType || visitorImage?.message_type, 'image');
    assert.equal(visitorImage?.senderType || visitorImage?.sender_type, 'VISITOR');
    assert.equal(administratorImage?.messageType || administratorImage?.message_type, 'image');
    assert.equal(administratorImage?.senderType || administratorImage?.sender_type, 'OPERATOR');

    await Promise.allSettled(ctx.pending);
  } finally {
    database.close();
  }
});
