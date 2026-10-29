// Push a lead into Kendal when a broker ticks "Send to Kendal" after a call.
// Uses Kendal's own addContact API (the same one the Bayut leads sheet uses). The lead is assigned to the
// broker who made the call, by their login email. Only ever writes one new contact into Apex's own company.
// Needs three Vercel settings: KENDAL_API_KEY, KENDAL_COMPANY_ID, KENDAL_USER_ID. Without them nothing is sent.
import { sql } from './core.js';

const URL = process.env.KENDAL_URL || 'https://us-central1-kendal-17416.cloudfunctions.net/addContact';
export const kendalReady = () => !!(process.env.KENDAL_API_KEY && process.env.KENDAL_COMPANY_ID && process.env.KENDAL_USER_ID);

let ready = null;
export function ensureKendal() {
  ready ??= (async () => {
    const [r] = await sql`select to_regclass('desk.kendal_pushes') is not null as ok`;
    if (r.ok) return;
    await sql`create table if not exists desk.kendal_pushes (
      call_id bigint primary key references desk.calls(id) on delete cascade,
      status text not null,
      detail text,
      agent_email text,
      at timestamptz not null default now())`;
    await sql`alter table desk.kendal_pushes enable row level security`;
    await sql`revoke all on desk.kendal_pushes from anon, authenticated`;
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

const title = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()).trim();

// What the owner wants, in Kendal's intent words
function intentFor(outcome, note) {
  const t = `${outcome || ''} ${note || ''}`.toLowerCase();
  if (/wants to rent/.test(t)) return 'Rent Out';
  if (/wants to buy/.test(t)) return 'Buy';
  if (/sell|valuation|listing|unit available/.test(t)) return 'Sell';
  return null;
}

async function post(payload) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const res = await fetch(URL, { method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.KENDAL_API_KEY },
      body: JSON.stringify(payload) });
    const text = await res.text();
    let body = {}; try { body = JSON.parse(text); } catch {}
    return { code: res.status, body, text };
  } finally { clearTimeout(timer); }
}

// Returns { status: 'sent' | 'existing' | 'error' | 'off', detail }. Never pushes the same call twice.
export async function pushCallToKendal(callId) {
  if (!kendalReady()) return { status: 'off', detail: 'Kendal is not set up yet' };
  await ensureKendal();
  const [done] = await sql`select status, detail from desk.kendal_pushes where call_id = ${callId}`;
  if (done && done.status !== 'error') return done;
  const [c] = await sql`
    select c.id, c.outcome, c.note, c.called_at, o.name as owner_name, o.is_company, ph.phone,
           u.unit_no, u.unit_type, b.subcommunity, b.name as building, a.name as area, st.email as agent_email, st.full_name as agent_name
    from desk.calls c join desk.owners o on o.id = c.owner_id
    join desk.owner_phones ph on ph.owner_id = c.owner_id
    join desk.units u on u.id = c.unit_id join desk.buildings b on b.id = u.building_id join desk.areas a on a.id = b.area_id
    join desk.staff st on st.user_id = c.user_id
    where c.id = ${callId}`;
  if (!c) return { status: 'error', detail: 'Call or mobile number not found' };

  const parts = title(c.owner_name).split(/\s+/).filter(Boolean);
  const place = c.unit_type === 'Villa' ? `${title(c.subcommunity)} ${c.unit_no}` : `${title(c.building)} ${c.unit_no}`;
  const contactDetails = {
    firstName: c.is_company ? title(c.owner_name) : parts[0] || 'Owner',
    phone: '+' + String(c.phone).replace(/\D/g, ''),
    source: 'Owner Desk',
    additionalInfo: `Owner Desk call: ${place}, ${c.area}. ${c.outcome ? c.outcome + '. ' : ''}${c.note || ''}`.trim().slice(0, 900),
  };
  if (!c.is_company && parts.length > 1) contactDetails.lastName = parts.slice(1).join(' ');
  const intent = intentFor(c.outcome, c.note);
  if (intent) contactDetails.intent = [intent];
  const payload = { companyId: process.env.KENDAL_COMPANY_ID, userId: process.env.KENDAL_USER_ID, contactDetails, agentEmailToAssign: c.agent_email };

  let status, detail;
  try {
    let r = await post(payload);
    // If Kendal doesn't accept our source or intent wording, send again without them
    if (r.code === 400 || r.code === 422 || r.code === 500) {
      delete contactDetails.intent; delete contactDetails.source;
      const again = await post(payload);
      if (again.code === 200 || again.code === 201) r = again;
    }
    if (r.code === 201) { status = 'sent'; detail = `New lead in Kendal, assigned to ${c.agent_name}`; }
    else if (r.code === 200 && r.body.isExisting) { status = 'existing'; detail = 'Already in Kendal (number was already a contact)'; }
    else if (r.code === 200) { status = 'sent'; detail = `Sent to Kendal, assigned to ${c.agent_name}`; }
    else { status = 'error'; detail = `Kendal said ${r.code}: ${String(r.body.error || r.text).slice(0, 200)}`; }
  } catch (e) {
    status = 'error'; detail = e.name === 'AbortError' ? 'Kendal took too long to answer' : String(e.message || e).slice(0, 200);
  }
  await sql`insert into desk.kendal_pushes (call_id, status, detail, agent_email) values (${callId}, ${status}, ${detail}, ${c.agent_email})
            on conflict (call_id) do update set status = excluded.status, detail = excluded.detail, at = now()`;
  return { status, detail };
}
