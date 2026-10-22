// Office-only actions: /api/desk?action=...
// Every action checks the office IP and the signed-in broker before touching data.
import crypto from 'node:crypto';
import { sql, route, query, body, audit, caps, setting, withinCallHours, callTarget } from './_lib/core.js';
import { whereSql, tabSql, sortSql, TABS } from './_lib/filters.js';
import { pushToUser } from './_lib/push.js';

const PAGE = 100;
const COLS = ['id', 'subcommunity', 'building', 'unit_no', 'unit_type', 'beds', 'size_sqft', 'lease_status', 'end_date', 'annual_rent',
  'prev_rent', 'renewals', 'last_sale_price', 'owner_id', 'owner_name', 'owner_masked', 'has_phone', 'owner_units', 'owners_n', 'mortgaged',
  'last_called', 'last_outcome'];

const places = new Map(); // building list per area set, kept for an hour

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
    if (!p || p.at < Date.now() - 600e3) {
      const rows = await sql`select * from (select distinct a.name as area, m.subcommunity, m.building from desk.mv_units m
                             join desk.areas a on a.id = m.area_id where m.area_id = any(${s.listAreas})) x
                             order by area, upper(subcommunity), upper(building)`;
      p = { at: Date.now(), rows: rows.map((r) => ({ area: r.area, sc: r.subcommunity, bld: r.building })) };
      places.set(key, p);
    }
    const [c, target] = await Promise.all([caps(s.user_id), callTarget(s.user_id)]);
    res.json({ staff: { name: s.full_name, role: s.role, email: s.email }, caps: c, target, places: p.rows });
  },

  // The owner list with filters, tab counts and paging
  async units(req, res, s, ip) {
    const q = query(req);
    const tab = TABS.includes(q.get('tab')) ? q.get('tab') : 'all';
    const page = Math.max(1, Number(q.get('page')) || 1);
    await ensureNotes();
    const [rows, [counts]] = await Promise.all([
      sql`select ${sql(COLS)},
            (select n.body from desk.notes n where n.unit_id = v_unit_list.id order by n.created_at desc limit 1) as last_note,
            (select a.name from desk.areas a where a.id = v_unit_list.area_id) as area
          from desk.v_unit_list where ${whereSql(q, s.listAreas)} and ${tabSql(tab)}
          order by ${sortSql(q.get('sort'))} limit ${PAGE} offset ${(page - 1) * PAGE}`,
      sql`select count(*)::int as all,
            count(*) filter (where ${tabSql('exp90')})::int as exp90,
            count(*) filter (where ${tabSql('up')})::int as up,
            count(*) filter (where ${tabSql('port')})::int as port,
            count(*) filter (where ${tabSql('mort')})::int as mort,
            count(*) filter (where ${tabSql('never')})::int as never
          from desk.v_unit_list where ${whereSql(q, s.listAreas)}`,
    ]);
    const filtered = [...q.keys()].some((k) => !['action', 'tab', 'sort', 'page'].includes(k));
    if (filtered || page > 1) audit(s.user_id, 'searched', { detail: Object.fromEntries(q), ip }).catch(() => {});
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
    await ensureNotes();
    const inArea = sql`exists (select 1 from desk.mv_units m where m.id = ${id} and m.area_id = any(${s.areas}))`;
    const [[u], owners, calls, notes] = await Promise.all([
      sql`select * from desk.v_unit_list where id = ${id} and area_id = any(${s.areas})`,
      sql`select o.id, o.name, o.is_company, uo.role, ph.masked, (ph.owner_id is not null) as has_phone,
                 (select count(*) from desk.unit_owners x where x.owner_id = o.id and x.role = 'owner')::int as units,
                 exists (select 1 from desk.do_not_call d where d.owner_id = o.id) as dnc
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
      select cr.used_at, (cr.expires_at < now()) as expired, c.outcome
      from desk.call_requests cr left join desk.calls c on c.request_id = cr.id
      where cr.id = ${id} and cr.user_id = ${s.user_id}`;
    if (!r) return res.status(404).json({ error: 'Not found' });
    res.json({ status: r.outcome ? 'done' : r.used_at ? 'dialled' : r.expired ? 'expired' : 'sent' });
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
