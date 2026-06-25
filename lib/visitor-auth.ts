import { cookies } from 'next/headers';
import crypto from 'crypto';
import { getVisitorAccountById, initDb } from './db';
export const VISITOR_ACCOUNT_COOKIE = 'visitor_account';
function signingSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is required.');
  return secret;
}
function sign(v: string) { return crypto.createHmac('sha256', signingSecret()).update(v).digest('hex'); }
export function makeVisitorToken(id: string) { return `${id}.${sign(id)}`; }
export function verifyVisitorToken(token?: string) { if (!token) return null; const [id, sig] = token.split('.'); if (!id || sig !== sign(id)) return null; return id; }
export async function currentVisitorAccount() { await initDb(); const token = (await cookies()).get(VISITOR_ACCOUNT_COOKIE)?.value; const accountId = verifyVisitorToken(token); if (!accountId) return null; return await getVisitorAccountById(accountId); }
