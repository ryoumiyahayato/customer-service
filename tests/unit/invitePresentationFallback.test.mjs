import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerTypeScriptHooks } from '../helpers/tsExtensionLoader.mjs';
import { SqliteD1Adapter } from '../helpers/sqliteD1Adapter.mjs';

registerTypeScriptHooks();
const { default: worker } = await import('../../src/worker-entry.ts');
const { hmacHex } = await import('../../src/security/signing.ts');

const SECRET = 'invite-presentation-fallback-test-secret';

function createDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE admins (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      display_name TEXT,
      is_disabled INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE operator_presentations (
      admin_id TEXT PRIMARY KEY,
      welcome_text TEXT NOT NULL,
      avatar_key TEXT NOT NULL,
      qr_background_color TEXT NOT NULL,
      qr_accent_color TEXT NOT NULL,
      qr_top_text TEXT NOT NULL,
      qr_bottom_text TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE invite_links (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      source_operator_id TEXT,
      created_by_admin_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    );
  `);
  return database;
}

async function insertInvite(database, { token, sourceOperatorId = null, createdByAdminId }) {
  const tokenHash = await hmacHex(SECRET, `invite:${token}`);
  database.prepare(`
    INSERT INTO invite_links(id,token_hash,source_operator_id,created_by_admin_id,expires_at,revoked_at)
    VALUES(?,?,?,?,?,NULL)
  `).run(
    `invite-${token.slice(0, 4)}`,
    tokenHash,
    sourceOperatorId,
    createdByAdminId,
    new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  );
}

function insertAdmin(database, id, username, welcomeText) {
  database.prepare('INSERT INTO admins(id,username,display_name,is_disabled) VALUES(?,?,?,0)')
    .run(id, username, username);
  database.prepare(`INSERT INTO operator_presentations(
      admin_id,welcome_text,avatar_key,qr_background_color,qr_accent_color,qr_top_text,qr_bottom_text,updated_at
    ) VALUES(?,?,?,?,?,?,?,?)`)
    .run(id, welcomeText, '', '#ffffff', '#18b868', '扫码联系客服', '', new Date().toISOString());
}

function env(database) {
  return {
    DB: new SqliteD1Adapter(database),
    SESSION_SECRET: SECRET,
  };
}

test('unassigned invite uses the creator presentation without assigning the session', async () => {
  const database = createDatabase();
  try {
    const token = 'a'.repeat(40);
    insertAdmin(database, 'super-admin', 'ryouma', '欢迎来到客服系统');
    await insertInvite(database, { token, createdByAdminId: 'super-admin' });

    const response = await worker.fetch(
      new Request(`https://denglu.kefuxitong.net/api/invite-presentation/${token}`),
      env(database),
      {},
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.presentation.operatorId, 'super-admin');
    assert.equal(body.presentation.displayName, 'ryouma');
    assert.equal(body.presentation.welcomeText, '欢迎来到客服系统');
    assert.equal(body.presentation.qrAccentColor, '#18b868');
    const invite = database.prepare('SELECT source_operator_id FROM invite_links WHERE token_hash IS NOT NULL LIMIT 1').get();
    assert.equal(invite.source_operator_id, null);
  } finally {
    database.close();
  }
});

test('assigned invite still prefers the selected operator presentation', async () => {
  const database = createDatabase();
  try {
    const token = 'b'.repeat(40);
    insertAdmin(database, 'super-admin', 'ryouma', '超管欢迎词');
    insertAdmin(database, 'operator-1', 'operator1', '客服欢迎词');
    await insertInvite(database, {
      token,
      sourceOperatorId: 'operator-1',
      createdByAdminId: 'super-admin',
    });

    const response = await worker.fetch(
      new Request(`https://denglu.kefuxitong.net/api/invite-presentation/${token}`),
      env(database),
      {},
    );
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.presentation.operatorId, 'operator-1');
    assert.equal(body.presentation.welcomeText, '客服欢迎词');
  } finally {
    database.close();
  }
});

test('trash restore endpoint is disabled at the outer worker boundary', async () => {
  const response = await worker.fetch(
    new Request('https://denglu.kefuxitong.net/api/sessions/session-1/restore', { method: 'POST' }),
    {},
    {},
  );
  assert.equal(response.status, 410);
  assert.deepEqual(await response.json(), { error: 'restore_not_supported' });
});