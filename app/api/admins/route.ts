import { NextRequest, NextResponse } from 'next/server';
import { createAdmin, initDb, listAdmins } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export async function GET() {
  await initDb();
  const a = await requireAdmin();
  if (a.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  return NextResponse.json({ admins: await listAdmins() });
}
export async function POST(req: NextRequest) {
  await initDb();
  const a = await requireAdmin();
  if (a.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const b = await req.json();
  const username = String(b.username || '').trim();
  const password = String(b.password || '');
  if (!username || password.length < 8) return NextResponse.json({ error: '账号不能为空，密码至少 8 位' }, { status: 400 });
  try {
    await createAdmin({ username, password, role: 'OPERATOR' });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const message = e?.message === 'ONLY_OPERATOR_CAN_BE_CREATED' ? '只能创建一般客服账号' : '账号已存在，请换一个名称';
    return NextResponse.json({ error: message }, { status: 409 });
  }
}
