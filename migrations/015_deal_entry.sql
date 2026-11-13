-- Apex Owner Desk · 015 deal entry
--
-- Deals are added, changed and removed only through the four functions below, so the rules live in one place and
-- every change is written to ops.deal_log (who, when, what it was before, what it is now). Nothing is ever deleted:
-- a removed deal is marked removed and can be put back.
--
-- A deal is one row per broker. A split deal is two rows sharing a split_id; only the first broker's row counts
-- towards the number of deals, so deal counts are always whole numbers.
-- Safe to run twice. Run after 014.

alter table ops.deals add column if not exists transferred_on date;
alter table ops.deals add column if not exists updated_at timestamptz;
alter table ops.deals add column if not exists updated_by text;

-- Rules the table itself enforces, whatever writes to it
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'deals_amount_positive') then
    alter table ops.deals add constraint deals_amount_positive check (amount > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deals_month_matches_date') then
    alter table ops.deals add constraint deals_month_matches_date check (month = date_trunc('month', deal_date)::date);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deals_email_person') then
    alter table ops.deals add constraint deals_email_person foreign key (email) references ops.people(email) on update cascade;
  end if;
end $$;
create index if not exists deals_split_idx on ops.deals (split_id) where split_id is not null;

create table if not exists ops.deal_log (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  by_email  text not null,
  action    text not null check (action in ('added', 'changed', 'removed', 'put back')),
  deal_ids  bigint[] not null,
  before    jsonb,
  after     jsonb,
  note      text
);
create index if not exists deal_log_at_idx on ops.deal_log (at desc);
alter table ops.deal_log enable row level security;

-- One deal row as plain data, for the log
create or replace function ops.deal_snapshot(ids bigint[]) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'date', d.deal_date, 'email', d.email, 'amount', d.amount,
           'type', d.deal_type, 'counts', d.counts_as_deal, 'companyLead', d.company_lead, 'property', d.property,
           'dealValue', d.deal_value, 'transferredOn', d.transferred_on, 'removed', d.deleted_at is not null) order by d.id), '[]')
  from ops.deals d where d.id = any(ids)
$$;

-- Every row of the same deal (both halves of a split)
create or replace function ops.deal_rows(deal_id bigint) returns bigint[] language sql stable as $$
  select array_agg(x.id order by x.id) from ops.deals d
  join ops.deals x on x.id = d.id or (d.split_id is not null and x.split_id = d.split_id)
  where d.id = deal_id
$$;

-- Shared checks. Errors raised here are written to be shown to the person as they are.
create or replace function ops.deal_check(p_email text, p_date date, p_amount numeric, p_type text) returns void language plpgsql stable as $$
begin
  if p_email is null or not exists (select 1 from ops.people where email = p_email) then
    raise exception 'Pick a broker from the list.' using errcode = 'P0001';
  end if;
  if p_date is null then raise exception 'Enter the close date.' using errcode = 'P0001'; end if;
  if p_date > ops.dubai_day(now()) then raise exception 'The close date can''t be in the future.' using errcode = 'P0001'; end if;
  if p_date < date '2026-01-01' then raise exception 'The close date is before 2026. Check the year.' using errcode = 'P0001'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter a commission amount above zero.' using errcode = 'P0001'; end if;
  if p_amount > 5000000 then raise exception 'That commission is over AED 5,000,000. Check the amount.' using errcode = 'P0001'; end if;
  if p_type is null or p_type not in ('sale', 'rent') then raise exception 'Choose sale or rental.' using errcode = 'P0001'; end if;
end $$;

-- Add a deal. p_amount is the whole commission to the company excluding VAT; with p_split_with it is halved between
-- the two brokers (whole dirhams, the halves always add back to the total).
-- Returns {"duplicate": true, ...} without saving when the same broker already has the same amount on the same day,
-- unless p_allow_duplicate is true.
create or replace function ops.deal_add(p_by text, p_email text, p_date date, p_amount numeric, p_type text,
  p_split_with text default null, p_company_lead boolean default false, p_property text default null,
  p_deal_value numeric default null, p_allow_duplicate boolean default false) returns jsonb language plpgsql as $$
declare
  v_email text := lower(trim(p_email));
  v_with  text := nullif(lower(trim(coalesce(p_split_with, ''))), '');
  v_total numeric := round(p_amount);
  v_a numeric; v_b numeric; v_id bigint; v_id2 bigint; v_split text; v_ids bigint[]; v_dup bigint;
begin
  if coalesce(p_by, '') = '' then raise exception 'No signed-in person.' using errcode = 'P0001'; end if;
  perform ops.deal_check(v_email, p_date, v_total, p_type);
  if v_with is not null then
    if v_with = v_email then raise exception 'Pick two different brokers for a split.' using errcode = 'P0001'; end if;
    if not exists (select 1 from ops.people where email = v_with) then raise exception 'Pick the second broker from the list.' using errcode = 'P0001'; end if;
    v_a := round(v_total / 2); v_b := v_total - v_a;
    if v_b <= 0 then raise exception 'That amount is too small to split.' using errcode = 'P0001'; end if;
  else
    v_a := v_total;
  end if;
  if p_deal_value is not null and p_deal_value <= 0 then raise exception 'The property price must be above zero, or left empty.' using errcode = 'P0001'; end if;

  if not p_allow_duplicate then
    select id into v_dup from ops.deals where deleted_at is null and email = v_email and deal_date = p_date and amount = v_a limit 1;
    if v_dup is not null then return jsonb_build_object('duplicate', true, 'existing', ops.deal_snapshot(array[v_dup])); end if;
  end if;

  insert into ops.deals (deal_date, month, email, amount, counts_as_deal, deal_type, company_lead, property, deal_value, source, created_by)
  values (p_date, date_trunc('month', p_date)::date, v_email, v_a, true, p_type, coalesce(p_company_lead, false),
          nullif(trim(coalesce(p_property, '')), ''), p_deal_value, 'owner desk', p_by)
  returning id into v_id;
  v_ids := array[v_id];
  if v_with is not null then
    v_split := 'od-' || v_id;
    update ops.deals set split_id = v_split where id = v_id;
    insert into ops.deals (deal_date, month, email, amount, counts_as_deal, deal_type, split_id, company_lead, property, deal_value, source, created_by)
    values (p_date, date_trunc('month', p_date)::date, v_with, v_b, false, p_type, v_split, coalesce(p_company_lead, false),
            nullif(trim(coalesce(p_property, '')), ''), p_deal_value, 'owner desk', p_by)
    returning id into v_id2;
    v_ids := v_ids || v_id2;
  end if;
  insert into ops.deal_log (by_email, action, deal_ids, after) values (p_by, 'added', v_ids, ops.deal_snapshot(v_ids));
  return jsonb_build_object('ok', true, 'ids', to_jsonb(v_ids));
end $$;

-- Change a deal. p_patch holds only what is changing:
--   date, type, property, dealValue, transferredOn   apply to the whole deal (both halves of a split)
--   amount, companyLead, email                       apply to this broker's row only
create or replace function ops.deal_change(p_by text, p_id bigint, p_patch jsonb) returns jsonb language plpgsql as $$
declare
  v_ids bigint[] := ops.deal_rows(p_id); v_before jsonb; r ops.deals%rowtype;
  v_date date; v_type text; v_amount numeric; v_email text;
begin
  if coalesce(p_by, '') = '' then raise exception 'No signed-in person.' using errcode = 'P0001'; end if;
  select * into r from ops.deals where id = p_id for update;
  if not found or r.deleted_at is not null then raise exception 'That deal is no longer there. Refresh the page.' using errcode = 'P0001'; end if;
  v_before := ops.deal_snapshot(v_ids);
  v_date   := case when p_patch ? 'date' then (p_patch->>'date')::date else r.deal_date end;
  v_type   := case when p_patch ? 'type' then p_patch->>'type' else r.deal_type end;
  v_amount := case when p_patch ? 'amount' then round((p_patch->>'amount')::numeric) else r.amount end;
  v_email  := case when p_patch ? 'email' then lower(trim(p_patch->>'email')) else r.email end;
  perform ops.deal_check(v_email, v_date, v_amount, v_type);
  if p_patch ? 'dealValue' and (p_patch->>'dealValue') is not null and (p_patch->>'dealValue')::numeric <= 0 then
    raise exception 'The property price must be above zero, or left empty.' using errcode = 'P0001';
  end if;
  if p_patch ? 'transferredOn' and (p_patch->>'transferredOn') is not null and (p_patch->>'transferredOn')::date > ops.dubai_day(now()) then
    raise exception 'The transfer date can''t be in the future.' using errcode = 'P0001';
  end if;
  if v_email <> r.email and exists (select 1 from ops.deals where id = any(v_ids) and id <> p_id and email = v_email) then
    raise exception 'That broker already has the other half of this deal.' using errcode = 'P0001';
  end if;

  update ops.deals set
    deal_date = v_date, month = date_trunc('month', v_date)::date, deal_type = v_type,
    property = case when p_patch ? 'property' then nullif(trim(coalesce(p_patch->>'property', '')), '') else property end,
    deal_value = case when p_patch ? 'dealValue' then (p_patch->>'dealValue')::numeric else deal_value end,
    transferred_on = case when p_patch ? 'transferredOn' then (p_patch->>'transferredOn')::date else transferred_on end,
    updated_at = now(), updated_by = p_by
  where id = any(v_ids) and deleted_at is null;
  update ops.deals set amount = v_amount, email = v_email,
    company_lead = case when p_patch ? 'companyLead' then coalesce((p_patch->>'companyLead')::boolean, false) else company_lead end
  where id = p_id;

  if ops.deal_snapshot(v_ids) = v_before then return jsonb_build_object('ok', true, 'unchanged', true); end if;
  insert into ops.deal_log (by_email, action, deal_ids, before, after) values (p_by, 'changed', v_ids, v_before, ops.deal_snapshot(v_ids));
  return jsonb_build_object('ok', true, 'ids', to_jsonb(v_ids));
end $$;

-- Remove a whole deal (both halves of a split). It stays in the table, marked removed.
create or replace function ops.deal_remove(p_by text, p_id bigint, p_note text default null) returns jsonb language plpgsql as $$
declare v_ids bigint[] := ops.deal_rows(p_id); v_before jsonb;
begin
  if coalesce(p_by, '') = '' then raise exception 'No signed-in person.' using errcode = 'P0001'; end if;
  if v_ids is null or not exists (select 1 from ops.deals where id = p_id and deleted_at is null) then
    raise exception 'That deal is no longer there. Refresh the page.' using errcode = 'P0001';
  end if;
  v_before := ops.deal_snapshot(v_ids);
  update ops.deals set deleted_at = now(), deleted_by = p_by where id = any(v_ids) and deleted_at is null;
  insert into ops.deal_log (by_email, action, deal_ids, before, after, note)
  values (p_by, 'removed', v_ids, v_before, ops.deal_snapshot(v_ids), nullif(trim(coalesce(p_note, '')), ''));
  return jsonb_build_object('ok', true, 'ids', to_jsonb(v_ids));
end $$;

-- Put a removed deal back
create or replace function ops.deal_restore(p_by text, p_id bigint) returns jsonb language plpgsql as $$
declare v_ids bigint[] := ops.deal_rows(p_id); v_before jsonb;
begin
  if coalesce(p_by, '') = '' then raise exception 'No signed-in person.' using errcode = 'P0001'; end if;
  if v_ids is null or not exists (select 1 from ops.deals where id = p_id and deleted_at is not null) then
    raise exception 'That deal is already in the log.' using errcode = 'P0001';
  end if;
  v_before := ops.deal_snapshot(v_ids);
  update ops.deals set deleted_at = null, deleted_by = null, updated_at = now(), updated_by = p_by where id = any(v_ids);
  insert into ops.deal_log (by_email, action, deal_ids, before, after) values (p_by, 'put back', v_ids, v_before, ops.deal_snapshot(v_ids));
  return jsonb_build_object('ok', true, 'ids', to_jsonb(v_ids));
end $$;

revoke all on all tables in schema ops from public, anon, authenticated;
revoke all on all functions in schema ops from public, anon, authenticated;
