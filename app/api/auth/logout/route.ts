import { NextResponse } from 'next/server';import { COOKIE } from '@/lib/auth';export async function POST(){const r=NextResponse.json({ok:true}); r.cookies.delete(COOKIE); return r;}
