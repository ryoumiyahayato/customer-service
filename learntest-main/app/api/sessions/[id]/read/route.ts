import { NextResponse } from 'next/server';
import { initDb, markVisitorMessagesRead } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) { await initDb(); await requireAdmin(); const { id } = await params; await markVisitorMessagesRead(id); return NextResponse.json({ ok: true }); }
