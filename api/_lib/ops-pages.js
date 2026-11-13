// Management pages, read side: one query per page, each returning the whole page as one JSON object.
// Every number here comes from the ops schema (filled by /api/ops-sync and the deal log) through the shared
// definitions in the migrations, so a figure means the same thing on every page. Read only.
// "New listings" on Today and People are dated by when the listing was created in Kendal; gained and lost on
// Listings come from the change log, which starts at the first sync.
import { sql } from './core.js';

export const one = async (q) => (await q)[0]?.j;

export const today = (team) => one(sql`
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
    'targets', (select coalesce(json_agg(t order by t.target desc), '[]') from (
              select distinct a.scope, a.team, a.target, a.counts_to_target as billed, a.target_includes_own as "includesOwn", a.period_from as "from", a.period_to as "to"
              from ops.v_agreement_progress a, w where w.today between a.period_from and a.period_to
                and (${team}::text is null or a.team = ${team})) t),
    'feeds', (select coalesce(json_agg(json_build_object('feed', endpoint, 'finished', last_finished, 'status', status) order by endpoint), '[]')
              from ops.sync_state where endpoint <> '_lock'),
    'baselined', (select baselined from ops.sync_state where endpoint = 'listings')
  ) as j`);

export const listings = (team) => one(sql`
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

export const leads = (team) => one(sql`
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

export const people = (team, period) => one(sql`
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

// Billed and deal counts only. Commission, retained and overrides are worked out in the database (ops.v_broker_month)
// but are not sent to the page until they have been checked against deals worked by hand.
export const money = (month) => one(sql`
  select json_build_object(
    'months', (select coalesce(json_agg(json_build_object('month', month, 'billed', billed, 'deals', deals) order by month desc), '[]') from ops.v_month),
    'month', ${month}::date,
    'brokers', (select coalesce(json_agg(x order by x.billed desc), '[]') from (
        select coalesce(p.full_name, b.email) as name, b.email, b.team, b.role, b.billed, b.deals
        from ops.v_broker_month b left join ops.people p on p.email = b.email where b.month = ${month}::date) x)
  ) as j`);
