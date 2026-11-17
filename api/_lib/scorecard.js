// The Management scorecard: the quarter's measures, plan against actual, with a RAG status. Plans live in
// ops.scorecard_plan (one row per measure per month, money in AED), thresholds and team names in desk.settings 'scorecard'.
// Actuals all come from the Desk: the deal log (by close date), commission (v_broker_month), portal leads and people.
//
// For the month in progress, running totals are judged against the month's plan pro-rated for days elapsed; rates and
// headcount against the full figure. Same rules as the old spreadsheet scorecard.
import { sql, setting } from './core.js';

const DEFAULTS = { green: 1, amber: 0.9, leaversAllowance: 2, leasingTeam: "Callum's Team", leasingManager: 'callum.s@apexhomesdxb.com',
  commercialTeam: 'Commercial Team', bigBiller: 20000 };

// key, group, label, owner, unit, type (flow: a running total; rate; stock: a count at a point in time), lower is better
export const MEASURES = [
  ['billed', 'Results', 'Total billed', 'Billie', 'aed', 'flow'],
  ['secondary', 'Results', 'Secondary sales billed', 'Oliver, Mahan', 'aed', 'flow'],
  ['leasing', 'Results', 'Leasing team billed (not counting Callum\'s own)', 'Callum', 'aed', 'flow'],
  ['callum', 'Results', 'Callum personal billed', 'Callum', 'aed', 'flow'],
  ['offplan', 'Results', 'Off-plan billed', 'To confirm', 'aed', 'flow'],
  ['commercial', 'Results', 'Commercial billed', 'Kamil', 'aed', 'flow'],
  ['retained', 'Results', 'Retained before overrides (plan = break-even)', 'Finance', 'aed', 'flow'],
  ['leads', 'Drivers', 'Portal leads received', 'Billie', 'count', 'flow'],
  ['conversion', 'Drivers', 'Lead conversion (deals ÷ portal leads)', 'Billie', 'pct', 'rate'],
  ['deals', 'Drivers', 'Deals closed', 'Billie', 'count', 'flow'],
  ['avgDeal', 'Drivers', 'Average billed per deal', 'Billie', 'aed', 'rate'],
  ['roster', 'People', 'Brokers on the roster', 'Billie', 'count', 'stock'],
  ['hires', 'People', 'Brokers who started', 'Billie', 'count', 'flow'],
  ['leavers', 'People', 'Brokers who left', 'Billie', 'count', 'flow', true],
  ['bigBillers', 'People', 'Brokers billing over AED 20k in the month', 'Oliver, Mahan', 'count', 'stock'],
];
export const MEASURE_KEYS = new Set(MEASURES.map((m) => m[0]));

const iso = (d) => d.toISOString().slice(0, 10);
const dubaiToday = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);

// quarterStart: 'YYYY-MM-01' of any month in the quarter (defaults to this quarter)
export async function scorecard(quarterStart) {
  const S = { ...DEFAULTS, ...(await setting('scorecard', {})) };
  const today = dubaiToday();
  const base = /^\d{4}-\d{2}/.test(quarterStart || '') ? quarterStart.slice(0, 7) : today.slice(0, 7);
  const [y, m] = base.split('-').map(Number);
  const q0 = Math.floor((m - 1) / 3) * 3;   // 0-based first month of the quarter
  const months = [0, 1, 2].map((i) => iso(new Date(Date.UTC(y, q0 + i, 1))));
  const qEnd = iso(new Date(Date.UTC(y, q0 + 3, 0)));
  const t = new Date(today + 'T00:00:00Z');

  // How far through each month we are: 1 = done, 0 = not started
  const share = months.map((mo) => {
    const s = new Date(mo + 'T00:00:00Z'); const e = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 1));
    if (t >= e) return 1;
    if (t < s) return 0;
    return ((t - s) / 864e5 + 1) / ((e - s) / 864e5);
  });

  // One query at a time: the connection pool is small
  const deals = await sql`
    select to_char(d.month, 'YYYY-MM-01') as month,
      coalesce(sum(d.amount), 0)::float as billed,
      coalesce(sum(d.amount) filter (where d.deal_type = 'sale' and not d.off_plan and coalesce(ops.team_at(d.email, d.deal_date), '') <> ${S.commercialTeam}), 0)::float as secondary,
      coalesce(sum(d.amount) filter (where ops.team_at(d.email, d.deal_date) = ${S.leasingTeam} and d.email <> ${S.leasingManager}), 0)::float as leasing,
      coalesce(sum(d.amount) filter (where d.email = ${S.leasingManager}), 0)::float as callum,
      coalesce(sum(d.amount) filter (where d.off_plan), 0)::float as offplan,
      coalesce(sum(d.amount) filter (where ops.team_at(d.email, d.deal_date) = ${S.commercialTeam}), 0)::float as commercial,
      (count(*) filter (where d.counts_as_deal))::int as deals
    from ops.deals d where d.deleted_at is null and d.month = any(${months}::date[]) group by 1`;
  const bm = await sql`
    select to_char(month, 'YYYY-MM-01') as month, coalesce(sum(retained_before_overrides), 0)::float as retained,
      (count(*) filter (where billed > ${S.bigBiller}))::int as "bigBillers"
    from ops.v_broker_month where month = any(${months}::date[]) group by 1`;
  const leads = await sql`
    select to_char(date_trunc('month', lead_day), 'YYYY-MM-01') as month, count(*)::int as leads
    from ops.v_portal_leads where lead_day between ${months[0]}::date and ${qEnd}::date group by 1`;
  const people = await sql`
    select to_char(m.mo, 'YYYY-MM-01') as month,
      (select count(*) from ops.people p where p.kind in ('broker', 'manager')
         and (p.start_date is null or p.start_date <= m.asof) and (p.end_date is null or p.end_date > m.asof)
         and (p.status = 'active' or p.end_date is not null))::int as roster,
      (select count(*) from ops.people p where p.kind in ('broker', 'manager') and p.start_date >= m.mo and p.start_date < m.mo + interval '1 month')::int as hires,
      (select count(*) from ops.people p where p.kind in ('broker', 'manager') and p.end_date >= m.mo and p.end_date < m.mo + interval '1 month')::int as leavers
    from (select mo::date, least((mo + interval '1 month - 1 day')::date, ${today}::date) as asof
          from unnest(${months}::date[]) mo where mo <= ${today}::date) m`;
  const plans = await sql`select measure, to_char(month, 'YYYY-MM-01') as month, plan::float from ops.scorecard_plan where month = any(${months}::date[])`;

  const by = (rows) => Object.fromEntries(rows.map((r) => [r.month, r]));
  const D = by(deals), B = by(bm), L = by(leads), P = by(people);
  const actual = (k, mo) => {
    const d = D[mo] || {}, b = B[mo] || {}, l = L[mo] || {}, p = P[mo] || {};
    switch (k) {
      case 'conversion': return l.leads ? (d.deals || 0) / l.leads : null;
      case 'avgDeal': return d.deals ? d.billed / d.deals : null;
      case 'retained': case 'bigBillers': return b[k] ?? 0;
      case 'leads': return l.leads ?? 0;
      case 'roster': case 'hires': case 'leavers': return p[k] ?? null;
      default: return d[k] ?? 0;
    }
  };
  const planOf = (k, mo) => {
    const get = (x) => plans.find((p) => p.measure === x && p.month === mo)?.plan ?? null;
    if (k === 'deals') { const l = get('leads'), c = get('conversion'); return l != null && c != null ? l * c : get('deals'); }
    if (k === 'avgDeal') { const b = get('billed'), l = get('leads'), c = get('conversion'); return b != null && l && c ? b / (l * c) : null; }
    return get(k);
  };
  const rag = (pct, actualV, planV, lower) => {
    if (planV == null) return 'No target';
    if (actualV == null) return 'No data';
    if (lower) return actualV <= planV ? 'Green' : actualV <= planV + S.leaversAllowance ? 'Amber' : 'Red';
    return pct >= S.green ? 'Green' : pct >= S.amber ? 'Amber' : 'Red';
  };

  const rows = MEASURES.map(([key, group, label, owner, unit, type, lower]) => {
    const cells = months.map((mo, i) => {
      const started = share[i] > 0;
      const plan = planOf(key, mo);
      const toDate = plan == null ? null : type === 'flow' ? plan * share[i] : plan;
      const a = started ? actual(key, mo) : null;
      const pct = toDate ? (a ?? 0) / toDate : null;
      return { month: mo, started, done: share[i] === 1, plan, planToDate: toDate, actual: a, pct, rag: started ? rag(pct, a, toDate, lower) : '-' };
    });
    // Quarter to date
    const st = cells.filter((c) => c.started);
    let q = { plan: null, actual: null };
    if (st.length) {
      if (type === 'flow') {
        const hasPlan = st.some((c) => c.planToDate != null);
        q = { plan: hasPlan ? st.reduce((s, c) => s + (c.planToDate || 0), 0) : null, actual: st.reduce((s, c) => s + (c.actual || 0), 0) };
      } else if (type === 'stock') {
        const last = st[st.length - 1]; q = { plan: last.planToDate, actual: last.actual };
      } else {   // rates: worked out from the quarter's totals
        const sum = (k) => st.reduce((s, c) => s + (actual(k, c.month) || 0), 0);
        const sumPlan = (k) => st.reduce((s, c) => s + ((planOf(k, c.month) || 0) * (MEASURES.find((x) => x[0] === k)[5] === 'flow' ? share[months.indexOf(c.month)] : 1)), 0);
        if (key === 'conversion') q = { plan: sumPlan('leads') ? sumPlan('deals') / sumPlan('leads') : null, actual: sum('leads') ? sum('deals') / sum('leads') : null };
        if (key === 'avgDeal') q = { plan: sumPlan('deals') ? sumPlan('billed') / sumPlan('deals') : null, actual: sum('deals') ? sum('billed') / sum('deals') : null };
      }
    }
    const qpct = q.plan ? (q.actual ?? 0) / q.plan : null;
    return { key, group, label, owner, unit, type, lower: !!lower, months: cells,
      quarter: { planToDate: q.plan, actual: q.actual, pct: qpct, rag: st.length ? rag(qpct, q.actual, q.plan, lower) : '-' } };
  });

  const cur = months.findIndex((_, i) => share[i] > 0 && share[i] < 1);
  const latest = cur >= 0 ? cur : share.lastIndexOf(1);
  const count = (r) => rows.filter((x) => latest >= 0 && x.months[latest].rag === r).length;
  return {
    today, months, share, quarterLabel: `Q${q0 / 3 + 1} ${y}`, latestMonth: latest >= 0 ? months[latest] : null,
    status: { Green: count('Green'), Amber: count('Amber'), Red: count('Red'), 'No target': count('No target') },
    thresholds: { green: S.green, amber: S.amber, leaversAllowance: S.leaversAllowance },
    rows,
  };
}

// Change one plan figure (admins and directors). value null clears it.
export async function setPlan(by, measure, month, value) {
  if (!MEASURE_KEYS.has(measure)) return [400, { error: 'Unknown measure.' }];
  if (['deals', 'avgDeal'].includes(measure)) return [400, { error: 'That plan is worked out from the leads and conversion plans.' }];
  if (!/^\d{4}-\d{2}-01$/.test(String(month))) return [400, { error: 'Unknown month.' }];
  const v = value === null || value === '' ? null : Number(value);
  if (v != null && !Number.isFinite(v)) return [400, { error: 'Enter a number.' }];
  await sql`insert into ops.scorecard_plan (measure, month, plan, updated_by) values (${measure}, ${month}::date, ${v}, ${by})
            on conflict (measure, month) do update set plan = excluded.plan, updated_at = now(), updated_by = excluded.updated_by`;
  return [200, { ok: true }];
}
