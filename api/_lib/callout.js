// Call out mode: a timed, competitive calling session a manager starts for everyone (or chosen teams).
// Only calls dialled between starts_at and the end count. The table is created once, without touching other tables.
import { sql } from './core.js';

let ready = null;
export function ensureCallouts() {
  ready ??= (async () => {
    const [r] = await sql`select to_regclass('desk.callouts') is not null as ok`;
    if (r.ok) return;
    await sql`create table if not exists desk.callouts (
      id bigint generated always as identity primary key,
      started_by uuid not null references desk.staff(user_id),
      starts_at timestamptz not null,
      ends_at timestamptz not null,
      ended_at timestamptz,
      minutes int not null,
      teams text[],
      target int not null default 0,
      prize text,
      mode text not null default 'calls' check (mode in ('calls', 'hot', 'points')),
      created_at timestamptz not null default now())`;
    await sql`alter table desk.callouts enable row level security`;
    await sql`revoke all on desk.callouts from anon, authenticated`;
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

const HOT = sql`(c.outcome in ('Call back', 'Wants valuation', 'Listing opportunity', 'Wants to sell') or c.note ~* '^(unit available|in discussion|replied|follow up|wants to|send report)')`;

// The running call out, or the one that finished in the last 15 minutes (for the results screen)
export async function currentCallout(me) {
  await ensureCallouts();
  const [co] = await sql`
    select co.*, st.full_name as started_by_name, now() as server_now,
           least(now(), coalesce(co.ended_at, co.ends_at)) as count_to,
           (co.ended_at is null and co.ends_at > now()) as running
    from desk.callouts co join desk.staff st on st.user_id = co.started_by
    where (co.ended_at is null and co.ends_at > now()) or coalesce(co.ended_at, co.ends_at) > now() - interval '15 minutes'
    order by co.id desc limit 1`;
  if (!co) return { callout: null };
  const inTeams = co.teams && co.teams.length ? sql`coalesce(st.team, 'No team') = any(${co.teams})` : sql`true`;
  const board = await sql`
    select st.user_id, st.full_name as name, coalesce(st.team, 'No team') as team,
           count(c.id)::int as calls, count(c.id) filter (where ${HOT})::int as hot,
           count(c.id) filter (where c.note ~* 'whatsapp sent')::int as wa,
           min(c.called_at) as first_at, max(c.called_at) as last_at
    from desk.staff st
    left join desk.calls c on c.user_id = st.user_id and c.called_at >= ${co.starts_at} and c.called_at <= ${co.count_to}
    where st.active and ${inTeams} and (st.role in ('broker', 'manager') or c.id is not null or st.user_id = ${me.user_id})
    group by st.user_id, st.full_name, st.team`;
  const score = (b) => (co.mode === 'hot' ? b.hot * 1000 + b.calls : co.mode === 'points' ? b.calls + b.hot * 4 : b.calls);
  board.sort((a, b) => score(b) - score(a) || (a.last_at ? new Date(a.last_at) : Infinity) - (b.last_at ? new Date(b.last_at) : Infinity) || a.name.localeCompare(b.name));
  const recent = await sql`
    select st.full_name as name, coalesce(c.outcome, split_part(c.note, '.', 1)) as what, c.called_at as at
    from desk.calls c join desk.staff st on st.user_id = c.user_id
    where c.called_at >= ${co.starts_at} and c.called_at <= ${co.count_to} and ${HOT}
    order by c.called_at desc limit 5`;
  const meIn = board.some((b) => b.user_id === me.user_id);
  return {
    callout: {
      id: co.id, startsAt: co.starts_at, endsAt: co.ended_at || co.ends_at, running: co.running, minutes: co.minutes,
      teams: co.teams, target: co.target, prize: co.prize, mode: co.mode, startedBy: co.started_by_name, serverNow: co.server_now,
    },
    meIn,
    board: board.map((b) => ({ me: b.user_id === me.user_id, name: b.name, team: b.team, calls: b.calls, hot: b.hot, wa: b.wa,
      points: b.calls + b.hot * 4, firstAt: b.first_at })),
    recent,
  };
}
