import { NextResponse } from 'next/server';
import { currentVisitorAccount } from '@/lib/visitor-auth';
export const dynamic = 'force-dynamic';
export async function GET() { return NextResponse.json({ account: await currentVisitorAccount() }); }
