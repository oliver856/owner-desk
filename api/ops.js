// Management pages: /api/ops?action=today|listings|leads|people|money
// Reads the ops schema (filled by /api/ops-sync and the deal log). "New listings" on Today and People are dated by
// when the listing was created in Kendal, so they are right from the first sync; gained/lost on Listings come from the
// change log, which starts at the first sync. Read only, and never touches a calling table
// except one indexed count of today's and this week's calls.
//
// Who gets what:
//   admin, director   everything, all teams (and the only ones who can open Money)
//   manager           Today, Listings, Leads and People for their own team
//   everyone else     "Not allowed", so the pages can't be found by guessing the address
import { sql, route, query } from './_lib/core.js';

const cache = new Map();   // short memory so flicking between pages doesn't re-run the same query
const TTL_MS = 60e3;
async function cached(key, fn) {
  const c = cache.get(key);
  if (c && c.at > Date.now() - TTL_MS) return c.v;
  const v = await fn();
  cache.set(key, { at: Date.now(), v });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return v;
}

// Which team (if any) this person is limited to. null = all teams.
async function scopeFor(staff, asked) {
  if (['admin', 'director'].includes(staff.role)) return { all: true, team: asked || null };
  if (staff.role !== 'manager') return null;
  const [r] = await sql`select ops.team_at(${String(staff.email).toLowerCase()}, ops.dubai_day(now())) as team`;
  return r?.team ? { all: false, team: r.team } : null;
}

const one = async (q) => (await q)[0]?.j;

const today = (team) => one(sql`
  with d as (select ops.dubai_day(now()) as today),
  w as (select today, date_trunc('week', today)::date as wk, (date_trunc('week', today) - interval '7 days')::date as lw,
               date_trunc('month', today)::date as mo, (today - date_trunc('week', today)::date) as dow from d),
  ppl as (select p.email, p.full_name from ops.people p, w where ${team}::text is null or ops.team_at(p.email, w.today) = ${team}),
  ok as (select ${team}::text is null as everyone)
  select json_build_object(
    'today', (select today from w), 'weekStart', (select wk from w), 'team', ${team}::text,
    'month', (select json_build_object('billed', coalesce(sum(amount), 0), 'deals', count(*) filter (where counts_as_deal))
              from ops.deals x, w, ok where x.deleted_at is null and x.month = w.mo and (ok.everyone or x.email in (select email from ppl))),
    'byTeam', (select coalesce(json_agg(t order by t.billed desc), '[]') from (
              select ops.team_at(x.email, x.deal_date) as team, sum(amount) as billed, count(*) filter (where counts_as_deal) as deals
              from ops.deals x, w, ok where x.deleted_at is null and x.month = w.mo and (ok.everyone or x.email in (select email from ppl)) group by 1) t),
    'week', json_build_object(
      'listed',   (select count(*) from ops.kendal_listings n, w, ok where n.live_since is not null and ops.dubai_day(n.created_at) >= w.wk and (ok.everyone or n.agent_email in (select email from ppl))),
      'lost',     (select count(*) from ops.listing_events e, w, ok where e.event = 'off' and e.day >= w.wk and (ok.everyone or e.agent_email in (select email from ppl))),
      'gained',   (select count(*) from ops.listing_events e, w, ok where e.event = 'live' and e.day >= w.wk and (ok.everyone or e.agent_email in (select email from ppl))),
      'leads',    (select count(*) from ops.v_portal_leads i, w, ok where i.lead_day >= w.wk and (ok.everyone or i.agent_email in (select email from ppl))),
      'viewings', (select count(*) from ops.kendal_appointments a, w, ok where a.appointment_type ilike '%view%' and a.start_day >= w.wk and a.start_day <= w.today
                    and (ok.everyone or a.team_members && (select array_agg(email) from ppl))),
      'deals',    (select count(*) from ops.deals x, w, ok where x.deleted_at is null and x.counts_as_deal and x.deal_date >= w.wk and (ok.everyone or x.email in (select email from ppl)))),
    'lastWeek', json_build_object(   -- the same days of last week, so Tuesday is compared with Tuesday
      'listed',   (select count(*) from ops.kendal_listings n, w, ok where n.live_since is not null and ops.dubai_day(n.created_at) >= w.lw and ops.dubai_day(n.created_at) <= w.lw + w.dow and (ok.everyone or n.agent_email in (select email from ppl))),
      'lost',     (select count(*) from ops.listing_events e, w, ok where e.event = 'off' and e.day >= w.lw and e.day <= w.lw + w.dow and (ok.everyone or e.agent_email in (select email from ppl))),
      'gained',   (select count(*) from ops.listing_events e, w, ok where e.event = 'live' and e.day >= w.lw and e.day <= w.lw + w.dow and (ok.everyone or e.agent_email in (select email from ppl))),
      'leads',    (select count(*) from ops.v_portal_leads i, w, ok where i.lead_day >= w.lw and i.lead_day <= w.lw + w.dow and (ok.everyone or i.agent_email in (select email from ppl))),
      'viewings', (select count(*) from ops.kendal_appointments a, w, ok where a.appointment_type ilike '%view%' and a.start_day >= w.lw and a.start_day <= w.lw + w.dow
                    and (ok.everyone or a.team_members && (select array_agg(email) from ppl))),
      'deals',    (select count(*) from ops.deals x, w, ok where x.deleted_at is null and x.counts_as_deal and x.deal_date >= w.lw and x.deal_date <= w.lw + w.dow and (ok.everyone or x.email in (select email from ppl)))),
    'live', (select count(*) from ops.kendal_listings l, ok where l.is_live and (ok.everyone or l.agent_email in (select email from ppl))),
    'calls', (select json_build_object('today', count(*) filter (where ops.dubai_day(c.called_at) = (select today from w)), 'week', count(*))
              from desk.calls c join desk.staff s on s.user_id = c.user_id, ok
              where c.called_at >= ((select wk from w)::timestamp at time zone 'Asia/Dubai') and (ok.everyone or lower(s.email) in (select email from ppl))),
    'feeds', (select coalesce(json_agg(json_build_object('feed', endpoint, 'finished', last_finished, 'status', status) order by endpoint), '[]')
              from ops.sync_state where endpoint <> '_lock'),
    'baselined', (select baselined from ops.sync_state where endpoint = 'listings')
  ) as j`);

const listings = (team) => one(sql`
  with d as (select ops.dubai_day(now()) as today),
  w as (select today, date_trunc('week', today)::date as wk, date_trunc('month', today)::date as mo from d),
  ppl as (select p.email, p.full_name from ops.people p, w where ${team}::text is null or ops.team_at(p.email, w.today) = ${team}),
  ok as (select ${team}::text is null as everyone),
  ev as (select e.* from ops.listing_events e, ok where ok.everyone or e.agent_email in (select email from ppl)),
  ll as (select l.* from ops.kendal_listings l, ok where l.is_live and (ok.everyone or l.agent_email in (select email from ppl)))
  select json_build_object(
    'live', (select count(*) from ll),
    'liveSale', (select count(*) from ll where market_type ilike '%sale%' or market_type ilike '%sell%' or market_type ilike '%buy%'),
    'weeks', (select coalesce(json_agg(x order by x.week desc), '[]') from (
        select date_trunc('week', day)::date as week, count(*) filter (where event = 'live') as gained,
               count(*) filter (where event = 'live' and reason = 'New listing') as new, count(*) filter (where event = 'off') as lost
        from ev, w where day >= w.wk - 77 group by 1) x),
    'months', (select coalesce(json_agg(x order by x.month desc), '[]') from (
        select date_trunc('month', day)::date as month, count(*) filter (where event = 'live') as gained,
               count(*) filter (where event = 'live' and reason = 'New listing') as new, count(*) filter (where event = 'off') as lost
        from ev group by 1) x),
    'reasons', (select coalesce(json_agg(x order by x.n desc), '[]') from (
        select coalesce(reason, 'Other') as reason, count(*) as n from ev, w where event = 'off' and day >= w.mo group by 1) x),
    'brokers', (select coalesce(json_agg(x order by x.live desc, x.name), '[]') from (
        select coalesce(p.full_name, a.agent_email) as name, a.agent_email as email, a.live,
               coalesce(f.gw, 0) as "gainedWeek", coalesce(f.lw, 0) as "lostWeek", coalesce(f.gm, 0) as "gainedMonth", coalesce(f.lm, 0) as "lostMonth"
        from (select coalesce(agent_email, '') as agent_email, count(*) as live from ll group by 1
              union select coalesce(agent_email, ''), 0 from ev, w where day >= w.mo and coalesce(agent_email, '') not in (select coalesce(agent_email, '') from ll) group by 1) a
        left join ops.people p on p.email = a.agent_email
        left join (select coalesce(agent_email, '') as agent_email,
                     count(*) filter (where event = 'live' and day >= w.wk) as gw, count(*) filter (where event = 'off' and day >= w.wk) as lw,
                     count(*) filter (where event = 'live' and day >= w.mo) as gm, count(*) filter (where event = 'off' and day >= w.mo) as lm
                   from ev, w group by 1) f on f.agent_email = a.agent_email) x),
    'recent', (select coalesce(json_agg(x order by x.at desc), '[]') from (
        select e.at, e.day, e.listing_id as ref, e.event, e.reason, coalesce(p.full_name, e.agent_email) as broker,
               coalesce(l.building, l.locality, l.title) as place, l.beds
        from ev e left join ops.people p on p.email = e.agent_email left join ops.kendal_listings l on l.listing_id = e.listing_id
        order by e.at desc limit 60) x),
    'baselined', (select baselined from ops.sync_state where endpoint = 'listings'),
    'since', (select min(day) from ops.listing_events),
    'synced', (select last_finished from ops.sync_state where endpoint = 'listings')
  ) as j`);

const leads = (team) => one(sql`
  with d as (select ops.dubai_day(now()) as today),
  w as (select today, date_trunc('month', today)::date as mo from d),
  ppl as (select p.email, p.full_name from ops.people p, w where ${team}::text is null or ops.team_at(p.email, w.today) = ${team}),
  ok as (select ${team}::text is null as everyone),
  i as (select q.* from ops.kendal_inquiries q, ok, w where q.is_genuine and q.lead_day >= least(w.mo, w.today - 7)
          and (ok.everyone or q.agent_email in (select email from ppl)))
  select json_build_object(
    'channels', (select coalesce(json_agg(x order by x.month desc), '[]') from (
        select channel, count(*) filter (where lead_day = w.today) as today, count(*) filter (where lead_day = w.today - 1) as yesterday,
               count(*) filter (where lead_day > w.today - 7) as week, count(*) filter (where lead_day >= w.mo) as month
        from i, w group by 1) x),
    'brokers', (select coalesce(json_agg(x order by x.month desc, x.name), '[]') from (
        select coalesce(p.full_name, nullif(i.agent_email, ''), 'Unassigned') as name,
               count(*) filter (where channel in ('bayut', 'pf') and lead_day = w.today - 1) as yesterday,
               count(*) filter (where channel in ('bayut', 'pf') and lead_day > w.today - 7) as week,
               count(*) filter (where channel in ('bayut', 'pf') and lead_day >= w.mo) as month,
               count(*) filter (where channel = 'bayut' and lead_day >= w.mo) as bayut,
               count(*) filter (where channel = 'pf' and lead_day >= w.mo) as pf,
               count(*) filter (where channel = 'owner_desk' and lead_day >= w.mo) as "ownerDesk",
               count(*) filter (where call_status = 'missed' and lead_day > w.today - 7) as "missedWeek"
        from i left join ops.people p on p.email = i.agent_email, w group by 1) x),
    'missed', (select coalesce(json_agg(x order by x.at desc), '[]') from (
        select i.lead_at as at, i.channel, coalesce(p.full_name, i.agent_email) as broker, i.listing_id as ref
        from i left join ops.people p on p.email = i.agent_email, w
        where i.call_status = 'missed' and i.lead_day > w.today - 7 order by i.lead_at desc limit 60) x),
    'synced', (select last_finished from ops.sync_state where endpoint = 'inquiries')
  ) as j`);

const people = (team, period) => one(sql`
  with d as (select ops.dubai_day(now()) as today),
  w as (select today, case when ${period} = 'month' then date_trunc('month', today)::date else date_trunc('week', today)::date end as fr,
               date_trunc('month', today)::date as mo from d),
  ppl as (select p.email, p.full_name, p.broker_type, ops.team_at(p.email, w.today) as team, ops.role_at(p.email, w.today) as role
          from ops.people p, w where p.status = 'active' and p.kind in ('broker', 'manager') and not p.hide_from_kpi
            and (${team}::text is null or ops.team_at(p.email, w.today) = ${team}))
  select json_build_object('period', ${period}::text, 'from', (select fr from w), 'rows', (select coalesce(json_agg(x order by x.name), '[]') from (
    select p.full_name as name, p.email, p.team, p.role, p.broker_type as type,
      (select count(*) from ops.kendal_listings n, w where n.agent_email = p.email and n.live_since is not null and ops.dubai_day(n.created_at) >= w.fr) as listed,
      (select count(*) from ops.kendal_listings l where l.agent_email = p.email and l.is_live) as stock,
      (select count(*) from ops.v_portal_leads i, w where i.agent_email = p.email and i.lead_day >= w.fr) as leads,
      (select count(*) from ops.kendal_appointments a, w where a.appointment_type ilike '%view%' and a.start_day >= w.fr and a.start_day <= w.today and p.email = any(a.team_members)) as viewings,
      (select count(*) from ops.deals x, w where x.email = p.email and x.deleted_at is null and x.counts_as_deal and x.deal_date >= w.fr) as deals,
      (select coalesce(sum(amount), 0) from ops.deals x, w where x.email = p.email and x.deleted_at is null and x.month = w.mo) as billed,
      (select count(*) from desk.calls c join desk.staff s on s.user_id = c.user_id, w
         where lower(s.email) = p.email and c.called_at >= (w.fr::timestamp at time zone 'Asia/Dubai')) as calls
    from ppl p) x)) as j`);

const money = (month) => one(sql`
  select json_build_object(
    'months', (select coalesce(json_agg(json_build_object('month', month, 'billed', billed, 'deals', deals, 'payout', payout,
                 'retained', retained_before_overrides) order by month desc), '[]') from ops.v_month),
    'month', ${month}::date,
    'brokers', (select coalesce(json_agg(x order by x.billed desc), '[]') from (
        select coalesce(p.full_name, b.email) as name, b.team, b.role, b.billed, b.deals, b.rate, b.payout, b.retained_before_overrides as retained
        from ops.v_broker_month b left join ops.people p on p.email = b.email where b.month = ${month}::date) x),
    'deals', (select coalesce(json_agg(x order by x.deal_date desc, x.id desc), '[]') from (
        select x.id, x.deal_date, coalesce(p.full_name, x.email) as name, x.amount, x.deal_type as type, x.split_id is not null as split, x.property
        from ops.deals x left join ops.people p on p.email = x.email where x.deleted_at is null and x.month = ${month}::date) x)
  ) as j`);

export const _test = { today, listings, leads, people, money };

export default route(async (req, res, staff) => {
  if (req.method && req.method !== 'GET') return res.status(405).end();
  const q = query(req);
  const action = q.get('action');
  const sc = await scopeFor(staff, q.get('team'));
  if (!sc) return res.status(403).json({ error: 'Not allowed.' });
  const key = (...p) => [action, sc.team || '*', ...p].join('|');

  if (action === 'access') {
    const teams = sc.all ? (await sql`select name from ops.teams where active order by sort, name`).map((t) => t.name) : [sc.team];
    return res.json({ all: sc.all, team: sc.team, teams, money: sc.all });
  }
  if (action === 'today') return res.json(await cached(key(), () => today(sc.team)));
  if (action === 'listings') return res.json(await cached(key(), () => listings(sc.team)));
  if (action === 'leads') return res.json(await cached(key(), () => leads(sc.team)));
  if (action === 'people') {
    const period = q.get('period') === 'month' ? 'month' : 'week';
    return res.json(await cached(key(period), () => people(sc.team, period)));
  }
  if (action === 'money') {
    if (!sc.all) return res.status(403).json({ error: 'Not allowed.' });
    const m = /^\d{4}-\d{2}$/.test(q.get('month') || '') ? q.get('month') + '-01' : new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 7) + '-01';
    return res.json(await cached(key(m), () => money(m)));
  }
  res.status(400).json({ error: 'Unknown action' });
});
