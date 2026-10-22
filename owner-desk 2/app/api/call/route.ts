import { NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { sql } from '@/lib/db';
import { getStaff, allowedAreaIds, requestIp } from '@/lib/auth';
import { audit, caps, setting, withinCallHours } from '@/lib/audit';
import { pushToUser } from '@/lib/push';

// Laptop presses Call. Only reachable from the office (middleware). Creates a short-lived call
// request for this broker's phone. No phone number is returned to the laptop.
export async function POST(req: Request) {
  const s = await getStaff();
  if (!s) return NextResponse.json({ error: 'Signed out' }, { status: 401 });
  const ip = await requestIp();
  const { unitId, ownerId } = await req.json().catch(() => ({}));
  if (!Number.isInteger(unitId) || !Number.isInteger(ownerId)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

  if (!(await withinCallHours())) {
    await audit(s.user_id, 'call_blocked_hours', { unitId, ip });
    return NextResponse.json({ error: 'Calls can only be made between 9am and 6pm.' }, { status: 403 });
  }
  const c = await caps(s.user_id);
  if (c.calls >= c.callCap) {
    await audit(s.user_id, 'limit_hit', { unitId, detail: { limit: 'calls' }, ip });
    return NextResponse.json({ error: 'You have reached today\'s call limit.' }, { status: 429 });
  }

  const areas = await allowedAreaIds(s);
  const ok = await sql<{ owner_name: string; unit_no: string; unit_type: string; subcommunity: string; building: string }[]>`
    select o.name as owner_name, u.unit_no, u.unit_type, b.subcommunity, b.name as building
    from desk.units u join desk.owners o on o.id = ${ownerId} join desk.buildings b on b.id = u.building_id
    join desk.unit_owners uo on uo.unit_id = u.id and uo.owner_id = ${ownerId} and uo.role = 'owner'
    join desk.owner_phones ph on ph.owner_id = uo.owner_id
    where u.id = ${unitId} and b.area_id = any(${areas})`;
  if (!ok.length) return NextResponse.json({ error: 'This owner isn\'t in your areas or has no mobile.' }, { status: 403 });

  const dnc = await sql`select 1 from desk.do_not_call where owner_id = ${ownerId}`;
  if (dnc.length) return NextResponse.json({ error: 'This owner asked not to be called.' }, { status: 403 });

  const minutes = Number(await setting('call_token_minutes', 2));
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const [r] = await sql<{ id: number }[]>`
    insert into desk.call_requests (user_id, unit_id, owner_id, token_hash, expires_at, request_ip)
    values (${s.user_id}, ${unitId}, ${ownerId}, ${hash}, now() + make_interval(mins => ${minutes}), ${ip || null})
    returning id`;
  await audit(s.user_id, 'call_sent', { unitId, detail: { owner_id: ownerId, request_id: r.id }, ip });

  // Alert the broker's phone. Name and unit only: the number is released when Call is tapped.
  const x = ok[0];
  const nameParts = x.owner_name.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()).split(' ');
  const shortName = nameParts.length > 2 ? `${nameParts[0]} ${nameParts[nameParts.length - 1]}` : nameParts.join(' ');
  const place = x.unit_type === 'Villa' ? `${x.subcommunity} villa ${x.unit_no}` : `${x.building} ${x.unit_no}`;
  let phones = 0;
  try {
    phones = await pushToUser(s.user_id, { title: `Call ${shortName}`, body: `${place} · tap to call`, url: '/phone', tag: 'call' });
  } catch { phones = 0; }
  return NextResponse.json({ requestId: Number(r.id), phones });
}
