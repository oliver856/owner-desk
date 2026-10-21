import { NextResponse } from 'next/server';
import { getStaff, requestIp } from '@/lib/auth';
import { audit } from '@/lib/audit';

const ALLOWED = new Set(['copy_blocked']);

export async function POST(req: Request) {
  const s = await getStaff();
  if (!s) return NextResponse.json({ error: 'Signed out' }, { status: 401 });
  const { action } = await req.json().catch(() => ({ action: '' }));
  if (!ALLOWED.has(action)) return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  await audit(s.user_id, action, { ip: await requestIp() });
  return NextResponse.json({ ok: true });
}
