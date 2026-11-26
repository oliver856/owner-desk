import React from 'react';
import { useOps, Wait, Bar, Section, Table, n0, aed, day, monthName, signed, ago } from './kit.jsx';

// Overview: the headline numbers once each, against the same days of the week or month before,
// then the teams. Detail lives on the other pages (People, Listings, Leads, Money).
const pct = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);

function Tile({ label, value, now, before, vs, sub, money, fewerIsBetter }) {
  const p = now != null && before != null ? pct(now, before) : null;
  return (
    <div className="ov-tile">
      <span className="muted">{label}</span>
      <b className="n">{value}</b>
      <span className="ov-vs">
        {sub || (before != null && <>{p != null && p !== 0 ? <i className={(p > 0) !== !!fewerIsBetter ? 'up' : 'down'}>{p > 0 ? '▲' : '▼'} {Math.abs(p)}%</i> : null}
          <span className="muted">{money ? aed(before) : n0(before)} {vs}</span></>)}
      </span>
    </div>);
}

export default function Today({ api, team, allTeams, period }) {
  const { d, err } = useOps(api, 'today', { team, period });
  if (!d) return <Wait err={err} />;
  const now = d.figs.now, was = d.figs.before;
  const month = period === 'month';
  const vs = month ? 'same days last month' : 'same days last week';
  const feed = (k) => d.feeds.find((f) => f.feed === k)?.finished;
  const net = now.gained - now.lost;
  const q = (d.targets || []).find((t) => !t.team);
  const teamTargets = (d.targets || []).filter((t) => t.team);
  // One row per team: this period's billing, then the quarter so far against its target
  const names = [...new Set([...d.byTeam.map((t) => t.team || 'No team'), ...teamTargets.map((t) => t.team)])];
  const rows = names.map((name) => {
    const b = d.byTeam.find((t) => (t.team || 'No team') === name) || { billed: 0, deals: 0 };
    const t = teamTargets.find((x) => x.team === name);
    return { team: name, billed: Number(b.billed), deals: b.deals, qBilled: t ? Number(t.billed) : null, target: t ? Number(t.target) : null, own: t?.includesOwn };
  }).sort((a, b) => b.billed - a.billed || (b.qBilled || 0) - (a.qBilled || 0));
  const daysLeft = q ? Math.max(0, Math.round((new Date(String(q.to).slice(0, 10)) - new Date(d.today)) / 864e5)) : 0;
  const qp = q ? Math.round((q.billed / q.target) * 100) : 0;
  const periodName = month ? monthName(d.today).split(' ')[0] : 'This week';

  return (
    <>
      <style>{OV_CSS}</style>
      <Bar note={`${month ? '1 ' + monthName(d.today) : 'Monday ' + day(d.from)} to today · listings updated ${ago(feed('listings'))}, leads ${ago(feed('inquiries'))}, viewings ${ago(feed('appointments'))}`} />
      <div className="ov-grid">
        <Tile label={periodName + ' billed'} value={aed(now.billed)} now={now.billed} before={was.billed} vs={vs} money />
        <Tile label="Deals" value={n0(now.deals)} now={now.deals} before={was.deals} vs={vs} />
        <Tile label="Portal leads" value={n0(now.leads)} now={now.leads} before={was.leads} vs={vs} />
        <Tile label="Viewings" value={n0(now.viewings)} now={now.viewings} before={was.viewings} vs={vs} />
        <Tile label="Live listings" value={n0(d.live)} sub={d.baselined ? <span className="muted">{signed(net)} {month ? 'this month' : 'this week'}</span> : <span className="muted">changes counted from the first sync</span>} />
        <Tile label="New listings" value={n0(now.listed)} now={now.listed} before={was.listed} vs={vs} />
        <Tile label="Listings lost" value={n0(now.lost)} now={now.lost} before={was.lost} vs={vs} fewerIsBetter />
        <Tile label="Calls" value={n0(now.calls)} sub={<span className="muted">{n0(d.callsToday)} today · {n0(was.calls)} same days last {month ? 'month' : 'week'}</span>} />
      </div>
      {q && <div className="ov-q">
        <div className="ov-q-h"><b>Quarter target</b><span className="muted">{day(q.from)} to {day(q.to)} · {daysLeft} days left</span></div>
        <div className="ops-meter ov-q-bar"><i style={{ width: Math.min(100, qp) + '%' }} /></div>
        <div className="ov-q-h"><span><b className="n">{aed(q.billed)}</b> <span className="muted">of {aed(q.target)}</span></span><b className="n">{qp}%</b></div>
      </div>}
      {(allTeams || rows.length > 0) && <Section title="Teams" aside={`${month ? 'This month' : 'This week'}, then the quarter so far`}>
        <Table rowKey={(r) => r.team} rows={rows} empty="No deals logged yet." cols={[
          { key: 'team', label: 'Team', render: (r) => <>{r.team}{r.target != null && !r.own ? <span className="sub">quarter target doesn't count the manager's own deals</span> : null}</> },
          { key: 'billed', label: 'Billed', sub: month ? 'this month' : 'this week', num: true, strong: true, render: (r) => aed(r.billed) },
          { key: 'deals', label: 'Deals', sub: month ? 'this month' : 'this week', num: true },
          { key: 'qBilled', label: 'Quarter so far', num: true, render: (r) => (r.qBilled == null ? '' : aed(r.qBilled)) },
          { key: 'target', label: 'Quarter target', num: true, render: (r) => (r.target == null ? <span className="muted">no target</span> : aed(r.target)) },
          { key: 'pct', label: '', render: (r) => { if (!r.target) return null; const p = Math.round((r.qBilled / r.target) * 100);
            return <div className="ov-mini"><div className="ops-meter"><i style={{ width: Math.min(100, p) + '%' }} /></div><span className="n">{p}%</span></div>; } },
        ]} />
      </Section>}
    </>
  );
}

const OV_CSS = `
.ov-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-top:14px}
.ov-tile{border:1px solid var(--line);border-radius:12px;padding:16px 18px;display:flex;flex-direction:column;gap:4px;min-height:112px}
.ov-tile b{font-size:26px;font-weight:700;line-height:1.2;letter-spacing:-.01em}
.ov-vs{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline;font-size:13px;margin-top:auto}
.ov-vs i{font-style:normal;font-weight:600}
.ov-vs i.up{color:var(--accent)} .ov-vs i.down{color:var(--muted)}
.ov-q{border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-top:12px;display:grid;gap:10px}
.ov-q-h{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.ov-q-bar{height:10px}
.ov-mini{display:flex;align-items:center;gap:8px}.ov-mini .ops-meter{flex:1}.ov-mini .n{width:38px;text-align:right}
@media (max-width:1000px){.ov-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;
