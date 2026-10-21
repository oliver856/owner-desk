import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getStaff, requestIp } from '@/lib/auth';
import { audit } from '@/lib/audit';

const OUTCOMES = new Set(['No answer', 'Not interested', 'Call back', 'Wants valuation', 'Listing opportunity', 'Wants to sell', 'Wrong number', 'Do not call']);

export async function POST(req: Request) {
  const s = await getStaff();
  if (!s) return NextResponse.json({ error: 'Signed out' }, { status: 401 });
  const { requestId, outcome, note, kendal } = await req.json().catch(() => ({}));
  if (!OUTCOMES.has(outcome)) return NextResponse.json({ error: 'Pick an outcome.' }, { status: 400 });

  const [c] = await sql<{ id: number; unit_id: number; owner_id: number }[]>`
    update desk.calls set outcome = ${outcome}, note = ${String(note ?? '').slice(0, 1000) || null},
      sent_to_kendal = ${!!kendal}, outcome_at = now()
    where request_id = ${Number(requestId)} and user_id = ${s.user_id}
    returning id, unit_id, owner_id`;
  if (!c) return NextResponse.json({ error: 'That call wasn\'t found. Was the blue button tapped on your phone?' }, { status: 404 });

  if (outcome === 'Do not call') {
    await sql`insert into desk.do_not_call (owner_id, added_by, reason) values (${c.owner_id}, ${s.user_id}, 'Owner asked on a call')
              on conflict (owner_id) do nothing`;
  }
  await audit(s.user_id, 'outcome', { unitId: c.unit_id, detail: { outcome, kendal: !!kendal, call_id: c.id }, ip: await requestIp() });
  return NextResponse.json({ ok: true });
}
