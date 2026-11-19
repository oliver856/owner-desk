// ─────────────────────────────────────────────────────────────────────────────
// Listings tab: each broker's live Kendal listings against what similar units have actually sold or rented for
// (land department sales and new Ejari leases), with a target price, the gap and a verdict. Read-only: prices are
// changed in Kendal. "Call owner" opens the owner's unit on the Desk; "Owner report" makes the one-page PDF.
// Loaded only when the tab is opened. Server: api/listings.js. Database: migration 019.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

const CSS = `
.lst{padding-block:18px 40px}
.lst-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap} .lst-head h1{font-size:20px;font-weight:600;margin:0}
.lst-sub{margin:3px 0 0;color:var(--muted)}
.lst-sum{margin:16px 0 10px;font-size:14px}
.lst-scope{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;margin-left:auto}
.lst-scope button{background:none;border:none;padding:5px 12px;color:var(--muted);font-size:12.5px}
.lst-scope button.on{background:var(--hover);color:var(--ink);font-weight:500}
.lst-tw{margin-top:12px;border:1px solid var(--line);border-radius:8px;overflow-x:auto}
.lst-grid{min-width:960px}
.lst-row{display:grid;grid-template-columns:2.3fr 1.1fr 1.2fr .6fr 1.5fr 1.6fr;gap:12px;padding:11px 14px;align-items:center;border-bottom:1px solid var(--line)}
.lst-row:last-child{border-bottom:none}
.lst-row.h{padding:9px 14px;font-size:11.5px;color:var(--muted);font-weight:500}
.lst-row .r{text-align:right;font-variant-numeric:tabular-nums}
.lst-row b{font-weight:600} .lst-row small{display:block;color:var(--muted);font-size:12px}
.lst-acts{display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap}
.lst-call{background:var(--accent);color:var(--accent-ink);border:none;border-radius:6px;padding:6px 11px;font-size:12px;font-weight:500;white-space:nowrap}
.lst-rep{background:none;border:1px solid var(--line);border-radius:6px;padding:5px 10px;font-size:12px;white-space:nowrap}
.lst-rep:hover{border-color:var(--accent);color:var(--accent)}
.lst-none{font-size:12px;color:var(--muted);padding:6px 4px;white-space:nowrap}
.v-well{color:var(--bad)} .v-reduce{color:var(--warn)} .v-ptg{color:var(--blue)} .v-good{color:var(--hot)} .v-nee{color:var(--muted)}
.orpt-scrim{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.35);display:flex;justify-content:center;align-items:flex-start;overflow:auto;padding:24px 12px}
.orpt-box{background:var(--bg);border-radius:12px;padding:16px;display:flex;flex-direction:column;gap:12px;max-width:100%}
.orpt-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.orpt-bar label{font-size:12px;color:var(--muted)} .orpt-bar input{padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);min-width:220px}
.orpt-bar .grow{flex:1}
`;

// Print rules only exist while a report is open, so they never affect printing anything else
const PRINT_CSS = `
@media print{
  @page{size:420px 880px;margin:0}
  html,body{background:#fff!important}
  body>*:not(.orpt-print){display:none!important}
  .orpt-print{display:block!important;position:static!important}
  .orpt-print .orpt-scrim{position:static;background:none;padding:0;overflow:visible}
  .orpt-print .orpt-box{padding:0;border-radius:0;background:#fff}
  .orpt-print .orpt-bar{display:none!important}
  .orpt-page{box-shadow:none!important}
}
`;

const VERDICT = {
  well: ['Well overpriced', 'v-well'], reduce: ['Reduce', 'v-reduce'], ptg: ['Priced to go', 'v-ptg'],
  good: ['Good', 'v-good'], nee: ['Not enough evidence', 'v-nee'],
};
const RANK = { well: 0, reduce: 1, ptg: 2, good: 3, nee: 4 };
const TABS = [['all', 'All', () => true], ['reduce', 'Needs a reduction', (v) => v === 'well' || v === 'reduce'],
  ['ptg', 'Priced to go', (v) => v === 'ptg'], ['good', 'Good', (v) => v === 'good'], ['nee', 'Not enough evidence', (v) => v === 'nee']];

const n0 = (n) => (n == null ? '–' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }));
const aed = (n) => (n == null ? '–' : 'AED ' + n0(n));
const short = (n) => (n >= 1e6 ? 'AED ' + (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M' : 'AED ' + Math.round(n / 1000) + 'k');
const bedWord = (b, kind, plural) => (b === 0 ? (plural ? 'studios' : 'Studio') : `${b} bed${kind === 'villa' ? (plural ? ' villas' : ' villa') : (plural ? ' apartments' : ' apartment')}`);
const fdate = (d, opts) => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', ...opts }) : '');
const titleCase = (s) => (s ? s.toLowerCase().replace(/(^|[\s'-])\S/g, (m) => m.toUpperCase()) : '');

export default function Listings({ api, onOpen }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [scope, setScope] = useState('mine');
  const [tab, setTab] = useState('all');
  const [report, setReport] = useState(null);

  const [updating, setUpdating] = useState(false);
  useEffect(() => {
    let live = true; setErr(''); setD(null);
    const get = () => api('/api/listings?action=list' + (scope === 'mine' ? '' : '&scope=' + scope));
    get().then((j) => {
      if (!live) return;
      // managers and admins with no listings of their own land on their team (or everyone) instead of an empty page
      if (scope === 'mine' && !j.listings.length && j.canTeam) { setScope(j.canAll ? 'all' : 'team'); return; }
      setD(j);
      // figures over 10 minutes old: show them now, rebuild in the background, then swap in the fresh ones
      if (j.stale) {
        setUpdating(true);
        api('/api/listings', { method: 'POST', body: { action: 'refresh' } })
          .then(() => get()).then((f) => { if (live) setD(f); })
          .catch(() => {}).finally(() => live && setUpdating(false));
      }
    }).catch((e) => live && setErr(e.message));
    return () => { live = false; };
  }, [api, scope]);

  const rows = useMemo(() => (d?.listings || []).slice().sort((a, b) => (RANK[a.verdict] - RANK[b.verdict]) || ((b.gap ?? -1e9) - (a.gap ?? -1e9))), [d]);
  const shown = rows.filter((r) => TABS.find((t) => t[0] === tab)[2](r.verdict));
  const over = rows.filter((r) => r.verdict === 'well' || r.verdict === 'reduce').length;
  const whose = (n) => (d?.scope === 'all' ? `${n} live listings` : d?.scope === 'team' ? `the team's ${n} live listings` : `your ${n} live listings`);

  return (
    <main className="gut lst">
      <style>{CSS}</style>
      <div className="lst-head">
        <h1>{d?.scope === 'all' ? 'All listings' : d?.scope === 'team' ? 'Team listings' : 'My listings'}</h1>
        {d?.canTeam && <div className="lst-scope">
          <button className={scope === 'mine' ? 'on' : ''} onClick={() => setScope('mine')}>Mine</button>
          <button className={scope === 'team' ? 'on' : ''} onClick={() => setScope('team')}>Team</button>
          {d?.canAll && <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>Everyone</button>}
        </div>}
      </div>
      <p className="lst-sub">Live Kendal listings against recent sales and new Ejari leases for similar units.
        {d?.salesTo ? ` Sales to ${fdate(d.salesTo, { day: 'numeric', month: 'short', year: 'numeric' })}, leases to ${fdate(d.rentsTo, { day: 'numeric', month: 'short', year: 'numeric' })}.` : ''}
        {updating ? <span className="faint"> Updating…</span> : null}</p>

      {err ? <p className="err" style={{ marginTop: 16 }}>{err}</p> : !d ? <p className="muted" style={{ marginTop: 16 }}>Loading…</p> : <>
        <p className="lst-sum">{rows.length === 0 ? (d.scope === 'mine' ? 'You have no live listings in Kendal.' : d.scope === 'team' ? 'Your team has no live listings in Kendal.' : 'No live listings in Kendal.')
          : over ? <><b>{over} of {whose(rows.length)}</b> {over === 1 ? 'is' : 'are'} priced above what similar units have gone for. They're at the top.</>
            : <>None of {whose(rows.length)} are priced above what similar units have gone for.</>}</p>

        <div className="tabs">
          {TABS.map(([k, label, f]) => <button key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>
            {label}<span className="c">{rows.filter((r) => f(r.verdict)).length}</span></button>)}
        </div>

        <div className="lst-tw"><div className="lst-grid">
          <div className="lst-row h"><span>Listing</span><span className="r">Listed at</span><span className="r">Target</span><span className="r">Gap</span><span>Verdict</span><span /></div>
          {shown.map((r) => <Row key={r.id} r={r} showAgent={d.scope !== 'mine'} onOpen={onOpen} onReport={() => setReport(r.id)} />)}
          {shown.length === 0 && <div className="lst-row"><span className="muted">Nothing here.</span></div>}
        </div></div>
      </>}
      {report && <OwnerReport api={api} id={report} onClose={() => setReport(null)} />}
    </main>
  );
}

function Row({ r, showAgent, onOpen, onReport }) {
  const rent = r.purpose === 'rent';
  const suf = rent ? ' /yr' : '';
  const [label, cls] = VERDICT[r.verdict] || VERDICT.nee;
  const action = r.verdict === 'well' || r.verdict === 'reduce' ? `Get it to ${aed(r.target)}`
    : r.verdict === 'good' ? 'In line with the market' : r.verdict === 'ptg' ? 'Below similar units' : r.note;
  const sub = [rent ? 'Rent' : r.purpose === 'offplan' ? 'Off-plan' : 'Sale', r.kind ? bedWord(r.beds, r.kind) : null,
    r.size ? `${n0(r.size)} sq ft` : null, r.community, r.id, showAgent ? r.agent : null].filter(Boolean).join(' · ');
  return (
    <div className="lst-row">
      <span style={{ minWidth: 0 }}><b>{r.building || r.subCommunity || r.title}</b><small>{sub}</small></span>
      <span className="r">{aed(r.listed)}{r.listed ? suf : ''}</span>
      <span className="r"><b>{r.target ? aed(r.target) + suf : '–'}</b>
        {r.target ? <small>{r.evidence} {rent ? 'leases' : 'sales'}{r.level && r.level !== 'building' ? ` · ${r.level}` : ''}</small> : null}</span>
      <span className={'r ' + cls}>{r.gap == null ? '–' : (r.gap > 0 ? '+' : '') + r.gap.toFixed(1) + '%'}</span>
      <span><b className={cls}>{label}</b><small>{action}</small></span>
      <span className="lst-acts">
        {r.unitId ? <button className="lst-call" onClick={() => onOpen(r.unitId)}>Call owner</button> : <span className="lst-none">Owner not on Desk</span>}
        {r.target ? <button className="lst-rep" onClick={onReport}>Owner report</button> : null}
      </span>
    </div>
  );
}

// ── Owner report: one phone-sized page, saved as a PDF from the print window ─────────────────────────────────
function OwnerReport({ api, id, onClose }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [owner, setOwner] = useState('');
  useEffect(() => {
    api('/api/listings?action=report&id=' + encodeURIComponent(id))
      .then((j) => { setD(j); setOwner(titleCase(j.ownerName || '')); }).catch((e) => setErr(e.message));
  }, [api, id]);
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  useEffect(() => {
    // the report's own typefaces, loaded only when a report is opened
    if (document.getElementById('orpt-fonts')) return;
    const l = document.createElement('link'); l.id = 'orpt-fonts'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500&family=Inter:wght@400;500;600;700&display=swap';
    document.head.appendChild(l);
  }, []);

  const download = () => {
    const was = document.title;
    document.title = `Market update - ${d.building || d.subCommunity}${owner ? ' - ' + owner : ''}`;
    window.print();
    setTimeout(() => { document.title = was; }, 500);
  };

  return createPortal(
    <div className="orpt-print"><style>{PRINT_CSS}</style>
      <div className="orpt-scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="orpt-box">
          <div className="orpt-bar">
            <label htmlFor="orpt-owner">Prepared for</label>
            <input id="orpt-owner" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Owner's name (leave blank to leave it off)" />
            <span className="grow" />
            <button className="btn primary" disabled={!d} onClick={download}>Download PDF</button>
            <button className="btn" onClick={onClose}>Close</button>
          </div>
          {err ? <p className="err" style={{ width: 420 }}>{err}</p> : !d ? <p className="muted" style={{ width: 420 }}>Loading…</p> : <ReportPage d={d} owner={owner.trim()} />}
          {d && <p className="faint" style={{ fontSize: 12, margin: 0, width: 420 }}>In the print window choose "Save as PDF". Check the owner's name above first: land department names are often in capitals or a different order.</p>}
        </div>
      </div>
    </div>, document.body);
}

function ReportPage({ d, owner }) {
  const rent = d.purpose === 'rent';
  const vals = d.values?.length ? d.values : [d.low, d.high];
  const lo = Math.min(d.low, d.listed || d.low), hi = Math.max(d.high, d.listed || d.high);
  const pad = (hi - lo) * 0.1 || hi * 0.05, a = lo - pad, b = hi + pad;
  const pct = (x) => (((x - a) / (b - a)) * 100).toFixed(1) + '%';
  const since = new Date(); since.setMonth(since.getMonth() - (d.months || 6));
  const sinceTxt = since.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const place = (d.level || '').startsWith('building') ? d.building : (d.subCommunity || d.building || d.community);
  const what = bedWord(d.beds, d.kind, true);
  const offplanSales = (d.level || '').includes('off-plan');
  const basis = rent
    ? `Based on new tenancy contracts for ${what} in ${place} registered with Ejari since ${sinceTxt}. Renewals are not included.`
    : `Based on registered ${offplanSales ? 'off-plan ' : ''}sales of ${what} in ${place} since ${sinceTxt}, from Dubai Land Department records.`;
  const unitLine = [d.kind ? bedWord(d.beds, d.kind) : null, d.community, d.size ? `${n0(d.size)} sq ft` : null].filter(Boolean).join(' · ');
  const br = d.broker;
  const mobile = br?.mobile ? br.mobile.replace(/^\+971(\d{2})(\d{3})(\d{4})$/, '+971 $1 $2 $3') : '';
  const initials = (br?.name || '').split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();

  const sans = "Inter, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif", jost = 'Jost, Inter, sans-serif';
  const card = { background: '#fff', borderRadius: 2, border: '1px solid #ece8df' };
  return (
    <div className="orpt-page" style={{ width: 420, height: 880, boxSizing: 'border-box', background: '#fbfaf7', color: '#1a1a1a', fontFamily: sans, display: 'flex', flexDirection: 'column', boxShadow: '0 2px 12px rgba(0,0,0,.12)', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' }}>
      <div style={{ padding: '34px 28px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
        <img src="/apex-logo.svg" alt="Apex Homes DXB" style={{ width: 118, height: 'auto', display: 'block' }} />
        <div style={{ width: 28, height: 1, background: '#b8a888', margin: '22px 0 16px' }} />
        <p style={{ margin: 0, fontFamily: jost, fontSize: 11, letterSpacing: '0.32em', textTransform: 'uppercase', color: '#8c7a5b' }}>
          Market update · {new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</p>
        <h1 style={{ margin: '10px 0 0', fontFamily: jost, fontSize: (place || '').length > 22 ? 22 : 28, fontWeight: 300, letterSpacing: '0.08em', lineHeight: 1.15, textTransform: 'uppercase' }}>{d.building || d.subCommunity}</h1>
        <p style={{ margin: '8px 0 0', fontSize: 13.5, color: '#6b6b6b' }}>{unitLine}</p>
        {owner && <p style={{ margin: '16px 0 0', fontSize: 13, color: '#6b6b6b' }}>Prepared for <span style={{ fontFamily: jost, fontSize: 15, color: '#1a1a1a', letterSpacing: '0.02em' }}>{owner}</span></p>}
      </div>

      <div style={{ padding: '0 18px' }}>
        <div style={{ ...card, boxShadow: '0 1px 2px rgba(60,50,30,0.04)', padding: '24px 22px 20px' }}>
          <p style={{ margin: 0, fontFamily: jost, fontSize: 12, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#6b6b6b' }}>Similar units are {rent ? 'renting' : 'selling'} at</p>
          <p style={{ margin: '10px 0 0', fontSize: 24, fontWeight: 500, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>{aed(d.low)} – {n0(d.high)}</p>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b6b6b' }}>{rent ? `a year, on new leases since ${sinceTxt}` : `for ${what} since ${sinceTxt}`}</p>
          <div style={{ position: 'relative', height: 64, marginTop: 20 }}>
            <div style={{ position: 'absolute', left: 0, right: 0, top: 27, height: 2, background: '#eeeae2' }} />
            <div style={{ position: 'absolute', top: 27, height: 2, background: '#1a1a1a', left: pct(d.low), width: (((d.high - d.low) / (b - a)) * 100).toFixed(1) + '%' }} />
            {vals.map((v, i) => <div key={i} style={{ position: 'absolute', top: 23, width: 10, height: 10, marginLeft: -5, borderRadius: '50%', background: '#fff', border: '1.5px solid #1a1a1a', boxSizing: 'border-box', left: pct(v) }} />)}
            {d.listed ? <>
              <div style={{ position: 'absolute', top: 17, width: 1, height: 22, background: '#8c7a5b', left: pct(d.listed) }} />
              <div style={{ position: 'absolute', top: 0, fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#7a6a4f', whiteSpace: 'nowrap', transform: 'translateX(-50%)', left: pct(d.listed) }}>Your unit</div>
            </> : null}
            <div style={{ position: 'absolute', top: 46, left: 0, fontSize: 11, color: '#8a8a8a' }}>{short(a)}</div>
            <div style={{ position: 'absolute', top: 46, right: 0, fontSize: 11, color: '#8a8a8a' }}>{short(b)}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', marginTop: 14, borderTop: '1px solid #f0ece4', paddingTop: 16 }}>
            <Stat label="Typical" value={short(d.typical)} />
            <Stat label={rent ? `New leases, ${d.months} mo` : `Sales, ${d.months} months`} value={n0(d.evidence)} line />
            <Stat label="Latest" value={fdate(d.latest, { day: 'numeric', month: 'short' })} line />
          </div>
        </div>
      </div>

      <p style={{ margin: '16px 26px 0', fontSize: 13, lineHeight: 1.55, color: '#555' }}>{basis}</p>

      {br && <div style={{ ...card, margin: '20px 18px 0', padding: 18, display: 'flex', gap: 18, alignItems: 'center' }}>
        <div style={{ width: 92, height: 92, borderRadius: '50%', overflow: 'hidden', flex: 'none', background: '#e9e7e9', display: 'grid', placeItems: 'center' }}>
          {br.photo ? <img src={br.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 18%' }} />
            : <span style={{ fontFamily: jost, fontSize: 26, color: '#8c7a5b' }}>{initials}</span>}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ fontFamily: jost, fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: '#8c7a5b' }}>Your consultant</span>
          <span style={{ fontFamily: jost, fontSize: 18, letterSpacing: '0.02em', marginTop: 2 }}>{br.name}</span>
          {br.title && <span style={{ fontSize: 12.5, color: '#555' }}>{br.title}</span>}
          {mobile && <span style={{ fontSize: 12.5, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>{mobile}</span>}
          <span style={{ fontSize: 12.5 }}>{br.email}</span>
        </div>
      </div>}

      <div style={{ margin: 'auto 28px 0', borderTop: '1px solid #e6e1d6', color: '#8a8a8a', padding: '14px 0 18px', display: 'flex', justifyContent: 'space-between', fontSize: 11, letterSpacing: '0.04em' }}>
        <span>Apex Homes Real Estate L.L.C.</span><span style={{ color: '#1a1a1a' }}>apexhomesdxb.com</span>
      </div>
    </div>
  );
}

function Stat({ label, value, line }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, ...(line ? { borderLeft: '1px solid #ebe9e4', paddingLeft: 14 } : {}) }}>
      <span style={{ fontSize: 11, color: '#6b6b6b' }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}
