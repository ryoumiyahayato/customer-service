import type { GenericServerConfig } from './config.js';

export const ADMIN_COOKIE_NAME = 'support_admin';

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
