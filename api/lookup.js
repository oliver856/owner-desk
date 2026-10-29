// Lookup tab: /api/lookup?action=...  (office only, like the rest of the desk)
// Finds the registered unit and owner behind a listing link or a DEWA number using the DXB Hawk API.
// Owners found here go into a separate "Lookups" area, so the Owners list stays untouched.
// The API key lives only in Vercel (DXB_HAWK_KEY). Full numbers never reach the laptop.
import crypto from 'node:crypto';
import { sql, ensureOnce, route, query, body, audit, setting } from './_lib/core.js';

const BASE = process.env.DXB_HAWK_URL || 'https://api.sosvoid.com';
const KEY = () => process.env.DXB_HAWK_KEY || '';

const ensure = ensureOnce((q) => q`select to_regclass('desk.lookups') is not null and to_regclass('desk.lookup_units') is not null
    and exists (select 1 from desk.areas where name = 'Lookups') as ok`, async (sql) => {
    await sql`insert into desk.areas (name) values ('Lookups') on conflict (name) do nothing`;
    await sql`create table if not exists desk.lookups (
      id bigint generated always as identity primary key,
      user_id uuid not null references desk.staff(user_id),
      created_at timestamptz not null default now(),
      input jsonb not null,
      answer jsonb,
      request_id text)`;
    await sql`create table if not exists desk.lookup_units (
      property_id bigint primary key,
      unit_id bigint not null references desk.units(id),
      user_id uuid not null references desk.staff(user_id),
      created_at timestamptz not null default now(),
      property jsonb not null,
      owner_answer jsonb not null)`;
    await sql`alter table desk.lookups enable row level security`;
    await sql`alter table desk.lookup_units enable row level security`;
    await sql`revoke all on desk.lookups, desk.lookup_units from anon, authenticated`;
});

async function hawk(path, payload, idem) {
  const r = await fetch(BASE + path, {
    method: payload ? 'POST' : 'GET',
    headers: { authorization: 'Bearer ' + KEY(), 'content-type': 'application/json', ...(idem ? { 'idempotency-key': idem } : {}) },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, j };
}

const FRIENDLY = {
  needs_card: 'This listing needs its permit card. Paste the whole permit card text from the listing as well.',
  unsupported_url: 'That listing site isn\'t supported. Try a Property Finder or Bayut link, or a DEWA number.',
  bad_dewa: 'A DEWA premise number is digits only.',
  not_found: 'Nothing was found for that. No credits were used.',
  ref_expired: 'This search is more than 30 minutes old. Search again (a new search uses 2 credits).',
  no_credits: 'The lookup account is out of credits.',
  too_many: 'Too many lookups in a minute. Wait a moment and try again.',
  upstream_down: 'The lookup service couldn\'t check just now. Try again shortly. No credits were used.',
  bad_key: 'The lookup API key in Vercel isn\'t valid.',
  no_key: 'The lookup API key hasn\'t been added in Vercel yet.',
};
const fail = (res, st, j) => res.status(st >= 500 ? 502 : st === 402 || st === 401 ? 503 : 400)
  .json({ error: FRIENDLY[j?.error?.code] || j?.error?.message || 'The lookup didn\'t work. Try again.', code: j?.error?.code });

const digits = (m) => String(m || '').replace(/\D/g, '').replace(/^00/, '');
function mask(d) {
  if (d.startsWith('971') && d.length >= 11) return `+971 ${d.slice(3, 5)} ••• ••${d.slice(-2)}`;
  return `+${d.slice(0, 2)}… ••${d.slice(-2)}`;
}
const sqft = (m2) => (m2 ? Math.round(Number(m2) * 10.7639 * 10) / 10 : null);
const bedsOf = (r) => { const m = /(\d+)/.exec(r || ''); return /studio/i.test(r || '') ? 'Studio' : m ? m[1] : null; };
const isVilla = (p) => /villa|townhouse/i.test(`${p.property_type_en || ''} ${p.property_sub_type_en || ''}`);
const placeName = (p) => p.building_name_en || p.project_name_en || p.master_project_en || p.area_name_en || 'Unknown';
const looksCompany = (n) => /\b(llc|l\.l\.c|fzco|fze|ltd|limited|dmcc|pjsc|company|holding|investments?|properties|real estate|bank)\b/i.test(n || '');

async function todayCount(userId) {
  const [r] = await sql`select count(*)::int as n from desk.audit_log where user_id = ${userId} and action = 'lookup_property'
    and at >= date_trunc('day', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai'`;
  return r.n;
}

const actions = {
  // Credits left (admin) and this broker's lookups today
  async status(req, res, s) {
    await ensure();
    const cap = Number(await setting('daily_lookup_cap', 10));
    const used = await todayCount(s.user_id);
    let credits = null;
    if (KEY() && s.role === 'admin') {
      const r = await hawk('/api/v1/me').catch(() => null);
      if (r?.status === 200) credits = r.j.credits;
    }
    res.json({ configured: !!KEY(), cap, used, credits, admin: s.role === 'admin' });
  },

  // Recent lookups by anyone (they're shared so nobody pays twice for the same unit)
  async recent(req, res) {
    await ensure();
    const rows = await sql`
      select lu.unit_id, lu.created_at, st.full_name as by_name, lu.property, u.unit_no,
             (select string_agg(o.name, ', ') from desk.unit_owners x join desk.owners o on o.id = x.owner_id where x.unit_id = u.id) as owners,
             (select ph.masked from desk.unit_owners x join desk.owner_phones ph on ph.owner_id = x.owner_id where x.unit_id = u.id limit 1) as masked,
             coalesce(jsonb_array_length(lu.owner_answer->'previous'), 0) as previous_n,
             coalesce(jsonb_array_length(lu.owner_answer->'sales'), 0) as sales_n,
             (select string_agg(p->>'name', ', ') from jsonb_array_elements(lu.owner_answer->'previous') p) as previous
      from desk.lookup_units lu join desk.units u on u.id = lu.unit_id join desk.staff st on st.user_id = lu.user_id
      order by lu.created_at desc limit 50`;
    res.json({ rows });
  },

  // Step 1: listing link (+ permit card) or DEWA number -> the registered unit(s). 2 credits when found.
  async search(req, res, s, ip) {
    if (req.method !== 'POST') return res.status(405).end();
    if (!KEY()) return res.status(503).json({ error: FRIENDLY.no_key });
    await ensure();
    const b = body(req);
    const input = {};
    const dewa = digits(b.dewa);
    if (dewa) input.dewa = dewa;
    else if (/^https?:\/\//i.test(String(b.url || '').trim())) {
      input.url = String(b.url).trim().slice(0, 2000);
      if (String(b.card || '').trim()) input.card = String(b.card).trim().slice(0, 5000);
    } else return res.status(400).json({ error: 'Paste a listing link, or type a DEWA premise number.' });

    const cap = Number(await setting('daily_lookup_cap', 10));
    if ((await todayCount(s.user_id)) >= cap) {
      await audit(s.user_id, 'limit_hit', { detail: { limit: 'lookups' }, ip });
      return res.status(429).json({ error: `You've used your ${cap} lookups for today.` });
    }
    // Same search by the same person on the same day is never charged twice
    const day = new Date().toISOString().slice(0, 10);
    const idem = crypto.createHash('sha256').update(JSON.stringify([s.user_id, day, input])).digest('hex');
    const r = await hawk('/api/v1/property', input, 'p-' + idem);
    if (r.status !== 200) {
      await audit(s.user_id, 'lookup_failed', { detail: { step: 'property', code: r.j?.error?.code, request_id: r.j?.request_id }, ip });
      return fail(res, r.status, r.j);
    }
    const list = r.j.matches ? r.j.matches : [{ property: r.j.property, ref: r.j.ref }];
    const [row] = await sql`insert into desk.lookups (user_id, input, answer, request_id)
      values (${s.user_id}, ${sql.json(input)}, ${sql.json({ matches: list, charged: r.j.charged })}, ${r.j.request_id || null}) returning id`;
    await audit(s.user_id, 'lookup_property', { detail: { lookup_id: row.id, charged: r.j.charged, request_id: r.j.request_id }, ip });
    const ids = list.map((m) => m.property?.property_id).filter(Boolean);
    const known = ids.length ? await sql`select property_id, unit_id from desk.lookup_units where property_id = any(${ids})` : [];
    const have = new Map(known.map((k) => [Number(k.property_id), k.unit_id]));
    res.json({
      lookupId: row.id,
      charged: r.j.charged ?? 0,
      candidates: list.map((m, i) => ({ i, property: m.property, unitId: have.get(Number(m.property?.property_id)) || null })),
    });
  },

  // Step 2: the owner for one candidate. 3 credits, unless we already hold this unit.
  async owner(req, res, s, ip) {
    if (req.method !== 'POST') return res.status(405).end();
    if (!KEY()) return res.status(503).json({ error: FRIENDLY.no_key });
    await ensure();
    const b = body(req);
    const [lk] = await sql`select id, answer, created_at from desk.lookups where id = ${Number(b.lookupId)} and user_id = ${s.user_id}`;
    const m = lk?.answer?.matches?.[Number(b.i)];
    if (!m) return res.status(404).json({ error: 'Search again.' });
    const p = m.property || {};
    if (p.property_id) {
      const [k] = await sql`select unit_id from desk.lookup_units where property_id = ${p.property_id}`;
      if (k) return res.json({ unitId: k.unit_id, charged: 0 });
    }
    const r = await hawk('/api/v1/owner', { ref: m.ref }, 'o-' + crypto.createHash('sha256').update(`${lk.id}:${b.i}`).digest('hex'));
    if (r.status !== 200) {
      await audit(s.user_id, 'lookup_failed', { detail: { step: 'owner', code: r.j?.error?.code, request_id: r.j?.request_id }, ip });
      return fail(res, r.status, r.j);
    }
    const ans = r.j;
    const unitId = await sql.begin(async (t) => {
      const [area] = await t`select id from desk.areas where name = 'Lookups'`;
      const villa = isVilla(p);
      const sub = p.master_project_en || p.area_name_en || 'Lookups';
      const bname = villa ? sub : placeName(p);
      await t`insert into desk.buildings (area_id, subcommunity, name) values (${area.id}, ${sub}, ${bname}) on conflict do nothing`;
      const [bl] = await t`select id from desk.buildings where area_id = ${area.id} and subcommunity = ${sub} and name = ${bname}`;
      const unitNo = String(p.property_number || p.property_id || 'unknown');
      await t`insert into desk.units (building_id, unit_no, unit_type, beds, size_sqft, land_no)
              values (${bl.id}, ${unitNo}, ${villa ? 'Villa' : 'Apartment'}, ${bedsOf(p.rooms_en)}, ${sqft(p.actual_area)}, ${p.land_number || null})
              on conflict (building_id, unit_no) do nothing`;
      const [u] = await t`select id from desk.units where building_id = ${bl.id} and unit_no = ${unitNo}`;
      for (const o of ans.owners || []) {
        const d = digits(o.mobile);
        const key = `lookup|${String(o.name || '').toLowerCase().trim()}|${d}`;
        await t`insert into desk.owners (name, is_company, source_key) values (${String(o.name || 'Unknown owner').toUpperCase()}, ${looksCompany(o.name)}, ${key})
                on conflict (source_key) do nothing`;
        const [ow] = await t`select id from desk.owners where source_key = ${key}`;
        if (d.length >= 8) await t`insert into desk.owner_phones (owner_id, phone, masked) values (${ow.id}, ${d}, ${mask(d)}) on conflict (owner_id) do nothing`;
        await t`insert into desk.unit_owners (unit_id, owner_id, role) values (${u.id}, ${ow.id}, 'owner') on conflict do nothing`;
      }
      await t`insert into desk.lease_status (unit_id, status, as_of) values (${u.id}, 'Not confirmed', current_date) on conflict (unit_id) do nothing`;
      if (p.property_id) {
        await t`insert into desk.lookup_units (property_id, unit_id, user_id, property, owner_answer)
                values (${p.property_id}, ${u.id}, ${s.user_id}, ${sql.json(p)}, ${sql.json({ owners: (ans.owners || []).map((o) => ({ name: o.name, name_ar: o.name_ar, has_email: !!o.email })), previous: (ans.previous || []).map((o) => ({ name: o.name })), sales: ans.sales || [], asking_price_aed: ans.asking_price_aed ?? null })})
                on conflict (property_id) do nothing`;
      }
      return u.id;
    });
    await sql`select desk.refresh_units()`;
    await audit(s.user_id, 'lookup_owner', { unitId, detail: { lookup_id: lk.id, charged: ans.charged, owners: (ans.owners || []).length, request_id: ans.request_id }, ip });
    res.json({ unitId, charged: ans.charged ?? 0 });
  },
};

export default route(async (req, res, s, ip) => {
  const fn = actions[query(req).get('action')];
  if (!fn) return res.status(404).json({ error: 'Unknown action' });
  await fn(req, res, s, ip);
});
