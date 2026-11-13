import React from 'react';
import { useOps, Wait, Bar, Stats, Section, Table, n0, clock, ago } from './kit.jsx';
import { CHANNEL } from './rules.js';

const SPANS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'Last 7 days'], ['month', 'This month']];

export default function Leads({ api, team }) {
  const { d, err } = useOps(api, 'leads', { team });
  if (!d) return <Wait err={err} />;
  const ch = (k) => d.channels.find((c) => c.channel === k) || { today: 0, yesterday: 0, week: 0, month: 0 };
  const portal = SPANS.reduce((o, [k]) => ({ ...o, [k]: ch('bayut')[k] + ch('pf')[k] }), {});
  const sources = [
    { label: 'Bayut', ...ch('bayut') }, { label: 'Property Finder', ...ch('pf') }, { label: 'Portal leads', total: true, ...portal },
    { label: 'Owner Desk', sub: 'sent to Kendal from the Desk, counted separately', ...ch('owner_desk') },
    ...d.channels.filter((c) => !['bayut', 'pf', 'owner_desk'].includes(c.channel)).map((c) => ({ label: CHANNEL[c.channel] || c.channel, ...c })),
  ];
  return (
    <>
      <Bar note={`Leads are genuine Bayut and Property Finder enquiries, dated in Dubai time · updated ${ago(d.synced)}`} />
      <Stats items={[
        { label: 'Portal leads today', value: n0(portal.today), sub: n0(portal.yesterday) + ' yesterday' },
        { label: 'Last 7 days', value: n0(portal.week) },
        { label: 'This month', value: n0(portal.month) },
        { label: 'Missed calls, 7 days', value: n0(d.missed.length), bad: d.missed.length > 0 },
      ]} />
      <Section title="By source">
        <Table rowKey={(r) => r.label} rows={sources} cols={[
          { key: 'label', label: 'Source', render: (r) => <>{r.total ? <b>{r.label}</b> : r.label}{r.sub ? <span className="sub">{r.sub}</span> : null}</> },
          ...SPANS.map(([k, label]) => ({ key: k, label, num: true, render: (r) => (r.total ? <b>{n0(r[k])}</b> : n0(r[k])) })),
        ]} />
      </Section>
      <Section title="By broker">
        <Table rowKey={(r) => r.name} rows={d.brokers} empty="No leads yet." sort={{ key: 'month', dir: 'desc' }} cols={[
          { key: 'name', label: 'Broker' },
          { key: 'yesterday', label: 'Yesterday', num: true },
          { key: 'week', label: 'Last 7 days', num: true },
          { key: 'month', label: 'This month', num: true, strong: true },
          { key: 'bayut', label: 'Bayut', num: true },
          { key: 'pf', label: 'Property Finder', num: true },
          { key: 'ownerDesk', label: 'Owner Desk', num: true, muted: true },
          { key: 'missedWeek', label: 'Missed calls', sub: 'last 7 days', num: true, bad: (r) => r.missedWeek > 0 },
        ]} />
      </Section>
      <Section title="Missed calls, last 7 days">
        <Table scroll rows={d.missed} empty="No missed calls." cols={[
          { key: 'at', label: 'When', nowrap: true, render: (r) => clock(r.at) },
          { key: 'channel', label: 'Source', value: (r) => CHANNEL[r.channel] || r.channel },
          { key: 'broker', label: 'Broker', value: (r) => r.broker || 'Unassigned' },
          { key: 'ref', label: 'Listing' },
        ]} />
      </Section>
    </>
  );
}
