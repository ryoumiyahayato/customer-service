import { NextResponse } from 'next/server';
import { getMessages, getSessionById, initDb, markVisitorMessagesRead } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  await initDb();
  await requireAdmin();
  const { id } = await params;
  const session = await getSessionById(id);
  if (!session || session.deleted_at) return NextResponse.json({ messages: [] });
  await markVisitorMessagesRead(id);
  return NextResponse.json({ messages: await getMessages(id) });
}
