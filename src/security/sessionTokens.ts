import { hmacHex } from './signing';

export function hashSessionToken(secret: string, sessionId: string) {
  return hmacHex(secret, `session:${sessionId}`);
}
