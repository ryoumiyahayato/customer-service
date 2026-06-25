import { NextRequest, NextResponse } from 'next/server';
import { findUserByVisitorKey, getLatestSession, getMessages, initDb, markOperatorMessagesRead } from '@/lib/db';
import { currentVisitorAccount } from '@/lib/visitor-auth';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  await initDb();
  const { visitorId } = await req.json().catch(() => ({}));
  const account = await currentVisitorAccount();
  const key = account ? `acct_${account.id}` : String(visitorId || '');
  const user = key ? await findUserByVisitorKey(key) : null;
  const session = user ? await getLatestSession(user.id) : null;
  const messages = session ? await getMessages(session.id) : [];
  if (session) await markOperatorMessagesRead(session.id);
  return NextResponse.json({ visitorId: key, account, user, session, messages });
}
