import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

test('visitor source is isolated by construction', () => {
  const guest = read('src/visitor/GuestChat.tsx');
  const vite = read('vite.config.ts');
  assert.match(guest, /from '\.\/visitorApi'/);
  assert.doesNotMatch(guest, /from '\.\.\/api'/);
  assert.doesNotMatch(guest, /\/g\//);
  assert.doesNotMatch(vite, /visitorSurfaceImports|source\.replace|from '\.\.\/api'/);
});

test('inner worker no longer owns the legacy g-token route', () => {
  const finalWorker = read('src/worker-final.ts');
  assert.doesNotMatch(finalWorker, /INVITE_PATH|\/g\/\(\[a-f0-9\]/);
  assert.doesNotMatch(finalWorker, /serveVisitorAsset\([^)]*visitor\/visitor\.html/);
});

test('dynamic runtime state is no longer stored in settings', () => {
  const files = ['src/security/operatorPolicy.ts','src/operatorPresentation.ts','src/worker-entry.ts','src/worker-production-boundary.ts'];
  for (const path of files) {
    const source = read(path);
    assert.doesNotMatch(source, /operator_policy:|operator_presentation:|session_client_meta:|admin_active_session:|admin_session_meta:/, path);
  }
  const migration = read('migrations/0013_structured_runtime_state.sql');
  for (const table of ['operator_policies','operator_presentations','session_client_metadata','admin_session_metadata','admin_active_sessions']) assert.match(migration, new RegExp('CREATE TABLE IF NOT EXISTS ' + table));
});

test('admin app uses one consolidated workspace stylesheet', () => {
  const app = read('src/apps/AdminApp.tsx');
  assert.match(app, /adminWorkspace\.css/);
  assert.doesNotMatch(app, /mobileAdminPolish|adminShellFinal|adminRegressionFixes|adminUnreadBadge/);
});

test('admin synchronization retains feed fallback and capability-aware upload', () => {
  const dashboard = read('src/admin/AdminDashboard.tsx');
  assert.match(dashboard, /adminFeedOnlineRef/);
  assert.match(dashboard, /if \(!auth\.admin\)/);
  assert.match(dashboard, /refreshCapabilities/);
  assert.match(dashboard, /capabilities\.canUploadImages/);
});
