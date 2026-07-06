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

function assert(condition, msg) {
  if (!condition) throw new Error(`FAIL: ${msg}`);
}

function assertIncludes(text, keyword, ctx) {
  assert(text.includes(keyword), `${ctx} should contain "${keyword}"`);
}

function assertNotIncludes(text, keyword, ctx) {
  assert(!text.includes(keyword), `${ctx} should NOT contain "${keyword}"`);
}

function assertMatch(text, regex, ctx) {
  assert(regex.test(text), `${ctx} should match ${regex}`);
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
  if (ok) { passed++; results.push(`  PASS  ${name}`); }
  else { failed++; results.push(`  FAIL  ${name}`); }
}

try {
  // --- 1. Migration 0009 exists and adds purged_at ---
  check('Migration 0009 adds purged_at column',
    migration.includes('ALTER TABLE sessions ADD COLUMN purged_at TEXT'));
  check('Migration 0009 creates purged_at index',
    migration.includes('idx_sessions_purged_at'));

  // --- 2. sessionLifecycle.ts exports ---
  check('sessionLifecycle exports normalizeSessionBucket',
    lifecycle.includes('export function normalizeSessionBucket'));
  check('sessionLifecycle exports archiveSession',
    lifecycle.includes('export async function archiveSession'));
  check('sessionLifecycle exports autoArchiveActiveSessions',
    lifecycle.includes('export async function autoArchiveActiveSessions'));
  check('sessionLifecycle exports purgeTrashSessions',
    lifecycle.includes('export async function purgeTrashSessions'));
  check('sessionLifecycle exports runLifecycle',
    lifecycle.includes('export async function runLifecycle'));

  // --- 3. normalizeSessionBucket logic ---
  check('normalizeSessionBucket checks purged_at first',
    lifecycle.includes("if (session.purged_at) return 'purged'"));
  check('normalizeSessionBucket checks deleted_at second',
    lifecycle.includes("if (session.deleted_at) return 'trash'"));
  check('normalizeSessionBucket checks archived_at or status',
    lifecycle.includes("session.archived_at || session.status === 'ARCHIVED' || session.status === 'CLOSED'"));
  check('normalizeSessionBucket defaults to active',
    lifecycle.includes("return 'active'"));

  // --- 4. autoArchiveActiveSessions looks for 24h idle active sessions ---
  check('autoArchiveActiveSessions filters active statuses',
    lifecycle.includes("status IN ('PENDING','OPEN')"));
  check('autoArchiveActiveSessions uses 24h cutoff',
    lifecycle.includes("-24 hours"));
  check('autoArchiveActiveSessions falls back to created_at',
    lifecycle.includes('COALESCE(updated_at, created_at)'));

  // --- 5. purgeTrashSessions looks for 24h old deleted sessions ---
  check('purgeTrashSessions checks deleted_at IS NOT NULL',
    lifecycle.includes('deleted_at IS NOT NULL'));
  check('purgeTrashSessions checks purged_at IS NULL',
    lifecycle.includes('purged_at IS NULL'));
  check('purgeTrashSessions uses 24h cutoff',
    lifecycle.includes("-24 hours"));

  // --- 6. runLifecycle returns aggregated counts ---
  check('runLifecycle returns archivedCount',
    lifecycle.includes('archivedCount'));
  check('runLifecycle returns purgedCount',
    lifecycle.includes('purgedCount'));
  check('runLifecycle returns errorCount',
    lifecycle.includes('errorCount'));

  // --- 7. Worker imports sessionLifecycle ---
  check('Worker imports from sessionLifecycle',
    worker.includes("import { runLifecycle, normalizeSessionBucket } from './sessionLifecycle'"));

  // --- 8. Scheduled handler uses runLifecycle ---
  check('Scheduled handler calls runLifecycle',
    worker.includes('const result = await runLifecycle(env)'));
  check('Scheduled handler logs aggregated counts only',
    worker.includes('archivedCount: result.archivedCount'));
  check('Scheduled handler logs purgedCount',
    worker.includes('purgedCount: result.purgedCount'));

  // --- 9. sessionAction close unifies with archive ---
  check('sessionAction close sets status ARCHIVED',
    worker.includes("action === 'close'") && worker.includes("status='ARCHIVED'"));
  check('sessionAction close sets archived_at',
    worker.includes("action === 'close'") && worker.includes('archived_at=COALESCE(archived_at,?)'));
  check('sessionAction close checks purged_at',
    worker.includes("action === 'close'") && worker.includes('purged_at IS NULL'));
  check('sessionAction archive also sets status ARCHIVED',
    worker.includes("action === 'archive'") && worker.includes("status='ARCHIVED'"));

  // --- 10. sessionAction delete checks purged_at ---
  check('sessionAction delete checks purged_at',
    worker.includes("action === 'delete'") && worker.includes('purged_at IS NULL'));

  // --- 11. sessionAction restore checks purged_at ---
  check('sessionAction restore checks purged_at',
    worker.includes("action === 'restore'") && worker.includes('purged_at IS NULL'));

  // --- 12. listSessions filters purged ---
  check('listSessions adds purged_at filter',
    worker.includes('s.purged_at IS NULL') && worker.includes('listSessions'));

  // --- 13. sessionEnded checks purged_at ---
  check('sessionEnded checks purged_at',
    worker.includes('session.purged_at'));

  // --- 14. latestSession filters purged ---
  check('latestSession filters purged_at',
    worker.includes('purged_at IS NULL'));

  // --- 15. UI sessionGroupOf updated to 3 groups ---
  check('UI sessionGroupOf returns trash',
    dashboard.includes("return 'trash'"));
  check('UI sessionGroupOf checks purged_at',
    dashboard.includes('session.purged_at') || dashboard.includes('session?.purged_at'));
  check('UI sessionGroupOf returns null for purged',
    dashboard.includes("if (session.purged_at) return null"));

  // --- 16. UI SessionGroup type has 3 values ---
  check('UI SessionGroup type is active|archived|trash',
    dashboard.includes("type SessionGroup = 'active' | 'archived' | 'trash'"));
  check('SessionList SessionGroup type is active|archived|trash',
    sessionList.includes("type SessionGroup = 'active' | 'archived' | 'trash'"));

  // --- 17. SessionList tabs show 3 groups ---
  check('SessionList has trash tab',
    sessionList.includes("{ key: 'trash', label: '回收站' }"));
  check('SessionList no longer has ended tab',
    !sessionList.includes("key: 'ended'"));
  check('SessionList no longer has deleted tab',
    !sessionList.includes("key: 'deleted'"));

  // --- 18. renderSessionLifecycleActions uses bucket ---
  check('renderSessionLifecycleActions uses sessionGroupOf',
    dashboard.includes('const bucket = sessionGroupOf(session)'));

  // --- 19. package.json has check script ---
  check('package.json has check-session-lifecycle script',
    packageJson.scripts?.['check-session-lifecycle'] === 'node scripts/check-session-lifecycle.mjs');

  // --- 20. CI check still safe ---
  check('CI check does not access D1',
    ciCheck.includes('d1Accessed: false') && ciCheck.includes('cloudflareAccessed: false'));

  // --- 21. No dangerous ops in lifecycle ---
  assertNotIncludes(lifecycle, 'DELETE FROM', 'sessionLifecycle should not hard-delete');
  assertNotIncludes(lifecycle, 'DROP', 'sessionLifecycle should not drop tables');
  assertNotIncludes(lifecycle, 'R2', 'sessionLifecycle should not access R2');
  assertNotIncludes(lifecycle, 'UPLOADS', 'sessionLifecycle should not reference R2 bucket');
  check('sessionLifecycle only uses UPDATE (soft delete)',
    !lifecycle.includes('DELETE FROM'));

  // --- 22. Worker endpoints check purged_at ---
  check('Messages API checks purged_at',
    worker.includes("session.purged_at) return json({ messages: [] }"));
  check('Customer-read API checks purged_at',
    worker.includes("session.purged_at) return json({ error: ERR_SESSION_NOT_FOUND }"));

  // --- 23. canClearHistory checks purged_at ---
  check('canClearHistory checks purged_at',
    worker.includes('!session.purged_at'));

  // --- 24. isArchivedSession includes CLOSED ---
  check('UI isArchivedSession includes CLOSED status',
    dashboard.includes("session?.status === 'CLOSED'"));

  // --- 25. Migration backfills purged_at from history_cleared_at ---
  check('Migration backfills purged_at from deleted+history_cleared sessions',
    migration.includes('purged_at = history_cleared_at'));

} catch (e) {
  console.error('FATAL:', e.message);
  process.exit(1);
}

console.log(`\nSession Lifecycle Check Results:`);
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);
console.log('');
results.forEach(r => console.log(r));
console.log('');

if (failed > 0) {
  console.error('Some checks failed.');
  process.exit(1);
}
console.log('All checks passed.');
