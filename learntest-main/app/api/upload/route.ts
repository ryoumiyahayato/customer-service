import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
const allowed = new Map([['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp']]);
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get('file') as File | null;
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 });
  if (!allowed.has(file.type)) return NextResponse.json({ error: 'Only jpg, jpeg, png, webp allowed' }, { status: 400 });
  if (file.size > 1024 * 1024) return NextResponse.json({ error: 'Max 1MB on Vercel demo storage' }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sig = Array.from(bytes.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join('');
  const ok = sig.startsWith('ffd8ff') || sig.startsWith('89504e470d0a1a0a') || sig.startsWith('52494646');
  if (!ok) return NextResponse.json({ error: 'Invalid image data' }, { status: 400 });
  if (process.env.VERCEL) {
    const base64 = Buffer.from(bytes).toString('base64');
    return NextResponse.json({ path: `data:${file.type};base64,${base64}` });
  }
  const name = `${crypto.randomBytes(16).toString('hex')}.${allowed.get(file.type)}`;
  const dir = path.join(process.cwd(), 'public', 'uploads');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), bytes);
  return NextResponse.json({ path: `/uploads/${name}` });
}
