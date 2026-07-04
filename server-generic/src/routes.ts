export function matchSessionMessages(pathname: string, prefix: '/api/visitor' | '/api/admin'): string | null {
  const match = new RegExp(`^${prefix}/sessions/([^/]+)/messages$`).exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

export function matchAdminSessionClose(pathname: string): string | null {
  const match = /^\/api\/admin\/sessions\/([^/]+)\/close$/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : null;
}

export function isSafeId(value: string): boolean {
  return /^[A-Za-z0-9_.:@-]+$/.test(value) && value.length <= 128;
}
