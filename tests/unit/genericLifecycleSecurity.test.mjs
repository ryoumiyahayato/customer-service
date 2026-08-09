import assert from 'node:assert/strict';
import test from 'node:test';
import { registerTypeScriptHooks } from '../helpers/tsExtensionLoader.mjs';

registerTypeScriptHooks();
const { clearSessionHistory } = await import('../../server-generic/src/lifecycle.ts');
const { requireVisitorSession } = await import('../../server-generic/src/chat.ts');

const admin = (role) => ({
  id: 'admin-1',
  username: 'operator',
  email: null,
  displayName: 'Operator',
  role,
  createdAt: new Date().toISOString(),
});

test('generic clear-history rejects an assigned operator before database mutation and rejects active sessions', async () => {
  let transactionCalls = 0;
  const db = {
    async withTransaction() {
      transactionCalls += 1;
      throw new Error('destructive transaction must not run');
    },
    async query() {
      throw new Error('cleanup query must not run');
    },
  };
  const storage = { deleteObject: async () => { throw new Error('storage delete must not run'); } };

  await assert.rejects(
    clearSessionHistory(db, storage, 'active-session', admin('OPERATOR'), 'CLEAR_HISTORY'),
    (error) => error?.status === 403 && error?.code === 'forbidden',
  );
  assert.equal(transactionCalls, 0);

  const activeDb = {
    async withTransaction(callback) {
      return callback({
        async query(sql) {
          if (sql.includes('FROM admins')) return { rows: [{ id: 'admin-1' }] };
          if (sql.includes('FROM chat_sessions')) return {
            rows: [{
              id: 'active-session',
              status: 'OPEN',
              customer_name: null,
              created_at: new Date(),
              updated_at: new Date(),
              closed_at: null,
              archived_at: null,
              deleted_at: null,
              history_cleared_at: null,
              purged_at: null,
              assigned_operator_id: 'admin-1',
            }],
          };
          throw new Error(`unexpected destructive query: ${sql}`);
        },
      });
    },
  };

  await assert.rejects(
    clearSessionHistory(activeDb, storage, 'active-session', admin('SUPER_ADMIN'), 'CLEAR_HISTORY'),
    (error) => error?.status === 409 && error?.code === 'session_not_terminal',
  );
});

test('generic visitor capability rejects expired/revoked tokens and terminal write capabilities', async () => {
  const sessionRow = {
    id: 'session-1',
    status: 'OPEN',
    customer_name: null,
    created_at: new Date(),
    updated_at: new Date(),
    closed_at: null,
    archived_at: null,
    deleted_at: null,
    history_cleared_at: null,
    purged_at: null,
    assigned_operator_id: null,
  };

  const deniedDb = {
    async query(sql) {
      assert.match(sql, /v\.revoked_at IS NULL/);
      assert.match(sql, /v\.expires_at > now\(\)/);
      return [];
    },
  };
  for (const token of ['expired-token', 'revoked-token']) {
    await assert.rejects(
      requireVisitorSession(deniedDb, 'session-1', token, 'read'),
      (error) => error?.status === 404 && error?.code === 'session_not_found',
    );
  }

  const activeDb = {
    async query(sql) {
      if (sql.includes('FROM chat_sessions')) return [sessionRow];
      return [];
    },
  };
  const active = await requireVisitorSession(activeDb, 'session-1', 'live-token', 'upload');
  assert.equal(active.id, 'session-1');

  const terminalDb = {
    async query(sql) {
      if (sql.includes('FROM chat_sessions')) return [{ ...sessionRow, status: 'CLOSED' }];
      return [];
    },
  };
  await assert.rejects(
    requireVisitorSession(terminalDb, 'session-1', 'live-token', 'write'),
    (error) => error?.status === 409 && error?.code === 'session_ended',
  );
});
