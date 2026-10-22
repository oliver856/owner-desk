// Shared server code for every /api route. Files in api/_lib are not routes themselves.
// Nothing in here is ever sent to the browser.
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';

export const sql =
  globalThis.__sql ??
  (globalThis.__sql = postgres(process.env.DATABASE_URL, {
    prepare: false, max: 3, onnotice: () => {},
    // traffic between the site and the database is always encrypted (only a local test copy skips it)
    ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL || '') ? false : 'require', idle_timeout: 20, connect_timeout: 15,
    // dates stay as plain YYYY-MM-DD text so they never shift with time zones; big ids come back as numbers
    types: { date: { to: 1082, from: [1082], serialize: (x) => x, parse: (x) => x }, bigint: { to: 20, from: [20], serialize: (x) => String(x), parse: (x) => Number(x) } },
  }));

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPA_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
export const publicConfig = { url: SUPA_URL, anonKey: SUPA_ANON };

const authClient = createClient(SUPA_URL, SUPA_ANON, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

export function clientIp(req) {
  const f = req.headers['x-forwarded-for'];
  if (f) return String(f).split(',')[0].trim();
  return String(req.headers['x-real-ip'] || '');
}

// While OFFICE_IPS is empty (testing), every IP is allowed. Once set, only those IPs can use office routes.
export function officeAllowed(ip) {
  const list = (process.env.OFFICE_IPS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return list.length === 0 || list.includes(ip);
}

// Checks the sign-in token's signature, then loads the staff record and their areas in one query.
export async function staffFor(req) {
  const h = String(req.headers.authorization || '');
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) return null;
  const { data, error } = await authClient.auth.getClaims(token);
  const id = !error && data?.claims?.sub;
  if (!id) return null;
  const [s] = await sql`
    select s.user_id, s.full_name, s.email, s.role, s.team,
      case when s.role = 'admin' then (select coalesce(array_agg(id), '{}') from desk.areas)
           else coalesce((select array_agg(area_id) from desk.staff_areas sa where sa.user_id = s.user_id
                 and (sa.expires_at is null or sa.expires_at >= (now() at time zone 'Asia/Dubai')::date)), '{}')
      end as areas,
      (select id from desk.areas where name = 'Lookups') as lookup_area
    from desk.staff s where s.user_id = ${id} and s.active`;
  if (!s) return null;
  // Units found with the Lookup tab live in their own "Lookups" area. Everyone can open those units,
  // but they never appear in the Owners list (see listAreas).
  const lookupArea = s.lookup_area ? Number(s.lookup_area) : null;
  const own = (s.areas || []).map(Number).filter((a) => a !== lookupArea);
  return { ...s, lookupArea, listAreas: own, areas: lookupArea ? [...own, lookupArea] : own };
}

// Wraps a route: office-IP check, sign-in check, no caching, friendly errors.
export function route(fn, { office = true, auth = true } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const ip = clientIp(req);
      if (office && !officeAllowed(ip)) return res.status(403).json({ error: 'The Owner Desk only works from the Apex office network.' });
      let staff = null;
      if (auth) {
        staff = await staffFor(req);
        if (!staff) return res.status(401).json({ error: 'Signed out' });
      }
      await fn(req, res, staff, ip);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) res.status(500).json({ error: 'Something went wrong. Try again.' });
    }
  };
}

export function query(req) {
  return new URL(req.url, 'http://x').searchParams;
}

export function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

export async function audit(userId, action, { unitId = null, detail = {}, ip = '' } = {}) {
  await sql`insert into desk.audit_log (user_id, action, unit_id, detail, ip)
            values (${userId}, ${action}, ${unitId}, ${sql.json(detail)}, ${ip || null})`;
}

export async function setting(key, fallback) {
  const [r] = await sql`select value from desk.settings where key = ${key}`;
  return r ? r.value : fallback;
}

export async function caps(userId) {
  const [r] = await sql`
    with day as (select date_trunc('day', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai' as start)
    select
      coalesce((select (value #>> '{}')::int from desk.settings where key = 'daily_profile_cap'), 80) as profile_cap,
      coalesce((select (value #>> '{}')::int from desk.settings where key = 'daily_call_cap'), 60) as call_cap,
      (select count(*) from desk.audit_log, day where user_id = ${userId} and action = 'opened_unit' and at >= day.start)::int as profiles,
      (select count(*) from desk.audit_log, day where user_id = ${userId} and action = 'call_sent' and at >= day.start)::int as calls`;
  return { profileCap: r.profile_cap, callCap: r.call_cap, profiles: r.profiles, calls: r.calls };
}

export async function withinCallHours() {
  const hrs = await setting('call_hours', { from: '09:00', to: '18:00' });
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const now = Number(parts.find((p) => p.type === 'hour').value) * 60 + Number(parts.find((p) => p.type === 'minute').value);
  const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  return now >= toMin(hrs.from) && now < toMin(hrs.to);
}
