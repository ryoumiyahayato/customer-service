import { createHash, timingSafeEqual } from 'node:crypto';

export function normalizeHostKeyFingerprint(value: string | undefined): string {
  const normalized = value?.trim() || '';
  if (!/^SHA256:[A-Za-z0-9+/]{43}$/.test(normalized)) {
    throw new Error('A valid OpenSSH SHA256 host key fingerprint is required.');
  }
  return normalized.slice('SHA256:'.length);
}

export function fingerprintHostKey(key: Buffer): string {
  return createHash('sha256').update(key).digest('base64').replace(/=+$/, '');
}

export function createHostKeyVerifier(expectedFingerprint: string | undefined): (key: Buffer) => boolean {
  const expected = Buffer.from(normalizeHostKeyFingerprint(expectedFingerprint), 'ascii');
  return (key: Buffer) => {
    const actual = Buffer.from(fingerprintHostKey(key), 'ascii');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };
}
