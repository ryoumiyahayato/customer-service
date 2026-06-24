import { NextRequest, NextResponse } from 'next/server';
import { assignSession, initDb, log } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export async function POST(_: NextRequest, { params }: { params: Promise<{ id: string }> }) { await initDb(); const admin = await requireAdmin(); const { id } = await params; await assignSession(id, admin.id); await log('SESSION_ASSIGN', `Session ${id} assigned`, 'INFO', admin.id); return NextResponse.json({ ok: true }); }
