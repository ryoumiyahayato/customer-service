import { isLocalDevelopmentHost } from '../domainIsolation';

function sameOrigin(value: string, expectedOrigin: string) {
  try {
    return new URL(value).origin === expectedOrigin;
  } catch {
    return false;
  }
}

export function isSameOriginRequest(req: Request, allowLocalWithoutHeaders = true) {
  const url = new URL(req.url);
  const origin = req.headers.get('origin');
  if (origin) return sameOrigin(origin, url.origin);
  const referer = req.headers.get('referer');
  if (referer) return sameOrigin(referer, url.origin);
  if (!allowLocalWithoutHeaders) return false;
  return isLocalDevelopmentHost(url.hostname) || isLocalDevelopmentHost(req.headers.get('host') || '');
}

export function isSameOriginWrite(req: Request) {
  return isSameOriginRequest(req, true);
}

export function isSameOriginWebSocket(req: Request) {
  return isSameOriginRequest(req, true);
}
