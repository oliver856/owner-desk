import webpush from 'web-push';
import { sql } from './db';

type Keys = { publicKey: string; privateKey: string };
let keysCache: Keys | null = null;

// Push keys are created once by the server itself and kept in the locked settings table,
// so no secret ever has to be copied around by hand.
export async function vapidKeys(): Promise<Keys> {
  if (keysCache) return keysCache;
  const [row] = await sql<{ value: Keys }[]>`select value from desk.settings where key = 'vapid'`;
  if (row) return (keysCache = row.value);
  const fresh = webpush.generateVAPIDKeys();
  await sql`insert into desk.settings (key, value) values ('vapid', ${sql.json({ publicKey: fresh.publicKey, privateKey: fresh.privateKey })}) on conflict (key) do nothing`;
  const [again] = await sql<{ value: Keys }[]>`select value from desk.settings where key = 'vapid'`;
  return (keysCache = again.value);
}

export type CallPush = { title: string; body: string; url: string; tag: string };

// Sends the alert to every phone this broker has switched on. Returns how many phones got it.
// The message never contains the phone number; the phone fetches it only when Call is tapped.
export async function pushToUser(userId: string, msg: CallPush): Promise<number> {
  const subs = await sql<{ id: number; endpoint: string; p256dh: string; auth: string }[]>`
    select id, endpoint, p256dh, auth from desk.push_subs where user_id = ${userId}`;
  if (!subs.length) return 0;
  const k = await vapidKeys();
  webpush.setVapidDetails('mailto:crm@apexhomesdxb.com', k.publicKey, k.privateKey);
  const payload = JSON.stringify(msg);
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 120, urgency: 'high', timeout: 5000 },
      );
      sent++;
      await sql`update desk.push_subs set last_ok_at = now() where id = ${s.id}`;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await sql`delete from desk.push_subs where id = ${s.id}`;
    }
  }));
  return sent;
}
