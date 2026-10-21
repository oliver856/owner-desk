import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { requireStaff, allowedAreaIds, requestIp } from '@/lib/auth';
import { audit, caps } from '@/lib/audit';
import { fmt, fd, daysFromToday, bedsLabel } from '@/lib/format';
import Header from '@/components/Header';
import CallButton from '@/components/CallButton';

export const dynamic = 'force-dynamic';

export default async function UnitPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const staff = await requireStaff();
  const areas = await allowedAreaIds(staff);
  const ip = await requestIp();

  const c = await caps(staff.user_id);
  if (c.profiles >= c.profileCap) {
    await audit(staff.user_id, 'limit_hit', { unitId: id, detail: { limit: 'profiles' }, ip });
    return (<><Header staff={staff} /><main className="detail gut"><h2>Daily limit reached</h2>
      <p className="muted">You&apos;ve opened {c.profileCap} owner profiles today. Ask your manager if you need more.</p></main></>);
  }

  const [u] = await sql`select * from desk.v_unit_list where id = ${id} and area_id = any(${areas})`;
  if (!u) notFound();
  await audit(staff.user_id, 'opened_unit', { unitId: id, ip });

  const owners = await sql`
    select o.id, o.name, o.is_company, uo.role, ph.masked, (ph.owner_id is not null) as has_phone,
           (select count(*) from desk.unit_owners x where x.owner_id = o.id and x.role = 'owner')::int as units,
           exists (select 1 from desk.do_not_call d where d.owner_id = o.id) as dnc
    from desk.unit_owners uo join desk.owners o on o.id = uo.owner_id
    left join desk.owner_phones ph on ph.owner_id = o.id
    where uo.unit_id = ${id} order by uo.role desc, o.is_company, o.id`;
  const others = await sql`
    select uo.owner_id, u.id, u.unit_no, u.unit_type, b.subcommunity, b.name as building
    from desk.unit_owners uo join desk.units u on u.id = uo.unit_id join desk.buildings b on b.id = u.building_id
    where uo.owner_id = any(${owners.map((o) => o.id)}) and uo.role = 'owner' and u.id <> ${id}
      and b.area_id = any(${areas}) order by b.subcommunity, u.unit_no limit 60`;
  const calls = await sql`
    select c.called_at, c.outcome, c.note, s.full_name from desk.calls c join desk.staff s on s.user_id = c.user_id
    where c.unit_id = ${id} order by c.called_at desc limit 20`;

  const days = daysFromToday(u.end_date);
  const place = u.unit_type === 'Villa' ? u.subcommunity : `${u.building}, ${u.subcommunity}`;
  const chg = u.annual_rent && u.prev_rent ? Math.round((Number(u.annual_rent) / Number(u.prev_rent) - 1) * 100) : null;

  return (
    <>
      <Header staff={staff} />
      <main className="detail gut">
        <p><Link className="link" href="/">← Owners</Link></p>
        <h2 style={{ margin: '6px 0 2px' }}>{u.unit_type === 'Villa' ? 'Villa' : 'Unit'} {u.unit_no}</h2>
        <p className="muted" style={{ marginTop: 0 }}>{place} · {bedsLabel(u.beds)} · {u.size_sqft ? `${fmt(u.size_sqft)} sq ft` : 'size not recorded'}</p>

        <div className="blk"><h4>Tenancy</h4><dl>
          <dt>Lease</dt><dd>{u.lease_status}</dd>
          {u.end_date ? <>
            <dt>Contract ends</dt><dd>{fd(u.end_date)} <span className={days! < 0 ? 'gone' : days! <= 90 ? 'soon' : 'muted'}>({days! < 0 ? `ended ${-days!} days ago` : `in ${days} days`})</span></dd>
            <dt>Started</dt><dd>{fd(u.start_date)}</dd>
            <dt>Rent</dt><dd className="n">AED {fmt(u.annual_rent)} a year</dd>
            <dt>Previous rent</dt><dd className="n">{u.prev_rent ? <>AED {fmt(u.prev_rent)} {chg ? <span className="muted">({chg > 0 ? '+' : ''}{chg}%)</span> : null}</> : <span className="muted">not recorded</span>}</dd>
            <dt>Renewals</dt><dd>{u.renewals ?? '—'}</dd>
            <dt>Matched by</dt><dd>{u.matched_by === 'Size' ? 'registered size (unit number not returned)' : 'unit number'}</dd>
          </> : <><dt>Contract</dt><dd className="muted">{u.lease_status === 'No live Ejari' ? 'No registered contract running' : 'Not confirmed yet'}</dd></>}
        </dl></div>

        <div className="blk"><h4>Ownership</h4><dl>
          <dt>Last sale price</dt><dd className="n">{u.last_sale_price ? `AED ${fmt(u.last_sale_price)}` : <span className="muted">not available</span>}</dd>
          <dt>Finance</dt><dd>{u.mortgaged ? 'Mortgaged' : 'No bank on title'}</dd>
        </dl>
          <div style={{ marginTop: 10 }}>
            {owners.map((o) => (
              <div className="owner" key={o.id}>
                <div>{o.name}
                  <span className="sub">{o.role === 'mortgagee' ? 'Mortgage bank' : o.is_company ? 'Company' : 'Individual'}
                    {o.role === 'owner' && <> · <span className="ph">{o.masked ?? 'no mobile'}</span></>}{o.dnc ? ' · asked not to be called' : ''}</span>
                  {o.role === 'owner' && o.units > 1 && <span className="sub">Also owns {others.filter((x) => x.owner_id === o.id).map((x) => (
                    <Link key={x.id} className="link" style={{ marginRight: 8 }} href={`/unit/${x.id}`}>{x.unit_type === 'Villa' ? x.subcommunity : x.building} {x.unit_no}</Link>))}</span>}
                </div>
                <div>{o.role === 'owner' && o.has_phone && !o.dnc ? <CallButton unitId={id} ownerId={Number(o.id)} label={`${o.name}, ${place} ${u.unit_no}`} /> : null}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="blk"><h4>Calls</h4>
          {calls.length === 0 ? <p className="muted">Not called yet</p> : calls.map((c, i) => (
            <div key={i} className="owner"><span>{c.outcome ?? 'No outcome logged'}{c.note ? <span className="sub">{c.note}</span> : null}</span>
              <span className="muted">{c.full_name}, {new Date(c.called_at).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
          ))}
        </div>
        <p className="fine">The full number never reaches this laptop. Call sends it to your phone and logs it under your name.</p>
      </main>
    </>
  );
}
