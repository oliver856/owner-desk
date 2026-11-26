import React, { useState } from 'react';
import { useOps, Wait, Bar, Section, Table, Name, LinkBtn, n0, aed, monthName, monthKey } from './kit.jsx';

export default function Money({ api }) {
  const [month, setMonth] = useState('');
  const { d, err } = useOps(api, 'money', { month });
  if (!d) return <Wait err={err} />;
  const cur = monthKey(d.month);
  const m = d.months.find((x) => monthKey(x.month) === cur) || { billed: 0, deals: 0 };
  return (
    <>
      <Bar note="Billed is commission due to the company, excluding VAT, by close date" />
      <Section title="Month by month" aside="Click a month to see it by broker">
        <Table rowKey={(r) => r.month} rows={d.months} selected={(r) => monthKey(r.month) === cur} cols={[
          { key: 'month', label: 'Month', render: (r) => <LinkBtn onClick={() => setMonth(monthKey(r.month))}>{monthName(r.month)}</LinkBtn> },
          { key: 'billed', label: 'Billed', num: true, strong: true, render: (r) => aed(r.billed) },
          { key: 'deals', label: 'Deals', num: true },
          { key: 'avg', label: 'Average per deal', num: true, render: (r) => aed(r.deals ? r.billed / r.deals : 0) },
        ]} />
      </Section>
      <Section title={monthName(d.month) + ' by broker'}>
        <Table rowKey={(r) => r.email} rows={d.brokers} empty="No deals logged for this month." sort={{ key: 'billed', dir: 'desc' }} cols={[
          { key: 'name', label: 'Broker', render: (r) => <Name main={r.name} sub={r.team} /> },
          { key: 'role', label: 'Role' },
          { key: 'billed', label: 'Billed', num: true, render: (r) => aed(r.billed) },
          { key: 'deals', label: 'Deals', num: true },
          { key: 'share', label: 'Share of month', num: true, value: (r) => r.billed, render: (r) => (m.billed > 0 ? Math.round((r.billed / m.billed) * 100) + '%' : '') },
        ]} />
      </Section>
    </>
  );
}
