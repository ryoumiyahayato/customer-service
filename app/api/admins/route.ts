import { NextRequest, NextResponse } from 'next/server';
import { createAdmin, initDb, listAdmins } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export async function GET() { await initDb(); const a = await requireAdmin(); if (a.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); return NextResponse.json({ admins: await listAdmins() }); }
export async function POST(req: NextRequest) { await initDb(); const a = await requireAdmin(); if (a.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); const b = await req.json(); await createAdmin({ username: b.username, password: b.password, role: b.role || 'OPERATOR' }); return NextResponse.json({ ok: true }); }
