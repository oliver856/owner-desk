// Office-only actions: /api/desk?action=...
// Every action checks the office IP and the signed-in broker before touching data.
import { getTemplates, saveTemplates } from './_lib/templates.js';
import { ensureCallouts, currentCallout, runningCalloutId, isTest, testsOn } from './_lib/callout.js';
import { ensureInvites, cleanEmail, validEmail, ROLES, setAreas } from './_lib/team.js';
import crypto from 'node:crypto';
import { sql, ensureOnce, route, query, body, audit, caps, setting, callTarget, ensureTargets, baseTarget, goalFor, rocketAllowed, notLocked } from './_lib/core.js';
import { whereSql, tabSql, sortSql, TABS } from './_lib/filters.js';
import { pushToUser } from './_lib/push.js';
import { ensureHolds, holdFor } from './_lib/holds.js';
import { ensureReports, setReportOptin } from './_lib/reports.js';
import { ensureKendal } from './_lib/kendal.js';
import { ensureLeads, leadAllowed, LEAD_RETRY } from './_lib/leads.js';
import { ensureFollowups } from './_lib/followups.js';

const PAGE = 100;
const COLS = ['id', 'subcommunity', 'building', 'unit_no', 'unit_type', 'beds', 'size_sqft', 'lease_status', 'end_date', 'annual_rent',
  'prev_rent', 'renewals', 'last_sale_price', 'owner_id', 'owner_name', 'owner_masked', 'has_phone', 'owner_units', 'owners_n', 'mortgaged',
  'last_called', 'last_outcome'];

// Leads: brokers can only copy, call or note their own. Nothing to check until the Lead pool exists.
// (Returns a piece of SQL, so it must never be awaited: awaiting a piece of SQL runs it on its own.)
function leadCheck(s) {
  return s.leadArea ? leadAllowed(s, 'u.id') : sql`true`;
}
const LEAD_HOT = "^(still looking|viewing booked|send options|follow up|replied|wants to|in discussion)";
const LEAD_TABS = ['todo', 'retry', 'hot', 'called', 'all'];

const places = new Map(); // building list per area set, kept for 1 minute

// Each person's own order for the hot and cold quick notes
const ensureStaffUi = ensureOnce((q) => q`select to_regclass('desk.staff_ui') is not null as ok`, async (tx) => {
  await tx`create table if not exists desk.staff_ui (
    user_id uuid primary key references desk.staff(user_id) on delete cascade,
    quick_order jsonb not null default '{}', updated_at timestamptz not null default now())`;
  await tx`alter table desk.staff_ui enable row level security`;
  await tx`revoke all on desk.staff_ui from anon, authenticated`;
});

// Adds the 'director' role (sees every team, like an admin, but can't change settings)
const ensureRoles = ensureOnce((q) => q`select exists (select 1 from pg_constraint where conname = 'staff_role_check'
    and pg_get_constraintdef(oid) like '%director%') as ok`, async (tx) => {
  await tx`alter table desk.staff drop constraint if exists staff_role_check`;
  await tx`alter table desk.staff add constraint staff_role_check check (role in ('broker', 'manager', 'director', 'admin'))`;
});

// One-off set-up steps. Each only runs if its own table/column is missing, and never waits on a busy table.
const ensurePrefs = ensureOnce((q) => q`select to_regclass('desk.staff_prefs') is not null as ok`, async (tx) => {
  await tx`create table if not exists desk.staff_prefs (
    user_id uuid primary key references desk.staff(user_id) on delete cascade,
    prefs jsonb not null, updated_at timestamptz not null default now())`;
  await tx`alter table desk.staff_prefs enable row level security`;
  await tx`revoke all on desk.staff_prefs from anon, authenticated`;
});
// Older unit codes and villa types (e.g. Springs/Meadows/Lakes) live in two optional columns
const ensureUnitExtras = ensureOnce((q) => q`select count(*) = 2 as ok from pg_attribute
    where attrelid = 'desk.units'::regclass and attname in ('old_code', 'layout') and not attisdropped`,
  (tx) => tx`alter table desk.units add column if not exists old_code text, add column if not exists layout text`);
const ensureNotes = ensureOnce((q) => q`select to_regclass('desk.notes') is not null and to_regclass('desk.notes_unit_idx') is not null as ok`, async (tx) => {
  await tx`create table if not exists desk.notes (
    id bigint generated always as identity primary key,
    unit_id bigint not null references desk.units(id),
    user_id uuid not null references desk.staff(user_id),
    body text not null check (length(body) between 1 and 2000),
    created_at timestamptz not null default now())`;
  await tx`create index if not exists notes_unit_idx on desk.notes (unit_id, created_at desc)`;
  await tx`alter table desk.notes enable row level security`;
  await tx`revoke all on desk.notes from anon, authenticated`;
});
// Hot and cold, the same way the dashboards count them
const DASH_HOT = sql`(c.outcome in ('Call back', 'Wants valuation', 'Listing opportunity', 'Wants to sell') or c.note ~* '^(unit available|in discussion|replied|follow up|wants to|send report|still looking|viewing booked|send options)')`;
const DASH_COLD = sql`(c.outcome in ('No answer', 'Not interested', 'Wrong number', 'Do not call') or c.note ~* '^(called, no reply|called, unreachable|called, line busy|phone off|end user|rented|other|sold|agent|cold|already found|not looking)' or (c.outcome is null and coalesce(c.note, '') = ''))`;

// The time window for the dashboards (Dubai time): today, this week, this month, last month, or any from/to dates.
// end is exclusive. workdays = Mon-Fri in the window up to today, for the call target.
async function periodRange(q) {
  const p = ['today', 'week', 'month', 'lastmonth', 'custom'].includes(q.get('period')) ? q.get('period') : 'today';
  const okDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || '') && !isNaN(Date.parse(v));
  let from = q.get('from'), to = q.get('to');
  if (p === 'custom' && !(okDate(from) && okDate(to))) { from = null; to = null; }
  if (from && to && from > to) [from, to] = [to, from];
  const [b] = await sql`with t as (select (now() at time zone 'Asia/Dubai')::date as today),
    w as (select case ${p}
        when 'today' then t.today
        when 'week' then date_trunc('week', t.today)::date
        when 'month' then date_trunc('month', t.today)::date
        when 'lastmonth' then (date_trunc('month', t.today) - interval '1 month')::date
        else coalesce(${from}::date, t.today) end as d0,
      case ${p}
        when 'today' then t.today + 1
        when 'week' then (date_trunc('week', t.today) + interval '7 days')::date
        when 'month' then (date_trunc('month', t.today) + interval '1 month')::date
        when 'lastmonth' then date_trunc('month', t.today)::date
        else coalesce(${to}::date, t.today) + 1 end as d1, t.today from t)
    select d0, d1, d1 - 1 as dto, (d0::timestamp at time zone 'Asia/Dubai') as start, (d1::timestamp at time zone 'Asia/Dubai') as "end",
      (select count(*)::int from generate_series(d0, least(d1 - 1, today), interval '1 day') g(d) where extract(isodow from g.d) < 6) as workdays
    from w`;
  const days = Math.round((new Date(b.d1) - new Date(b.d0)) / 86400000);
  return { period: p, start: b.start, end: b.end, from: String(b.d0).slice(0, 10), to: String(b.dto).slice(0, 10), workdays: Math.max(1, b.workdays), byHour: days <= 1 };
}

const actions = {
  // Who am I, today's limits, and the building list for the filters
  async me(req, res, s) {
    // The area / sub-community / building lists only change when new data is loaded, and building them reads the
    // whole owner list, so each set is built once and kept for 30 minutes. Screens asking at the same moment share it.
    const key = [...s.listAreas].sort((a, b) => a - b).join(',') + '|' + [...(s.locked || [])].sort((a, b) => a - b).join(',');
    let p = places.get(key);
    if (!p || p.at < Date.now() - 30 * 60e3) {
      // Read from the buildings list (a few thousand rows), not the whole owner list: fast even when the database is busy
      const rows = sql`select a.name as area, b.subcommunity,
                         case when exists (select 1 from desk.units u where u.building_id = b.id and u.unit_type <> 'Villa') then b.name end as building
                       from desk.buildings b join desk.areas a on a.id = b.area_id
                       where b.area_id = any(${s.listAreas}) and ${notLocked(s, sql`b.id`)} and exists (select 1 from desk.units u where u.building_id = b.id)`
        .then((r) => {
          const seen = new Set(); const out = [];
          for (const x of r) { const k = `${x.area}|${x.subcommunity}|${x.building}`; if (!seen.has(k)) { seen.add(k); out.push({ area: x.area, sc: x.subcommunity, bld: x.building }); } }
          const up = (v) => String(v ?? '').toUpperCase();
          return out.sort((a, b) => a.area.localeCompare(b.area) || up(a.sc).localeCompare(up(b.sc)) || up(a.bld).localeCompare(up(b.bld)));
        })
        .catch((e) => { places.delete(key); throw e; });
      p = { at: Date.now(), rows };
      places.set(key, p);
    }
    // Nothing here may hold up the page: each part gets a few seconds, and anything slower is left out this time
    // (the page asks again every minute). A busy database then means a missing number, not a stuck "Loading…".
    const soon = (promise, ms, fallback) => Promise.race([Promise.resolve(promise).catch(() => fallback), new Promise((r) => setTimeout(() => r(fallback), ms))]);
    const [placeRows, c, target, prRows, rocket] = await Promise.all([
      soon(p.rows, 4000, []),
      soon(caps(s.user_id), 3000, { profileCap: 0, callCap: 0, profiles: 0, calls: 0, copyCap: 0, copies: 0 }),
      soon(callTarget(s.user_id), 3000, null),
      soon(ensurePrefs().then(() => sql`select prefs from desk.staff_prefs where user_id = ${s.user_id}`), 3000, []),
      soon(rocketAllowed(s), 2000, false)]);
    const pr = prRows[0];
    res.json({ staff: { name: s.full_name, role: s.role, email: s.email }, caps: c, target, places: placeRows, prefs: pr?.prefs || null, rocket });
  },

  // Manager dashboard (their team) and director overview (every team)
  async dashboard(req, res, s) {
    if (s.role === 'broker') return res.status(403).json({ error: 'Only managers and directors can see the dashboard.' });
    await ensureRoles();
    const q = query(req);
    const r = await periodRange(q);
    const period = r.period;
    const all = s.role === 'admin' || s.role === 'director';
    const team = all ? (q.get('team') || '') : (s.team || '');
    const workdays = r.workdays;
    const inRange = (c) => sql`${sql(c + '.called_at')} >= ${r.start} and ${sql(c + '.called_at')} < ${r.end}`;
    await ensureTargets();
    const goal = await baseTarget();
    const HOT = DASH_HOT, COLD = DASH_COLD;
    // Brokers and managers always; admins and directors only once they've made a call in the period
    const people = sql`st.active and (st.role in ('broker', 'manager')
        or exists (select 1 from desk.calls x where x.user_id = st.user_id and ${inRange('x')}))
      and (${team === ''} or coalesce(st.team, 'No team') = ${team})`;
    const [rows, series, teams] = await Promise.all([
      sql`select st.full_name as name, coalesce(st.team, 'No team') as team, st.role,
            greatest(${goal}, coalesce((select t.target from desk.staff_targets t where t.user_id = st.user_id), 0))::int as goal,
            count(c.id)::int as calls,
            count(c.id) filter (where ${HOT})::int as hot,
            count(c.id) filter (where ${COLD})::int as cold,
            count(c.id) filter (where c.note ~* 'whatsapp sent')::int as wa,
            max(c.called_at) as last_at
          from desk.staff st left join desk.calls c on c.user_id = st.user_id and ${inRange('c')}
          where ${people} group by st.user_id, st.full_name, st.team, st.role
          order by calls desc, name`,
      sql`select ${r.byHour ? sql`extract(hour from c.called_at at time zone 'Asia/Dubai')::int` : sql`to_char(c.called_at at time zone 'Asia/Dubai', 'YYYY-MM-DD')`} as k,
            count(*)::int as n
          from desk.calls c join desk.staff st on st.user_id = c.user_id
          where ${inRange('c')} and ${people} group by 1 order by 1`,
      all ? sql`select coalesce(st.team, 'No team') as team, count(distinct st.user_id)::int as people, count(c.id)::int as calls,
                  count(c.id) filter (where ${HOT})::int as hot
                from desk.staff st left join desk.calls c on c.user_id = st.user_id and ${inRange('c')}
                where st.active and (st.role in ('broker', 'manager') or exists (select 1 from desk.calls x where x.user_id = st.user_id and ${inRange('x')}))
                group by 1 order by calls desc` : Promise.resolve([]),
    ]);
    res.json({ period, from: r.from, to: r.to, byHour: r.byHour, end: r.end, team, all, myTeam: s.team, goal, workdays, start: r.start, rows, series, teams,
      teamNames: all ? (await sql`select distinct coalesce(team, 'No team') as t from desk.staff where active and role in ('broker', 'manager') order by 1`).map((x) => x.t) : [] });
  },

  // My numbers: anyone's own calls, hot, cold and WhatsApps, and where they rank in the company.
  // Only their own figures and the call count of the person directly above them. No other names are sent.
  async myStats(req, res, s) {
    const q = query(req);
    const r = await periodRange(q);
    const period = r.period;
    const workdays = r.workdays;
    const inRange = (c) => sql`${sql(c + '.called_at')} >= ${r.start} and ${sql(c + '.called_at')} < ${r.end}`;
    const { goal, base } = await goalFor(s.user_id);
    const [board, [mine], series] = await Promise.all([
      sql`select st.user_id, count(c.id)::int as calls, count(c.id) filter (where ${DASH_HOT})::int as hot
          from desk.staff st left join desk.calls c on c.user_id = st.user_id and ${inRange('c')}
          where st.active and (st.role in ('broker', 'manager') or st.user_id = ${s.user_id}
            or exists (select 1 from desk.calls x where x.user_id = st.user_id and ${inRange('x')}))
          group by st.user_id`,
      sql`select count(c.id)::int as calls,
            count(c.id) filter (where ${DASH_HOT})::int as hot,
            count(c.id) filter (where ${DASH_COLD})::int as cold,
            count(c.id) filter (where c.note ~* 'whatsapp sent')::int as wa,
            count(distinct c.owner_id)::int as owners,
            max(c.called_at) as last_at
          from desk.calls c where c.user_id = ${s.user_id} and ${inRange('c')}`,
      sql`select ${r.byHour ? sql`extract(hour from c.called_at at time zone 'Asia/Dubai')::int` : sql`to_char(c.called_at at time zone 'Asia/Dubai', 'YYYY-MM-DD')`} as k,
            count(*)::int as n
          from desk.calls c where c.user_id = ${s.user_id} and ${inRange('c')} group by 1 order by 1`,
    ]);
    // Rank by calls, then hot leads. People level on both share a place.
    const better = (x) => x.calls > mine.calls || (x.calls === mine.calls && x.hot > mine.hot);
    const ahead = board.filter((x) => x.user_id !== s.user_id && better(x));
    const rank = ahead.length + 1;
    const level = board.filter((x) => x.user_id !== s.user_id && x.calls === mine.calls && x.hot === mine.hot).length;
    // The person directly above: the lowest score that still beats mine
    const above = ahead.sort((x, y) => x.calls - y.calls || x.hot - y.hot)[0] || null;
    const top = board.reduce((m, x) => Math.max(m, x.calls), 0);
    res.json({ period, from: r.from, to: r.to, byHour: r.byHour, end: r.end, goal, base, workdays, start: r.start, me: { ...mine, name: s.full_name }, series,
      rank, of: board.length, level, above: above ? { calls: above.calls, hot: above.hot } : null, top });
  },

  // Set your own daily call target. It can go above the company target, never below it.
  async setTarget(req, res, s, ip) {
    if (req.method !== 'POST') return res.status(405).end();
    await ensureTargets();
    const base = await baseTarget();
    const n = Math.round(Number(body(req).target));
    if (!Number.isFinite(n)) return res.status(400).json({ error: 'Enter a number.' });
    if (n < base) return res.status(400).json({ error: `Your target can't be lower than ${base}.` });
    if (n > 500) return res.status(400).json({ error: 'That target is too high. The most is 500.' });
    await sql`insert into desk.staff_targets (user_id, target) values (${s.user_id}, ${n})
              on conflict (user_id) do update set target = excluded.target, updated_at = now()`;
    await audit(s.user_id, 'target_set', { detail: { target: n }, ip });
    res.json({ ok: true, goal: n, base });
  },

  // The order this person likes their hot and cold quick notes in: { Cold: [...], Hot: [...] }
  async quickOrder(req, res, s) {
    await ensureStaffUi();
    if (req.method === 'POST') {
      const b = body(req).order || {};
      const clean = {};
      for (const g of ['Cold', 'Hot', 'Lead Cold', 'Lead Hot']) if (Array.isArray(b[g])) clean[g] = b[g].map((x) => String(x).slice(0, 60)).slice(0, 30);
      await sql`insert into desk.staff_ui (user_id, quick_order) values (${s.user_id}, ${sql.json(clean)})
                on conflict (user_id) do update set quick_order = excluded.quick_order, updated_at = now()`;
      return res.json({ ok: true, order: clean });
    }
    const [r] = await sql`select quick_order from desk.staff_ui where user_id = ${s.user_id}`;
    res.json({ order: r?.quick_order || {} });
  },

  // Save (POST) or clear (DELETE) this broker's view
  async savePrefs(req, res, s) {
    await ensurePrefs();
    if (req.method === 'DELETE') { await sql`delete from desk.staff_prefs where user_id = ${s.user_id}`; return res.json({ ok: true }); }
    if (req.method !== 'POST') return res.status(405).end();
    const p = body(req).prefs;
    if (!p || typeof p !== 'object' || Array.isArray(p) || JSON.stringify(p).length > 20000) return res.status(400).json({ error: 'Bad view' });
    await sql`insert into desk.staff_prefs (user_id, prefs) values (${s.user_id}, ${sql.json(p)})
              on conflict (user_id) do update set prefs = excluded.prefs, updated_at = now()`;
    res.json({ ok: true });
  },

  // The owner list with filters, tab counts and paging
  async units(req, res, s, ip) {
    const q = query(req);
    const tab = TABS.includes(q.get('tab')) ? q.get('tab') : 'all';
    const page = Math.max(1, Number(q.get('page')) || 1);
    await Promise.all([ensureNotes(), ensureHolds(), ensureUnitExtras(), ensureReports()]);
    const more = q.get('more') === '1';
    // only=<unit id>: refresh one row in place (after a call) without reloading the list
    const only = Number(q.get('only')) || 0;
    const rowWhere = only
      ? sql`${whereSql(new URLSearchParams(), s.listAreas, s.user_id, s.locked)} and v_unit_list.id = ${only}`
      : sql`${whereSql(q, s.listAreas, s.user_id, s.locked)} and ${tabSql(tab, s.user_id, s.role !== 'broker')}`;
    const [rows, [counts]] = await Promise.all([
      sql`select ${sql(COLS)},
            (select x.body from (
               select n.body, n.created_at as t from desk.notes n where n.unit_id = v_unit_list.id
               union all
               select c.note, coalesce(c.outcome_at, c.called_at) from desk.calls c
               where c.unit_id = v_unit_list.id and c.note is not null and c.note <> '') x
             order by x.t desc limit 1) as last_note,
            (select coalesce(json_agg(y order by y.t desc), '[]') from (
               select n.body as text, n.created_at as t, st.full_name as by
               from desk.notes n join desk.staff st on st.user_id = n.user_id where n.unit_id = v_unit_list.id
               union all
               select coalesce(nullif(c.note, ''), c.outcome), coalesce(c.outcome_at, c.called_at), st.full_name
               from desk.calls c join desk.staff st on st.user_id = c.user_id
               where c.unit_id = v_unit_list.id and (coalesce(c.note, '') <> '' or c.outcome is not null)
               order by 2 desc limit 3) y) as notes,
            ((select count(*) from desk.notes n where n.unit_id = v_unit_list.id)
             + (select count(*) from desk.calls c where c.unit_id = v_unit_list.id and (coalesce(c.note, '') <> '' or c.outcome is not null)))::int as notes_total,
            (select coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'masked', ph.masked, 'has_phone', ph.owner_id is not null,
                      'dnc', exists (select 1 from desk.do_not_call d where d.owner_id = o.id),
                      'dup', exists (select 1 from desk.unit_owners uo2 join desk.owners o2 on o2.id = uo2.owner_id join desk.owner_phones ph2 on ph2.owner_id = o2.id
                        where uo2.unit_id = uo.unit_id and uo2.role = 'owner' and ph2.phone = ph.phone and (o2.is_company, o2.id) < (o.is_company, o.id)),
                      'hold', (select json_build_object('by', st.full_name, 'until', h.until, 'why', h.why)
                               from desk.owner_hold(o.id, ${s.user_id}) h join desk.staff st on st.user_id = h.by_user))
                    order by o.is_company, o.id), '[]')
             from desk.unit_owners uo join desk.owners o on o.id = uo.owner_id
             left join desk.owner_phones ph on ph.owner_id = o.id
             where uo.unit_id = v_unit_list.id and uo.role = 'owner') as owners,
            (select a.name from desk.areas a where a.id = v_unit_list.area_id) as area,
            (select json_build_object('by', st.full_name, 'until', h.until, 'why', h.why)
               from desk.owner_hold(v_unit_list.owner_id, ${s.user_id}) h join desk.staff st on st.user_id = h.by_user) as hold
          from desk.v_unit_list where ${rowWhere}
          order by ${sortSql(q.get('sort'))} limit ${PAGE} offset ${(page - 1) * PAGE}`,
      more ? Promise.resolve([null]) : sql`select count(*)::int as all,
            count(*) filter (where ${tabSql('exp90')})::int as exp90,
            count(*) filter (where ${tabSql('up')})::int as up,
            count(*) filter (where ${tabSql('port')})::int as port,
            count(*) filter (where ${tabSql('mort')})::int as mort,
            count(*) filter (where ${tabSql('never')})::int as never,
            count(*) filter (where ${tabSql('callbacks', s.user_id, s.role !== 'broker')})::int as callbacks,
            count(*) filter (where ${tabSql('reports', s.user_id, s.role !== 'broker')})::int as reports,
            count(*) filter (where ${tabSql('monthly', s.user_id, s.role !== 'broker')})::int as monthly
          from desk.v_unit_list where ${whereSql(q, s.listAreas, s.user_id, s.locked)}`,
    ]);
    const filtered = [...q.keys()].some((k) => !['action', 'tab', 'sort', 'page', 'free', 'more', 'only'].includes(k));
    // Awaited on purpose: anything still running after the reply is sent gets frozen mid-query by Vercel and
    // leaves a database connection stuck, which then hangs other pages served by the same instance.
    if (!only && (filtered || page > 1)) await audit(s.user_id, 'searched', { detail: Object.fromEntries(q), ip }).catch(() => {});
    res.json({ rows, counts, page, pageSize: PAGE });
  },

  // One unit's full record. No daily limit; every open is still logged.
  async unit(req, res, s, ip) {
    const id = Number(query(req).get('id'));
    await Promise.all([ensureNotes(), ensureHolds(), ensureUnitExtras()]);
    // Checked against the units themselves (not the owner list), so a unit added a moment ago by Lookup opens straight away
    const inArea = sql`exists (select 1 from desk.units uu join desk.buildings bb on bb.id = uu.building_id where uu.id = ${id} and bb.area_id = any(${s.areas}) and ${notLocked(s, sql`bb.id`)})`;
    const [[u0], owners, calls, notes, [extra]] = await Promise.all([
      sql`select * from desk.v_unit_list where id = ${id} and area_id = any(${s.areas}) and ${inArea}`,
      sql`select o.id, o.name, o.is_company, uo.role, ph.masked, (ph.owner_id is not null) as has_phone,
                 (select count(*) from desk.unit_owners x where x.owner_id = o.id and x.role = 'owner')::int as units,
                 exists (select 1 from desk.do_not_call d where d.owner_id = o.id) as dnc,
                 (uo.role = 'owner' and exists (select 1 from desk.unit_owners uo2 join desk.owners o2 on o2.id = uo2.owner_id join desk.owner_phones ph2 on ph2.owner_id = o2.id
                        where uo2.unit_id = uo.unit_id and uo2.role = 'owner' and ph2.phone = ph.phone and (o2.is_company, o2.id) < (o.is_company, o.id))) as dup,
                 (select json_build_object('by', st.full_name, 'until', h.until, 'why', h.why)
                    from desk.owner_hold(o.id, ${s.user_id}) h join desk.staff st on st.user_id = h.by_user) as hold
          from desk.unit_owners uo join desk.owners o on o.id = uo.owner_id
          left join desk.owner_phones ph on ph.owner_id = o.id
          where uo.unit_id = ${id} and ${inArea} order by uo.role desc, o.is_company, o.id`,
      ensureKendal().then(() => sql`select c.called_at, c.outcome, c.note, st.full_name, k.status as kendal, k.detail as kendal_detail
          from desk.calls c join desk.staff st on st.user_id = c.user_id
          left join desk.kendal_pushes k on k.call_id = c.id
          where c.unit_id = ${id} and ${inArea} order by c.called_at desc limit 500`),
      sql`select n.id, n.body, n.created_at, st.full_name, (n.user_id = ${s.user_id}) as mine
          from desk.notes n join desk.staff st on st.user_id = n.user_id
          where n.unit_id = ${id} and ${inArea} order by n.created_at desc limit 500`,
      sql`select old_code, layout from desk.units where id = ${id}`,
    ]);
    // Not in the owner list yet (e.g. just found with Lookup): build the basics from the unit itself
    const u = u0 || (await sql`
      select u.id, b.area_id, b.subcommunity, case when u.unit_type = 'Villa' then null else b.name end as building, u.unit_no, u.unit_type,
             u.beds, u.size_sqft, coalesce(ls.status, 'Not confirmed') as lease_status, null as start_date, null as end_date, null as annual_rent,
             null as prev_rent, null as renewals, null as last_sale_price, null as matched_by, null as owner_id, null as owner_name,
             false as is_company, null as owner_masked, false as has_phone, 1 as owner_units, 0 as owners_n, false as mortgaged,
             null as last_called, null as last_outcome
      from desk.units u join desk.buildings b on b.id = u.building_id left join desk.lease_status ls on ls.unit_id = u.id
      where u.id = ${id} and b.area_id = any(${s.areas}) and ${notLocked(s, sql`b.id`)}`)[0];
    if (!u) return res.status(404).json({ error: 'That unit isn\'t in your areas.' });
    delete u.search_text;
    Object.assign(u, extra || {});
    const [, others] = await Promise.all([
      audit(s.user_id, 'opened_unit', { unitId: id, ip }),
      sql`select uo.owner_id, u.id, u.unit_no, u.unit_type, b.subcommunity, b.name as building
          from desk.unit_owners uo join desk.units u on u.id = uo.unit_id join desk.buildings b on b.id = u.building_id
          where uo.owner_id = any(${owners.map((o) => o.id)}) and uo.role = 'owner' and u.id <> ${id}
            and b.area_id = any(${s.areas}) and ${notLocked(s, sql`b.id`)} order by b.subcommunity, u.unit_no limit 60`,
    ]);
    await ensureReports();
    const [report] = await sql`select r.created_at as at, st.full_name as by from desk.report_optins r join desk.staff st on st.user_id = r.user_id where r.unit_id = ${id}`;
    res.json({ unit: u, owners, others, calls, notes, report: report || null, caps: await caps(s.user_id) });
  },

  // Monthly market report: sign the unit up, or take it off the list
  async reportOptin(req, res, s, ip) {
    if (req.method !== 'POST') return res.status(405).end();
    const unitId = Number(body(req).unitId), on = !!body(req).on;
    const [u] = await sql`select 1 from desk.mv_units where id = ${unitId} and area_id = any(${s.areas})`;
    if (!u) return res.status(403).json({ error: 'That unit isn\'t in your areas.' });
    await setReportOptin(s.user_id, unitId, on);
    await audit(s.user_id, on ? 'report_optin' : 'report_optout', { unitId, ip });
    res.json({ ok: true });
  },

  // Laptop presses Call: creates a short-lived request and alerts the broker's phone. No number returned.
  // Copy one owner's number to the clipboard (it stays hidden on screen). Same checks as a call: in your areas,
  // not do-not-call, not being worked by someone else. Every copy is logged and there's a daily limit.
  async copyNumber(req, res, s, ip) {
    if (req.method !== 'POST') return res.status(405).end();
    if (s.leadArea) await ensureLeads();
    const unitId = Number(body(req).unitId), ownerId = Number(body(req).ownerId);
    if (!Number.isInteger(unitId) || !Number.isInteger(ownerId)) return res.status(400).json({ error: 'Bad request' });
    const c = await caps(s.user_id);   // no daily limit; every copy is still logged
    const [x] = await sql`
      select ph.phone from desk.units u join desk.buildings b on b.id = u.building_id
      join desk.unit_owners uo on uo.unit_id = u.id and uo.owner_id = ${ownerId} and uo.role = 'owner'
      join desk.owner_phones ph on ph.owner_id = uo.owner_id
      where u.id = ${unitId} and b.area_id = any(${s.areas}) and ${notLocked(s, sql`b.id`)} and ${leadCheck(s)}`;
    if (!x) return res.status(403).json({ error: 'This owner isn\'t in your areas or has no mobile.' });
    const [dnc] = await sql`select 1 from desk.do_not_call where owner_id = ${ownerId}`;
    if (dnc) return res.status(403).json({ error: 'This owner asked not to be contacted.' });
    const co = await sql`select owner_id from desk.unit_owners where unit_id = ${unitId} and role = 'owner'`;
    let hold = null;
    for (const o of co) { hold = await holdFor(o.owner_id, s.user_id); if (hold) break; }
    if (hold && s.role === 'broker') {
      await audit(s.user_id, 'copy_number_blocked', { unitId, detail: { owner_id: ownerId, held_by: hold.by_name }, ip });
      return res.status(409).json({ error: `${hold.by_name} is working this owner (${hold.why}).` });
    }
    await audit(s.user_id, 'number_copied', { unitId, detail: { owner_id: ownerId }, ip });
    res.json({ phone: '+' + String(x.phone).replace(/\D/g, ''), copies: c.copies + 1 });
  },

  async call(req, res, s, ip) {
    if (req.method !== 'POST') return res.status(405).end();
    if (s.leadArea) await ensureLeads();
    const unitId = Number(body(req).unitId), ownerId = Number(body(req).ownerId);
    if (!Number.isInteger(unitId) || !Number.isInteger(ownerId)) return res.status(400).json({ error: 'Bad request' });
    // No calling hours and no daily call limit: brokers can call any time, as much as they like
    const [x] = await sql`
      select o.name as owner_name, u.unit_no, u.unit_type, b.subcommunity, b.name as building, b.area_id
      from desk.units u join desk.buildings b on b.id = u.building_id
      join desk.unit_owners uo on uo.unit_id = u.id and uo.owner_id = ${ownerId} and uo.role = 'owner'
      join desk.owners o on o.id = uo.owner_id
      join desk.owner_phones ph on ph.owner_id = uo.owner_id
      where u.id = ${unitId} and b.area_id = any(${s.areas}) and ${notLocked(s, sql`b.id`)} and ${leadCheck(s)}`;
    if (!x) return res.status(403).json({ error: 'This owner isn\'t in your areas or has no mobile.' });
    const [dnc] = await sql`select 1 from desk.do_not_call where owner_id = ${ownerId}`;
    if (dnc) return res.status(403).json({ error: 'This owner asked not to be called.' });
    // Co-owners count together: if someone else is working any owner of this unit, it's held for everyone else
    const co = await sql`select owner_id from desk.unit_owners where unit_id = ${unitId} and role = 'owner'`;
    let hold = await holdFor(ownerId, s.user_id);
    for (const o of co) { if (hold) break; if (o.owner_id !== ownerId) hold = await holdFor(o.owner_id, s.user_id); }
    if (hold && !(body(req).force && s.role !== 'broker')) {
      await audit(s.user_id, 'call_blocked_hold', { unitId, detail: { owner_id: ownerId, held_by: hold.by_name, why: hold.why }, ip });
      const when = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(hold.until));
      return res.status(409).json({ error: hold.why === 'Calling now'
        ? `${hold.by_name} is calling this owner right now.`
        : `${hold.by_name} is working this owner (${hold.why}). Free to call from ${when}.`, hold });
    }
    if (hold) await audit(s.user_id, 'call_hold_override', { unitId, detail: { owner_id: ownerId, held_by: hold.by_name }, ip });

    const minutes = Number(await setting('call_token_minutes', 5));
    const hash = crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex');
    const [r] = await sql`
      insert into desk.call_requests (user_id, unit_id, owner_id, token_hash, expires_at, request_ip)
      values (${s.user_id}, ${unitId}, ${ownerId}, ${hash}, now() + make_interval(mins => ${minutes}), ${ip || null})
      returning id`;
    await audit(s.user_id, 'call_sent', { unitId, detail: { owner_id: ownerId, request_id: r.id }, ip });

    const parts = x.owner_name.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()).split(' ');
    const shortName = parts.length > 2 ? `${parts[0]} ${parts[parts.length - 1]}` : parts.join(' ');
    const lead = s.leadArea && Number(x.area_id) === s.leadArea;
    if (lead && x.owner_name === 'No name given') parts.splice(0, parts.length, 'lead');
    const place = lead ? `Lead · ${x.building}`
      : x.unit_type === 'Villa' ? (/^Street /.test(x.unit_no) ? `${x.subcommunity} ${x.unit_no}` : `${x.subcommunity} villa ${x.unit_no}`) : `${x.building} ${x.unit_no}`;
    let phones = 0;
    try { phones = await pushToUser(s.user_id, { title: `Call ${shortName}`, body: `${place} · tap to call`, url: '/phone', tag: 'call' }); } catch { phones = 0; }
    res.json({ requestId: Number(r.id), phones, minutes });
  },

  // A note on a unit, written any time (not only after a call). Notes stay on the record; they can't be deleted.
  async addNote(req, res, s, ip) {
    if (req.method !== 'POST') return res.status(405).end();
    if (s.leadArea) await ensureLeads();
    const b = body(req);
    const unitId = Number(b.unitId);
    const text = String(b.body || '').trim().slice(0, 2000);
    if (!Number.isInteger(unitId) || !text) return res.status(400).json({ error: 'Write a note first.' });
    await ensureNotes();
    const [ok] = await sql`select 1 from desk.units u join desk.buildings b on b.id = u.building_id
      where u.id = ${unitId} and b.area_id = any(${s.areas}) and ${notLocked(s, sql`b.id`)} and ${leadCheck(s)}`;
    if (!ok) return res.status(403).json({ error: 'That unit isn\'t in your areas.' });
    const [n] = await sql`
      insert into desk.notes (unit_id, user_id, body) values (${unitId}, ${s.user_id}, ${text})
      returning id, body, created_at, true as mine`;
    await audit(s.user_id, 'note_added', { unitId, detail: { note_id: n.id }, ip });
    res.json({ note: { ...n, full_name: s.full_name } });
  },

  // Laptop checks whether the phone tapped Call yet
  async callStatus(req, res, s) {
    const id = Number(query(req).get('id'));
    const [r] = await sql`
      select cr.used_at, (cr.expires_at < now()) as expired, c.outcome_at
      from desk.call_requests cr left join desk.calls c on c.request_id = cr.id
      where cr.id = ${id} and cr.user_id = ${s.user_id}`;
    if (!r) return res.status(404).json({ error: 'Not found' });
    res.json({ status: r.outcome_at ? 'done' : r.used_at ? 'dialled' : r.expired ? 'expired' : 'sent' });
  },

  async activity(req, res, s) {
    const all = s.role !== 'broker';
    const rows = await sql`
      select a.at, a.action, a.detail, s.full_name,
             case when u.id is null then null
                  else coalesce(case when u.unit_type = 'Villa' then b.subcommunity else b.name end, '') || ' ' || u.unit_no end as unit
      from desk.audit_log a left join desk.staff s on s.user_id = a.user_id
      left join desk.units u on u.id = a.unit_id left join desk.buildings b on b.id = u.building_id
      where ${all ? sql`true` : sql`a.user_id = ${s.user_id}`}
      order by a.at desc limit 300`;
    res.json({ rows, all });
  },

  // ── Personal WhatsApp messages: your own, or (admins and directors) anyone's ──
  async templates(req, res, s) {
    const who = String(query(req).get('user') || s.user_id);
    if (who !== s.user_id && !['admin', 'director'].includes(s.role)) return res.status(403).json({ error: 'Not allowed' });
    const [p] = await sql`select full_name from desk.staff where user_id = ${who}`;
    if (!p) return res.status(404).json({ error: 'Person not found' });
    res.json({ name: p.full_name, templates: await getTemplates(who) });
  },

  async saveTemplates(req, res, s, ip) {
    if (req.method !== 'POST') return res.status(405).end();
    const b = body(req);
    const who = String(b.user || s.user_id);
    if (who !== s.user_id && !['admin', 'director'].includes(s.role)) return res.status(403).json({ error: 'Not allowed' });
    const [p] = await sql`select 1 from desk.staff where user_id = ${who}`;
    if (!p) return res.status(404).json({ error: 'Person not found' });
    const t = await saveTemplates(who, b.templates);
    await audit(s.user_id, 'templates_saved', { detail: { user: who }, ip });
    res.json({ ok: true, templates: t });
  },

  // ── Today's actions: this person's call-backs due today or overdue (count only with ?count=1) ──
  async actions(req, res, s) {
    await ensureFollowups();
    const q = query(req);
    const endToday = sql`(date_trunc('day', now() at time zone 'Asia/Dubai') + interval '1 day') at time zone 'Asia/Dubai'`;
    if (q.get('count') === '1') {
      const [c] = await sql`select count(*)::int as n from desk.followups f where f.user_id = ${s.user_id} and f.done_at is null and f.due_at < ${endToday}
        and not exists (select 1 from desk.do_not_call d where d.owner_id = f.owner_id)`;
      return res.json({ due: c.n });
    }
    const [lt] = await sql`select to_regclass('desk.leads') is not null as ok`;
    const leadJson = lt.ok ? sql`(select json_build_object('name', l.name, 'location', l.location, 'beds', l.beds, 'budget', l.budget) from desk.leads l where l.unit_id = f.unit_id)` : sql`null`;
    const rows = await sql`
      select f.id, f.due_at, f.kind, (f.due_at < now()) as overdue, f.unit_id, f.owner_id, o.name as owner_name, ph.masked, (ph.owner_id is not null) as has_phone,
             u.unit_no, u.unit_type, b.subcommunity, b.name as building, ${leadJson} as lead,
             c.outcome as last_outcome, coalesce(nullif(c.note, ''), c.outcome) as last_note, c.called_at as last_called,
             (select json_build_object('by', st.full_name, 'until', h.until, 'why', h.why)
                from desk.owner_hold(f.owner_id, ${s.user_id}) h join desk.staff st on st.user_id = h.by_user) as hold
      from desk.followups f
      join desk.owners o on o.id = f.owner_id
      left join desk.owner_phones ph on ph.owner_id = f.owner_id
      join desk.units u on u.id = f.unit_id join desk.buildings b on b.id = u.building_id
      left join desk.calls c on c.id = f.call_id
      where f.user_id = ${s.user_id} and f.done_at is null and f.due_at < ${endToday}
        and not exists (select 1 from desk.do_not_call d where d.owner_id = f.owner_id)
      order by f.due_at limit 300`;
    const [up] = await sql`select count(*)::int as n from desk.followups f where f.user_id = ${s.user_id} and f.done_at is null
      and f.due_at >= ${endToday} and f.due_at < ${endToday} + interval '7 days'`;
    res.json({ rows, comingWeek: up.n });
  },

  // Tick a call-back off without calling (e.g. sorted on WhatsApp), or move it to another day
  async followupDone(req, res, s) {
    if (req.method !== 'POST') return res.status(405).end();
    await ensureFollowups();
    const b = body(req);
    const id = Number(b.id);
    if (b.moveTo) {
      const at = new Date(b.moveTo);
      if (isNaN(at)) return res.status(400).json({ error: 'Pick a date and time.' });
      await sql`update desk.followups set due_at = ${at}, kind = 'custom' where id = ${id} and user_id = ${s.user_id}`;
    } else {
      await sql`update desk.followups set done_at = now() where id = ${id} and user_id = ${s.user_id}`;
    }
    res.json({ ok: true });
  },

  // ── Lead pool: this person's own leads (managers and up can look at anyone's, or everyone's) ──
  async leads(req, res, s) {
    const q = query(req);
    if (!s.leadArea) return res.json({ ready: false, rows: [], counts: {}, locations: [] });
    await Promise.all([ensureLeads(), ensureNotes(), ensureHolds()]);
    const boss = s.role !== 'broker';
    const who = boss ? (q.get('who') || 'me') : 'me';
    const tab = LEAD_TABS.includes(q.get('tab')) ? q.get('tab') : 'todo';
    const page = Math.max(1, Number(q.get('page')) || 1);
    const locs = (q.get('loc') || '').split('|').map((x) => x.trim()).filter(Boolean).slice(0, 40);
    const text = String(q.get('q') || '').trim().toLowerCase().slice(0, 60);
    const whose = who === 'all' ? sql`l.assigned_to is not null`
      : who === 'me' ? sql`l.assigned_to = ${s.user_id}`
      : /^[0-9a-f-]{36}$/.test(who) ? sql`l.assigned_to = ${who}` : sql`false`;
    const base = sql`${whose}
      ${locs.length ? sql`and l.location = any(${locs})` : sql``}
      ${text ? sql`and lower(concat_ws(' ', l.name, l.location, l.beds, l.budget)) like ${'%' + text + '%'}` : sql``}`;
    // The latest call on each lead, worked out once
    const last = sql`(select c.called_at, c.outcome, c.note from desk.calls c where c.owner_id = l.owner_id order by c.called_at desc limit 1)`;
    const tabSqlL = (t) => (t === 'todo' ? sql`lc.called_at is null`
      : t === 'retry' ? sql`(lc.outcome = 'No answer' or lc.note ~* ${LEAD_RETRY})`
      : t === 'hot' ? sql`(lc.outcome = 'Call back' or lc.note ~* ${LEAD_HOT})`
      : t === 'called' ? sql`lc.called_at is not null` : sql`true`);
    const sort = q.get('sort');
    const order = sort === 'budget_hi' ? sql`l.budget_num desc nulls last, l.unit_id`
      : sort === 'budget_lo' ? sql`l.budget_num asc nulls last, l.unit_id`
      : sort === 'recent' ? sql`lc.called_at desc nulls last, l.unit_id`
      // Default: shuffled, but the same shuffle every time for this person, so the list doesn't jump about
      : sql`md5(l.unit_id::text || ${s.user_id}::text)`;
    const [rows, [counts], locations] = await Promise.all([
      sql`select l.unit_id as id, l.owner_id, l.name, l.location, l.beds, l.budget, l.budget_num, (l.assigned_to = ${s.user_id}) as mine,
            st.full_name as assigned_name, ph.masked, (ph.owner_id is not null) as has_phone,
            exists (select 1 from desk.do_not_call d where d.owner_id = l.owner_id) as dnc,
            lc.called_at as last_called, lc.outcome as last_outcome,
            (select coalesce(json_agg(y order by y.t desc), '[]') from (
               select n.body as text, n.created_at as t, sx.full_name as by
               from desk.notes n join desk.staff sx on sx.user_id = n.user_id where n.unit_id = l.unit_id
               union all
               select coalesce(nullif(c.note, ''), c.outcome), coalesce(c.outcome_at, c.called_at), sx.full_name
               from desk.calls c join desk.staff sx on sx.user_id = c.user_id
               where c.owner_id = l.owner_id and (coalesce(c.note, '') <> '' or c.outcome is not null)
               order by 2 desc limit 3) y) as notes,
            ((select count(*) from desk.notes n where n.unit_id = l.unit_id)
             + (select count(*) from desk.calls c where c.owner_id = l.owner_id and (coalesce(c.note, '') <> '' or c.outcome is not null)))::int as notes_total,
            (select json_build_object('by', sx.full_name, 'until', h.until, 'why', h.why)
               from desk.owner_hold(l.owner_id, ${s.user_id}) h join desk.staff sx on sx.user_id = h.by_user) as hold
          from desk.leads l
          left join desk.owner_phones ph on ph.owner_id = l.owner_id
          left join desk.staff st on st.user_id = l.assigned_to
          left join lateral ${last} lc on true
          where ${base} and ${tabSqlL(tab)}
          order by ${order} limit ${PAGE} offset ${(page - 1) * PAGE}`,
      sql`select count(*) filter (where ${tabSqlL('todo')})::int as todo, count(*) filter (where ${tabSqlL('retry')})::int as retry,
                 count(*) filter (where ${tabSqlL('hot')})::int as hot, count(*) filter (where ${tabSqlL('called')})::int as called,
                 count(*)::int as all
          from desk.leads l left join lateral ${last} lc on true where ${base}`,
      sql`select l.location as name, count(*)::int as n from desk.leads l where ${whose} group by 1 order by 2 desc, 1`,
    ]);
    // Managers and up: who has leads, for the "whose leads" picker, and how the split stands
    const people = boss ? await sql`
      select st.user_id, st.full_name as name, count(*)::int as leads,
             count(*) filter (where exists (select 1 from desk.calls c where c.owner_id = l.owner_id))::int as called
      from desk.leads l join desk.staff st on st.user_id = l.assigned_to group by 1, 2 order by 2` : [];
    res.json({ ready: true, rows, counts, locations, page, pageSize: PAGE, people, me: s.user_id, canSplit: ['admin', 'director'].includes(s.role) });
  },

  // Share the leads nobody has called yet evenly, at random, between everyone active (brokers and managers).
  // Leads someone has already called stay with them.
  async leadsSplit(req, res, s, ip) {
    if (req.method !== 'POST') return res.status(405).end();
    if (!['admin', 'director'].includes(s.role)) return res.status(403).json({ error: 'Only admins and directors can re-split the lead pool.' });
    await ensureLeads();
    const r = await sql`
      with people as (
        select user_id, row_number() over (order by random()) - 1 as i, count(*) over () as n
        from desk.staff where active and role in ('broker', 'manager')),
      deal as (
        select l.unit_id, row_number() over (order by random()) - 1 as k from desk.leads l
        where not exists (select 1 from desk.calls c where c.owner_id = l.owner_id))
      update desk.leads l set assigned_to = p.user_id, assigned_at = now()
      from deal d join people p on p.i = d.k % p.n
      where l.unit_id = d.unit_id returning l.assigned_to`;
    const people = new Set(r.map((x) => x.assigned_to)).size;
    await audit(s.user_id, 'leads_split', { detail: { leads: r.length, people }, ip });
    res.json({ ok: true, leads: r.length, people });
  },

  // ── Call out mode ──
  async callout(req, res, s) {
    res.json(await currentCallout(s));
  },

  async calloutStart(req, res, s, ip) {
    if (req.method !== 'POST') return res.status(405).end();
    if (s.role === 'broker') return res.status(403).json({ error: 'Only managers and directors can start a call out.' });
    await ensureCallouts();
    const b = body(req);
    const minutes = Math.min(180, Math.max(5, Math.round(Number(b.minutes) || 30)));
    // A manager's call out is for their own team; directors and admins choose
    let teams = (Array.isArray(b.teams) ? b.teams : []).map((t) => String(t).slice(0, 60)).filter(Boolean);
    if (s.role === 'manager') teams = [s.team || 'No team'];
    const target = Math.min(500, Math.max(0, Math.round(Number(b.target) || 0)));
    const prize = String(b.prize || '').trim().slice(0, 80) || null;
    const mode = ['calls', 'hot', 'points'].includes(b.mode) ? b.mode : 'calls';
    // Test mode: only you see it, numbers are made up, and it never touches a real call out
    const test = b.test === true;
    if (test && !testsOn()) return res.status(503).json({ error: 'Test mode isn\'t ready yet. Try again in a minute.' });
    const [co] = await sql.begin(async (tx) => {
      if (test) await tx`update desk.callouts co set ended_at = now() where ended_at is null and ends_at > now() and ${isTest()} and started_by = ${s.user_id}`;
      else await tx`update desk.callouts co set ended_at = now() where ended_at is null and ends_at > now() and not ${isTest()}`;
      const [row] = await tx`insert into desk.callouts (started_by, starts_at, ends_at, minutes, teams, target, prize, mode)
             values (${s.user_id}, now() + interval '10 seconds', now() + interval '10 seconds' + make_interval(mins => ${minutes}),
                     ${minutes}, ${teams.length ? teams : null}, ${target}, ${prize}, ${mode}) returning id`;
      if (test) await tx`insert into desk.callout_tests (callout_id) values (${row.id})`;
      return [row];
    });
    await audit(s.user_id, 'callout_started', { detail: { id: co.id, minutes, teams, target, mode, test }, ip });
    res.json({ ok: true, id: co.id });
  },

  async calloutEnd(req, res, s, ip) {
    if (req.method !== 'POST') return res.status(405).end();
    if (s.role === 'broker') return res.status(403).json({ error: 'Only managers and directors can end a call out.' });
    await ensureCallouts();
    const id = await runningCalloutId(s);
    const r = id ? await sql`update desk.callouts set ended_at = now() where id = ${id} returning id` : [];
    if (r.length) await audit(s.user_id, 'callout_ended', { detail: { id: r[0].id }, ip });
    res.json({ ok: true });
  },

  async calloutExtend(req, res, s) {
    if (req.method !== 'POST') return res.status(405).end();
    if (s.role === 'broker') return res.status(403).json({ error: 'Only managers and directors can change a call out.' });
    await ensureCallouts();
    const id = await runningCalloutId(s);
    if (id) await sql`update desk.callouts set ends_at = ends_at + interval '10 minutes', minutes = minutes + 10 where id = ${id}`;
    res.json({ ok: true });
  },

  async calloutTeams(req, res, s) {
    if (s.role === 'broker') return res.status(403).json({ error: 'Not allowed' });
    const rows = await sql`select coalesce(team, 'No team') as team, count(*)::int as people from desk.staff
                           where active and role in ('broker', 'manager') group by 1 order by 1`;
    res.json({ teams: rows, myTeam: s.team, role: s.role });
  },

  // ── Team: who can use the desk (admins and directors) ──
  async team(req, res, s) {
    if (!['admin', 'director'].includes(s.role)) return res.status(403).json({ error: 'Only admins and directors can manage the team.' });
    await ensureInvites();
    const [people, invites, areas] = await Promise.all([
      sql`select s.user_id, s.full_name, s.email, s.role, s.team, s.active, s.created_at,
            coalesce((select array_agg(sa.area_id order by sa.area_id) from desk.staff_areas sa where sa.user_id = s.user_id and sa.kind = 'core'), '{}') as areas,
            (select max(a.at) from desk.audit_log a where a.user_id = s.user_id) as last_seen
          from desk.staff s order by s.active desc, s.full_name`,
      sql`select email, full_name, role, team, areas, created_at from desk.staff_invites where claimed_at is null order by created_at desc`,
      sql`select id, name from desk.areas where name <> 'Lookups' order by name`,
    ]);
    res.json({ people, invites, areas, me: s.user_id });
  },

  async invite(req, res, s, ip) {
    if (req.method !== 'POST') return res.status(405).end();
    if (!['admin', 'director'].includes(s.role)) return res.status(403).json({ error: 'Only admins and directors can add people.' });
    await ensureInvites();
    const b = body(req);
    const email = cleanEmail(b.email);
    const name = String(b.full_name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const role = ROLES.includes(b.role) ? b.role : 'broker';
    if (role === 'admin' && s.role !== 'admin') return res.status(403).json({ error: 'Only admins can add another admin.' });
    const team = String(b.team || '').trim().slice(0, 60) || null;
    const areas = (Array.isArray(b.areas) ? b.areas : []).map(Number).filter(Number.isFinite);
    if (!name) return res.status(400).json({ error: 'Add their name.' });
    if (!validEmail(email)) return res.status(400).json({ error: 'That email doesn\'t look right.' });
    const [has] = await sql`select 1 from desk.staff where lower(email) = ${email}`;
    if (has) return res.status(409).json({ error: 'That person is already on the desk. Edit them in the list instead.' });
    await sql`insert into desk.staff_invites (email, full_name, role, team, areas, created_by)
              values (${email}, ${name}, ${role}, ${team}, ${areas}::bigint[], ${s.user_id})
              on conflict (email) do update set full_name = excluded.full_name, role = excluded.role, team = excluded.team,
                areas = excluded.areas, created_by = excluded.created_by, created_at = now(), claimed_at = null, user_id = null`;
    await audit(s.user_id, 'person_added', { detail: { email, role, team }, ip });
    res.json({ ok: true });
  },

  async cancelInvite(req, res, s) {
    if (req.method !== 'POST') return res.status(405).end();
    if (!['admin', 'director'].includes(s.role)) return res.status(403).json({ error: 'Not allowed' });
    await ensureInvites();
    await sql`delete from desk.staff_invites where email = ${cleanEmail(body(req).email)} and claimed_at is null`;
    res.json({ ok: true });
  },

  async saveStaff(req, res, s, ip) {
    if (req.method !== 'POST') return res.status(405).end();
    if (!['admin', 'director'].includes(s.role)) return res.status(403).json({ error: 'Only admins and directors can change people.' });
    await ensureInvites();
    const b = body(req);
    const [p] = await sql`select user_id, role from desk.staff where user_id = ${String(b.user_id || '')}`;
    if (!p) return res.status(404).json({ error: 'Person not found' });
    const role = ROLES.includes(b.role) ? b.role : p.role;
    if ((role === 'admin' || p.role === 'admin') && s.role !== 'admin') return res.status(403).json({ error: 'Only admins can change an admin.' });
    if (p.user_id === s.user_id && (role !== p.role || b.active === false)) return res.status(400).json({ error: 'You can\'t change your own role or switch yourself off.' });
    const name = String(b.full_name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const team = String(b.team || '').trim().slice(0, 60) || null;
    const areas = (Array.isArray(b.areas) ? b.areas : []).map(Number).filter(Number.isFinite);
    await sql.begin(async (tx) => {
      await tx`update desk.staff set role = ${role}, team = ${team}, active = ${b.active !== false}
               ${name ? tx`, full_name = ${name}` : tx``} where user_id = ${p.user_id}`;
      await setAreas(tx, p.user_id, areas, s.user_id);
    });
    await audit(s.user_id, 'person_changed', { detail: { user: p.user_id, role, team, active: b.active !== false }, ip });
    res.json({ ok: true });
  },

  async copyBlocked(req, res, s, ip) {
    await audit(s.user_id, 'copy_blocked', { ip });
    res.json({ ok: true });
  },
};

export default route(async (req, res, s, ip) => {
  const fn = actions[query(req).get('action')];
  if (!fn) return res.status(404).json({ error: 'Unknown action' });
  await fn(req, res, s, ip);
});
