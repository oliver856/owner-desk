// The deal log: add a deal, see the month, fix or remove one, and see who changed what.
// Every rule is enforced by the database (migrations/015_deal_entry.sql); this page only collects the values.
import React, { useMemo, useState } from 'react';
import { useOps, Wait, Bar, Stats, Section, Table, Name, Pick, Seg, Field, Btn, LinkBtn, Dialog, n0, aed, day, clock, monthName, monthKey } from './kit.jsx';
import { DEAL_TYPE } from './rules.js';

const TYPES = [['sale', 'Sale'], ['rent', 'Rental']];
const toNum = (v) => Number(String(v || '').replace(/[,\s]/g, ''));
const first = (name) => String(name || '').split(' ')[0];

function BrokerSelect({ people, value, onChange, none, skip }) {
  const list = people.filter((p) => p.email !== skip);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{none}</option>
      {list.filter((p) => p.active).map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}
      <optgroup label="Former brokers">{list.filter((p) => !p.active).map((p) => <option key={p.email} value={p.email}>{p.name}</option>)}</optgroup>
    </select>);
}

export default function Deals({ api }) {
  const [month, setMonth] = useState('');
  const { d, err, reload } = useOps(api, 'deals', { month });
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(false);
  const [logErr, setLogErr] = useState('');
  const names = useMemo(() => Object.fromEntries((d?.people || []).map((p) => [p.email, p.name])), [d]);
  if (!d) return <Wait err={err} />;
  const t = d.totals, untagged = t.deals - t.sales - t.rentals;
  const post = (body) => api('/api/ops', { method: 'POST', body });
  const putBack = (id) => { setBusy(true); setLogErr(''); post({ action: 'deal-restore', id }).then(reload).catch((e) => setLogErr(e.message)).finally(() => setBusy(false)); };
  return (
    <>
      <Bar note="Commission due to the company, excluding VAT, by close date">
        <Pick label="Month" value={monthKey(d.month)} onChange={setMonth} options={d.months.map((m) => [monthKey(m), monthName(m)])} />
      </Bar>
      <Stats items={[
        { label: monthName(d.month) + ' billed', value: aed(t.billed) },
        { label: 'Deals', value: n0(t.deals), sub: `${n0(t.sales)} sales, ${n0(t.rentals)} rentals${untagged > 0 ? `, ${n0(untagged)} not tagged` : ''}` },
        { label: 'Average per deal', value: aed(t.deals ? t.billed / t.deals : 0) },
      ]} />
      <Section title="Add a deal">
        <AddDeal people={d.people} today={String(d.today).slice(0, 10)} post={post} onSaved={(date) => { if (monthKey(date) !== monthKey(d.month)) setMonth(monthKey(date)); reload(); }} />
      </Section>
      <Section title={monthName(d.month) + ' deals'} aside={`${n0(d.deals.length)} ${d.deals.length === 1 ? 'entry' : 'entries'}`}>
        <Table rowKey={(r) => r.id} rows={d.deals} empty="No deals logged for this month." sort={{ key: 'date', dir: 'desc' }} cols={[
          { key: 'date', label: 'Close date', nowrap: true, value: (r) => String(r.date).slice(0, 10) + String(r.id).padStart(9, '0'), render: (r) => day(r.date) },
          { key: 'name', label: 'Broker', render: (r) => <Name main={r.name} sub={[r.splitWith ? 'Split with ' + r.splitWith : '', r.companyLead ? 'Company lead' : ''].filter(Boolean).join(' · ')} /> },
          { key: 'type', label: 'Type', value: (r) => DEAL_TYPE[r.type] || '' },
          { key: 'property', label: 'Property', value: (r) => r.property || '' },
          { key: 'transferredOn', label: 'Transferred', nowrap: true, value: (r) => r.transferredOn || '', render: (r) => day(r.transferredOn) },
          { key: 'amount', label: 'Commission', num: true, strong: true, render: (r) => aed(r.amount) },
          { key: 'edit', label: '', sortable: false, num: true, render: (r) => <LinkBtn onClick={() => setEditing(r)}>Edit</LinkBtn> },
        ]} />
      </Section>
      <Section title="Changes" aside="Latest 30, newest first">
        {logErr ? <p className="err">{logErr}</p> : null}
        <Table scroll rowKey={(r) => r.id} rows={d.log} empty="No changes yet. Every deal added, changed or removed here is listed with who did it." cols={[
          { key: 'at', label: 'When', nowrap: true, render: (r) => clock(r.at) },
          { key: 'by', label: 'Who' },
          { key: 'what', label: 'What', render: (r) => <>{describe(r, names)}{r.note ? <span className="sub">{r.note}</span> : null}</> },
          { key: 'undo', label: '', num: true, render: (r) => (r.canPutBack ? <LinkBtn disabled={busy} onClick={() => putBack(r.dealId)}>Put back</LinkBtn> : null) },
        ]} />
      </Section>
      {editing && <EditDeal deal={editing} people={d.people} today={String(d.today).slice(0, 10)} post={post} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </>
  );
}

function AddDeal({ people, today, post, onSaved }) {
  const blank = { email: '', splitWith: '', date: today, type: '', amount: '', companyLead: false, property: '' };
  const [f, setF] = useState(blank);
  const [s, setS] = useState({ saving: false, err: '', dup: null, done: '' });
  const set = (k) => (v) => { setF((x) => ({ ...x, [k]: v })); setS((x) => ({ ...x, err: '', dup: null, done: '' })); };
  const name = (e) => people.find((p) => p.email === e)?.name || '';
  const total = Math.round(toNum(f.amount)), split = f.splitWith && f.splitWith !== f.email;
  const a = split ? Math.round(total / 2) : total, b = total - a;
  const ready = f.email && f.date && f.type && total > 0;
  const otherMonth = f.date && monthKey(f.date) !== monthKey(today);
  const save = (allowDuplicate) => {
    if (!ready || s.saving) return;
    setS({ saving: true, err: '', dup: null, done: '' });
    post({ action: 'deal-add', ...f, amount: total, allowDuplicate }).then((r) => {
      if (r.duplicate) return setS({ saving: false, err: '', dup: r.existing?.[0] || {}, done: '' });
      setS({ saving: false, err: '', dup: null, done: `Added: ${name(f.email)}${split ? ' and ' + name(f.splitWith) : ''}, ${aed(total)}, ${day(f.date)}.` });
      setF({ ...blank, date: f.date, type: f.type });
      onSaved(f.date);
    }).catch((e) => setS({ saving: false, err: e.message, dup: null, done: '' }));
  };
  return (
    <form className="ops-form" onSubmit={(e) => { e.preventDefault(); save(false); }}>
      <Field label="Broker"><BrokerSelect people={people} value={f.email} onChange={set('email')} none="Choose a broker" /></Field>
      <Field label="Split with"><BrokerSelect people={people} value={f.splitWith} onChange={set('splitWith')} none="No split" skip={f.email} /></Field>
      <Field label="Close date"><input type="date" value={f.date} max={today} min="2026-01-01" onChange={(e) => set('date')(e.target.value)} /></Field>
      <Field label="Type"><Seg value={f.type} onChange={set('type')} options={TYPES} /></Field>
      <Field label={split ? 'Total commission, AED' : 'Commission, AED'} hint="Excluding VAT"><input className="amt" inputMode="numeric" placeholder="0" value={f.amount} onChange={(e) => set('amount')(e.target.value)} /></Field>
      <Field label="Property" hint="Optional"><input value={f.property} maxLength={200} onChange={(e) => set('property')(e.target.value)} /></Field>
      {ready && !s.dup ? <div className={'ops-msg' + (otherMonth ? ' warn' : '')}>
        {split ? `${aed(a)} to ${name(f.email)} and ${aed(b)} to ${name(f.splitWith)}. Counts as one deal, for ${first(name(f.email))}.` : `${aed(total)} to ${name(f.email)}.`}
        {' '}Goes into {monthName(f.date)}{otherMonth ? ', not the current month.' : '.'}
      </div> : null}
      {s.dup ? <div className="ops-msg warn">{name(f.email)} already has a deal of {aed(s.dup.amount)} on {day(s.dup.date)}{s.dup.property ? ` (${s.dup.property})` : ''}. Nothing has been saved. Is this a second, separate deal?</div> : null}
      {s.err ? <div className="ops-msg err">{s.err}</div> : null}
      {s.done ? <div className="ops-msg ok">{s.done}</div> : null}
      <div className="ops-acts">
        {s.dup ? <><Btn primary disabled={s.saving} onClick={() => save(true)}>Yes, add it as a separate deal</Btn><Btn onClick={() => setS((x) => ({ ...x, dup: null }))}>No, don't add</Btn></>
          : <><button type="submit" className="ops-btn primary" disabled={!ready || s.saving}>{s.saving ? 'Adding…' : 'Add deal'}</button>
            <label className="ops-field ops-check"><input type="checkbox" checked={f.companyLead} onChange={(e) => set('companyLead')(e.target.checked)} /><span>Company lead</span></label></>}
      </div>
    </form>);
}

function EditDeal({ deal, people, today, post, onClose, onSaved }) {
  const start = { email: deal.email, date: String(deal.date).slice(0, 10), type: deal.type || '', amount: String(Math.round(deal.amount)), companyLead: !!deal.companyLead,
    property: deal.property || '', dealValue: deal.dealValue == null ? '' : String(Math.round(deal.dealValue)), transferredOn: deal.transferredOn ? String(deal.transferredOn).slice(0, 10) : '' };
  const [f, setF] = useState(start);
  const [s, setS] = useState({ saving: false, err: '', removing: false });
  const set = (k) => (v) => { setF((x) => ({ ...x, [k]: v })); setS((x) => ({ ...x, err: '' })); };
  const patch = {};
  for (const k of Object.keys(start)) if (f[k] !== start[k]) patch[k] = ['amount', 'dealValue'].includes(k) ? (f[k] === '' ? null : toNum(f[k])) : f[k] === '' && k !== 'property' ? null : f[k];
  const changed = Object.keys(patch).length > 0;
  const run = (body) => { setS((x) => ({ ...x, saving: true, err: '' })); post(body).then(onSaved).catch((e) => setS((x) => ({ ...x, saving: false, err: e.message }))); };
  return (
    <Dialog title={`${deal.name}, ${day(deal.date)}`} onClose={onClose}>
      <form className="ops-form" onSubmit={(e) => { e.preventDefault(); if (changed && f.type) run({ action: 'deal-change', id: deal.id, patch: { ...patch, type: f.type } }); }}>
        {deal.splitWith ? <div className="ops-msg">Split with {deal.splitWith}. The date, type, property and transfer date change for both brokers. The broker, commission and company lead change for {first(deal.name)} only.</div> : null}
        <Field label="Broker"><BrokerSelect people={people} value={f.email} onChange={set('email')} none="Choose a broker" /></Field>
        <Field label={deal.splitWith ? `${first(deal.name)}'s commission, AED` : 'Commission, AED'}><input className="amt" inputMode="numeric" value={f.amount} onChange={(e) => set('amount')(e.target.value)} /></Field>
        <Field label="Close date"><input type="date" value={f.date} max={today} min="2026-01-01" onChange={(e) => set('date')(e.target.value)} /></Field>
        <Field label="Type"><Seg value={f.type} onChange={set('type')} options={TYPES} /></Field>
        <Field label="Property"><input value={f.property} maxLength={200} onChange={(e) => set('property')(e.target.value)} /></Field>
        <Field label="Property price, AED"><input className="amt" inputMode="numeric" value={f.dealValue} onChange={(e) => set('dealValue')(e.target.value)} /></Field>
        <Field label="Transferred on" hint="Leave empty until it has transferred"><input type="date" value={f.transferredOn} max={today} onChange={(e) => set('transferredOn')(e.target.value)} /></Field>
        <label className="ops-field ops-check"><input type="checkbox" checked={f.companyLead} onChange={(e) => set('companyLead')(e.target.checked)} /><span>Company lead</span></label>
        {f.date && monthKey(f.date) !== monthKey(start.date) ? <div className="ops-msg warn">This moves the deal from {monthName(start.date)} to {monthName(f.date)}.</div> : null}
        {!f.type ? <div className="ops-msg warn">Choose sale or rental to save a change to this deal.</div> : null}
        {s.err ? <div className="ops-msg err">{s.err}</div> : null}
        {s.removing ? <div className="ops-acts">
          <span className="grow">Remove this deal{deal.splitWith ? ' for both brokers' : ''}? It can be put back from Changes.</span>
          <Btn danger disabled={s.saving} onClick={() => run({ action: 'deal-remove', id: deal.id })}>Remove deal</Btn><Btn onClick={() => setS((x) => ({ ...x, removing: false }))}>Keep it</Btn>
        </div> : <div className="ops-acts">
          <button type="submit" className="ops-btn primary" disabled={!changed || !f.type || s.saving}>{s.saving ? 'Saving…' : 'Save changes'}</button>
          <Btn onClick={onClose}>Cancel</Btn><span className="grow" />
          <Btn danger onClick={() => setS((x) => ({ ...x, removing: true }))}>Remove</Btn>
        </div>}
      </form>
    </Dialog>);
}

// One line saying what a change was
const LABEL = { date: 'close date', email: 'broker', amount: 'commission', type: 'type', companyLead: 'company lead', property: 'property', dealValue: 'property price', transferredOn: 'transfer date' };
function describe(l, names) {
  const rows = l.after || l.before || [];
  const who = rows.map((r) => names[r.email] || r.email).join(' and ');
  const sum = rows.reduce((s, r) => s + Number(r.amount), 0);
  const whole = `${who}, ${aed(sum)}, ${day(rows[0]?.date)}`;
  if (l.action === 'added') return 'Added: ' + whole;
  if (l.action === 'removed') return 'Removed: ' + whole;
  if (l.action === 'put back') return 'Put back: ' + whole;
  const show = (k, v) => (v == null || v === '' ? 'empty' : k === 'email' ? names[v] || v : k === 'amount' || k === 'dealValue' ? aed(v) : k === 'date' || k === 'transferredOn' ? day(v)
    : k === 'type' ? DEAL_TYPE[v] || v : k === 'companyLead' ? (v ? 'yes' : 'no') : String(v));
  const bits = [];
  for (const k of Object.keys(LABEL)) {
    const diff = (l.before || []).map((b) => [b, (l.after || []).find((x) => x.id === b.id)]).filter(([b, a]) => a && String(b[k] ?? '') !== String(a[k] ?? ''));
    if (!diff.length) continue;
    const [b, a] = diff[0];
    bits.push(`${LABEL[k]} ${show(k, b[k])} to ${show(k, a[k])}${diff.length < rows.length && rows.length > 1 ? ` (${first(names[a.email] || a.email)})` : ''}`);
  }
  return `Changed ${who}, ${day((l.before || rows)[0]?.date)}: ${bits.join('; ') || 'no visible change'}`;
}
