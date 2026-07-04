import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { extensionForMimeType } from './contentType.js';

const SAFE_FILENAME_MAX = 120;

export function sanitizeDisplayFilename(value: string | null | undefined): string {
  const base = path.basename((value || 'attachment').replace(/\\/g, '/'));
  const cleaned = base.replace(/[^\w .@()-]/g, '_').replace(/\s+/g, ' ').trim();
  const filename = cleaned || 'attachment';
  return filename.length > SAFE_FILENAME_MAX ? filename.slice(0, SAFE_FILENAME_MAX) : filename;
}

export function generateAttachmentStorageKey(mimeType: string, now = new Date()): string {
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const id = randomBytes(24).toString('base64url');
  return `attachments/${year}/${month}/${id}${extensionForMimeType(mimeType)}`;
}
