-- 020 Listing check cache
-- Working out every listing's target and owner on each page load was too slow for the Listings tab (the server gives up
-- on slow reads after 4.5 s and tries again, so the page sat on "Loading"). Now:
--   mkt.listing_owner_map    listing -> Desk unit -> owner, worked out once, then only for new listings (and daily)
--   mkt.listing_check_cache  every live listing's check, rebuilt by mkt.refresh_listing_cache() in a second or two
-- The tab reads the cache straight away; when it's over 10 minutes old the page asks the server to rebuild it in the
-- background. If pg_cron is switched on, it is also rebuilt every 10 minutes on its own.
-- Run once in the Supabase SQL editor. Safe to run twice.

do $$ begin
  if to_regprocedure('mkt.listing_checks(text[])') is null then raise exception 'Run 019 first'; end if;
end $$;

begin;

-- Same rules as before (same building name and unit number, exactly one unit), written as plain equality joins so the
-- database can use hash joins instead of comparing every listing with every building.
create or replace function mkt.listing_desk_units(p_ids text[]) returns table (listing_id text, unit_id bigint, owner_name text)
language sql stable as $f$
with l as (
  select k.listing_id, mkt.nk(coalesce(nullif(k.raw->>'building', ''), k.building)) as b1, mkt.nk(k.raw->>'bayutBuilding') as b2,
         mkt.nk_unit(coalesce(k.raw->>'unitNumber', k.unit_no)) as u
  from ops.kendal_listings k where k.listing_id = any(p_ids)
),
ln as (select listing_id, u, b1 as b from l where u is not null and b1 is not null
       union select listing_id, u, b2 from l where u is not null and b2 is not null),
bn as (select id, mkt.nk(name) as n from desk.buildings
       union all select id, mkt.nk_strip(subcommunity, name) from desk.buildings),
lb as (select distinct ln.listing_id, ln.u, bn.id as building_id from ln join bn on bn.n = ln.b),
m as (
  select lb.listing_id, un.id
  from lb join desk.units un on un.building_id = lb.building_id
  where mkt.nk_unit(un.unit_no) = lb.u or regexp_replace(mkt.nk_unit(un.unit_no), '^[A-Z]+', '') = regexp_replace(lb.u, '^[A-Z]+', '')
),
one as (select listing_id, min(id) as id from m group by 1 having count(distinct id) = 1)   -- only a single, certain match
select one.listing_id, one.id,
       (select o.name from desk.unit_owners uo join desk.owners o on o.id = uo.owner_id where uo.unit_id = one.id order by o.id limit 1)
from one
$f$;

create table if not exists mkt.listing_owner_map (
  listing_id text primary key, unit_id bigint, owner_name text, checked_at timestamptz not null default now()
);

-- Works out the owner for live listings not in the map yet, or checked more than a day ago (at most p_limit at a time).
create or replace function mkt.refresh_listing_owners(p_limit int default 100) returns int language plpgsql as $f$
declare ids text[]; n int;
begin
  select array_agg(k.listing_id) into ids from (
    select k.listing_id from ops.kendal_listings k left join mkt.listing_owner_map m using (listing_id)
    where k.is_live and (m.listing_id is null or m.checked_at < now() - interval '1 day')
    order by m.checked_at nulls first limit p_limit) k;
  if ids is null then return 0; end if;
  insert into mkt.listing_owner_map (listing_id, unit_id, owner_name, checked_at)
  select i, u.unit_id, u.owner_name, now()
  from unnest(ids) i left join mkt.listing_desk_units(ids) u on u.listing_id = i
  on conflict (listing_id) do update set unit_id = excluded.unit_id, owner_name = excluded.owner_name, checked_at = now();
  get diagnostics n = row_count;
  return n;
end $f$;

select mkt.refresh_listing_owners(100000);

create table if not exists mkt.listing_check_cache (
  listing_id text primary key, agent_email text, agent_name text, purpose text, kind text, beds int, size_sqft int, title text,
  community text, sub_community text, building text, unit_no text,
  listed bigint, target bigint, gap_pct numeric, verdict text, evidence int, evidence_level text, evidence_months int,
  low bigint, high bigint, typical bigint, latest date, vals bigint[], note text,
  unit_id bigint, owner_name text, refreshed_at timestamptz not null default now()
);
create index if not exists listing_check_cache_agent_idx on mkt.listing_check_cache (lower(agent_email));

-- Rebuilds the cache. Only one rebuild runs at a time; a second caller just returns -1.
create or replace function mkt.refresh_listing_cache() returns int language plpgsql as $f$
declare n int;
begin
  if not pg_try_advisory_xact_lock(hashtext('mkt.refresh_listing_cache')) then return -1; end if;
  perform mkt.refresh_listing_map();
  perform mkt.refresh_listing_owners(200);
  create temp table _chk on commit drop as
  select c.*, k.agent_name, m.unit_id, m.owner_name
  from mkt.listing_checks() c join ops.kendal_listings k using (listing_id) left join mkt.listing_owner_map m using (listing_id);
  delete from mkt.listing_check_cache;
  insert into mkt.listing_check_cache (listing_id, agent_email, agent_name, purpose, kind, beds, size_sqft, title, community, sub_community,
    building, unit_no, listed, target, gap_pct, verdict, evidence, evidence_level, evidence_months, low, high, typical, latest, vals, note,
    unit_id, owner_name, refreshed_at)
  select listing_id, agent_email, agent_name, purpose, kind, beds, size_sqft, title, community, sub_community,
    building, unit_no, listed, target, gap_pct, verdict, evidence, evidence_level, evidence_months, low, high, typical, latest, vals, note,
    unit_id, owner_name, now()
  from _chk;
  get diagnostics n = row_count;
  drop table _chk;
  return n;
end $f$;

select mkt.refresh_listing_cache();

-- Keep it fresh every 10 minutes if pg_cron is available (Supabase: Database > Extensions > pg_cron)
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'listing-check-cache';
    perform cron.schedule('listing-check-cache', '*/10 * * * *', 'select mkt.refresh_listing_cache()');
  end if;
end $$;

create temp table res on commit preserve rows as
select (select count(*) from ops.kendal_listings where is_live) as live_listings,
       (select count(*) from mkt.listing_owner_map) as listings_checked_for_owner,
       (select count(*) from mkt.listing_owner_map where unit_id is not null) as with_desk_owner,
       (select count(*) from mkt.listing_check_cache) as listings_in_cache,
       (select count(*) from mkt.listing_check_cache where target is not null) as with_target,
       exists (select 1 from pg_extension where extname = 'pg_cron') as refreshes_every_10_min;
commit;
select * from res;
drop table res;
