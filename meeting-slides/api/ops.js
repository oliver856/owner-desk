// Management: /api/ops
//   GET  ?action=access|today|listings|leads|people|deals|money     read a page
//   POST { action: deal-add|deal-change|deal-remove|deal-restore }  change the deal log
//   POST { action: ask, question } / { action: report, week: last|this }  and  GET ?action=ask              the Ask page (see _lib/ask.js)
//   GET  ?action=scorecard[&month=]  POST { action: plan-set }                 the scorecard (see _lib/scorecard.js)
//   GET  ?action=meeting[&week=] | report&id=   POST { action: pipeline-*|action-* }   the meeting page (see _lib/meeting.js)
//   POST { action: deal-offplan, id, on }                                     tick a deal as off-plan
//   GET  ?action=slides                                                       the Friday meeting slides (see _lib/slides.js)
// This file only checks who is asking and hands over to:
//   _lib/ops-access.js   who may see and do what
//   _lib/ops-pages.js    the page queries (read only)
//   _lib/ops-deals.js    the Deals page and changes to deals
// It never touches a calling table except one indexed count of today's and this week's calls.
import { sql, route, query, body } from './_lib/core.js';
import { scopeFor } from './_lib/ops-access.js';
import * as pages from './_lib/ops-pages.js';
import { dealsPage, dealsWrite, dealsVersion } from './_lib/ops-deals.js';
import { ask, askPage, report } from './_lib/ask.js';
import { scorecard, setPlan } from './_lib/scorecard.js';
import { meetingPage, meetingWrite, reportText } from './_lib/meeting.js';
import { slides } from './_lib/slides.js';

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
    const b = body(req);
    if (b.action === 'ask') {   // managers too: the answer only ever uses their own team's figures
      const [code, j] = await ask(staff, sc, b.question);
      return res.status(code).json(j);
    }
    if (b.action === 'report') {   // the weekly management report, for the team they can see
      const [code, j] = await report(staff, sc, b.week === 'this' ? 'this' : 'last');
      return res.status(code).json(j);
    }
    const m = await meetingWrite(staff, sc, b);   // pipeline posts and actions: managers too
    if (m) return res.status(m[0]).json(m[1]);
    if (!sc.all) return res.status(403).json({ error: 'Not allowed.' });
    if (b.action === 'plan-set') { const [code, j] = await setPlan(sc.email, String(b.measure || ''), String(b.month || ''), b.plan); cache.clear(); return res.status(code).json(j); }
    if (b.action === 'deal-offplan') {
      try { const [r] = await sql`select ops.deal_set_offplan(${sc.email}, ${Number(b.id) || 0}, ${!!b.on}) as j`; cache.clear(); return res.json(r.j); }
      catch (e) { if (e?.code === 'P0001') return res.status(400).json({ error: e.message }); throw e; }
    }
    const [code, j] = await dealsWrite(sc.email, b);
    cache.clear();
    return res.status(code).json(j);
  }

  const action = q.get('action');
  if (action === 'access') {
    const teams = sc.all ? (await sql`select name from ops.teams where active order by sort, name`).map((t) => t.name) : [sc.team];
    return res.json({ all: sc.all, team: sc.team, teams, money: sc.all, deals: sc.all, scorecard: sc.all });
  }
  if (action === 'ask') return res.json(await askPage(staff, sc));
  if (action === 'meeting') return res.json(await meetingPage(staff, sc, q.get('week')));
  if (action === 'slides') return res.json(await slides(sc));
  if (action === 'report') { const r = await reportText(sc, q.get('id')); return r ? res.json(r) : res.status(404).json({ error: 'That report is no longer there.' }); }
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
  if (action === 'scorecard') {
    if (!sc.all) return res.status(403).json({ error: 'Not allowed.' });
    const m = /^\d{4}-\d{2}$/.test(q.get('month') || '') ? q.get('month') + '-01' : null;
    return res.json(await cached(key(v, m || 'now'), () => scorecard(m)));
  }
  if (action === 'money') {
    if (!sc.all) return res.status(403).json({ error: 'Not allowed.' });
    const m = monthOf(q);
    return res.json(await cached(key(v, m), () => pages.money(m)));
  }
  res.status(400).json({ error: 'Unknown action' });
}, { limitMs: (req) => (req.method === 'POST' ? 170000 : 12000) });   // a question to Claude can take a minute, a weekly report up to three
