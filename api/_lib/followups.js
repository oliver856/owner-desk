// Follow-ups: after every call the broker picks when to call back (tomorrow, in a week, or a date and time).
// If they don't pick, it's set for a month later, unless the owner asked not to be called.
// Kept in its own small table, created once without touching any busy table.
import { sql } from './core.js';

let ready = false;
export async function ensureFollowups() {
  if (ready) return;
  const [r] = await sql`select to_regclass('desk.followups') is not null as ok`;
  if (!r.ok) {
    await sql.begin(async (tx) => {
      await tx`set local lock_timeout = '2s'`;
      await tx`create table if not exists desk.followups (
        id bigint generated always as identity primary key,
        call_id bigint not null unique,
        user_id uuid not null, unit_id bigint not null, owner_id bigint not null,
        due_at timestamptz not null, kind text not null,
        done_at timestamptz, created_at timestamptz not null default now())`;
      await tx`create index if not exists followups_user_due_idx on desk.followups (user_id, due_at) where done_at is null`;
      await tx`alter table desk.followups enable row level security`;
      await tx`revoke all on desk.followups from anon, authenticated`;
    });
  }
  ready = true;
}

// kind: 'day' | 'week' | 'custom' (with at) | anything else = the automatic month
export function dueFrom(f) {
  const k = f && f.kind;
  if (k === 'day') return { kind: 'day', at: new Date(Date.now() + 864e5) };
  if (k === 'week') return { kind: 'week', at: new Date(Date.now() + 7 * 864e5) };
  if (k === 'custom' && f.at) {
    const at = new Date(f.at);
    if (!isNaN(at) && at > Date.now() - 36e5 && at < Date.now() + 400 * 864e5) return { kind: 'custom', at };
  }
  const at = new Date(); at.setMonth(at.getMonth() + 1);
  return { kind: 'auto', at };
}

// After a call is saved: close this broker's earlier open follow-ups for the owner (they've just called), then set
// the new one. Do not call = no follow-up.
export async function setFollowup(s, call, outcome, followup) {
  await ensureFollowups();
  await sql`update desk.followups set done_at = now()
            where user_id = ${s.user_id} and owner_id = ${call.owner_id} and done_at is null and call_id <> ${call.id}`;
  if (outcome === 'Do not call') {
    await sql`delete from desk.followups where call_id = ${call.id}`;
    return null;
  }
  const d = dueFrom(followup);
  const [f] = await sql`
    insert into desk.followups (call_id, user_id, unit_id, owner_id, due_at, kind)
    values (${call.id}, ${s.user_id}, ${call.unit_id}, ${call.owner_id}, ${d.at}, ${d.kind})
    on conflict (call_id) do update set due_at = case when ${d.kind} = 'auto' and desk.followups.kind <> 'auto' then desk.followups.due_at else excluded.due_at end,
      kind = case when ${d.kind} = 'auto' and desk.followups.kind <> 'auto' then desk.followups.kind else excluded.kind end, done_at = null
    returning due_at, kind`;
  return f;
}
