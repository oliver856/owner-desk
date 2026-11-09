// Recruitment actions: /api/recruit?action=...
// One recruiter's pipeline of brokers. Only people in desk.rc_access (and admins) get anything back;
// everyone else gets "not allowed", so brokers can't find it even if they guess the address.
import { sql, route, query, body, audit, recruitAllowed } from './_lib/core.js';

export const STAGES = ['To contact', 'Contacted', 'Interested', 'Interview booked', 'Offered', 'Placed', 'Not interested', 'Rejected'];
const FOCUS = ['Sales', 'Leasing', 'Sales & leasing', 'Off-plan'];
const SOURCES = ['Cold outreach', 'LinkedIn', 'Referral', 'Applied', 'Other'];
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

const CARD = sql`c.id, c.name, c.phone, c.email, c.brokerage, c.area, c.focus, c.source, c.linkedin, c.stage, c.temp,
  c.follow_up_at, c.interview_at, c.last_contact_at, c.created_at, c.updated_at,
  (select body from desk.rc_notes n where n.candidate_id = c.id and n.kind <> 'stage' order by n.id desc limit 1) as last_note`;

const actions = {
  // Everything for the board/list in one go, with the filters applied on the server
  async list(req, res) {
    const q = query(req);
    const w = [sql`not c.archived`];
    const term = txt(q.get('q'), 80);
    if (term) w.push(sql`(c.name ilike ${'%' + term + '%'} or c.brokerage ilike ${'%' + term + '%'} or c.area ilike ${'%' + term + '%'}
      or c.email ilike ${'%' + term + '%'} or regexp_replace(coalesce(c.phone, ''), '\\D', '', 'g') like ${'%' + term.replace(/\D/g, '') + '%'} and ${/\d{3,}/.test(term)})`);
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
    const [rows, facets, counts, [d]] = await Promise.all([
      sql`select ${CARD} from desk.rc_candidates c where ${where}
          order by c.follow_up_at asc nulls last, c.updated_at desc limit 1500`,
      sql`select 'brokerage' as k, brokerage as v, count(*)::int as n from desk.rc_candidates where not archived and brokerage is not null group by 2
          union all select 'area', area, count(*)::int from desk.rc_candidates where not archived and area is not null group by 2
          order by 1, 3 desc`,
      sql`select stage, count(*)::int as n from desk.rc_candidates where not archived group by 1`,
      sql`select count(*) filter (where follow_up_at < ${endToday})::int as due,
                 count(*) filter (where follow_up_at < date_trunc('day', now() at time zone ${DUBAI}) at time zone ${DUBAI})::int as overdue,
                 count(*)::int as total
          from desk.rc_candidates where not archived`,
    ]);
    const areas = await sql`select name from desk.areas where name not in ('Lookups', 'Lead pool') order by name`.catch(() => []);
    res.json({
      rows, counts: Object.fromEntries(counts.map((r) => [r.stage, r.n])), due: d.due, overdue: d.overdue, total: d.total,
      brokerages: facets.filter((f) => f.k === 'brokerage').map((f) => f.v),
      areas: [...new Set([...facets.filter((f) => f.k === 'area').map((f) => f.v), ...areas.map((a) => a.name)])],
      stages: STAGES, focus: FOCUS, sources: SOURCES,
    });
  },

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
      name, phone: txt(b.phone, 40), email: txt(b.email, 160), brokerage: txt(b.brokerage, 120), area: txt(b.area, 120),
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
      return res.json({ ok: true, id });
    }
    // Same phone or email already in the pipeline: say so rather than add a duplicate
    const digits = (f.phone || '').replace(/\D/g, '');
    if (!b.force && (digits.length >= 7 || f.email)) {
      const [dupe] = await sql`select id, name, stage from desk.rc_candidates where not archived and (
        (${digits.length >= 7} and right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 9) = right(${digits}, 9))
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
    const stage = pick(b.stage, STAGES);
    const temp = b.temp === '' ? null : pick(b.temp, TEMPS);
    const follow = followFrom(b.followUp);
    const interview = b.interview_at !== undefined ? when(b.interview_at) : undefined;
    await sql.begin(async (tx) => {
      if (note) await tx`insert into desk.rc_notes (candidate_id, user_id, kind, body) values (${id}, ${s.user_id}, ${isCall ? 'call' : 'note'}, ${note})`;
      if (stage && stage !== old.stage) await tx`insert into desk.rc_notes (candidate_id, user_id, kind, body) values (${id}, ${s.user_id}, 'stage', ${old.stage + ' → ' + stage})`;
      await tx`update desk.rc_candidates set updated_at = now()
        ${stage ? tx`, stage = ${stage}` : tx``}
        ${b.temp !== undefined ? tx`, temp = ${temp}` : tx``}
        ${follow !== undefined ? tx`, follow_up_at = ${follow}` : tx``}
        ${interview !== undefined ? tx`, interview_at = ${interview}` : tx``}
        ${isCall ? tx`, last_contact_at = now()` : tx``}
        where id = ${id}`;
    });
    res.json({ ok: true });
  },

  // Remove from the pipeline (kept in the database, just hidden)
  async archive(req, res, s, ip) {
    const id = Number(body(req).id);
    await sql`update desk.rc_candidates set archived = true, updated_at = now() where id = ${id}`;
    await audit(s.user_id, 'rc_archived', { detail: { id }, ip }).catch(() => {});
    res.json({ ok: true });
  },
};

export default route(async (req, res, s, ip) => {
  if (!(await recruitAllowed(s))) return res.status(403).json({ error: 'Not allowed.' });
  const fn = actions[query(req).get('action')];
  if (!fn) return res.status(404).json({ error: 'Unknown action' });
  await fn(req, res, s, ip);
});
