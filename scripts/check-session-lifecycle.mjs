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
const dashboard = readFile('src/admin/AdminDashboard.tsx');
const sessionList = readFile('src/admin/AdminSessionList.tsx');
const migration = readFile('migrations/0009_add_purged_at.sql');
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
  check('Migration 0009 adds purged_at column', migration.includes('ALTER TABLE sessions ADD COLUMN purged_at TEXT'));
  check('Migration 0009 creates purged_at index', migration.includes('idx_sessions_purged_at'));

  check('sessionLifecycle exports normalizeSessionBucket', lifecycle.includes('export function normalizeSessionBucket'));
  check('sessionLifecycle exports archiveSession', lifecycle.includes('export async function archiveSession'));
  check('sessionLifecycle exports autoArchiveActiveSessions', lifecycle.includes('export async function autoArchiveActiveSessions'));
  check('sessionLifecycle exports purgeTrashSessions', lifecycle.includes('export async function purgeTrashSessions'));
  check('sessionLifecycle exports runLifecycle', lifecycle.includes('export async function runLifecycle'));

  check('normalizeSessionBucket checks purged_at first', lifecycle.includes("if (session.purged_at) return 'purged'"));
  check('normalizeSessionBucket checks deleted_at second', lifecycle.includes("if (session.deleted_at) return 'trash'"));
  check('normalizeSessionBucket checks archived_at or status', lifecycle.includes("session.archived_at || session.status === 'ARCHIVED' || session.status === 'CLOSED'"));
  check('normalizeSessionBucket defaults to active', lifecycle.includes("return 'active'"));

  check('active lifecycle cutoff normalizes stored timestamps with datetime()', lifecycle.includes("datetime(COALESCE(updated_at, created_at)) <= datetime('now', '-24 hours')"));
  check('trash lifecycle cutoff normalizes deleted_at with datetime()', lifecycle.includes("datetime(deleted_at) <= datetime('now', '-24 hours')"));
  check('attachment expiry normalizes expires_at with datetime()', lifecycle.includes("datetime(expires_at) <= datetime('now')"));
  check('auth expiry normalizes expires_at with datetime()', lifecycle.includes("datetime(expires_at) <= datetime('now')"));
  check('invite expiry normalizes expires_at with datetime()', lifecycle.includes("datetime(expires_at) <= datetime('now')"));

  const claimIndex = lifecycle.indexOf('SET purged_at=?,updated_at=?');
  const r2DeleteIndex = lifecycle.indexOf('env.UPLOADS!.delete(key)');
  check('purge claims the session before destructive cleanup', claimIndex >= 0 && r2DeleteIndex >= 0 && claimIndex < r2DeleteIndex);
  check('purge retries claimed sessions with uncleared history', lifecycle.includes('purged_at IS NOT NULL') && lifecycle.includes('history_cleared_at IS NULL'));
  check('purge collects R2 keys after eligibility claim', lifecycle.includes('collectPurgeKeys') && lifecycle.includes('env.UPLOADS!.delete(key)'));
  check('purge deletes attachment rows', lifecycle.includes('DELETE FROM attachments'));
  check('purge deletes message rows', lifecycle.includes('DELETE FROM messages'));
  check('purge database deletes are state guarded', lifecycle.includes('EXISTS (') && lifecycle.includes('purged_at IS NOT NULL AND history_cleared_at IS NULL'));
  check('purge marks history cleared only after cleanup', lifecycle.indexOf('history_cleared_at=COALESCE(history_cleared_at,?)') > r2DeleteIndex);
  check('purge requires UPLOADS when object cleanup is needed', lifecycle.includes('lifecycle purge requires UPLOADS binding'));
  check('purge database operations use D1 batch', lifecycle.includes('await env.DB.batch(['));

  check('runLifecycle returns archivedCount', lifecycle.includes('archivedCount'));
  check('runLifecycle returns purgedCount', lifecycle.includes('purgedCount'));
  check('runLifecycle returns errorCount', lifecycle.includes('errorCount'));
  check('Worker imports sessionLifecycle', worker.includes("import { runLifecycle, normalizeSessionBucket } from './sessionLifecycle'"));
  check('Scheduled handler calls runLifecycle', worker.includes('const result = await runLifecycle(env)'));
  check('Scheduled handler logs aggregated counts only', worker.includes('archivedCount: result.archivedCount'));
  check('Scheduled handler logs purgedCount', worker.includes('purgedCount: result.purgedCount'));

  check('sessionAction close sets status ARCHIVED', worker.includes("action === 'close'") && worker.includes("status='ARCHIVED'"));
  check('sessionAction close sets archived_at', worker.includes("action === 'close'") && worker.includes('archived_at=COALESCE(archived_at,?)'));
  check('sessionAction delete checks purged_at', worker.includes("action === 'delete'") && worker.includes('purged_at IS NULL'));
  check('sessionAction restore checks purged_at', worker.includes("action === 'restore'") && worker.includes('purged_at IS NULL'));
  check('listSessions filters purged', worker.includes('s.purged_at IS NULL') && worker.includes('listSessions'));
  check('sessionEnded checks purged_at', worker.includes('session.purged_at'));
  check('latestSession filters purged_at', worker.includes('purged_at IS NULL'));

  check('UI sessionGroupOf returns trash', dashboard.includes("return 'trash'"));
  check('UI sessionGroupOf checks purged_at', dashboard.includes('session.purged_at') || dashboard.includes('session?.purged_at'));
  check('UI sessionGroupOf returns null for purged', dashboard.includes("if (session.purged_at) return null"));
  check('UI SessionGroup type is active|archived|trash', dashboard.includes("type SessionGroup = 'active' | 'archived' | 'trash'"));
  check('SessionList SessionGroup type is active|archived|trash', sessionList.includes("type SessionGroup = 'active' | 'archived' | 'trash'"));
  check('SessionList has trash tab', sessionList.includes("{ key: 'trash', label: '回收站' }"));
  check('SessionList no longer has ended tab', !sessionList.includes("key: 'ended'"));
  check('SessionList no longer has deleted tab', !sessionList.includes("key: 'deleted'"));
  check('renderSessionLifecycleActions uses sessionGroupOf', dashboard.includes('const bucket = sessionGroupOf(session)'));

  check('package.json has check-session-lifecycle script', packageJson.scripts?.['check-session-lifecycle'] === 'node scripts/check-session-lifecycle.mjs');
  check('CI check does not access D1', ciCheck.includes('d1Accessed: false') && ciCheck.includes('cloudflareAccessed: false'));
  check('Messages API checks purged_at', worker.includes("session.purged_at) return json({ messages: [] }"));
  check('Customer-read API checks purged_at', worker.includes("session.purged_at) return json({ error: ERR_SESSION_NOT_FOUND }"));
  check('canClearHistory checks purged_at', worker.includes('!session.purged_at'));
  check('UI isArchivedSession includes CLOSED status', dashboard.includes("session?.status === 'CLOSED'"));
  check('Migration backfills purged_at from deleted+history_cleared sessions', migration.includes('purged_at = history_cleared_at'));
} catch (error) {
  console.error('FATAL:', error instanceof Error ? error.message : String(error));
  process.exit(1);
}

console.log('\nSession Lifecycle Check Results:');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);
console.log('');
results.forEach((result) => console.log(result));
console.log('');

if (failed > 0) {
  console.error('Some checks failed.');
  process.exit(1);
}
console.log('All checks passed.');
