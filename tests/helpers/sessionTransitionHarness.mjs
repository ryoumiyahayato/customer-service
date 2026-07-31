import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { DomainError } from '../../src/http/errors.ts';
import { SessionRepository } from '../../src/repositories/sessionRepository.ts';
import { SessionService } from '../../src/services/sessionService.ts';
import { SqliteD1Adapter } from './sqliteD1Adapter.mjs';

export const ACTOR = { id: 'admin_1', role: 'SUPER_ADMIN' };
export const T0 = '2026-07-31T00:00:00.000Z';
export { SessionRepository, SessionService, SqliteD1Adapter };

export function createDatabase() {
  const database = new DatabaseSync(':memory:');
  database.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      assigned_operator_id TEXT,
      last_operator_id TEXT,
      archived_at TEXT,
      archived_by TEXT,
      closed_at TEXT,
      deleted_at TEXT,
      deleted_by TEXT,
      purged_at TEXT,
      history_cleared_at TEXT,
      history_cleared_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      content TEXT,
      image_path TEXT
    );
    CREATE TABLE attachments (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      message_id TEXT,
      object_key TEXT
    );
  `);
  return database;
}

export function insertSession(database, input) {
  database.prepare(`
    INSERT INTO sessions(
      id,user_id,status,assigned_operator_id,last_operator_id,archived_at,archived_by,
      closed_at,deleted_at,deleted_by,purged_at,history_cleared_at,history_cleared_by,
      created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    input.id,
    input.userId ?? `user-${input.id}`,
    input.status ?? 'PENDING',
    input.assignedOperatorId ?? null,
    input.lastOperatorId ?? null,
    input.archivedAt ?? null,
    input.archivedBy ?? null,
    input.closedAt ?? null,
    input.deletedAt ?? null,
    input.deletedBy ?? null,
    input.purgedAt ?? null,
    input.historyClearedAt ?? null,
    input.historyClearedBy ?? null,
    input.createdAt ?? T0,
    input.updatedAt ?? T0,
  );
}

export function readSession(database, id) {
  const row = database.prepare('SELECT * FROM sessions WHERE id=?').get(id);
  return row ? { ...row } : null;
}

export function createContext(database, Repository = SessionRepository, hook = null) {
  const adapter = new SqliteD1Adapter(database);
  const repository = hook ? new Repository(adapter, hook) : new Repository(adapter);
  const service = new SessionService(repository, () => true);
  return { adapter, repository, service };
}

export function changes(result) {
  return Number(result?.meta?.changes || 0);
}

export async function expectConflict(promise) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof DomainError);
    assert.equal(error.code, 'SESSION_STATE_CONFLICT');
    assert.equal(error.status, 409);
    return true;
  });
}

export class InterleavingSessionRepository extends SessionRepository {
  constructor(database, hook) {
    super(database);
    this.hook = hook;
  }

  async assign(sessionId, actorId, timestamp, expectedOperatorId = null) {
    await this.hook('assign', sessionId);
    return super.assign(sessionId, actorId, timestamp, expectedOperatorId);
  }

  async archive(sessionId, actorId, timestamp, expectedOperatorId = null) {
    await this.hook('archive', sessionId);
    return super.archive(sessionId, actorId, timestamp, expectedOperatorId);
  }

  async moveToTrash(sessionId, actorId, timestamp, expectedOperatorId = null) {
    await this.hook('moveToTrash', sessionId);
    return super.moveToTrash(sessionId, actorId, timestamp, expectedOperatorId);
  }
}
