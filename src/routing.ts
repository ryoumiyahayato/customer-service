import {
  DEFAULT_ADMIN_PUBLIC_HOST,
  DEFAULT_VISITOR_ROOT_DOMAIN,
  isAdminSurfaceHost,
  isLocalDevelopmentHost,
  isVisitorSurfaceHost,
  normalizePublicHost,
} from './domainIsolation';

export type AppMode =
  | { type: 'admin' }
  | { type: 'setup' }
  | { type: 'visitor'; token: string; source: 'long-token' | 'legacy-g' | 'subdomain' }
  | { type: 'reserved-short-link'; code: string }
  | { type: 'not-found' };

const ADMIN_HOSTS = new Set(
  ((import.meta.env.VITE_ADMIN_HOSTS as string | undefined) || DEFAULT_ADMIN_PUBLIC_HOST)
    .split(',')
    .map((host) => normalizePublicHost(host))
    .filter(Boolean),
);

const VISITOR_HOSTS = new Set(
  ((import.meta.env.VITE_VISITOR_HOSTS as string | undefined) || DEFAULT_VISITOR_ROOT_DOMAIN)
    .split(',')
    .map((host) => normalizePublicHost(host))
    .filter(Boolean),
);

const decodeSegment = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
};

function getVisitorRootDomain() {
  return normalizePublicHost(
    (import.meta.env.VITE_VISITOR_ROOT_DOMAIN as string | undefined) || DEFAULT_VISITOR_ROOT_DOMAIN,
  );
}

function isVisitorHost(hostname: string) {
  const host = normalizePublicHost(hostname);
  return VISITOR_HOSTS.has(host) || isVisitorSurfaceHost(host, getVisitorRootDomain());
}

function isAdminHost(hostname: string) {
  const host = normalizePublicHost(hostname);
  return ADMIN_HOSTS.has(host) || isAdminSurfaceHost(host, DEFAULT_ADMIN_PUBLIC_HOST);
}

const HEX_TOKEN_PATTERN = /^[a-f0-9]{40}$/;

function tryExtractSubdomainToken(hostname: string, rootDomain: string): string | null {
  if (hostname === rootDomain) return null;
  if (!hostname.endsWith('.' + rootDomain)) return null;
  const sub = hostname.slice(0, -(rootDomain.length + 1));
  if (sub.includes('.')) return null;
  if (!HEX_TOKEN_PATTERN.test(sub)) return null;
  return sub;
}

export function resolveAppMode(locationLike: Pick<Location, 'hostname' | 'pathname'>): AppMode {
  const hostname = normalizePublicHost(locationLike.hostname);
  const pathname = locationLike.pathname.replace(/\/+$/, '') || '/';
  const localDev = isLocalDevelopmentHost(hostname);
  const visitorHost = isVisitorHost(hostname);
  const adminHost = isAdminHost(hostname);

  // Visitor invites are never accepted on the admin hostname. Localhost remains usable for development.
  const legacyGuest = pathname.match(/^\/g\/([^/]+)$/);
  if (legacyGuest) {
    if (!visitorHost && !localDev) return { type: 'not-found' };
    const token = decodeSegment(legacyGuest[1]);
    return token ? { type: 'visitor', token, source: 'legacy-g' } : { type: 'not-found' };
  }

  // Legacy token-subdomain compatibility remains restricted to the visitor domain only.
  const visitorRootDomain = getVisitorRootDomain();
  if (visitorRootDomain && isVisitorSurfaceHost(hostname, visitorRootDomain)) {
    const subToken = tryExtractSubdomainToken(hostname, visitorRootDomain);
    if (subToken) {
      if (pathname !== '/') return { type: 'not-found' };
      return { type: 'visitor', token: subToken, source: 'subdomain' };
    }
    if (hostname === visitorRootDomain || hostname.endsWith('.' + visitorRootDomain)) {
      // The bare visitor domain must never fall through to the admin login surface.
      if (pathname === '/') return { type: 'not-found' };
    }
  }

  // Admin entry points are only valid on the configured admin hostname (or localhost during development).
  if (pathname === '/setup') {
    if (!adminHost && !localDev) return { type: 'not-found' };
    return { type: 'setup' };
  }

  if (pathname === '/' || pathname === '/admin') {
    if (!adminHost && !localDev) return { type: 'not-found' };
    return { type: 'admin' };
  }

  // Reserved short links are not permitted on the admin hostname.
  const shortLink = pathname.match(/^\/r\/([^/]+)$/);
  if (shortLink) {
    if (adminHost && !localDev) return { type: 'not-found' };
    const code = decodeSegment(shortLink[1]);
    return code ? { type: 'reserved-short-link', code } : { type: 'not-found' };
  }

  // Legacy visitor path-token mode is restricted to visitor hosts.
  if (visitorHost || localDev) {
    const longToken = pathname.match(/^\/([^/]+)$/);
    if (longToken) {
      const token = decodeSegment(longToken[1]);
      if (token && token !== 'admin' && token !== 'setup') return { type: 'visitor', token, source: 'long-token' };
    }
    return { type: 'not-found' };
  }

  return { type: 'not-found' };
}

export function isAdminMode(locationLike: Pick<Location, 'hostname' | 'pathname'> = window.location) {
  const mode = resolveAppMode(locationLike).type;
  return mode === 'admin' || mode === 'setup';
}
