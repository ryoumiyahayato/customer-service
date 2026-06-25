import { cookies } from 'next/headers';
import crypto from 'crypto';
import { getAdminById, initDb, touchAdmin } from './db';
const COOKIE = 'support_admin';
function signingSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is required.');
  return secret;
}
export type Admin = { id: string; username: string; role: 'SUPER_ADMIN' | 'OPERATOR'; must_change_password: number; is_disabled?: number; last_seen_at?: string };
function sign(v: string) { return crypto.createHmac('sha256', signingSecret()).update(v).digest('hex'); }
export function makeToken(id: string) { return `${id}.${sign(id)}`; }
export function verifyToken(token?: string) { if (!token) return null; const [id, sig] = token.split('.'); if (!id || sig !== sign(id)) return null; return id; }
export async function currentAdmin() { await initDb(); const token = (await cookies()).get(COOKIE)?.value; const aid = verifyToken(token); if (!aid) return null; const admin = await getAdminById(aid) as Admin | null; if (!admin || admin.is_disabled) return null; await touchAdmin(admin.id); return admin; }
export async function currentAdminRaw() { await initDb(); const token = (await cookies()).get(COOKIE)?.value; const aid = verifyToken(token); if (!aid) return null; return await getAdminById(aid) as Admin | null; }
export async function requireAdmin() { const raw = await currentAdminRaw(); if (raw?.is_disabled) throw new Error('DISABLED'); const a = await currentAdmin(); if (!a) throw new Error('UNAUTHORIZED'); return a; }
export { COOKIE };
