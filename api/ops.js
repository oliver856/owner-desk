// Management: /api/ops
//   GET  ?action=access|today|listings|leads|people|deals|money     read a page
//   POST { action: deal-add|deal-change|deal-remove|deal-restore }  change the deal log
// This file only checks who is asking and hands over to:
//   _lib/ops-access.js   who may see and do what
//   _lib/ops-pages.js    the page queries (read only)
//   _lib/ops-deals.js    the Deals page and changes to deals
// It never touches a calling table except one indexed count of today's and this week's calls.
import { sql, route, query, body } from './_lib/core.js';
import { scopeFor } from './_lib/ops-access.js';
import * as pages from './_lib/ops-pages.js';
import { dealsPage, dealsWrite, dealsVersion } from './_lib/ops-deals.js';

const cache = new Map();   // short memory so flicking between pages doesn't re-run the same query
const TTL_MS = 60e3;
async function cached(key, fn) {
  const c = cache.get(key);
  if (c && c.at > Date.now() - TTL_MS) return c.v;
  const v = await fn();
  cache.set(key, { at: Date.now(), v });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return v;
}
const dubaiMonth = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 7);
const monthOf = (q) => (/^\d{4}-\d{2}$/.test(q.get('month') || '') ? q.get('month') : dubaiMonth()) + '-01';

export const _test = { ...pages, dealsPage, dealsWrite };

export default route(async (req, res, staff) => {
  const isPost = req.method === 'POST';
  if (req.method && req.method !== 'GET' && !isPost) return res.status(405).end();
  const q = query(req);
  const sc = await scopeFor(staff, q.get('team'));
  if (!sc) return res.status(403).json({ error: 'Not allowed.' });

  if (isPost) {
    if (!sc.all) return res.status(403).json({ error: 'Not allowed.' });
    const [code, j] = await dealsWrite(sc.email, body(req));
    cache.clear();
    return res.status(code).json(j);
  }

  const action = q.get('action');
  if (action === 'access') {
    const teams = sc.all ? (await sql`select name from ops.teams where active order by sort, name`).map((t) => t.name) : [sc.team];
    return res.json({ all: sc.all, team: sc.team, teams, money: sc.all, deals: sc.all });
  }
  if (action === 'deals') {   // always fresh: this is the page deals are entered on
    if (!sc.all) return res.status(403).json({ error: 'Not allowed.' });
    return res.json(await dealsPage(monthOf(q)));
  }
  // Pages that show deal figures are remembered only until the next change to a deal
  const key = (...p) => [action, sc.team || '*', ...p].join('|');
  if (action === 'listings') return res.json(await cached(key(), () => pages.listings(sc.team)));
  if (action === 'leads') return res.json(await cached(key(), () => pages.leads(sc.team)));
  const v = await dealsVersion();
  if (action === 'today') return res.json(await cached(key(v), () => pages.today(sc.team)));
  if (action === 'people') {
    const period = q.get('period') === 'month' ? 'month' : 'week';
    return res.json(await cached(key(v, period), () => pages.people(sc.team, period)));
  }
  if (action === 'money') {
    if (!sc.all) return res.status(403).json({ error: 'Not allowed.' });
    const m = monthOf(q);
    return res.json(await cached(key(v, m), () => pages.money(m)));
  }
  res.status(400).json({ error: 'Unknown action' });
});
