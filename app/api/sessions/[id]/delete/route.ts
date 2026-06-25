import { NextRequest, NextResponse } from 'next/server';
import { initDb, softDeleteSession } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await initDb();
  const admin = await requireAdmin();
  const { id } = await params;
  await softDeleteSession(id, admin.id);
  return NextResponse.json({ ok: true });
}
