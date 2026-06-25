import { NextRequest, NextResponse } from 'next/server';
import { addStaffMessage, initDb, listStaffMessages } from '@/lib/db';
import { COOKIE, requireAdmin } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export async function GET() {
  try { await initDb(); await requireAdmin(); return NextResponse.json({ messages: await listStaffMessages() }); }
  catch (e: any) { const res = NextResponse.json({ error: e?.message === 'DISABLED' ? '该账户权限已被禁用' : 'Unauthorized' }, { status: e?.message === 'DISABLED' ? 403 : 401 }); if (e?.message === 'DISABLED') res.cookies.delete(COOKIE); return res; }
}
export async function POST(req: NextRequest) {
  try {
    await initDb();
    const admin = await requireAdmin();
    const { content } = await req.json();
    const text = String(content || '').trim();
    if (!text) return NextResponse.json({ error: '消息不能为空' }, { status: 400 });
    if (text.length > 1000) return NextResponse.json({ error: '消息过长' }, { status: 400 });
    const msg = await addStaffMessage(admin.id, text);
    return NextResponse.json({ message: msg });
  } catch (e: any) {
    const res = NextResponse.json({ error: e?.message === 'DISABLED' ? '该账户权限已被禁用' : 'Unauthorized' }, { status: e?.message === 'DISABLED' ? 403 : 401 });
    if (e?.message === 'DISABLED') res.cookies.delete(COOKIE);
    return res;
  }
}
