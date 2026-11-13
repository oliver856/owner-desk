import React from 'react';
import { useOps, Wait, Bar, Stats, Section, Two, Table, n0, aed, day, longDay, monthName, signed, ago } from './kit.jsx';

export default function Today({ api, team, allTeams }) {
  const { d, err } = useOps(api, 'today', { team });
  if (!d) return <Wait err={err} />;
  const w = d.week, l = d.lastWeek, calls = d.calls || { today: 0, week: 0 };
  const feed = (k) => d.feeds.find((f) => f.feed === k)?.finished;
  const net = w.gained - w.lost;
  const week = [['New listings', w.listed, l.listed], ['Listings lost', w.lost, l.lost], ['Leads from the portals', w.leads, l.leads],
    ['Viewings', w.viewings, l.viewings], ['Deals', w.deals, l.deals]].map(([label, now, before]) => ({ label, now, before }));
  const month = monthName(d.today).split(' ')[0];
  return (
    <>
      <Bar note={`${longDay(d.today)} · listings updated ${ago(feed('listings'))}, leads ${ago(feed('inquiries'))}, viewings ${ago(feed('appointments'))}`} />
      <Stats items={[
        { label: month + ' billed', value: aed(d.month.billed), sub: n0(d.month.deals) + ' deals' },
        { label: 'Live listings', value: n0(d.live), sub: d.baselined ? signed(net) + ' this week' : 'changes counted from the first sync' },
        { label: 'Portal leads this week', value: n0(w.leads), sub: n0(l.leads) + ' by this day last week' },
        { label: 'Calls today', value: n0(calls.today), sub: n0(calls.week) + ' this week' },
      ]} />
      <Section title="This week so far" aside={'Since Monday ' + day(d.weekStart)}>
        <Table rowKey={(r) => r.label} rows={week} cols={[
          { key: 'label', label: '' },
          { key: 'now', label: 'This week', num: true, strong: true },
          { key: 'before', label: 'Same days last week', num: true, muted: true },
        ]} />
      </Section>
      <Two>
        {allTeams && <Section title={month + ' by team'}>
          <Table rowKey={(r) => r.team || '-'} rows={d.byTeam} empty="No deals logged yet this month." cols={[
            { key: 'team', label: 'Team', value: (r) => r.team || 'No team' },
            { key: 'billed', label: 'Billed', num: true, render: (r) => aed(r.billed) },
            { key: 'deals', label: 'Deals', num: true },
          ]} />
        </Section>}
        {(d.targets || []).length > 0 && <Section title="Quarter targets" aside={`${day(d.targets[0].from)} to ${day(d.targets[0].to)}`}>
          <Table rowKey={(r) => r.team || 'company'} rows={d.targets} cols={[
            { key: 'team', label: 'Target', render: (r) => <>{r.team || 'Whole company'}{r.includesOwn ? null : <span className="sub">not counting the manager's own deals</span>}</> },
            { key: 'billed', label: 'Billed', num: true, render: (r) => aed(r.billed) },
            { key: 'target', label: 'Target', num: true, render: (r) => aed(r.target) },
            { key: 'pct', label: '', render: (r) => { const p = Math.min(100, Math.round((r.billed / r.target) * 100)); return <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><div className="ops-meter" style={{ flex: 1 }}><i style={{ width: p + '%' }} /></div><span className="n" style={{ width: 34, textAlign: 'right' }}>{Math.round((r.billed / r.target) * 100)}%</span></div>; } },
          ]} />
        </Section>}
      </Two>
    </>
  );
}
