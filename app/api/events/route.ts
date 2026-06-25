import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = () => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ts: Date.now() })}\n\n`));
      send();
      const timer = setInterval(send, 2000);
      setTimeout(() => { clearInterval(timer); controller.close(); }, 55000);
    }
  });
  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    }
  });
}
