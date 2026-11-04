// Read-only feed for the Kendal Ops Dashboard: calls per broker per day (Dubai time). Counts only — never names or
// numbers of owners. Protected by a shared key (EXPORT_KEY in Vercel, OWNER_DESK_KEY in the dashboard's Script
// properties) instead of a sign-in, because it's called by Google Apps Script, not a person.
// GET /api/export?from=YYYY-MM-DD&to=YYYY-MM-DD   (default: the last 14 days, at most 93 days at once)
import crypto from 'node:crypto';
import { sql, route, query } from './_lib/core.js';

const HOT = sql`(c.outcome in ('Call back', 'Wants valuation', 'Listing opportunity', 'Wants to sell') or c.note ~* '^(unit available|in discussion|replied|follow up|wants to|send report|still looking|viewing booked|send options)')`;
const COLD = sql`(c.outcome in ('No answer', 'Not interested', 'Wrong number', 'Do not call') or c.note ~* '^(called, no reply|called, unreachable|called, line busy|phone off|end user|rented|other|sold|agent|cold|already found|not looking)' or (c.outcome is null and coalesce(c.note, '') = ''))`;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function keyOk(req) {
  const want = process.env.EXPORT_KEY || '';
  const got = String(req.headers['x-export-key'] || '');
  if (want.length < 24 || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export default route(async (req, res) => {
  if (req.method && req.method !== 'GET') return res.status(405).end();
  if (!keyOk(req)) return res.status(401).json({ error: 'Wrong or missing export key' });
  const q = query(req);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());
  const to = DAY.test(q.get('to') || '') ? q.get('to') : today;
  const from = DAY.test(q.get('from') || '') ? q.get('from') : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date(Date.now() - 13 * 864e5));
  const [span] = await sql`select (${to}::date - ${from}::date) as days`;
  if (span.days < 0 || span.days > 92) return res.status(400).json({ error: 'from must be before to, and at most 93 days apart' });
  const [lt] = await sql`select to_regclass('desk.leads') is not null as ok`;
  const isLead = lt.ok ? sql`exists (select 1 from desk.leads l where l.unit_id = c.unit_id)` : sql`false`;
  const rows = await sql`
    select (c.called_at at time zone 'Asia/Dubai')::date::text as date, lower(st.email) as email, st.full_name as name,
           coalesce(st.team, 'No team') as team, st.role,
           count(*)::int as calls,
           count(*) filter (where ${HOT})::int as hot,
           count(*) filter (where ${COLD})::int as cold,
           count(*) filter (where c.note ~* 'whatsapp sent')::int as whatsapps,
           count(*) filter (where ${isLead})::int as lead_pool_calls,
           count(*) filter (where not ${isLead})::int as owner_calls,
           count(*) filter (where c.sent_to_kendal)::int as sent_to_kendal,
           count(distinct c.owner_id)::int as people_called
    from desk.calls c join desk.staff st on st.user_id = c.user_id
    where c.called_at >= (${from}::date)::timestamp at time zone 'Asia/Dubai'
      and c.called_at < ((${to}::date + 1)::timestamp at time zone 'Asia/Dubai')
    group by 1, 2, 3, 4, 5
    order by 1, 2`;
  res.json({ from, to, generatedAt: new Date().toISOString(), rows });
}, { office: false, auth: false });
