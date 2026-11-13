import React from 'react';
import { useOps, Wait, Bar, Stats, Section, Two, Table, n0, day, monthName, signed, ago } from './kit.jsx';

const net = (r) => r.gained - r.lost;
const flowCols = (first) => [
  first,
  { key: 'new', label: 'New', num: true },
  { key: 'back', label: 'Back on', num: true, value: (r) => r.gained - r.new },
  { key: 'lost', label: 'Lost', num: true },
  { key: 'net', label: 'Net', num: true, strong: true, value: net, render: (r) => signed(net(r)), bad: (r) => net(r) < 0 },
];

export default function Listings({ api, team }) {
  const { d, err } = useOps(api, 'listings', { team });
  if (!d) return <Wait err={err} />;
  const none = `Nothing recorded yet. Changes are counted from ${d.since ? day(d.since) : 'the first sync'}.`;
  const wk = d.weeks[0] && Date.now() - new Date(d.weeks[0].week).getTime() < 7 * 864e5 ? d.weeks[0] : null;
  return (
    <>
      <Bar note={`Live means published, on the market and on Bayut or Property Finder · updated ${ago(d.synced)}`} />
      <Stats items={[
        { label: 'Live listings', value: n0(d.live) },
        { label: 'For sale', value: n0(d.liveSale) },
        { label: 'To rent', value: n0(d.live - d.liveSale) },
        { label: 'Net this week', value: wk ? signed(net(wk)) : '0', sub: wk ? `${n0(wk.gained)} gained, ${n0(wk.lost)} lost` : 'no changes yet', bad: wk && net(wk) < 0 },
      ]} />
      <Two>
        <Section title="Week on week">
          <Table rowKey={(r) => r.week} rows={d.weeks} empty={none} cols={flowCols({ key: 'week', label: 'Week', render: (r) => 'Week of ' + day(r.week) })} />
        </Section>
        <Section title="Month on month">
          <Table rowKey={(r) => r.month} rows={d.months} empty={none} cols={flowCols({ key: 'month', label: 'Month', render: (r) => monthName(r.month) })} />
        </Section>
      </Two>
      <Section title="By broker">
        <Table rowKey={(r) => r.email || r.name} rows={d.brokers} sort={{ key: 'live', dir: 'desc' }} cols={[
          { key: 'name', label: 'Broker', value: (r) => r.name || 'Unassigned' },
          { key: 'live', label: 'Live now', num: true, strong: true },
          { key: 'gainedWeek', label: 'Gained this week', num: true },
          { key: 'lostWeek', label: 'Lost this week', num: true, bad: (r) => r.lostWeek > r.gainedWeek },
          { key: 'gainedMonth', label: 'Gained this month', num: true },
          { key: 'lostMonth', label: 'Lost this month', num: true, bad: (r) => r.lostMonth > r.gainedMonth },
        ]} />
      </Section>
      <Two>
        <Section title="Why listings were lost this month">
          <Table rowKey={(r) => r.reason} rows={d.reasons} empty="None lost this month." cols={[{ key: 'reason', label: 'Reason' }, { key: 'n', label: 'Listings', num: true }]} />
        </Section>
        <Section title="Latest changes">
          <Table scroll rows={d.recent} cols={[
            { key: 'day', label: 'Date', nowrap: true, render: (r) => day(r.day) },
            { key: 'ref', label: 'Listing', render: (r) => <>{r.ref}<span className="sub">{[r.beds ? r.beds + ' bed' : '', r.place].filter(Boolean).join(', ')}</span></> },
            { key: 'broker', label: 'Broker', value: (r) => r.broker || 'Unassigned' },
            { key: 'reason', label: 'What happened', render: (r) => (r.event === 'off' ? 'Lost: ' : '') + (r.reason || ''), bad: (r) => r.event === 'off' },
          ]} />
        </Section>
      </Two>
    </>
  );
}
