// The Friday meeting slides: every figure the deck shows, in one JSON object. Read only.
//   targets        desk.meeting_targets (migration 022), billed from ops.deals by close month
//   KPIs + flags   the last 7 full days (to yesterday), rules in mkt.settings 'meeting_flags'
//   listings       mkt.listing_check_cache (Listings tab), leads per listing, mkt.listing_price_drops (021)
//   actions        desk.meeting_actions: an action starting "Issue:" is shown as an issue
// Managers get their own team only; admins and directors everyone.
import { sql } from './core.js';
import { mondayOf } from './meeting.js';

// Every broker gets the first of these in their funnel. 'nolisting' is on top of that: anyone judged on stock
// who hasn't put a listing live this month is on that list whatever their other flag.
const FLAGS = [
  ['calls', 'Low stock, not calling', 'Call-out session'],
  ['pitch', 'Calling, not winning listings', 'Owner pitch session'],
  ['listings', 'Underperforming listings', 'Underperforming listings conversation'],
  ['leads', 'Leads, few viewings logged', 'Lead follow-up / CRM compliance'],
  ['closing', 'Viewings, no deals', 'Closing session'],
  ['nodeal', 'No deal in 60 days', '1:1 with Billie'],
  ['nolisting', 'No new listing this month', 'Listing plan with their manager'],
];

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
// Monday to Saturday from `from` to `to`, both included
const workingDays = (from, to) => { let n = 0; for (let d = from; d <= to; d = addDays(d, 1)) if (new Date(d + 'T12:00:00Z').getUTCDay() !== 0) n++; return n; };

export async function slides(sc) {
  const [{ today }] = await sql`select ops.dubai_day(now())::text as today`;
  const mo = today.slice(0, 8) + '01';
  const qStartMonth = Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1;
  const qs = `${today.slice(0, 4)}-${String(qStartMonth).padStart(2, '0')}-01`;
  const qe = addDays(`${today.slice(0, 4)}-${String(qStartMonth + 2).padStart(2, '0')}-01`, 0);
  const monthEnd = addDays(iso(new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7), 1))), -1);
  const quarterEnd = addDays(iso(new Date(Date.UTC(+today.slice(0, 4), qStartMonth + 2, 1))), -1);
  const yest = addDays(today, -1), wk = addDays(today, -7);   // the last 7 full days
  const [{ value: R }] = await sql`select value from mkt.settings where key = 'meeting_flags'`;
  const team = sc.all ? null : sc.team;

  // ── Scorecards ──
  const targets = await sql`select month::text, label, scope, team, email, target::float8 as target, sort
                            from desk.meeting_targets where month between ${qs}::date and ${qe}::date order by sort, label`;
  const billedRows = await sql`
    select month::text, ops.team_at(email, deal_date) as team, lower(email) as email,
           sum(amount)::float8 as billed, count(*) filter (where counts_as_deal)::int as deals
    from ops.deals where deleted_at is null and month between ${qs}::date and ${qe}::date group by 1, 2, 3`;
  const billedFor = (t, months) => billedRows.filter((b) => months.includes(b.month)
      && (t.scope === 'company' || (t.scope === 'team' && b.team === t.team) || (t.scope === 'person' && b.email === String(t.email).toLowerCase())))
    .reduce((a, b) => ({ billed: a.billed + b.billed, deals: a.deals + b.deals }), { billed: 0, deals: 0 });
  const visible = (t) => !team || t.scope === 'company' || t.team === team || (t.scope === 'person' && billedRows.some((b) => b.email === String(t.email).toLowerCase() && b.team === team));
  const daysInMonth = +monthEnd.slice(8, 10), dayOfMonth = +today.slice(8, 10);
  const qDays = (new Date(quarterEnd) - new Date(qs)) / 864e5 + 1, qDay = (new Date(today) - new Date(qs)) / 864e5 + 1;
  const wdLeft = workingDays(today, monthEnd);
  const monthsLeft = 3 - Math.floor((Number(today.slice(5, 7)) - qStartMonth));
  const month = targets.filter((t) => t.month === mo && visible(t)).map((t) => {
    const b = billedFor(t, [mo]);
    return { label: t.label, scope: t.scope, target: t.target, billed: b.billed, deals: b.deals, needed: Math.max(0, t.target - b.billed),
             perDay: wdLeft ? Math.max(0, t.target - b.billed) / wdLeft : null };
  });
  const qMonths = [...new Set(targets.map((t) => t.month))];
  const quarter = [...new Map(targets.filter(visible).map((t) => [t.label, t])).values()].map((t0) => {
    const tgt = targets.filter((t) => t.label === t0.label).reduce((a, t) => a + t.target, 0);
    const b = billedFor(t0, qMonths);
    return { label: t0.label, scope: t0.scope, target: tgt, billed: b.billed, deals: b.deals, needed: Math.max(0, tgt - b.billed),
             perMonth: monthsLeft ? Math.max(0, tgt - b.billed) / monthsLeft : null };
  });
  const [mDeals] = await sql`select count(*) filter (where counts_as_deal and type = 'sale')::int as sales, count(*) filter (where counts_as_deal and type <> 'sale')::int as rentals
                              from ops.deals where deleted_at is null and month = ${mo}::date
                                and (${team}::text is null or ops.team_at(email, deal_date) = ${team})`.catch(() => [null]);

  // ── People: the last 7 full days ──
  const ppl = await sql`
    with p as (select p.email, p.full_name, p.broker_type, p.start_date, ops.team_at(p.email, ${yest}::date) as team
               from ops.people p where p.status = 'active' and p.kind in ('broker', 'manager') and not p.hide_from_kpi
                 and (${team}::text is null or ops.team_at(p.email, ${yest}::date) = ${team}))
    select p.email, p.full_name as name, p.broker_type as type, p.start_date::text as start, p.team,
      (select count(*)::int from desk.calls c join desk.staff s on s.user_id = c.user_id
         where lower(s.email) = p.email and c.called_at >= (${addDays(wk, 1)}::date::timestamp at time zone 'Asia/Dubai')
           and c.called_at < (${today}::date::timestamp at time zone 'Asia/Dubai')) as calls,
      (select count(*)::int from ops.kendal_listings n where n.agent_email = p.email and n.live_since is not null
         and ops.dubai_day(n.created_at) > ${wk}::date and ops.dubai_day(n.created_at) <= ${yest}::date) as listed,
      (select count(*)::int from ops.kendal_listings n where n.agent_email = p.email and n.live_since is not null
         and ops.dubai_day(n.created_at) >= ${mo}::date) as listed_month,
      (select count(*)::int from ops.kendal_listings l where l.agent_email = p.email and l.is_live) as stock,
      (select count(*)::int from ops.v_portal_leads i where i.agent_email = p.email and i.lead_day > ${wk}::date and i.lead_day <= ${yest}::date) as leads,
      (select count(*)::int from ops.kendal_appointments a where a.appointment_type ilike '%view%' and p.email = any(a.team_members)
         and a.start_day > ${wk}::date and a.start_day <= ${yest}::date) as viewings,
      (select count(*)::int from ops.kendal_appointments a where a.appointment_type ilike '%view%' and p.email = any(a.team_members)
         and a.start_day > ${addDays(today, -31)}::date and a.start_day <= ${yest}::date) as viewings30,
      (select count(*)::int from ops.deals x where x.email = p.email and x.deleted_at is null and x.counts_as_deal and x.deal_date > ${addDays(today, -31)}::date) as deals30,
      (select count(*)::int from ops.deals x where x.email = p.email and x.deleted_at is null and x.counts_as_deal and x.deal_date > ${addDays(today, -61)}::date) as deals60
    from p order by p.team, p.full_name`;

  // Listings per broker: underperforming = overpriced on the price check, or live 14+ days with under 5 leads in 14 days
  const lst = await sql`
    with ld as (select i.listing_id, count(*) as n from ops.v_portal_leads i
                where i.lead_day > ${addDays(today, -(R.low_leads_days + 1))}::date group by 1),
    l as (select k.listing_id, k.agent_email, k.live_since, coalesce(ld.n, 0) as leads14
          from ops.kendal_listings k left join ld using (listing_id) where k.is_live)
    select l.listing_id as id, lower(l.agent_email) as email, l.leads14::int,
           (l.live_since is not null and l.live_since < now() - make_interval(days => ${R.low_leads_days}::int)) as settled,
           c.verdict, c.gap_pct::float8 as gap, c.listed, c.target, c.purpose, c.kind, c.beds, coalesce(c.building, c.sub_community, c.title) as building
    from l left join mkt.listing_check_cache c using (listing_id)`;
  const drops = await sql`select listing_id as id, was, now_price from mkt.listing_price_drops(7)`.catch(() => []);
  const [{ history_from: priceFrom } = {}] = await sql`select min(day)::text as history_from from mkt.listing_price_log`.catch(() => [{}]);
  const dropSet = new Set(drops.map((d) => d.id));
  const byBroker = new Map();
  for (const l of lst) {
    const under = l.verdict === 'well' || l.verdict === 'reduce';
    const low = l.settled && l.leads14 < R.low_leads;
    const b = byBroker.get(l.email) || { live: 0, over: 0, low: 0, bad: 0, drops: 0, worst: null };
    b.live++; if (under) b.over++; if (low) b.low++; if (under || low) b.bad++; if (dropSet.has(l.id)) b.drops++;
    const why = under ? `price +${Math.round(l.gap)}%` : low ? `${l.leads14} lead${l.leads14 === 1 ? '' : 's'} in ${R.low_leads_days} days` : null;
    const score = under ? 100 + l.gap : low ? 50 - l.leads14 : -1;
    if (why && (!b.worst || score > b.worst.score)) b.worst = { score, text: `${l.building || l.id}${l.beds != null ? ' ' + (l.beds === 0 ? 'studio' : l.beds + ' bed') : ''} · ${why}` };
    byBroker.set(l.email, b);
  }

  const callTarget = R.calls_a_day * R.working_days;
  const lowShare = R.low_stock_share ?? 0.5;
  const inGroup = (b, key) => (key === 'nolisting' ? b.noListing : b.flag === key);
  const brokers = ppl.map((p) => {
    const kind = ['apartment', 'villa'].includes(p.type) ? p.type : null;   // off-plan and commercial aren't judged on stock
    const L = byBroker.get(p.email) || { live: 0, over: 0, low: 0, bad: 0, drops: 0, worst: null };
    const k = kind ? { listed: R.listed_week[kind], stock: R.stock[kind] } : null;
    const settled = !p.start || p.start <= addDays(today, -R.settled_days);
    let flag = null;
    // low stock is well under the KPI (under half by default: 12 of 25, 5 of 12), not just one or two short
    if (k && p.stock < k.stock * lowShare && p.calls < callTarget) flag = 'calls';
    else if (k && p.calls >= callTarget && p.listed < k.listed) flag = 'pitch';
    else if (k && L.live > 0 && L.bad >= Math.ceil(L.live * R.underperforming_share)) flag = 'listings';
    else if (p.leads >= R.leads_week_high && p.viewings < R.viewings_week) flag = 'leads';
    else if (p.viewings30 >= R.viewings_30_high && p.deals30 === 0) flag = 'closing';
    else if (settled && p.deals60 === 0) flag = 'nodeal';
    const noListing = !!k && p.listed_month === 0;
    return { ...p, kind, k, ...L, worst: L.worst?.text || '', flag, noListing,
      met: { calls: p.calls >= callTarget, listed: k ? p.listed >= k.listed : null, stock: k ? p.stock >= k.stock : null, viewings: p.viewings >= R.viewings_week } };
  });

  const order = (await sql`select name from ops.teams order by sort, name`).map((t) => t.name);
  const teams = [...new Set(brokers.map((b) => b.team || 'No team'))].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  const kpis = teams.map((t) => {
    const bs = brokers.filter((b) => (b.team || 'No team') === t);
    const judged = bs.filter((b) => b.k);
    return { team: t, brokers: bs.length,
      calls: [bs.filter((b) => b.met.calls).length, bs.length], listed: [judged.filter((b) => b.met.listed).length, judged.length],
      stock: [judged.filter((b) => b.met.stock).length, judged.length], viewings: [bs.filter((b) => b.met.viewings).length, bs.length] };
  });
  const totals = {
    calls: brokers.reduce((a, b) => a + b.calls, 0), callsTarget: brokers.length * callTarget,
    listed: brokers.reduce((a, b) => a + b.listed, 0), listedTarget: brokers.reduce((a, b) => a + (b.k?.listed || 0), 0),
    viewings: brokers.reduce((a, b) => a + b.viewings, 0), viewingsTarget: brokers.length * R.viewings_week,
    drops: drops.filter((d) => brokers.some((b) => byBroker.get(b.email))).length,
  };

  const groups = FLAGS.map(([key, name, session]) => ({ key, name, session,
    brokers: brokers.filter((b) => inGroup(b, key)).map((b) => ({ name: b.name, team: b.team, type: b.type, stock: b.stock, stockTarget: b.k?.stock ?? null,
      listedMonth: b.listed_month,
      callsPerDay: Math.round(b.calls / R.working_days), listed: b.listed, listedTarget: b.k?.listed ?? null, leads: b.leads, viewings: b.viewings,
      viewings30: b.viewings30, live: b.live, bad: b.bad, over: b.over, low: b.low, worst: b.worst })) }));
  const flagByTeam = FLAGS.map(([key]) => teams.map((t) => brokers.filter((b) => inGroup(b, key) && (b.team || 'No team') === t).length));

  // ── Listings health by team ──
  const teamOf = new Map(brokers.map((b) => [b.email, b.team || 'No team']));
  const health = teams.map((t) => {
    const ls = lst.filter((l) => teamOf.get(l.email) === t);
    return { team: t, live: ls.length, checked: ls.filter((l) => l.verdict && l.verdict !== 'nee').length,
      over: ls.filter((l) => l.verdict === 'well' || l.verdict === 'reduce').length,
      low: ls.filter((l) => l.settled && l.leads14 < R.low_leads).length, drops: ls.filter((l) => dropSet.has(l.id)).length };
  });
  const worst = lst.filter((l) => (l.verdict === 'well' || l.verdict === 'reduce') && teamOf.has(l.email))
    .sort((a, b) => b.gap - a.gap).slice(0, 3)
    .map((l) => ({ building: l.building, beds: l.beds, kind: l.kind, purpose: l.purpose, listed: l.listed, target: l.target, gap: l.gap,
                   broker: brokers.find((b) => b.email === l.email)?.name || '' }));

  // ── Actions and issues ──
  const thisWeek = mondayOf(today);
  const acts = await sql`select a.body, a.owner, a.due::text, a.week::text, a.done_at is not null as done
                         from desk.meeting_actions a where a.removed_at is null order by a.week, a.id`;
  const isIssue = (a) => /^issue\s*:/i.test(a.body);
  const clean = (a) => ({ ...a, body: a.body.replace(/^issue\s*:\s*/i, '') });

  return {
    today, month: mo, monthEnd, quarterStart: qs, quarterEnd, team,
    pace: { month: dayOfMonth / daysInMonth, quarter: qDay / qDays }, workingDaysLeft: wdLeft, monthsLeft,
    monthScore: month, quarterScore: quarter, monthDeals: mDeals,
    rules: { ...R, low_stock_share: lowShare }, callTarget, kpis, totals, groups, flagTeams: teams, flagByTeam, flagged: brokers.filter((b) => b.flag || b.noListing).length, brokerCount: brokers.length,
    health, worst, priceFrom: priceFrom || null,
    lastWeek: acts.filter((a) => a.week < thisWeek && !isIssue(a)).map(clean),
    issues: acts.filter((a) => a.week === thisWeek && isIssue(a)).map(clean),
    actions: acts.filter((a) => a.week === thisWeek && !isIssue(a)).map(clean),
  };
}
