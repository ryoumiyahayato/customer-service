import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { registerTypeScriptHooks } from '../helpers/tsExtensionLoader.mjs';

registerTypeScriptHooks();
const {
  DEFAULT_ADMIN_PUBLIC_HOST,
  DEFAULT_VISITOR_ROOT_DOMAIN,
  buildVisitorInviteUrl,
  extractVisitorSubdomainToken,
  isAdminSurfaceHost,
  isVisitorSurfaceHost,
} = await import('../../src/domainIsolation.ts');
const { default: worker } = await import('../../src/worker-public-gate.ts');

const TOKEN = 'a'.repeat(40);
const VISITOR_HOST = `${TOKEN}.${DEFAULT_VISITOR_ROOT_DOMAIN}`;
const env = {
  VISITOR_ROOT_DOMAIN: DEFAULT_VISITOR_ROOT_DOMAIN,
  VISITOR_PUBLIC_HOSTS: DEFAULT_VISITOR_ROOT_DOMAIN,
  ADMIN_PUBLIC_HOST: DEFAULT_ADMIN_PUBLIC_HOST,
};

test('visitor invite URLs use token-first subdomains under the dedicated visitor root', () => {
  assert.equal(buildVisitorInviteUrl(TOKEN), `https://${VISITOR_HOST}/`);
  assert.equal(extractVisitorSubdomainToken(VISITOR_HOST), TOKEN);
  assert.equal(isVisitorSurfaceHost(VISITOR_HOST), true);
  assert.equal(isVisitorSurfaceHost(DEFAULT_VISITOR_ROOT_DOMAIN), false);
  assert.equal(isVisitorSurfaceHost(`legacy.${DEFAULT_VISITOR_ROOT_DOMAIN}`), false);
  assert.equal(isVisitorSurfaceHost(`x.${TOKEN}.${DEFAULT_VISITOR_ROOT_DOMAIN}`), false);
  assert.equal(isVisitorSurfaceHost(DEFAULT_ADMIN_PUBLIC_HOST), false);
  assert.equal(isAdminSurfaceHost(DEFAULT_ADMIN_PUBLIC_HOST), true);
  assert.equal(isAdminSurfaceHost(DEFAULT_VISITOR_ROOT_DOMAIN), false);
});

test('admin host rejects visitor entry routes before reaching application code', async () => {
  const invite = await worker.fetch(new Request(`https://${DEFAULT_ADMIN_PUBLIC_HOST}/`), env, {});
  assert.equal(invite.status, 404);
  const guest = await worker.fetch(new Request(`https://${DEFAULT_ADMIN_PUBLIC_HOST}/api/guest/${TOKEN}`, { method: 'POST' }), env, {});
  assert.equal(guest.status, 404);
});

test('bare visitor root and invalid visitor subdomains fail closed', async () => {
  const bare = await worker.fetch(new Request(`https://${DEFAULT_VISITOR_ROOT_DOMAIN}/`), env, {});
  assert.equal(bare.status, 404);
  const invalid = await worker.fetch(new Request(`https://legacy.${DEFAULT_VISITOR_ROOT_DOMAIN}/`), env, {});
  assert.equal(invalid.status, 404);
  const nested = await worker.fetch(new Request(`https://x.${VISITOR_HOST}/`), env, {});
  assert.equal(nested.status, 404);
});

test('frontend invite generation cannot fall back to the current admin origin', () => {
  const panel = readFileSync(new URL('../../src/admin/InviteLinkPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /buildVisitorInviteUrl\(token, visitorRootDomain\(\)\)/);
  assert.doesNotMatch(panel, /window\.location\.origin/);

  const wrangler = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8');
  assert.match(wrangler, /VISITOR_ROOT_DOMAIN = "vx9qn7zr\.org"/);
  assert.match(wrangler, /VISITOR_PUBLIC_HOSTS = "vx9qn7zr\.org"/);
  assert.match(wrangler, /pattern = "\*\.vx9qn7zr\.org\/\*"/);
  assert.match(wrangler, /ADMIN_PUBLIC_HOST = "denglu\.kefuxitong\.net"/);
});
