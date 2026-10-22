import webpush from 'web-push';
import { sql } from './core.js';

let keysCache = null;

// Push keys are created once by the server and kept in the locked settings table.
export async function vapidKeys() {
  if (keysCache) return keysCache;
  const [row] = await sql`select value from desk.settings where key = 'vapid'`;
  if (row) return (keysCache = row.value);
  const fresh = webpush.generateVAPIDKeys();
  await sql`insert into desk.settings (key, value) values ('vapid', ${sql.json({ publicKey: fresh.publicKey, privateKey: fresh.privateKey })})
            on conflict (key) do nothing`;
  const [again] = await sql`select value from desk.settings where key = 'vapid'`;
  return (keysCache = again.value);
}

// Sends an alert to every phone this broker switched on. Never includes the phone number.
export async function pushToUser(userId, msg) {
  const subs = await sql`select id, endpoint, p256dh, auth from desk.push_subs where user_id = ${userId}`;
  if (!subs.length) return 0;
  const k = await vapidKeys();
  webpush.setVapidDetails('mailto:crm@apexhomesdxb.com', k.publicKey, k.privateKey);
  const payload = JSON.stringify(msg);
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload,
        { TTL: 300, urgency: 'high', timeout: 5000 });
      sent++;
      await sql`update desk.push_subs set last_ok_at = now() where id = ${s.id}`;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) await sql`delete from desk.push_subs where id = ${s.id}`;
    }
  }));
  return sent;
}
