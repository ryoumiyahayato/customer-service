export type SessionClientMetadata = {
  deviceLabel: string;
  approximateLocation: string;
  capturedAt: string;
};

type RequestCfLocation = {
  city?: unknown;
  region?: unknown;
  country?: unknown;
};

const META_PREFIX = 'session_client_meta:';

function cleanPart(value: unknown, maxLength = 80) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function browserLabel(userAgent: string) {
  const wechat = userAgent.match(/MicroMessenger\/([\d.]+)/i);
  if (wechat) return `微信 ${wechat[1]}`;
  const edge = userAgent.match(/(?:EdgA|EdgiOS|Edg)\/([\d.]+)/i);
  if (edge) return `Edge ${edge[1]}`;
  const firefox = userAgent.match(/(?:Firefox|FxiOS)\/([\d.]+)/i);
  if (firefox) return `Firefox ${firefox[1]}`;
  const chrome = userAgent.match(/(?:Chrome|CriOS)\/([\d.]+)/i);
  if (chrome) return `Chrome ${chrome[1]}`;
  const safari = userAgent.match(/Version\/([\d.]+).*Safari/i);
  if (safari) return `Safari ${safari[1]}`;
  return '';
}

function platformLabel(userAgent: string) {
  if (/iPhone/i.test(userAgent)) return 'iPhone';
  if (/iPad/i.test(userAgent)) return 'iPad';
  if (/Android/i.test(userAgent)) return 'Android';
  if (/Windows NT/i.test(userAgent)) return 'Windows';
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'macOS';
  if (/Linux/i.test(userAgent)) return 'Linux';
  return '';
}

export function deviceLabelFromUserAgent(value: unknown) {
  const userAgent = cleanPart(value, 512);
  if (!userAgent) return '';
  const platform = platformLabel(userAgent);
  const browser = browserLabel(userAgent);
  return [platform, browser].filter(Boolean).join(' · ').slice(0, 120);
}

export function approximateLocationFromCf(value: unknown) {
  const cf = value && typeof value === 'object' && !Array.isArray(value)
    ? value as RequestCfLocation
    : {};
  const ordered = [cleanPart(cf.city), cleanPart(cf.region), cleanPart(cf.country, 16)].filter(Boolean);
  const unique = ordered.filter((part, index) => ordered.indexOf(part) === index);
  return unique.join(' · ').slice(0, 160);
}

export function sessionClientMetadataKey(sessionId: string) {
  return `${META_PREFIX}${String(sessionId || '').trim()}`;
}

export function sessionIdFromClientMetadataKey(key: string) {
  return key.startsWith(META_PREFIX) ? key.slice(META_PREFIX.length) : '';
}

export function clientMetadataFromRequest(req: Request, capturedAt = new Date().toISOString()): SessionClientMetadata {
  const cf = (req as Request & { cf?: RequestCfLocation }).cf;
  return {
    deviceLabel: deviceLabelFromUserAgent(req.headers.get('user-agent') || ''),
    approximateLocation: approximateLocationFromCf(cf),
    capturedAt,
  };
}
