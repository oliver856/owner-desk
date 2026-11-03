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
  return ready.then(() => ensureTests());
}

// Test call outs: only the person who started one sees it, with made-up numbers. Nobody else is affected.
// The test flag lives in its own small table, so setting it up never has to lock the call outs table.
// If that table isn't there yet, everything still works as normal; test mode just stays switched off.
let testsReady = false;
async function ensureTests() {
  if (testsReady) return true;
  try {
    const [r] = await sql`select to_regclass('desk.callout_tests') is not null as ok`;
    if (!r.ok) {
      await sql.begin(async (tx) => {
        await tx`set local lock_timeout = '2s'`;
        await tx`create table if not exists desk.callout_tests (callout_id bigint primary key, created_at timestamptz not null default now())`;
        await tx`alter table desk.callout_tests enable row level security`;
        await tx`revoke all on desk.callout_tests from anon, authenticated`;
      });
    }
    testsReady = true;
  } catch (e) { console.error('Test call outs not ready:', e.message); }
  return testsReady;
}
export const testsOn = () => testsReady;
// "Is this call out a test?" (false for everything until the tests table exists)
export const isTest = () => (testsReady ? sql`exists (select 1 from desk.callout_tests t where t.callout_id = co.id)` : sql`false`);

// The call out this person's buttons act on: their own running test first, otherwise the real one
export async function runningCalloutId(me) {
  await ensureCallouts();
  const [r] = await sql`select co.id from desk.callouts co
    where co.ended_at is null and co.ends_at > now() and (not ${isTest()} or co.started_by = ${me.user_id})
    order by ${isTest()} desc, co.id desc limit 1`;
  return r?.id || null;
}

// Made-up but steady numbers for a test: each person calls at their own pace, so the board moves like the real thing
function fakeBoard(people, mins) {
  const h = (str, k) => { let x = 2166136261 ^ k; for (const ch of str) x = Math.imul(x ^ ch.charCodeAt(0), 16777619); return ((x >>> 0) % 1000) / 1000; };
  return people.map((p) => {
    const quiet = h(p.user_id, 1) < 0.12;
    const rate = 0.35 + h(p.user_id, 2) * 1.3;
    const calls = quiet ? 0 : Math.max(0, Math.floor(mins * rate + h(p.user_id + Math.floor(mins), 3) * 2 - 1));
    const hot = Math.floor(calls * (0.03 + h(p.user_id, 4) * 0.1));
    return { ...p, calls, hot, wa: 0, first_at: calls ? new Date() : null, last_at: calls ? new Date(Date.now() - h(p.user_id, 5) * 60000) : null };
  });
}

const HOT = sql`(c.outcome in ('Call back', 'Wants valuation', 'Listing opportunity', 'Wants to sell') or c.note ~* '^(unit available|in discussion|replied|follow up|wants to|send report|still looking|viewing booked|send options)')`;

// The running call out, or the one that finished in the last 15 minutes (for the results screen)
export async function currentCallout(me) {
  await ensureCallouts();
  const [co] = await sql`
    select co.*, ${isTest()} as is_test, st.full_name as started_by_name, now() as server_now,
           least(now(), coalesce(co.ended_at, co.ends_at)) as count_to,
           (co.ended_at is null and co.ends_at > now()) as running
    from desk.callouts co join desk.staff st on st.user_id = co.started_by
    where ((co.ended_at is null and co.ends_at > now()) or coalesce(co.ended_at, co.ends_at) > now() - interval '15 minutes')
      and (not ${isTest()} or co.started_by = ${me.user_id})
    order by (co.ended_at is null and co.ends_at > now()) desc, ${isTest()} desc, co.id desc limit 1`;
  if (!co) return { callout: null, features: { test: testsOn() } };
  // A real call out's board is the same for everyone, so it's worked out at most once every 3 seconds and shared.
  // (With the whole office on the Desk, every screen asks every few seconds.) Tests are only ever seen by one person.
  if (!co.is_test) {
    const hit = boardCache.get(co.id);
    if (hit && Date.now() - hit.at < 3000) return shape(co, await hit.p, me);
    const p = boardFor(co, null).catch((e) => { boardCache.delete(co.id); throw e; });
    boardCache.clear(); boardCache.set(co.id, { at: Date.now(), p });
    return shape(co, await p, me);
  }
  return shape(co, await boardFor(co, me), me);
}

const boardCache = new Map();
async function boardFor(co, me) {
  const inTeams = co.teams && co.teams.length ? sql`coalesce(st.team, 'No team') = any(${co.teams})` : sql`true`;
  let board = await sql`
    select st.user_id, st.full_name as name, coalesce(st.team, 'No team') as team,
           count(c.id)::int as calls, count(c.id) filter (where ${HOT})::int as hot,
           count(c.id) filter (where c.note ~* 'whatsapp sent')::int as wa,
           min(c.called_at) as first_at, max(c.called_at) as last_at
    from desk.staff st
    left join desk.calls c on c.user_id = st.user_id and c.called_at >= ${co.starts_at} and c.called_at <= ${co.count_to}
    where st.active and ${inTeams} and (st.role in ('broker', 'manager') or c.id is not null${me ? sql` or st.user_id = ${me.user_id}` : sql``})
    group by st.user_id, st.full_name, st.team`;
  const elapsed = Math.max(0, (new Date(co.count_to) - new Date(co.starts_at)) / 60000);
  if (co.is_test) board = fakeBoard(board, elapsed);
  const score = (b) => (co.mode === 'hot' ? b.hot * 1000 + b.calls : co.mode === 'points' ? b.calls + b.hot * 4 : b.calls);
  board.sort((a, b) => score(b) - score(a) || (a.last_at ? new Date(a.last_at) : Infinity) - (b.last_at ? new Date(b.last_at) : Infinity) || a.name.localeCompare(b.name));
  const recent = co.is_test
    ? board.filter((b) => b.hot).slice(0, 5).map((b, i) => ({ name: b.name, what: ['Wants valuation', 'Call back', 'Listing opportunity'][i % 3], at: new Date() }))
    : await sql`
    select st.full_name as name, coalesce(c.outcome, split_part(c.note, '.', 1)) as what, c.called_at as at
    from desk.calls c join desk.staff st on st.user_id = c.user_id
    where c.called_at >= ${co.starts_at} and c.called_at <= ${co.count_to} and ${HOT}
    order by c.called_at desc limit 5`;
  return { board, recent };
}

function shape(co, { board, recent }, me) {
  const meIn = board.some((b) => b.user_id === me.user_id);
  return {
    features: { test: testsOn() },
    callout: {
      id: co.id, startsAt: co.starts_at, endsAt: co.ended_at || co.ends_at, running: co.running, minutes: co.minutes,
      teams: co.teams, target: co.target, prize: co.prize, mode: co.mode, test: !!co.is_test, startedBy: co.started_by_name, serverNow: co.server_now,
    },
    meIn,
    board: board.map((b) => ({ me: b.user_id === me.user_id, name: b.name, team: b.team, calls: b.calls, hot: b.hot, wa: b.wa,
      points: b.calls + b.hot * 4, firstAt: b.first_at })),
    recent,
  };
}
