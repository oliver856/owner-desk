import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getStaff } from '@/lib/auth';

// What the phone shows: the newest call waiting to be tapped, and the last tapped call with no outcome yet.
// Only masked numbers here; the real number is released by /api/phone/dial at the moment of tapping.
export async function GET() {
  const s = await getStaff();
  if (!s) return NextResponse.json({ error: 'Signed out' }, { status: 401 });
  const [pending] = await sql`
    select cr.id, o.name as owner_name, ph.masked, u.unit_no, u.unit_type, b.subcommunity, b.name as building,
           t.end_date, extract(epoch from (cr.expires_at - now()))::int as seconds_left
    from desk.call_requests cr
    join desk.owners o on o.id = cr.owner_id
    join desk.owner_phones ph on ph.owner_id = cr.owner_id
    join desk.units u on u.id = cr.unit_id
    join desk.buildings b on b.id = u.building_id
    left join desk.tenancies t on t.unit_id = u.id
    where cr.user_id = ${s.user_id} and cr.used_at is null and cr.expires_at > now()
    order by cr.created_at desc limit 1`;
  const [awaiting] = await sql`
    select cr.id, o.name as owner_name, u.unit_no, u.unit_type, b.subcommunity, b.name as building
    from desk.call_requests cr
    join desk.calls c on c.request_id = cr.id and c.outcome is null
    join desk.owners o on o.id = cr.owner_id
    join desk.units u on u.id = cr.unit_id
    join desk.buildings b on b.id = u.building_id
    where cr.user_id = ${s.user_id} and cr.used_at > now() - interval '2 hours'
    order by cr.used_at desc limit 1`;
  return NextResponse.json({ name: s.full_name, pending: pending ?? null, awaiting: awaiting ?? null });
}
