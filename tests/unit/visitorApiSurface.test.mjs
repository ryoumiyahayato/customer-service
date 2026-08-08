import assert from 'node:assert/strict';
import test from 'node:test';
import { registerTypeScriptHooks } from '../helpers/tsExtensionLoader.mjs';

registerTypeScriptHooks();
const { isAllowedVisitorApiRequest } = await import('../../src/worker-public-gate.ts');

const visitor = (path, init = {}) => new Request(`https://vx9qn7zr.org${path}`, init);

test('visitor API allowlist permits only the chat capability surface', () => {
  const token = 'a'.repeat(40);
  assert.equal(isAllowedVisitorApiRequest(visitor(`/api/guest/${token}`, { method: 'POST' })), true);
  assert.equal(isAllowedVisitorApiRequest(visitor('/api/guest-avatar')), true);
  assert.equal(isAllowedVisitorApiRequest(visitor('/api/sessions/session-1/messages')), true);
  assert.equal(isAllowedVisitorApiRequest(visitor('/api/sessions/session-1/customer-read', { method: 'POST' })), true);
  assert.equal(isAllowedVisitorApiRequest(visitor('/api/messages', { method: 'POST' })), true);
  assert.equal(isAllowedVisitorApiRequest(visitor('/api/upload', { method: 'POST' })), true);
  assert.equal(isAllowedVisitorApiRequest(visitor('/api/attachments/object-key')), true);
  assert.equal(isAllowedVisitorApiRequest(visitor('/api/attachments/object-key', { method: 'HEAD' })), true);
  assert.equal(isAllowedVisitorApiRequest(visitor('/api/ws/conversations/session-1', { headers: { Upgrade: 'websocket' } })), true);
});

test('visitor API allowlist rejects admin, account and discovery routes by default', () => {
  for (const path of [
    '/api/auth/login',
    '/api/auth/me',
    '/api/admin/security/overview',
    '/api/admins',
    '/api/operators',
    '/api/staff-chat',
    '/api/ws/staff',
    '/api/account/login',
    '/api/account/register',
    '/api/invite-presentation/' + 'a'.repeat(40),
    '/api/operator-avatar/admin_primary',
    '/api/unknown-future-admin-route',
  ]) {
    assert.equal(isAllowedVisitorApiRequest(visitor(path)), false, path);
    assert.equal(isAllowedVisitorApiRequest(visitor(path, { method: 'POST' })), false, `${path} POST`);
  }
});

test('visitor websocket allowlist requires the conversation route and websocket upgrade', () => {
  assert.equal(isAllowedVisitorApiRequest(visitor('/api/ws/conversations/session-1')), false);
  assert.equal(isAllowedVisitorApiRequest(visitor('/api/ws/conversations/session-1', { headers: { Upgrade: 'websocket' } })), true);
  assert.equal(isAllowedVisitorApiRequest(visitor('/api/ws/conversations/session-1/extra', { headers: { Upgrade: 'websocket' } })), false);
});
