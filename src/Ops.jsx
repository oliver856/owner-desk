// ──────────────────────────────────────────────────────────────────
// Management: Today, Listings, Leads, People, Money.
// Lives in its own file and only loads for admins, directors and managers, so brokers never download it.
// Server side: /api/ops (api/ops.js). Data: the ops schema, filled by /api/ops-sync and the deal log.
// ──────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useState } from 'react';

const n0 = (v) => Number(v || 0).toLocaleString('en-GB');
const aed = (v) => 'AED ' + Math.round(Number(v || 0)).toLocaleString('en-GB');
const pct = (v) => (v == null ? '' : Math.round(Number(v) * 100) + '%');
const day = (v) => (v ? new Date(String(v).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const monthName = (v) => (v ? new Date(String(v).slice(0, 10) + 'T12:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : '');
const ago = (v) => {
  if (!v) return 'not yet';
  const m = Math.max(0, Math.round((Date.now() - new Date(v).getTime()) / 60000));
  return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago';
};
const CHANNEL = { bayut: 'Bayut', pf: 'Property Finder', owner_desk: 'Owner Desk', other: 'Other', unknown: 'No source' };

// Weekly KPIs by broker type. Off-plan and commercial brokers aren't judged on listings or stock.
const KPI = { apartment: { listed: 4, stock: 25 }, villa: { listed: 2, stock: 12 } };
const CALLS_A_DAY = 75;

const TABS = [['today', 'Today'], ['listings', 'Listings'], ['leads', 'Leads'], ['people', 'People'], ['money', 'Money']];

export default function Ops({ api }) {
  const [access, setAccess] = useState(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('today');
  const [team, setTeam] = useState('');
  useEffect(() => { api('/api/ops?action=access').then(setAccess).catch((e) => setErr(e.message)); }, [api]);
  if (err) return <main className="gut ops"><style>{CSS}</style><p className="err" style={{ marginTop: 30 }}>{err}</p></main>;
  if (!access) return <main className="gut ops"><style>{CSS}</style><p className="muted" style={{ padding: '40px 0' }}>Loading…</p></main>;
  const tabs = TABS.filter(([k]) => k !== 'money' || access.money);
  return (
    <main className="gut ops">
      <style>{CSS}</style>
      <div className="ops-head">
        <div className="ops-tabs" role="tablist">
          {tabs.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}
        </div>
        {access.all && tab !== 'money' && <label className="ops-team">Team
          <select value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">All teams</option>
            {access.teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select></label>}
        {!access.all && <span className="muted">{access.team}</span>}
      </div>
      {tab === 'today' && <Today api={api} team={team} showTeams={access.all && !team} />}
      {tab === 'listings' && <Listings api={api} team={team} />}
      {tab === 'leads' && <Leads api={api} team={team} />}
      {tab === 'people' && <People api={api} team={team} />}
      {tab === 'money' && access.money && <Money api={api} />}
    </main>
  );
}

// Loads one page's data, and again whenever the team or another input changes
function useOps(api, action, params) {
  const qs = useMemo(() => new URLSearchParams(Object.entries({ action, ...params }).filter(([, v]) => v)).toString(), [action, JSON.stringify(params)]);
  const [s, setS] = useState({ d: null, err: '', qs: '' });
  const load = useCallback(() => {
    let live = true;
    api('/api/ops?' + qs).then((d) => live && setS({ d, err: '', qs })).catch((e) => live && setS({ d: null, err: e.message, qs }));
    return () => { live = false; };
  }, [api, qs]);
  useEffect(load, [load]);
  return { d: s.qs === qs ? s.d : null, err: s.qs === qs ? s.err : '' };
}
const Wait = ({ err }) => (err ? <p className="err">{err}</p> : <p className="muted" style={{ padding: '30px 0' }}>Loading…</p>);
const Stat = ({ label, value, sub }) => <div className="ops-stat"><span className="muted">{label}</span><b className="n">{value}</b>{sub ? <span className="muted">{sub}</span> : null}</div>;
const Empty = ({ cols, children }) => <tr><td colSpan={cols} className="muted" style={{ padding: '18px 12px' }}>{children}</td></tr>;

function Today({ api, team, showTeams }) {
  const { d, err } = useOps(api, 'today', { team });
  if (!d) return <Wait err={err} />;
  const w = d.week, l = d.lastWeek, calls = d.calls || { today: 0, week: 0 };
  const rows = [['New listings', w.listed, l.listed], ['Listings lost', w.lost, l.lost], ['Leads from the portals', w.leads, l.leads],
    ['Viewings', w.viewings, l.viewings], ['Deals', w.deals, l.deals]];
  const feed = (k) => d.feeds.find((f) => f.feed === k);
  return (
    <>
      <div className="ops-stats">
        <Stat label={monthName(d.today) + ' billed'} value={aed(d.month.billed)} sub={n0(d.month.deals) + ' deals'} />
        <Stat label="Live listings" value={n0(d.live)} sub={d.baselined ? `${w.gained - w.lost >= 0 ? '+' : ''}${w.gained - w.lost} this week` : 'changes counted from the first sync'} />
        <Stat label="Calls today" value={n0(calls.today)} sub={n0(calls.week) + ' this week'} />
      </div>
      <h2>This week so far</h2>
      <div className="ops-tbl"><table>
        <thead><tr><th>Since Monday {day(d.weekStart)}</th><th className="r">This week</th><th className="r">Same days last week</th></tr></thead>
        <tbody>{rows.map(([label, a, b]) => <tr key={label}><td>{label}</td><td className="r n"><b>{n0(a)}</b></td><td className="r n muted">{n0(b)}</td></tr>)}</tbody>
      </table></div>
      {showTeams && <>
        <h2>{monthName(d.today)} by team</h2>
        <div className="ops-tbl"><table>
          <thead><tr><th>Team</th><th className="r">Billed</th><th className="r">Deals</th></tr></thead>
          <tbody>{d.byTeam.length ? d.byTeam.map((t) => <tr key={t.team || '-'}><td>{t.team || 'No team'}</td><td className="r n">{aed(t.billed)}</td><td className="r n">{n0(t.deals)}</td></tr>)
            : <Empty cols={3}>No deals logged yet this month.</Empty>}</tbody>
        </table></div>
      </>}
      <p className="ops-foot muted">Listings updated {ago(feed('listings')?.finished)} · leads {ago(feed('inquiries')?.finished)} · viewings {ago(feed('appointments')?.finished)} · calls and deals are live</p>
    </>
  );
}

function Listings({ api, team }) {
  const { d, err } = useOps(api, 'listings', { team });
  if (!d) return <Wait err={err} />;
  const flow = (rows, key, label) => (
    <div className="ops-tbl"><table>
      <thead><tr><th>{label}</th><th className="r">New</th><th className="r">Back on</th><th className="r">Lost</th><th className="r">Net</th></tr></thead>
      <tbody>{rows.length ? rows.map((x) => { const net = x.gained - x.lost; return (
        <tr key={x[key]}><td>{key === 'week' ? 'Week of ' + day(x.week) : monthName(x.month)}</td><td className="r n">{n0(x.new)}</td><td className="r n">{n0(x.gained - x.new)}</td>
          <td className="r n">{n0(x.lost)}</td><td className={'r n' + (net < 0 ? ' bad' : '')}><b>{net > 0 ? '+' : ''}{net}</b></td></tr>); })
        : <Empty cols={5}>Nothing recorded yet. Changes are counted from {d.since ? day(d.since) : 'the first sync'}.</Empty>}</tbody>
    </table></div>);
  return (
    <>
      <div className="ops-stats">
        <Stat label="Live listings" value={n0(d.live)} sub="published, on the market, on a portal" />
        <Stat label="For sale" value={n0(d.liveSale)} />
        <Stat label="To rent" value={n0(d.live - d.liveSale)} />
      </div>
      <div className="ops-two">
        <div><h2>Week on week</h2>{flow(d.weeks, 'week', 'Week')}</div>
        <div><h2>Month on month</h2>{flow(d.months, 'month', 'Month')}</div>
      </div>
      <div className="ops-two">
        <div><h2>Why listings were lost this month</h2>
          <div className="ops-tbl"><table><thead><tr><th>Reason</th><th className="r">Listings</th></tr></thead>
            <tbody>{d.reasons.length ? d.reasons.map((x) => <tr key={x.reason}><td>{x.reason}</td><td className="r n">{n0(x.n)}</td></tr>) : <Empty cols={2}>None lost this month.</Empty>}</tbody></table></div></div>
        <div><h2>Latest changes</h2>
          <div className="ops-tbl ops-scroll"><table><thead><tr><th>Date</th><th>Listing</th><th>Broker</th><th>What happened</th></tr></thead>
            <tbody>{d.recent.length ? d.recent.map((x, i) => <tr key={i}><td className="nw">{day(x.day)}</td><td>{x.ref}<span className="sub">{[x.beds ? x.beds + ' bed' : '', x.place].filter(Boolean).join(', ')}</span></td>
              <td>{x.broker || 'Unassigned'}</td><td className={x.event === 'off' ? 'bad' : ''}>{x.event === 'off' ? 'Lost: ' : ''}{x.reason}</td></tr>) : <Empty cols={4}>Nothing yet.</Empty>}</tbody></table></div></div>
      </div>
      <h2>By broker</h2>
      <div className="ops-tbl"><table>
        <thead><tr><th>Broker</th><th className="r">Live now</th><th className="r">Gained this week</th><th className="r">Lost this week</th><th className="r">Gained this month</th><th className="r">Lost this month</th></tr></thead>
        <tbody>{d.brokers.map((b) => <tr key={b.email || b.name}><td>{b.name || 'Unassigned'}</td><td className="r n"><b>{n0(b.live)}</b></td><td className="r n">{n0(b.gainedWeek)}</td>
          <td className={'r n' + (b.lostWeek > b.gainedWeek ? ' bad' : '')}>{n0(b.lostWeek)}</td><td className="r n">{n0(b.gainedMonth)}</td><td className={'r n' + (b.lostMonth > b.gainedMonth ? ' bad' : '')}>{n0(b.lostMonth)}</td></tr>)}</tbody>
      </table></div>
      <p className="ops-foot muted">Updated {ago(d.synced)}</p>
    </>
  );
}

function Leads({ api, team }) {
  const { d, err } = useOps(api, 'leads', { team });
  if (!d) return <Wait err={err} />;
  const ch = (k) => d.channels.find((c) => c.channel === k) || { today: 0, yesterday: 0, week: 0, month: 0 };
  const portal = ['today', 'yesterday', 'week', 'month'].reduce((o, k) => ({ ...o, [k]: ch('bayut')[k] + ch('pf')[k] }), {});
  const line = (label, c, strong) => <tr key={label}><td>{strong ? <b>{label}</b> : label}</td>{['today', 'yesterday', 'week', 'month'].map((k) => <td key={k} className="r n">{strong ? <b>{n0(c[k])}</b> : n0(c[k])}</td>)}</tr>;
  return (
    <>
      <h2>Leads received</h2>
      <div className="ops-tbl"><table>
        <thead><tr><th>Source</th><th className="r">Today</th><th className="r">Yesterday</th><th className="r">Last 7 days</th><th className="r">This month</th></tr></thead>
        <tbody>
          {line('Bayut', ch('bayut'))}{line('Property Finder', ch('pf'))}{line('Portal leads', portal, true)}
          {line('Owner Desk (sent to Kendal, counted separately)', ch('owner_desk'))}
          {d.channels.filter((c) => !['bayut', 'pf', 'owner_desk'].includes(c.channel)).map((c) => line(CHANNEL[c.channel] || c.channel, c))}
        </tbody>
      </table></div>
      <h2>By broker</h2>
      <div className="ops-tbl"><table>
        <thead><tr><th>Broker</th><th className="r">Yesterday</th><th className="r">Last 7 days</th><th className="r">This month</th><th className="r">Bayut</th><th className="r">Property Finder</th><th className="r">Owner Desk</th><th className="r">Missed calls, 7 days</th></tr></thead>
        <tbody>{d.brokers.length ? d.brokers.map((b) => <tr key={b.name}><td>{b.name}</td><td className="r n">{n0(b.yesterday)}</td><td className="r n">{n0(b.week)}</td><td className="r n"><b>{n0(b.month)}</b></td>
          <td className="r n">{n0(b.bayut)}</td><td className="r n">{n0(b.pf)}</td><td className="r n muted">{n0(b.ownerDesk)}</td><td className={'r n' + (b.missedWeek ? ' bad' : '')}>{n0(b.missedWeek)}</td></tr>)
          : <Empty cols={8}>No leads yet.</Empty>}</tbody>
      </table></div>
      <h2>Missed calls, last 7 days</h2>
      <div className="ops-tbl"><table>
        <thead><tr><th>When</th><th>Source</th><th>Broker</th><th>Listing</th></tr></thead>
        <tbody>{d.missed.length ? d.missed.map((m, i) => <tr key={i}><td className="nw">{new Date(m.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' })}</td>
          <td>{CHANNEL[m.channel] || m.channel}</td><td>{m.broker || 'Unassigned'}</td><td>{m.ref || ''}</td></tr>) : <Empty cols={4}>No missed calls.</Empty>}</tbody>
      </table></div>
      <p className="ops-foot muted">Updated {ago(d.synced)}</p>
    </>
  );
}

function People({ api, team }) {
  const [period, setPeriod] = useState('week');
  const { d, err } = useOps(api, 'people', { team, period });
  const rows = useMemo(() => {
    if (!d) return [];
    // Working days so far this week (Monday to Saturday), for the calls target
    const from = new Date(String(d.from).slice(0, 10) + 'T12:00:00'), now = new Date();
    const days = Math.min(6, Math.max(1, Math.floor((now - from) / 864e5) + 1));
    return d.rows.map((r) => {
      const k = KPI[r.type];
      const miss = d.period === 'week' ? {
        listed: !!k && r.listed < k.listed, stock: !!k && r.stock < k.stock, viewings: r.viewings === 0, calls: r.calls < CALLS_A_DAY * days,
      } : { stock: !!k && r.stock < k.stock, viewings: r.viewings === 0 };
      return { ...r, k, miss, missed: Object.values(miss).filter(Boolean).length, callTarget: CALLS_A_DAY * days };
    }).sort((a, b) => b.missed - a.missed || a.name.localeCompare(b.name));
  }, [d]);
  return (
    <>
      <div className="ops-bar">
        <h2 style={{ margin: 0 }}>{period === 'week' ? 'This week' : 'This month'}</h2>
        <div className="ops-seg">{[['week', 'This week'], ['month', 'This month']].map(([k, l]) => <button key={k} className={period === k ? 'on' : ''} onClick={() => setPeriod(k)}>{l}</button>)}</div>
      </div>
      {!d ? <Wait err={err} /> : <>
        <div className="ops-tbl"><table>
          <thead><tr><th>Broker</th><th>KPIs missed</th><th className="r">New listings{period === 'week' && <span className="sub">this week / target</span>}</th>
            <th className="r">Live stock<span className="sub">now / target</span></th><th className="r">Leads</th><th className="r">Viewings</th><th className="r">Deals</th>
            <th className="r">Calls{period === 'week' && <span className="sub">so far / target</span>}</th><th className="r">Billed<span className="sub">this month</span></th></tr></thead>
          <tbody>{rows.length ? rows.map((r) => <tr key={r.email}>
            <td><b>{r.name}</b><span className="sub">{[r.team, r.type ? r.type[0].toUpperCase() + r.type.slice(1) : ''].filter(Boolean).join(' · ')}</span></td>
            <td className={r.missed >= 3 ? 'bad' : ''}>{r.missed ? `${r.missed} missed` : 'All met'}</td>
            <td className={'r n' + (r.miss.listed ? ' bad' : '')}>{n0(r.listed)}{period === 'week' && r.k ? ' / ' + r.k.listed : ''}</td>
            <td className={'r n' + (r.miss.stock ? ' bad' : '')}>{n0(r.stock)}{r.k ? ' / ' + r.k.stock : ''}</td>
            <td className="r n">{n0(r.leads)}</td>
            <td className={'r n' + (r.miss.viewings ? ' bad' : '')}>{n0(r.viewings)}</td>
            <td className="r n">{n0(r.deals)}</td>
            <td className={'r n' + (r.miss.calls ? ' bad' : '')}>{n0(r.calls)}{period === 'week' ? ' / ' + n0(r.callTarget) : ''}</td>
            <td className="r n">{aed(r.billed)}</td></tr>) : <Empty cols={9}>Nobody on this team yet.</Empty>}</tbody>
        </table></div>
        <p className="ops-foot muted">Red means a KPI is missed. Off-plan and commercial brokers have no listing or stock target.</p>
      </>}
    </>
  );
}

function Money({ api }) {
  const [month, setMonth] = useState('');
  const { d, err } = useOps(api, 'money', { month });
  if (!d) return <Wait err={err} />;
  const cur = String(d.month).slice(0, 7);
  return (
    <>
      <h2>Month by month</h2>
      <div className="ops-tbl"><table>
        <thead><tr><th>Month</th><th className="r">Billed</th><th className="r">Deals</th><th className="r">Broker commission</th><th className="r">Retained<span className="sub">before overrides</span></th></tr></thead>
        <tbody>{d.months.map((m) => { const k = String(m.month).slice(0, 7); return (
          <tr key={k} className={k === cur ? 'sel' : ''}><td><button className="ops-link" onClick={() => setMonth(k)}>{monthName(m.month)}</button></td>
            <td className="r n"><b>{aed(m.billed)}</b></td><td className="r n">{n0(m.deals)}</td><td className="r n">{aed(m.payout)}</td><td className="r n">{aed(m.retained)}</td></tr>); })}</tbody>
      </table></div>
      <h2>{monthName(d.month)} by broker</h2>
      <div className="ops-tbl"><table>
        <thead><tr><th>Broker</th><th>Role</th><th className="r">Billed</th><th className="r">Deals</th><th className="r">Rate</th><th className="r">Commission</th><th className="r">Retained</th></tr></thead>
        <tbody>{d.brokers.length ? d.brokers.map((b) => <tr key={b.name}><td><b>{b.name}</b><span className="sub">{b.team}</span></td><td>{b.role}</td><td className="r n">{aed(b.billed)}</td><td className="r n">{n0(b.deals)}</td>
          <td className="r n">{b.rate == null ? 'Mixed' : pct(b.rate)}</td><td className="r n">{aed(b.payout)}</td><td className="r n">{aed(b.retained)}</td></tr>) : <Empty cols={7}>No deals logged for this month.</Empty>}</tbody>
      </table></div>
      <h2>{monthName(d.month)} deals</h2>
      <div className="ops-tbl"><table>
        <thead><tr><th>Date</th><th>Broker</th><th>Type</th><th>Property</th><th className="r">Commission</th></tr></thead>
        <tbody>{d.deals.length ? d.deals.map((x) => <tr key={x.id}><td className="nw">{day(x.deal_date)}</td><td>{x.name}{x.split ? <span className="sub">Split deal</span> : null}</td>
          <td>{x.type === 'sale' ? 'Sale' : x.type === 'rent' ? 'Rental' : ''}</td><td>{x.property || ''}</td><td className="r n">{aed(x.amount)}</td></tr>) : <Empty cols={5}>None.</Empty>}</tbody>
      </table></div>
      <p className="ops-foot muted">Commission uses each broker's role on the last day of the month. Overrides are not deducted yet.</p>
    </>
  );
}

const CSS = `
.ops{padding-top:18px;padding-bottom:60px;max-width:1280px;margin:0 auto}
.ops h2{font-size:14px;font-weight:650;margin:26px 0 10px}
.ops-head{display:flex;flex-wrap:wrap;align-items:center;gap:14px;margin-bottom:6px}
.ops-tabs,.ops-seg{display:flex;gap:2px;padding:3px;border-radius:10px;background:color-mix(in srgb,var(--ink) 4%,var(--bg))}
.ops-tabs button,.ops-seg button{background:none;border:none;padding:6px 14px;border-radius:7px;color:var(--muted);font:inherit;font-weight:500;cursor:pointer;white-space:nowrap}
.ops-tabs button:hover,.ops-seg button:hover{color:var(--ink)}
.ops-tabs button.on,.ops-seg button.on{background:var(--bg);color:var(--ink);box-shadow:0 1px 2px rgba(16,24,22,.08),0 0 0 1px var(--line)}
.ops-team{margin-left:auto;display:flex;align-items:center;gap:8px;color:var(--muted)}
.ops-team select{font:inherit;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:6px 8px}
.ops-bar{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:22px 0 10px}
.ops-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-top:16px}
.ops-stat{border:1px solid var(--line);border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:2px}
.ops-stat b{font-size:24px;font-weight:700;line-height:1.25}
.ops-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:0 22px}
.ops-tbl{border:1px solid var(--line);border-radius:10px;overflow-x:auto}
.ops-scroll{max-height:330px;overflow-y:auto}
.ops-tbl table{width:100%;border-collapse:collapse}
.ops-tbl th{text-align:left;font-weight:600;padding:9px 12px;background:var(--hover);border-bottom:1px solid var(--line);white-space:nowrap;vertical-align:bottom;position:sticky;top:0}
.ops-tbl td{padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}
.ops-tbl tr:last-child td{border-bottom:none}
.ops-tbl .r{text-align:right} .ops-tbl .nw{white-space:nowrap}
.ops-tbl th .sub{font-weight:400}
.ops-tbl tr.sel td{background:color-mix(in srgb,var(--accent) 7%,var(--bg))}
.ops .bad{color:var(--bad);font-weight:600}
.ops-link{background:none;border:none;padding:0;font:inherit;color:var(--accent);font-weight:600;cursor:pointer}
.ops-foot{margin-top:12px}
`;
