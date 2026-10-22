import Link from 'next/link';
import { after } from 'next/server';
import { unstable_cache } from 'next/cache';
import { sql } from '@/lib/db';
import { requireStaff, requestIp } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { whereFor, tabFragment, TABS, SORT_KEYS, sortFragment, one, type SP } from '@/lib/filters';
import { fmt, fd, daysFromToday, bedsLabel } from '@/lib/format';
import Header from '@/components/Header';
import Filters from '@/components/Filters';
import CallButton from '@/components/CallButton';

export const dynamic = 'force-dynamic';
const PAGE = 100;

const COLS = sql`id, subcommunity, building, unit_no, unit_type, beds, size_sqft, lease_status, end_date, annual_rent,
  prev_rent, renewals, last_sale_price, owner_id, owner_name, owner_masked, has_phone, owner_units, owners_n, mortgaged,
  last_called, last_outcome`;

// The building list barely changes, so it's cached for an hour per set of areas
const placesFor = unstable_cache(
  async (areaKey: string) => {
    const areas = areaKey ? areaKey.split(',').map(Number) : [];
    return sql<{ subcommunity: string; building: string | null }[]>`
      select distinct subcommunity, building from desk.mv_units where area_id = any(${areas}) order by 1, 2`;
  },
  ['places'],
  { revalidate: 3600 },
);

type Row = {
  id: number; subcommunity: string; building: string | null; unit_no: string; unit_type: string; beds: string | null;
  size_sqft: string | null; lease_status: string; end_date: Date | null; annual_rent: string | null; prev_rent: string | null;
  renewals: number | null; last_sale_price: string | null; owner_id: number | null; owner_name: string | null;
  owner_masked: string | null; has_phone: boolean; owner_units: number; owners_n: number; mortgaged: boolean;
  last_called: Date | null; last_outcome: string | null;
};

export default async function OwnerList({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const staff = await requireStaff();
  const areas = staff.areas;
  const tab = TABS.some((t) => t.k === one(sp, 'tab')) ? one(sp, 'tab') : 'all';
  const sortKey = (SORT_KEYS as readonly string[]).includes(one(sp, 'sort')) ? one(sp, 'sort') : 'unit';
  const page = Math.max(1, Number(one(sp, 'page')) || 1);

  const [rows, counts, places] = await Promise.all([
    sql<Row[]>`select ${COLS} from desk.v_unit_list v where ${whereFor(sp, areas)} and ${tabFragment(tab)}
               order by ${sortFragment(sortKey)} limit ${PAGE} offset ${(page - 1) * PAGE}`,
    sql`select count(*)::int as all,
          count(*) filter (where ${tabFragment('exp90')})::int as exp90,
          count(*) filter (where ${tabFragment('up')})::int as up,
          count(*) filter (where ${tabFragment('port')})::int as port,
          count(*) filter (where ${tabFragment('mort')})::int as mort,
          count(*) filter (where ${tabFragment('never')})::int as never
        from desk.v_unit_list v where ${whereFor(sp, areas)}`,
    placesFor([...areas].sort((a, b) => a - b).join(',')),
  ]);
  const c = counts[0] as Record<string, number>;
  const total = c[tab];
  const filtersUsed = Object.keys(sp).some((k) => !['tab', 'sort', 'page'].includes(k) && one(sp, k));
  if (filtersUsed || page > 1) {
    const ip = await requestIp();
    after(() => audit(staff.user_id, 'searched', { detail: { ...sp }, ip }));
  }

  const subcommunities = [...new Set(places.map((p) => p.subcommunity))];
  const buildings = places.filter((p) => p.building).map((p) => ({ subcommunity: p.subcommunity, building: p.building as string }));

  const link = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    Object.entries(sp).forEach(([k, v]) => (Array.isArray(v) ? v : v ? [v] : []).forEach((x) => p.append(k, x)));
    Object.entries(over).forEach(([k, v]) => p.set(k, v));
    if (!('page' in over)) p.delete('page');
    return '/?' + p.toString();
  };

  return (
    <>
      <Header staff={staff} />
      <div className="head gut">
        <h1>Owners</h1>
        <p>{fmt(c.all)} units in your areas · tenancies are registered Ejari contracts loaded to the end of September 2026</p>
      </div>
      <main className="layout gut">
        <Filters sp={sp} subcommunities={subcommunities} buildings={buildings} />
        <section style={{ minWidth: 0 }}>
          <nav className="tabs">
            {TABS.map((t) => (
              <Link key={t.k} className={'tab' + (t.k === tab ? ' on' : '')} href={link({ tab: t.k })}>
                {t.l}<span className="c n">{fmt(c[t.k])}</span>
              </Link>
            ))}
          </nav>
          <div className="meta"><span>{fmt(total)} units</span><span>Page {page} of {Math.max(1, Math.ceil(total / PAGE))}</span></div>
          <div className="tw">
            <table>
              <thead><tr>
                <th><Link className={sortKey === 'unit' ? 'on' : ''} href={link({ sort: 'unit' })}>Unit</Link></th>
                <th className="r"><Link className={sortKey === 'size' ? 'on' : ''} href={link({ sort: 'size' })}>Size</Link></th>
                <th>Lease</th>
                <th><Link className={sortKey === 'end' ? 'on' : ''} href={link({ sort: 'end' })}>Contract ends</Link></th>
                <th className="r"><Link className={sortKey === 'rent' ? 'on' : ''} href={link({ sort: 'rent' })}>Rent</Link></th>
                <th className="r"><Link className={sortKey === 'sale' ? 'on' : ''} href={link({ sort: 'sale' })}>Last sale</Link></th>
                <th>Owner</th><th>Mobile</th><th>Last call</th><th></th>
              </tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={10} className="empty">Nothing matches. Try clearing a filter.</td></tr>}
                {rows.map((r) => {
                  const days = daysFromToday(r.end_date);
                  const chg = r.annual_rent && r.prev_rent ? Math.round((Number(r.annual_rent) / Number(r.prev_rent) - 1) * 100) : null;
                  const place = r.unit_type === 'Villa' ? r.subcommunity : r.building;
                  const osub = [r.owners_n > 1 ? `+${r.owners_n - 1} co-owner${r.owners_n > 2 ? 's' : ''}` : null,
                    r.owner_units > 1 ? `${r.owner_units} units here` : null, r.mortgaged ? 'mortgaged' : null].filter(Boolean).join(', ');
                  return (
                    <tr key={r.id}>
                      <td><Link className="rowlink" href={`/unit/${r.id}`}><span className="unit">{r.unit_no}</span>
                        <span className="sub">{place} · {r.unit_type === 'Villa' ? 'Villa' : 'Apt'} · {bedsLabel(r.beds)}</span></Link></td>
                      <td className="r n">{fmt(r.size_sqft)}</td>
                      <td><span className={'dot ' + (r.lease_status === 'Live Ejari' ? 't' : r.lease_status === 'No live Ejari' ? 'v' : '')} />
                        {r.lease_status === 'Not confirmed' ? <span className="muted">Not confirmed</span> : r.lease_status}
                        {r.lease_status === 'Live Ejari' && r.renewals != null && <span className="sub">{r.renewals === 0 ? 'first year' : `renewed ${r.renewals}×`}</span>}</td>
                      <td>{r.end_date ? <><span className="n">{fd(r.end_date)}</span>
                        <span className={'sub ' + (days! < 0 ? 'gone' : days! <= 90 ? 'soon' : '')}>{days! < 0 ? `ended ${-days!} days ago` : `in ${days} days`}</span></> : <span className="muted">—</span>}</td>
                      <td className="r n">{r.annual_rent ? <>{fmt(r.annual_rent)}{chg ? <span className="sub">{chg > 0 ? '+' : ''}{chg}% vs last</span> : null}</> : <span className="muted">—</span>}</td>
                      <td className="r n">{r.last_sale_price ? fmt(r.last_sale_price) : <span className="muted">—</span>}</td>
                      <td style={{ maxWidth: 230 }}>{r.owner_name ?? '—'}{osub && <span className="sub">{osub}</span>}</td>
                      <td className="ph n">{r.owner_masked ?? <span className="muted">none</span>}</td>
                      <td>{r.last_called ? <>{fd(r.last_called)}<span className="sub">{r.last_outcome ?? 'no outcome yet'}</span></> : <span className="muted">Never</span>}</td>
                      <td className="r">{r.owner_id && r.has_phone ? <CallButton unitId={r.id} ownerId={r.owner_id} label={`${r.owner_name}, ${place} ${r.unit_no}`} /> : null}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="pager">
            {page > 1 && <Link className="link" href={link({ page: String(page - 1) })}>Previous</Link>}
            {page * PAGE < total && <Link className="link" href={link({ page: String(page + 1) })}>Next</Link>}
          </div>
        </section>
      </main>
    </>
  );
}
