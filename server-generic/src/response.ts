import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, isHttpError } from './http.js';

const DEFAULT_BODY_LIMIT = 64 * 1024;
const SECURITY_HEADERS: Record<string, string> = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'x-robots-tag': 'noindex, nofollow, noarchive',
  'referrer-policy': 'no-referrer',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
};

export function applySecurityHeaders(response: ServerResponse) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.setHeader(name, value);
}

export function sendJson(response: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  response.end(body);
}

export function sendText(response: ServerResponse, status: number, body: string, headers: Record<string, string> = {}) {
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    ...headers,
  });
  response.end(body);
}

export function sendNoContent(response: ServerResponse, headers: Record<string, string> = {}) {
  response.writeHead(204, headers);
  response.end();
}

export function errorResponseBody(error: unknown) {
  if (isHttpError(error)) {
    return {
      status: error.status,
      body: { ok: false, error: error.code },
    };
  }
  return {
    status: 500,
    body: { ok: false, error: 'internal_error' },
  };
}

export function sendError(response: ServerResponse, error: unknown) {
  const payload = errorResponseBody(error);
  sendJson(response, payload.status, payload.body);
}

export async function readJsonBody<T = Record<string, unknown>>(request: IncomingMessage, limit = DEFAULT_BODY_LIMIT): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new HttpError(413, 'request_too_large');
    chunks.push(buffer);
  }

  if (chunks.length === 0) return {} as T;

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}
