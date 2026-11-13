// ──────────────────────────────────────────────────────────────────
// Management. Lives in its own files and only loads for admins, directors and managers, so brokers never download it.
//
//   src/Ops.jsx          this file: who can see which tab, the tabs, the team picker
//   src/ops/kit.jsx      the building blocks every page is made from (Bar, Stats, Section, Table, forms) and the styles
//   src/ops/rules.js     KPI targets and names, in one place
//   src/ops/<Page>.jsx   one file per tab
//   api/ops.js           the server side (see the note at the top of that file)
//
// To add a page: write src/ops/<Page>.jsx from the kit, add one line to TABS, add its query to api/_lib/ops-pages.js.
// ──────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { CSS, Pick } from './ops/kit.jsx';
import Today from './ops/Today.jsx';
import Listings from './ops/Listings.jsx';
import Leads from './ops/Leads.jsx';
import People from './ops/People.jsx';
import Deals from './ops/Deals.jsx';
import Money from './ops/Money.jsx';

// key, label, the page, whether it follows the team picker, and the access flag it needs (from /api/ops?action=access)
const TABS = [
  ['today', 'Today', Today, true],
  ['listings', 'Listings', Listings, true],
  ['leads', 'Leads', Leads, true],
  ['people', 'People', People, true],
  ['deals', 'Deals', Deals, false, 'deals'],
  ['money', 'Money', Money, false, 'money'],
];
const remembered = () => { try { return sessionStorage.getItem('ops.tab') || ''; } catch { return ''; } };

export default function Ops({ api }) {
  const [access, setAccess] = useState(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState(remembered);
  const [team, setTeam] = useState('');
  useEffect(() => { api('/api/ops?action=access').then(setAccess).catch((e) => setErr(e.message)); }, [api]);
  useEffect(() => { try { sessionStorage.setItem('ops.tab', tab); } catch { /* private window: just don't remember */ } }, [tab]);
  if (err || !access) return <main className="gut ops"><style>{CSS}</style><p className={(err ? 'err' : 'muted') + ' ops-wait'}>{err || 'Loading…'}</p></main>;
  const tabs = TABS.filter((t) => !t[4] || access[t[4]]);
  const [key, , Page, byTeam] = tabs.find((t) => t[0] === tab) || tabs[0];
  return (
    <main className="gut ops">
      <style>{CSS}</style>
      <div className="ops-head">
        <div className="ops-tabs" role="tablist">
          {tabs.map(([k, label]) => <button key={k} role="tab" aria-selected={key === k} className={key === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}
        </div>
        {access.all ? (byTeam ? <Pick label="Team" value={team} onChange={setTeam} options={access.teams} all="All teams" /> : null) : <span className="muted">{access.team}</span>}
      </div>
      <Page api={api} team={byTeam ? team : ''} allTeams={access.all && !team} />
    </main>
  );
}
