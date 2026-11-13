import React, { useMemo, useState } from 'react';
import { useOps, Wait, Bar, Seg, Section, Table, Name, n0, aed, day } from './kit.jsx';
import { KPI, CALLS_A_DAY, WORKING_DAYS } from './rules.js';

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

export default function People({ api, team }) {
  const [period, setPeriod] = useState('week');
  const { d, err } = useOps(api, 'people', { team, period });
  const week = period === 'week';
  const rows = useMemo(() => {
    if (!d) return [];
    // Working days so far this week, for the calls target
    const days = Math.min(WORKING_DAYS, Math.max(1, Math.floor((Date.now() - new Date(String(d.from).slice(0, 10) + 'T00:00:00+04:00').getTime()) / 864e5) + 1));
    return d.rows.map((r) => {
      const k = KPI[r.type];
      const miss = { stock: !!k && r.stock < k.stock, viewings: r.viewings === 0 };
      if (d.period === 'week') { miss.listed = !!k && r.listed < k.listed; miss.calls = r.calls < CALLS_A_DAY * days; }
      return { ...r, k, miss, missed: Object.values(miss).filter(Boolean).length, callTarget: CALLS_A_DAY * days };
    });
  }, [d]);
  const of = (v, target) => n0(v) + (target != null ? ' / ' + n0(target) : '');
  return (
    <>
      <Bar note={d ? `${week ? 'Since Monday ' + day(d.from) : 'Since ' + day(d.from)} · red is a missed KPI` : ''}>
        <Seg value={period} onChange={setPeriod} options={[['week', 'This week'], ['month', 'This month']]} />
      </Bar>
      {!d ? <Wait err={err} /> : <Section title={`${rows.length} ${rows.length === 1 ? 'person' : 'people'}`} aside="Off-plan and commercial brokers have no listing or stock target">
        <Table rowKey={(r) => r.email} rows={rows} empty="Nobody on this team yet." sort={{ key: 'missed', dir: 'desc' }} cols={[
          { key: 'name', label: 'Broker', render: (r) => <Name main={r.name} sub={[r.team, cap(r.type)].filter(Boolean).join(' · ')} /> },
          { key: 'missed', label: 'KPIs missed', num: true, render: (r) => (r.missed ? r.missed + ' missed' : 'All met'), bad: (r) => r.missed >= 3 },
          { key: 'listed', label: 'New listings', sub: week ? 'so far / target' : '', num: true, render: (r) => of(r.listed, week && r.k ? r.k.listed : null), bad: (r) => r.miss.listed },
          { key: 'stock', label: 'Live stock', sub: 'now / target', num: true, render: (r) => of(r.stock, r.k ? r.k.stock : null), bad: (r) => r.miss.stock },
          { key: 'leads', label: 'Leads', num: true },
          { key: 'viewings', label: 'Viewings', num: true, bad: (r) => r.miss.viewings },
          { key: 'deals', label: 'Deals', num: true },
          { key: 'calls', label: 'Calls', sub: week ? 'so far / target' : '', num: true, render: (r) => of(r.calls, week ? r.callTarget : null), bad: (r) => r.miss.calls },
          { key: 'billed', label: 'Billed', sub: 'this month', num: true, render: (r) => aed(r.billed) },
        ]} />
      </Section>}
    </>
  );
}
