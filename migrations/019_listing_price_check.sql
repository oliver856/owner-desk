-- 019 Listing price check
-- Compares every live Kendal listing with recent land department sales (mkt.dld_sales) and new Ejari leases
-- (mkt.ejari_rents) for similar units, and gives each one a target, a gap and a verdict for the Listings tab.
-- Also adds the staff details the owner report prints (title, mobile, headshot).
-- Run once in the Supabase SQL editor. Safe to run twice.

do $$ begin
  if to_regclass('mkt.dld_sales') is null or to_regclass('mkt.ejari_rents') is null
     or to_regclass('mkt.dld_places') is null or to_regclass('mkt.ejari_places') is null then
    raise exception 'Market data tables are missing - run "Market data 1 - setup.sql" and import the CSV files first';
  end if;
  if to_regclass('ops.kendal_listings') is null then raise exception 'ops.kendal_listings is missing - stop'; end if;
  if to_regclass('desk.staff') is null or to_regclass('desk.units') is null then raise exception 'desk tables are missing - stop'; end if;
end $$;

begin;

-- ── Name matching ──────────────────────────────────────────────────────────────────────────────────────────────
-- Upper case, letters and digits only: "Damac Hills - LORETO 1 - A" -> DAMACHILLSLORETO1A
create or replace function mkt.nk(t text) returns text language sql immutable parallel safe as
$$ select nullif(regexp_replace(upper(coalesce(t, '')), '[^A-Z0-9]', '', 'g'), '') $$;

-- The same, with a leading master-project / community name taken off: ("DAMAC HILLS", "Damac Hills - LORETO 1 - A") -> LORETO1A
create or replace function mkt.nk_strip(prefix text, t text) returns text language sql immutable parallel safe as
$$ select case when mkt.nk(prefix) is not null and mkt.nk(t) like mkt.nk(prefix) || '_%'
               then substr(mkt.nk(t), length(mkt.nk(prefix)) + 1) else mkt.nk(t) end $$;

-- Matching key: nk plus the usual naming differences evened out on both sides:
-- leading THE dropped, TOWER/RESIDENCES/APARTMENTS tidied, "T1" = "TOWER 1" = "1", roman II kept.
create or replace function mkt.nm(t text) returns text language sql immutable parallel safe as
$$ select nullif(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
            coalesce(mkt.nk(t), ''), '^THE', ''), 'TOWERS?', '', 'g'), 'RESIDENCES', 'RESIDENCE', 'g'), 'APARTMENTS?', '', 'g'),
          '([A-Z])T([0-9]+)$', '\1\2'), '') $$;

-- Do a Kendal community and a land department master project / area name refer to the same place?
create or replace function mkt.same_community(kendal_locality text, master text, area text) returns boolean language sql immutable parallel safe as
$$ select mkt.nk(kendal_locality) is not null and (
          (mkt.nk(master) is not null and (mkt.nk(master) like '%' || mkt.nk(kendal_locality) || '%' or mkt.nk(kendal_locality) like '%' || mkt.nk(master) || '%'))
       or (mkt.nk(area) is not null and mkt.nk(area) = mkt.nk(kendal_locality))) $$;

-- One row per distinct Kendal building (community | sub-community | building | Bayut building), with the land department
-- buildings and Ejari projects it matches. Filled automatically; ops can put a row in manually (manual = true) to fix
-- a match, and the automatic refresh never touches a manual row.
create table if not exists mkt.listing_place_map (
  bkey text primary key,
  locality text, sub_locality text, building text, bayut_building text,
  dld_ids int[] not null default '{}', dld_level text,       -- 'building' or 'project'
  ejari_ids int[] not null default '{}', ejari_level text,   -- 'building' or 'project'
  manual boolean not null default false,
  matched_at timestamptz not null default now()
);
-- wider evidence when the building alone has too little: every tower in the same project / sub-community
alter table mkt.listing_place_map add column if not exists dld_wide_ids int[] not null default '{}';
alter table mkt.listing_place_map add column if not exists ejari_wide_ids int[] not null default '{}';
alter table mkt.listing_place_map add column if not exists method text;

create or replace function mkt.listing_bkey(l ops.kendal_listings) returns text language sql immutable as
$$ select concat_ws('|', mkt.nk(coalesce(l.raw->>'locality', l.locality)), mkt.nk(coalesce(l.raw->>'subLocality', l.sub_locality)),
                    mkt.nk(coalesce(l.raw->>'building', l.building)), mkt.nk(l.raw->>'bayutBuilding')) $$;

-- Every name a land department building / Ejari project can go by, normalised once, so matching is a quick lookup.
-- kind 'b' = building-type name, 'p' = project / sub-community name. Rebuilt by mkt.refresh_place_names() after a data load.
create table if not exists mkt.place_names (src text not null, id int not null, kind text not null, nk text not null,
  master text, area text, primary key (src, id, kind, nk));
create index if not exists place_names_nk_idx on mkt.place_names (nk, src, kind);

create or replace function mkt.refresh_place_names() returns int language plpgsql as $f$
declare n int;
begin
  delete from mkt.place_names;
  insert into mkt.place_names (src, id, kind, nk, master, area)
  select distinct 'dld', x.id, x.kind, x.nk, mkt.nk(x.master_project), mkt.nk(x.area)
  from (select p.*, v.kind, mkt.nm(v.nm) as nk from mkt.dld_places p,
          lateral (values ('b', mkt.nk_strip(p.master_project, p.building)), ('b', mkt.nk_strip(p.project, p.building)), ('b', mkt.nk(p.building)),
                          ('p', mkt.nk_strip(p.master_project, p.project)), ('p', mkt.nk(p.project))) v(kind, nm)) x
  where x.nk is not null
  union
  select distinct 'ejari', e.id, v.kind, mkt.nm(v.nm), mkt.nk(e.master_project), mkt.nk(e.area)
  from mkt.ejari_places e, lateral (values ('b', mkt.nk_strip(e.master_project, e.project)), ('p', mkt.nk_strip(e.master_project, e.project)), ('p', mkt.nk(e.project))) v(kind, nm)
  where mkt.nm(v.nm) is not null;
  get diagnostics n = row_count;
  return n;
end $f$;

-- Matches any live listing building that isn't in the map yet (or all non-manual ones with p_all). Returns how many it matched.
-- 1. exact: a land department building / Ejari project with the same name, in the same community (or a name that only
--    exists in one area of Dubai). 2. near: one name contains the other (min 10 letters: "Vida Dubai Mall Tower 1" ->
--    "Vida Dubai Mall", "Marina Gate 1" -> "Residence at Marina Gate 1"), only inside the community, counted at project level. 3. Ejari reached through the land department
--    project name when Ejari has no tower name. Then the wider set: every building in the same project.
create or replace function mkt.refresh_listing_map(p_all boolean default false) returns int language plpgsql as $f$
declare n int;
begin
  if not exists (select 1 from mkt.place_names) then perform mkt.refresh_place_names(); end if;
  if p_all then delete from mkt.listing_place_map where not manual; end if;

  create temp table _k on commit drop as
  select distinct on (mkt.listing_bkey(l)) mkt.listing_bkey(l) as bkey,
         coalesce(l.raw->>'locality', l.locality) as loc, coalesce(l.raw->>'subLocality', l.sub_locality) as sub,
         coalesce(l.raw->>'building', l.building) as bld, l.raw->>'bayutBuilding' as bay
  from ops.kendal_listings l
  where l.is_live and not exists (select 1 from mkt.listing_place_map m where m.bkey = mkt.listing_bkey(l));

  create temp table _n on commit drop as
  select k.*, mkt.nk(k.loc) as ln,
         array_remove(array[mkt.nm(k.bld), mkt.nm(k.bay), mkt.nm(k.loc || k.bld), mkt.nm(k.sub || k.bld)], null) as bn,
         mkt.nm(k.sub) as sn
  from _k k;

  -- 1. exact names
  create temp table _c on commit drop as
  select n.bkey, n.ln, pn.src, pn.id, pn.area,
         case when pn.kind = 'b' or (pn.src = 'ejari' and pn.nk = any(n.bn)) then 'building' else 'project' end as lvl,
         (n.ln is not null and ((pn.master is not null and (pn.master like '%' || n.ln || '%' or n.ln like '%' || pn.master || '%')) or pn.area = n.ln)) as same_comm
  from _n n join mkt.place_names pn
    on (pn.nk = any(n.bn) and (pn.kind = 'b' or pn.src = 'dld' and pn.kind = 'p')) or (pn.kind = 'p' and pn.nk = n.sn);

  create temp table _ok on commit drop as
  with g as (select bkey, src, lvl, bool_or(same_comm) as any_same, count(distinct area) as areas from _c group by 1, 2, 3)
  select c.* from _c c join g using (bkey, src, lvl) where (g.any_same and c.same_comm) or (not g.any_same and g.areas = 1);

  -- which land department areas each Kendal community turns out to be, learnt from the exact matches
  -- (JLT -> Al Thanyah Fifth, Downtown Dubai -> Burj Khalifa ...)
  create temp table _alias on commit drop as
  select distinct ln, area from _ok where ln is not null
  union select distinct mkt.nk(m.locality), p.area from mkt.listing_place_map m, unnest(m.dld_ids) i join mkt.place_names p on p.src = 'dld' and p.id = i;

  -- 2. near names, for buildings with no exact match in that source
  insert into _ok (bkey, ln, src, id, area, lvl, same_comm)
  select distinct n.bkey, n.ln, pn.src, pn.id, pn.area, 'project', true
  from _n n cross join lateral unnest(case when cardinality(n.bn) > 0 then n.bn else array[n.sn] end) b(nm)   -- the sub-community only when there's no building name
  join mkt.place_names pn on length(b.nm) >= 10 and length(pn.nk) >= 10 and (strpos(b.nm, pn.nk) > 0 or strpos(pn.nk, b.nm) > 0)
  where ((pn.master is not null and (pn.master like '%' || n.ln || '%' or n.ln like '%' || pn.master || '%')) or pn.area = n.ln
         or exists (select 1 from _alias a where a.ln = n.ln and a.area = pn.area))
    and not exists (select 1 from _ok o where o.bkey = n.bkey and o.src = pn.src);

  -- 3. Ejari through the land department project name
  insert into _ok (bkey, ln, src, id, area, lvl, same_comm)
  select distinct o.bkey, o.ln, 'ejari', e.id, e.area, 'project', true
  from _ok o join mkt.dld_places d on o.src = 'dld' and d.id = o.id
  join mkt.place_names e on e.src = 'ejari' and e.kind = 'p' and e.area = mkt.nk(d.area)
       and e.nk in (mkt.nm(mkt.nk_strip(d.master_project, d.project)), mkt.nm(d.project))
  where not exists (select 1 from _ok x where x.bkey = o.bkey and x.src = 'ejari');

  insert into mkt.listing_place_map (bkey, locality, sub_locality, building, bayut_building,
                                     dld_ids, dld_level, ejari_ids, ejari_level, dld_wide_ids, ejari_wide_ids, method)
  with best as (select bkey, src, min(lvl) as lvl from _ok group by 1, 2),
  ids as (select o.bkey, o.src, b.lvl, array_agg(distinct o.id order by o.id) as ids
          from _ok o join best b using (bkey, src) where o.lvl = b.lvl group by 1, 2, 3),
  -- the wider set: everything found at any level, plus every land department building in the same project
  wide as (
    select bkey, src, array_agg(distinct id order by id) as ids from (
      select bkey, src, id from _ok
      union
      select o.bkey, 'dld', p2.id from _ok o join mkt.dld_places p on o.src = 'dld' and p.id = o.id
      join mkt.dld_places p2 on p2.area = p.area and p2.project = p.project and p.project <> ''
    ) x group by 1, 2)
  select n.bkey, n.loc, n.sub, n.bld, n.bay,
         coalesce(d.ids, '{}'), d.lvl, coalesce(e.ids, '{}'), e.lvl, coalesce(dw.ids, '{}'), coalesce(ew.ids, '{}'),
         case when d.lvl is null and e.lvl is null then null else 'auto' end
  from _n n
  left join ids d on d.bkey = n.bkey and d.src = 'dld' left join ids e on e.bkey = n.bkey and e.src = 'ejari'
  left join wide dw on dw.bkey = n.bkey and dw.src = 'dld' left join wide ew on ew.bkey = n.bkey and ew.src = 'ejari'
  on conflict (bkey) do nothing;
  get diagnostics n = row_count;
  drop table _k; drop table _n; drop table _c; drop table _ok; drop table _alias;
  return n;
end $f$;

-- ── Settings ──────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists mkt.settings (key text primary key, value jsonb not null);
insert into mkt.settings (key, value) values ('price_check', jsonb_build_object(
  'min_evidence', 3,          -- fewer similar transactions than this: no target
  'months', 6, 'months_wide', 12,
  'size_band_flat', 0.15, 'size_band_villa', 0.20, 'size_band_rent', 0.20, 'size_band_wide', 0.30,
  'reduce_over', 5, 'well_over', 15, 'priced_to_go_under', 5,   -- verdict cut-offs, % against target
  'round_sale', 5000, 'round_rent', 1000))
on conflict (key) do nothing;
update mkt.settings set value = jsonb_build_object('size_band_wide', 0.30) || value where key = 'price_check' and not value ? 'size_band_wide';

-- ── The check itself ──────────────────────────────────────────────────────────────────────────────────────────
-- One row per live listing (optionally only the given agent emails). Sales: median price per sq ft of similar sales x the
-- listing's size (median price when the size isn't known). Rents: median annual rent of similar new leases (whole unit).
create or replace function mkt.listing_checks(p_emails text[] default null)
returns table (
  listing_id text, agent_email text, purpose text, kind text, beds int, size_sqft int, title text,
  community text, sub_community text, building text, unit_no text,
  listed bigint, target bigint, gap_pct numeric, verdict text, evidence int, evidence_level text, evidence_months int,
  low bigint, high bigint, typical bigint, latest date, vals bigint[], note text
) language sql stable as $f$
with cfg as (select value as c from mkt.settings where key = 'price_check'),
l as (
  select k.listing_id, k.agent_email, k.title,
    coalesce(k.raw->>'locality', k.locality) as community, coalesce(k.raw->>'subLocality', k.sub_locality) as sub_community,
    coalesce(nullif(k.raw->>'building', ''), k.building, k.raw->>'bayutBuilding') as building, trim(coalesce(k.raw->>'unitNumber', k.unit_no)) as unit_no,
    case when k.market_type = 'Rent' then 'rent' when k.market_type = 'Off Plan' then 'offplan' else 'sale' end as purpose,
    case when k.property_type in ('Apartment / Flat', 'Penthouse') then 'flat'
         when k.property_type in ('Villa / House', 'Townhouse') then 'villa' end as kind,
    k.property_type = 'Penthouse' as penthouse,
    case when k.beds ~* 'studio' then 0
         when (k.raw->'bedrooms'->>'value') ~ '^[0-9]+(\.0+)?$' then (k.raw->'bedrooms'->>'value')::numeric::int
         when k.beds ~ '^[0-9]+$' then k.beds::int end as beds,
    nullif(round(coalesce(nullif((k.raw->'builtUpArea'->>'value')::numeric, 0),
                          case when k.property_type in ('Apartment / Flat', 'Penthouse') then nullif((k.raw->'propertyArea'->>'value')::numeric, 0) end)), 0)::int as size_sqft,
    case when k.market_type = 'Rent' then
           case coalesce(k.rent_frequency, k.raw->'rentAndFees'->>'frequency')
             when 'Yearly' then coalesce(k.rent, (k.raw->'rentAndFees'->>'rentAmount')::numeric)
             when 'Monthly' then coalesce(k.rent, (k.raw->'rentAndFees'->>'rentAmount')::numeric) * 12 end
         else coalesce(k.price, nullif((k.raw->'askingPrice'->>'value')::numeric, 0)) end::bigint as listed,
    m.dld_ids, m.dld_level, m.ejari_ids, m.ejari_level, m.dld_wide_ids, m.ejari_wide_ids
  from ops.kendal_listings k
  left join mkt.listing_place_map m on m.bkey = mkt.listing_bkey(k)
  where k.is_live and (p_emails is null or lower(k.agent_email) = any(p_emails))
),
-- every similar transaction in the last 12 months, for each listing, tagged with how close a match it is:
--   lvl   'building' (the building itself) or 'project' (every tower in the project / sub-community)
--   band  'tight' (size within 15% flats / 20% villas / 20% rents), 'wide' (within 30%), or for villas only 'any' size
--         (villa sizes are often recorded as the plot, so same beds is the better guide there)
--   src   'same' or 'offplan' (a ready listing in a newly finished building, compared with its off-plan sales)
-- Villas the land department registered without a bed count are compared on size alone.
comps as (
  select l.listing_id, lv.lvl,
         case when l.size_sqft is null or s.size_sqft between l.size_sqft * (1 - lv.tb) and l.size_sqft * (1 + lv.tb) then 'tight'
              when s.size_sqft between l.size_sqft * (1 - (c->>'size_band_wide')::numeric) and l.size_sqft * (1 + (c->>'size_band_wide')::numeric) then 'wide'
              else 'any' end as band,
         case when s.off_plan = (l.purpose = 'offplan') then 'same' else 'offplan' end as src,
         s.sold_on as d, s.price::numeric as v, s.price::numeric / nullif(s.size_sqft, 0) as psf
  from l cross join cfg
  cross join lateral (values ('building', l.dld_ids, l.dld_level), ('project', l.dld_wide_ids, 'project')) lv0(lvl, ids, mlvl)
  cross join lateral (select lv0.*, (cfg.c->>case when l.kind = 'flat' then 'size_band_flat' else 'size_band_villa' end)::numeric as tb) lv
  join mkt.dld_sales s on s.place_id = any(lv.ids)
  where l.purpose in ('sale', 'offplan') and l.kind is not null and l.beds is not null and lv.mlvl is not null
    and (lv.lvl = 'project' or l.dld_level = 'building')
    and (case when l.kind = 'flat' then s.kind = 'flat' else s.kind in ('villa', 'townhouse') end)
    and (s.beds = l.beds or (l.kind = 'villa' and s.beds is null and l.size_sqft is not null))
    and s.penthouse = l.penthouse
    and (s.off_plan = (l.purpose = 'offplan') or l.purpose = 'sale')
    and s.sold_on >= current_date - ((c->>'months_wide')::int * interval '1 month')
    and (l.kind = 'villa' or l.size_sqft is null or s.size_sqft between l.size_sqft * (1 - (c->>'size_band_wide')::numeric) and l.size_sqft * (1 + (c->>'size_band_wide')::numeric))
  union all
  select l.listing_id, lv.lvl,
         case when l.size_sqft is null or r.size_sqft is null
                   or r.size_sqft between l.size_sqft * (1 - (c->>'size_band_rent')::numeric) and l.size_sqft * (1 + (c->>'size_band_rent')::numeric) then 'tight'
              when r.size_sqft between l.size_sqft * (1 - (c->>'size_band_wide')::numeric) and l.size_sqft * (1 + (c->>'size_band_wide')::numeric) then 'wide'
              else 'any' end,
         'same', r.starts_on, r.annual_rent::numeric, null
  from l cross join cfg
  cross join lateral (values ('building', l.ejari_ids, l.ejari_level), ('project', l.ejari_wide_ids, 'project')) lv(lvl, ids, mlvl)
  join mkt.ejari_rents r on r.place_id = any(lv.ids)
  where l.purpose = 'rent' and l.kind is not null and l.beds is not null and lv.mlvl is not null
    and (lv.lvl = 'project' or l.ejari_level = 'building')
    and r.kind = l.kind and r.beds = l.beds and r.penthouse = l.penthouse
    and r.starts_on >= current_date - ((c->>'months_wide')::int * interval '1 month')
    and (l.kind = 'villa' or l.size_sqft is null or r.size_sqft is null or r.size_sqft between l.size_sqft * (1 - (c->>'size_band_wide')::numeric) and l.size_sqft * (1 + (c->>'size_band_wide')::numeric))
),
-- the evidence sets, from closest to loosest. A tight set is also part of the wide one.
sets as (
  select c.listing_id, c.lvl, b.band, c.src, c.d, c.v, c.psf from comps c
  cross join lateral (values ('tight'), ('wide'), ('any')) b(band)
  where c.band = b.band or (b.band = 'wide' and c.band = 'tight') or b.band = 'any'
),
-- outliers (bulk deals, typos) out: anything under half or over double the median of the set. Worked out for 6 and 12
-- months; the closest set that leaves enough wins: same kind of sale, building before project, tight size before wide,
-- 6 months before 12.
w as (select c.*, mo.months from sets c, cfg, lateral (values ((cfg.c->>'months')::int), ((cfg.c->>'months_wide')::int)) mo(months)
      where c.d >= current_date - (mo.months * interval '1 month')),
med as (select listing_id, lvl, band, src, months, percentile_cont(0.5) within group (order by case when band = 'any' then v else coalesce(psf, v) end) as m from w group by 1, 2, 3, 4, 5),
kept as (select w.* from w join med using (listing_id, lvl, band, src, months) where (case when w.band = 'any' then w.v else coalesce(w.psf, w.v) end) between med.m * 0.5 and med.m * 2),
agg_all as (
  select k.listing_id, k.lvl, k.band, k.src, k.months, count(*)::int as n, min(k.v)::bigint as low, max(k.v)::bigint as high, max(k.d) as latest,
         percentile_cont(0.5) within group (order by k.v) as med_v,
         percentile_cont(0.5) within group (order by k.psf) as med_psf,
         array_agg(k.v::bigint order by k.v) as vals
  from kept k group by 1, 2, 3, 4, 5
),
agg as (
  select distinct on (a.listing_id) a.* from agg_all a, cfg
  order by a.listing_id, (a.n >= (cfg.c->>'min_evidence')::int) desc, (a.src = 'same') desc, (a.lvl = 'building') desc,
           case a.band when 'tight' then 0 when 'wide' then 1 else 2 end, a.months, a.n desc
),
t as (
  select l.*, a.n, case when a.src = 'offplan' then a.lvl || ', off-plan sales' when a.band = 'wide' then a.lvl || ', wider size range' when a.band = 'any' and l.size_sqft is not null then a.lvl || ', any size' else a.lvl end as ev_lvl, a.low, a.high, a.latest, a.vals, a.med_v, a.months, cfg.c,
    case when coalesce(a.n, 0) < (cfg.c->>'min_evidence')::int then null
         when l.purpose = 'rent' then round(a.med_v / (cfg.c->>'round_rent')::numeric) * (cfg.c->>'round_rent')::numeric
         -- size-adjusted, but never outside what similar units actually sold for
         when l.size_sqft is not null and a.med_psf is not null and a.band <> 'any' then round(least(greatest(a.med_psf * l.size_sqft, a.low), a.high) / (cfg.c->>'round_sale')::numeric) * (cfg.c->>'round_sale')::numeric
         else round(a.med_v / (cfg.c->>'round_sale')::numeric) * (cfg.c->>'round_sale')::numeric end::bigint as target
  from l cross join cfg left join agg a using (listing_id)
)
select t.listing_id, t.agent_email, t.purpose, t.kind, t.beds, t.size_sqft, t.title, t.community, t.sub_community, t.building, t.unit_no,
  t.listed, t.target,
  case when t.target > 0 and t.listed > 0 then round((t.listed - t.target) * 100.0 / t.target, 1) end as gap_pct,
  case when t.target is null or t.listed is null or t.listed <= 0 then 'nee'
       when (t.listed - t.target) * 100.0 / t.target > (t.c->>'well_over')::numeric then 'well'
       when (t.listed - t.target) * 100.0 / t.target > (t.c->>'reduce_over')::numeric then 'reduce'
       when (t.listed - t.target) * 100.0 / t.target < -(t.c->>'priced_to_go_under')::numeric then 'ptg'
       else 'good' end as verdict,
  coalesce(t.n, 0), t.ev_lvl, t.months,
  t.low, t.high, t.med_v::bigint, t.latest, t.vals,
  case when t.kind is null then 'Not a residential flat or villa'
       when t.beds is null then 'Bedrooms not set in Kendal'
       when t.listed is null or t.listed <= 0 then 'No price in Kendal'
       when t.dld_level is null and t.ejari_level is null then 'Building not matched yet'
       when t.purpose <> 'rent' and t.dld_level is null then 'No sales recorded in this building in 12 months'
       when t.purpose = 'rent' and t.ejari_level is null then 'No new leases recorded in this building in 12 months'
       when t.target is null then 'Only ' || coalesce(t.n, 0) || ' similar ' || case when t.purpose = 'rent' then 'lease' else 'sale' end || case when coalesce(t.n, 0) = 1 then '' else 's' end || ' in 12 months' end as note
from t
$f$;

-- ── Owner for "Call owner" and the report: the Desk unit with the same building and unit number ───────────────────
-- (Kendal landlords aren't synced yet; when they are, they go first and this becomes the fallback.)
create or replace function mkt.nk_unit(t text) returns text language sql immutable parallel safe as
$$ select nullif(regexp_replace(upper(split_part(trim(coalesce(t, '')), ' ', 1)), '[^A-Z0-9]', '', 'g'), '') $$;

create or replace function mkt.listing_desk_unit(p_listing text) returns table (unit_id bigint, owner_name text, owners int)
language sql stable as $f$
with l as (
  select mkt.nk(coalesce(nullif(k.raw->>'building', ''), k.building)) as b1, mkt.nk(k.raw->>'bayutBuilding') as b2,
         mkt.nk(coalesce(k.raw->>'subLocality', k.sub_locality)) as sub,
         mkt.nk_unit(coalesce(k.raw->>'unitNumber', k.unit_no)) as u
  from ops.kendal_listings k where k.listing_id = p_listing
),
b as (
  select bd.id from desk.buildings bd, l
  where mkt.nk(bd.name) in (l.b1, l.b2) or mkt.nk_strip(bd.subcommunity, bd.name) in (l.b1, l.b2)
     or (l.sub is not null and mkt.nk(bd.subcommunity) = l.sub and mkt.nk_strip(bd.subcommunity, bd.name) in (l.b1, l.b2))
),
u as (
  select un.id from desk.units un, l
  where un.building_id in (select id from b) and l.u is not null
    and (mkt.nk_unit(un.unit_no) = l.u or regexp_replace(mkt.nk_unit(un.unit_no), '^[A-Z]+', '') = regexp_replace(l.u, '^[A-Z]+', ''))
)
select u.id, (select o.name from desk.unit_owners uo join desk.owners o on o.id = uo.owner_id where uo.unit_id = u.id order by o.id limit 1),
       (select count(*)::int from desk.unit_owners uo where uo.unit_id = u.id)
from u
where (select count(*) from u) = 1   -- only a single, certain match
$f$;

-- The same for many listings at once (the Listings tab): every Desk building name is cleaned up once, not per listing.
create or replace function mkt.listing_desk_units(p_ids text[]) returns table (listing_id text, unit_id bigint, owner_name text)
language sql stable as $f$
with l as (
  select k.listing_id, mkt.nk(coalesce(nullif(k.raw->>'building', ''), k.building)) as b1, mkt.nk(k.raw->>'bayutBuilding') as b2,
         mkt.nk_unit(coalesce(k.raw->>'unitNumber', k.unit_no)) as u
  from ops.kendal_listings k where k.listing_id = any(p_ids)
),
bn as (select bd.id, mkt.nk(bd.name) as n1, mkt.nk_strip(bd.subcommunity, bd.name) as n2 from desk.buildings bd),
lb as (select distinct l.listing_id, l.u, bn.id as building_id from l join bn on bn.n1 in (l.b1, l.b2) or bn.n2 in (l.b1, l.b2) where l.u is not null),
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

-- ── Staff details printed on the owner report ─────────────────────────────────────────────────────────────────
alter table desk.staff add column if not exists title text;
alter table desk.staff add column if not exists mobile text;
create table if not exists desk.staff_photos (
  email text primary key, content_type text not null default 'image/jpeg', photo bytea not null, updated_at timestamptz not null default now()
);

select mkt.refresh_place_names();
select mkt.refresh_listing_map(true);

create temp table chk on commit drop as select * from mkt.listing_checks();
create temp table res on commit preserve rows as
select (select count(*) from ops.kendal_listings where is_live) as live_listings,
       (select count(*) from mkt.listing_place_map) as buildings_seen,
       (select count(*) from mkt.listing_place_map where dld_level is not null) as matched_to_sales,
       (select count(*) from mkt.listing_place_map where ejari_level is not null) as matched_to_rents,
       (select count(*) from chk where verdict <> 'nee') as listings_with_target,
       (select count(*) from chk where verdict in ('well', 'reduce')) as need_reduction;
commit;
select * from res;
drop table res;
