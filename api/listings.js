// Listings tab: each broker's live Kendal listings checked against recent land department sales and new Ejari leases
// (database function mkt.listing_checks, migration 019), and the figures for the owner report.
//   GET /api/listings?action=list[&scope=team|all]   brokers: their own listings. Managers can ask for their team,
//                                                    admins and directors for everyone.
//   GET /api/listings?action=report&id=AHRE-1234     one listing's figures, the owner's name and the broker's details
// Read-only. The raw transactions never leave the server: only ranges, medians, counts and the dots on the report.
import { sql, route, query } from './_lib/core.js';
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

// Desk unit (for "Call owner") per listing. Kendal landlords aren't synced yet, so this is the Desk owner on the unit
// with the same building and unit number, and only when exactly one unit matches.
async function deskUnits(ids) {
  if (!ids.length) return new Map();
  const rows = await sql`select listing_id, unit_id, owner_name from mkt.listing_desk_units(${ids}::text[])`;
  return new Map(rows.map((r) => [r.listing_id, r]));
}

async function list(req, res, staff) {
  const q = query(req);
  const who = await emailsFor(staff, canTeam(staff) ? q.get('scope') : null);
  await sql`select mkt.refresh_listing_map()`;   // new Kendal buildings get matched the first time they're seen
  const rows = who.all
    ? await sql`select c.*, k.agent_name from mkt.listing_checks() c join ops.kendal_listings k using (listing_id)`
    : await sql`select c.*, k.agent_name from mkt.listing_checks(${who.emails}) c join ops.kendal_listings k using (listing_id)`;
  const units = await deskUnits(rows.map((r) => r.listing_id));
  const [asOf] = await sql`select (select max(sold_on) from mkt.dld_sales) as sales_to, (select max(starts_on) from mkt.ejari_rents) as rents_to`;
  res.json({
    scope: who.all ? 'all' : who.team ? 'team' : 'mine', team: who.team || null, canTeam: canTeam(staff), canAll: ['admin', 'director'].includes(staff.role),
    salesTo: asOf.sales_to, rentsTo: asOf.rents_to,
    listings: rows.map((r) => ({
      id: r.listing_id, agent: r.agent_name || r.agent_email, agentEmail: r.agent_email, title: r.title,
      purpose: r.purpose, kind: r.kind, beds: r.beds, size: r.size_sqft,
      community: r.community, subCommunity: r.sub_community, building: r.building, unitNo: r.unit_no,
      listed: r.listed, target: r.target, gap: r.gap_pct == null ? null : Number(r.gap_pct), verdict: r.verdict,
      evidence: r.evidence, level: r.evidence_level, months: r.evidence_months, low: r.low, high: r.high, latest: r.latest, note: r.note,
      unitId: units.get(r.listing_id)?.unit_id || null,
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
  const [c] = await sql`select * from mkt.listing_checks(${[String(k.agent_email || '').toLowerCase()]}) where listing_id = ${id}`;
  if (!c || c.target == null) return res.status(400).json({ error: 'There isn\'t enough evidence for a report on this listing yet.' });
  const [u] = await sql`select * from mkt.listing_desk_unit(${id})`;
  // The broker on the report is the listing's agent (for a manager downloading a team member's report), else the person asking
  const brokerRow = (email) => sql`select s.full_name, s.email, s.title, s.mobile, p.content_type as photo_type, encode(p.photo, 'base64') as photo
                                   from desk.staff s left join desk.staff_photos p on lower(p.email) = lower(s.email)
                                   where lower(s.email) = lower(${email}) and s.active`;
  let [b] = k.agent_email ? await brokerRow(k.agent_email) : [];
  if (!b) [b] = await brokerRow(staff.email);
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

export default route(async (req, res, staff) => {
  const action = query(req).get('action');
  if (action === 'list') return list(req, res, staff);
  if (action === 'report') return report(req, res, staff);
  res.status(400).json({ error: 'Unknown action' });
});
