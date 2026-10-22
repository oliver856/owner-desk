import { NextResponse } from 'next/server';
import { getStaff } from '@/lib/auth';
import { vapidKeys } from '@/lib/push';

export async function GET() {
  const s = await getStaff();
  if (!s) return NextResponse.json({ error: 'Signed out' }, { status: 401 });
  const k = await vapidKeys();
  return NextResponse.json({ publicKey: k.publicKey });
}
