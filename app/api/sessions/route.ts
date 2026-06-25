import { NextRequest, NextResponse } from 'next/server';
import { initDb, listSessions } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export async function GET(req: NextRequest) {
  await initDb();
  await requireAdmin();
  const includeDeleted = req.nextUrl.searchParams.get('includeDeleted') === '1';
  return NextResponse.json({ sessions: await listSessions(includeDeleted) });
}
