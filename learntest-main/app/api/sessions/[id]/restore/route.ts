import { NextRequest, NextResponse } from 'next/server';
import { initDb, restoreSession } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await initDb();
  await requireAdmin();
  const { id } = await params;
  const ok = await restoreSession(id);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: '已超过 1 天，无法撤回删除' }, { status: 410 });
}
