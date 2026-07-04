const SAFE_MIME_TYPES = new Set([
  'application/octet-stream',
  'application/pdf',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain',
]);

const EXTENSION_BY_MIME = new Map<string, string>([
  ['application/pdf', '.pdf'],
  ['image/gif', '.gif'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
  ['text/plain', '.txt'],
]);

export function normalizeContentType(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  const mime = (raw || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  return SAFE_MIME_TYPES.has(mime) ? mime : 'application/octet-stream';
}

export function extensionForMimeType(mimeType: string): string {
  return EXTENSION_BY_MIME.get(mimeType) || '.bin';
}
