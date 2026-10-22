-- Apex Owner Desk · 004 speed (pre-computed unit list) and phone push subscriptions

create extension if not exists pg_trgm with schema extensions;

-- Call stats per unit, kept up to date by a trigger, so the list never scans all calls
create table if not exists desk.unit_call_stats (
  unit_id      bigint primary key references desk.units(id) on delete cascade,
  last_called  timestamptz,
  last_outcome text,
  calls        int not null default 0
);

create or replace function desk.touch_call_stats() returns trigger language plpgsql as $$
begin
  insert into desk.unit_call_stats (unit_id, last_called, last_outcome, calls)
  values (new.unit_id, new.called_at, new.outcome, 1)
  on conflict (unit_id) do update set
    last_called  = greatest(desk.unit_call_stats.last_called, excluded.last_called),
    last_outcome = coalesce(excluded.last_outcome, desk.unit_call_stats.last_outcome),
    calls        = desk.unit_call_stats.calls + case when tg_op = 'INSERT' then 1 else 0 end;
  return new;
end $$;
drop trigger if exists calls_stats on desk.calls;
create trigger calls_stats after insert or update of outcome on desk.calls
  for each row execute function desk.touch_call_stats();

insert into desk.unit_call_stats (unit_id, last_called, last_outcome, calls)
select unit_id, max(called_at),
       (array_agg(outcome order by called_at desc) filter (where outcome is not null))[1], count(*)
from desk.calls group by unit_id
on conflict (unit_id) do nothing;

-- Everything static about a unit, computed once. Refreshed after each data load.
drop view if exists desk.v_unit_list;
drop materialized view if exists desk.mv_units;
create materialized view desk.mv_units as
select
  u.id, b.area_id, b.subcommunity,
  case when u.unit_type = 'Villa' then null else b.name end as building,
  u.unit_no, u.unit_type, u.beds, u.size_sqft,
  coalesce(ls.status, 'Not confirmed') as lease_status,
  t.start_date, t.end_date, t.annual_rent, t.prev_rent, t.renewals, t.last_sale_price, t.matched_by,
  po.owner_id, po.name as owner_name, coalesce(po.is_company, false) as is_company,
  ph.masked as owner_masked,
  (ph.owner_id is not null) as has_phone,
  coalesce(oc.n, 1)::int as owner_units,
  (select count(*) from desk.unit_owners x where x.unit_id = u.id and x.role = 'owner')::int as owners_n,
  exists (select 1 from desk.unit_owners x where x.unit_id = u.id and x.role = 'mortgagee') as mortgaged,
  lower(concat_ws(' ', u.unit_no, b.name, b.subcommunity,
    (select string_agg(o.name, ' ') from desk.unit_owners x join desk.owners o on o.id = x.owner_id where x.unit_id = u.id))) as search_text,
  row_number() over (order by b.subcommunity, case when u.unit_type = 'Villa' then '' else b.name end,
                     length(u.unit_no), u.unit_no)::int as sort_pos
from desk.units u
join desk.buildings b on b.id = u.building_id
left join desk.lease_status ls on ls.unit_id = u.id
left join desk.tenancies t on t.unit_id = u.id
left join lateral (
  select o.id as owner_id, o.name, o.is_company
  from desk.unit_owners uo join desk.owners o on o.id = uo.owner_id
  where uo.unit_id = u.id and uo.role = 'owner'
  order by o.is_company, o.id limit 1
) po on true
left join desk.owner_phones ph on ph.owner_id = po.owner_id
left join (select owner_id, count(*) as n from desk.unit_owners where role = 'owner' group by owner_id) oc
  on oc.owner_id = po.owner_id;

create unique index mv_units_id on desk.mv_units (id);
create index mv_units_area_sort on desk.mv_units (area_id, sort_pos);
create index mv_units_end on desk.mv_units (end_date);
create index mv_units_sc_bld on desk.mv_units (subcommunity, building);
create index mv_units_rent on desk.mv_units (annual_rent);
create index mv_units_sale on desk.mv_units (last_sale_price);
create index mv_units_search on desk.mv_units using gin (search_text extensions.gin_trgm_ops);

create view desk.v_unit_list as
select m.*, s.last_called, s.last_outcome
from desk.mv_units m left join desk.unit_call_stats s on s.unit_id = m.id;

create or replace function desk.refresh_units() returns void language sql as $$
  refresh materialized view concurrently desk.mv_units;
$$;

-- Phones that receive call alerts
create table if not exists desk.push_subs (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references desk.staff(user_id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz
);
create index if not exists push_subs_user on desk.push_subs (user_id);

-- Lock everything new
alter table desk.unit_call_stats enable row level security;
alter table desk.push_subs enable row level security;
revoke all on desk.unit_call_stats, desk.push_subs, desk.mv_units, desk.v_unit_list from public, anon, authenticated;
revoke all on function desk.refresh_units() from public, anon, authenticated;
grant select, insert, update, delete on desk.unit_call_stats, desk.push_subs to service_role;
grant select on desk.mv_units, desk.v_unit_list to service_role;
grant usage on all sequences in schema desk to service_role;
grant execute on function desk.refresh_units() to service_role;

select (select count(*) from desk.mv_units) as units_ready,
       (select count(*) from information_schema.role_table_grants
        where table_schema = 'desk' and grantee in ('anon','authenticated','PUBLIC')) as public_grants;
