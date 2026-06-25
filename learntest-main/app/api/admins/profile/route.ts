import { NextRequest, NextResponse } from 'next/server';
import { initDb, updateOwnAdmin } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export async function PATCH(req: NextRequest) {
  await initDb();
  const admin = await requireAdmin();
  if (admin.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  const username = b.username ? String(b.username).trim() : undefined;
  const password = b.password ? String(b.password) : undefined;
  if (!username && !password) return NextResponse.json({ error: '没有要修改的内容' }, { status: 400 });
  if (password && password.length < 10) return NextResponse.json({ error: '新密码至少 10 位' }, { status: 400 });
  try { await updateOwnAdmin(admin.id, { username, password }); return NextResponse.json({ ok: true }); }
  catch { return NextResponse.json({ error: '修改失败，账号名可能已存在' }, { status: 409 }); }
}
