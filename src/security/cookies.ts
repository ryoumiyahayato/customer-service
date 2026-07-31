export const COOKIE_NAMES = {
  admin: 'support_admin',
  visitor: 'visitor_account',
  guest: 'guest_session',
} as const;

export function readCookie(request: Request, name: string) {
  return (request.headers.get('cookie') || '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

export function serializeSessionCookie(name: string, value: string, maxAge = 86400) {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax; Secure`;
}

export function clearSessionCookie(name: string) {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`;
}
