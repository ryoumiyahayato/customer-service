import { NextRequest, NextResponse } from 'next/server';
import { initDb, registerVisitorAccount } from '@/lib/db';
import { makeVisitorToken, VISITOR_ACCOUNT_COOKIE } from '@/lib/visitor-auth';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  await initDb();
  const b = await req.json();
  if (!b.username || !b.password) return NextResponse.json({ error: '请输入账号和密码' }, { status: 400 });
  if (String(b.password).length < 6) return NextResponse.json({ error: '密码至少 6 位' }, { status: 400 });
  try {
    const account = await registerVisitorAccount({ username: String(b.username).trim(), password: String(b.password), displayName: b.displayName ? String(b.displayName).trim() : undefined });
    const res = NextResponse.json({ account });
    res.cookies.set(VISITOR_ACCOUNT_COOKIE, makeVisitorToken(account.id), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7, secure: process.env.NODE_ENV === 'production' });
    return res;
  } catch {
    return NextResponse.json({ error: '账号已存在或格式不正确' }, { status: 409 });
  }
}
