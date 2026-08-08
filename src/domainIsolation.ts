export const DEFAULT_ADMIN_PUBLIC_HOST = 'denglu.kefuxitong.net';
export const DEFAULT_VISITOR_ROOT_DOMAIN = 'vx9qn7zr.org';
const HEX_TOKEN_PATTERN = /^[a-f0-9]{40}$/i;

export function normalizePublicHost(value: string | undefined | null) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  try {
    if (raw.includes('://')) return new URL(raw).hostname.toLowerCase().replace(/^\.+|\.+$/g, '');
  } catch {
    return '';
  }
  const host = raw.split('/')[0].replace(/^\.+|\.+$/g, '');
  if (!host) return '';
  if (host.startsWith('[')) return host.slice(1).split(']')[0];
  if (host.indexOf(':') === host.lastIndexOf(':') && host.includes(':')) return host.slice(0, host.lastIndexOf(':'));
  return host;
}

export function isLocalDevelopmentHost(value: string | undefined | null) {
  const host = normalizePublicHost(value);
  return host === 'localhost'
    || host.endsWith('.localhost')
    || host === '127.0.0.1'
    || host === '0.0.0.0'
    || host === '::1';
}

export function extractVisitorSubdomainToken(hostname: string, visitorRootDomain = DEFAULT_VISITOR_ROOT_DOMAIN) {
  const host = normalizePublicHost(hostname);
  const root = normalizePublicHost(visitorRootDomain);
  if (!host || !root || host === root || !host.endsWith(`.${root}`)) return '';
  const label = host.slice(0, -(root.length + 1));
  if (!label || label.includes('.') || !HEX_TOKEN_PATTERN.test(label)) return '';
  return label.toLowerCase();
}

export function isVisitorSurfaceHost(hostname: string, visitorRootDomain = DEFAULT_VISITOR_ROOT_DOMAIN) {
  return Boolean(extractVisitorSubdomainToken(hostname, visitorRootDomain));
}

export function isAdminSurfaceHost(hostname: string, adminPublicHost = DEFAULT_ADMIN_PUBLIC_HOST) {
  const host = normalizePublicHost(hostname);
  const admin = normalizePublicHost(adminPublicHost);
  return Boolean(host && admin && host === admin);
}

export function buildVisitorInviteUrl(token: string, visitorRootDomain = DEFAULT_VISITOR_ROOT_DOMAIN) {
  const root = normalizePublicHost(visitorRootDomain);
  const normalizedToken = String(token || '').trim().toLowerCase();
  if (!root) throw new Error('visitor_root_domain_missing');
  if (!HEX_TOKEN_PATTERN.test(normalizedToken)) throw new Error('invalid_invite_token');
  return `https://${normalizedToken}.${root}/`;
}
