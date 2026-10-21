import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getStaff, requestIp } from '@/lib/auth';
import { audit } from '@/lib/audit';

// The blue button. Releases the number once, for this broker's own unexpired request, and records the call.
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getStaff();
  if (!s) return NextResponse.json({ error: 'Signed out' }, { status: 401 });
  const id = Number((await ctx.params).id);
  const ip = await requestIp();

  const [r] = await sql<{ unit_id: number; owner_id: number }[]>`
    update desk.call_requests set used_at = now()
    where id = ${id} and user_id = ${s.user_id} and used_at is null and expires_at > now()
    returning unit_id, owner_id`;
  if (!r) {
    await audit(s.user_id, 'dial_refused', { detail: { request_id: id }, ip });
    return NextResponse.json({ error: 'This call has expired or was already used. Press Call on the laptop again.' }, { status: 410 });
  }
  const [ph] = await sql<{ phone: string }[]>`select phone from desk.owner_phones where owner_id = ${r.owner_id}`;
  await sql`insert into desk.calls (request_id, user_id, unit_id, owner_id) values (${id}, ${s.user_id}, ${r.unit_id}, ${r.owner_id})`;
  await audit(s.user_id, 'call_dialled', { unitId: r.unit_id, detail: { request_id: id, owner_id: r.owner_id }, ip });
  return NextResponse.json({ tel: '+' + ph.phone });
}
