// Shared server code for every /api route. Files in api/_lib are not routes themselves.
// Nothing in here is ever sent to the browser.
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';

const connect = () => postgres(process.env.DATABASE_URL, {
  prepare: false, max: 3, onnotice: () => {}, max_lifetime: 60 * 5, idle_timeout: 20, connect_timeout: 10,
  // traffic between the site and the database is always encrypted (only a local test copy skips it)
  ssl: /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL || '') ? false : 'require',
  // dates stay as plain YYYY-MM-DD text so they never shift with time zones; big ids come back as numbers
  types: { date: { to: 1082, from: [1082], serialize: (x) => x, parse: (x) => x }, bigint: { to: 20, from: [20], serialize: (x) => String(x), parse: (x) => Number(x) } },
});
globalThis.__sql ??= connect();
// Vercel can pause a server copy halfway through talking to the database. Its connections then wait forever and every
// request on that copy hangs. resetDb() throws those connections away and opens fresh ones. 'sql' always points at
// the current set, so the rest of the code doesn't change.
export function resetDb() {
  const old = globalThis.__sql;
  globalThis.__sql = connect();
  old.end({ timeout: 0 }).catch(() => {});
}
export const sql = new Proxy(function () {}, {
  apply: (_t, _this, args) => globalThis.__sql(...args),
  get: (_t, prop) => { const v = globalThis.__sql[prop]; return typeof v === 'function' ? v.bind(globalThis.__sql) : v; },
});

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPA_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
export const publicConfig = { url: SUPA_URL, anonKey: SUPA_ANON };

const authClient = createClient(SUPA_URL, SUPA_ANON, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

// Schema check. The server used to run "create/alter table if not exists" on every cold start. ALTER TABLE takes a
// table-wide lock, so during a big import (or with many brokers at once) every request queued behind it and the site hung
// on "Loading...". Now one cheap catalogue read per server instance confirms everything is already in place, and the
// set-up statements only run if something is genuinely missing.
let schemaOkP = null;
// Safe set-up step. Checks one specific thing (a table, column or index) and only if it's genuinely missing runs the
// set-up, inside a transaction that gives up after 2 seconds if the table is busy. It can never leave other requests
// queuing behind a table change, never throws, and runs at most once per server instance.
export function ensureOnce(check, apply) {
  let p = null;
  return () => (p ??= (async () => {
    try {
      const [r] = await check(sql);
      if (r && r.ok) return;
      await sql.begin(async (tx) => {
        await tx`set local lock_timeout = '2s'`;
        await tx`set local statement_timeout = '20s'`;
        await apply(tx);
      });
    } catch (e) { console.error('Set-up step skipped:', e.message); }
  })());
}

// WhatsApp wants the number with no 0 after the country code. Some lists store e.g. UK numbers as 4407... or Saudi as 96605...;
// the phone app forgives that, WhatsApp Web says "not on WhatsApp". Strip that one 0 for the common country codes.
export function waNumber(p) {
  const d = String(p || '').replace(/\D/g, '');
  const m = /^(44|33|49|39|31|32|41|43|45|46|47|61|64|91|92|20|27|90|966|965|974|973|968|962|961|971)0(\d{6,})$/.exec(d);
  return m ? m[1] + m[2] : d;
}

export function schemaOk() {
  schemaOkP ??= sql`select
      to_regclass('desk.staff_prefs') is not null and to_regclass('desk.notes') is not null
      and to_regclass('desk.notes_unit_idx') is not null and to_regclass('desk.lookups') is not null
      and to_regclass('desk.lookup_units') is not null and to_regclass('desk.staff_invites') is not null
      and to_regclass('desk.calls_owner_time_idx') is not null and to_regclass('desk.calls_time_idx') is not null
      and to_regclass('desk.call_requests_owner_time_idx') is not null
      and exists (select 1 from pg_attribute where attrelid = 'desk.units'::regclass and attname = 'layout' and not attisdropped)
      and exists (select 1 from pg_attribute where attrelid = 'desk.units'::regclass and attname = 'old_code' and not attisdropped)
      and exists (select 1 from pg_attribute where attrelid = 'desk.calls'::regclass and attname = 'followup_at' and not attisdropped)
      and exists (select 1 from pg_constraint where conname = 'staff_role_check' and pg_get_constraintdef(oid) like '%director%')
      and exists (select 1 from desk.settings where key = 'call_holds')
      and exists (select 1 from desk.areas where name = 'Lookups')
      and coalesce(obj_description(to_regprocedure('desk.owner_hold(bigint, uuid)'), 'pg_proc'), '') = 'hold v1' as ok`
    .then(([r]) => !!r?.ok)
    .then((ok) => { if (!ok) schemaOkP = null; return ok; })
    .catch(() => { schemaOkP = null; return false; });
  return schemaOkP;
}

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
      case when s.role in ('admin', 'director') then (select coalesce(array_agg(id), '{}') from desk.areas)
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
// Watchdog: no request may take longer than this. If one does, its database connections are presumed stuck,
// they're replaced, and the page gets a quick "try again" (the screen retries by itself) instead of hanging.
const REQUEST_LIMIT_MS = 12000;
export function route(fn, { office = true, auth = true } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    let timedOut = false;
    const dog = setTimeout(() => {
      timedOut = true;
      console.error('Request took too long, resetting database connections:', req.url);
      resetDb();
      if (!res.headersSent) res.status(503).json({ error: 'The Owner Desk is busy. Trying again…', retry: true });
    }, REQUEST_LIMIT_MS);
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
      if (!timedOut) console.error(e);
      if (!res.headersSent) res.status(500).json({ error: 'Something went wrong. Try again.' });
    } finally { clearTimeout(dog); }
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
      coalesce((select (value #>> '{}')::int from desk.settings where key = 'daily_copy_cap'), 40) as copy_cap,
      (select count(*) from desk.audit_log, day where user_id = ${userId} and action = 'number_copied' and at >= day.start)::int as copies,
      (select count(*) from desk.audit_log, day where user_id = ${userId} and action = 'opened_unit' and at >= day.start)::int as profiles,
      (select count(*) from desk.audit_log, day where user_id = ${userId} and action = 'call_sent' and at >= day.start)::int as calls`;
  return { profileCap: r.profile_cap, callCap: r.call_cap, profiles: r.profiles, calls: r.calls, copyCap: r.copy_cap, copies: r.copies };
}

// Each person's own daily call target. Never below the company target (setting daily_call_target, 50 by default).
let targetsReady = null;
export function ensureTargets() {
  targetsReady ??= (async () => {
    const [r] = await sql`select to_regclass('desk.staff_targets') is not null as ok`;
    if (r.ok) return;
    await sql`create table if not exists desk.staff_targets (
      user_id uuid primary key references desk.staff(user_id) on delete cascade,
      target int not null,
      updated_at timestamptz not null default now())`;
    await sql`alter table desk.staff_targets enable row level security`;
    await sql`revoke all on desk.staff_targets from anon, authenticated`;
  })().catch((e) => { targetsReady = null; throw e; });
  return targetsReady;
}
// WhatsApp rocket (testing): admins only, or the emails listed in the setting 'rocket_users' once that's set
export async function rocketAllowed(s) {
  if (!s) return false;
  const list = await setting('rocket_users', null);
  if (Array.isArray(list)) return list.map((e) => String(e).toLowerCase()).includes(String(s.email).toLowerCase());
  return s.role === 'admin';
}
export const baseTarget = async () => Number(await setting('daily_call_target', 50)) || 50;
// A person's goal: their own target, or the company one if theirs is lower or not set
export async function goalFor(userId) {
  await ensureTargets();
  const base = await baseTarget();
  const [t] = await sql`select target from desk.staff_targets where user_id = ${userId}`;
  return { goal: Math.max(base, t?.target || 0), base };
}

// Today's call target: calls actually dialled (the blue button tapped), the goal, and where you sit on the team
export async function callTarget(userId) {
  const { goal, base } = await goalFor(userId);
  const [r] = await sql`
    with day as (select date_trunc('day', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai' as start),
    per as (select c.user_id, count(*)::int as n from desk.calls c, day where c.called_at >= day.start group by c.user_id)
    select
      coalesce((select (value #>> '{}')::int from desk.settings where key = 'daily_call_target'), 50) as goal,
      coalesce((select n from per where user_id = ${userId}), 0) as made,
      coalesce((select sum(n) from per), 0)::int as team,
      (select count(*) from per)::int as callers,
      (1 + (select count(*) from per where n > coalesce((select n from per where user_id = ${userId}), 0)))::int as rank,
      (select value from desk.settings where key = 'call_hours') as hours`;
  // Today's race: everyone (not admins) who has made a call, plus you
  const board = await sql`
    with day as (select date_trunc('day', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai' as start)
    select st.user_id, st.full_name as name, st.team, count(c.id)::int as calls, max(c.called_at) as last_at
    from desk.staff st
    left join desk.calls c on c.user_id = st.user_id and c.called_at >= (select start from day)
    where st.active
    group by st.user_id, st.full_name, st.team
    having count(c.id) > 0 or st.user_id = ${userId}
    order by calls desc, last_at asc nulls last
    limit 12`;
  return { goal, base, made: r.made, team: r.team, callers: r.callers, rank: r.rank, hours: r.hours || { from: '09:00', to: '18:00' },
    board: board.map((b) => ({ me: b.user_id === userId, name: b.name, team: b.team, calls: b.calls })) };
}

export async function withinCallHours() {
  const hrs = await setting('call_hours', { from: '09:00', to: '18:00' });
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const now = Number(parts.find((p) => p.type === 'hour').value) * 60 + Number(parts.find((p) => p.type === 'minute').value);
  const toMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  return now >= toMin(hrs.from) && now < toMin(hrs.to);
}
