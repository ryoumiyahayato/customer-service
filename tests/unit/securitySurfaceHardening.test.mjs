import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const productionBoundary = readFileSync(new URL('../../src/worker-production-boundary.ts', import.meta.url), 'utf8');
const publicGate = readFileSync(new URL('../../src/worker-public-gate.ts', import.meta.url), 'utf8');
const chatRoom = readFileSync(new URL('../../src/durable-objects/ChatRoom.ts', import.meta.url), 'utf8');
const requestLimits = readFileSync(new URL('../../src/security/requestLimits.ts', import.meta.url), 'utf8');
const cookies = readFileSync(new URL('../../src/security/cookies.ts', import.meta.url), 'utf8');
const wrangler = readFileSync(new URL('../../wrangler.toml', import.meta.url), 'utf8');
const genericAuth = readFileSync(new URL('../../server-generic/src/auth.ts', import.meta.url), 'utf8');
const genericCompat = readFileSync(new URL('../../server-generic/src/frontendCompat.ts', import.meta.url), 'utf8');
const genericSocket = readFileSync(new URL('../../server-generic/src/websocket.ts', import.meta.url), 'utf8');
const genericIndex = readFileSync(new URL('../../server-generic/src/index.ts', import.meta.url), 'utf8');
const genericConfig = readFileSync(new URL('../../server-generic/src/config.ts', import.meta.url), 'utf8');

test('production visitor and admin surfaces are restricted at the outermost worker boundary', () => {
  assert.match(wrangler, /main\s*=\s*"src\/worker-production-boundary\.ts"/);
  assert.match(productionBoundary, /productionDomains/);
  assert.match(productionBoundary, /if \(!domains\) return hardenedPlain\(503/);
  assert.match(productionBoundary, /if \(!visitor\) return hardenedPlain\(404/);
  assert.match(productionBoundary, /requestWithOnlyCookie\(req, COOKIE_NAMES\.admin\)/);
  assert.match(productionBoundary, /requestWithOnlyCookie\(req, COOKIE_NAMES\.guest\)/);
  assert.match(productionBoundary, /headers\.delete\('authorization'\)/);
  assert.match(productionBoundary, /visitor-entry/);
  assert.match(productionBoundary, /visitor-upload/);
  assert.match(productionBoundary, /visitorUploadLimited/);
  assert.match(productionBoundary, /20, 10 \* 60 \* 1000/);
  assert.match(productionBoundary, /visitorAsset[\s\S]*?liveInvite/);
  assert.match(productionBoundary, /crossSiteReadMutation/);
  assert.match(publicGate, /Content-Security-Policy/);
  assert.match(publicGate, /connect-src 'self'/);
  assert.match(publicGate, /form-action 'none'/);
  assert.match(publicGate, /adminLegacyVisitorApi/);
  assert.match(publicGate, /path\.startsWith\('\/api\/account\/'\)/);
  assert.match(publicGate, /Referrer-Policy': 'no-referrer'/);
  assert.match(wrangler, /workers_dev\s*=\s*false/);
  assert.match(wrangler, /preview_urls\s*=\s*false/);
});

test('browser session cookies are __Host- scoped and cannot be widened to sibling subdomains', () => {
  assert.match(cookies, /admin:\s*'__Host-support_admin'/);
  assert.match(cookies, /visitor:\s*'__Host-visitor_account'/);
  assert.match(cookies, /guest:\s*'__Host-guest_session'/);
  assert.match(cookies, /Path=\//);
  assert.match(cookies, /HttpOnly/);
  assert.match(cookies, /Secure/);
  assert.doesNotMatch(cookies, /Domain=/i);
});

test('persistent credential changes require a recent session without blocking display-name-only profile edits', () => {
  assert.match(productionBoundary, /async function sensitiveIdentityMutation/);
  assert.match(productionBoundary, /url\.pathname === '\/api\/admins'/);
  assert.match(productionBoundary, /OPERATOR_PASSWORD_RESET/);
  assert.match(productionBoundary, /url\.pathname !== '\/api\/admins\/profile'/);
  assert.match(productionBoundary, /readJsonObjectWithinLimit\(req, SENSITIVE_PROFILE_MAX_BYTES\)/);
  assert.match(productionBoundary, /body\.username/);
  assert.match(productionBoundary, /body\.password/);
  assert.doesNotMatch(productionBoundary.match(/async function sensitiveIdentityMutation[\s\S]*?\n}/)?.[0] || '', /displayName/);
  assert.match(productionBoundary, /datetime\(s\.created_at\)>datetime\('now','-10 minutes'\)/);
  assert.match(productionBoundary, /reauthentication_required/);
});

test('read endpoints with side effects reject same-site sibling origins as well as cross-site browsers', () => {
  const readGuard = productionBoundary.match(/function crossSiteReadMutation[\s\S]*?\n}/)?.[0] || '';
  assert.match(readGuard, /site && site !== 'same-origin'/);
  assert.match(readGuard, /mode === 'navigate'/);
  assert.match(readGuard, /dest && dest !== 'empty'/);
});

test('setup token mutation attempts are rate-limited before first-admin initialization', () => {
  assert.match(productionBoundary, /type WorkerRequest = Request<any, any>/);
  assert.match(productionBoundary, /async function adminSetupLimited\(req: WorkerRequest, env: Env\)/);
  assert.match(productionBoundary, /pathname\.startsWith\('\/api\/setup\/'\)/);
  assert.match(productionBoundary, /limitedByIp\(req, env, 'admin-setup', 5, 10 \* 60 \* 1000\)/);
  assert.match(productionBoundary, /adminSetupLimited\(req, env\)/);
});

test('request body size guards fail closed when a request stream cannot be read', () => {
  const streamGuard = requestLimits.match(/export async function requestStreamExceeds[\s\S]*?\n}/)?.[0] || '';
  assert.match(streamGuard, /catch\s*{[\s\S]*?return true;/);
  assert.doesNotMatch(streamGuard, /catch\s*{[\s\S]*?return false;/);
});

test('visitor HTTP and websocket payloads are minimized independently from admin payloads', () => {
  assert.match(publicGate, /function safeVisitorMessage/);
  assert.match(publicGate, /senderId:\s*null/);
  assert.match(publicGate, /function safeVisitorSession/);
  assert.match(publicGate, /async function minimizeVisitorJson/);
  assert.match(publicGate, /minimizeVisitorJson\(req, response\)/);
  assert.doesNotMatch(publicGate.match(/function safeVisitorSession[\s\S]*?\n}/)?.[0] || '', /userId|visitorKey|assignedOperatorId|ipAddress|deviceLabel/);
  assert.match(chatRoom, /sanitizeGuestSocketPayload/);
  assert.match(chatRoom, /meta\.principalType === 'guest'[\s\S]*?sanitizeGuestSocketPayload/);
});

test('own-profile and invite lifecycle controls stay on the authenticated admin surface', () => {
  assert.match(publicGate, /handleOwnProfilePatch/);
  assert.match(publicGate, /currentAdminContext/);
  assert.match(publicGate, /sameOriginWrite/);
  assert.match(publicGate, /UPDATE admins SET username=\?,display_name=\?/);
  assert.doesNotMatch(publicGate.match(/async function handleOwnProfilePatch[\s\S]*?\n}/)?.[0] || '', /role\s*=|operator_policy/);
  assert.match(publicGate, /INVITE_STATUS/);
  assert.match(publicGate, /row\.created_by_admin_id !== admin\.id && row\.source_operator_id !== admin\.id/);
  assert.match(publicGate, /state, expiresAt/);
  assert.match(publicGate, /avatarMagicMatches/);
});

test('self-host authentication and websocket access fail closed after login', () => {
  assert.match(genericAuth, /DUMMY_ADMIN_PASSWORD_HASH/);
  assert.match(genericAuth, /verifyPassword\(password, admin\?\.password_hash \|\| DUMMY_ADMIN_PASSWORD_HASH\)/);
  assert.match(genericAuth, /!admin \|\| admin\.is_disabled \|\| !valid/);
  assert.match(genericSocket, /async function remainsAuthorized/);
  assert.match(genericSocket, /requireCurrentAdmin\(db, state\.auth\.token\)/);
  assert.match(genericSocket, /requireVisitorSession\(db, state\.auth\.sessionId, state\.auth\.token\)/);
  assert.match(genericSocket, /remainsAuthorized\(state\)[\s\S]*?closeRevoked/);
});

test('self-host browser compatibility never treats visitorId as a bearer credential', () => {
  const credentialFunction = genericCompat.match(/function visitorTokenFromRequest[\s\S]*?\n}/)?.[0] || '';
  assert.match(credentialFunction, /support_visitor|VISITOR_COOKIE_NAME/);
  assert.match(credentialFunction, /return optionalString\(body\?\.visitorToken\)\?\.trim\(\) \|\| null/);
  assert.doesNotMatch(credentialFunction, /body\?\.(?:visitorId|visitor_id)/);
  assert.doesNotMatch(genericCompat, /visitorId:\s*consumed\.visitorToken/);
});

test('self-host CSRF protection targets state changes without requiring referrers on reads', () => {
  assert.match(genericIndex, /function isStateChangingMethod/);
  assert.match(genericIndex, /url\.pathname\.startsWith\('\/api\/'\) && isStateChangingMethod\(request\.method\)/);
});

test('self-host public deployment cannot bypass missing production surface isolation', () => {
  const exposureFunction = genericConfig.match(/export function assertExperimentalPublicExposure[\s\S]*?\n}/)?.[0] || '';
  assert.match(exposureFunction, /if \(env\.NODE_ENV !== 'production'\) return/);
  assert.match(exposureFunction, /if \(allDomainsLocal\) return/);
  assert.match(exposureFunction, /does not yet implement the production admin\/visitor bundle and token-subdomain isolation boundary/);
  assert.doesNotMatch(exposureFunction, /experimentalPublicAcknowledged\) return/);
});
