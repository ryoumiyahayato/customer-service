import { NextRequest, NextResponse } from 'next/server';
import { getMessages, getOrCreateSession, initDb, upsertVisitor } from '@/lib/db';
import { currentVisitorAccount } from '@/lib/visitor-auth';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) { await initDb(); const { visitorId } = await req.json(); const account = await currentVisitorAccount(); const { key, user } = await upsertVisitor(visitorId, account); const session = await getOrCreateSession(user.id); const messages = await getMessages(session.id); return NextResponse.json({ visitorId: key, account, user, session, messages }); }
