import React, { useMemo } from 'react';
import { useOps, Wait, Bar, Stats, Section, Table, Name, n0, day } from './kit.jsx';

// Promotions: where each broker is on the FY2026 framework (migration 023) and how close they are to the next level.
// Ready = GCI target hit and the window served, or 150% of the target at any time (fast-track; to Associate Director
// that also needs 5 closed deals). GCI counts from the date they reached their current level.
const k = (v) => (v >= 1e6 ? (v / 1e6).toFixed(v % 1e6 ? 2 : 0).replace(/\.?0+$/, '') + 'm' : Math.round(v / 1000) + 'k');

const CSS = `
.pr-bar{position:relative;height:8px;border-radius:4px;background:var(--hover);min-width:150px;margin-top:5px}
.pr-bar i{position:absolute;left:0;top:0;bottom:0;border-radius:4px;background:var(--accent)}
.pr-bar i.ok{background:var(--hot)}
.pr-bar b{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--ink);left:66.67%}
.pr-cap{display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted);gap:10px}
.pr-st{font-weight:600}.pr-st.ok{color:var(--hot)}.pr-st.near{color:var(--warn)}
`;

function status(r) {
  if (r.level == null) return { rank: 4, text: 'Level not set', cls: '' };
  if (r.target == null) return { rank: 5, text: 'Top level', cls: '' };
  const fast = r.gci >= r.target * 1.5 && (r.level + 1 !== 5 || r.deals >= 5);
  if (fast) return { rank: 0, text: 'Ready · fast-track', cls: 'ok' };
  if (r.gci >= r.target && r.months >= r.window) return { rank: 0, text: 'Ready', cls: 'ok' };
  if (r.gci >= r.target) return { rank: 1, text: 'Target hit · tenure done ' + day(r.window_ends), cls: 'near' };
  return { rank: 2, text: 'AED ' + n0(Math.round(r.target - r.gci)) + ' to go', cls: r.gci >= r.target * 0.75 ? 'near' : '' };
}

export default function Promotions({ api, team }) {
  const { d, err } = useOps(api, 'promotions', { team });
  const rows = useMemo(() => (d ? d.rows.map((r) => {
    const s = status(r);
    return { ...r, s, order: s.rank * 10 - (r.target ? Math.min(r.gci / r.target, 9) : 0), pct: r.target ? r.gci / r.target : null };
  }) : []), [d]);
  const ready = rows.filter((r) => r.s.rank === 0).length;
  const waiting = rows.filter((r) => r.s.rank === 1).length;
  const close = rows.filter((r) => r.s.rank === 2 && r.pct >= 0.75).length;
  return (
    <>
      <style>{CSS}</style>
      <Bar note="GCI since each person reached their current level · the line on each bar is the target, the end is fast-track (150%)" />
      {!d ? <Wait err={err} /> : <>
        <Stats items={[
          { label: 'Ready to promote', value: ready, sub: 'target and tenure, or fast-track' },
          { label: 'Target hit', value: waiting, sub: 'waiting on tenure' },
          { label: 'Over 75% of target', value: close },
          { label: 'Tracked', value: rows.length },
        ]} />
        <Section title="Progress to next level" aside="Click a column to sort">
          <Table rowKey={(r) => r.email} rows={rows} sort={{ key: 'order', dir: 'asc' }} empty="Nobody tracked on this team yet." cols={[
            { key: 'name', label: 'Broker', render: (r) => <Name main={r.name} sub={r.team || 'No team'} /> },
            { key: 'level', label: 'Now', render: (r) => <Name main={r.title || '–'} sub={'since ' + day(r.since) + ' ' + String(r.since).slice(0, 4)} /> },
            { key: 'next_title', label: 'Next', render: (r) => r.next_title || '–' },
            { key: 'gci', label: 'GCI since', num: true, render: (r) => 'AED ' + n0(Math.round(r.gci)) },
            { key: 'pct', label: 'Progress', sub: 'target · fast-track', value: (r) => r.pct ?? -1, render: (r) => (r.target ? (
              <div>
                <div className="pr-cap"><span>{Math.round(r.pct * 100)}% of {k(r.target)}</span><span>{k(r.target * 1.5)}</span></div>
                <div className="pr-bar"><i className={r.s.rank === 0 ? 'ok' : ''} style={{ width: Math.min(100, (r.gci / (r.target * 1.5)) * 100) + '%' }} /><b /></div>
              </div>) : <span className="muted">{r.note || '–'}</span>) },
            { key: 'months', label: 'Tenure', sub: 'months served', num: true, render: (r) => (r.window ? `${Math.min(r.months, r.window)} of ${r.window}` + (r.months >= r.window ? ' ✓' : '') : r.months) },
            { key: 'order', label: 'Status', render: (r) => <span className={'pr-st ' + r.s.cls}>{r.s.text}</span> },
          ]} />
        </Section>
      </>}
    </>);
}
