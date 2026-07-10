#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = async (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');

const [migration, invites, compat, messages, websocket, adminApi, readme] = await Promise.all([
  read('migrations/0005_v1_architecture_foundation.sql'),
  read('src/invites.ts'),
  read('src/frontendCompat.ts'),
  read('src/messages.ts'),
  read('src/websocket.ts'),
  read('src/adminApi.ts'),
  read('README.md'),
]);

assert.match(migration, /CREATE TABLE IF NOT EXISTS invite_links/);
assert.match(migration, /token_hash TEXT NOT NULL UNIQUE/);
assert.match(migration, /created_by_admin_id UUID NOT NULL REFERENCES admins/);
assert.match(migration, /expires_at TIMESTAMPTZ NOT NULL/);
assert.match(migration, /consumed_at TIMESTAMPTZ/);
assert.match(migration, /revoked_at TIMESTAMPTZ/);
assert.match(migration, /ADD COLUMN IF NOT EXISTS client_message_id TEXT/);
assert.match(migration, /COALESCE\(sender_id, ''\), client_message_id/);
assert.match(migration, /ADD COLUMN IF NOT EXISTS purged_at TIMESTAMPTZ/);

assert.match(invites, /randomBytes\(20\)\.toString\('hex'\)/);
assert.match(invites, /hashSessionToken/);
assert.match(invites, /FOR UPDATE/);
assert.match(invites, /consumed_at IS NULL/);
assert.match(invites, /expires_at > now\(\)/);
assert.match(invites, /invite_already_consumed/);
assert.match(invites, /invite_expired/);
assert.match(invites, /revokeInvite/);
assert.doesNotMatch(invites, /shi_/);
assert.doesNotMatch(invites, /console\.(log|warn|error).*token/i);

assert.match(compat, /GET \/api\/invites/);
assert.match(compat, /POST \/api\/invites\/:id\/revoke/);
assert.match(compat, /persistent_single_use/);
assert.match(compat, /consumeInvite/);
assert.match(compat, /markSessionMessagesRead/);
assert.match(compat, /customer-read/);
assert.match(compat, /hashVisitorToken\(visitor\.visitorToken\)/);
assert.match(compat, /messages\.map\(\(message\) => mapFrontendMessage\(message\)\)/);
assert.match(compat, /type: 'messages:read'/);
assert.match(compat, /sourceOperatorId/);
assert.match(compat, /admin\.role === 'OPERATOR' \? admin\.id : null/);
assert.match(compat, /normalizeRequestedMessageIds/);
assert.match(compat, /markSessionMessagesRead\(context\.db, sessionId, 'visitor', requestedMessageIds\)/);
assert.doesNotMatch(compat, /self_host_minimal_bootstrap/);
assert.doesNotMatch(compat, /type: 'messages_read'/);

assert.match(messages, /client_message_id/);
assert.match(messages, /sender_id IS NOT DISTINCT FROM/);
assert.match(messages, /client_message_id_conflict/);
assert.match(messages, /ORDER BY created_at ASC, id ASC/);
assert.match(messages, /markSessionMessagesRead/);
assert.match(messages, /SELECT status, archived_at, deleted_at, purged_at, history_cleared_at/);
assert.match(messages, /current\.archived_at/);
assert.match(messages, /id::text = ANY\(\$3::text\[\]\)/);
assert.match(messages, /session_ended/);
assert.match(messages, /message\.deduped|deduped/);

assert.match(websocket, /type: 'messages:read'/);
assert.doesNotMatch(websocket, /type: 'messages_read'/);
assert.match(adminApi, /type: 'messages:read'/);
assert.doesNotMatch(adminApi, /type: 'messages_read'/);
assert.match(readme, /persistent invite lifecycle/i);
assert.match(readme, /not currently approved as a production backend/i);

console.log('server-generic v1 architecture foundation checks passed');
