// Recruitment actions: /api/recruit?action=...
// One recruiter's pipeline of brokers. Only people in desk.rc_access (and admins) get anything back;
// everyone else gets "not allowed", so brokers can't find it even if they guess the address.
import { sql, route, query, body, audit, recruitAllowed } from './_lib/core.js';
import { pushToUser } from './_lib/push.js';

export const STAGES = ['To contact', 'Contacted', 'Interested', 'Interview booked', 'Offered', 'Placed', 'Not interested', 'Rejected'];
const FOCUS = ['Sales', 'Leasing', 'Sales & leasing', 'Off-plan'];
const SOURCES = ['Cold outreach', 'Broker database', 'LinkedIn', 'Referral', 'Applied', 'Other'];
const TEMPS = ['hot', 'warm', 'cold'];
const DUBAI = 'Asia/Dubai';

const txt = (v, max = 200) => { const t = String(v ?? '').trim().slice(0, max); return t || null; };
const pick = (v, list) => (list.includes(v) ? v : null);
const when = (v) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; };
// Follow-up choice from the screen: day, 3days, week, month, custom (with at), none (clear). Anything else: no change.
function followFrom(f) {
  if (!f || !f.kind) return undefined;
  const d = new Date();
  if (f.kind === 'none') return null;
  if (f.kind === 'day') d.setDate(d.getDate() + 1);
  else if (f.kind === '3days') d.setDate(d.getDate() + 3);
  else if (f.kind === 'week') d.setDate(d.getDate() + 7);
  else if (f.kind === 'month') d.setMonth(d.getMonth() + 1);
  else if (f.kind === 'custom') return when(f.at) || undefined;
  else return undefined;
  return d;
}

const PER = 50;      // cards per board column per load
const PAGE = 100;    // rows per list page
const facetCache = { at: 0, data: null };
export const forgetFacets = () => { facetCache.at = 0; };
// Headline numbers (whole pipeline, ignoring filters). One query: firing several at once made requests hang on the
// live database (more queries than the server's 3 connections queue up inside the pooler).
async function totals(endToday) {
  const [t] = await sql`select
      (select coalesce(json_object_agg(stage, n), '{}') from (select stage, count(*)::int as n from desk.rc_candidates
         where not archived group by 1) x) as counts,
      (select count(*) from desk.rc_candidates where not archived and follow_up_at < ${endToday})::int as due,
      (select count(*) from desk.rc_candidates where not archived
         and follow_up_at < date_trunc('day', now() at time zone ${DUBAI}) at time zone ${DUBAI})::int as overdue`;
  return { counts: t.counts, due: t.due, overdue: t.overdue, total: Object.values(t.counts).reduce((a, b) => a + b, 0) };
}

const CARD = sql`c.id, c.name, c.phone, c.phone2, c.email, c.brokerage, c.area, c.focus, c.source, c.linkedin, c.stage, c.temp,
  c.follow_up_at, c.interview_at, c.last_contact_at, c.created_at, c.updated_at,
  (select body from desk.rc_notes n where n.candidate_id = c.id and n.kind <> 'stage' order by n.id desc limit 1) as last_note`;

// Also served through /api/desk?action=rc&op=… (that server is always warm, so Recruitment opens instantly)
export const recruitActions = {
  // The board/list. The pipeline can hold 100,000+ people, so it never sends them all:
  //   board: the first PER cards of each column (plus each column's true total); col=<stage>&offset=n loads more of one column
  //   list:  view=list&offset=n, PAGE rows at a time
  // Brokerage and area lists come from op=facets (cached), not with every refresh.
  async list(req, res) {
    const q = query(req);
    const w = [sql`not c.archived`];
    const term = txt(q.get('q'), 80);
    if (term) {
      const digits = term.replace(/\D/g, '');
      w.push(digits.length >= 3
        ? sql`(c.name ilike ${'%' + term + '%'} or c.phone_digits like ${'%' + digits + '%'} or c.phone2_digits like ${'%' + digits + '%'})`
        : sql`(c.name ilike ${'%' + term + '%'} or c.brokerage ilike ${'%' + term + '%'} or c.area ilike ${'%' + term + '%'} or c.email ilike ${'%' + term + '%'})`);
    }
    for (const [key, col] of [['stage', 'stage'], ['brokerage', 'brokerage'], ['area', 'area'], ['focus', 'focus'], ['temp', 'temp'], ['source', 'source']]) {
      const vals = q.getAll(key).filter(Boolean);
      if (vals.length) w.push(sql`${sql('c.' + col)} = any(${vals})`);
    }
    const due = q.get('due');
    const endToday = sql`(date_trunc('day', now() at time zone ${DUBAI}) + interval '1 day') at time zone ${DUBAI}`;
    if (due === 'today') w.push(sql`c.follow_up_at < ${endToday}`);
    else if (due === 'week') w.push(sql`c.follow_up_at < ${endToday} + interval '6 days'`);
    else if (due === 'none') w.push(sql`c.follow_up_at is null and c.stage not in ('Placed', 'Not interested', 'Rejected')`);
    const where = w.reduce((a, b) => sql`${a} and ${b}`);
    const offset = Math.max(0, Math.min(1e6, Number(q.get('offset')) || 0));
    const order = sql`order by c.follow_up_at asc nulls last, c.updated_at desc, c.id desc`;

    // More of one board column, or the next page of the list: just the rows
    const col = pick(q.get('col'), STAGES);
    if (col) return res.json({ rows: await sql`select ${CARD} from desk.rc_candidates c where ${where} and c.stage = ${col} ${order} limit ${PER} offset ${offset}` });
    if (q.get('view') === 'list') {
      const rows = await sql`select ${CARD} from desk.rc_candidates c where ${where} ${order} limit ${PAGE} offset ${offset}`;
      if (offset) return res.json({ rows });
      const [{ n }] = await sql`select count(*)::int as n from desk.rc_candidates c where ${where}`;
      return res.json({ rows, matched: n, ...(await totals(endToday)) });
    }

    // Board: first PER of each column, one query per column, one after the other (never several at once: see note in totals)
    const rows = [];
    const colCounts = await sql`select c.stage, count(*)::int as n from desk.rc_candidates c where ${where} group by 1`;
    for (const st of STAGES) {
      if (!colCounts.some((r) => r.stage === st)) continue;
      rows.push(...await sql`select ${CARD} from desk.rc_candidates c where ${where} and c.stage = ${st} ${order} limit ${PER}`);
    }
    // The old screen (before Recruit.v4) expects the drop-down lists in here too
    const legacy = q.get('v') ? {} : await loadFacets();
    res.json({ ...legacy, rows, colCounts: Object.fromEntries(colCounts.map((r) => [r.stage, r.n])), ...(await totals(endToday)) });
  },

  // Brokerage and area names for the drop-downs (17,000+ brokerages, so fetched once and cached for 10 minutes)
  async facets(req, res) { res.json(await loadFacets()); },
};

async function loadFacets() {
    if (!facetCache.at || facetCache.at < Date.now() - 10 * 60e3) {
      const [t] = await sql`select
        (select coalesce(json_agg(v order by n desc, v), '[]') from (select brokerage as v, count(*) as n from desk.rc_candidates
           where not archived and brokerage is not null group by 1) x) as brokerages,
        (select coalesce(json_agg(v order by n desc, v), '[]') from (select area as v, count(*) as n from desk.rc_candidates
           where not archived and area is not null group by 1) x) as rc_areas,
        (select coalesce(json_agg(name order by name), '[]') from desk.areas where name not in ('Lookups', 'Lead pool')) as areas`;
      facetCache.data = { brokerages: t.brokerages, areas: [...new Set([...t.rc_areas, ...t.areas])], stages: STAGES, focus: FOCUS, sources: SOURCES };
      facetCache.at = Date.now();
    }
    return facetCache.data;
}

const moreActions = {

  // Just the number of follow-ups due today (for the badge)
  async due(req, res) {
    const [d] = await sql`select count(*)::int as n from desk.rc_candidates where not archived
      and follow_up_at < (date_trunc('day', now() at time zone ${DUBAI}) + interval '1 day') at time zone ${DUBAI}`;
    res.json({ due: d.n });
  },

  async get(req, res) {
    const id = Number(query(req).get('id'));
    const [c] = await sql`select ${CARD}, c.archived from desk.rc_candidates c where c.id = ${id}`;
    if (!c) return res.status(404).json({ error: 'Candidate not found.' });
    const notes = await sql`select n.id, n.kind, n.body, n.created_at, st.full_name as by
      from desk.rc_notes n left join desk.staff st on st.user_id = n.user_id
      where n.candidate_id = ${id} order by n.id desc limit 300`;
    res.json({ candidate: c, notes });
  },

  // Add or edit a candidate's details
  async save(req, res, s, ip) {
    const b = body(req);
    const name = txt(b.name, 120);
    if (!name) return res.status(400).json({ error: 'Add a name.' });
    const f = {
      name, phone: txt(b.phone, 40), phone2: txt(b.phone2, 40), email: txt(b.email, 160), brokerage: txt(b.brokerage, 120), area: txt(b.area, 120),
      focus: pick(b.focus, FOCUS), source: pick(b.source, SOURCES), linkedin: txt(b.linkedin, 300),
      temp: pick(b.temp, TEMPS), interview_at: when(b.interview_at),
    };
    const stage = pick(b.stage, STAGES) || 'To contact';
    if (b.id) {
      const id = Number(b.id);
      const [old] = await sql`select stage from desk.rc_candidates where id = ${id} and not archived`;
      if (!old) return res.status(404).json({ error: 'Candidate not found.' });
      await sql.begin(async (tx) => {
        await tx`update desk.rc_candidates set ${tx(f)}, stage = ${stage}, updated_at = now() where id = ${id}`;
        if (old.stage !== stage) await tx`insert into desk.rc_notes (candidate_id, user_id, kind, body) values (${id}, ${s.user_id}, 'stage', ${old.stage + ' → ' + stage})`;
      });
      forgetFacets();
      return res.json({ ok: true, id });
    }
    // Same phone or email already in the pipeline: say so rather than add a duplicate
    const digits = (f.phone || '').replace(/\D/g, '');
    if (!b.force && (digits.length >= 7 || f.email)) {
      const [dupe] = await sql`select id, name, stage from desk.rc_candidates where not archived and (
        (${digits.length >= 7} and (right(phone_digits, 9) = right(${digits}, 9) or right(phone2_digits, 9) = right(${digits}, 9)))
        or (${!!f.email} and lower(email) = lower(${f.email || ''})))`;
      if (dupe) return res.status(409).json({ error: `${dupe.name} is already in the pipeline (${dupe.stage}).`, dupe });
    }
    const follow = followFrom(b.followUp);
    const id = await sql.begin(async (tx) => {
      const [r] = await tx`insert into desk.rc_candidates ${tx({ ...f, stage, owner_id: s.user_id, follow_up_at: follow ?? null })} returning id`;
      const note = txt(b.note, 4000);
      if (note) await tx`insert into desk.rc_notes (candidate_id, user_id, kind, body) values (${r.id}, ${s.user_id}, 'note', ${note})`;
      return r.id;
    });
    forgetFacets();
    await audit(s.user_id, 'rc_added', { detail: { id }, ip }).catch(() => {});
    res.json({ ok: true, id });
  },

  // Log a call or note: optional result chip + words, and update hot/cold, stage and follow-up in one go
  async log(req, res, s) {
    const b = body(req);
    const id = Number(b.id);
    const [old] = await sql`select stage from desk.rc_candidates where id = ${id} and not archived`;
    if (!old) return res.status(404).json({ error: 'Candidate not found.' });
    const note = txt(b.note, 4000);
    const isCall = !!b.call;
    // A call logged on someone still in To contact moves them to Contacted, unless a stage was picked
    const stage = pick(b.stage, STAGES) || (isCall && old.stage === 'To contact' ? 'Contacted' : null);
    const temp = b.temp === '' ? null : pick(b.temp, TEMPS);
    const follow = followFrom(b.followUp);
    const interview = b.interview_at !== undefined ? when(b.interview_at) : undefined;
    // Details filled in during a call (only the ones sent are changed)
    const det = {};
    if (b.area !== undefined) det.area = txt(b.area, 120);
    if (b.brokerage !== undefined) det.brokerage = txt(b.brokerage, 120);
    if (b.focus !== undefined) det.focus = pick(b.focus, FOCUS);
    if (b.email !== undefined) det.email = txt(b.email, 160);
    await sql.begin(async (tx) => {
      if (note) await tx`insert into desk.rc_notes (candidate_id, user_id, kind, body) values (${id}, ${s.user_id}, ${isCall ? 'call' : 'note'}, ${note})`;
      if (stage && stage !== old.stage) await tx`insert into desk.rc_notes (candidate_id, user_id, kind, body) values (${id}, ${s.user_id}, 'stage', ${old.stage + ' → ' + stage})`;
      await tx`update desk.rc_candidates set updated_at = now()
        ${stage ? tx`, stage = ${stage}` : tx``}
        ${b.temp !== undefined ? tx`, temp = ${temp}` : tx``}
        ${follow !== undefined ? tx`, follow_up_at = ${follow}` : tx``}
        ${interview !== undefined ? tx`, interview_at = ${interview}` : tx``}
        ${isCall ? tx`, last_contact_at = now()` : tx``}
        ${Object.entries(det).reduce((acc, [k, v]) => tx`${acc}, ${tx(k)} = ${v}`, tx``)}
        where id = ${id}`;
    });
    if (det.area !== undefined || det.brokerage !== undefined) forgetFacets();
    res.json({ ok: true });
  },

  // Send this candidate to the recruiter's phone. The phone (/phone) shows them with a big Call button for 5 minutes.
  async call(req, res, s, ip) {
    if (req.method !== 'POST') return res.status(405).end();
    const b = body(req);
    const id = Number(b.id);
    const which = b.which === 'office' ? 'office' : 'main';
    const [c] = await sql`select name, brokerage, phone, phone2 from desk.rc_candidates where id = ${id} and not archived`;
    if (!c) return res.status(404).json({ error: 'Candidate not found.' });
    if (!(which === 'office' ? c.phone2 : c.phone)) return res.status(400).json({ error: 'No number saved for them. Use Edit to add one.' });
    const minutes = 5;
    await sql`update desk.rc_call_requests set expires_at = now() where user_id = ${s.user_id} and used_at is null and expires_at > now()`;
    const [r] = await sql`insert into desk.rc_call_requests (user_id, candidate_id, which, expires_at)
      values (${s.user_id}, ${id}, ${which}, now() + make_interval(mins => ${minutes})) returning id`;
    await audit(s.user_id, 'rc_call_sent', { detail: { id, request_id: r.id }, ip }).catch(() => {});
    let phones = 0;
    try { phones = await pushToUser(s.user_id, { title: `Call ${c.name}`, body: `${c.brokerage || 'Recruitment'}${which === 'office' ? ' · office line' : ''} · tap to call`, url: '/phone', tag: 'call' }); } catch { phones = 0; }
    res.json({ requestId: Number(r.id), phones, minutes });
  },

  // Laptop checks whether the phone tapped Call yet
  async callStatus(req, res, s) {
    const [r] = await sql`select used_at, expires_at < now() as expired from desk.rc_call_requests
      where id = ${Number(query(req).get('id'))} and user_id = ${s.user_id}`;
    if (!r) return res.status(404).json({ error: 'Not found' });
    res.json({ status: r.used_at ? 'dialled' : r.expired ? 'expired' : 'sent' });
  },

  // Remove from the pipeline (kept in the database, just hidden)
  async archive(req, res, s, ip) {
    const id = Number(body(req).id);
    await sql`update desk.rc_candidates set archived = true, updated_at = now() where id = ${id}`;
    await audit(s.user_id, 'rc_archived', { detail: { id }, ip }).catch(() => {});
    res.json({ ok: true });
  },
};

Object.assign(recruitActions, moreActions);

export default route(async (req, res, s, ip) => {
  if (!(await recruitAllowed(s))) return res.status(403).json({ error: 'Not allowed.' });
  const fn = recruitActions[query(req).get('action')];
  if (!fn) return res.status(404).json({ error: 'Unknown action' });
  await fn(req, res, s, ip);
}, { recruiter: true });
