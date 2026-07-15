#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertExperimentalPublicExposure, loadConfig } from '../dist/config.js';

const websocketSource = await readFile(new URL('../src/websocket.ts', import.meta.url), 'utf8');
const indexSource = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
const visitorSource = await readFile(new URL('../../src/visitor/GuestChat.tsx', import.meta.url), 'utf8');
const adminSource = await readFile(new URL('../../src/admin/AdminDashboard.tsx', import.meta.url), 'utf8');

const escapedConversationRoute = "/^\\/api\\/ws\\/conversations\\/";
assert.ok(websocketSource.includes(escapedConversationRoute));
assert.match(websocketSource, /requireCurrentAdmin/);
assert.match(websocketSource, /requireAdminSessionAccess/);
assert.match(websocketSource, /isSameOriginWebSocket/);
assert.match(websocketSource, /requireVisitorSession/);
assert.match(websocketSource, /VISITOR_COOKIE_NAME = 'support_visitor'/);
assert.match(websocketSource, /maxPayload: MAX_WEBSOCKET_MESSAGE_BYTES/);
assert.match(websocketSource, /socket\.on\('pong'/);
assert.match(websocketSource, /socket\.ping\(\)/);
assert.match(websocketSource, /client_messages_not_supported/);
assert.doesNotMatch(websocketSource, /type\s*===\s*['"]subscribe['"]/);
assert.doesNotMatch(websocketSource, /sessionId\s*=\s*message\.sessionId/);
assert.match(indexSource, /createWebSocketHub\(db\)/);
assert.match(indexSource, /assertExperimentalPublicExposure\(config\)/);
assert.match(visitorSource, /\/api\/ws\/conversations\/\$\{sid\}/);
assert.match(adminSource, /\/api\/ws\/conversations\/\$\{sid\}/);

const localConfig = loadConfig({
  NODE_ENV: 'production',
  APP_DOMAIN: '127.0.0.1',
  VISITOR_ROOT_DOMAIN: 'localhost',
  DATABASE_URL: '',
  ENCRYPTION_ENABLED: 'false',
});
assert.doesNotThrow(() => assertExperimentalPublicExposure(localConfig, { NODE_ENV: 'production' }));

const missingDomainConfig = loadConfig({
  NODE_ENV: 'production',
  APP_DOMAIN: '',
  VISITOR_ROOT_DOMAIN: '',
  DATABASE_URL: '',
  ENCRYPTION_ENABLED: 'false',
});
assert.throws(
  () => assertExperimentalPublicExposure(missingDomainConfig, { NODE_ENV: 'production' }),
  /required production domains are missing/,
);

const partiallyConfiguredDomain = loadConfig({
  NODE_ENV: 'production',
  APP_DOMAIN: '127.0.0.1',
  VISITOR_ROOT_DOMAIN: '',
  DATABASE_URL: '',
  ENCRYPTION_ENABLED: 'false',
});
assert.throws(
  () => assertExperimentalPublicExposure(partiallyConfiguredDomain, { NODE_ENV: 'production' }),
  /required production domains are missing/,
);

const blockedPublicConfig = loadConfig({
  NODE_ENV: 'production',
  APP_DOMAIN: 'admin.example.test',
  VISITOR_ROOT_DOMAIN: 'visitor.example.test',
  DATABASE_URL: '',
  ENCRYPTION_ENABLED: 'false',
});
assert.throws(
  () => assertExperimentalPublicExposure(blockedPublicConfig, { NODE_ENV: 'production' }),
  /server-generic public exposure is blocked/,
);

const acknowledgedPublicConfig = loadConfig({
  NODE_ENV: 'production',
  APP_DOMAIN: 'admin.example.test',
  VISITOR_ROOT_DOMAIN: 'visitor.example.test',
  DATABASE_URL: '',
  ENCRYPTION_ENABLED: 'false',
  SELF_HOST_EXPERIMENTAL_PUBLIC_ACK: 'I_UNDERSTAND_SERVER_GENERIC_IS_EXPERIMENTAL',
});
assert.doesNotThrow(() => assertExperimentalPublicExposure(acknowledgedPublicConfig, { NODE_ENV: 'production' }));

const acknowledgedMissingDomains = loadConfig({
  NODE_ENV: 'production',
  APP_DOMAIN: '',
  VISITOR_ROOT_DOMAIN: '',
  DATABASE_URL: '',
  ENCRYPTION_ENABLED: 'false',
  SELF_HOST_EXPERIMENTAL_PUBLIC_ACK: 'I_UNDERSTAND_SERVER_GENERIC_IS_EXPERIMENTAL',
});
assert.doesNotThrow(() => assertExperimentalPublicExposure(acknowledgedMissingDomains, { NODE_ENV: 'production' }));

console.log('server-generic websocket authentication and public exposure checks passed');
