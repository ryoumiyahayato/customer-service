import { NextRequest, NextResponse } from 'next/server';
import { getLatestSession, getMessages, initDb, markOperatorMessagesRead, upsertVisitor } from '@/lib/db';
import { currentVisitorAccount } from '@/lib/visitor-auth';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  await initDb();
  const { visitorId } = await req.json().catch(() => ({}));
  const account = await currentVisitorAccount();
  const { key, user } = await upsertVisitor(visitorId, account);
  const session = await getLatestSession(user.id);
  const messages = session ? await getMessages(session.id) : [];
  if (session) await markOperatorMessagesRead(session.id);
  return NextResponse.json({ visitorId: key, account, user, session, messages });
}
