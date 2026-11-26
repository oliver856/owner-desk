import React from 'react';
import { useOps, Wait, Bar, Stats, Section, Two, Table, n0, clock, ago, day, monthName } from './kit.jsx';
import { CHANNEL } from './rules.js';

// Leads: portal enquiries this week or month by source and by broker, and the calls that were missed.
export default function Leads({ api, team, period }) {
  const { d, err } = useOps(api, 'leads', { team, period });
  if (!d) return <Wait err={err} />;
  const month = period === 'month';
  const span = month ? 'this month' : 'this week';
  const vs = month ? 'same days last month' : 'same days last week';
  const ch = (k) => d.channels.find((c) => c.channel === k) || { now: 0, before: 0, today: 0 };
  const portal = ['now', 'before', 'today'].reduce((o, k) => ({ ...o, [k]: ch('bayut')[k] + ch('pf')[k] }), {});
  const missed = d.brokers.reduce((t, r) => t + Number(r.missed || 0), 0);
  const sources = [
    { label: 'Bayut', ...ch('bayut') }, { label: 'Property Finder', ...ch('pf') },
    { label: 'Owner Desk', sub: 'sent to Kendal from the Desk, not counted as portal leads', ...ch('owner_desk') },
    ...d.channels.filter((c) => !['bayut', 'pf', 'owner_desk'].includes(c.channel)).map((c) => ({ label: CHANNEL[c.channel] || c.channel, ...c })),
  ];
  return (
    <>
      <Bar note={`${month ? '1 ' + monthName(d.today) : 'Monday ' + day(d.from)} to today · genuine Bayut and Property Finder enquiries, in Dubai time · updated ${ago(d.synced)}`} />
      <Stats items={[
        { label: 'Portal leads ' + span, value: n0(portal.now), sub: n0(portal.before) + ' ' + vs },
        { label: 'Portal leads today', value: n0(portal.today) },
        { label: 'Missed calls ' + span, value: n0(missed), bad: missed > 0 },
      ]} />
      <Section title="By broker" aside={'Portal leads ' + span}>
        <Table rowKey={(r) => r.name} rows={d.brokers} empty={'No leads ' + span + '.'} sort={{ key: 'portal', dir: 'desc' }} cols={[
          { key: 'name', label: 'Broker' },
          { key: 'portal', label: 'Portal leads', num: true, strong: true },
          { key: 'bayut', label: 'Bayut', num: true },
          { key: 'pf', label: 'Property Finder', num: true },
          { key: 'ownerDesk', label: 'Owner Desk', num: true, muted: true },
          { key: 'missed', label: 'Missed calls', num: true, bad: (r) => r.missed > 0 },
        ]} />
      </Section>
      <Two>
        <Section title="By source">
          <Table rowKey={(r) => r.label} rows={sources} cols={[
            { key: 'label', label: 'Source', render: (r) => <>{r.label}{r.sub ? <span className="sub">{r.sub}</span> : null}</> },
            { key: 'now', label: month ? 'This month' : 'This week', num: true, strong: true },
            { key: 'before', label: vs[0].toUpperCase() + vs.slice(1), num: true, muted: true },
          ]} />
        </Section>
        <Section title={'Missed calls ' + span}>
          <Table scroll rows={d.missed} empty="No missed calls." cols={[
            { key: 'at', label: 'When', nowrap: true, render: (r) => clock(r.at) },
            { key: 'channel', label: 'Source', value: (r) => CHANNEL[r.channel] || r.channel },
            { key: 'broker', label: 'Broker', value: (r) => r.broker || 'Unassigned' },
            { key: 'ref', label: 'Listing' },
          ]} />
        </Section>
      </Two>
    </>
  );
}
