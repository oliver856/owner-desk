-- Apex Owner Desk · 003 one row per unit for the owner list (masked numbers only, never the real phone)
create or replace view desk.v_unit_list as
select
  u.id,
  b.area_id,
  b.subcommunity,
  case when u.unit_type = 'Villa' then null else b.name end as building,
  u.unit_no,
  u.unit_type,
  u.beds,
  u.size_sqft,
  coalesce(ls.status, 'Not confirmed') as lease_status,
  t.start_date, t.end_date, t.annual_rent, t.prev_rent, t.renewals, t.last_sale_price, t.matched_by,
  po.owner_id, po.name as owner_name, po.is_company,
  ph.masked as owner_masked,
  (ph.owner_id is not null) as has_phone,
  coalesce(oc.n, 1) as owner_units,
  (select count(*) from desk.unit_owners x where x.unit_id = u.id and x.role = 'owner') as owners_n,
  exists (select 1 from desk.unit_owners x where x.unit_id = u.id and x.role = 'mortgagee') as mortgaged,
  (select max(c.called_at) from desk.calls c where c.unit_id = u.id) as last_called,
  (select c.outcome from desk.calls c where c.unit_id = u.id and c.outcome is not null order by c.called_at desc limit 1) as last_outcome
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

revoke all on desk.v_unit_list from public, anon, authenticated;
grant select on desk.v_unit_list to service_role;

create index if not exists unit_owners_owner_idx on desk.unit_owners (owner_id);
create index if not exists units_building_idx on desk.units (building_id);
