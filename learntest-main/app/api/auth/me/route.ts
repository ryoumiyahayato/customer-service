import { NextResponse } from 'next/server';
import { currentAdminRaw, COOKIE } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export async function GET() {
  const admin = await currentAdminRaw();
  if (admin?.is_disabled) {
    const res = NextResponse.json({ admin: null, disabled: true }, { status: 403 });
    res.cookies.delete(COOKIE);
    return res;
  }
  return NextResponse.json({ admin });
}
