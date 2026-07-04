import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createPostgresAdapter } from './db/postgres.js';
import { healthPayload } from './health.js';
import { describeLifecycleMigration } from './lifecycle.js';
import { getSetupStatus } from './setup.js';
import { createLocalStorage } from './storage/localStorage.js';
import { handleWebSocketUpgrade } from './websocket.js';

const config = loadConfig();
const db = createPostgresAdapter(config);
const storage = createLocalStorage(config.storagePath);
const staticRoot = path.resolve(config.staticDir || path.join(path.dirname(fileURLToPath(import.meta.url)), '../../dist'));

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(body);
}

function sendText(response: ServerResponse, status: number, body: string) {
  response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(body);
}

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

async function serveStatic(request: IncomingMessage, response: ServerResponse, url: URL) {
  const rawPath = decodeURIComponent(url.pathname);
  const relativePath = rawPath === '/' ? 'index.html' : rawPath.replace(/^\/+/, '');
  let filePath = path.resolve(staticRoot, relativePath);
  if (!filePath.startsWith(staticRoot + path.sep) && filePath !== staticRoot) {
    sendText(response, 403, 'Forbidden');
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
    response.writeHead(200, { 'content-type': contentType(filePath) });
    createReadStream(filePath).pipe(response);
  } catch {
    sendText(response, 404, 'Not found');
  }
}

async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  const host = request.headers.host || 'localhost';
  const url = new URL(request.url || '/', `http://${host}`);

  if (request.method === 'GET' && url.pathname === '/healthz') {
    sendJson(response, 200, {
      ...healthPayload(config),
      databaseConfigured: db.configured,
      lifecycle: describeLifecycleMigration(),
    });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/setup/status') {
    const status = await getSetupStatus(config, {
      hasAnyAdmin: async () => false,
    });
    sendJson(response, 200, status);
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    sendJson(response, 501, {
      ok: false,
      error: 'generic_server_api_not_implemented',
    });
    return;
  }

  await serveStatic(request, response, url);
}

await storage.ensureRoot();

const server = createServer((request, response) => {
  handleRequest(request, response).catch(() => {
    sendJson(response, 500, { ok: false, error: 'internal_error' });
  });
});

server.on('upgrade', handleWebSocketUpgrade);

server.listen(config.appPort, () => {
  console.log(`Generic customer chat server listening on port ${config.appPort}`);
});
