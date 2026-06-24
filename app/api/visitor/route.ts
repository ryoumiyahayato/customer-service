import { NextRequest, NextResponse } from 'next/server';
import { getMessages, getOrCreateSession, initDb, upsertVisitor } from '@/lib/db';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) { await initDb(); const { visitorId } = await req.json(); const { key, user } = await upsertVisitor(visitorId); const session = await getOrCreateSession(user.id); const messages = await getMessages(session.id); return NextResponse.json({ visitorId: key, user, session, messages }); }
