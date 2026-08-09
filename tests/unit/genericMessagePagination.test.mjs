import assert from 'node:assert/strict';
import test from 'node:test';
import { registerTypeScriptHooks } from '../helpers/tsExtensionLoader.mjs';

registerTypeScriptHooks();
const { listSessionMessagePage } = await import('../../server-generic/src/messages.ts');

const encryption = { enabled: false, key: null, keyVersion: 'v1' };

function row(index) {
  return {
    id: `message-${String(index).padStart(4, '0')}`,
    session_id: 'session-1',
    sender_type: 'visitor',
    sender_id: null,
    body: `message ${index}`,
    body_ciphertext: null,
    body_iv: null,
    body_tag: null,
    body_algorithm: null,
    body_key_version: null,
    message_type: 'text',
    read_at: null,
    created_at: new Date(Date.UTC(2026, 7, 9, 0, 0, index)),
    client_message_id: `client-${index}`,
    deleted_at: null,
    recalled_at: null,
  };
}

test('generic message history clamps client limits and uses a stable cursor', async () => {
  const queries = [];
  const db = {
    async query(sql, params) {
      if (sql.includes('FROM attachments')) return [];
      queries.push({ sql, params });
      return Array.from({ length: 101 }, (_, index) => row(index));
    },
  };

  const first = await listSessionMessagePage(db, 'session-1', encryption, 100000);
  assert.equal(first.messages.length, 100);
  assert.ok(first.nextCursor);
  assert.equal(queries[0].params.at(-1), 101);
  assert.match(queries[0].sql, /LIMIT \$2/);

  const second = await listSessionMessagePage(db, 'session-1', encryption, 100000, first.nextCursor);
  assert.equal(second.messages.length, 100);
  assert.equal(queries[1].params.at(-1), 101);
  assert.match(queries[1].sql, /created_at > \$2 OR \(created_at = \$2 AND id > \$3\)/);
});
