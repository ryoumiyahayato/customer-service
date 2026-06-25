import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateSession, getSessionById, initDb, insertMessage, log, upsertVisitor } from '@/lib/db';
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
      const requestedVisitorId = String(b.visitorId || '').trim();
      if (!account && !requestedVisitorId.startsWith('visitor_')) return NextResponse.json({ error: '游客身份无效，请刷新页面后重试' }, { status: 400 });
      const v = await upsertVisitor(requestedVisitorId, account);
      senderId = v.key;
      if (sessionId) {
        const existing = await getSessionById(String(sessionId));
        if (!existing || existing.user_id !== v.user.id || existing.deleted_at) sessionId = '';
      }
      session = sessionId ? await getSessionById(String(sessionId)) : await getOrCreateSession(v.user.id);
      sessionId = session.id;
    } else if (sessionId) {
      const existing = await getSessionById(String(sessionId));
      if (!existing || existing.deleted_at) return NextResponse.json({ error: '会话已删除或不存在' }, { status: 404 });
    }
    if (!sessionId || !senderId) return NextResponse.json({ error: 'Missing session or sender' }, { status: 400 });
    const msg = await insertMessage({ ...b, sessionId }, senderType, senderId);
    return NextResponse.json({ message: msg, session });
  } catch (e: any) {
    await log('MESSAGE_ERROR', e.message, 'ERROR');
    return NextResponse.json({ error: 'Message failed' }, { status: 500 });
  }
}
