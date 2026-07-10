#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const wrapper = read('src/worker-business-hardening.ts');
const lifecycle = read('src/sessionLifecycle.ts');
const migration = read('migrations/0010_attachment_claim_token.sql');
const wrangler = read('wrangler.toml');
const websocket = read('server-generic/src/websocket.ts');
const genericIndex = read('server-generic/src/index.ts');
const genericConfig = read('server-generic/src/config.ts');
const preflight = read('deploy/linux/preflight.sh');

assert.match(wrangler, /main\s*=\s*"src\/worker-business-hardening\.ts"/);
assert.match(wrapper, /operator_hard_delete_not_supported/);
assert.match(wrapper, /UPDATE admin_sessions SET revoked_at=COALESCE\(revoked_at,\?\)/);
assert.match(wrapper, /UPDATE sessions SET assigned_operator_id=NULL,updated_at=\?/);
assert.doesNotMatch(
  wrapper.match(/async function handleOperatorDisable[\s\S]*?\n}/)?.[0] || '',
  /deleted_at\s*=/,
);
assert.match(wrapper, /preserve_historical_references/);
assert.match(wrapper, /operator_already_disabled/);
assert.match(wrapper, /operator_state_conflict/);

assert.match(migration, /ALTER TABLE attachments ADD COLUMN claim_token TEXT/);
assert.match(wrapper, /created_by_type=\? AND created_by_id=\?/);
assert.match(wrapper, /message_id IS NULL AND claim_token IS NULL AND deleted_at IS NULL/);
assert.match(wrapper, /datetime\(expires_at\)>datetime\('now'\)/);
assert.match(wrapper, /Number\(claimed\?\.meta\?\.changes \|\| 0\) !== 1/);
assert.match(wrapper, /attachment_binding_failed/);
assert.match(wrapper, /DELETE FROM messages WHERE id=\? AND session_id=\? AND sender_type=\? AND sender_id=\?/);
assert.match(wrapper, /UPDATE attachments SET claim_token=NULL/);
assert.match(wrapper, /async function existingImageRetry/);
assert.match(wrapper, /client_message_id=\?/);
assert.match(wrapper, /attachment\.message_id === existing\.id/);
assert.match(wrapper, /retry === 'deduped'/);
assert.match(wrapper, /client_message_id_conflict/);

assert.match(lifecycle, /datetime\(COALESCE\(updated_at, created_at\)\) <= datetime\('now', '-24 hours'\)/);
assert.match(lifecycle, /datetime\(deleted_at\) <= datetime\('now', '-24 hours'\)/);
assert.match(lifecycle, /claimTrashSessionForPurge/);
assert.match(lifecycle, /SET purged_at=\?,updated_at=\?/);
assert.match(lifecycle, /env\.UPLOADS!\.delete\(key\)/);
assert.match(lifecycle, /DELETE FROM attachments/);
assert.match(lifecycle, /DELETE FROM messages/);
assert.match(lifecycle, /EXISTS \([\s\S]*?purged_at IS NOT NULL AND history_cleared_at IS NULL/);
assert.match(lifecycle, /purged_at IS NOT NULL[\s\S]*?history_cleared_at IS NULL/);
assert.ok(lifecycle.indexOf('SET purged_at=?,updated_at=?') < lifecycle.indexOf('env.UPLOADS!.delete(key)'));

assert.match(websocket, /requireCurrentAdmin/);
assert.match(websocket, /requireVisitorSession/);
assert.ok(websocket.includes("/^\\/api\\/ws\\/conversations\\/"));
assert.doesNotMatch(websocket, /type\s*===\s*['"]subscribe['"]/);
assert.match(websocket, /client_messages_not_supported/);
assert.match(genericIndex, /createWebSocketHub\(db\)/);
assert.match(genericConfig, /server-generic public exposure is blocked/);
assert.match(genericConfig, /SELF_HOST_EXPERIMENTAL_PUBLIC_ACK/);
assert.match(genericConfig, /required production domains are missing/);
assert.match(genericConfig, /requiredDomains\.some\(\(domain\) => !domain\.trim\(\)\)/);
assert.match(preflight, /server-generic remains experimental/);

assert.equal(existsSync('lib/types.ts'), false, 'unused lib/types.ts must remain deleted');

console.log('high-risk business closure checks passed');
