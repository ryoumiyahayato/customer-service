import { NextResponse } from 'next/server';import { currentAdmin } from '@/lib/auth';export async function GET(){return NextResponse.json({admin:await currentAdmin()});}
