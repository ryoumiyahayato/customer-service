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

const worker = readFile('src/worker.ts');
const lifecycle = readFile('src/sessionLifecycle.ts');
const sessionState = readFile('src/domain/sessionState.ts');
const chatModel = readFile('src/chatModel.ts');
const dashboard = readFile('src/admin/AdminDashboard.tsx');
const sessionList = readFile('src/admin/AdminSessionList.tsx');
const purgeMigration = readFile('migrations/0009_add_purged_at.sql');
const unarchiveMigration = readFile('migrations/0010_normalize_unarchive_state.sql');
const behaviorTest = readFile('tests/unit/sessionState.test.mjs');
const ciCheck = readFile('scripts/lifecycle-ci-check.mjs');
const packageJson = JSON.parse(readFile('package.json'));

let passed = 0;
let failed = 0;
const results = [];

function check(name, ok) {
  if (ok) {
    passed++;
    results.push(`  PASS  ${name}`);
  } else {
    failed++;
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
  check('sessionState checks purged before trash', sessionState.indexOf("if (session.purged_at) return 'purged'") < sessionState.indexOf("if (session.deleted_at) return 'trash'"));
  check('sessionState accepts legacy CLOSED as archived read data', sessionState.includes("session.status === 'CLOSED'"));
  check('sessionState restores assigned sessions to OPEN', sessionState.includes("return session.assigned_operator_id ? 'OPEN' : 'PENDING'"));
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

  check('chatModel imports shared session rules', chatModel.includes("from './domain/sessionState'"));
  check('chatModel uses discriminated realtime event types', chatModel.includes("type: 'message:new' | 'message_created'") && chatModel.includes("type: 'messages:read'"));
  check('chatModel validates unknown realtime payloads', chatModel.includes('export function parseChatRealtimeEvent(value: unknown)'));
  check('chatModel prevents local optimistic data replacing server messages', chatModel.includes('preferServerMessage'));

  check('Dashboard imports shared SessionGroup', dashboard.includes('type SessionGroup,'));
  check('SessionList imports shared SessionGroup', sessionList.includes('ChatSession, SessionGroup'));
  check('SessionList has trash tab', sessionList.includes("{ key: 'trash', label: '回收站' }"));
  check('SessionList no longer has ended tab', !sessionList.includes("key: 'ended'"));
  check('SessionList no longer has deleted tab', !sessionList.includes("key: 'deleted'"));

  check('package.json exposes static lifecycle contract command', packageJson.scripts?.['check-session-lifecycle-static'] === 'node scripts/check-session-lifecycle.mjs');
  check('package.json exposes executable unit tests', packageJson.scripts?.['test:unit'] === 'node --experimental-strip-types --test tests/unit/*.test.mjs');
  check('behavior tests cover assigned and unassigned restore targets', behaviorTest.includes("'OPEN'") && behaviorTest.includes("'PENDING'"));
  check('behavior tests cover legacy CLOSED compatibility', behaviorTest.includes('legacyClosed'));
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
