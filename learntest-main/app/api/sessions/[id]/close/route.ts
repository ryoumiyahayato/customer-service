import { NextResponse } from 'next/server';
import { closeSession, initDb } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) { await initDb(); await requireAdmin(); const { id } = await params; await closeSession(id); return NextResponse.json({ ok: true }); }
