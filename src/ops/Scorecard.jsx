// The quarter scorecard: every measure against plan with a RAG status. Figures from api/_lib/scorecard.js.
import React, { useState } from 'react';
import { useOps, Wait, Bar, Section, Table, Seg, Btn, Dialog, Name, monthName, longDay } from './kit.jsx';

const CSS = `
.sc-status{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.sc-status span{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);border-radius:99px;padding:5px 12px;font-weight:600}
.sc-rag{display:inline-flex;align-items:center;gap:6px;font-weight:600;white-space:nowrap}
.sc-rag i{width:9px;height:9px;border-radius:50%;background:var(--line)}
.sc-rag.Green i{background:#2f9e5b} .sc-rag.Amber i{background:#d99a1e} .sc-rag.Red i{background:#d2412f}
.sc-rag.Red{color:#b3321f} .sc-rag.none{font-weight:400;color:var(--muted)}
.sc-plan{display:grid;grid-template-columns:minmax(0,1fr) repeat(3,110px);gap:6px 10px;align-items:center}
.sc-plan input{font:inherit;text-align:right;border:1px solid var(--line);border-radius:7px;padding:5px 8px;width:100%;background:var(--bg);color:var(--ink)}
.sc-plan .h{font-weight:600;text-align:right}
`;

const k = (v) => { const a = Math.abs(v); return a >= 1e6 ? (v / 1e6).toFixed(2) + 'm' : a >= 1e4 ? Math.round(v / 1e3) + 'k' : Math.round(v).toLocaleString('en-GB'); };
export const fmtMeasure = (unit, v) => (v == null ? '–' : unit === 'aed' ? 'AED ' + k(v) : unit === 'pct' ? (v * 100).toFixed(1) + '%' : Math.round(v).toLocaleString('en-GB'));
export const Rag = ({ v }) => (['Green', 'Amber', 'Red'].includes(v) ? <span className={'sc-rag ' + v}><i />{v}</span> : <span className="sc-rag none">{v === '-' ? 'Not started' : v}</span>);
const pct = (p) => (p == null ? '' : Math.round(p * 100) + '%');
const short = (m) => monthName(m).split(' ')[0];

export default function Scorecard({ api }) {
  const [month, setMonth] = useState('');
  const [view, setView] = useState('now');
  const [editing, setEditing] = useState(false);
  const { d, err, reload } = useOps(api, 'scorecard', { month });
  if (!d) return <Wait err={err} />;
  const i = d.months.indexOf(d.latestMonth);
  const prevQ = (() => { const t = new Date(d.months[0] + 'T12:00:00Z'); t.setUTCMonth(t.getUTCMonth() - 3); return t.toISOString().slice(0, 7); })();
  const nextQ = (() => { const t = new Date(d.months[0] + 'T12:00:00Z'); t.setUTCMonth(t.getUTCMonth() + 3); return t.toISOString().slice(0, 7); })();
  const isNow = d.months.includes(d.today.slice(0, 7) + '-01');
  const groups = ['Results', 'Drivers', 'People'];
  const measure = { key: 'label', label: 'Measure', render: (r) => <Name main={r.label} sub={r.owner} /> };
  const colsNow = [measure,
    { key: 'ma', label: short(d.latestMonth) + ' actual', num: true, strong: true, render: (r) => fmtMeasure(r.unit, r.months[i]?.actual) },
    { key: 'mp', label: 'Plan to date', num: true, muted: true, render: (r) => fmtMeasure(r.unit, r.months[i]?.planToDate) },
    { key: 'mpct', label: '', num: true, render: (r) => pct(r.months[i]?.pct) },
    { key: 'mr', label: 'RAG', render: (r) => <Rag v={r.months[i]?.rag} /> },
    { key: 'qa', label: 'Quarter actual', num: true, strong: true, render: (r) => fmtMeasure(r.unit, r.quarter.actual) },
    { key: 'qp', label: 'Plan to date', num: true, muted: true, render: (r) => fmtMeasure(r.unit, r.quarter.planToDate) },
    { key: 'qpct', label: '', num: true, render: (r) => pct(r.quarter.pct) },
    { key: 'qr', label: 'RAG', render: (r) => <Rag v={r.quarter.rag} /> }];
  const colsMonths = [measure, ...d.months.flatMap((m, j) => [
    { key: 'a' + j, label: short(m), num: true, strong: true, render: (r) => fmtMeasure(r.unit, r.months[j].actual) },
    { key: 'p' + j, label: 'Plan', num: true, muted: true, render: (r) => fmtMeasure(r.unit, r.months[j].plan) },
    { key: 'r' + j, label: '', render: (r) => <Rag v={r.months[j].rag} /> }])];
  const share = d.share[i] != null && d.share[i] < 1 ? `, ${Math.round(d.share[i] * 100)}% of the month gone` : '';
  return (
    <>
      <style>{CSS}</style>
      <Bar note={`${d.quarterLabel} · to ${longDay(d.today)}${isNow ? share : ''}. Running totals are judged against the plan pro-rated for the days gone; rates and headcount against the full figure.`}>
        <Seg value={view} onChange={setView} options={[['now', 'Month and quarter'], ['months', 'By month']]} />
        <Btn onClick={() => setMonth(prevQ)}>← Earlier</Btn>
        {!isNow && <Btn onClick={() => setMonth(nextQ)}>Later →</Btn>}
        <Btn onClick={() => setEditing(true)}>Edit plans</Btn>
      </Bar>
      {d.latestMonth && <div className="sc-status">
        <span className="muted" style={{ border: 'none', paddingLeft: 0 }}>{short(d.latestMonth)}:</span>
        {['Green', 'Amber', 'Red'].map((x) => <span key={x}><Rag v={x} /> {d.status[x]}</span>)}
        {d.status['No target'] ? <span className="muted">{d.status['No target']} with no target</span> : null}
      </div>}
      {groups.map((g) => (
        <Section key={g} title={g}>
          <Table rowKey={(r) => r.key} rows={d.rows.filter((r) => r.group === g)} cols={view === 'now' ? colsNow : colsMonths} />
        </Section>
      ))}
      {editing && <EditPlans d={d} api={api} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
    </>
  );
}

// Plan figures: money in AED, conversion as a percentage. Deals and average per deal follow from leads and conversion.
function EditPlans({ d, api, onClose, onSaved }) {
  const editable = d.rows.filter((r) => !['deals', 'avgDeal'].includes(r.key));
  const show = (r, v) => (v == null ? '' : r.unit === 'pct' ? String(Math.round(v * 10000) / 100) : String(Math.round(v)));
  const start = Object.fromEntries(editable.flatMap((r) => r.months.map((c) => [r.key + '|' + c.month, show(r, c.plan)])));
  const [f, setF] = useState(start);
  const [s, setS] = useState({ saving: false, err: '' });
  const save = async () => {
    setS({ saving: true, err: '' });
    try {
      for (const [key, v] of Object.entries(f)) {
        if (v === start[key]) continue;
        const [measure, month] = key.split('|');
        const r = editable.find((x) => x.key === measure);
        const num = v.trim() === '' ? null : Number(v.replace(/[, ]/g, ''));
        if (num != null && !Number.isFinite(num)) throw new Error(`${r.label}: enter a number.`);
        await api('/api/ops', { method: 'POST', body: { action: 'plan-set', measure, month, plan: num == null ? null : r.unit === 'pct' ? num / 100 : num } });
      }
      onSaved();
    } catch (e) { setS({ saving: false, err: e.message }); }
  };
  return (
    <Dialog title={`${d.quarterLabel} plan`} onClose={onClose}>
      <p className="muted" style={{ margin: 0 }}>Money in AED, conversion as a percentage (1.5 = 1.5%). Leave a box empty for no target. Deals and average per deal are worked out from leads and conversion.</p>
      <div className="sc-plan">
        <span />{d.months.map((m) => <span key={m} className="h">{short(m)}</span>)}
        {editable.map((r) => (
          <React.Fragment key={r.key}>
            <span>{r.label}</span>
            {r.months.map((c) => <input key={c.month} inputMode="decimal" value={f[r.key + '|' + c.month]} onChange={(e) => setF((x) => ({ ...x, [r.key + '|' + c.month]: e.target.value }))} />)}
          </React.Fragment>
        ))}
      </div>
      {s.err && <div className="ops-msg err">{s.err}</div>}
      <div className="ops-acts"><Btn primary disabled={s.saving} onClick={save}>{s.saving ? 'Saving…' : 'Save plan'}</Btn><Btn onClick={onClose}>Cancel</Btn></div>
    </Dialog>
  );
}
