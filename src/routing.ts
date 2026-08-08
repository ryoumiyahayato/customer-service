import {
  DEFAULT_ADMIN_PUBLIC_HOST,
  DEFAULT_VISITOR_ROOT_DOMAIN,
  extractVisitorSubdomainToken,
  isAdminSurfaceHost,
  isLocalDevelopmentHost,
  normalizePublicHost,
} from './domainIsolation';

export type AppMode =
  | { type: 'admin' }
  | { type: 'setup' }
  | { type: 'visitor'; token: string; source: 'subdomain' }
  | { type: 'reserved-short-link'; code: string }
  | { type: 'not-found' };

const ADMIN_HOSTS = new Set(
  ((import.meta.env.VITE_ADMIN_HOSTS as string | undefined) || DEFAULT_ADMIN_PUBLIC_HOST)
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

function isAdminHost(hostname: string) {
  const host = normalizePublicHost(hostname);
  return ADMIN_HOSTS.has(host) || isAdminSurfaceHost(host, DEFAULT_ADMIN_PUBLIC_HOST);
}

export function resolveAppMode(locationLike: Pick<Location, 'hostname' | 'pathname'>): AppMode {
  const hostname = normalizePublicHost(locationLike.hostname);
  const pathname = locationLike.pathname.replace(/\/+$/, '') || '/';
  const localDev = isLocalDevelopmentHost(hostname);
  const adminHost = isAdminHost(hostname);
  const visitorRootDomain = getVisitorRootDomain();
  const subdomainToken = visitorRootDomain
    ? extractVisitorSubdomainToken(hostname, visitorRootDomain)
    : '';

  if (subdomainToken) {
    if (pathname !== '/') return { type: 'not-found' };
    return { type: 'visitor', token: subdomainToken, source: 'subdomain' };
  }

  if (visitorRootDomain && (hostname === visitorRootDomain || hostname.endsWith(`.${visitorRootDomain}`))) {
    return { type: 'not-found' };
  }

  if (pathname === '/setup') {
    if (!adminHost && !localDev) return { type: 'not-found' };
    return { type: 'setup' };
  }

  if (pathname === '/' || pathname === '/admin') {
    if (!adminHost && !localDev) return { type: 'not-found' };
    return { type: 'admin' };
  }

  const shortLink = pathname.match(/^\/r\/([^/]+)$/);
  if (shortLink) {
    if (adminHost && !localDev) return { type: 'not-found' };
    const code = decodeSegment(shortLink[1]);
    return code ? { type: 'reserved-short-link', code } : { type: 'not-found' };
  }

  return { type: 'not-found' };
}

export function isAdminMode(locationLike: Pick<Location, 'hostname' | 'pathname'> = window.location) {
  const mode = resolveAppMode(locationLike).type;
  return mode === 'admin' || mode === 'setup';
}
