-- Apex Owner Desk · 001 core schema
-- Everything lives in the private schema "desk", which is NOT exposed through the Data API.
-- Browsers never talk to the database. Only the Owner Desk server (after its own login,
-- office-IP and limit checks) reaches it, using server-side credentials.

create schema if not exists desk;
revoke all on schema desk from public, anon, authenticated;

-- ---------- places ----------
create table desk.areas (
  id          bigint generated always as identity primary key,
  name        text not null unique
);

create table desk.buildings (
  id            bigint generated always as identity primary key,
  area_id       bigint not null references desk.areas(id),
  subcommunity  text not null,
  name          text not null,                 -- building name; villa communities use the subcommunity
  pi_locations  text[] not null default '{}',  -- Property Index location names this building maps to
  unique (area_id, subcommunity, name)
);

create table desk.units (
  id           bigint generated always as identity primary key,
  building_id  bigint not null references desk.buildings(id),
  unit_no      text not null,
  unit_type    text not null check (unit_type in ('Apartment','Villa')),
  beds         text,
  size_sqft    numeric(10,1),
  land_no      text,
  unique (building_id, unit_no)
);

-- ---------- owners (names only; phone numbers kept apart) ----------
create table desk.owners (
  id          bigint generated always as identity primary key,
  name        text not null,
  is_company  boolean not null default false,
  source_key  text not null unique             -- name|phone key from the source file, for re-imports
);

create table desk.unit_owners (
  unit_id   bigint not null references desk.units(id) on delete cascade,
  owner_id  bigint not null references desk.owners(id) on delete cascade,
  role      text not null default 'owner' check (role in ('owner','mortgagee')),
  primary key (unit_id, owner_id)
);

-- Phone numbers: the most sensitive table. Read only by the call-release function.
create table desk.owner_phones (
  owner_id   bigint primary key references desk.owners(id) on delete cascade,
  phone      text not null,                    -- digits, 971-format for UAE numbers
  masked     text not null                     -- what screens are allowed to show, e.g. +971 50 ••• ••51
);

-- ---------- registered tenancies (Ejari via Property Index) ----------
create table desk.tenancies (
  unit_id         bigint primary key references desk.units(id) on delete cascade,
  pi_property_id  text not null,
  start_date      date not null,
  end_date        date not null,
  annual_rent     numeric(12,0),
  prev_rent       numeric(12,0),
  renewals        int,
  last_sale_price numeric(14,0),
  matched_by      text not null check (matched_by in ('Unit number','Size')),
  loaded_at       timestamptz not null default now()
);
create index on desk.tenancies (end_date);

-- Units where we know there is no live contract (every contract in the building was accounted for)
create table desk.lease_status (
  unit_id  bigint primary key references desk.units(id) on delete cascade,
  status   text not null check (status in ('Live Ejari','No live Ejari','Not confirmed')),
  as_of    date not null
);

-- ---------- staff and access ----------
create table desk.staff (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  full_name    text not null,
  email        text not null unique,
  role         text not null check (role in ('broker','manager','admin')),
  team         text,
  active       boolean not null default true,
  phone_device text,                           -- registered phone (push subscription id)
  created_at   timestamptz not null default now()
);

create table desk.staff_areas (
  user_id     uuid not null references desk.staff(user_id) on delete cascade,
  area_id     bigint not null references desk.areas(id),
  kind        text not null check (kind in ('core','granted')),
  granted_by  uuid references desk.staff(user_id),
  expires_at  date,                            -- granted areas can expire
  primary key (user_id, area_id)
);

-- ---------- calling ----------
create table desk.call_requests (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references desk.staff(user_id),
  unit_id     bigint not null references desk.units(id),
  owner_id    bigint not null references desk.owners(id),
  token_hash  text not null unique,            -- one-time token sent to the phone, stored hashed
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  request_ip  inet
);

create table desk.calls (
  id              bigint generated always as identity primary key,
  request_id      bigint references desk.call_requests(id),
  user_id         uuid not null references desk.staff(user_id),
  unit_id         bigint not null references desk.units(id),
  owner_id        bigint not null references desk.owners(id),
  outcome         text check (outcome in ('No answer','Not interested','Call back','Wants valuation',
                                          'Listing opportunity','Wants to sell','Wrong number','Do not call')),
  callback_on     date,
  note            text,
  sent_to_kendal  boolean not null default false,
  called_at       timestamptz not null default now(),
  outcome_at      timestamptz
);
create index on desk.calls (unit_id, called_at desc);
create index on desk.calls (user_id, called_at desc);

-- Owners who asked not to be called again: the Call button is blocked for them
create table desk.do_not_call (
  owner_id   bigint primary key references desk.owners(id) on delete cascade,
  added_by   uuid references desk.staff(user_id),
  added_at   timestamptz not null default now(),
  reason     text
);

-- ---------- audit and limits ----------
create table desk.audit_log (
  id       bigint generated always as identity primary key,
  user_id  uuid,
  action   text not null,                      -- signed_in, searched, opened_unit, call_sent, call_redeemed, copy_blocked, limit_hit, ...
  unit_id  bigint,
  detail   jsonb not null default '{}',
  ip       inet,
  at       timestamptz not null default now()
);
create index on desk.audit_log (user_id, at desc);
create index on desk.audit_log (action, at desc);

create table desk.settings (
  key    text primary key,
  value  jsonb not null
);
insert into desk.settings (key, value) values
  ('daily_profile_cap', '80'),
  ('daily_call_cap', '60'),
  ('call_hours', '{"from":"09:00","to":"18:00","tz":"Asia/Dubai"}'),
  ('call_token_minutes', '2'),
  ('office_ips', '[]');

-- Audit log is append-only: no one can edit or delete history, not even the server.
create or replace function desk.block_audit_changes() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;
create trigger audit_log_no_update before update or delete on desk.audit_log
  for each row execute function desk.block_audit_changes();

-- ---------- lock every table ----------
-- Row level security on, with no policies: nobody using the public or logged-in API roles can read a row.
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'desk' loop
    execute format('alter table desk.%I enable row level security', t.tablename);
    execute format('revoke all on desk.%I from public, anon, authenticated', t.tablename);
  end loop;
end $$;
alter default privileges in schema desk revoke all on tables from public, anon, authenticated;
alter default privileges in schema desk revoke all on functions from public, anon, authenticated;

-- Only the server's own role can use the schema
grant usage on schema desk to service_role;
grant select, insert, update, delete on all tables in schema desk to service_role;
grant usage on all sequences in schema desk to service_role;

-- Check: this should return no rows (no table in desk is reachable by anon or logged-in API users)
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'desk' and grantee in ('anon','authenticated','PUBLIC');
