import { NextRequest, NextResponse } from 'next/server';
import { getAdminByUsername, initDb, loginVisitorAccount, verifyPassword } from '@/lib/db';
import { COOKIE, makeToken } from '@/lib/auth';
import { makeVisitorToken, VISITOR_ACCOUNT_COOKIE } from '@/lib/visitor-auth';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  await initDb();
  const { username, password } = await req.json();
  const name = String(username || '').trim();
  const pass = String(password || '');
  const admin: any = await getAdminByUsername(name);
  if (admin) {
    if (admin.is_disabled) return NextResponse.json({ error: '该账户权限已被禁用', disabled: true }, { status: 403 });
    if (!verifyPassword(pass, admin.password_hash)) return NextResponse.json({ error: '账号或密码错误' }, { status: 401 });
    const res = NextResponse.json({ type: 'admin', admin: { id: admin.id, username: admin.username, role: admin.role } });
    res.cookies.set(COOKIE, makeToken(admin.id), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7, secure: process.env.NODE_ENV === 'production' });
    return res;
  }
  const account = await loginVisitorAccount(name, pass);
  if (account) {
    const res = NextResponse.json({ type: 'user', account });
    res.cookies.set(VISITOR_ACCOUNT_COOKIE, makeVisitorToken(account.id), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7, secure: process.env.NODE_ENV === 'production' });
    return res;
  }
  return NextResponse.json({ error: '无账户' }, { status: 404 });
}
