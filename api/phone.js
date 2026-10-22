// Phone actions: /api/phone?action=...
// These work from anywhere, but a phone only ever sees a call that the same broker
// started on a laptop inside the office, and only until it expires.
import { sql, route, query, body, audit } from './_lib/core.js';
import { vapidKeys, pushToUser } from './_lib/push.js';
import { OUTCOMES, saveOutcome } from './_lib/outcome.js';

const actions = {
  // The newest call waiting to be tapped, and the last tapped call with no outcome yet (masked numbers only)
  async pending(req, res, s) {
    const [pending] = await sql`
      select cr.id, o.name as owner_name, ph.masked, u.unit_no, u.unit_type, b.subcommunity, b.name as building,
             extract(epoch from (cr.expires_at - now()))::int as seconds_left
      from desk.call_requests cr
      join desk.owners o on o.id = cr.owner_id
      join desk.owner_phones ph on ph.owner_id = cr.owner_id
      join desk.units u on u.id = cr.unit_id
      join desk.buildings b on b.id = u.building_id
      where cr.user_id = ${s.user_id} and cr.used_at is null and cr.expires_at > now()
      order by cr.created_at desc limit 1`;
    const [awaiting] = await sql`
      select cr.id, o.name as owner_name, u.unit_no, u.unit_type, b.subcommunity, b.name as building
      from desk.call_requests cr
      join desk.calls c on c.request_id = cr.id and c.outcome is null
      join desk.owners o on o.id = cr.owner_id
      join desk.units u on u.id = cr.unit_id
      join desk.buildings b on b.id = u.building_id
      where cr.user_id = ${s.user_id} and cr.used_at > now() - interval '2 hours'
      order by cr.used_at desc limit 1`;
    res.json({ name: s.full_name, pending: pending || null, awaiting: awaiting || null });
  },

  // The blue button. Releases the number once, for this broker's own unexpired request, and records the call.
  async dial(req, res, s, ip) {
    if (req.method !== 'POST') return res.status(405).end();
    const id = Number(body(req).id);
    const [r] = await sql`
      update desk.call_requests set used_at = now()
      where id = ${id} and user_id = ${s.user_id} and used_at is null and expires_at > now()
      returning unit_id, owner_id`;
    if (!r) {
      await audit(s.user_id, 'dial_refused', { detail: { request_id: id }, ip });
      return res.status(410).json({ error: 'This call has expired or was already used. Press Call on the laptop again.' });
    }
    const [ph] = await sql`select phone from desk.owner_phones where owner_id = ${r.owner_id}`;
    await sql`insert into desk.calls (request_id, user_id, unit_id, owner_id) values (${id}, ${s.user_id}, ${r.unit_id}, ${r.owner_id})`;
    await audit(s.user_id, 'call_dialled', { unitId: r.unit_id, detail: { request_id: id, owner_id: r.owner_id }, ip });
    res.json({ tel: '+' + ph.phone });
  },

  // Outcome after the call, from the phone or the laptop
  async outcome(req, res, s, ip) {
    if (req.method !== 'POST') return res.status(405).end();
    const { requestId, outcome, note, kendal } = body(req);
    if (!OUTCOMES.includes(outcome)) return res.status(400).json({ error: 'Pick an outcome.' });
    const ok = await saveOutcome(s, Number(requestId), outcome, note, !!kendal, ip);
    if (!ok) return res.status(404).json({ error: 'That call wasn\'t found. Was the blue button tapped on your phone?' });
    res.json({ ok: true });
  },

  async vapid(req, res) {
    res.json({ publicKey: (await vapidKeys()).publicKey });
  },

  // Turn call alerts on for this phone (POST), check (GET), or turn off (DELETE)
  async subscribe(req, res, s, ip) {
    if (req.method === 'GET') {
      const [r] = await sql`select count(*)::int as n from desk.push_subs where user_id = ${s.user_id}`;
      return res.json({ phones: r.n });
    }
    if (req.method === 'DELETE') {
      await sql`delete from desk.push_subs where endpoint = ${String(body(req).endpoint || '')} and user_id = ${s.user_id}`;
      return res.json({ ok: true });
    }
    const { subscription: sub, test } = body(req);
    const ep = sub?.endpoint, p = sub?.keys?.p256dh, a = sub?.keys?.auth;
    if (!ep || !p || !a || !/^https:\/\//.test(ep)) return res.status(400).json({ error: 'Bad subscription' });
    const ua = String(req.headers['user-agent'] || '').slice(0, 300);
    await sql`
      insert into desk.push_subs (user_id, endpoint, p256dh, auth, user_agent) values (${s.user_id}, ${ep}, ${p}, ${a}, ${ua})
      on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
        user_agent = excluded.user_agent, created_at = now()`;
    await audit(s.user_id, 'phone_alerts_on', { ip, detail: { ua } });
    const sent = test ? await pushToUser(s.user_id, { title: 'Apex Owner Desk', body: 'Call alerts are on for this phone.', url: '/phone', tag: 'test' }) : 0;
    res.json({ ok: true, sent });
  },
};

export default route(async (req, res, s, ip) => {
  const fn = actions[query(req).get('action')];
  if (!fn) return res.status(404).json({ error: 'Unknown action' });
  await fn(req, res, s, ip);
}, { office: false });
