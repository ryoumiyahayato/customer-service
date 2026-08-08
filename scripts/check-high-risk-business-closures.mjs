#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');
const publicGate = read('src/worker-public-gate.ts');
const finalWrapper = read('src/worker-final.ts');
const entryWrapper = read('src/worker-entry.ts');
const presentationWrapper = read('src/worker-presentation.ts');
const wrapper = read('src/worker-business-hardening.ts');
const secureWorker = read('src/worker-secure.ts');
const runtimeWorker = read('src/runtimeWorker.ts');
const requestLimits = read('src/security/requestLimits.ts');
const rateLimit = read('src/security/rateLimit.ts');
const responseHeaders = read('src/security/responseHeaders.ts');
const signing = read('src/security/signing.ts');
const sessionTokens = read('src/security/sessionTokens.ts');
const cookies = read('src/security/cookies.ts');
const lifecycle = read('src/sessionLifecycle.ts');
const migration = read('migrations/0010_attachment_claim_token.sql');
const wrangler = read('wrangler.toml');
const websocket = read('server-generic/src/websocket.ts');
const genericIndex = read('server-generic/src/index.ts');
const genericConfig = read('server-generic/src/config.ts');
const genericSetup = read('server-generic/src/setup.ts');
const preflight = read('deploy/linux/preflight.sh');
const adminDashboard = read('src/admin/AdminDashboard.tsx');

assert.match(wrangler, /main\s*=\s*"src\/worker-public-gate\.ts"/);
assert.match(publicGate, /export \{ ChatRoom \} from '\.\/worker-final'/);
assert.match(publicGate, /import worker from '\.\/worker-final'/);
assert.match(publicGate, /isAllowedVisitorApiRequest/);
assert.match(publicGate, /visitorHost[\s\S]*?url\.pathname\.startsWith\('\/api\/'\)[\s\S]*?!isAllowedVisitorApiRequest/);
assert.match(finalWrapper, /export \{ ChatRoom \} from '\.\/worker-entry'/);
assert.match(finalWrapper, /import worker from '\.\/worker-entry'/);
assert.match(finalWrapper, /url\.pathname === '\/api\/ws\/staff'/);
assert.match(finalWrapper, /operator_policy:/);
assert.match(finalWrapper, /canUseStaffChat/);
assert.match(entryWrapper, /import presentationWorker from '\.\/worker-presentation'/);
assert.match(entryWrapper, /created_by_admin_id/);
assert.match(entryWrapper, /source_operator_id \|\| invite\.created_by_admin_id/);
assert.match(entryWrapper, /invitePresentationMatch/);
assert.match(presentationWrapper, /import businessWorker from '\.\/worker-business-hardening'/);
assert.match(presentationWrapper, /operatorPresentationKey/);
assert.match(presentationWrapper, /invitePresentationMatch/);
assert.match(presentationWrapper, /sameOriginWrite/);
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
assert.doesNotMatch(adminDashboard, /disableOp\(op, true\)/);
assert.doesNotMatch(adminDashboard, /body: JSON\.stringify\(\{ id: op\.id, hard \}\)/);

assert.match(wrapper, /readJsonObjectWithinLimit/);
assert.match(requestLimits, /reader\.cancel\(\)/);
assert.match(requestLimits, /total > maxBytes/);
assert.match(wrapper, /if \(!referer\) return isLocalDevHost/);
assert.doesNotMatch(wrapper, /if \(!referer\) return true/);
assert.doesNotMatch(wrapper, /req\.clone\(\)\.json\(\)/);
assert.match(wrapper, /async function handleImageMessage[\s\S]*?if \(!sameOriginWrite\(req\)\)/);

assert.match(secureWorker, /requestStreamExceeds/);
assert.match(responseHeaders, /Strict-Transport-Security/);
assert.match(responseHeaders, /X-Frame-Options/);
assert.match(rateLimit, /ON CONFLICT\(key\) DO NOTHING/);
assert.match(rateLimit, /reset_at <= \? OR count < \?/);
assert.match(secureWorker, /requestPath !== '\/api\/upload'/);
assert.match(secureWorker, /requestPath\.startsWith\('\/api\/'\)/);
assert.match(secureWorker, /protectUpload[\s\S]*?requestStreamExceeds\(req, UPLOAD_REQUEST_MAX_BYTES\)/);
assert.match(secureWorker, /const SAFE_METHODS = new Set\(\['GET', 'HEAD', 'OPTIONS'\]\)/);
assert.match(secureWorker, /shouldProtectAgainstCsrf[\s\S]*?return !SAFE_METHODS\.has\(req\.method\.toUpperCase\(\)\)/);
assert.match(secureWorker, /shouldProtectAgainstCsrf\(req\)[\s\S]*?!isSameOriginWrite\(req\)/);
assert.match(secureWorker, /pathname\.startsWith\('\/api\/ws'\)[\s\S]*?!isSameOriginWebSocket/);
assert.ok(secureWorker.indexOf('const blocked = await preflightSecurity') < secureWorker.indexOf('const eventPromise = auditReq'));

assert.match(signing, /parts\.length !== 2/);
assert.match(signing, /constantTimeEqual\(signature, await hmacHex/);
assert.match(sessionTokens, /`session:\$\{sessionId\}`/);
assert.match(cookies, /support_admin/);
assert.match(cookies, /support_visitor|visitor_account/);
assert.match(wrapper, /consumeRateLimit\(env\.DB, key, 20, 60 \* 1000\)/);
assert.match(runtimeWorker, /verifySignedValue\(env\.SESSION_SECRET, token\)/);
assert.match(runtimeWorker, /const adminId = 'admin_primary'/);
assert.match(genericSetup, /pg_advisory_xact_lock/);
assert.ok(genericSetup.indexOf('pg_advisory_xact_lock') < genericSetup.indexOf("'SELECT id FROM admins LIMIT 1'"));

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
