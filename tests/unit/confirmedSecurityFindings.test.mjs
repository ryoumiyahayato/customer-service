import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (relativePath) => readFileSync(path.join(root, relativePath), 'utf8');

test('F01 generic clear-history is super-admin, confirmed, terminal-only and durable', () => {
  const lifecycle = read('server-generic/src/lifecycle.ts');
  assert.match(lifecycle, /confirmation !== 'CLEAR_HISTORY'/);
  assert.match(lifecycle, /if \(!isSuperAdmin\(admin\)\)/);
  assert.match(lifecycle, /session_not_terminal/);
  assert.match(lifecycle, /INSERT INTO attachment_cleanup_jobs/);
  assert.match(lifecycle, /message_count=0/);
  assert.match(lifecycle, /UPDATE visitor_sessions SET revoked_at/);
});

test('F02 Linux deployment keeps secrets, storage and the app process private', () => {
  const scripts = [
    read('deploy/linux/install.sh'),
    read('deploy/linux/preflight.sh'),
    read('deploy/linux/backup.sh'),
    read('deploy/linux/restore.sh'),
    read('deploy/linux/prepare-directories.sh'),
  ].join('\n');
  assert.match(scripts, /umask 077/);
  assert.match(scripts, /chmod 600/);
  assert.match(scripts, /check_private_path/);
  assert.match(scripts, /APP_UID/);
  assert.match(scripts, /APP_GID/);
  assert.match(scripts, /chmod 700/);
  assert.match(read('deploy/linux/Dockerfile'), /USER customerchat/);
  const storage = read('server-generic/src/storage/localStorage.ts');
  assert.match(storage, /Storage root permissions are unsafe/);
  assert.match(storage, /Expected owner-only access/);
  assert.doesNotMatch(storage, /chmod\(root/);
  assert.match(storage, /writeFile\(target, content, \{ mode: 0o600 \}\)/);
  const compose = read('deploy/linux/docker-compose.yml');
  assert.match(compose, /APP_UID:\s+"\$\{APP_UID:\?/);
  assert.match(compose, /APP_GID:\s+"\$\{APP_GID:\?/);
  assert.match(read('deploy/linux/docker-compose.local.yml'), /127\.0\.0\.1:\$\{LOCAL_APP_PORT/);
});

test('F03 unclaimed attachments have bounded count/bytes, short TTL and retry cleanup', () => {
  const migration = read('migrations/0015_security_resource_limits.sql');
  const rootAttachment = read('src/repositories/attachmentRepository.ts');
  const genericAttachment = read('server-generic/src/attachments.ts');
  assert.match(migration, /unclaimed_attachment_count/);
  assert.match(migration, /attachment_cleanup_jobs/);
  assert.match(migration, /message_quota_reservations/);
  assert.match(rootAttachment, /unclaimedAttachmentMaxCount/);
  assert.match(rootAttachment, /unclaimedAttachmentMaxBytes/);
  assert.match(genericAttachment, /expires_at > now\(\)/);
  assert.match(genericAttachment, /attachment_cleanup_jobs/);
});

test('F04 Windows deployment rejects arbitrary credential fields and gates real SSH', () => {
  const config = read('deploy/windows-wizard/src/config.ts');
  const validation = read('deploy/windows-wizard/src/validation.ts');
  const index = read('deploy/windows-wizard/src/index.ts');
  const deployment = read('deploy/windows-wizard/src/deployment.ts');
  assert.match(config, /CUSTOMER_SERVICE_DEPLOY_SSH_PASSWORD/);
  assert.match(validation, /unsupported deployment field/);
  assert.match(index, /--real --confirm-target/);
  assert.match(deployment, /options\.confirmTarget/);
  assert.match(deployment, /Real deployment requires explicit target confirmation/);
});

test('F05 message and upload writes enforce bounded session resource accounting', () => {
  const limits = read('src/security/resourceLimits.ts');
  const rootMessages = read('src/repositories/messageRepository.ts');
  const genericMessages = read('server-generic/src/messages.ts');
  assert.match(limits, /messageSessionMaxCount/);
  assert.match(limits, /messageSessionMaxBytes/);
  assert.match(rootMessages, /message_quota_reservations/);
  assert.match(rootMessages, /message_count=message_count\+1/);
  assert.match(genericMessages, /message_quota_exceeded/);
  assert.match(genericMessages, /FOR UPDATE/);
});

test('F06 local self-host Compose publishes only through loopback', () => {
  const compose = read('deploy/linux/docker-compose.local.yml');
  assert.match(compose, /127\.0\.0\.1:\$\{LOCAL_APP_PORT/);
  assert.match(compose, /APP_DOMAIN: \$\{APP_DOMAIN:-127\.0\.0\.1\}/);
  assert.match(compose, /VISITOR_ROOT_DOMAIN: \$\{VISITOR_ROOT_DOMAIN:-127\.0\.0\.1\}/);
});

test('F07 visitor capabilities are bound to expiring and revocable session records', () => {
  const rootRuntime = read('src/runtimeWorker.ts');
  const genericChat = read('server-generic/src/chat.ts');
  assert.match(rootRuntime, /visitor_sessions.*session_id|session_id.*visitor_sessions/s);
  assert.match(rootRuntime, /expires_at>\?/);
  assert.match(rootRuntime, /revoked_at IS NULL/);
  assert.match(genericChat, /requireVisitorSession/);
  assert.match(genericChat, /hashVisitorToken/);
  assert.match(genericChat, /revoked_at IS NULL/);
});

test('F08 rate-limit keys use fixed semantic buckets and bounded principals', () => {
  const runtime = read('src/runtimeWorker.ts');
  const limits = read('src/security/resourceLimits.ts');
  assert.match(runtime, /websocket-upgrade/);
  assert.match(runtime, /attachment-upload/);
  assert.match(runtime, /message-create/);
  assert.match(runtime, /boundedRateLimitKey\(bucket, ip\)/);
  assert.match(limits, /safeBucket.*slice\(0, 80\)/s);
  assert.match(limits, /safePrincipal.*slice\(0, 120\)/s);
});

test('F09 deleted, recalled and purged content is redacted and attachments are inaccessible', () => {
  const runtime = read('src/runtimeWorker.ts');
  const genericMessages = read('server-generic/src/messages.ts');
  const genericAttachments = read('server-generic/src/attachments.ts');
  assert.match(runtime, /COALESCE\(m\.deleted_at,''\)=''/);
  assert.match(runtime, /COALESCE\(m\.recalled_at,''\)=''/);
  assert.match(runtime, /COALESCE\(m\.image_purged_at,''\)=''/);
  assert.match(runtime, /content='',image_path=NULL/);
  assert.match(runtime, /redactMessageAndQueueAttachmentCleanup/);
  assert.match(genericMessages, /body: redacted \? null/);
  assert.match(genericAttachments, /m\.deleted_at IS NULL/);
});

test('F10 deployment command execution does not interpolate shell commands', () => {
  const scripts = [
    read('scripts/deployment-safety-lib.mjs'),
    read('scripts/deploy-cloudflare.mjs'),
    read('scripts/deploy-cloudflare-safe.mjs'),
    read('deploy/windows-wizard/src/deployment.ts'),
  ].join('\n');
  assert.doesNotMatch(scripts, /shell\s*:\s*true/);
  assert.match(scripts, /process\.execPath/);
  assert.match(scripts, /nodeNpmInvocation/);
});

test('F11 WebSocket connections, frames, lifetime, idle and protocol events are bounded', () => {
  const rootSocket = read('src/durable-objects/ChatRoom.ts');
  const genericSocket = read('server-generic/src/websocket.ts');
  assert.match(rootSocket, /maxConnectionsPerPrincipal/);
  assert.match(rootSocket, /maxFrameBytes/);
  assert.match(rootSocket, /maxLifetimeMs/);
  assert.match(rootSocket, /event_not_allowed/);
  assert.match(rootSocket, /ping_rate_limited/);
  assert.match(genericSocket, /maxPayload/);
  assert.match(genericSocket, /binary_not_allowed/);
  assert.match(genericSocket, /websocketMaxConnectionsPerRoom/);
});

test('F12 admin-feed sockets carry separate current admin/session authorization', () => {
  const rootSocket = read('src/durable-objects/ChatRoom.ts');
  const genericSocket = read('server-generic/src/websocket.ts');
  assert.match(rootSocket, /mode: 'admin-feed'/);
  assert.match(rootSocket, /canReceiveAdminFeed/);
  assert.match(rootSocket, /auth\.last_seen_at/);
  assert.match(genericSocket, /admin-feed/);
  assert.match(genericSocket, /requireCurrentAdmin/);
});

test('F13 message reads are read-only GETs with an explicit POST read mutation and CSRF boundary', () => {
  const runtime = read('src/runtimeWorker.ts');
  const boundary = read('src/worker-production-boundary.ts');
  const getStart = runtime.indexOf('async function getMessages');
  const readStart = runtime.indexOf('async function markMessagesRead');
  assert.ok(getStart >= 0 && readStart > getStart);
  assert.doesNotMatch(runtime.slice(getStart, readStart), /UPDATE messages/);
  assert.match(runtime, /const readRoute = path\.match\(\/\^\\\/api\\\/sessions/);
  assert.match(runtime, /readRoute && req\.method === 'POST'/);
  assert.match(boundary, /crossSiteReadMutation/);
  assert.match(boundary, /method\.toUpperCase\(\) !== 'POST'/);
});
