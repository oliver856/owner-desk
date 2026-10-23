// Office-only actions: /api/desk?action=...
// Every action checks the office IP and the signed-in broker before touching data.
import crypto from 'node:crypto';
import { sql, route, query, body, audit, caps, setting, withinCallHours, callTarget } from './_lib/core.js';
import { whereSql, tabSql, sortSql, TABS } from './_lib/filters.js';
import { pushToUser } from './_lib/push.js';
import { ensureHolds, holdFor } from './_lib/holds.js';

const PAGE = 100;
const COLS = ['id', 'subcommunity', 'building', 'unit_no', 'unit_type', 'beds', 'size_sqft', 'lease_status', 'end_date', 'annual_rent',
  'prev_rent', 'renewals', 'last_sale_price', 'owner_id', 'owner_name', 'owner_masked', 'has_phone', 'owner_units', 'owners_n', 'mortgaged',
  'last_called', 'last_outcome'];

const places = new Map(); // building list per area set, kept for 1 minute

// Adds the 'director' role (sees every team, like an admin, but can't change settings)
let rolesReady = null;
const ensureRoles = () => (rolesReady ??= sql`alter table desk.staff drop constraint if exists staff_role_check`
  .then(() => sql`alter table desk.staff add constraint staff_role_check check (role in ('broker', 'manager', 'director', 'admin'))`)
  .catch((e) => { rolesReady = null; throw e; }));

// Each broker's saved view (filters, tab, sort, columns, filter panel). Created by the server on first use.
let prefsReady = null;
const ensurePrefs = () => (prefsReady ??= sql`create table if not exists desk.staff_prefs (
    user_id uuid primary key references desk.staff(user_id) on delete cascade,
    prefs jsonb not null, updated_at timestamptz not null default now())`
  .then(() => sql`alter table desk.staff_prefs enable row level security`)
  .then(() => sql`revoke all on desk.staff_prefs from anon, authenticated`)
  .catch((e) => { prefsReady = null; throw e; }));

// The notes table is created by the server the first time it's needed, so no SQL has to be run by hand.
let notesReady = null;
function ensureNotes() {
  notesReady ??= (async () => {
    await sql`create table if not exists desk.notes (
      id bigint generated always as identity primary key,
      unit_id bigint not null references desk.units(id),
      user_id uuid not null references desk.staff(user_id),
      body text not null check (length(body) between 1 and 2000),
      created_at timestamptz not null default now())`;
    await sql`create index if not exists notes_unit_idx on desk.notes (unit_id, created_at desc)`;
    await sql`alter table desk.notes enable row level security`;
    await sql`revoke all on desk.notes from anon, authenticated`;
  })().catch((e) => { notesReady = null; throw e; });
  return notesReady;
}
const actions = {
  // Who am I, today's limits, and the building list for the filters
  async me(req, res, s) {
    const key = [...s.listAreas].sort((a, b) => a - b).join(',');
    let p = places.get(key);
    if (!p || p.at < Date.now() - 60e3) {
      const rows = await sql`select * from (select distinct a.name as area, m.subcommunity, m.building from desk.mv_units m
                             join desk.areas a on a.id = m.area_id where m.area_id = any(${s.listAreas})) x
                             order by area, upper(subcommunity), upper(building)`;
      p = { at: Date.now(), rows: rows.map((r) => ({ area: r.area, sc: r.subcommunity, bld: r.building })) };
      places.set(key, p);
    }
    await ensurePrefs();
    const [c, target, [pr]] = await Promise.all([caps(s.user_id), callTarget(s.user_id),
      sql`select prefs from desk.staff_prefs where user_id = ${s.user_id}`]);
    res.json({ staff: { name: s.full_name, role: s.role, email: s.email }, caps: c, target, places: p.rows, prefs: pr?.prefs || null });
  },

  // Manager dashboard (their team) and director overview (every team)
  async dashboard(req, res, s) {
    if (s.role === 'broker') return res.status(403).json({ error: 'Only managers and directors can see the dashboard.' });
    await ensureRoles();
    const q = query(req);
    const period = ['today', 'week', 'month'].includes(q.get('period')) ? q.get('period') : 'today';
    const all = s.role === 'admin' || s.role === 'director';
    const team = all ? (q.get('team') || '') : (s.team || '');
    const unit = period === 'today' ? 'day' : period;
    const [b] = await sql`select date_trunc(${unit}, now() at time zone 'Asia/Dubai') as local_start,
      date_trunc(${unit}, now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai' as start,
      (now() at time zone 'Asia/Dubai')::date as today`;
    // Working days (Mon to Fri) so far in the period, for the target
    const days = []; for (let d = new Date(b.local_start); d.toISOString().slice(0, 10) <= String(b.today).slice(0, 10); d.setDate(d.getDate() + 1)) days.push(new Date(d));
    const workdays = Math.max(1, days.filter((d) => d.getDay() !== 0 && d.getDay() !== 6).length);
    const goal = Number(await setting('daily_call_target', 50));
    const HOT = sql`(c.outcome in ('Call back', 'Wants valuation', 'Listing opportunity', 'Wants to sell') or c.note ~* '^(unit available|in discussion|replied|follow up|wants to)')`;
    const COLD = sql`(c.outcome in ('No answer', 'Not interested', 'Wrong number', 'Do not call') or c.note ~* '^(called, no reply|called, unreachable|cold)' or (c.outcome is null and coalesce(c.note, '') = ''))`;
    // Brokers and managers always; admins and directors only once they've made a call in the period
    const people = sql`st.active and (st.role in ('broker', 'manager')
        or exists (select 1 from desk.calls x where x.user_id = st.user_id and x.called_at >= ${b.start}))
      and (${team === ''} or coalesce(st.team, 'No team') = ${team})`;
    const [rows, series, teams] = await Promise.all([
      sql`select st.full_name as name, coalesce(st.team, 'No team') as team, st.role,
            count(c.id)::int as calls,
            count(c.id) filter (where ${HOT})::int as hot,
            count(c.id) filter (where ${COLD})::int as cold,
            count(c.id) filter (where c.note ~* 'whatsapp sent')::int as wa,
            max(c.called_at) as last_at
          from desk.staff st left join desk.calls c on c.user_id = st.user_id and c.called_at >= ${b.start}
          where ${people} group by st.user_id, st.full_name, st.team, st.role
          order by calls desc, name`,
      sql`select ${period === 'today' ? sql`extract(hour from c.called_at at time zone 'Asia/Dubai')::int` : sql`to_char(c.called_at at time zone 'Asia/Dubai', 'YYYY-MM-DD')`} as k,
            count(*)::int as n
          from desk.calls c join desk.staff st on st.user_id = c.user_id
          where c.called_at >= ${b.start} and ${people} group by 1 order by 1`,
      all ? sql`select coalesce(st.team, 'No team') as team, count(distinct st.user_id)::int as people, count(c.id)::int as calls,
                  count(c.id) filter (where ${HOT})::int as hot
                from desk.staff st left join desk.calls c on c.user_id = st.user_id and c.called_at >= ${b.start}
                where st.active and (st.role in ('broker', 'manager') or exists (select 1 from desk.calls x where x.user_id = st.user_id and x.called_at >= ${b.start}))
                group by 1 order by calls desc` : Promise.resolve([]),
    ]);
    res.json({ period, team, all, myTeam: s.team, goal, workdays, start: b.start, rows, series, teams,
      teamNames: all ? (await sql`select distinct coalesce(team, 'No team') as t from desk.staff where active and role in ('broker', 'manager') order by 1`).map((x) => x.t) : [] });
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
    await Promise.all([ensureNotes(), ensureHolds()]);
    const more = q.get('more') === '1';
    // only=<unit id>: refresh one row in place (after a call) without reloading the list
    const only = Number(q.get('only')) || 0;
    const rowWhere = only
      ? sql`${whereSql(new URLSearchParams(), s.listAreas, s.user_id)} and v_unit_list.id = ${only}`
      : sql`${whereSql(q, s.listAreas, s.user_id)} and ${tabSql(tab, s.user_id, s.role !== 'broker')}`;
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
            (select coalesce(json_agg(json_build_object('id', o.id, 'name', o.name, 'masked', ph.masked, 'has_phone', ph.owner_id is not null,
                      'dnc', exists (select 1 from desk.do_not_call d where d.owner_id = o.id),
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
            count(*) filter (where ${tabSql('callbacks', s.user_id, s.role !== 'broker')})::int as callbacks
          from desk.v_unit_list where ${whereSql(q, s.listAreas, s.user_id)}`,
    ]);
    const filtered = [...q.keys()].some((k) => !['action', 'tab', 'sort', 'page', 'free', 'more', 'only'].includes(k));
    if (!only && (filtered || page > 1)) audit(s.user_id, 'searched', { detail: Object.fromEntries(q), ip }).catch(() => {});
    res.json({ rows, counts, page, pageSize: PAGE });
  },

  // One unit's full record. Counts toward the daily profile limit.
  async unit(req, res, s, ip) {
    const id = Number(query(req).get('id'));
    const c = await caps(s.user_id);
    if (c.profiles >= c.profileCap) {
      await audit(s.user_id, 'limit_hit', { unitId: id, detail: { limit: 'profiles' }, ip });
      return res.status(429).json({ error: `You've opened ${c.profileCap} owner profiles today. Ask your manager if you need more.` });
    }
    await Promise.all([ensureNotes(), ensureHolds()]);
    const inArea = sql`exists (select 1 from desk.mv_units m where m.id = ${id} and m.area_id = any(${s.areas}))`;
    const [[u], owners, calls, notes] = await Promise.all([
      sql`select * from desk.v_unit_list where id = ${id} and area_id = any(${s.areas})`,
      sql`select o.id, o.name, o.is_company, uo.role, ph.masked, (ph.owner_id is not null) as has_phone,
                 (select count(*) from desk.unit_owners x where x.owner_id = o.id and x.role = 'owner')::int as units,
                 exists (select 1 from desk.do_not_call d where d.owner_id = o.id) as dnc,
                 (select json_build_object('by', st.full_name, 'until', h.until, 'why', h.why)
                    from desk.owner_hold(o.id, ${s.user_id}) h join desk.staff st on st.user_id = h.by_user) as hold
          from desk.unit_owners uo join desk.owners o on o.id = uo.owner_id
          left join desk.owner_phones ph on ph.owner_id = o.id
          where uo.unit_id = ${id} and ${inArea} order by uo.role desc, o.is_company, o.id`,
      sql`select c.called_at, c.outcome, c.note, st.full_name from desk.calls c join desk.staff st on st.user_id = c.user_id
          where c.unit_id = ${id} and ${inArea} order by c.called_at desc limit 20`,
      sql`select n.id, n.body, n.created_at, st.full_name, (n.user_id = ${s.user_id}) as mine
          from desk.notes n join desk.staff st on st.user_id = n.user_id
          where n.unit_id = ${id} and ${inArea} order by n.created_at desc limit 50`,
    ]);
    if (!u) return res.status(404).json({ error: 'That unit isn\'t in your areas.' });
    delete u.search_text;
    const [, others] = await Promise.all([
      audit(s.user_id, 'opened_unit', { unitId: id, ip }),
      sql`select uo.owner_id, u.id, u.unit_no, u.unit_type, b.subcommunity, b.name as building
          from desk.unit_owners uo join desk.units u on u.id = uo.unit_id join desk.buildings b on b.id = u.building_id
          where uo.owner_id = any(${owners.map((o) => o.id)}) and uo.role = 'owner' and u.id <> ${id}
            and b.area_id = any(${s.areas}) order by b.subcommunity, u.unit_no limit 60`,
    ]);
    res.json({ unit: u, owners, others, calls, notes, caps: await caps(s.user_id) });
  },

  // Laptop presses Call: creates a short-lived request and alerts the broker's phone. No number returned.
  async call(req, res, s, ip) {
    if (req.method !== 'POST') return res.status(405).end();
    const unitId = Number(body(req).unitId), ownerId = Number(body(req).ownerId);
    if (!Number.isInteger(unitId) || !Number.isInteger(ownerId)) return res.status(400).json({ error: 'Bad request' });
    if (!(await withinCallHours())) {
      await audit(s.user_id, 'call_blocked_hours', { unitId, ip });
      return res.status(403).json({ error: 'Calls can only be made between 9am and 6pm.' });
    }
    const c = await caps(s.user_id);
    if (c.calls >= c.callCap) {
      await audit(s.user_id, 'limit_hit', { unitId, detail: { limit: 'calls' }, ip });
      return res.status(429).json({ error: 'You have reached today\'s call limit.' });
    }
    const [x] = await sql`
      select o.name as owner_name, u.unit_no, u.unit_type, b.subcommunity, b.name as building
      from desk.units u join desk.buildings b on b.id = u.building_id
      join desk.unit_owners uo on uo.unit_id = u.id and uo.owner_id = ${ownerId} and uo.role = 'owner'
      join desk.owners o on o.id = uo.owner_id
      join desk.owner_phones ph on ph.owner_id = uo.owner_id
      where u.id = ${unitId} and b.area_id = any(${s.areas})`;
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
    const place = x.unit_type === 'Villa' ? `${x.subcommunity} villa ${x.unit_no}` : `${x.building} ${x.unit_no}`;
    let phones = 0;
    try { phones = await pushToUser(s.user_id, { title: `Call ${shortName}`, body: `${place} · tap to call`, url: '/phone', tag: 'call' }); } catch { phones = 0; }
    res.json({ requestId: Number(r.id), phones, minutes });
  },

  // A note on a unit, written any time (not only after a call). Notes stay on the record; they can't be deleted.
  async addNote(req, res, s, ip) {
    if (req.method !== 'POST') return res.status(405).end();
    const b = body(req);
    const unitId = Number(b.unitId);
    const text = String(b.body || '').trim().slice(0, 2000);
    if (!Number.isInteger(unitId) || !text) return res.status(400).json({ error: 'Write a note first.' });
    await ensureNotes();
    const [ok] = await sql`select 1 from desk.mv_units where id = ${unitId} and area_id = any(${s.areas})`;
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
