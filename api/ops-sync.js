// Background sync: Kendal → the ops schema (migrations/010_ops.sql). Nothing a broker does ever waits on this.
//
// Called once a minute by the database's own scheduler (migrations/011_ops_schedule.sql). Each call does a short
// slice of work (a few pages), saves where it got to, and returns; the next call carries on. So a full pass over
// every listing is spread over several minutes and never holds a connection or a table for long.
//
//   GET /api/ops-sync                 do the next slice of whatever is due
//   GET /api/ops-sync?action=status   what is stored, when each feed last finished, and the live-listing count
//   GET /api/ops-sync?only=listings   start/continue one feed now, even if it isn't due (for testing)
//   &budget=40                        seconds of work for this call (default 8, at most 50)
//
// Protected by a key that lives only in the database (ops.settings 'sync_key'), sent as the x-ops-key header.
//
// READ ONLY on Kendal, by construction: the only requests this file can make are GETs to the four addresses in
// FEEDS below, with Apex's own API key. It cannot write to Kendal and cannot reach any other company's data.
import crypto from 'node:crypto';
import { sql, query, resetDb } from './_lib/core.js';

export const config = { maxDuration: 60 };

const HOST = process.env.KENDAL_READ_BASE || 'https://us-central1-kendal-17416.cloudfunctions.net';
const FEEDS = {
  listings: { path: '/listings/api/v1/listings', full: true },
  inquiries: { path: '/inquiries/api/v1/inquiries' },
  appointments: { path: '/appointments/api/v1/appointments' },
  deals: { path: '/deals/api/v1/deals' },
};
const ORDER = ['inquiries', 'listings', 'appointments', 'deals'];
const PAGE_LIMIT = Math.min(100, Math.max(1, Number(process.env.OPS_PAGE_LIMIT) || 25));
const PAGE_GAP_MS = Math.max(0, Number(process.env.OPS_PAGE_GAP_MS ?? 400));
const LEASE_S = 75;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kendalKey = () => process.env.KENDAL_READ_KEY || process.env.KENDAL_API_KEY || '';

class KendalError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

async function keyOk(req) {
  const got = String(req.headers['x-ops-key'] || '');
  const [r] = await sql`select value #>> '{}' as k from ops.settings where key = 'sync_key'`;
  const want = r?.k || '';
  if (want.length < 24 || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

// One page from Kendal. Retries a brief hiccup; a quota or key problem is reported, never hammered.
async function kendalPage(feed, { from, cursor }) {
  const url = new URL(HOST + FEEDS[feed].path);
  url.searchParams.set('limit', String(PAGE_LIMIT));
  if (from) url.searchParams.set('from', from);
  if (cursor) url.searchParams.set('cursor', cursor);
  let wait = 800;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    let res, text;
    try {
      res = await fetch(url, { method: 'GET', signal: ctl.signal, headers: { 'x-api-key': kendalKey() } });
      text = await res.text();
    } catch (e) {
      clearTimeout(timer);
      if (attempt < 3) { await sleep(wait); wait *= 2; continue; }
      throw new KendalError('network', `Could not reach Kendal: ${e.message}`);
    }
    clearTimeout(timer);
    const low = text.slice(0, 2000).toLowerCase();
    if (/bandwidth quota|quota exceeded|reducing the rate/.test(low)) throw new KendalError('quota', text.slice(0, 300));
    if (res.status === 401 || res.status === 403) throw new KendalError('key', `Kendal refused the API key (HTTP ${res.status})`);
    if (res.status === 429) throw new KendalError('quota', 'Kendal says too many requests (HTTP 429)');
    if (res.status >= 500 || low.includes('upstream_search_error')) {
      if (attempt < 3) { await sleep(wait); wait *= 2; continue; }
      throw new KendalError('server', `Kendal error HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    if (res.status !== 200) throw new KendalError('http', `HTTP ${res.status} from Kendal: ${text.slice(0, 200)}`);
    let body;
    try { body = JSON.parse(text); } catch { throw new KendalError('json', `Kendal sent something that isn't JSON: ${text.slice(0, 120)}`); }
    return { records: Array.isArray(body.data) ? body.data : [], next: body.page?.cursor || null,
             slow: Number(res.headers.get('x-ratelimit-remaining') ?? 999) < 10 };
  }
  throw new KendalError('server', 'Kendal did not answer');
}

async function ingest(feed, records, recordEvents) {
  if (!records.length) return 0;
  const j = sql.json(records);
  const [r] = feed === 'listings' ? await sql`select ops.ingest_listings(${j}, ${recordEvents}) as n`
    : feed === 'inquiries' ? await sql`select ops.ingest_inquiries(${j}) as n`
    : feed === 'appointments' ? await sql`select ops.ingest_appointments(${j}) as n`
    : await sql`select ops.ingest_deals(${j}) as n`;
  return r.n;
}

const log = (endpoint, status, { rows = null, pages = null, ms = null, detail = null } = {}) =>
  sql`insert into ops.sync_log (endpoint, status, rows, pages, ms, detail) values (${endpoint}, ${status}, ${rows}, ${pages}, ${ms}, ${detail})`;

// Which feed to work on: one that is part-way through first, otherwise the one that is most overdue.
async function nextFeed(only, skip) {
  const rows = await sql`
    select endpoint, every_min, overlap_min, first_from, cursor, pass_from, pass_started, pass_rows, pass_pages, last_ok, baselined,
           (pass_started is not null) as running,
           (last_ok is null or last_ok <= now() - make_interval(mins => every_min)) as due,
           (wait_until is not null and wait_until > now()) as waiting
    from ops.sync_state where endpoint <> '_lock'`;
  const usable = rows.filter((r) => FEEDS[r.endpoint] && !r.waiting && !skip.has(r.endpoint));
  if (only) return usable.find((r) => r.endpoint === only) || null;
  const rank = (r) => ORDER.indexOf(r.endpoint);
  return usable.filter((r) => r.running).sort((a, b) => rank(a) - rank(b))[0]
    || usable.filter((r) => r.due).sort((a, b) => rank(a) - rank(b))[0] || null;
}

// Works on one feed until it finishes or the time for this call runs out.
async function runFeed(st, deadline) {
  const feed = st.endpoint, t0 = Date.now();
  if (!st.running) {
    const from = FEEDS[feed].full ? null
      : st.last_ok ? new Date(new Date(st.last_ok).getTime() - st.overlap_min * 60000) : st.first_from;
    const [s] = await sql`update ops.sync_state set pass_started = now(), pass_from = ${from}, cursor = null, pass_rows = 0,
                            pass_pages = 0, status = 'running', error = null where endpoint = ${feed}
                          returning pass_started, pass_from`;
    Object.assign(st, { pass_started: s.pass_started, pass_from: s.pass_from, cursor: null, pass_rows: 0, pass_pages: 0 });
  }
  const from = st.pass_from ? new Date(st.pass_from).toISOString() : null;
  let cursor = st.cursor, rows = 0, pages = 0;
  while (Date.now() < deadline) {
    const page = await kendalPage(feed, { from, cursor });
    rows += await ingest(feed, page.records, st.baselined);
    pages++;
    cursor = page.next;
    await sql`update ops.sync_state set cursor = ${cursor}, pass_rows = pass_rows + ${page.records.length},
                pass_pages = pass_pages + 1 where endpoint = ${feed}`;
    if (!cursor) {
      const [tot] = await sql`select pass_rows, pass_pages from ops.sync_state where endpoint = ${feed}`;
      let detail = null;
      if (feed === 'listings') {
        const [f] = await sql`select ops.finish_listings_pass(${st.pass_started}, ${tot.pass_rows}, ${st.baselined}) as r`;
        detail = JSON.stringify(f.r);
      }
      await sql`update ops.sync_state set last_ok = pass_started, last_finished = now(), last_rows = pass_rows,
                  pass_started = null, pass_from = null, cursor = null, status = 'ok', error = null,
                  baselined = true where endpoint = ${feed}`;
      await log(feed, 'done', { rows: tot.pass_rows, pages: tot.pass_pages, ms: Date.now() - t0, detail });
      return { feed, done: true, rows, pages };
    }
    await sleep(page.slow ? 3000 : PAGE_GAP_MS);
  }
  return { feed, done: false, rows, pages };
}

async function status() {
  // One at a time: several queries at once can queue up inside the pooler and hang.
  const feeds = await sql`select endpoint, every_min, status, error, last_ok, last_finished, last_rows, baselined, wait_until,
               (pass_started is not null) as running, pass_rows, pass_pages
        from ops.sync_state where endpoint <> '_lock' order by endpoint`;
  const [c] = await sql`select (select count(*) from ops.kendal_listings)::int as listings,
               (select count(*) from ops.kendal_listings where is_live)::int as live,
               (select count(*) from ops.kendal_listings where gone_at is not null)::int as gone,
               (select count(*) from ops.kendal_inquiries)::int as inquiries,
               (select count(*) from ops.kendal_deals)::int as deals,
               (select count(*) from ops.kendal_appointments)::int as appointments`;
  const flow = await sql`select date_trunc('week', day)::date::text as week, sum(gained)::int as gained, sum(lost)::int as lost, sum(net)::int as net
        from ops.v_listing_flow_daily where day >= current_date - 35 group by 1 order by 1 desc`;
  const leads = await sql`select channel, count(*)::int as leads from ops.kendal_inquiries
        where is_genuine and lead_day >= date_trunc('month', ops.dubai_day(now()))::date group by 1 order by 2 desc`;
  const recent = await sql`select at, endpoint, status, rows, pages, ms, detail from ops.sync_log order by at desc limit 12`;
  return { now: new Date().toISOString(), kendalKeySet: !!kendalKey(), counts: c, feeds,
           listingFlowByWeek: flow, leadsThisMonthByChannel: leads, recent };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method && req.method !== 'GET') return res.status(405).end();
    // This runs once a minute, so the server copy has usually been frozen in between and its old database
    // connections are dead. Always start on fresh ones (same reason as the idle reset in core.js).
    resetDb();
    if (!(await keyOk(req))) return res.status(401).json({ error: 'Wrong or missing key' });
    const q = query(req);
    if (q.get('action') === 'status') return res.status(200).json(await status());
    if (!kendalKey()) return res.status(200).json({ ok: false, error: 'No Kendal API key set in Vercel (KENDAL_READ_KEY or KENDAL_API_KEY)' });

    const budget = Math.min(50, Math.max(3, Number(q.get('budget')) || 8));
    const deadline = Date.now() + budget * 1000;
    const only = FEEDS[q.get('only')] ? q.get('only') : null;

    // One sync at a time. The lease runs out by itself, so a crashed call can never block the next one for long.
    const [lease] = await sql`update ops.sync_state set lease_until = now() + make_interval(secs => ${Math.max(LEASE_S, budget + 15)})
                              where endpoint = '_lock' and (lease_until is null or lease_until < now()) returning 1 as ok`;
    if (!lease) return res.status(200).json({ ok: true, skipped: 'another sync is still running' });

    const did = [], skip = new Set();
    try {
      while (Date.now() < deadline - 1500) {
        const st = await nextFeed(only, skip);
        if (!st) break;
        try {
          const r = await runFeed(st, deadline);
          did.push(r);
          if (!r.done || only) break;
        } catch (e) {
          const quota = e instanceof KendalError && e.kind === 'quota';
          // A quota stop keeps its place and carries on later. Anything else starts that feed's pass again from the
          // top next time, so a cursor Kendal no longer recognises can never leave a pass stuck half-way.
          if (quota) {
            await sql`update ops.sync_state set status = 'error', error = ${String(e.message).slice(0, 500)},
                        wait_until = now() + interval '20 minutes' where endpoint = ${st.endpoint}`;
          } else {
            await sql`update ops.sync_state set status = 'error', error = ${String(e.message).slice(0, 500)},
                        wait_until = now() + interval '3 minutes', pass_started = null, pass_from = null, cursor = null
                      where endpoint = ${st.endpoint}`;
          }
          await log(st.endpoint, quota ? 'quota' : 'error', { detail: String(e.message).slice(0, 500) });
          did.push({ feed: st.endpoint, error: String(e.message).slice(0, 200) });
          skip.add(st.endpoint);
          if (e instanceof KendalError && e.kind !== 'server' && e.kind !== 'json') break;   // key, quota, network: stop for now
        }
      }
    } finally {
      await sql`update ops.sync_state set lease_until = null where endpoint = '_lock'`;
    }
    res.status(200).json({ ok: true, did });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.status(500).json({ error: 'Sync failed', detail: String(e.message).slice(0, 300) });
  }
}
