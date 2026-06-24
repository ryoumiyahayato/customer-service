import { NextRequest, NextResponse } from 'next/server';
import { getAdminByUsername, initDb, log, verifyPassword } from '@/lib/db';
import { COOKIE, makeToken } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) { await initDb(); const { username, password } = await req.json(); const admin: any = await getAdminByUsername(username); if (!admin || !verifyPassword(password, admin.password_hash)) return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 }); await log('ADMIN_LOGIN', `${username} logged in`, 'INFO', admin.id); const res = NextResponse.json({ admin: { id: admin.id, username: admin.username, role: admin.role, must_change_password: admin.must_change_password } }); res.cookies.set(COOKIE, makeToken(admin.id), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7, secure: process.env.NODE_ENV === 'production' }); return res; }
