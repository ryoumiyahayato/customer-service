import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateSession, initDb, insertMessage, log, upsertVisitor } from '@/lib/db';
import { currentAdmin } from '@/lib/auth';
import { currentVisitorAccount } from '@/lib/visitor-auth';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    await initDb();
    const b = await req.json();
    const admin = await currentAdmin();
    const senderType = (b.senderType || (admin ? 'OPERATOR' : 'VISITOR')) as 'VISITOR' | 'OPERATOR';
    if (senderType === 'OPERATOR' && !admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    let sessionId = b.sessionId;
    let senderId = senderType === 'OPERATOR' ? admin!.id : b.visitorId;
    let session: any = null;
    if (senderType === 'VISITOR') {
      const account = await currentVisitorAccount();
      const v = await upsertVisitor(b.visitorId, account);
      senderId = v.key;
      session = sessionId ? null : await getOrCreateSession(v.user.id);
      sessionId = sessionId || session.id;
    }
    if (!sessionId || !senderId) return NextResponse.json({ error: 'Missing session or sender' }, { status: 400 });
    const msg = await insertMessage({ ...b, sessionId }, senderType, senderId);
    return NextResponse.json({ message: msg, session });
  } catch (e: any) {
    await log('MESSAGE_ERROR', e.message, 'ERROR');
    return NextResponse.json({ error: 'Message failed' }, { status: 500 });
  }
}
