import assert from 'node:assert/strict';
import { loadConfig } from '../dist/config.js';
import { requireVisitorSession, CHAT_SESSION_COLUMNS_FROM_C } from '../dist/chat.js';
import { createPostgresAdapter } from '../dist/db/postgres.js';

const config = loadConfig();
if (!config.databaseUrl) throw new Error('DATABASE_URL is required for the PostgreSQL visitor JOIN regression.');

const db = createPostgresAdapter(config);
const probeSessionId = '00000000-0000-0000-0000-000000000000';
const probeToken = 'postgres-visitor-join-regression-token';
const probeTokenHash = '00'.repeat(32);

try {
  await assert.rejects(
    requireVisitorSession(db, probeSessionId, probeToken, 'read'),
    (error) => error?.status === 404 && error?.code === 'session_not_found',
  );

  await db.withTransaction(async (client) => {
    const result = await client.query(
      `SELECT ${CHAT_SESSION_COLUMNS_FROM_C}
         FROM chat_sessions c
         JOIN visitor_sessions v ON v.chat_session_id=c.id
        WHERE c.id = $1
          AND v.token_hash = $2
          AND v.revoked_at IS NULL
          AND v.expires_at > now()
          AND c.deleted_at IS NULL
          AND c.history_cleared_at IS NULL
        LIMIT 1`,
      [probeSessionId, probeTokenHash],
    );
    assert.equal(result.rowCount, 0);
  });

  console.log('PostgreSQL visitor capability JOIN regression passed.');
} finally {
  await db.close();
}

