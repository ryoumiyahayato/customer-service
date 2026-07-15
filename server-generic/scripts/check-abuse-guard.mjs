#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ABUSE_POLICY_NAMES,
  abuseSessionPart,
  abuseUsernamePart,
  classifyAbuseRoute,
  createAbuseGuard,
  createAbuseKey,
  formatRateLimitResponse,
} from '../dist/abuseGuard.js';
import { loadConfig } from '../dist/config.js';

function fakeRequest(ip = '203.0.113.10') {
  return {
    socket: { remoteAddress: ip },
    headers: {},
  };
}

function requireLimited(decision) {
  assert.equal(decision.allowed, false, 'expected rate limited decision');
  const response = formatRateLimitResponse(decision);
  assert.equal(response.status, 429);
  assert.deepEqual(response.body, { ok: false, error: 'rate_limited' });
  assert.match(response.headers['retry-after'], /^\d+$/);
  assert.ok(Number(response.headers['retry-after']) > 0);
}

const config = loadConfig({
  ...process.env,
  DATABASE_URL: '',
  ENCRYPTION_ENABLED: 'false',
  ENCRYPTION_KEY: '',
  SETUP_TOKEN: '',
  ABUSE_LOGIN_LIMIT: '2',
  ABUSE_LOGIN_WINDOW_SECONDS: '60',
  ABUSE_SETUP_LIMIT: '2',
  ABUSE_SETUP_WINDOW_SECONDS: '60',
  ABUSE_GUEST_LIMIT: '2',
  ABUSE_GUEST_WINDOW_SECONDS: '60',
  ABUSE_MESSAGE_LIMIT: '2',
  ABUSE_MESSAGE_IP_LIMIT: '3',
  ABUSE_MESSAGE_WINDOW_SECONDS: '60',
  ABUSE_UPLOAD_LIMIT: '2',
  ABUSE_UPLOAD_WINDOW_SECONDS: '60',
});

for (const policy of ['admin_login', 'setup_initialize', 'guest_bootstrap', 'message_session', 'message_ip', 'upload']) {
  assert.ok(ABUSE_POLICY_NAMES.includes(policy), `missing policy: ${policy}`);
}

assert.deepEqual(classifyAbuseRoute('GET', '/healthz'), []);
assert.deepEqual(classifyAbuseRoute('GET', '/api/auth/me'), []);
assert.deepEqual(classifyAbuseRoute('GET', '/assets/index.js'), []);
assert.deepEqual(classifyAbuseRoute('POST', '/api/auth/login'), ['admin_login']);
assert.deepEqual(classifyAbuseRoute('POST', '/api/admin/login'), ['admin_login']);
assert.deepEqual(classifyAbuseRoute('POST', '/api/setup/initialize'), ['setup_initialize']);
assert.deepEqual(classifyAbuseRoute('POST', '/api/guest/smoke-token'), ['guest_bootstrap']);
assert.deepEqual(classifyAbuseRoute('POST', '/api/visitor/sessions'), ['guest_bootstrap']);
assert.deepEqual(classifyAbuseRoute('POST', '/api/messages'), ['message_ip', 'message_session']);
assert.deepEqual(classifyAbuseRoute('POST', '/api/upload'), ['upload']);

const guard = createAbuseGuard(config);
const request = fakeRequest();

assert.equal(abuseUsernamePart({ username: ' SmokeAdmin ' }), 'smokeadmin');
assert.equal(abuseSessionPart(' 00000000-0000-0000-0000-000000000001 '), '00000000-0000-0000-0000-000000000001');

assert.equal(guard.check(request, 'admin_login', [abuseUsernamePart({ username: 'admin' })]).allowed, true);
assert.equal(guard.check(request, 'admin_login', [abuseUsernamePart({ username: 'admin' })]).allowed, true);
requireLimited(guard.check(request, 'admin_login', [abuseUsernamePart({ username: 'admin' })]));

assert.equal(guard.check(fakeRequest('203.0.113.11'), 'setup_initialize').allowed, true);
assert.equal(guard.check(fakeRequest('203.0.113.11'), 'setup_initialize').allowed, true);
requireLimited(guard.check(fakeRequest('203.0.113.11'), 'setup_initialize'));

const secretToken = 'selfhost-secret-token-that-must-not-appear';
const secretSession = '00000000-0000-0000-0000-secret-session';
const secretBody = 'this message body must never be part of the key';
const key = createAbuseKey('guest_bootstrap', [`ip:203.0.113.12`, secretToken]);
assert.ok(!key.includes(secretToken), 'rate limit key leaked token');
assert.ok(!key.includes(secretSession), 'rate limit key leaked session id');
assert.ok(!key.includes(secretBody), 'rate limit key leaked message body');

const warnMessages = [];
const originalWarn = console.warn;
console.warn = (value) => warnMessages.push(String(value));
try {
  const guestRequest = fakeRequest('203.0.113.12');
  assert.equal(guard.check(guestRequest, 'guest_bootstrap', [secretToken]).allowed, true);
  assert.equal(guard.check(guestRequest, 'guest_bootstrap', [secretToken]).allowed, true);
  requireLimited(guard.check(guestRequest, 'guest_bootstrap', [secretToken]));
} finally {
  console.warn = originalWarn;
}
const combinedWarnings = warnMessages.join('\n');
assert.match(combinedWarnings, /abuse_guard limited route=guest_bootstrap/);
assert.ok(!combinedWarnings.includes(secretToken), 'limited log leaked token');
assert.ok(!combinedWarnings.includes(secretSession), 'limited log leaked session id');
assert.ok(!combinedWarnings.includes(secretBody), 'limited log leaked message body');
assert.ok(!/password|cookie|authorization/i.test(combinedWarnings), 'limited log mentioned sensitive credential fields');

const messageRequest = fakeRequest('203.0.113.13');
assert.equal(guard.check(messageRequest, 'message_session', [abuseSessionPart(secretSession)]).allowed, true);
assert.equal(guard.check(messageRequest, 'message_session', [abuseSessionPart(secretSession)]).allowed, true);
requireLimited(guard.check(messageRequest, 'message_session', [abuseSessionPart(secretSession)]));

assert.equal(guard.check(messageRequest, 'message_ip').allowed, true);
assert.equal(guard.check(messageRequest, 'message_ip').allowed, true);
assert.equal(guard.check(messageRequest, 'message_ip').allowed, true);
requireLimited(guard.check(messageRequest, 'message_ip'));

const uploadRequest = fakeRequest('203.0.113.14');
assert.equal(guard.check(uploadRequest, 'upload', [abuseSessionPart(secretSession)]).allowed, true);
assert.equal(guard.check(uploadRequest, 'upload', [abuseSessionPart(secretSession)]).allowed, true);
requireLimited(guard.check(uploadRequest, 'upload', [abuseSessionPart(secretSession)]));

const source = await readFile(new URL('../src/abuseGuard.ts', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
assert.match(source, /remoteAddress/);
assert.doesNotMatch(source, /headers\[["']x-forwarded-for["']\]|headers\.x-forwarded-for/i);
assert.doesNotMatch(source, /body\.content|messageBody|password_hash/);
assert.match(source, /Retry-After|retry-after/);
assert.match(source, /rate_limited/);
assert.match(indexSource, /url\.pathname === '\/api\/visitor\/sessions'[\s\S]*abuseGuard\.check\(request, 'guest_bootstrap'\)/);

console.log('server-generic abuse guard checks passed');
