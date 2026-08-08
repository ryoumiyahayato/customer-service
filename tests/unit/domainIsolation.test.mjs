import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { registerTypeScriptHooks } from '../helpers/tsExtensionLoader.mjs';

registerTypeScriptHooks();
const {
  DEFAULT_ADMIN_PUBLIC_HOST,
  DEFAULT_VISITOR_ROOT_DOMAIN,
  buildVisitorInviteUrl,
  isAdminSurfaceHost,
  isVisitorSurfaceHost,
} = await import('../../src/domainIsolation.ts');
const { default: worker } = await import('../../src/worker-final.ts');

const TOKEN = 'a'.repeat(40);
const env = {
  VISITOR_ROOT_DOMAIN: DEFAULT_VISITOR_ROOT_DOMAIN,
  ADMIN_PUBLIC_HOST: DEFAULT_ADMIN_PUBLIC_HOST,
};

test('visitor invite URLs are always built on the dedicated visitor domain', () => {
  assert.equal(buildVisitorInviteUrl(TOKEN), `https://${DEFAULT_VISITOR_ROOT_DOMAIN}/g/${TOKEN}`);
  assert.equal(isVisitorSurfaceHost(DEFAULT_VISITOR_ROOT_DOMAIN), true);
  assert.equal(isVisitorSurfaceHost(`legacy.${DEFAULT_VISITOR_ROOT_DOMAIN}`), false);
  assert.equal(isVisitorSurfaceHost(DEFAULT_ADMIN_PUBLIC_HOST), false);
  assert.equal(isAdminSurfaceHost(DEFAULT_ADMIN_PUBLIC_HOST), true);
  assert.equal(isAdminSurfaceHost(DEFAULT_VISITOR_ROOT_DOMAIN), false);
});

test('admin host rejects visitor entry routes before reaching application code', async () => {
  const invite = await worker.fetch(new Request(`https://${DEFAULT_ADMIN_PUBLIC_HOST}/g/${TOKEN}`), env, {});
  assert.equal(invite.status, 404);
  const chat = await worker.fetch(new Request(`https://${DEFAULT_ADMIN_PUBLIC_HOST}/chat`), env, {});
  assert.equal(chat.status, 404);
  const guest = await worker.fetch(new Request(`https://${DEFAULT_ADMIN_PUBLIC_HOST}/api/guest/${TOKEN}`, { method: 'POST' }), env, {});
  assert.equal(guest.status, 404);
});

test('visitor host rejects admin login and admin document surfaces', async () => {
  const login = await worker.fetch(new Request(`https://${DEFAULT_VISITOR_ROOT_DOMAIN}/api/auth/login`, { method: 'POST' }), env, {});
  assert.equal(login.status, 404);
  const adminRoot = await worker.fetch(new Request(`https://${DEFAULT_VISITOR_ROOT_DOMAIN}/`), env, {});
  assert.equal(adminRoot.status, 404);
  const setup = await worker.fetch(new Request(`https://${DEFAULT_VISITOR_ROOT_DOMAIN}/setup`), env, {});
  assert.equal(setup.status, 404);
});

test('frontend invite generation cannot fall back to the current admin origin', () => {
  const panel = readFileSync(new URL('../../src/admin/InviteLinkPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /buildVisitorInviteUrl\(token, visitorRootDomain\(\)\)/);
  assert.doesNotMatch(panel, /window\.location\.origin/);
  assert.doesNotMatch(panel, /https:\/\/\$\{token\}\./);

  const routing = readFileSync(new URL('../../src/routing.ts', import.meta.url), 'utf8');
  assert.match(routing, /if \(!visitorHost && !localDev\) return \{ type: 'not-found' \}/);
  assert.match(routing, /if \(!adminHost && !localDev\) return \{ type: 'not-found' \}/);

  const wrangler = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8');
  assert.match(wrangler, /VISITOR_ROOT_DOMAIN = "vx9qn7zr\.org"/);
  assert.match(wrangler, /ADMIN_PUBLIC_HOST = "denglu\.kefuxitong\.net"/);
  assert.doesNotMatch(wrangler, /\*\.vx9qn7zr\.org/);
});
