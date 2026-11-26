// Management pages, read side: one query per page, each returning the whole page as one JSON object.
// Every number here comes from the ops schema (filled by /api/ops-sync and the deal log) through the shared
// definitions in the migrations, so a figure means the same thing on every page. Read only.
// "New listings" on Today and People are dated by when the listing was created in Kendal; gained and lost on
// Listings come from the change log, which starts at the first sync.
import { sql } from './core.js';

export const one = async (q) => (await q)[0]?.j;

// The period a page is looking at: this week (from Monday) or this month (from the 1st), up to today, and the same
// number of days at the start of the period before, so Tuesday is compared with Tuesday and the 12th with the 12th.
const span = (period) => sql`
  d as (select ops.dubai_day(now()) as today),
  w as (select today, fr, pfr, least(pfr + (today - fr), fr - 1) as pto, date_trunc('month', today)::date as mo, date_trunc('week', today)::date as wk
        from (select today,
                case when ${period} = 'month' then date_trunc('month', today)::date else date_trunc('week', today)::date end as fr,
                case when ${period} = 'month' then (date_trunc('month', today) - interval '1 month')::date else (date_trunc('week', today) - interval '7 days')::date end as pfr
              from d) x)`;
const isMonth = (period) => sql`(${period} = 'month')`;

export const today = (team, period = 'week') => one(sql`
  with ${span(period)},
  ppl as (select p.email, p.full_name from ops.people p, w where ${team}::text is null or ops.team_at(p.email, w.today) = ${team}),
  ok as (select ${team}::text is null as everyone),
  dl as (select x.* from ops.deals x, ok where x.deleted_at is null and (ok.everyone or x.email in (select email from ppl))),
  -- billed this period: by deal month for a month (so it matches Money), by close date for a week
  dn as (select dl.* from dl, w where case when ${isMonth(period)} then dl.month = w.fr else dl.deal_date between w.fr and w.today end),
  dp as (select dl.* from dl, w where case when ${isMonth(period)} then dl.month = w.pfr and dl.deal_date <= w.pto else dl.deal_date between w.pfr and w.pto end),
  figs as (select f.which, f.a, f.b from w, lateral (values ('now', w.fr, w.today), ('before', w.pfr, w.pto)) f(which, a, b))
  select json_build_object(
    'today', (select today from w), 'from', (select fr from w), 'before', (select pfr from w), 'beforeTo', (select pto from w),
    'period', ${period}::text, 'team', ${team}::text,
    'figs', (select json_object_agg(f.which, json_build_object(
      'billed',   case when f.which = 'now' then (select coalesce(sum(amount), 0) from dn) else (select coalesce(sum(amount), 0) from dp) end,
      'deals',    case when f.which = 'now' then (select count(*) filter (where counts_as_deal) from dn) else (select count(*) filter (where counts_as_deal) from dp) end,
      'listed',   (select count(*) from ops.kendal_listings n, ok where n.live_since is not null and ops.dubai_day(n.created_at) between f.a and f.b and (ok.everyone or n.agent_email in (select email from ppl))),
      'lost',     (select count(*) from ops.listing_events e, ok where e.event = 'off' and e.day between f.a and f.b and (ok.everyone or e.agent_email in (select email from ppl))),
      'gained',   (select count(*) from ops.listing_events e, ok where e.event = 'live' and e.day between f.a and f.b and (ok.everyone or e.agent_email in (select email from ppl))),
      'leads',    (select count(*) from ops.v_portal_leads i, ok where i.lead_day between f.a and f.b and (ok.everyone or i.agent_email in (select email from ppl))),
      'viewings', (select count(*) from ops.kendal_appointments a, ok where a.appointment_type ilike '%view%' and a.start_day between f.a and f.b
                    and (ok.everyone or a.team_members && (select array_agg(email) from ppl))),
      'calls',    (select count(*) from desk.calls c join desk.staff s on s.user_id = c.user_id, ok
                    where c.called_at >= (f.a::timestamp at time zone 'Asia/Dubai') and c.called_at < ((f.b + 1)::timestamp at time zone 'Asia/Dubai')
                      and (ok.everyone or lower(s.email) in (select email from ppl)))))
      from figs f),
    'callsToday', (select count(*) from desk.calls c join desk.staff s on s.user_id = c.user_id, ok, w
                    where c.called_at >= (w.today::timestamp at time zone 'Asia/Dubai') and (ok.everyone or lower(s.email) in (select email from ppl))),
    'live', (select count(*) from ops.kendal_listings l, ok where l.is_live and (ok.everyone or l.agent_email in (select email from ppl))),
    'byTeam', (select coalesce(json_agg(t order by t.billed desc), '[]') from (
              select ops.team_at(dn.email, dn.deal_date) as team, sum(amount) as billed, count(*) filter (where counts_as_deal) as deals from dn group by 1) t),
    'targets', (select coalesce(json_agg(t order by t.target desc), '[]') from (
              select distinct a.scope, a.team, a.target, a.counts_to_target as billed, a.target_includes_own as "includesOwn", a.period_from as "from", a.period_to as "to"
              from ops.v_agreement_progress a, w where w.today between a.period_from and a.period_to
                and (${team}::text is null or a.team = ${team})) t),
    'feeds', (select coalesce(json_agg(json_build_object('feed', endpoint, 'finished', last_finished, 'status', status) order by endpoint), '[]')
              from ops.sync_state where endpoint <> '_lock'),
    'baselined', (select baselined from ops.sync_state where endpoint = 'listings')
  ) as j`);

export const listings = (team, period = 'week') => one(sql`
  with ${span(period)},
  ppl as (select p.email, p.full_name from ops.people p, w where ${team}::text is null or ops.team_at(p.email, w.today) = ${team}),
  ok as (select ${team}::text is null as everyone),
  ev as (select e.* from ops.listing_events e, ok where ok.everyone or e.agent_email in (select email from ppl)),
  ll as (select l.* from ops.kendal_listings l, ok where l.is_live and (ok.everyone or l.agent_email in (select email from ppl)))
  select json_build_object(
    'period', ${period}::text, 'from', (select fr from w),
    'live', (select count(*) from ll),
    'liveSale', (select count(*) from ll where market_type ilike '%sale%' or market_type ilike '%sell%' or market_type ilike '%buy%'),
    'history', (select coalesce(json_agg(x order by x.start desc), '[]') from (
        select case when ${isMonth(period)} then date_trunc('month', day)::date else date_trunc('week', day)::date end as start,
               count(*) filter (where event = 'live') as gained,
               count(*) filter (where event = 'live' and reason = 'New listing') as new, count(*) filter (where event = 'off') as lost
        from ev, w where day >= case when ${isMonth(period)} then (w.fr - interval '11 months')::date else w.fr - 77 end group by 1) x),
    'reasons', (select coalesce(json_agg(x order by x.n desc), '[]') from (
        select coalesce(reason, 'Other') as reason, count(*) as n from ev, w where event = 'off' and day >= w.fr group by 1) x),
    'brokers', (select coalesce(json_agg(x order by x.live desc, x.name), '[]') from (
        select coalesce(p.full_name, a.agent_email) as name, a.agent_email as email, a.live,
               coalesce(f.g, 0) as gained, coalesce(f.l, 0) as lost
        from (select coalesce(agent_email, '') as agent_email, count(*) as live from ll group by 1
              union select coalesce(agent_email, ''), 0 from ev, w where day >= w.fr and coalesce(agent_email, '') not in (select coalesce(agent_email, '') from ll) group by 1) a
        left join ops.people p on p.email = a.agent_email
        left join (select coalesce(agent_email, '') as agent_email,
                     count(*) filter (where event = 'live' and day >= w.fr) as g, count(*) filter (where event = 'off' and day >= w.fr) as l
                   from ev, w group by 1) f on f.agent_email = a.agent_email) x),
    'recent', (select coalesce(json_agg(x order by x.at desc), '[]') from (
        select e.at, e.day, e.listing_id as ref, e.event, e.reason, coalesce(p.full_name, e.agent_email) as broker,
               coalesce(l.building, l.locality, l.title) as place, l.beds
        from ev e left join ops.people p on p.email = e.agent_email left join ops.kendal_listings l on l.listing_id = e.listing_id, w
        where e.day >= w.fr order by e.at desc limit 80) x),
    'baselined', (select baselined from ops.sync_state where endpoint = 'listings'),
    'since', (select min(day) from ops.listing_events),
    'synced', (select last_finished from ops.sync_state where endpoint = 'listings')
  ) as j`);

export const leads = (team, period = 'week') => one(sql`
  with ${span(period)},
  ppl as (select p.email, p.full_name from ops.people p, w where ${team}::text is null or ops.team_at(p.email, w.today) = ${team}),
  ok as (select ${team}::text is null as everyone),
  i as (select q.* from ops.kendal_inquiries q, ok, w where q.is_genuine and q.lead_day >= w.pfr
          and (ok.everyone or q.agent_email in (select email from ppl)))
  select json_build_object(
    'period', ${period}::text, 'from', (select fr from w), 'today', (select today from w),
    'channels', (select coalesce(json_agg(x order by x.now desc), '[]') from (
        select channel, count(*) filter (where lead_day >= w.fr) as now, count(*) filter (where lead_day between w.pfr and w.pto) as before,
               count(*) filter (where lead_day = w.today) as today
        from i, w group by 1) x),
    'brokers', (select coalesce(json_agg(x order by x.portal desc, x.name), '[]') from (
        select coalesce(p.full_name, nullif(i.agent_email, ''), 'Unassigned') as name,
               count(*) filter (where channel in ('bayut', 'pf') and lead_day >= w.fr) as portal,
               count(*) filter (where channel = 'bayut' and lead_day >= w.fr) as bayut,
               count(*) filter (where channel = 'pf' and lead_day >= w.fr) as pf,
               count(*) filter (where channel = 'owner_desk' and lead_day >= w.fr) as "ownerDesk",
               count(*) filter (where call_status = 'missed' and lead_day >= w.fr) as missed
        from i left join ops.people p on p.email = i.agent_email, w where i.lead_day >= w.fr group by 1) x),
    'missed', (select coalesce(json_agg(x order by x.at desc), '[]') from (
        select i.lead_at as at, i.channel, coalesce(p.full_name, i.agent_email) as broker, i.listing_id as ref
        from i left join ops.people p on p.email = i.agent_email, w
        where i.call_status = 'missed' and i.lead_day >= w.fr order by i.lead_at desc limit 80) x),
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

// Promotions (migration 023): each tracked broker's level, GCI since they reached it, and how far they are from the next.
// Normal route: GCI target hit and the window served. Fast-track: 150% of the target, at any time
// (to Associate Director it also needs 5 closed deals). GCI = their billed amount on ops.deals from `since` onwards.
export const promotions = (team) => one(sql`
  with d as (select ops.dubai_day(now()) as today),
  t as (select t.*, coalesce(p.full_name, t.name) as shown, ops.team_at(t.email, d.today) as team, d.today
        from ops.promotion_track t cross join d left join ops.people p on p.email = t.email
        where (${team}::text is null or ops.team_at(t.email, d.today) = ${team})
          and (p.email is null or p.status = 'active'))
  select json_build_object('today', (select today from d), 'rows', (select coalesce(json_agg(x), '[]') from (
    select t.email, t.shown as name, t.team, t.level, t.since, t.note,
           l.title, l.window_months as window, l.next_target as target, n.title as next_title,
           (extract(year from age(t.today, t.since)) * 12 + extract(month from age(t.today, t.since)))::int as months,
           (t.since + make_interval(months => coalesce(l.window_months, 0)))::date as window_ends,
           coalesce((select sum(x.amount) from ops.deals x where lower(x.email) = t.email and x.deleted_at is null and x.deal_date >= t.since), 0)::float8 as gci,
           (select count(*) from ops.deals x where lower(x.email) = t.email and x.deleted_at is null and x.counts_as_deal and x.deal_date >= t.since)::int as deals
    from t left join ops.promotion_levels l on l.level = t.level left join ops.promotion_levels n on n.level = t.level + 1) x)) as j`);
