import { loadConfig } from '../dist/config.js';
import {
  generateSessionToken,
  generateVisitorToken,
  hashPassword,
  hashSessionToken,
  hashVisitorToken,
  verifyPassword,
} from '../dist/crypto.js';
import { HttpError } from '../dist/http.js';
import { normalizeLifecycleOptions } from '../dist/lifecycle.js';
import { normalizeMessageBody } from '../dist/messages.js';
import { errorResponseBody } from '../dist/response.js';
import { normalizeContentType } from '../dist/storage/contentType.js';
import { createLocalStorage } from '../dist/storage/localStorage.js';
import { generateAttachmentStorageKey, sanitizeDisplayFilename } from '../dist/storage/storageKeys.js';
import { createBroadcastPayload } from '../dist/websocket.js';

const config = loadConfig({
  ...process.env,
  APP_PORT: process.env.APP_PORT || '3000',
  DATABASE_URL: '',
  MAX_UPLOAD_SIZE: '1024',
  SETUP_TOKEN: '',
});

if (!Number.isFinite(config.appPort) || config.appPort <= 0) {
  throw new Error('config smoke failed');
}
if (config.maxUploadSize !== 1024) {
  throw new Error('max upload size config smoke failed');
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

const displayName = sanitizeDisplayFilename('../unsafe name?.png');
if (displayName.includes('..') || displayName.includes('?') || displayName.includes('/')) {
  throw new Error('filename sanitize smoke failed');
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

console.log('server-generic smoke passed: config, password hash, session hash, visitor hash, response helper, message payload, storage helpers, lifecycle options, websocket payload');
