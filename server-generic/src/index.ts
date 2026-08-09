import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  abuseSessionPart,
  abuseUsernamePart,
  createAbuseGuard,
  sendRateLimitResponse,
} from './abuseGuard.js';
import {
  handleAdminAttachmentDownload,
  handleAdminMessages,
  handleAdminRead,
  handleAdminSessionLifecycleAction,
  handleCloseAdminSession,
  handleListAdminSessions,
} from './adminApi.js';
import { loginAdmin, logoutAdmin, requireCurrentAdmin } from './auth.js';
import { assertExperimentalPublicExposure, loadConfig } from './config.js';
import { createPostgresAdapter } from './db/postgres.js';
import { handleFrontendCompatRequest } from './frontendCompat.js';
import { HttpError } from './http.js';
import { applySecurityHeaders, readJsonBody, sendError, sendJson, sendNoContent, sendText } from './response.js';
import {
  matchAdminAttachmentDownload,
  matchAdminSessionAction,
  matchAdminSessionClose,
  matchSessionMessages,
  matchSessionRead,
  matchVisitorAttachmentDownload,
  matchVisitorSessionAttachments,
} from './routes.js';
import { getAdminSessionToken, isSameOriginWrite, serializeAdminSessionCookie, serializeClearAdminSessionCookie } from './security.js';
import { getSetupStatus, initializeSetup } from './setup.js';
import { createLocalStorage } from './storage/localStorage.js';
import {
  handleCreateVisitorAttachment,
  handleCreateVisitorSession,
  handleVisitorAttachmentDownload,
  handleVisitorMessages,
  handleVisitorRead,
} from './visitorApi.js';
import { createWebSocketHub } from './websocket.js';

const config = loadConfig();
assertExperimentalPublicExposure(config);
const db = createPostgresAdapter(config);
const storage = createLocalStorage(config.storagePath);
const websocketHub = createWebSocketHub(db);
const abuseGuard = createAbuseGuard(config);
const staticRoot = path.resolve(config.staticDir || path.join(path.dirname(fileURLToPath(import.meta.url)), '../../dist'));

function contentType(filePath: string) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.webp')) return 'image/webp';
  return 'application/octet-stream';
}

function enforceAbuseLimit(response: ServerResponse, decision: ReturnType<typeof abuseGuard.check>) {
  if (decision.allowed) return false;
  sendRateLimitResponse(response, decision);
  return true;
}

function enforceMessageAbuseLimits(request: IncomingMessage, response: ServerResponse, sessionId: string) {
  if (enforceAbuseLimit(response, abuseGuard.check(request, 'message_ip'))) return true;
  return enforceAbuseLimit(response, abuseGuard.check(request, 'message_session', [abuseSessionPart(sessionId)]));
}

function isStateChangingMethod(method: string | undefined) {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method || '').toUpperCase());
}

async function serveStatic(response: ServerResponse, url: URL) {
  let rawPath: string;
  try {
    rawPath = decodeURIComponent(url.pathname);
  } catch {
    sendText(response, 400, 'Bad request', { 'cache-control': 'no-store' });
    return;
  }
  const relativePath = rawPath === '/' ? 'index.html' : rawPath.replace(/^\/+/, '');
  let filePath = path.resolve(staticRoot, relativePath);
  if (!filePath.startsWith(staticRoot + path.sep) && filePath !== staticRoot) {
    sendText(response, 403, 'Forbidden', { 'cache-control': 'no-store' });
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    filePath = path.join(staticRoot, 'index.html');
  }

  try {
    await stat(filePath);
    const type = contentType(filePath);
    response.writeHead(200, {
      'content-type': type,
      ...(type.startsWith('text/html') ? { 'cache-control': 'no-store' } : {}),
    });
    createReadStream(filePath).pipe(response);
  } catch {
    sendText(response, 404, 'Not found', { 'cache-control': 'no-store' });
  }
}

async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  applySecurityHeaders(response);
  const host = request.headers.host || 'localhost';
  const url = new URL(request.url || '/', `http://${host}`);

  if (url.pathname.startsWith('/api/') && isStateChangingMethod(request.method) && !isSameOriginWrite(request)) {
    throw new HttpError(403, 'forbidden');
  }

  if (request.method === 'GET' && url.pathname === '/healthz') {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/setup/status') {
    const status = await getSetupStatus(config, db);
    sendJson(response, 200, status);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/setup/initialize') {
    if (enforceAbuseLimit(response, abuseGuard.check(request, 'setup_initialize'))) return;
    const body = await readJsonBody<Record<string, unknown>>(request);
    const result = await initializeSetup(config, db, body);
    sendJson(response, 201, result);
    return;
  }

  if (await handleFrontendCompatRequest(request, response, url, { config, db, hub: websocketHub, abuseGuard })) {
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/admin/login') {
    const body = await readJsonBody<Record<string, unknown>>(request);
    if (enforceAbuseLimit(response, abuseGuard.check(request, 'admin_login', [abuseUsernamePart(body)]))) return;
    const result = await loginAdmin(config, db, body);
    sendJson(
      response,
      200,
      {
        ok: true,
        admin: result.admin,
      },
      { 'set-cookie': serializeAdminSessionCookie(result.session.token, config) },
    );
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/admin/logout') {
    await logoutAdmin(db, getAdminSessionToken(request.headers.cookie));
    sendNoContent(response, { 'set-cookie': serializeClearAdminSessionCookie() });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/auth/me') {
    const admin = await requireCurrentAdmin(db, getAdminSessionToken(request.headers.cookie));
    sendJson(response, 200, { ok: true, admin });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/visitor/sessions') {
    if (enforceAbuseLimit(response, abuseGuard.check(request, 'guest_bootstrap'))) return;
    await handleCreateVisitorSession(request, response, db);
    return;
  }

  const visitorAttachmentSessionId = matchVisitorSessionAttachments(url.pathname);
  if (request.method === 'POST' && visitorAttachmentSessionId) {
    if (enforceAbuseLimit(response, abuseGuard.check(request, 'upload', [abuseSessionPart(visitorAttachmentSessionId)]))) return;
    await handleCreateVisitorAttachment(config, request, response, db, storage, websocketHub, url, visitorAttachmentSessionId);
    return;
  }

  const visitorAttachmentDownload = matchVisitorAttachmentDownload(url.pathname);
  if (request.method === 'GET' && visitorAttachmentDownload) {
    await handleVisitorAttachmentDownload(
      request,
      response,
      config,
      db,
      storage,
      visitorAttachmentDownload.sessionId,
      visitorAttachmentDownload.attachmentId,
    );
    return;
  }

  const visitorMessagesSessionId = matchSessionMessages(url.pathname, '/api/visitor');
  if (visitorMessagesSessionId) {
    if (request.method === 'POST' && enforceMessageAbuseLimits(request, response, visitorMessagesSessionId)) return;
    await handleVisitorMessages(request, response, config, db, websocketHub, visitorMessagesSessionId);
    return;
  }
  const visitorReadSessionId = matchSessionRead(url.pathname, '/api/visitor');
  if (request.method === 'POST' && visitorReadSessionId) {
    if (enforceMessageAbuseLimits(request, response, visitorReadSessionId)) return;
    await handleVisitorRead(request, response, db, websocketHub, visitorReadSessionId);
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/admin/sessions') {
    await handleListAdminSessions(request, response, db);
    return;
  }

  const adminAttachmentId = matchAdminAttachmentDownload(url.pathname);
  if (request.method === 'GET' && adminAttachmentId) {
    await handleAdminAttachmentDownload(request, response, config, db, storage, adminAttachmentId);
    return;
  }

  const adminMessagesSessionId = matchSessionMessages(url.pathname, '/api/admin');
  if (adminMessagesSessionId) {
    if (request.method === 'POST' && enforceMessageAbuseLimits(request, response, adminMessagesSessionId)) return;
    await handleAdminMessages(request, response, config, db, websocketHub, adminMessagesSessionId);
    return;
  }
  const adminReadSessionId = matchSessionRead(url.pathname, '/api/admin');
  if (request.method === 'POST' && adminReadSessionId) {
    if (enforceMessageAbuseLimits(request, response, adminReadSessionId)) return;
    await handleAdminRead(request, response, db, websocketHub, adminReadSessionId);
    return;
  }

  const closeSessionId = matchAdminSessionClose(url.pathname);
  if (request.method === 'POST' && closeSessionId) {
    await handleCloseAdminSession(request, response, db, websocketHub, closeSessionId);
    return;
  }

  const adminSessionAction = matchAdminSessionAction(url.pathname);
  if (request.method === 'POST' && adminSessionAction) {
    await handleAdminSessionLifecycleAction(
      request,
      response,
      db,
      storage,
      adminSessionAction.sessionId,
      adminSessionAction.action,
    );
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    sendJson(response, 501, {
      ok: false,
      error: 'generic_server_api_not_implemented',
    });
    return;
  }

  await serveStatic(response, url);
}

await storage.ensureRoot();

const server = createServer((request, response) => {
  handleRequest(request, response).catch((error: unknown) => {
    sendError(response, error);
  });
});

server.on('upgrade', (request, socket, head) => {
  void websocketHub.handleUpgrade(request, socket, head).catch(() => {
    if (!socket.destroyed) socket.destroy();
  });
});

server.listen(config.appPort, config.bindHost, () => {
  console.log(`Generic customer chat server listening on ${config.bindHost}:${config.appPort}`);
});
