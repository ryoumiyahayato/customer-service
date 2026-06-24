import { NextResponse } from 'next/server';
import { VISITOR_ACCOUNT_COOKIE } from '@/lib/visitor-auth';
export const dynamic = 'force-dynamic';
export async function POST() { const res = NextResponse.json({ ok: true }); res.cookies.delete(VISITOR_ACCOUNT_COOKIE); return res; }
