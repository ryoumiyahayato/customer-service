import { NextRequest, NextResponse } from 'next/server';
import { initDb, recallMessage } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await initDb();
  const admin = await requireAdmin();
  const { id } = await params;
  const ok = await recallMessage(id, admin.id);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: '只能撤回自己发送的客服消息' }, { status: 403 });
}
