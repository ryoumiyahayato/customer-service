import { NextRequest, NextResponse } from 'next/server';
import { checkApiRequest, rateLimitResponse } from '@/lib/api-security';

export async function middleware(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith('/api/')) return NextResponse.next();
  const check = await checkApiRequest(req);
  if (!check.ok) return check.response;
  if (!check.value.allowed) return rateLimitResponse(check.value);
  const res = NextResponse.next();
  res.headers.set('X-RateLimit-Limit', String(check.value.limit));
  res.headers.set('X-RateLimit-Remaining', String(check.value.remaining));
  return res;
}

export const config = { matcher: ['/api/:path*'] };
