// Monthly market report sign-ups: owners who said yes to a report every month. One row per unit.
// The table is created once, the first time it's needed, without touching other tables.
import { sql } from './core.js';

let ready = null;
export function ensureReports() {
  ready ??= (async () => {
    const [r] = await sql`select to_regclass('desk.report_optins') is not null as ok`;
    if (r.ok) return;
    await sql`create table if not exists desk.report_optins (
      unit_id bigint primary key references desk.units(id) on delete cascade,
      user_id uuid not null references desk.staff(user_id),
      created_at timestamptz not null default now())`;
    await sql`create index if not exists report_optins_user_idx on desk.report_optins (user_id)`;
    await sql`alter table desk.report_optins enable row level security`;
    await sql`revoke all on desk.report_optins from anon, authenticated`;
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

// Sign a unit up (on = true) or take it off the list (on = false)
export async function setReportOptin(userId, unitId, on) {
  await ensureReports();
  if (on) await sql`insert into desk.report_optins (unit_id, user_id) values (${unitId}, ${userId}) on conflict (unit_id) do nothing`;
  else await sql`delete from desk.report_optins where unit_id = ${unitId}`;
}
