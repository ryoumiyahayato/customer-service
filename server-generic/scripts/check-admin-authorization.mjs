#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canAdminAccessSession, listAdminChatSessions, requireAdminSessionAccess } from '../dist/chat.js';

const operatorA = {
  id: '00000000-0000-0000-0000-000000000001',
  username: 'operator-a',
  email: null,
  displayName: null,
  role: 'OPERATOR',
  createdAt: '2026-01-01T00:00:00.000Z',
};
const operatorB = { ...operatorA, id: '00000000-0000-0000-0000-000000000002', username: 'operator-b' };
const superAdmin = { ...operatorA, id: '00000000-0000-0000-0000-000000000003', role: 'SUPER_ADMIN' };
const legacyAdmin = { ...superAdmin, role: 'admin' };

assert.equal(canAdminAccessSession(operatorA, operatorA.id), true);
assert.equal(canAdminAccessSession(operatorA, operatorB.id), false);
assert.equal(canAdminAccessSession(operatorA, null), false);
assert.equal(canAdminAccessSession(superAdmin, operatorB.id), true);
assert.equal(canAdminAccessSession(superAdmin, null), true);
assert.equal(canAdminAccessSession(legacyAdmin, null), true);

let listQuery;
const listDb = {
  async query(sql, params) {
    listQuery = { sql, params };
    return [];
  },
};
await listAdminChatSessions(listDb, operatorA, 500);
assert.match(listQuery.sql, /assigned_operator_id = \$2/);
assert.deepEqual(listQuery.params, [false, operatorA.id, 100]);

const row = {
  id: '00000000-0000-0000-0000-000000000010',
  status: 'open',
  customer_name: null,
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
  closed_at: null,
  archived_at: null,
  deleted_at: null,
  history_cleared_at: null,
  assigned_operator_id: operatorB.id,
};
const objectDb = { async query() { return [row]; } };
await assert.rejects(() => requireAdminSessionAccess(objectDb, operatorA, row.id), /session_not_found/);
await assert.doesNotReject(() => requireAdminSessionAccess(objectDb, operatorB, row.id));
await assert.doesNotReject(() => requireAdminSessionAccess(objectDb, superAdmin, row.id));

const read = async (name) => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');
const [adminApi, compat, websocket, attachments, lifecycle, messages, invites] = await Promise.all([
  read('adminApi.ts'),
  read('frontendCompat.ts'),
  read('websocket.ts'),
  read('attachments.ts'),
  read('lifecycle.ts'),
  read('messages.ts'),
  read('invites.ts'),
]);

assert.match(adminApi, /requireAdminSessionAccess/);
assert.match(compat, /requireAdminSessionAccess/);
assert.match(websocket, /requireAdminSessionAccess/);
assert.match(attachments, /chat_sessions\.assigned_operator_id/);
assert.match(lifecycle, /assigned_operator_id/);
assert.match(messages, /canAdminAccessSession/);
assert.match(invites, /created_by_admin_id = \$2 OR source_admin_id = \$2/);
assert.match(invites, /isSuperAdmin/);

console.log('server-generic admin object authorization checks passed');
