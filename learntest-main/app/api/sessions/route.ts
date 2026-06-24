import { NextResponse } from 'next/server';
import { initDb, listSessions } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export async function GET() { await initDb(); await requireAdmin(); return NextResponse.json({ sessions: await listSessions() }); }
