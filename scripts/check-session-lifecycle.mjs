#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();

function readFile(file) {
  const full = path.join(root, file);
  if (!existsSync(full)) throw new Error(`Missing: ${file}`);
  return readFileSync(full, 'utf8');
}

const worker = readFile('src/runtimeWorker.ts');
const lifecycle = readFile('src/sessionLifecycle.ts');
const sessionState = readFile('src/domain/sessionState.ts');
const chatModel = readFile('src/chatModel.ts');
const chatEvents = readFile('src/chat/events.ts');
const eventParser = readFile('src/chat/eventParser.ts');
const messageMerge = readFile('src/chat/messageMerge.ts');
const chatMappers = readFile('src/chat/mappers.ts');
const dashboard = readFile('src/admin/AdminDashboard.tsx');
const guestChat = readFile('src/visitor/GuestChat.tsx');
const sessionList = readFile('src/admin/AdminSessionList.tsx');
const purgeMigration = readFile('migrations/0009_add_purged_at.sql');
const unarchiveMigration = readFile('migrations/0010_normalize_unarchive_state.sql');
const unitBehaviorTest = readFile('tests/unit/sessionState.test.mjs');
const integrationBehaviorTest = readFile('tests/integration/sessionLifecycle.sqlite.test.mjs');
const mapperTest = readFile('tests/unit/chatMappers.test.mjs');
const eventTest = readFile('tests/unit/chatEvents.test.mjs');
const mergeTest = readFile('tests/unit/messageMerge.test.mjs');
const ciCheck = readFile('scripts/lifecycle-ci-check.mjs');
const packageJson = JSON.parse(readFile('package.json'));

let passed = 0;
let failed = 0;
const results = [];

function check(name, ok) {
  if (ok) {
    passed += 1;
    results.push(`  PASS  ${name}`);
  } else {
    failed += 1;
    results.push(`  FAIL  ${name}`);
  }
}

try {
  check('Migration 0009 adds purged_at column', purgeMigration.includes('ALTER TABLE sessions ADD COLUMN purged_at TEXT'));
  check('Migration 0009 creates purged_at index', purgeMigration.includes('idx_sessions_purged_at'));
  check('Migration 0010 normalizes unarchived rows to PENDING or OPEN', unarchiveMigration.includes("WHEN assigned_operator_id IS NULL THEN 'PENDING'") && unarchiveMigration.includes("ELSE 'OPEN'"));
  check('Migration 0010 clears closed_at during unarchive', unarchiveMigration.includes('closed_at = NULL'));
  check('Migration 0010 installs a compatibility trigger', unarchiveMigration.includes('CREATE TRIGGER IF NOT EXISTS trg_sessions_normalize_unarchive'));
  check('Migration 0010 excludes trash and purged rows', unarchiveMigration.includes('NEW.deleted_at IS NULL') && unarchiveMigration.includes('NEW.purged_at IS NULL'));

  check('sessionState defines the only SessionBucket union', sessionState.includes("export type SessionBucket = 'active' | 'archived' | 'trash' | 'purged'"));
  const purgedIndex = sessionState.indexOf("if (state.purgedAt) return 'purged'");
  const trashIndex = sessionState.indexOf("if (state.deletedAt) return 'trash'");
  check('sessionState checks purged before trash', purgedIndex >= 0 && trashIndex > purgedIndex);
  check('sessionState accepts legacy CLOSED as archived read data', sessionState.includes("state.status === 'CLOSED'"));
  check('sessionState restores assigned sessions to OPEN', sessionState.includes("canonicalState(session).assignedOperatorId ? 'OPEN' : 'PENDING'"));
  check('sessionState exposes action guards', ['canSendMessage', 'canArchive', 'canUnarchive', 'canMoveToTrash', 'canRestore', 'canPurge'].every((name) => sessionState.includes(`export function ${name}`)));

  check('sessionLifecycle imports shared state rules', lifecycle.includes("from './domain/sessionState'"));
  check('sessionLifecycle delegates normalizeSessionBucket', lifecycle.includes('return sessionBucketOf(session)'));
  check('sessionLifecycle delegates sessionEnded', lifecycle.includes('return isSessionEnded(session)'));
  check('sessionLifecycle exports archiveSession', lifecycle.includes('export async function archiveSession'));
  check('sessionLifecycle exports autoArchiveActiveSessions', lifecycle.includes('export async function autoArchiveActiveSessions'));
  check('sessionLifecycle exports purgeTrashSessions', lifecycle.includes('export async function purgeTrashSessions'));
  check('sessionLifecycle exports runLifecycle', lifecycle.includes('export async function runLifecycle'));

  check('active lifecycle cutoff normalizes stored timestamps with datetime()', lifecycle.includes("datetime(COALESCE(updated_at, created_at)) <= datetime('now', '-24 hours')"));
  check('trash lifecycle cutoff normalizes deleted_at with datetime()', lifecycle.includes("datetime(deleted_at) <= datetime('now', '-24 hours')"));
  check('attachment expiry normalizes expires_at with datetime()', lifecycle.includes("datetime(expires_at) <= datetime('now')"));

  const claimIndex = lifecycle.indexOf('SET purged_at=?,updated_at=?');
  const r2DeleteIndex = lifecycle.indexOf('env.UPLOADS!.delete(key)');
  check('purge claims the session before destructive cleanup', claimIndex >= 0 && r2DeleteIndex >= 0 && claimIndex < r2DeleteIndex);
  check('purge retries claimed sessions with uncleared history', lifecycle.includes('purged_at IS NOT NULL') && lifecycle.includes('history_cleared_at IS NULL'));
  check('purge deletes attachment rows', lifecycle.includes('DELETE FROM attachments'));
  check('purge deletes message rows', lifecycle.includes('DELETE FROM messages'));
  check('purge database operations use D1 batch', lifecycle.includes('await env.DB.batch(['));

  check('Worker imports runLifecycle', worker.includes("import { runLifecycle } from './sessionLifecycle'"));
  check('Scheduled handler calls runLifecycle', worker.includes('const result = await runLifecycle(env)'));
  check('sessionAction close sets status ARCHIVED', worker.includes("action === 'close'") && worker.includes("status='ARCHIVED'"));
  check('sessionAction close/archive binds values in SQL placeholder order', worker.includes('.bind(t, t, admin.id, t, sessionId).run()'));
  check('sessionAction delete checks purged_at', worker.includes("action === 'delete'") && worker.includes('purged_at IS NULL'));
  check('sessionAction restore checks purged_at', worker.includes("action === 'restore'") && worker.includes('purged_at IS NULL'));

  check('chatModel is a compatibility barrel over split chat modules', chatModel.includes("export * from './chat/types'") && chatModel.includes("export * from './chat/eventParser'") && chatModel.includes("export * from './chat/messageMerge'"));
  check('realtime events use a discriminated union', chatEvents.includes("type: 'message:new' | 'message_created'") && chatEvents.includes("type: 'messages:read'") && chatEvents.includes('export type ChatRealtimeEvent ='));
  check('unknown realtime payloads are validated', eventParser.includes('export function parseChatRealtimeEvent(value: unknown)') && eventParser.includes('return null'));
  check('server messages win over optimistic copies', messageMerge.includes('preferServerMessage') && messageMerge.includes('isServerMessage(current) && !isServerMessage(incoming)'));
  check('DTO compatibility is isolated in mappers', chatMappers.includes('export function mapChatMessageDto') && chatMappers.includes('export function mapChatSessionDto') && chatMappers.includes('normalizeApiPayload'));
  check('Dashboard consumes the realtime parser', dashboard.includes('parseChatRealtimeEvent(JSON.parse(e.data))'));
  check('Guest chat consumes the realtime parser', guestChat.includes('parseChatRealtimeEvent(JSON.parse(e.data))'));

  check('Dashboard imports shared SessionGroup', dashboard.includes('type SessionGroup,'));
  check('Dashboard imports shared sessionGroupOf', dashboard.includes('sessionGroupOf,'));
  check('SessionList imports shared SessionGroup', sessionList.includes('ChatSession, SessionGroup'));
  check('SessionList has trash tab', sessionList.includes("{ key: 'trash', label: '回收站' }"));
  check('SessionList no longer has ended tab', !sessionList.includes("key: 'ended'"));
  check('SessionList no longer has deleted tab', !sessionList.includes("key: 'deleted'"));

  check('package.json exposes static lifecycle contract command', packageJson.scripts?.['check:static-contracts'] === 'node scripts/check-session-lifecycle.mjs');
  check('package.json exposes separate unit tests', packageJson.scripts?.['test:unit'] === 'node --experimental-strip-types --test tests/unit/*.test.mjs');
  check('package.json exposes separate sqlite integration tests', packageJson.scripts?.['test:integration'] === 'node --experimental-sqlite --test tests/integration/*.test.mjs');
  check('package.json composes unit and integration tests', packageJson.scripts?.test === 'npm run test:unit && npm run test:integration');
  check('unit behavior tests cover assigned and unassigned restore targets', unitBehaviorTest.includes("'OPEN'") && unitBehaviorTest.includes("'PENDING'"));
  check('unit behavior tests cover legacy CLOSED compatibility', unitBehaviorTest.includes('legacyClosed'));
  check('sqlite behavior tests execute migration 0010', integrationBehaviorTest.includes('db.exec(migration)'));
  check('sqlite behavior tests cover assigned and unassigned unarchive', integrationBehaviorTest.includes("status: 'OPEN'") && integrationBehaviorTest.includes("status, 'PENDING'"));
  check('sqlite behavior tests protect trash and purged sessions', integrationBehaviorTest.includes('does not reactivate trash or purged sessions'));
  check('mapper tests cover snake_case to camelCase conversion', mapperTest.includes('session_id') && mapperTest.includes('sessionId'));
  check('event tests reject malformed realtime payloads', eventTest.includes("parseChatRealtimeEvent({ type: 'message:new' })") && eventTest.includes('null'));
  check('merge tests protect server messages', mergeTest.includes('does not let a local pending copy overwrite a server message'));
  check('CI-safe lifecycle check does not access D1 or Cloudflare', ciCheck.includes('d1Accessed: false') && ciCheck.includes('cloudflareAccessed: false'));

  check(
    'Messages API checks purged_at',
    /session\.purged_at\)\s*(?:\{\s*)?return json\(\{ messages: \[\] \}/.test(worker),
  );
  check(
    'Customer-read API checks purged_at',
    /session\.purged_at\)\s*(?:\{\s*)?return json\(\{ error: ERR_SESSION_NOT_FOUND \}/.test(worker),
  );
  check('Migration 0009 backfills purged_at from deleted and cleared sessions', purgeMigration.includes('purged_at = history_cleared_at'));
} catch (error) {
  console.error('FATAL:', error instanceof Error ? error.message : String(error));
  process.exit(1);
}

console.log('\nStatic Contract Check Results:');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);
console.log('');
results.forEach((result) => console.log(result));
console.log('');

if (failed > 0) {
  console.error('Some static contracts failed.');
  process.exit(1);
}
console.log('All static contracts passed.');
