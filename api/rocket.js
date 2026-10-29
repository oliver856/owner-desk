// WhatsApp rocket: send one message to a filtered list of owners from the broker's own WhatsApp, through the
// Apex WhatsApp Rocket Chrome extension. The list never reaches the screen: the extension asks for one owner at a
// time, gets that number and the filled-in message, sends it in WhatsApp Web, then reports back.
//
// Signed-in routes (the Owner Desk page): create, status, pause, resume, stop.
// Extension routes (no sign-in, but a run token that only works for that one run, for 12 hours): next, done.
// For testing it's limited to admins, or to the emails in the setting 'rocket_users' once that's set.
import crypto from 'node:crypto';
import { sql, route, query, body, audit, rocketAllowed } from './_lib/core.js';
import { whereSql, tabSql, sortSql, TABS } from './_lib/filters.js';
import { ensureReports } from './_lib/reports.js';

const DAILY_CAP = 100;   // messages per person per day
const MAX_RUN = 100;     // owners in one run

let ready = null;
export function ensureRocket() {
  ready ??= (async () => {
    const [r] = await sql`select to_regclass('desk.rocket_items') is not null as ok`;
    if (r.ok) return;
    await sql`create table if not exists desk.rocket_runs (
      id bigint generated always as identity primary key,
      user_id uuid not null references desk.staff(user_id),
      message text not null,
      gap_min int not null, gap_max int not null,
      token_hash text not null,
      status text not null default 'running' check (status in ('running', 'paused', 'stopped', 'done')),
      total int not null default 0,
      created_at timestamptz not null default now(),
      expires_at timestamptz not null)`;
    await sql`create table if not exists desk.rocket_items (
      id bigint generated always as identity primary key,
      run_id bigint not null references desk.rocket_runs(id) on delete cascade,
      pos int not null,
      unit_id bigint not null references desk.units(id),
      owner_id bigint not null references desk.owners(id),
      status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
      detail text,
      at timestamptz)`;
    await sql`create index if not exists rocket_items_run_idx on desk.rocket_items (run_id, status, pos)`;
    await sql`create index if not exists rocket_items_owner_idx on desk.rocket_items (owner_id, at desc)`;
    await sql`alter table desk.rocket_runs enable row level security`;
    await sql`alter table desk.rocket_items enable row level security`;
    await sql`revoke all on desk.rocket_runs from anon, authenticated`;
    await sql`revoke all on desk.rocket_items from anon, authenticated`;
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const titleCase = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()).trim();

// Same wording as the single WhatsApp button: "villa 12 in Maple 1", "apartment 504 in Acacia A"
function fill(t, x, me) {
  const st = /^Street (\d+), Villa (\S+)$/.exec(String(x.unit_no || ''));
  const property = x.area === 'Commercial' ? `unit ${x.unit_no} in ${titleCase(x.building || x.subcommunity)}`
    : st ? `villa ${st[2]} on Street ${st[1]} in ${titleCase(x.subcommunity)}`
    : x.unit_type === 'Villa' ? `villa ${x.unit_no} in ${titleCase(x.subcommunity)}` : `apartment ${x.unit_no} in ${titleCase(x.building)}`;
  const first = x.is_company ? '' : titleCase(String(x.owner_name || '').split(/\s+/)[0]);
  return t.split('{first}').join(first).split('{me}').join(String(me || '').split(/\s+/)[0])
    .split('{property}').join(property).split('{area}').join(x.area || '')
    .replace(/Hi ,/g, 'Hi,').replace(/Hi\s+\n/g, 'Hi,\n').trim();
}

async function sentToday(userId) {
  const [r] = await sql`
    select count(*)::int as n from desk.rocket_items i join desk.rocket_runs r on r.id = i.run_id
    where r.user_id = ${userId} and i.status = 'sent'
      and i.at >= date_trunc('day', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai'`;
  return r.n;
}

// ── Signed-in: the Owner Desk page ──────────────────────────────────────────
const deskActions = {
  // Build a run from the filters on screen: the first N owners (with a mobile, not do-not-call, one per number)
  async create(req, res, s, ip) {
    if (req.method !== 'POST') return res.status(405).end();
    const b = body(req);
    const message = String(b.message || '').trim().slice(0, 1000);
    if (message.length < 5) return res.status(400).json({ error: 'Write the message first.' });
    const limit = Math.max(1, Math.min(MAX_RUN, Math.round(Number(b.limit) || 0)));
    const gapMin = Math.max(20, Math.min(600, Math.round(Number(b.gapMin) || 30)));
    const gapMax = Math.max(gapMin, Math.min(900, Math.round(Number(b.gapMax) || 90)));
    const left = DAILY_CAP - (await sentToday(s.user_id));
    if (left <= 0) return res.status(429).json({ error: `You've sent ${DAILY_CAP} rocket messages today, the daily limit.` });
    const [busy] = await sql`select 1 from desk.rocket_runs where user_id = ${s.user_id} and status in ('running', 'paused') and expires_at > now()`;
    if (busy) return res.status(409).json({ error: 'You already have a rocket running. Stop it first.' });

    await ensureReports();
    const q = new URLSearchParams(String(b.params || ''));
    const tab = TABS.includes(q.get('tab')) ? q.get('tab') : 'all';
    const skipRecent = b.skipRecent !== false;
    // Units in the list, in the order on screen, then their owners: one message per mobile number
    const owners = await sql`
      with u as (
        select id, row_number() over (order by ${sortSql(q.get('sort'))}) as pos
        from desk.v_unit_list
        where ${whereSql(q, s.listAreas, s.user_id)} and ${tabSql(tab, s.user_id, s.role !== 'broker')}
        order by ${sortSql(q.get('sort'))} limit ${limit * 3})
      select distinct on (ph.phone) u.id as unit_id, uo.owner_id, u.pos
      from u join desk.unit_owners uo on uo.unit_id = u.id and uo.role = 'owner'
      join desk.owner_phones ph on ph.owner_id = uo.owner_id
      where not exists (select 1 from desk.do_not_call d where d.owner_id = uo.owner_id)
        and (${!skipRecent} or (
          not exists (select 1 from desk.rocket_items i where i.owner_id = uo.owner_id and i.status = 'sent' and i.at > now() - interval '30 days')
          and not exists (select 1 from desk.calls c where c.owner_id = uo.owner_id and c.note ~* 'whatsapp sent' and c.called_at > now() - interval '30 days')))
      order by ph.phone, u.pos, uo.owner_id`;
    const pick = owners.sort((a, z) => a.pos - z.pos || a.owner_id - z.owner_id).slice(0, Math.min(limit, left));
    if (!pick.length) return res.status(400).json({ error: 'Nobody in this list can be messaged (no mobile, do-not-call, or messaged in the last 30 days).' });

    const token = crypto.randomBytes(24).toString('hex');
    const run = await sql.begin(async (tx) => {
      const [r] = await tx`insert into desk.rocket_runs (user_id, message, gap_min, gap_max, token_hash, total, expires_at)
        values (${s.user_id}, ${message}, ${gapMin}, ${gapMax}, ${hash(token)}, ${pick.length}, now() + interval '12 hours') returning id`;
      await tx`insert into desk.rocket_items ${tx(pick.map((p, i) => ({ run_id: r.id, pos: i + 1, unit_id: p.unit_id, owner_id: p.owner_id })))}`;
      return r;
    });
    await audit(s.user_id, 'rocket_started', { detail: { run_id: run.id, owners: pick.length, tab, filters: Object.fromEntries(q) }, ip });
    res.json({ runId: run.id, token, total: pick.length, gapMin, gapMax, capped: pick.length < limit && left < limit });
  },

  // Progress for the screen: counts and the last few owners (names and units only, never numbers)
  async status(req, res, s) {
    const id = Number(query(req).get('id')) || 0;
    const [r] = id
      ? await sql`select * from desk.rocket_runs where id = ${id} and user_id = ${s.user_id}`
      : await sql`select * from desk.rocket_runs where user_id = ${s.user_id} order by id desc limit 1`;
    if (!r) return res.json({ run: null });
    const [c] = await sql`select count(*) filter (where status = 'sent')::int as sent, count(*) filter (where status = 'failed')::int as failed,
      count(*) filter (where status = 'skipped')::int as skipped, count(*) filter (where status in ('pending', 'sending'))::int as left
      from desk.rocket_items where run_id = ${r.id}`;
    const recent = await sql`
      select i.pos, i.status, i.detail, i.at, o.name as owner_name, o.is_company, u.unit_no, b.subcommunity, b.name as building, u.unit_type
      from desk.rocket_items i join desk.owners o on o.id = i.owner_id join desk.units u on u.id = i.unit_id join desk.buildings b on b.id = u.building_id
      where i.run_id = ${r.id} and i.status <> 'pending' order by i.at desc nulls last, i.pos desc limit 6`;
    res.json({ run: { id: r.id, status: r.expires_at < new Date() && ['running', 'paused'].includes(r.status) ? 'stopped' : r.status,
      total: r.total, gapMin: r.gap_min, gapMax: r.gap_max, createdAt: r.created_at, ...c }, recent,
      today: await sentToday(s.user_id), cap: DAILY_CAP });
  },

  async pause(req, res, s) { return setStatus(req, res, s, 'paused', ['running']); },
  async resume(req, res, s) { return setStatus(req, res, s, 'running', ['paused']); },
  async stop(req, res, s, ip) {
    const out = await setStatus(req, res, s, 'stopped', ['running', 'paused'], true);
    if (out) await audit(s.user_id, 'rocket_stopped', { detail: { run_id: out }, ip });
  },
};

async function setStatus(req, res, s, to, from, quiet) {
  if (req.method !== 'POST') { res.status(405).end(); return null; }
  const id = Number(body(req).runId);
  const [r] = await sql`update desk.rocket_runs set status = ${to} where id = ${id} and user_id = ${s.user_id} and status = any(${from}) returning id`;
  if (to === 'stopped' && r) await sql`update desk.rocket_items set status = 'skipped', detail = 'Rocket stopped', at = now() where run_id = ${id} and status = 'pending'`;
  res.json({ ok: !!r });
  return quiet ? r?.id : null;
}

// ── Extension: one owner at a time, with the run's token ───────────────────
async function runFor(req) {
  const b = req.method === 'POST' ? body(req) : Object.fromEntries(query(req));
  const id = Number(b.runId), token = String(b.token || '');
  if (!id || token.length < 20) return null;
  const [r] = await sql`select r.*, st.full_name, st.active from desk.rocket_runs r join desk.staff st on st.user_id = r.user_id
    where r.id = ${id} and r.token_hash = ${hash(token)} and r.expires_at > now()`;
  return r && r.active ? r : null;
}

const extActions = {
  // The next owner: number + filled-in message. Paused runs say wait; stopped or finished runs say done.
  async next(req, res, _s, ip) {
    const r = await runFor(req);
    if (!r) return res.status(403).json({ error: 'This rocket has ended or the link is no longer valid.', done: true });
    if (r.status === 'paused') return res.json({ wait: true });
    if (r.status !== 'running') return res.json({ done: true, status: r.status });
    // Anything left half-sent (browser closed mid-message) is marked failed so the run can carry on
    await sql`update desk.rocket_items set status = 'failed', detail = 'No answer from WhatsApp', at = now()
              where run_id = ${r.id} and status = 'sending' and at < now() - interval '3 minutes'`;
    if ((await sentToday(r.user_id)) >= DAILY_CAP) {
      await sql`update desk.rocket_runs set status = 'stopped' where id = ${r.id}`;
      await sql`update desk.rocket_items set status = 'skipped', detail = 'Daily limit reached', at = now() where run_id = ${r.id} and status = 'pending'`;
      return res.json({ done: true, status: 'limit' });
    }
    const [it] = await sql`
      update desk.rocket_items set status = 'sending', at = now()
      where id = (select id from desk.rocket_items where run_id = ${r.id} and status = 'pending' order by pos limit 1 for update skip locked)
      returning id, unit_id, owner_id, pos`;
    if (!it) {
      await sql`update desk.rocket_runs set status = 'done' where id = ${r.id} and status = 'running'`;
      return res.json({ done: true, status: 'done' });
    }
    const [x] = await sql`
      select o.name as owner_name, o.is_company, ph.phone, u.unit_no, u.unit_type, b.subcommunity, b.name as building, a.name as area,
             exists (select 1 from desk.do_not_call d where d.owner_id = o.id) as dnc
      from desk.owners o join desk.owner_phones ph on ph.owner_id = o.id, desk.units u
      join desk.buildings b on b.id = u.building_id join desk.areas a on a.id = b.area_id
      where o.id = ${it.owner_id} and u.id = ${it.unit_id}`;
    if (!x || x.dnc) {
      await sql`update desk.rocket_items set status = 'skipped', detail = ${x ? 'Do not contact' : 'No mobile'}, at = now() where id = ${it.id}`;
      return res.json({ skip: true });
    }
    await audit(r.user_id, 'rocket_number', { unitId: it.unit_id, detail: { run_id: r.id, item: it.id, owner_id: it.owner_id }, ip });
    res.json({ itemId: it.id, pos: it.pos, total: r.total, phone: String(x.phone).replace(/\D/g, ''), text: fill(r.message, x, r.full_name),
      gapMin: r.gap_min, gapMax: r.gap_max });
  },

  // What happened in WhatsApp for one owner
  async done(req, res, _s, ip) {
    if (req.method !== 'POST') return res.status(405).end();
    const r = await runFor(req);
    if (!r) return res.status(403).json({ error: 'This rocket has ended.' });
    const b = body(req);
    const ok = !!b.ok;
    const detail = ok ? null : String(b.error || 'Not sent').slice(0, 200);
    const [it] = await sql`update desk.rocket_items set status = ${ok ? 'sent' : 'failed'}, detail = ${detail}, at = now()
      where id = ${Number(b.itemId)} and run_id = ${r.id} and status = 'sending' returning unit_id, owner_id`;
    if (!it) return res.json({ ok: true });
    // On the unit's notes, so everyone can see the owner has had a WhatsApp
    await sql`insert into desk.notes (unit_id, user_id, body) values (${it.unit_id}, ${r.user_id},
      ${ok ? 'WhatsApp rocket sent' : `WhatsApp rocket not sent: ${detail}`})`;
    await audit(r.user_id, ok ? 'rocket_sent' : 'rocket_failed', { unitId: it.unit_id, detail: { run_id: r.id, owner_id: it.owner_id, error: detail }, ip });
    res.json({ ok: true });
  },
};

const signedIn = route(async (req, res, s, ip) => {
  if (!(await rocketAllowed(s))) return res.status(403).json({ error: 'WhatsApp rocket isn\'t switched on for you.' });
  await ensureRocket();
  await deskActions[query(req).get('action')](req, res, s, ip);
});
const forExtension = route(async (req, res, _s, ip) => {
  await ensureRocket();
  await extActions[query(req).get('action')](req, res, null, ip);
}, { auth: false });

export default async function handler(req, res) {
  const a = query(req).get('action');
  if (deskActions[a]) return signedIn(req, res);
  if (extActions[a]) return forExtension(req, res);
  res.status(404).json({ error: 'Unknown action' });
}
