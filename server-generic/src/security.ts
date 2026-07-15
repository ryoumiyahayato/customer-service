import type { IncomingMessage } from 'node:http';
import type { GenericServerConfig } from './config.js';

export const ADMIN_COOKIE_NAME = 'support_admin';
const AMBIENT_COOKIE_NAMES = [ADMIN_COOKIE_NAME, 'support_visitor'];

function localHost(host: string) {
  let normalized = host.toLowerCase();
  if (normalized.startsWith('[')) normalized = normalized.slice(1).split(']')[0];
  else if (normalized.indexOf(':') === normalized.lastIndexOf(':') && normalized.includes(':')) {
    normalized = normalized.slice(0, normalized.lastIndexOf(':'));
  }
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function expectedOrigin(request: IncomingMessage) {
  const host = request.headers.host || 'localhost';
  const forwarded = request.headers['x-forwarded-proto'];
  const rawProtocol = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const protocol = rawProtocol?.split(',')[0]?.trim() || (localHost(host) ? 'http' : 'https');
  return `${protocol}://${host}`;
}

function sameOrigin(value: string, expected: string) {
  try {
    return new URL(value).origin === expected;
  } catch {
    return false;
  }
}

export function isSameOriginWrite(request: IncomingMessage): boolean {
  const origin = Array.isArray(request.headers.origin) ? request.headers.origin[0] : request.headers.origin;
  const expected = expectedOrigin(request);
  if (origin) return sameOrigin(origin, expected);
  const referer = Array.isArray(request.headers.referer) ? request.headers.referer[0] : request.headers.referer;
  if (referer) return sameOrigin(referer, expected);

  const cookies = parseCookies(request.headers.cookie);
  const hasAmbientCredentials = AMBIENT_COOKIE_NAMES.some((name) => cookies.has(name));
  return !hasAmbientCredentials || localHost(request.headers.host || 'localhost');
}

export function isSameOriginWebSocket(request: IncomingMessage): boolean {
  const origin = Array.isArray(request.headers.origin) ? request.headers.origin[0] : request.headers.origin;
  if (origin) return sameOrigin(origin, expectedOrigin(request));
  return localHost(request.headers.host || 'localhost');
}

export function parseCookies(header: string | string[] | undefined): Map<string, string> {
  const raw = Array.isArray(header) ? header.join(';') : header;
  const cookies = new Map<string, string>();
  if (!raw) return cookies;

  for (const part of raw.split(';')) {
    const [name, ...valueParts] = part.trim().split('=');
    if (!name || valueParts.length === 0) continue;
    cookies.set(name, decodeURIComponent(valueParts.join('=')));
  }

  return cookies;
}

export function getAdminSessionToken(cookieHeader: string | string[] | undefined): string | null {
  return parseCookies(cookieHeader).get(ADMIN_COOKIE_NAME) || null;
}

export function getBearerToken(header: string | string[] | undefined): string | null {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return null;
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match?.[1] || null;
}

export function getVisitorToken(headers: Record<string, string | string[] | undefined>): string | null {
  const explicit = headers['x-visitor-token'];
  if (Array.isArray(explicit)) return explicit[0] || null;
  if (explicit) return explicit;
  return getBearerToken(headers.authorization);
}

function isProductionCookie() {
  return process.env.NODE_ENV === 'production';
}

export function serializeAdminSessionCookie(token: string, config: GenericServerConfig) {
  const parts = [
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${config.adminSessionTtl}`,
  ];
  if (isProductionCookie()) parts.push('Secure');
  return parts.join('; ');
}

export function serializeClearAdminSessionCookie() {
  const parts = [
    `${ADMIN_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (isProductionCookie()) parts.push('Secure');
  return parts.join('; ');
}
