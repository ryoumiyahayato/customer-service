import { prepareAttachmentFilenameForStorage } from '../dist/attachments.js';
import { loadConfig } from '../dist/config.js';
import {
  generateSessionToken,
  generateVisitorToken,
  hashPassword,
  hashSessionToken,
  hashVisitorToken,
  verifyPassword,
} from '../dist/crypto.js';
import { decryptText, encryptText } from '../dist/encryption.js';
import { FRONTEND_COMPAT_ROUTES, mapFrontendAdmin, mapFrontendMessage, mapFrontendSession } from '../dist/frontendCompat.js';
import { HttpError } from '../dist/http.js';
import { normalizeLifecycleOptions } from '../dist/lifecycle.js';
import { normalizeMessageBody, prepareMessageBodyForStorage } from '../dist/messages.js';
import { errorResponseBody } from '../dist/response.js';
import { getSetupStatus, initializeSetup } from '../dist/setup.js';
import { normalizeContentType } from '../dist/storage/contentType.js';
import { createLocalStorage } from '../dist/storage/localStorage.js';
import { generateAttachmentStorageKey, sanitizeDisplayFilename } from '../dist/storage/storageKeys.js';
import { createBroadcastPayload } from '../dist/websocket.js';

const config = loadConfig({
  ...process.env,
  APP_PORT: process.env.APP_PORT || '3000',
  DATABASE_URL: '',
  ENCRYPTION_ENABLED: 'false',
  ENCRYPTION_KEY: '',
  MAX_UPLOAD_SIZE: '1024',
  SETUP_TOKEN: '',
});

if (!Number.isFinite(config.appPort) || config.appPort <= 0) {
  throw new Error('config smoke failed');
}
if (config.maxUploadSize !== 1024) {
  throw new Error('max upload size config smoke failed');
}
if (config.encryption.enabled) {
  throw new Error('encryption disabled config smoke failed');
}

try {
  loadConfig({
    ...process.env,
    DATABASE_URL: '',
    ENCRYPTION_ENABLED: 'true',
    ENCRYPTION_KEY: '',
  });
  throw new Error('missing encryption key smoke failed');
} catch (error) {
  if (error instanceof Error && error.message === 'missing encryption key smoke failed') throw error;
}

const encryptionConfig = loadConfig({
  ...process.env,
  DATABASE_URL: '',
  ENCRYPTION_ENABLED: 'true',
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  ENCRYPTION_KEY_VERSION: 'smoke-v1',
}).encryption;

const encryptedText = encryptText('smoke-roundtrip-value', encryptionConfig);
if (
  encryptedText.algorithm !== 'AES-256-GCM' ||
  encryptedText.keyVersion !== 'smoke-v1' ||
  decryptText(encryptedText, encryptionConfig) !== 'smoke-roundtrip-value'
) {
  throw new Error('encryption roundtrip smoke failed');
}

try {
  decryptText({ ...encryptedText, tag: Buffer.alloc(16, 1).toString('base64') }, encryptionConfig);
  throw new Error('tampered encryption smoke failed');
} catch (error) {
  if (error instanceof Error && error.message === 'tampered encryption smoke failed') throw error;
}

const password = 'local-smoke-password-only';
const passwordHash = await hashPassword(password);
const passwordOk = await verifyPassword(password, passwordHash);
const passwordRejected = await verifyPassword('local-smoke-password-wrong', passwordHash);

if (!passwordOk || passwordRejected) {
  throw new Error('password hash smoke failed');
}

const sessionToken = generateSessionToken();
const sessionHash = hashSessionToken(sessionToken);
if (!sessionToken || !sessionHash || sessionToken === sessionHash) {
  throw new Error('session hash smoke failed');
}

const visitorToken = generateVisitorToken();
const visitorHash = hashVisitorToken(visitorToken);
if (!visitorToken || !visitorHash || visitorToken === visitorHash) {
  throw new Error('visitor hash smoke failed');
}

if (normalizeMessageBody(' hello ') !== 'hello') {
  throw new Error('message payload smoke failed');
}

const storedMessage = prepareMessageBodyForStorage('smoke-message-body', encryptionConfig);
if (
  storedMessage.body !== null ||
  !storedMessage.bodyCiphertext ||
  storedMessage.bodyKeyVersion !== 'smoke-v1'
) {
  throw new Error('message encryption payload smoke failed');
}

const displayName = sanitizeDisplayFilename('../unsafe name?.png');
if (displayName.includes('..') || displayName.includes('?') || displayName.includes('/')) {
  throw new Error('filename sanitize smoke failed');
}

const storedFilename = prepareAttachmentFilenameForStorage(displayName, encryptionConfig);
if (
  storedFilename.filename !== null ||
  !storedFilename.filenameCiphertext ||
  !storedFilename.filenameKeyVersion
) {
  throw new Error('attachment filename encryption smoke failed');
}

const storageKey = generateAttachmentStorageKey('image/png', new Date('2026-01-01T00:00:00Z'));
if (!storageKey.startsWith('attachments/2026/01/') || !storageKey.endsWith('.png')) {
  throw new Error('storage key smoke failed');
}

const storage = createLocalStorage('/tmp/server-generic-smoke-storage');
try {
  storage.resolveObjectPath('../escape');
  throw new Error('path traversal smoke failed');
} catch (error) {
  if (error instanceof Error && error.message === 'path traversal smoke failed') throw error;
}

if (normalizeContentType('application/x-unsafe') !== 'application/octet-stream') {
  throw new Error('content type smoke failed');
}

const lifecycleOptions = normalizeLifecycleOptions({ dryRun: true, limitArchive: 200, limitClearHistory: 0 });
if (!lifecycleOptions.dryRun || lifecycleOptions.limitArchive !== 100 || lifecycleOptions.limitClearHistory !== 1) {
  throw new Error('lifecycle dry-run options smoke failed');
}

const response = errorResponseBody(new HttpError(401, 'smoke_error'));
if (response.status !== 401 || response.body.error !== 'smoke_error') {
  throw new Error('response helper smoke failed');
}

const setupQueries = [];
const emptyAdminDb = {
  async query(sql, params) {
    setupQueries.push({ sql, params });
    if (sql.includes('COUNT(*)::text AS count FROM admins')) return [{ count: '0' }];
    throw new Error('setup smoke should not write without SETUP_TOKEN');
  },
};
const missingTokenSetupStatus = await getSetupStatus({ ...config, setupToken: '' }, emptyAdminDb);
if (
  missingTokenSetupStatus.setupAvailable ||
  !missingTokenSetupStatus.requiresSetupToken ||
  missingTokenSetupStatus.reason !== 'missing_setup_token'
) {
  throw new Error('setup missing token status smoke failed');
}

try {
  await initializeSetup({ ...config, setupToken: '' }, emptyAdminDb, {
    username: 'smoke-admin',
    password: 'local-smoke-password-only',
    confirmPassword: 'local-smoke-password-only',
  });
  throw new Error('setup missing token initialize smoke failed');
} catch (error) {
  if (error instanceof Error && error.message === 'setup missing token initialize smoke failed') throw error;
  if (!(error instanceof HttpError) || error.status !== 403 || error.code !== 'missing_setup_token') {
    throw new Error('setup missing token initialize error smoke failed');
  }
}
if (setupQueries.some(({ sql }) => sql.includes('INSERT INTO admins'))) {
  throw new Error('setup missing token wrote admin smoke failed');
}

const setupWriteQueries = [];
const setupWriteDb = {
  async query(sql, params) {
    setupWriteQueries.push({ sql, params });
    if (sql.includes('COUNT(*)::text AS count FROM admins')) return [{ count: '0' }];
    if (sql.includes('INSERT INTO admins')) {
      return [{
        id: '00000000-0000-0000-0000-000000000001',
        username: params[0],
        email: params[1],
        display_name: params[2],
        role: 'SUPER_ADMIN',
        created_at: new Date('2026-01-01T00:00:00Z'),
      }];
    }
    throw new Error(`unexpected setup write sql: ${sql}`);
  },
};
const setupResult = await initializeSetup({ ...config, setupToken: 'setup-token' }, setupWriteDb, {
  setupToken: 'setup-token',
  username: 'smoke-admin',
  password: 'local-smoke-password-only',
  confirmPassword: 'local-smoke-password-only',
});
if (setupResult.admin.role !== 'SUPER_ADMIN' || !setupWriteQueries.some(({ sql }) => sql.includes("'SUPER_ADMIN'"))) {
  throw new Error('setup first admin SUPER_ADMIN smoke failed');
}

const compatRoutes = new Set(FRONTEND_COMPAT_ROUTES);
for (const route of [
  'POST /api/auth/login',
  'POST /api/auth/logout',
  'GET /api/auth/me',
  'GET /api/sessions',
  'GET /api/sessions/:id/messages',
  'POST /api/messages',
  'POST /api/guest/:token',
]) {
  if (!compatRoutes.has(route)) throw new Error(`frontend compat route missing: ${route}`);
}

const frontendAdmin = mapFrontendAdmin({
  id: '00000000-0000-0000-0000-000000000001',
  username: 'smoke-admin',
  email: 'smoke-admin@example.com',
  displayName: 'Smoke Admin',
  role: 'SUPER_ADMIN',
  createdAt: '2026-01-01T00:00:00.000Z',
});
if (
  frontendAdmin.id !== '00000000-0000-0000-0000-000000000001' ||
  frontendAdmin.username !== 'smoke-admin' ||
  frontendAdmin.role !== 'SUPER_ADMIN' ||
  frontendAdmin.display_name !== 'Smoke Admin' ||
  frontendAdmin.created_at !== '2026-01-01T00:00:00.000Z' ||
  !('updated_at' in frontendAdmin)
) {
  throw new Error('frontend admin auth me mapping smoke failed');
}
for (const forbiddenField of ['password_hash', 'passwordHash', 'token', 'sessionToken', 'cookie', 'secret']) {
  if (forbiddenField in frontendAdmin) throw new Error(`frontend admin leaked field: ${forbiddenField}`);
}

const frontendSession = mapFrontendSession({
  id: '00000000-0000-0000-0000-000000000010',
  status: 'open',
  customerName: 'smoke customer',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  closedAt: null,
  archivedAt: null,
  deletedAt: null,
  historyClearedAt: null,
});
if (!('created_at' in frontendSession) || !('updated_at' in frontendSession) || !('unread_count' in frontendSession)) {
  throw new Error('frontend session snake_case smoke failed');
}

const frontendMessage = mapFrontendMessage({
  id: '00000000-0000-0000-0000-000000000020',
  sessionId: frontendSession.id,
  senderType: 'admin',
  senderId: '00000000-0000-0000-0000-000000000001',
  body: 'hello visitor',
  messageType: 'text',
  readAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  attachments: [],
}, 'client-smoke-id');
if (
  frontendMessage.session_id !== frontendSession.id ||
  frontendMessage.sender_type !== 'OPERATOR' ||
  frontendMessage.content !== 'hello visitor' ||
  frontendMessage.message_type !== 'text' ||
  frontendMessage.created_at !== '2026-01-01T00:00:00.000Z' ||
  frontendMessage.client_message_id !== 'client-smoke-id'
) {
  throw new Error('frontend message snake_case smoke failed');
}

const broadcast = createBroadcastPayload({
  type: 'session_closed',
  sessionId: 'smoke-session',
  session: {
    id: 'smoke-session',
    status: 'closed',
    customerName: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    closedAt: '2026-01-01T00:00:00.000Z',
    archivedAt: null,
    deletedAt: null,
    historyClearedAt: null,
  },
});
if (!broadcast.includes('session_closed') || broadcast.includes(visitorToken)) {
  throw new Error('websocket broadcast smoke failed');
}

console.log('server-generic smoke passed: config, password hash, session hash, visitor hash, response helper, setup fail-closed, first admin SUPER_ADMIN, encryption helpers, message payload, storage helpers, lifecycle options, frontend auth me/session/message compatibility mapping, websocket payload');
