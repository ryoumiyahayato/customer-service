import { NextRequest, NextResponse } from 'next/server';
import { disableOperator, initDb, isAdminOnline, listOperatorAccounts } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export async function GET() {
  await initDb();
  const admin = await requireAdmin();
  if (admin.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const operators = (await listOperatorAccounts()).map((o: any) => ({ ...o, online: isAdminOnline(o) }));
  return NextResponse.json({ operators });
}
export async function DELETE(req: NextRequest) {
  await initDb();
  const admin = await requireAdmin();
  if (admin.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { id } = await req.json();
  const ok = await disableOperator(String(id || ''), admin.id);
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: '只能删除一般客服账号' }, { status: 400 });
}
