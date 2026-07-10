#!/usr/bin/env node

import http from 'node:http';
import https from 'node:https';

const baseUrl = (process.env.SELF_HOST_BASE_URL || 'http://127.0.0.1:8788').replace(/\/+$/, '');
const setupToken = process.env.SETUP_TOKEN || '';
const adminUsername = process.env.ADMIN_USERNAME || 'local-smoke-admin';
const adminPassword = process.env.ADMIN_PASSWORD || '';
const adminDisplayName = process.env.ADMIN_DISPLAY_NAME || 'Local Smoke Admin';

if (!setupToken) failConfig('SETUP_TOKEN is required for local self-host smoke.');
if (!adminPassword || adminPassword.length < 12) failConfig('ADMIN_PASSWORD is required and must be at least 12 characters.');

function failConfig(message) {
  console.error(`CONFIG ${message}`);
  console.error('Example: SELF_HOST_BASE_URL=http://127.0.0.1:8788 SETUP_TOKEN=... ADMIN_USERNAME=... ADMIN_PASSWORD=... npm run e2e:local-smoke');
  process.exit(2);
}

function logPass(name) {
  console.log(`PASS ${name}`);
}

function logInfo(message) {
  console.log(`INFO ${message}`);
}

class CookieJar {
  constructor() { this.cookies = new Map(); }
  header() {
    return [...this.cookies.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
  }
  storeFrom(headers) {
    const values = Array.isArray(headers?.['set-cookie'])
      ? headers['set-cookie']
      : headers?.['set-cookie']
        ? [headers['set-cookie']]
        : [];
    for (const header of values) {
      for (const cookie of splitSetCookieHeader(header)) {
        const first = cookie.split(';')[0]?.trim();
        if (!first) continue;
        const eq = first.indexOf('=');
        if (eq <= 0) continue;
        const name = first.slice(0, eq);
        const value = first.slice(eq + 1);
        if (value) this.cookies.set(name, value);
        else this.cookies.delete(name);
      }
    }
  }
}

const adminJar = new CookieJar();
const visitorJar = new CookieJar();
const secondVisitorJar = new CookieJar();
const visitorMessage = `local smoke visitor ${Date.now()}`;
const adminMessage = `local smoke admin ${Date.now()}`;
const visitorClientMessageId = `visitor-${Date.now()}`;
const adminClientMessageId = `admin-${Date.now()}`;
const readTargetClientMessageId = `admin-read-target-${Date.now()}`;
const unreadControlClientMessageId = `admin-unread-control-${Date.now()}`;

function splitSetCookieHeader(header) {
  return String(header).split(/,(?=\s*[^;,=]+=)/g).map(value => value.trim()).filter(Boolean);
}

function safeRequestLabel(path) {
  return String(path)
    .replace(/\/api\/guest\/[^/?#]+/, '/api/guest/:token')
    .replace(/\/api\/sessions\/[^/?#]+\/messages/, '/api/sessions/:id/messages')
    .replace(/\/api\/sessions\/[^/?#]+\/customer-read/, '/api/sessions/:id/customer-read')
    .replace(/\/api\/invites\/[^/?#]+\/revoke/, '/api/invites/:id/revoke');
}

function rawRequest(path, { method, headers, body }) {
  const target = new URL(`${baseUrl}${path}`);
  const client = target.protocol === 'https:' ? https : http;
  const requestBody = body === undefined ? undefined : JSON.stringify(body);
  const requestHeaders = { ...headers };
  if (requestBody !== undefined) requestHeaders['content-length'] = Buffer.byteLength(requestBody);

  return new Promise((resolve, reject) => {
    const req = client.request(target, { method, headers: requestHeaders }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => resolve({
        status: res.statusCode || 0,
        headers: res.headers,
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    if (requestBody !== undefined) req.write(requestBody);
    req.end();
  });
}

async function request(path, { method = 'GET', body, jar, expected = [200], skipJson = false, label } = {}) {
  const headers = { accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const cookie = jar?.header();
  if (cookie) headers.cookie = cookie;
  const safeLabel = label || safeRequestLabel(path);

  let response;
  try {
    response = await rawRequest(path, { method, headers, body });
  } catch {
    console.error(`FAIL service_unreachable ${baseUrl}`);
    console.error('Start local compose first, then rerun this script.');
    console.error('Expected app URL example: http://127.0.0.1:8788');
    process.exit(3);
  }

  jar?.storeFrom(response.headers);
  if (!expected.includes(response.status)) {
    let code = '';
    try {
      const data = JSON.parse(response.text || '{}');
      code = data?.error || data?.code || '';
    } catch {}
    throw new Error(`${method} ${safeLabel} returned ${response.status}${code ? ` (${code})` : ''}`);
  }
  if (skipJson || response.status === 204) return null;
  return JSON.parse(response.text || '{}');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function requireObject(value, name) {
  assert(value && typeof value === 'object', `${name} must be an object`);
  return value;
}

function extractInvite(inviteResponse) {
  const invite = requireObject(inviteResponse?.invite, 'invite');
  const token = typeof invite.token === 'string' ? invite.token : '';
  const id = typeof invite.id === 'string' ? invite.id : '';
  assert(token && token.length < 256, 'invite token missing from response');
  assert(/^[a-f0-9]{40}$/.test(token), 'invite token is not compatible with the visitor subdomain router');
  assert(id, 'invite id missing from response');
  return { token, id };
}

function getSessionId(guestResponse) {
  const session = requireObject(guestResponse?.session, 'guest session');
  const id = typeof session.id === 'string' ? session.id : '';
  assert(id, 'guest session id missing');
  return id;
}

function findMessage(messages, senderType) {
  return Array.isArray(messages) && messages.some(message => message?.sender_type === senderType && typeof message?.content === 'string' && message.content.length > 0);
}

function countClientMessage(messages, clientMessageId) {
  return Array.isArray(messages)
    ? messages.filter(message => message?.client_message_id === clientMessageId).length
    : 0;
}

async function main() {
  const health = await request('/healthz');
  assert(health && health.ok === true, 'healthz did not return ok=true');
  logPass('healthz');

  const setupStatus = await request('/api/setup/status');
  assert(setupStatus && setupStatus.ok === true, 'setup status did not return ok=true');
  logPass('setup status');

  if (setupStatus.setupAvailable) {
    await request('/api/setup/initialize', {
      method: 'POST',
      body: {
        setupToken,
        username: adminUsername,
        password: adminPassword,
        confirmPassword: adminPassword,
        displayName: adminDisplayName,
      },
      expected: [201],
    });
    logPass('setup initialize local admin');
  } else {
    logInfo('setup already configured; skipping initialize');
  }

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { username: adminUsername, password: adminPassword },
    jar: adminJar,
  });
  assert(login?.admin?.role === 'SUPER_ADMIN', 'admin login did not return SUPER_ADMIN role');
  logPass('admin login');

  const me = await request('/api/auth/me', { jar: adminJar });
  assert(me?.admin?.role === 'SUPER_ADMIN', 'auth me did not return SUPER_ADMIN role');
  for (const forbidden of ['password_hash', 'passwordHash', 'token', 'sessionToken', 'cookie', 'secret']) {
    assert(!(forbidden in me.admin), `auth me leaked ${forbidden}`);
  }
  logPass('auth me');

  const inviteResponse = await request('/api/invites', { method: 'POST', body: {}, jar: adminJar, expected: [201] });
  const { token, id: inviteId } = extractInvite(inviteResponse);
  assert(inviteResponse.invite.mode === 'persistent_single_use', 'invite mode is not persistent_single_use');
  logPass('create persistent self-host invite');

  const invites = await request('/api/invites', { jar: adminJar });
  assert(Array.isArray(invites.invites) && invites.invites.some(invite => invite.id === inviteId), 'invite list missing created invite');
  logPass('list persistent invites');

  const guest = await request(`/api/guest/${encodeURIComponent(token)}`, { method: 'POST', body: {}, jar: visitorJar });
  const sessionId = getSessionId(guest);
  assert(guest.resumed === false, 'first invite consumption should not be resumed');
  assert(typeof guest.visitorId === 'string' && guest.visitorId.length > 0, 'visitor id missing');
  visitorJar.cookies.set('support_visitor', guest.visitorId);
  logPass('consume invite once');

  const rejectedSecondConsumer = await request(`/api/guest/${encodeURIComponent(token)}`, {
    method: 'POST',
    body: {},
    jar: secondVisitorJar,
    expected: [410],
  });
  assert(rejectedSecondConsumer?.error === 'invite_already_consumed', 'second browser was not rejected');
  logPass('reject second invite consumer');

  const resumed = await request(`/api/guest/${encodeURIComponent(token)}`, {
    method: 'POST',
    body: { visitorId: guest.visitorId },
    jar: visitorJar,
  });
  assert(resumed?.resumed === true && getSessionId(resumed) === sessionId, 'original visitor could not resume consumed invite');
  logPass('resume consumed invite in original browser');

  const revokeCandidateResponse = await request('/api/invites', { method: 'POST', body: {}, jar: adminJar, expected: [201] });
  const revokeCandidate = extractInvite(revokeCandidateResponse);
  await request(`/api/invites/${encodeURIComponent(revokeCandidate.id)}/revoke`, {
    method: 'POST',
    body: {},
    jar: adminJar,
  });
  const revokedGuest = await request(`/api/guest/${encodeURIComponent(revokeCandidate.token)}`, {
    method: 'POST',
    body: {},
    jar: new CookieJar(),
    expected: [404],
  });
  assert(revokedGuest?.error === 'invite_not_found', 'revoked invite remained consumable');
  logPass('revoke invite');

  const visitorSendBody = {
    sessionId,
    senderType: 'VISITOR',
    content: visitorMessage,
    visitorId: guest.visitorId,
    clientMessageId: visitorClientMessageId,
  };
  await request('/api/messages', {
    method: 'POST',
    body: visitorSendBody,
    jar: visitorJar,
    expected: [201],
  });
  const visitorRetry = await request('/api/messages', {
    method: 'POST',
    body: visitorSendBody,
    jar: visitorJar,
    expected: [200],
  });
  assert(visitorRetry?.deduped === true, 'visitor retry was not deduplicated');
  logPass('visitor text idempotency');

  const sessions = await request('/api/sessions', { jar: adminJar });
  assert(Array.isArray(sessions.sessions) && sessions.sessions.some(session => session.id === sessionId), 'admin session list missing visitor session');
  logPass('admin session list');

  const adminMessages = await request(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, { jar: adminJar });
  assert(findMessage(adminMessages.messages, 'VISITOR'), 'admin message list missing visitor message');
  assert(countClientMessage(adminMessages.messages, visitorClientMessageId) === 1, 'visitor idempotency created duplicate messages');
  logPass('admin reads visitor message');

  const adminSendBody = {
    sessionId,
    senderType: 'OPERATOR',
    content: adminMessage,
    clientMessageId: adminClientMessageId,
  };
  await request('/api/messages', {
    method: 'POST',
    body: adminSendBody,
    jar: adminJar,
    expected: [201],
  });
  const adminRetry = await request('/api/messages', {
    method: 'POST',
    body: adminSendBody,
    jar: adminJar,
    expected: [200],
  });
  assert(adminRetry?.deduped === true, 'admin retry was not deduplicated');
  logPass('admin text idempotency');

  const visitorMessages = await request(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, { jar: visitorJar });
  assert(findMessage(visitorMessages.messages, 'OPERATOR'), 'visitor message list missing admin reply');
  assert(countClientMessage(visitorMessages.messages, adminClientMessageId) === 1, 'admin idempotency created duplicate messages');
  logPass('visitor reads admin reply');

  const readTarget = await request('/api/messages', {
    method: 'POST',
    body: {
      sessionId,
      senderType: 'OPERATOR',
      content: `${adminMessage} read target`,
      clientMessageId: readTargetClientMessageId,
    },
    jar: adminJar,
    expected: [201],
  });
  const unreadControl = await request('/api/messages', {
    method: 'POST',
    body: {
      sessionId,
      senderType: 'OPERATOR',
      content: `${adminMessage} unread control`,
      clientMessageId: unreadControlClientMessageId,
    },
    jar: adminJar,
    expected: [201],
  });
  const readTargetId = readTarget?.message?.id;
  const unreadControlId = unreadControl?.message?.id;
  assert(typeof readTargetId === 'string' && typeof unreadControlId === 'string', 'read receipt test messages missing ids');

  const readReceipt = await request(`/api/sessions/${encodeURIComponent(sessionId)}/customer-read`, {
    method: 'POST',
    body: { messageIds: [readTargetId] },
    jar: visitorJar,
  });
  assert(
    readReceipt?.ok === true &&
      Array.isArray(readReceipt.messageIds) &&
      readReceipt.messageIds.length === 1 &&
      readReceipt.messageIds[0] === readTargetId &&
      !readReceipt.messageIds.includes(unreadControlId),
    'customer read receipt did not honor the requested message ids',
  );
  logPass('customer read receipt id filtering');

  await request('/api/auth/logout', { method: 'POST', jar: adminJar, expected: [204], skipJson: true });
  logPass('admin logout');

  console.log('Local self-host smoke passed.');
}

main().catch((error) => {
  console.error(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  console.error('No secrets, cookies, session ids, tokens, or message bodies were printed.');
  process.exit(1);
});
