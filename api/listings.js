// Listings tab: each broker's live Kendal listings checked against recent land department sales and new Ejari leases
// (database function mkt.listing_checks, migration 019), and the figures for the owner report.
//   GET /api/listings?action=list[&scope=team|all]   brokers: their own listings. Managers can ask for their team,
//                                                    admins and directors for everyone.
//   GET /api/listings?action=report&id=AHRE-1234     one listing's figures, the owner's name and the broker's details
//   POST /api/listings {action:'refresh'}            rebuilds the cache (mkt.listing_check_cache, migration 020) when the
//                                                    page finds it over 10 minutes old. Slow work goes through POST, which
//                                                    gets a longer time limit than reads.
// Read-only. The raw transactions never leave the server: only ranges, medians, counts and the dots on the report.
import { sql, route, query, body } from './_lib/core.js';

export const config = { maxDuration: 60 };
const STALE_MIN = 10;
import { scopeFor } from './_lib/ops-access.js';

// Whose listings may this person see? null = only their own.
async function emailsFor(staff, scope) {
  if (scope === 'all' && ['admin', 'director'].includes(staff.role)) return { all: true };
  if (scope === 'team' || scope === 'all') {
    const s = await scopeFor(staff, null).catch(() => null);
    if (s?.all) return { all: true };
    if (s?.team) {
      const rows = await sql`select email from ops.people where ops.team_at(email, ops.dubai_day(now())) = ${s.team}`;
      return { emails: [...new Set([String(staff.email).toLowerCase(), ...rows.map((r) => String(r.email).toLowerCase())])], team: s.team };
    }
  }
  return { emails: [String(staff.email).toLowerCase()] };
}

const canTeam = (staff) => ['admin', 'director', 'manager'].includes(staff.role);

async function list(req, res, staff) {
  const q = query(req);
  const who = await emailsFor(staff, canTeam(staff) ? q.get('scope') : null);
  const rows = who.all
    ? await sql`select * from mkt.listing_check_cache`
    : await sql`select * from mkt.listing_check_cache where lower(agent_email) = any(${who.emails})`;
  const [asOf] = await sql`select (select max(sold_on) from mkt.dld_sales) as sales_to, (select max(starts_on) from mkt.ejari_rents) as rents_to,
                                  (select min(refreshed_at) from mkt.listing_check_cache) as refreshed_at`;
  const stale = !asOf.refreshed_at || Date.now() - new Date(asOf.refreshed_at).getTime() > STALE_MIN * 60e3;
  res.json({
    scope: who.all ? 'all' : who.team ? 'team' : 'mine', team: who.team || null, canTeam: canTeam(staff), canAll: ['admin', 'director'].includes(staff.role),
    salesTo: asOf.sales_to, rentsTo: asOf.rents_to, refreshedAt: asOf.refreshed_at, stale,
    listings: rows.map((r) => ({
      id: r.listing_id, agent: r.agent_name || r.agent_email, agentEmail: r.agent_email, title: r.title,
      purpose: r.purpose, kind: r.kind, beds: r.beds, size: r.size_sqft,
      community: r.community, subCommunity: r.sub_community, building: r.building, unitNo: r.unit_no,
      listed: r.listed, target: r.target, gap: r.gap_pct == null ? null : Number(r.gap_pct), verdict: r.verdict,
      evidence: r.evidence, level: r.evidence_level, months: r.evidence_months, low: r.low, high: r.high, latest: r.latest, note: r.note,
      unitId: r.unit_id || null,
    })),
  });
}

async function report(req, res, staff) {
  const id = String(query(req).get('id') || '');
  const [k] = await sql`select listing_id, agent_email from ops.kendal_listings where listing_id = ${id} and is_live`;
  if (!k) return res.status(404).json({ error: 'That listing is no longer live in Kendal.' });
  // brokers: their own listings only. Managers: their team. Admins and directors: any.
  const who = await emailsFor(staff, canTeam(staff) ? 'all' : null);
  if (!who.all && !who.emails.includes(String(k.agent_email || '').toLowerCase())) {
    const team = canTeam(staff) ? await emailsFor(staff, 'team') : null;
    if (!team?.all && !(team?.emails || []).includes(String(k.agent_email || '').toLowerCase())) return res.status(403).json({ error: 'Not your listing.' });
  }
  const [c] = await sql`select * from mkt.listing_check_cache where listing_id = ${id}`;
  if (!c || c.target == null) return res.status(400).json({ error: 'There isn\'t enough evidence for a report on this listing yet.' });
  const u = c;
  // The broker on the report is the listing's agent (for a manager downloading a team member's report), else the person asking
  // The broker on the report is always the listing's own agent in Kendal: found on the Desk by email, then by name.
  // If they aren't on the Desk, their Kendal name and email are used (no photo).
  const brokerSql = (cond) => sql`select s.full_name, s.email, s.title, s.mobile, p.content_type as photo_type, encode(p.photo, 'base64') as photo
                                  from desk.staff s left join desk.staff_photos p on lower(p.email) = lower(s.email)
                                  where s.active and ${cond} limit 1`;
  const [ka] = await sql`select agent_name from ops.kendal_listings where listing_id = ${id}`;
  let [b] = k.agent_email ? await brokerSql(sql`lower(s.email) = lower(${k.agent_email})`) : [];
  if (!b && ka?.agent_name) [b] = await brokerSql(sql`lower(regexp_replace(s.full_name, '[^a-zA-Z]', '', 'g')) = lower(regexp_replace(${ka.agent_name}, '[^a-zA-Z]', '', 'g'))`);
  if (!b && (ka?.agent_name || k.agent_email)) b = { full_name: ka?.agent_name || '', email: k.agent_email || '', title: '', mobile: '', photo: null };
  res.json({
    id, purpose: c.purpose, kind: c.kind, beds: c.beds, size: c.size_sqft,
    building: c.building, community: c.community, subCommunity: c.sub_community,
    listed: c.listed, low: c.low, high: c.high, typical: c.typical, evidence: c.evidence, level: c.evidence_level,
    months: c.evidence_months, latest: c.latest, values: (c.vals || []).map(Number),
    ownerName: u?.owner_name || '',
    broker: b ? { name: b.full_name, email: b.email, title: b.title || '', mobile: b.mobile || '',
                  photo: b.photo ? `data:${b.photo_type || 'image/jpeg'};base64,${b.photo}` : null } : null,
  });
}

async function refresh(req, res) {
  const [r] = await sql`select (select min(refreshed_at) from mkt.listing_check_cache) as at`;
  if (r.at && Date.now() - new Date(r.at).getTime() < 60e3) return res.json({ ok: true, skipped: true });   // someone just did it
  const [n] = await sql`select mkt.refresh_listing_cache() as n`;
  res.json({ ok: true, listings: n.n });
}

export default route(async (req, res, staff) => {
  if (req.method === 'POST') {
    if (body(req).action === 'refresh') return refresh(req, res);
    return res.status(400).json({ error: 'Unknown action' });
  }
  const action = query(req).get('action');
  if (action === 'list') return list(req, res, staff);
  if (action === 'report') return report(req, res, staff);
  res.status(400).json({ error: 'Unknown action' });
}, { limitMs: (req) => (req.method === 'POST' ? 55000 : 12000) });
