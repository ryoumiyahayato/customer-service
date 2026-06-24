import { cookies } from 'next/headers';
import crypto from 'crypto';
import { getAdminById, initDb } from './db';
const COOKIE = 'support_admin';
const secret = process.env.AUTH_SECRET || 'dev-change-me';
export type Admin = { id: string; username: string; role: 'SUPER_ADMIN' | 'OPERATOR'; must_change_password: number };
function sign(v: string) { return crypto.createHmac('sha256', secret).update(v).digest('hex'); }
export function makeToken(id: string) { return `${id}.${sign(id)}`; }
export function verifyToken(token?: string) { if (!token) return null; const [id, sig] = token.split('.'); if (!id || sig !== sign(id)) return null; return id; }
export async function currentAdmin() { await initDb(); const token = (await cookies()).get(COOKIE)?.value; const aid = verifyToken(token); if (!aid) return null; return await getAdminById(aid) as Admin | null; }
export async function requireAdmin() { const a = await currentAdmin(); if (!a) throw new Error('UNAUTHORIZED'); return a; }
export { COOKIE };
