import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

test('operator authorization fails closed in HTTP and websocket paths', async () => {
  const policy = await read('src/security/operatorPolicy.ts');
  const entry = await read('src/worker-entry.ts');
  const finalWorker = await read('src/worker-final.ts');
  const room = await read('src/durable-objects/ChatRoom.ts');
  assert.match(policy, /DENY_OPERATOR_POLICY/);
  assert.match(policy, /FROM operator_policies WHERE admin_id=\?/);
  assert.doesNotMatch(policy, /parseStoredOperatorPolicy|operator_policy:/);
  assert.doesNotMatch(finalWorker, /policy_json\) return true|catch \{\s*return true/);
  assert.doesNotMatch(room, /policy_json\) return true|catch \{\s*return true/);
  assert.match(entry, /readPolicy\(env\.DB/);
});

test('cloudflare password hashing has one production implementation and preserves legacy verification', async () => {
  const passwords = await read('src/security/passwords.ts');
  const runtime = await read('src/runtimeWorker.ts');
  const entry = await read('src/worker-entry.ts');
  const gate = await read('src/worker-public-gate.ts');
  assert.match(passwords, /PASSWORD_HASH_ITERATIONS = 210_000/);
  assert.match(passwords, /parsed\.iterations/);
  assert.doesNotMatch(runtime, /deriveBits\(\{ name: 'PBKDF2'/);
  assert.doesNotMatch(entry, /deriveBits\(\{ name: 'PBKDF2'/);
  assert.doesNotMatch(gate, /deriveBits\(\{ name: 'PBKDF2'/);
});

test('production domain values have a single source and runtime worker does not hardcode hosts', async () => {
  const domains = await read('src/domainIsolation.ts');
  const runtime = await read('src/runtimeWorker.ts');
  assert.match(domains, /DEFAULT_ADMIN_PUBLIC_HOST/);
  assert.match(domains, /DEFAULT_VISITOR_ROOT_DOMAIN/);
  assert.doesNotMatch(runtime, /denglu\.kefuxitong\.net|vx9qn7zr\.org/);
  assert.match(runtime, /DEFAULT_ADMIN_PUBLIC_HOST/);
  assert.match(runtime, /DEFAULT_VISITOR_ROOT_DOMAIN/);
});

test('admin UI has one state owner and no full-document mutation observers', async () => {
  const app = await read('src/apps/AdminApp.tsx');
  const dashboard = await read('src/admin/AdminDashboard.tsx');
  const sessionInfo = await read('src/admin/SessionClientInfo.tsx');
  const staffClear = await read('src/admin/SuperAdminStaffClearControl.tsx');
  assert.match(app, /return <AdminDashboard \/>/);
  assert.match(dashboard, /AdminWorkspaceProvider/);
  assert.match(dashboard, /DesktopAdminPolish/);
  assert.match(dashboard, /AdminMobileShell/);
  assert.doesNotMatch(sessionInfo, /MutationObserver|createPortal|querySelector/);
  assert.doesNotMatch(staffClear, /MutationObserver|createPortal|querySelector/);
  const adminFiles = await readdir(new URL('../../src/admin/', import.meta.url));
  for (const file of adminFiles.filter(name => name.endsWith('.tsx'))) {
    const source = await read(`src/admin/${file}`);
    assert.doesNotMatch(source, /MutationObserver\(document\.body|observer\.observe\(document\.body/);
  }
});
