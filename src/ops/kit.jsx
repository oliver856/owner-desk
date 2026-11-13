// ──────────────────────────────────────────────────────────────────
// The building blocks every Management page is made from.
// A page is: a Bar (what you're looking at, and its controls), up to four Stats, then Sections holding Tables.
// Pages never write their own table markup or styles, so every page looks and behaves the same.
// Red (.bad) means one thing only: a number that has missed its mark.
// ──────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useState } from 'react';

// ── Formatting ──
export const n0 = (v) => Number(v || 0).toLocaleString('en-GB');
export const aed = (v) => 'AED ' + Math.round(Number(v || 0)).toLocaleString('en-GB');
export const signed = (v) => (v > 0 ? '+' : '') + n0(v);
const noon = (v) => new Date(String(v).slice(0, 10) + 'T12:00:00');
export const day = (v) => (v ? noon(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
export const longDay = (v) => (v ? noon(v).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }) : '');
export const monthName = (v) => (v ? noon(v).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : '');
export const monthKey = (v) => String(v || '').slice(0, 7);
export const clock = (v) => (v ? new Date(v).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dubai' }) : '');
export const ago = (v) => {
  if (!v) return 'not yet';
  const m = Math.max(0, Math.round((Date.now() - new Date(v).getTime()) / 60000));
  return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' days ago';
};
export const dubaiToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());

// ── Loading a page's data ──
// Loads again whenever an input changes, and when reload() is called. Keeps showing what it has while it reloads.
export function useOps(api, action, params) {
  const qs = useMemo(() => new URLSearchParams(Object.entries({ action, ...params }).filter(([, v]) => v)).toString(), [action, JSON.stringify(params)]);
  const [s, setS] = useState({ d: null, err: '', qs: '' });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    api('/api/ops?' + qs).then((d) => live && setS({ d, err: '', qs })).catch((e) => live && setS({ d: null, err: e.message, qs }));
    return () => { live = false; };
  }, [api, qs, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { d: s.qs === qs ? s.d : null, err: s.qs === qs ? s.err : '', reload };
}

// ── Layout ──
export const Wait = ({ err }) => (err ? <p className="err ops-wait">{err}</p> : <p className="muted ops-wait">Loading…</p>);

// The line under the tabs: what this page is showing on the left, its controls on the right
export const Bar = ({ note, children }) => <div className="ops-bar"><span className="muted">{note}</span><div className="ops-ctl">{children}</div></div>;

// items: [{ label, value, sub, bad }]
export const Stats = ({ items }) => (
  <div className="ops-stats">{items.filter(Boolean).map((s) => (
    <div className="ops-stat" key={s.label}><span className="muted">{s.label}</span><b className={'n' + (s.bad ? ' bad' : '')}>{s.value}</b>{s.sub ? <span className="muted">{s.sub}</span> : null}</div>))}
  </div>);

export const Section = ({ title, aside, children }) => (
  <section className="ops-sec"><div className="ops-sec-h"><h2>{title}</h2>{aside ? <span className="muted">{aside}</span> : null}</div>{children}</section>);
export const Two = ({ children }) => <div className="ops-two">{children}</div>;

export const Seg = ({ value, onChange, options }) => (
  <div className="ops-seg">{options.map(([k, label]) => <button key={k} type="button" className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{label}</button>)}</div>);

export const Pick = ({ label, value, onChange, options, all }) => (
  <label className="ops-pick">{label}
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {all ? <option value="">{all}</option> : null}
      {options.map((o) => { const [k, l] = Array.isArray(o) ? o : [o, o]; return <option key={k} value={k}>{l}</option>; })}
    </select></label>);

// ── Table ──
// cols: [{ key, label, sub, num, nowrap, strong, muted, value(row), render(row), bad(row) }]
//   value   what the column sorts by and shows (defaults to row[key]); render overrides only what is shown
//   num     right-aligned figures; numbers are formatted with thousands separators
// sort: { key, dir } to start sorted and let the headers be clicked. Without it the rows stay in the order given.
export function Table({ cols, rows, rowKey, empty = 'Nothing yet.', sort, scroll, selected }) {
  const [s, setS] = useState(sort || null);
  const shown = useMemo(() => {
    if (!s) return rows;
    const c = cols.find((x) => x.key === s.key);
    if (!c) return rows;
    const val = (r) => (c.value ? c.value(r) : r[c.key]);
    return [...rows].sort((a, b) => {
      const x = val(a), y = val(b);
      const d = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'en', { numeric: true });
      return s.dir === 'desc' ? -d : d;
    });
  }, [rows, cols, s]);
  const head = (c) => {
    const inner = <>{c.label}{c.sub ? <span className="sub">{c.sub}</span> : null}</>;
    if (!sort || c.sortable === false) return inner;
    const on = s?.key === c.key;
    return <button type="button" className={'ops-sort' + (on ? ' on' : '')} onClick={() => setS({ key: c.key, dir: on ? (s.dir === 'desc' ? 'asc' : 'desc') : (c.num ? 'desc' : 'asc') })}>
      {inner}<i aria-hidden="true">{on ? (s.dir === 'desc' ? '↓' : '↑') : ''}</i></button>;
  };
  const cell = (c, r) => {
    if (c.render) return c.render(r);
    const v = c.value ? c.value(r) : r[c.key];
    return c.num && typeof v === 'number' ? n0(v) : v ?? '';
  };
  return (
    <div className={'ops-tbl' + (scroll ? ' ops-scroll' : '')}><table>
      <thead><tr>{cols.map((c) => <th key={c.key} className={c.num ? 'r' : ''} aria-sort={s?.key === c.key ? (s.dir === 'desc' ? 'descending' : 'ascending') : undefined}>{head(c)}</th>)}</tr></thead>
      <tbody>{shown.length ? shown.map((r, i) => (
        <tr key={rowKey ? rowKey(r) : i} className={selected && selected(r) ? 'sel' : ''}>{cols.map((c) => (
          <td key={c.key} className={[c.num ? 'r n' : '', c.nowrap ? 'nw' : '', c.strong ? 'b' : '', c.muted ? 'muted' : '', c.bad && c.bad(r) ? 'bad' : ''].filter(Boolean).join(' ')}>{cell(c, r)}</td>))}</tr>))
        : <tr><td colSpan={cols.length} className="muted ops-empty">{empty}</td></tr>}</tbody>
    </table></div>);
}
// A name with a smaller line under it
export const Name = ({ main, sub }) => <><b>{main}</b>{sub ? <span className="sub">{sub}</span> : null}</>;

// ── Forms ──
export const Field = ({ label, hint, wide, children }) => <label className={'ops-field' + (wide ? ' wide' : '')}><span>{label}</span>{children}{hint ? <small className="muted">{hint}</small> : null}</label>;
export const Btn = ({ primary, danger, quiet, ...p }) => <button type="button" {...p} className={'ops-btn' + (primary ? ' primary' : '') + (danger ? ' danger' : '') + (quiet ? ' quiet' : '')} />;
export const LinkBtn = (p) => <button type="button" {...p} className="ops-link" />;

export function Dialog({ title, onClose, children }) {
  useEffect(() => { const f = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f); }, [onClose]);
  return (
    <div className="ops-veil" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="ops-dialog" role="dialog" aria-modal="true" aria-label={title}><h2>{title}</h2>{children}</div>
    </div>);
}

export const CSS = `
.ops{padding-top:18px;padding-bottom:60px;max-width:1280px;margin:0 auto}
.ops h2{font-size:14px;font-weight:650;margin:0}
.ops-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}
.ops-tabs,.ops-seg{display:flex;gap:2px;padding:3px;border-radius:10px;background:color-mix(in srgb,var(--ink) 4%,var(--bg));overflow-x:auto}
.ops-tabs button,.ops-seg button{background:none;border:none;padding:6px 14px;border-radius:7px;color:var(--muted);font:inherit;font-weight:500;cursor:pointer;white-space:nowrap}
.ops-tabs button:hover,.ops-seg button:hover{color:var(--ink)}
.ops-tabs button.on,.ops-seg button.on{background:var(--bg);color:var(--ink);box-shadow:0 1px 2px rgba(16,24,22,.08),0 0 0 1px var(--line)}
.ops-pick{display:flex;align-items:center;gap:8px;color:var(--muted)}
.ops-pick select,.ops-field input,.ops-field select{font:inherit;color:var(--ink);background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:7px 9px;min-height:34px}
.ops-bar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 14px;margin:14px 0 0;min-height:34px}
.ops-ctl{display:flex;flex-wrap:wrap;align-items:center;gap:12px}
.ops-wait{padding:30px 0}
.ops-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin-top:12px}
.ops-stat{border:1px solid var(--line);border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:2px}
.ops-stat b{font-size:24px;font-weight:700;line-height:1.25}
.ops-sec{margin-top:26px;min-width:0}
.ops-sec-h{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:10px}
.ops-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(360px,100%),1fr));gap:0 22px}
.ops-tbl{border:1px solid var(--line);border-radius:10px;overflow-x:auto}
.ops-scroll{max-height:330px;overflow-y:auto}
.ops-tbl table{width:100%;border-collapse:collapse}
.ops-tbl th{text-align:left;font-weight:600;padding:9px 12px;background:var(--hover);border-bottom:1px solid var(--line);white-space:nowrap;vertical-align:bottom;position:sticky;top:0}
.ops-tbl td{padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top}
.ops-tbl tr:last-child td{border-bottom:none}
.ops-tbl .r{text-align:right;white-space:nowrap} .ops-tbl .nw{white-space:nowrap} .ops-tbl td.b{font-weight:650}
.ops-tbl th .sub{font-weight:400}
.ops-tbl tr.sel td{background:color-mix(in srgb,var(--accent) 7%,var(--bg))}
.ops-empty{padding:18px 12px!important}
.ops-sort{background:none;border:none;padding:0;font:inherit;font-weight:600;color:inherit;cursor:pointer;text-align:inherit}
.ops-sort i{display:inline-block;width:12px;font-style:normal;color:var(--muted);text-align:right}
.ops-sort:hover,.ops-sort.on{color:var(--accent)}
.ops .bad{color:var(--bad);font-weight:600}
.ops-link{background:none;border:none;padding:0;font:inherit;color:var(--accent);font-weight:600;cursor:pointer}
.ops-link:hover{text-decoration:underline}
.ops-link+.ops-link{margin-left:14px}
.ops-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px 14px;align-items:start;border:1px solid var(--line);border-radius:10px;padding:16px}
.ops-dialog .ops-form{border:none;padding:0;grid-template-columns:1fr 1fr}
.ops-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.ops-field.wide{grid-column:1/-1}
.ops-field>span{font-weight:600}
.ops-field input,.ops-field select{width:100%}
.ops-field input.amt{text-align:right;font-variant-numeric:tabular-nums}
.ops-check{flex-direction:row;align-items:center;gap:8px;min-height:34px;cursor:pointer}
.ops-field .ops-seg{align-self:flex-start}
.ops-check input{width:auto;min-height:0}
.ops-acts{grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:center;gap:12px}
.ops-acts .grow{flex:1}
.ops-btn{font:inherit;font-weight:600;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:8px;padding:7px 16px;min-height:34px;cursor:pointer}
.ops-btn:hover{border-color:var(--accent);color:var(--accent)}
.ops-btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.ops-btn.primary:hover{color:var(--accent-ink);filter:brightness(1.08)}
.ops-btn.danger{color:var(--bad)} .ops-btn.danger:hover{border-color:var(--bad);color:var(--bad)}
.ops-btn[disabled]{opacity:.45;cursor:not-allowed}
.ops-msg{grid-column:1/-1;border-radius:8px;padding:10px 12px;background:var(--hover)}
.ops-msg.warn{background:color-mix(in srgb,var(--warn) 10%,var(--bg));color:var(--ink)}
.ops-msg.err{background:color-mix(in srgb,var(--bad) 8%,var(--bg));color:var(--bad)}
.ops-msg.ok{background:color-mix(in srgb,var(--accent) 8%,var(--bg))}
.ops-veil{position:fixed;inset:0;z-index:60;background:rgba(10,16,15,.42);display:grid;place-items:center;padding:16px}
.ops-dialog{background:var(--bg);border:1px solid var(--line);border-radius:14px;box-shadow:0 20px 50px rgba(16,24,22,.25);padding:20px;width:min(560px,100%);max-height:calc(100vh - 32px);overflow:auto;display:grid;gap:16px}
.ops-meter{height:6px;border-radius:99px;background:var(--hover);overflow:hidden;min-width:90px}
.ops-meter i{display:block;height:100%;background:var(--accent);border-radius:99px}
@media (max-width:560px){.ops-dialog .ops-form{grid-template-columns:1fr}}
`;
