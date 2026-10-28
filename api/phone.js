// Phone actions: /api/phone?action=...
// These work from anywhere, but a phone only ever sees a call that the same broker
// started on a laptop inside the office, and only until it expires.
import { sql, schemaOk, route, query, body, audit } from './_lib/core.js';
import { vapidKeys, pushToUser } from './_lib/push.js';
import { OUTCOMES, saveOutcome } from './_lib/outcome.js';
import { getTemplates } from './_lib/templates.js';

// One extra column on calls records when the WhatsApp follow-up was sent or skipped. Added by the server itself.
let followReady = null;
const ensureFollow = () => (followReady ??= schemaOk().then((ok) => ok || sql`alter table desk.calls add column if not exists followup_at timestamptz`)
  .catch((e) => { followReady = null; throw e; }));
const NO_WHATSAPP = ['Wrong number', 'Do not call'];
// What happened on the WhatsApp step is added to the call's note, e.g. "Called, no reply. WhatsApp sent"
const WA_RESULT = { sent: 'WhatsApp sent', unavailable: 'WhatsApp unavailable', not_sent: 'WhatsApp not sent' };

const actions = {
  // The newest call waiting to be tapped, and the last tapped call with no outcome yet (masked numbers only)
  async pending(req, res, s) {
    await ensureFollow();
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
    // After a call the phone only ever deals with the broker's latest tapped call: its outcome first, then the
    // WhatsApp follow-up. Older calls left without an outcome stay on the record but don't queue up here.
    const [last] = await sql`
      select cr.id, c.outcome, c.note, c.outcome_at, o.name as owner_name, o.is_company, ph.masked, u.unit_no, u.unit_type, u.beds,
             b.subcommunity, b.name as building, a.name as area, (c.followup_at is not null) as followed_up,
             (cr.used_at > now() - interval '1 hour') as recent,
             exists (select 1 from desk.do_not_call d where d.owner_id = cr.owner_id) as dnc,
             exists (select 1 from desk.calls w where w.owner_id = cr.owner_id and w.note ~* 'whatsapp unavailable') as wa_missing
      from desk.call_requests cr
      join desk.calls c on c.request_id = cr.id
      join desk.owners o on o.id = cr.owner_id
      left join desk.owner_phones ph on ph.owner_id = cr.owner_id
      join desk.units u on u.id = cr.unit_id
      join desk.buildings b on b.id = u.building_id
      join desk.areas a on a.id = b.area_id
      where cr.user_id = ${s.user_id} and cr.used_at > now() - interval '2 hours'
      order by cr.used_at desc limit 1`;
    let awaiting = null, followup = null;
    if (last && !last.outcome_at) awaiting = last;
    else if (last && last.recent && !last.followed_up && !last.dnc && last.masked && !NO_WHATSAPP.includes(last.outcome) && !/^(sold|agent)\b/i.test(last.note || '')) followup = last;
    const templates = followup ? await getTemplates(s.user_id).catch(() => ({})) : {};
    // The last WhatsApp marked as sent in the past 30 minutes, so it can be corrected if the number isn't on WhatsApp
    const [lastWa] = await sql`
      select cr.id, o.name as owner_name from desk.calls c
      join desk.call_requests cr on cr.id = c.request_id join desk.owners o on o.id = c.owner_id
      where c.user_id = ${s.user_id} and c.followup_at > now() - interval '30 minutes' and c.note ~* 'whatsapp sent$'
      order by c.followup_at desc limit 1`;
    res.json({ name: s.full_name, pending: pending || null, awaiting: awaiting || null, followup: followup ? { ...followup, templates } : null, lastWa: lastWa || null });
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
    if (outcome && !OUTCOMES.includes(outcome)) return res.status(400).json({ error: 'Pick an outcome.' });
    if (!outcome && !String(note || '').trim()) return res.status(400).json({ error: 'Pick an outcome or add a note.' });
    const ok = await saveOutcome(s, Number(requestId), outcome, note, !!kendal, ip);
    if (!ok) return res.status(404).json({ error: 'That call wasn\'t found. Was the blue button tapped on your phone?' });
    res.json({ ok: true });
  },

  // WhatsApp follow-up after a call. The message is written on the phone screen; the server adds the number
  // only for this broker's own call from the past hour, and logs it.
  async whatsapp(req, res, s, ip) {
    if (req.method !== 'POST') return res.status(405).end();
    const b = body(req);
    const id = Number(b.requestId);
    const result = WA_RESULT[b.result] ? b.result : b.skip ? 'not_sent' : 'sent';
    const skip = result !== 'sent';
    const text = String(b.text || '').trim().slice(0, 1000);
    if (!skip && !text) return res.status(400).json({ error: 'Write a message first.' });
    await ensureFollow();
    const add = WA_RESULT[result];
    const [c] = await sql`
      update desk.calls c set followup_at = now(),
        note = case when coalesce(c.note, '') = '' then ${add} else rtrim(c.note, '. ') || '. ' || ${add} end
      from desk.call_requests cr
      where cr.id = c.request_id and cr.id = ${id} and cr.user_id = ${s.user_id}
        and cr.used_at > now() - interval '1 hour' and c.followup_at is null
        and not (coalesce(c.outcome, '') = any(${NO_WHATSAPP}))
        and not exists (select 1 from desk.do_not_call d where d.owner_id = c.owner_id)
      returning c.unit_id, c.owner_id`;
    if (!c) return res.status(410).json({ error: 'This follow-up has expired or was already sent.' });
    await audit(s.user_id, result === 'sent' ? 'whatsapp_opened' : result === 'unavailable' ? 'whatsapp_unavailable' : 'whatsapp_skipped', { unitId: c.unit_id, detail: { request_id: id, owner_id: c.owner_id }, ip });
    if (skip) return res.json({ ok: true });
    const [ph] = await sql`select phone from desk.owner_phones where owner_id = ${c.owner_id}`;
    const t = encodeURIComponent(text);
    // url: phones (opens the WhatsApp app). web / app: the laptop goes straight to the chat, skipping the wa.me page.
    res.json({ url: `https://wa.me/${ph.phone}?text=${t}`, web: `https://web.whatsapp.com/send?phone=${ph.phone}&text=${t}`,
      app: `whatsapp://send?phone=${ph.phone}&text=${t}` });
  },

  // The number wasn't on WhatsApp after all: change "WhatsApp sent" on that call to "WhatsApp unavailable".
  // Only the broker's own call, within 12 hours of the WhatsApp.
  async whatsappMissing(req, res, s, ip) {
    if (req.method !== 'POST') return res.status(405).end();
    const id = Number(body(req).requestId);
    const [c] = await sql`
      update desk.calls c set note = regexp_replace(c.note, 'WhatsApp sent$', 'WhatsApp unavailable', 'i')
      where c.request_id = ${id} and c.user_id = ${s.user_id} and c.followup_at > now() - interval '12 hours' and c.note ~* 'whatsapp sent$'
      returning c.unit_id, c.owner_id`;
    if (!c) return res.status(410).json({ error: 'That WhatsApp can no longer be changed.' });
    await audit(s.user_id, 'whatsapp_unavailable', { unitId: c.unit_id, detail: { request_id: id, owner_id: c.owner_id, corrected: true }, ip });
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
