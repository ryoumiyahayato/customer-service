import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { registerTypeScriptHooks } from '../helpers/tsExtensionLoader.mjs';
import { SqliteD1Adapter } from '../helpers/sqliteD1Adapter.mjs';

registerTypeScriptHooks();
const { AttachmentRepository } = await import('../../src/repositories/attachmentRepository.ts');
const { MessageRepository } = await import('../../src/repositories/messageRepository.ts');
const { RESOURCE_LIMITS } = await import('../../src/security/resourceLimits.ts');

function createDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      deleted_at TEXT,
      purged_at TEXT,
      archived_at TEXT,
      message_count INTEGER NOT NULL DEFAULT 0,
      message_bytes INTEGER NOT NULL DEFAULT 0,
      unclaimed_attachment_count INTEGER NOT NULL DEFAULT 0,
      unclaimed_attachment_bytes INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      conversation_id TEXT NOT NULL,
      object_key TEXT NOT NULL UNIQUE,
      file_name TEXT,
      mime_type TEXT,
      byte_size INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      created_by_type TEXT NOT NULL,
      created_by_id TEXT NOT NULL,
      expires_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE message_quota_reservations (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      created_at TEXT NOT NULL
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
      is_read INTEGER NOT NULL,
      quote_message_id TEXT,
      recalled_at TEXT,
      image_purged_at TEXT,
      client_message_id TEXT NOT NULL
    );
  `);
  database.prepare('INSERT INTO sessions(id,status) VALUES(?,?)').run('session-1', 'OPEN');
  return database;
}

function attachmentInput(id, byteSize = 1) {
  return {
    id,
    sessionId: 'session-1',
    objectKey: `${id}.png`,
    mimeType: 'image/png',
    byteSize,
    createdAt: '2026-08-09T00:00:00.000Z',
    createdByType: 'VISITOR',
    createdById: 'visitor-1',
    expiresAt: '2099-08-09T00:00:00.000Z',
  };
}

function messageInput(id, content = 'hello') {
  return {
    id,
    session_id: 'session-1',
    sender_type: 'VISITOR',
    sender_id: 'visitor-1',
    content,
    message_type: 'text',
    image_path: null,
    status: 'sent',
    created_at: '2026-08-09T00:00:00.000Z',
    read_at: null,
    is_read: 0,
    quote_message_id: null,
    recalled_at: null,
    image_purged_at: null,
    client_message_id: id,
  };
}

test('unclaimed attachment quota is atomic and a released reservation can be reused', async () => {
  const database = createDatabase();
  try {
    const repository = new AttachmentRepository(new SqliteD1Adapter(database));
    for (let index = 0; index < RESOURCE_LIMITS.unclaimedAttachmentMaxCount; index += 1) {
      await repository.reserve(attachmentInput(`att-${index}`));
    }
    await assert.rejects(repository.reserve(attachmentInput('att-over-count')), (error) => error?.code === 'ATTACHMENT_QUOTA_EXCEEDED');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM attachments').get().count, RESOURCE_LIMITS.unclaimedAttachmentMaxCount);

    await repository.releaseReservation('att-0');
    await repository.reserve(attachmentInput('att-reused'));
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM attachments').get().count, RESOURCE_LIMITS.unclaimedAttachmentMaxCount);
  } finally {
    database.close();
  }
});

test('message quota blocks count and bytes, then records one successful reservation', async () => {
  const database = createDatabase();
  try {
    const repository = new MessageRepository(new SqliteD1Adapter(database));
    database.prepare('UPDATE sessions SET message_count=?,message_bytes=? WHERE id=?')
      .run(RESOURCE_LIMITS.messageSessionMaxCount, 0, 'session-1');
    assert.equal(await repository.insertWithQuota(messageInput('message-count-blocked')), false);

    database.prepare('UPDATE sessions SET message_count=?,message_bytes=? WHERE id=?')
      .run(0, RESOURCE_LIMITS.messageSessionMaxBytes, 'session-1');
    assert.equal(await repository.insertWithQuota(messageInput('message-byte-blocked')), false);

    database.prepare('UPDATE sessions SET message_count=0,message_bytes=0 WHERE id=?').run('session-1');
    assert.equal(await repository.insertWithQuota(messageInput('message-accepted')), true);
    const session = database.prepare('SELECT message_count,message_bytes FROM sessions WHERE id=?').get('session-1');
    assert.equal(session.message_count, 1);
    assert.equal(session.message_bytes, Buffer.byteLength('hello'));
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM message_quota_reservations').get().count, 0);
  } finally {
    database.close();
  }
});
