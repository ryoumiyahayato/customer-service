export const PASSWORD_HASH_ITERATIONS = 210_000;
export const PASSWORD_HASH_ALGORITHM = 'SHA-256';
const MIN_STORED_ITERATIONS = 10_000;
const MAX_STORED_ITERATIONS = 1_000_000;
const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array) {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

function fromBase64(value: string) {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function parsePasswordHash(stored: string) {
  const [scheme, rawIterations, rawSalt, rawHash, ...extra] = String(stored || '').split(':');
  const iterations = Number(rawIterations);
  const salt = fromBase64(rawSalt || '');
  const expected = fromBase64(rawHash || '');
  if (scheme !== 'pbkdf2' || extra.length || !Number.isInteger(iterations)) return null;
  if (iterations < MIN_STORED_ITERATIONS || iterations > MAX_STORED_ITERATIONS) return null;
  if (!salt?.length || !expected?.length || expected.length > 128) return null;
  return { iterations, salt, expected };
}

async function derive(password: string, salt: Uint8Array, iterations: number, bits: number) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt: Uint8Array.from(salt).buffer,
    iterations,
    hash: PASSWORD_HASH_ALGORITHM,
  }, key, bits));
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const actual = await derive(password, salt, PASSWORD_HASH_ITERATIONS, 256);
  return `pbkdf2:${PASSWORD_HASH_ITERATIONS}:${toBase64(salt)}:${toBase64(actual)}`;
}

export async function verifyPassword(password: string, stored: string) {
  const parsed = parsePasswordHash(stored);
  if (!parsed) return false;
  const actual = await derive(password, parsed.salt, parsed.iterations, parsed.expected.length * 8);
  let diff = actual.length ^ parsed.expected.length;
  for (let index = 0; index < Math.min(actual.length, parsed.expected.length); index += 1) {
    diff |= actual[index] ^ parsed.expected[index];
  }
  return diff === 0;
}

export function passwordHashNeedsUpgrade(stored: string) {
  const parsed = parsePasswordHash(stored);
  return Boolean(parsed && parsed.iterations < PASSWORD_HASH_ITERATIONS);
}
