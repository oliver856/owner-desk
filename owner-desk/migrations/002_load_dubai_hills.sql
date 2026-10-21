-- Apex Owner Desk · 002 load Dubai Hills Estate from the staging table, then drop it
begin;

insert into desk.areas (name) values ('Dubai Hills Estate') on conflict (name) do nothing;

insert into desk.buildings (area_id, subcommunity, name)
select distinct a.id, r.subcommunity,
       case when r.unit_type = 'Villa' then r.subcommunity else r.building end
from desk.import_rows r cross join (select id from desk.areas where name = 'Dubai Hills Estate') a
on conflict do nothing;

insert into desk.units (building_id, unit_no, unit_type, beds, size_sqft, land_no)
select distinct on (b.id, r.unit_no)
       b.id, r.unit_no, r.unit_type, nullif(r.beds, ''), nullif(r.size_sqft, '')::numeric, nullif(r.land_no, '')
from desk.import_rows r
join desk.buildings b on b.subcommunity = r.subcommunity
 and b.name = case when r.unit_type = 'Villa' then r.subcommunity else r.building end
order by b.id, r.unit_no;

insert into desk.owners (name, is_company, source_key)
select distinct on (owner_key) owner_name, owner_is_company = 'true', owner_key
from desk.import_rows order by owner_key;

insert into desk.owner_phones (owner_id, phone, masked)
select distinct on (o.id) o.id, r.phone, r.masked
from desk.import_rows r join desk.owners o on o.source_key = r.owner_key
where r.phone <> ''
order by o.id;

create temp table unit_map as
select distinct r.subcommunity, r.building, r.unit_no, u.id as unit_id
from desk.import_rows r
join desk.buildings b on b.subcommunity = r.subcommunity
 and b.name = case when r.unit_type = 'Villa' then r.subcommunity else r.building end
join desk.units u on u.building_id = b.id and u.unit_no = r.unit_no;

insert into desk.unit_owners (unit_id, owner_id, role)
select distinct m.unit_id, o.id, r.role
from desk.import_rows r
join unit_map m using (subcommunity, building, unit_no)
join desk.owners o on o.source_key = r.owner_key
on conflict do nothing;

insert into desk.tenancies (unit_id, pi_property_id, start_date, end_date, annual_rent, prev_rent, renewals, last_sale_price, matched_by)
select distinct on (m.unit_id) m.unit_id, r.t_property_id, r.t_start::date, r.t_end::date,
       nullif(r.t_rent, '')::numeric, nullif(r.t_prev, '')::numeric, nullif(r.t_renewals, '')::int,
       nullif(r.t_last_sale, '')::numeric, r.t_matched_by
from desk.import_rows r join unit_map m using (subcommunity, building, unit_no)
where r.t_property_id <> ''
order by m.unit_id;

insert into desk.lease_status (unit_id, status, as_of)
select distinct on (m.unit_id) m.unit_id, r.lease_status, date '2026-09-30'
from desk.import_rows r join unit_map m using (subcommunity, building, unit_no)
order by m.unit_id;

commit;

-- Counts to check against the master sheet
select 'staging rows' as what, count(*) from desk.import_rows
union all select 'buildings', count(*) from desk.buildings
union all select 'units', count(*) from desk.units
union all select 'owners', count(*) from desk.owners
union all select 'owners with a phone', count(*) from desk.owner_phones
union all select 'unit-owner links', count(*) from desk.unit_owners
union all select 'live tenancies', count(*) from desk.tenancies
union all select 'lease: Live Ejari', count(*) from desk.lease_status where status = 'Live Ejari'
union all select 'lease: No live Ejari', count(*) from desk.lease_status where status = 'No live Ejari'
union all select 'lease: Not confirmed', count(*) from desk.lease_status where status = 'Not confirmed';
