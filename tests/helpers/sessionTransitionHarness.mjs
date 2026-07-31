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
  const row = database.prepare('SELECT * FROM sessions WHEQHYOÉÊK™Ù]
Y
NÂˆ™]\›ˆ›İÈÈÈ‹‹œ›İÈHˆ[ÂŸB‚™^Ü[˜İ[ÛˆÜ™X]PÛÛ^
]X˜\ÙK™\ÜÚ]ÜHHÙ\ÜÚ[Û”™\ÜÚ]ÜKÛÚÈH[
HÂˆÛÛœİY\\ˆH™]ÈÜ[]QPY\\Š]X˜\ÙJNÂˆÛÛœİ™\ÜÚ]ÜHHÛÚÈÈ™]È™\ÜÚ]ÜJY\\‹ÛÚÊHˆ™]È™\ÜÚ]ÜJY\\ŠNÂˆÛÛœİÙ\šXÙHH™]ÈÙ\ÜÚ[Û”Ù\šXÙJ™\ÜÚ]ÜK

HOˆYJNÂˆ™]\›ˆÈY\\‹™\ÜÚ]ÜKÙ\šXÙHNÂŸB‚™^Ü[˜İ[ÛˆÚ[™Ù\Ê™\İ[
HÂˆ™]\›ˆ[X™\Š™\İ[Ë›Y]OË˜Ú[™Ù\È
NÂŸB‚™^Ü\Ş[˜È[˜İ[Ûˆ^XİÛÛ™›Xİ
›ÛZ\ÙJHÂˆ]ØZ]\ÜÙ\œ™Z™XİÊ›ÛZ\ÙK
\œ›ÜŠHOˆÂˆ\ÜÙ\›ÚÊ\œ›Üˆ[œİ[˜Ù[ÙˆÛXZ[‘\œ›ÜŠNÂˆ\ÜÙ\™\]X[
\œ›Ü‹˜ÛÙK	ÔÑTÔÒSÓ—ÔÕUWĞÓÓ‘“PÕ	ÊNÂˆ\ÜÙ\™\]X[
\œ›Ü‹œİ]\ËJNÂˆ™]\›ˆYNÂˆJNÂŸB‚™^ÜÛ\ÜÈ[\›X]š[™ÔÙ\ÜÚ[Û”™\ÜÚ]ÜH^[™ÈÙ\ÜÚ[Û”™\ÜÚ]ÜHÂˆÛÛœİXİÜŠ]X˜\ÙKÛÚÊHÂˆİ\\Š]X˜\ÙJNÂˆ\ËšÛÚÈHÛÚÎÂˆB‚ˆ\Ş[˜È\ÜÚYÛŠÙ\ÜÚ[Û’YXİÜ’Y[Y\İ[\
HÂˆ]ØZ]\ËšÛÚÊ	Ø\ÜÚYÛ‰ËÙ\ÜÚ[Û’Y
NÂˆ™]\›ˆİ\\‹˜\ÜÚYÛŠÙ\ÜÚ[Û’YXİÜ’Y[Y\İ[\
NÂˆB‚ˆ\Ş[˜È\˜Ú]™JÙ\ÜÚ[Û’YXİÜ’Y[Y\İ[\
HÂˆ]ØZ]\ËšÛÚÊ	Ø\˜Ú]™IËÙ\ÜÚ[Û’Y
NÂˆ™]\›ˆİ\\‹˜\˜Ú]™JÙ\ÜÚ[Û’YXİÜ’Y[Y\İ[\
NÂˆB‚ˆ\Ş[˜È[İ™UÕ˜\Ú
Ù\ÜÚ[Û’YXİÜ’Y[Y\İ[\
HÂˆ]ØZ]\ËšÛÚÊ	Û[İ™UÕ˜\Ú	ËÙ\ÜÚ[Û’Y
NÂˆ™]\›ˆİ\\‹›[İ™UÕ˜\Ú
Ù\ÜÚ[Û’YXİÜ’Y[Y\İ[\
NÂˆBŸB