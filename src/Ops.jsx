// ──────────────────────────────────────────────────────────────────
// Management. Lives in its own files and only loads for admins, directors and managers, so brokers never download it.
//
//   src/Ops.jsx          this file: who can see which page, the side menu, the team picker and the Ask box
//   src/ops/kit.jsx      the building blocks every page is made from (Bar, Stats, Section, Table, forms) and the styles
//   src/ops/rules.js     KPI targets and names, in one place
//   src/ops/<Page>.jsx   one file per page
//   api/ops.js           the server side (see the note at the top of that file)
//
// To add a page: write src/ops/<Page>.jsx from the kit, add one line to PAGES, add its query to api/_lib/ops-pages.js.
// ──────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { CSS } from './ops/kit.jsx';
import Today from './ops/Today.jsx';
import Scorecard from './ops/Scorecard.jsx';
import Meeting from './ops/Meeting.jsx';
import Listings from './ops/Listings.jsx';
import Leads from './ops/Leads.jsx';
import People from './ops/People.jsx';
import Promotions from './ops/Promotions.jsx';
import Deals from './ops/Deals.jsx';
import Money from './ops/Money.jsx';
import Ask from './ops/Ask.jsx';

// group, key, label, the page, whether it follows the team picker, and the access flag it needs (from /api/ops?action=access)
const PAGES = [
  ['This week', 'today', 'Overview', Today, true],
  ['This week', 'meeting', 'Meeting', Meeting, true],
  ['This week', 'ask', 'Ask', Ask, true],
  ['Performance', 'scorecard', 'Scorecard', Scorecard, false, 'scorecard'],
  ['Performance', 'people', 'People', People, true],
  ['Performance', 'promotions', 'Promotions', Promotions, true],
  ['Performance', 'deals', 'Deals', Deals, false, 'deals'],
  ['Performance', 'money', 'Money', Money, false, 'money'],
  ['Activity', 'listings', 'Listings', Listings, true],
  ['Activity', 'leads', 'Leads', Leads, true],
];
const remember = (k, v) => { try { if (v === undefined) return sessionStorage.getItem(k) || ''; sessionStorage.setItem(k, v); } catch { return ''; } return v; };

const SIDE_CSS = `
.ops-wrap{display:grid;grid-template-columns:200px minmax(0,1fr);gap:28px;align-items:start}
.ops-side{position:sticky;top:76px;display:flex;flex-direction:column;gap:14px}
.ops-side .ops-team select{width:100%;font:inherit;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:7px 9px}
.ops-side .ops-team span{display:block;font-size:12px;color:var(--muted);margin-bottom:4px}
.ops-menu{display:flex;flex-direction:column;gap:1px}
.ops-menu small{font-size:11.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin:10px 10px 4px}
.ops-menu small:first-child{margin-top:0}
.ops-menu button{font:inherit;text-align:left;background:none;border:none;border-radius:8px;padding:7px 10px;color:var(--ink);cursor:pointer}
.ops-menu button:hover{background:var(--hover)}
.ops-menu button.on{background:color-mix(in srgb,var(--accent) 10%,var(--bg));color:var(--accent);font-weight:600}
.ops-askbar{display:flex;gap:8px;align-items:center;border:1px solid var(--line);border-radius:10px;padding:4px 4px 4px 12px;background:var(--bg)}
.ops-askbar:focus-within{border-color:var(--accent)}
.ops-askbar input{flex:1;font:inherit;border:none;outline:none;background:none;color:var(--ink);padding:6px 0}
.ops-askbar button{font:inherit;font-weight:600;border:none;border-radius:7px;background:var(--accent);color:var(--accent-ink);padding:6px 14px;cursor:pointer}
.ops-askbar button[disabled]{opacity:.45;cursor:default}
@media (max-width:900px){
  .ops-wrap{grid-template-columns:1fr;gap:14px}
  .ops-side{position:static}
  .ops-menu{flex-direction:row;overflow-x:auto;gap:2px}
  .ops-menu small{display:none}
  .ops-menu button{white-space:nowrap}
}
@media print{.ops-side,.ops-askbar{display:none!important}.ops-wrap{display:block}}
`;

export default function Ops({ api }) {
  const [access, setAccess] = useState(null);
  const [err, setErr] = useState('');
  const [page, setPage] = useState(() => remember('ops.tab'));
  const [team, setTeam] = useState(() => remember('ops.team'));
  const [q, setQ] = useState('');
  const [pending, setPending] = useState('');
  useEffect(() => { api('/api/ops?action=access').then(setAccess).catch((e) => setErr(e.message)); }, [api]);
  useEffect(() => { remember('ops.tab', page); }, [page]);
  useEffect(() => { remember('ops.team', team); }, [team]);
  if (err || !access) return <main className="gut ops"><style>{CSS}</style><p className={(err ? 'err' : 'muted') + ' ops-wait'}>{err || 'Loading…'}</p></main>;
  const pages = PAGES.filter((p) => !p[5] || access[p[5]]);
  const [, key, , Page, byTeam] = pages.find((p) => p[1] === page) || pages[0];
  const teamNow = access.all && access.teams.includes(team) ? team : '';
  const askNow = (e) => { e.preventDefault(); if (!q.trim()) return; setPending(q.trim()); setQ(''); setPage('ask'); };
  const groups = [...new Set(pages.map((p) => p[0]))];
  return (
    <main className="gut ops">
      <style>{CSS + SIDE_CSS}</style>
      <div className="ops-wrap">
        <aside className="ops-side">
          {access.all ? <label className="ops-team"><span>Team</span>
            <select value={teamNow} onChange={(e) => setTeam(e.target.value)}><option value="">All teams</option>{access.teams.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
            : <div className="ops-team"><span>Team</span><b>{access.team}</b></div>}
          <nav className="ops-menu" aria-label="Management">
            {groups.map((g) => (
              <React.Fragment key={g}>
                <small>{g}</small>
                {pages.filter((p) => p[0] === g).map(([, k, label]) => <button key={k} className={key === k ? 'on' : ''} aria-current={key === k ? 'page' : undefined} onClick={() => setPage(k)}>{label}</button>)}
              </React.Fragment>))}
          </nav>
        </aside>
        <div>
          {key !== 'ask' && <form className="ops-askbar" onSubmit={askNow}>
            <input value={q} maxLength={600} placeholder={'Ask about the figures' + (teamNow ? ' for ' + teamNow : '') + '…'} onChange={(e) => setQ(e.target.value)} />
            <button type="submit" disabled={!q.trim()}>Ask</button>
          </form>}
          {!byTeam && teamNow && <p className="muted" style={{ margin: '12px 0 0' }}>This page always shows every team.</p>}
          <Page api={api} team={byTeam ? teamNow : ''} allTeams={access.all && !teamNow} teams={access.teams} all={access.all}
            initial={key === 'ask' ? pending : undefined} onInitialUsed={() => setPending('')} />
        </div>
      </div>
    </main>
  );
}
