import { NextResponse } from 'next/server';
import { initDb, purgeAdminImages } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export async function POST() {
  await initDb();
  const admin = await requireAdmin();
  await purgeAdminImages(admin.id);
  return NextResponse.json({ ok: true });
}
