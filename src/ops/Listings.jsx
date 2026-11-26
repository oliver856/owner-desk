import React from 'react';
import { useOps, Wait, Bar, Stats, Section, Two, Table, n0, day, monthName, signed, ago } from './kit.jsx';

// Listings: live stock now, what came on and off this week or month (and why), by broker, and the history.
const net = (r) => r.gained - r.lost;

export default function Listings({ api, team, period }) {
  const { d, err } = useOps(api, 'listings', { team, period });
  if (!d) return <Wait err={err} />;
  const month = period === 'month';
  const span = month ? 'this month' : 'this week';
  const none = `Nothing recorded yet. Changes are counted from ${d.since ? day(d.since) : 'the first sync'}.`;
  const cur = d.history.find((h) => String(h.start).slice(0, 10) === String(d.from).slice(0, 10)) || { gained: 0, new: 0, lost: 0 };
  return (
    <>
      <Bar note={`Live means published, on the market and on Bayut or Property Finder · updated ${ago(d.synced)}`} />
      <Stats items={[
        { label: 'Live now', value: n0(d.live), sub: `${n0(d.liveSale)} for sale · ${n0(d.live - d.liveSale)} to rent` },
        { label: 'Came on ' + span, value: n0(cur.gained), sub: `${n0(cur.new)} new · ${n0(cur.gained - cur.new)} back on` },
        { label: 'Came off ' + span, value: n0(cur.lost) },
        { label: 'Net ' + span, value: signed(net(cur)), bad: net(cur) < 0 },
      ]} />
      <Section title="By broker" aside={'Live now, and what changed ' + span}>
        <Table rowKey={(r) => r.email || r.name} rows={d.brokers} sort={{ key: 'live', dir: 'desc' }} cols={[
          { key: 'name', label: 'Broker', value: (r) => r.name || 'Unassigned' },
          { key: 'live', label: 'Live now', num: true, strong: true },
          { key: 'gained', label: 'Came on', num: true },
          { key: 'lost', label: 'Came off', num: true },
          { key: 'net', label: 'Net', num: true, value: net, render: (r) => signed(net(r)), bad: (r) => net(r) < 0 },
        ]} />
      </Section>
      <Two>
        <Section title={'Why listings came off ' + span}>
          <Table rowKey={(r) => r.reason} rows={d.reasons} empty={'None came off ' + span + '.'} cols={[{ key: 'reason', label: 'Reason' }, { key: 'n', label: 'Listings', num: true }]} />
        </Section>
        <Section title={month ? 'Earlier months' : 'Earlier weeks'}>
          <Table rowKey={(r) => r.start} rows={d.history.filter((h) => h !== cur)} empty={none} cols={[
            { key: 'start', label: month ? 'Month' : 'Week', render: (r) => (month ? monthName(r.start) : 'Week of ' + day(r.start)) },
            { key: 'gained', label: 'Came on', num: true },
            { key: 'lost', label: 'Came off', num: true },
            { key: 'net', label: 'Net', num: true, strong: true, value: net, render: (r) => signed(net(r)), bad: (r) => net(r) < 0 },
          ]} />
        </Section>
      </Two>
      <Section title={'Every change ' + span} aside="Newest first">
        <Table scroll rows={d.recent} empty={'No changes ' + span + '.'} cols={[
          { key: 'day', label: 'Date', nowrap: true, render: (r) => day(r.day) },
          { key: 'ref', label: 'Listing', render: (r) => <>{r.ref}<span className="sub">{[r.beds ? r.beds + ' bed' : '', r.place].filter(Boolean).join(', ')}</span></> },
          { key: 'broker', label: 'Broker', value: (r) => r.broker || 'Unassigned' },
          { key: 'reason', label: 'What happened', render: (r) => (r.event === 'off' ? 'Came off: ' : '') + (r.reason || ''), bad: (r) => r.event === 'off' },
        ]} />
      </Section>
    </>
  );
}
