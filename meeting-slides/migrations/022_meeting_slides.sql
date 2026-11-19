-- 022 Meeting slides
-- Monthly billing targets for the Friday meeting slides, and the rules that flag brokers into group sessions.
--   desk.meeting_targets   one row per month per line on the scorecard (company, a team, or one person)
--   mkt.settings 'meeting_flags'   the KPIs and thresholds, in one place
-- Team names are looked up from ops.teams so they match the roster exactly. Run once. Safe to run twice:
-- targets already there keep their values (change them with an update, or delete the row and run again).

do $$ begin
  if to_regclass('ops.teams') is null or to_regclass('ops.deals') is null then raise exception 'ops tables are missing - stop'; end if;
  if to_regclass('mkt.settings') is null then raise exception 'Run 019 first (mkt.settings)'; end if;
end $$;

begin;

create table if not exists desk.meeting_targets (
  id bigserial primary key,
  month date not null,                         -- first of the month
  label text not null,                         -- as shown on the slide
  scope text not null check (scope in ('company', 'team', 'person')),
  team text,                                   -- ops.teams name, for scope 'team'
  email text,                                  -- for scope 'person'
  target numeric not null,
  sort int not null default 0,
  unique (month, label)
);

-- Which ops.teams name is which (the roster's own spelling)
create temp table tm on commit drop as
select (select name from ops.teams where name ilike '%mahan%' or name ilike '%oliver%' order by sort limit 1) as sales,
       (select name from ops.teams where name ilike '%callum%' order by sort limit 1) as leasing,
       (select name from ops.teams where name ilike '%off%plan%' order by sort limit 1) as offplan,
       (select name from ops.teams where name ilike '%commercial%' order by sort limit 1) as commercial;

do $$ declare r record; begin
  select * into r from tm;
  if r.sales is null or r.leasing is null or r.offplan is null or r.commercial is null then
    raise exception 'Could not find every team in ops.teams (sales %, leasing %, off-plan %, commercial %) - stop', r.sales, r.leasing, r.offplan, r.commercial;
  end if;
end $$;

insert into desk.meeting_targets (month, label, scope, team, email, target, sort)
select m::date, x.label, x.scope, x.team, x.email, x.target, x.sort
from generate_series(date '2026-10-01', date '2026-12-01', interval '1 month') m
cross join lateral (
  select 'Company' as label, 'company' as scope, null::text as team, null::text as email, 1300000::numeric as target, 0 as sort
  union all select tm.sales, 'team', tm.sales, null, 750000, 10 from tm
  union all select tm.leasing, 'team', tm.leasing, null, 200000, 20 from tm
  union all select 'Callum (own)', 'person', null, 'callum.s@apexhomesdxb.com', 75000, 21
  union all select tm.offplan, 'team', tm.offplan, null, 250000, 30 from tm
  union all select tm.commercial, 'team', tm.commercial, null, 100000, 40 from tm
  union all select 'Kamil (own)', 'person', null, 'kamil@apexhomesdxb.com', 75000, 41
) x
on conflict (month, label) do nothing;

-- The KPIs (same as the People page) and the flag thresholds
insert into mkt.settings (key, value) values ('meeting_flags', jsonb_build_object(
  'calls_a_day', 75, 'working_days', 6,                      -- 450 owner calls in a 7-day week
  'viewings_week', 10,
  'listed_week', jsonb_build_object('apartment', 4, 'villa', 2),
  'stock', jsonb_build_object('apartment', 25, 'villa', 12),
  'leads_week_high', 10,                                     -- "leads, not enough viewings": 10+ leads and under 10 viewings
  'viewings_30_high', 40,                                    -- "viewings, no deals": 40+ viewings in 30 days, no deal
  'low_leads', 5, 'low_leads_days', 14,                      -- a listing live 14+ days with under 5 leads is underperforming
  'underperforming_share', 0.5,                              -- half their live listings underperforming
  'no_deal_days', 60, 'settled_days', 90))                   -- no deal in 60 days, after their first 90
on conflict (key) do nothing;

create temp table res on commit preserve rows as
select (select string_agg(label || ' ' || to_char(target, 'FM9,999,999'), ' · ' order by sort) from desk.meeting_targets where month = date '2026-11-01') as november_targets,
       (select count(*) from desk.meeting_targets) as target_rows,
       (select value from mkt.settings where key = 'meeting_flags') is not null as flag_rules_set;
commit;
select * from res;
drop table res;
