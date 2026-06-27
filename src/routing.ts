export type AppMode =
  | { type: 'admin' }
  | { type: 'visitor'; token: string; source: 'long-token' | 'legacy-g' }
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

export function resolveAppMode(locationLike: Pick<Location, 'hostname' | 'pathname'>): AppMode {
  const hostname = locationLike.hostname.toLowerCase();
  const pathname = locationLike.pathname.replace(/\/+$/, '') || '/';
  const legacyGuest = pathname.match(/^\/g\/([^/]+)$/);

  if (legacyGuest) {
    const token = decodeSegment(legacyGuest[1]);
    return token ? { type: 'visitor', token, source: 'legacy-g' } : { type: 'not-found' };
  }

  if (pathname === '/' || pathname === '/admin') {
    if (isVisitorHost(hostname)) return { type: 'not-found' };
    return { type: 'admin' };
  }

  const shortLink = pathname.match(/^\/r\/([^/]+)$/);
  if (shortLink) {
    const code = decodeSegment(shortLink[1]);
    return code ? { type: 'reserved-short-link', code } : { type: 'not-found' };
  }

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
  return resolveAppMode(locationLike).type === 'admin';
}
