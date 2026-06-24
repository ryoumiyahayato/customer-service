import { NextRequest, NextResponse } from 'next/server';
import { initDb, loginVisitorAccount } from '@/lib/db';
import { makeVisitorToken, VISITOR_ACCOUNT_COOKIE } from '@/lib/visitor-auth';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  await initDb();
  const { username, password } = await req.json();
  const account = await loginVisitorAccount(String(username || '').trim(), String(password || ''));
  if (!account) return NextResponse.json({ error: '账号或密码错误' }, { status: 401 });
  const res = NextResponse.json({ account });
  res.cookies.set(VISITOR_ACCOUNT_COOKIE, makeVisitorToken(account.id), { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 7, secure: process.env.NODE_ENV === 'production' });
  return res;
}
