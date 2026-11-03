// Lead pool: buyer and tenant enquiries to call, shared out evenly and at random so everyone has their own.
// Each lead is stored as a hidden "unit" in the Lead pool area with the lead as its owner, so calling, notes, holds,
// WhatsApp follow-ups, dashboards and call outs work exactly as they do for owners. desk.leads adds what was asked for
// (location, beds, budget) and who the lead belongs to.
import { sql } from './core.js';

let ready = false;
export async function ensureLeads() {
  if (ready) return;
  const [r] = await sql`select to_regclass('desk.leads') is not null as ok`;
  if (!r.ok) {
    await sql.begin(async (tx) => {
      await tx`set local lock_timeout = '2s'`;
      await tx`create table if not exists desk.leads (
        unit_id bigint primary key, owner_id bigint not null, name text, location text, beds text, budget text, budget_num numeric,
        batch text, assigned_to uuid, assigned_at timestamptz, created_at timestamptz not null default now())`;
      await tx`create index if not exists leads_assigned_idx on desk.leads (assigned_to)`;
      await tx`alter table desk.leads enable row level security`;
      await tx`revoke all on desk.leads from anon, authenticated`;
    });
  }
  ready = true;
}

// SQL check: this unit is either not a lead, or it's a lead this person may call (theirs; managers and up: any)
export const leadAllowed = (s, unitCol) => (s.leadArea
  ? sql`(not exists (select 1 from desk.leads l where l.unit_id = ${sql(unitCol)}) or ${s.role !== 'broker'}
         or exists (select 1 from desk.leads l where l.unit_id = ${sql(unitCol)} and l.assigned_to = ${s.user_id}))`
  : sql`true`);

// "2 bed in Dubai Marina", "studio in JLT", "property in Downtown Dubai"
export function leadWhat(l) {
  const b = String(l.beds || '').trim();
  const kind = /^studio$/i.test(b) ? 'studio' : /^\d+$/.test(b) ? `${b} bed` : 'property';
  const loc = l.location && l.location !== 'Not given' ? ` in ${l.location}` : '';
  return kind + loc;
}

// Cold: tried and not reached. "Callbacks" are the ones to try again.
export const LEAD_RETRY = '^(called, (no reply|unreachable|line busy)|phone off)';
