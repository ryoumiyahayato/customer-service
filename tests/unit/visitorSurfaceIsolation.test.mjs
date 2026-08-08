import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('visitor frontend has a dedicated entry that does not import admin application code', () => {
  const visitorEntry = read('src/visitor-main.tsx');
  assert.match(visitorEntry, /VisitorApp/);
  assert.doesNotMatch(visitorEntry, /AdminApp|SetupPage|AdminRiskCenter|routing/);

  const visitorLanding = read('src/visitor/VisitorInviteLanding.tsx');
  assert.match(visitorLanding, /visitorPresentation\.css/);
  assert.doesNotMatch(visitorLanding, /admin\/operatorPresentation\.css/);

  const adminEntry = read('src/admin-main.tsx');
  assert.match(adminEntry, /AdminApp/);
  assert.doesNotMatch(adminEntry, /VisitorApp|VisitorInviteLanding|GuestChat/);
});

test('build emits visitor assets into an isolated namespace and audits them', () => {
  const vite = read('vite.config.ts');
  assert.match(vite, /visitorBuild \? 'dist\/visitor' : 'dist'/);
  assert.match(vite, /visitorBuild \? '\/visitor\/' : '\/'/);

  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts.build, /vite build --mode admin/);
  assert.match(pkg.scripts.build, /vite build --mode visitor/);
  assert.match(pkg.scripts.build, /check-public-surface-isolation\.mjs/);

  const checker = read('scripts/check-public-surface-isolation.mjs');
  assert.match(checker, /denglu\.kefuxitong\.net/);
  assert.match(checker, /\/api\/auth\/login/);
  assert.match(checker, /AdminRiskCenter/);
});

test('outer worker gates visitor and admin assets before application routing', () => {
  const worker = read('src/worker-final.ts');
  assert.match(worker, /url\.pathname\.startsWith\('\/visitor\/'\)/);
  assert.match(worker, /url\.pathname\.startsWith\('\/assets\/'\)/);
  assert.match(worker, /serveVisitorAsset\(req, env, '\/visitor\/visitor\.html'\)/);
  assert.match(worker, /INVITE_PATH/);
  assert.match(worker, /SELECT expires_at,revoked_at,consumed_at FROM invite_links/);
  assert.match(worker, /invite\.consumed_at/);
});

test('visitor HTML does not opt into PWA discovery or indexing', () => {
  const html = read('visitor.html');
  assert.match(html, /noindex,nofollow,noarchive/);
  assert.match(html, /no-referrer/);
  assert.doesNotMatch(html, /manifest\.webmanifest|apple-touch-icon|app-icon/);
});
