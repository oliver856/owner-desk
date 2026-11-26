import React, { useMemo, useState } from 'react';
import { useOps, Wait, Bar, Seg, n0, aed, day } from './kit.jsx';
import { KPI, CALLS_A_DAY, WORKING_DAYS } from './rules.js';

// People: each broker against their KPIs, worst first. For anyone off track: what's wrong, in plain words,
// and what to do about it. The rules for "what's wrong" and "what to do" are all in issuesFor() below.
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

// Working days (Monday to Saturday) from the start of the period up to today
function workDays(from) {
  const start = new Date(String(from).slice(0, 10) + 'T12:00:00+04:00');
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Dubai' }));
  let n = 0;
  for (const t = new Date(start); t <= today; t.setDate(t.getDate() + 1)) if (t.getDay() !== 0) n++;
  return Math.max(1, n);
}

// Each issue: [weight, what's wrong, what to do]. Weight 3 = serious, 2 = clear miss, 1 = slightly behind.
function issuesFor(r, days, month) {
  const k = KPI[r.type];
  const out = [];
  const callTarget = CALLS_A_DAY * days;
  if (r.calls === 0) out.push([3, 'No owner calls logged on the Desk', 'Check they are working and using the Desk. Put them in the next call out.']);
  else if (r.calls < callTarget * 0.5) out.push([2, `Calls well under target: ${n0(r.calls)} of ${n0(callTarget)}`, 'Book a fixed call block each morning and put them in every call out.']);
  else if (r.calls < callTarget) out.push([1, `Calls behind: ${n0(r.calls)} of ${n0(callTarget)}`, 'A push on calls to catch up before the end of the ' + (month ? 'month' : 'week') + '.']);
  if (k) {
    if (r.stock < k.stock) out.push([r.stock < k.stock * 0.5 ? 2 : 1, `Live stock ${n0(r.stock)} of ${n0(k.stock)}`,
      'Needs listings: point their calls at owners in their own areas for listing opportunities, and check for listings that have dropped off.']);
    const listTarget = Math.max(1, Math.round(k.listed * days / WORKING_DAYS));
    if (r.listed < listTarget) out.push([r.listed === 0 ? 2 : 1, r.listed === 0 ? 'No new listings ' + (month ? 'this month' : 'this week') : `New listings ${n0(r.listed)} of ${n0(listTarget)}`,
      'Agree how many listings they will bring on this week, and check which valuations they have booked.']);
  }
  if (r.viewings === 0 && r.leads >= 5) out.push([2, `${n0(r.leads)} leads but no viewings`, 'Leads are not being followed up: check how fast they reply to leads and listen to a few of their calls.']);
  else if (r.viewings === 0) out.push([1, 'No viewings, and few leads coming in', 'Check their listings are live, priced right and on both portals.']);
  if (month && r.deals === 0 && r.viewings >= 5) out.push([1, `${n0(r.viewings)} viewings, no deals yet`, 'Go on a viewing with them and go through any offers in progress.']);
  return out.sort((a, b) => b[0] - a[0]);
}

// Monthly billing target by role. Anyone who has billed their target this month is on track, whatever else is behind.
// Associate Directors have no billing target yet.
const BILLING = [[/associate\s*director/i, null], [/principal/i, 90000], [/senior/i, 60000], [/property\s*consultant/i, 30000], [/associate/i, 15000]];
const billingTarget = (role) => { const m = BILLING.find(([re]) => re.test(role || '')); return m ? m[1] : null; };

const LEVEL = [['act', 'Needs a conversation'], ['push', 'Needs a push'], ['ok', 'On track']];

export default function People({ api, team, period }) {
  const { d, err } = useOps(api, 'people', { team, period });
  const [show, setShow] = useState('attention');
  const month = period === 'month';
  const rows = useMemo(() => {
    if (!d) return [];
    const days = workDays(d.from);
    return d.rows.map((r) => {
      const target = billingTarget(r.role);
      const billedIt = target != null && Number(r.billed) >= target;
      const issues = billedIt ? [] : issuesFor(r, days, d.period === 'month');
      const score = issues.reduce((s, x) => s + x[0], 0);
      return { ...r, k: KPI[r.type], issues, score, target, billedIt, callTarget: CALLS_A_DAY * days, level: score >= 4 ? 'act' : score > 0 ? 'push' : 'ok' };
    }).sort((a, b) => b.score - a.score || a.calls - b.calls || a.name.localeCompare(b.name));
  }, [d]);
  if (!d) return <Wait err={err} />;
  const count = (l) => rows.filter((r) => r.level === l).length;   // the tag on each row says which of the two
  const shown = rows.filter((r) => show === 'all' || (show === 'attention' ? r.level !== 'ok' : r.level === 'ok'));
  return (
    <>
      <style>{PP_CSS}</style>
      <Bar note={`${month ? 'Since 1 ' + day(d.from).split(' ')[1] : 'Since Monday ' + day(d.from)} · calls target ${n0(CALLS_A_DAY)} a working day · off-plan and commercial brokers have no listing or stock target`}>
        <Seg value={show} onChange={setShow} options={[['attention', `Needs attention (${count('act') + count('push')})`], ['ok', `On track (${count('ok')})`], ['all', `Everyone (${rows.length})`]]} />
      </Bar>
      <div className="pp-list">
        {shown.length === 0 && <p className="muted ops-wait">Nobody here.</p>}
        {shown.map((r) => (
          <div key={r.email} className={'pp-row ' + r.level}>
            <div className="pp-who">
              <span className={'pp-tag ' + r.level}>{LEVEL.find((x) => x[0] === r.level)[1]}</span>
              <b>{r.name}</b>
              <span className="muted">{[r.role, r.team, cap(r.type)].filter(Boolean).join(' · ')}</span>
            </div>
            <div className="pp-why">
              {r.issues.length ? <>
                <ul>{r.issues.map((x) => <li key={x[1]} className={x[0] >= 2 ? 'bad' : ''}>{x[1]}</li>)}</ul>
                <div className="pp-do"><span className="muted">What to do</span>{[...new Set(r.issues.map((x) => x[2]))].slice(0, 2).map((t) => <p key={t}>{t}</p>)}</div>
              </> : <p className="muted">{r.billedIt ? `Billed ${aed(r.billed)} this month, over their ${aed(r.target)} target.` : `All KPIs met ${month ? 'this month' : 'this week'}.`}</p>}
            </div>
            <div className="pp-nums">
              <span><b className="n">{n0(r.calls)}</b>calls</span>
              <span><b className="n">{n0(r.listed)}</b>new listings</span>
              <span><b className="n">{r.k ? `${n0(r.stock)}/${n0(r.k.stock)}` : n0(r.stock)}</b>live stock</span>
              <span><b className="n">{n0(r.leads)}</b>leads</span>
              <span><b className="n">{n0(r.viewings)}</b>viewings</span>
              <span><b className="n">{n0(r.deals)}</b>deals</span>
              <span className="wide"><b className="n">{aed(r.billed)}{r.target ? <span className="muted" style={{ fontWeight: 400 }}> / {aed(r.target)}</span> : null}</b>billed this month{r.target ? ' / target' : ''}</span>
            </div>
          </div>))}
      </div>
    </>
  );
}

const PP_CSS = `
.pp-sum{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:14px}
.pp-sum-i{border:1px solid var(--line);border-radius:12px;padding:14px 18px;display:flex;align-items:baseline;gap:10px}
.pp-sum-i b{font-size:26px;font-weight:700}
.pp-sum-i.act b{color:var(--bad)} .pp-sum-i.push b{color:var(--warn)} .pp-sum-i.ok b{color:var(--accent)}
.pp-list{display:grid;gap:10px;margin-top:18px}
.pp-row{display:grid;grid-template-columns:minmax(180px,1fr) minmax(0,2.2fr) minmax(260px,1.3fr);gap:18px;border:1px solid var(--line);border-left:4px solid var(--line);border-radius:12px;padding:14px 18px;align-items:start}
.pp-row.act{border-left-color:var(--bad)} .pp-row.push{border-left-color:var(--warn)} .pp-row.ok{border-left-color:var(--accent)}
.pp-who{display:flex;flex-direction:column;gap:3px;min-width:0}
.pp-tag{align-self:flex-start;font-size:11.5px;font-weight:650;border-radius:99px;padding:2px 9px;margin-bottom:4px}
.pp-tag.act{background:color-mix(in srgb,var(--bad) 10%,var(--bg));color:var(--bad)}
.pp-tag.push{background:color-mix(in srgb,var(--warn) 12%,var(--bg));color:var(--warn)}
.pp-tag.ok{background:color-mix(in srgb,var(--accent) 10%,var(--bg));color:var(--accent)}
.pp-why ul{margin:0;padding-left:18px;display:grid;gap:2px}
.pp-why li.bad{color:var(--bad);font-weight:600}
.pp-why>p{margin:0}
.pp-do{margin-top:10px;padding:8px 12px;border-radius:8px;background:var(--hover);display:grid;gap:4px}
.pp-do p{margin:0}
.pp-do>span{font-size:12px}
.pp-nums{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 12px;font-size:12.5px;color:var(--muted)}
.pp-nums span{display:flex;flex-direction:column}
.pp-nums b{font-size:15px;color:var(--ink);font-weight:650}
.pp-nums .wide{grid-column:span 3}
@media (max-width:1000px){.pp-row{grid-template-columns:1fr}}
`;
