import React from 'react';
import { useOps, Wait, Bar, Stats, Section, Two, Table, Name, n0, day, clock } from './kit.jsx';

// Lead pool (admins only): % called overall and per person, who still has leads to call, and how the calls went.
// "Result" is the latest call on each lead.
const pc = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const GRP = { hot: 'Hot', objection: 'Spoke, not interested', nocontact: "Didn't get through" };

function Meter({ p }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 150 }}>
    <div className="ops-meter" style={{ flex: 1 }}><i style={{ width: Math.min(100, p) + '%' }} /></div><span className="n" style={{ width: 38, textAlign: 'right' }}>{p}%</span></div>;
}

export default function LeadPool({ api }) {
  const { d, err } = useOps(api, 'leadpool', {});
  if (!d) return <Wait err={err} />;
  const people = d.people.map((r) => ({ ...r, pct: Number(r.pct) }));
  return (
    <>
      <Bar note={`${n0(d.total)} leads in the pool · ${n0(d.today)} called today`} />
      <Stats items={[
        { label: 'Called', value: pc(d.called, d.total) + '%', sub: `${n0(d.called)} of ${n0(d.total)} · ${n0(d.total - d.called)} still to call` },
        { label: 'Hot', value: n0(d.hot), sub: pc(d.hot, d.called) + '% of those called' },
        { label: 'Spoke, not interested', value: n0(d.spoke), sub: pc(d.spoke, d.called) + '% of those called' },
        { label: "Didn't get through", value: n0(d.nocontact), sub: pc(d.nocontact, d.called) + '% of those called' },
      ]} />
      <Section title="By person" aside="Lowest % called first. Click a column to sort">
        <Table rowKey={(r) => r.name} rows={people} sort={{ key: 'pct', dir: 'asc' }} cols={[
          { key: 'name', label: 'Broker', render: (r) => <Name main={r.name} sub={r.left_desk ? 'No longer active: their leads need re-splitting' : null} />, bad: (r) => r.left_desk },
          { key: 'leads', label: 'Leads', num: true },
          { key: 'pct', label: 'Called', num: true, render: (r) => <Meter p={r.pct} />, bad: (r) => r.pct < 25 },
          { key: 'todo', label: 'Still to call', num: true, strong: true },
          { key: 'hot', label: 'Hot', num: true },
          { key: 'spoke', label: 'Spoke, no', num: true },
          { key: 'nocontact', label: "Didn't get through", num: true },
          { key: 'last_call', label: 'Last call', nowrap: true, value: (r) => r.last_call || '', render: (r) => (r.last_call ? clock(r.last_call) : <span className="muted">never</span>) },
        ]} />
      </Section>
      <Two>
        <Section title="Results" aside="Latest call on each lead">
          <Table rowKey={(r) => r.result} rows={d.results} empty="No calls yet." cols={[
            { key: 'result', label: 'Result', render: (r) => <>{r.result}<span className="sub">{GRP[r.grp] || ''}</span></> },
            { key: 'n', label: 'Leads', num: true, strong: true },
            { key: 'share', label: 'Of those called', num: true, value: (r) => r.n, render: (r) => pc(r.n, d.called) + '%' },
          ]} />
        </Section>
        <Section title="By batch">
          <Table rowKey={(r) => r.batch} rows={d.batches} cols={[
            { key: 'batch', label: 'Batch' },
            { key: 'leads', label: 'Leads', num: true },
            { key: 'called', label: 'Called', num: true, render: (r) => pc(r.called, r.leads) + '%' },
            { key: 'hot', label: 'Hot', num: true },
          ]} />
        </Section>
      </Two>
    </>
  );
}
