export type AppMode =
  | { type: 'admin' }
  | { type: 'setup' }
  | { type: 'visitor'; token: string; source: 'long-token' | 'legacy-g' | 'subdomain' }
  | { type: 'reserved-short-link'; code: string }
  | { type: 'not-found' };

const ADMIN_HOSTS = new Set(
  ((import.meta.env.VITE_ADMIN_HOSTS as string | undefined) || 'denglu.kefuxitong.net')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
);

const VISITOR_HOSTS = new Set(
  ((import.meta.env.VITE_VISITOR_HOSTS as string | undefined) || '')
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
);

const decodeSegment = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
};

function isVisitorHost(hostname: string) {
  return VISITOR_HOSTS.has(hostname.toLowerCase());
}

function isAdminHost(hostname: string) {
  return ADMIN_HOSTS.has(hostname.toLowerCase());
}

const HEX_TOKEN_PATTERN = /^[a-f0-9]{40}$/;

function getVisitorRootDomain() {
  return ((import.meta.env.VITE_VISITOR_ROOT_DOMAIN as string | undefined) || '').trim().toLowerCase();
}

function tryExtractSubdomainToken(hostname: string, rootDomain: string): string | null {
  // Exact match: vx9qn7zr.org -> no subdomain
  if (hostname === rootDomain) return null;
  // Must end with .vx9qn7zr.org
  if (!hostname.endsWith('.' + rootDomain)) return null;
  const sub = hostname.slice(0, -(rootDomain.length + 1));
  // Must be a single label (no inner dots)
  if (sub.includes('.')) return null;
  // Strict hex token validation
  if (!HEX_TOKEN_PATTERN.test(sub)) return null;
  return sub;
}

export function resolveAppMode(locationLike: Pick<Location, 'hostname' | 'pathname'>): AppMode {
  const hostname = locationLike.hostname.toLowerCase();
  const pathname = locationLike.pathname.replace(/\/+$/, '') || '/';

  // 1. Legacy /g/<token> - compatible on any host (including admin host)
  const legacyGuest = pathname.match(/^\/g\/([^/]+)$/);
  if (legacyGuest) {
    const token = decodeSegment(legacyGuest[1]);
    return token ? { type: 'visitor', token, source: 'legacy-g' } : { type: 'not-found' };
  }

  // 2. Token subdomain visitor entry: <token>.vx9qn7zr.org
  const visitorRootDomain = getVisitorRootDomain();
  if (visitorRootDomain) {
    const subToken = tryExtractSubdomainToken(hostname, visitorRootDomain);
    if (subToken) {
      // Path must be exactly /
      if (pathname !== '/') return { type: 'not-found' };
      return { type: 'visitor', token: subToken, source: 'subdomain' };
    }
    // Hostname is root domain or subdomain-related but invalid -> not-found
    if (hostname === visitorRootDomain || hostname.endsWith('.' + visitorRootDomain)) {
      return { type: 'not-found' };
    }
  }

  // 3. Admin host routing
  if (pathname === '/setup') {
    if (isVisitorHost(hostname)) return { type: 'not-found' };
    return { type: 'setup' };
  }

  if (pathname === '/' || pathname === '/admin') {
    if (isVisitorHost(hostname)) return { type: 'not-found' };
    return { type: 'admin' };
  }

  // 4. Reserved short links
  const shortLink = pathname.match(/^\/r\/([^/]+)$/);
  if (shortLink) {
    const code = decodeSegment(shortLink[1]);
    return code ? { type: 'reserved-short-link', code } : { type: 'not-found' };
  }

  // 5. Legacy visitor host with path token (VITE_VISITOR_HOSTS)
  if (isVisitorHost(hostname)) {
    const longToken = pathname.match(/^\/([^/]+)$/);
    if (longToken) {
      const token = decodeSegment(longToken[1]);
      if (token && token !== 'admin') return { type: 'visitor', token, source: 'long-token' };
    }
    return { type: 'not-found' };
  }

  if (isAdminHost(hostname)) return { type: 'not-found' };
  return { type: 'not-found' };
}

export function isAdminMode(locationLike: Pick<Location, 'hostname' | 'pathname'> = window.location) {
  const mode = resolveAppMode(locationLike).type;
  return mode === 'admin' || mode === 'setup';
}
