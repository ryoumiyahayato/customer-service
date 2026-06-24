import { NextRequest, NextResponse } from 'next/server';
import { initDb, insertMessage, log } from '@/lib/db';
import { currentAdmin } from '@/lib/auth';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) { try { await initDb(); const b = await req.json(); const admin = await currentAdmin(); const senderType = (b.senderType || (admin ? 'OPERATOR' : 'VISITOR')) as 'VISITOR' | 'OPERATOR'; if (senderType === 'OPERATOR' && !admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); const senderId = senderType === 'OPERATOR' ? admin!.id : b.visitorId; if (!b.sessionId || !senderId) return NextResponse.json({ error: 'Missing session or sender' }, { status: 400 }); const msg = await insertMessage(b, senderType, senderId); return NextResponse.json(msg); } catch (e: any) { await log('MESSAGE_ERROR', e.message, 'ERROR'); return NextResponse.json({ error: 'Message failed' }, { status: 500 }); } }
