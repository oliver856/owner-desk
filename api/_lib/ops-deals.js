// The deal log: the Deals page and every change to a deal.
// All the rules (what a valid deal is, how a split is stored, the duplicate check, the change log) live in the
// database functions in migrations/015_deal_entry.sql. This file only passes values through and words the answers.
import { sql } from './core.js';
import { one } from './ops-pages.js';

export const dealsPage = (month) => one(sql`
  with m as (select ${month}::date as mo)
  select json_build_object(
    'month', (select mo from m),
    'today', ops.dubai_day(now()),
    'months', (select coalesce(json_agg(x.month order by x.month desc), '[]') from (
        select distinct month from ops.deals where deleted_at is null union select date_trunc('month', ops.dubai_day(now()))::date) x),
    'totals', (select json_build_object('billed', coalesce(sum(amount), 0), 'deals', count(*) filter (where counts_as_deal),
                 'sales', count(*) filter (where counts_as_deal and deal_type = 'sale'), 'rentals', count(*) filter (where counts_as_deal and deal_type = 'rent'))
               from ops.deals, m where deleted_at is null and month = m.mo),
    'deals', (select coalesce(json_agg(x order by x.date desc, x.id desc), '[]') from (
        select d.id, d.deal_date as date, d.email, coalesce(p.full_name, d.email) as name, d.amount, d.deal_type as type,
               d.counts_as_deal as counts, d.company_lead as "companyLead", d.property, d.deal_value as "dealValue", d.transferred_on as "transferredOn",
               (select coalesce(p2.full_name, o.email) from ops.deals o left join ops.people p2 on p2.email = o.email
                 where d.split_id is not null and o.split_id = d.split_id and o.id <> d.id and o.deleted_at is null limit 1) as "splitWith"
        from ops.deals d left join ops.people p on p.email = d.email, m where d.deleted_at is null and d.month = m.mo) x),
    'people', (select coalesce(json_agg(json_build_object('email', p.email, 'name', p.full_name, 'active', p.status = 'active',
                 'team', ops.team_at(p.email, ops.dubai_day(now()))) order by p.full_name), '[]') from ops.people p),
    'log', (select coalesce(json_agg(x order by x.id desc), '[]') from (
        select l.id, l.at, coalesce((select s.full_name from desk.staff s where lower(s.email) = l.by_email limit 1), l.by_email) as by, l.action, l.before, l.after, l.note, l.deal_ids[1] as "dealId",
               l.action = 'removed' and exists (select 1 from ops.deals d where d.id = l.deal_ids[1] and d.deleted_at is not null) as "canPutBack"
        from ops.deal_log l order by l.id desc limit 30) x)
  ) as j`);

// Bumps on every change to a deal, so pages that show deal figures never serve a remembered answer from before it
export const dealsVersion = async () => (await sql`select coalesce(max(id), 0)::int as v from ops.deal_log`)[0].v;

const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(/[,\s]/g, '')));
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const PATCH = ['date', 'type', 'amount', 'email', 'companyLead', 'property', 'dealValue', 'transferredOn'];

// Returns [httpStatus, json]. Messages raised by the database functions (code P0001) are written for the person
// and passed on as they are; anything else is a fault and is thrown.
export async function dealsWrite(by, b) {
  try {
    if (b.action === 'deal-add') {
      const amount = num(b.amount), dealValue = num(b.dealValue);
      if (!isDay(b.date)) return [400, { error: 'Enter the close date.' }];
      if (!Number.isFinite(amount)) return [400, { error: 'Enter a commission amount above zero.' }];
      if (dealValue != null && !Number.isFinite(dealValue)) return [400, { error: 'The property price must be a number, or left empty.' }];
      const j = await one(sql`select ops.deal_add(${by}, ${String(b.email || '')}, ${b.date}::date, ${amount}, ${String(b.type || '')},
        ${b.splitWith ? String(b.splitWith) : null}, ${!!b.companyLead}, ${b.property ? String(b.property).slice(0, 200) : null}, ${dealValue}, ${!!b.allowDuplicate}) as j`);
      return [200, j];   // { ok, ids }, or { duplicate, existing } when nothing was saved and the person has to confirm
    }
    const id = Number(b.id);
    if (!Number.isInteger(id)) return [400, { error: 'That deal is no longer there. Refresh the page.' }];
    if (b.action === 'deal-change') {
      const patch = {};
      for (const k of PATCH) if (b.patch && k in b.patch) patch[k] = b.patch[k];
      for (const k of ['amount', 'dealValue']) if (k in patch) { patch[k] = num(patch[k]); if (patch[k] != null && !Number.isFinite(patch[k])) return [400, { error: 'Enter amounts as numbers.' }]; }
      for (const k of ['date', 'transferredOn']) if (k in patch) { if (patch[k] === '') patch[k] = null; if (patch[k] != null && !isDay(patch[k])) return [400, { error: 'Enter dates as a day, month and year.' }]; }
      if ('property' in patch && patch.property != null) patch.property = String(patch.property).slice(0, 200);
      return [200, await one(sql`select ops.deal_change(${by}, ${id}, ${sql.json(patch)}) as j`)];
    }
    if (b.action === 'deal-remove') return [200, await one(sql`select ops.deal_remove(${by}, ${id}, ${b.note ? String(b.note).slice(0, 300) : null}) as j`)];
    if (b.action === 'deal-restore') return [200, await one(sql`select ops.deal_restore(${by}, ${id}) as j`)];
    return [400, { error: 'Unknown action' }];
  } catch (e) {
    if (e?.code === 'P0001') return [400, { error: e.message }];
    throw e;
  }
}
