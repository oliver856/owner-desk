import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getStaff, requestIp } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { pushToUser } from '@/lib/push';

type Sub = { endpoint?: string; keys?: { p256dh?: string; auth?: string } };

// Registers this phone for call alerts. A phone belongs to one broker at a time.
export async function POST(req: Request) {
  const s = await getStaff();
  if (!s) return NextResponse.json({ error: 'Signed out' }, { status: 401 });
  const { subscription, test } = (await req.json().catch(() => ({}))) as { subscription?: Sub; test?: boolean };
  const ep = subscription?.endpoint, p = subscription?.keys?.p256dh, a = subscription?.keys?.auth;
  if (!ep || !p || !a || !/^https:\/\//.test(ep)) return NextResponse.json({ error: 'Bad subscription' }, { status: 400 });
  const ua = (req.headers.get('user-agent') ?? '').slice(0, 300);
  await sql`
    insert into desk.push_subs (user_id, endpoint, p256dh, auth, user_agent)
    values (${s.user_id}, ${ep}, ${p}, ${a}, ${ua})
    on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh,
      auth = excluded.auth, user_agent = excluded.user_agent, created_at = now()`;
  await audit(s.user_id, 'phone_alerts_on', { ip: await requestIp(), detail: { ua } });
  let sent = 0;
  if (test) sent = await pushToUser(s.user_id, { title: 'Apex Owner Desk', body: 'Call alerts are on for this phone.', url: '/phone', tag: 'test' });
  return NextResponse.json({ ok: true, sent });
}

export async function DELETE(req: Request) {
  const s = await getStaff();
  if (!s) return NextResponse.json({ error: 'Signed out' }, { status: 401 });
  const { endpoint } = await req.json().catch(() => ({ endpoint: '' }));
  await sql`delete from desk.push_subs where endpoint = ${String(endpoint)} and user_id = ${s.user_id}`;
  return NextResponse.json({ ok: true });
}

export async function GET() {
  const s = await getStaff();
  if (!s) return NextResponse.json({ error: 'Signed out' }, { status: 401 });
  const [r] = await sql<{ n: number }[]>`select count(*)::int as n from desk.push_subs where user_id = ${s.user_id}`;
  return NextResponse.json({ phones: r.n });
}
