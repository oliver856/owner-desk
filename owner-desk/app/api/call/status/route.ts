import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getStaff } from '@/lib/auth';

export async function GET(req: Request) {
  const s = await getStaff();
  if (!s) return NextResponse.json({ error: 'Signed out' }, { status: 401 });
  const id = Number(new URL(req.url).searchParams.get('id'));
  const [r] = await sql<{ used_at: Date | null; expired: boolean; outcome: string | null }[]>`
    select cr.used_at, (cr.expires_at < now()) as expired, c.outcome
    from desk.call_requests cr left join desk.calls c on c.request_id = cr.id
    where cr.id = ${id} and cr.user_id = ${s.user_id}`;
  if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const status = r.outcome ? 'done' : r.used_at ? 'dialled' : r.expired ? 'expired' : 'sent';
  return NextResponse.json({ status });
}
