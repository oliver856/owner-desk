// ─────────────────────────────────────────────────────────────────────────────
// Apex Owner Desk: the whole screen lives in this one file.
// Change the look or layout here. The secure server code is in the /api folder
// and doesn't need touching for UI changes.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

// ── Settings you might want to change ───────────────────────────────────────
const OUTCOMES = ['No answer', 'Not interested', 'Call back', 'Wants valuation', 'Listing opportunity', 'Wants to sell', 'Wrong number', 'Do not call'];
const HOT_OUTCOMES = ['Wants valuation', 'Listing opportunity', 'Wants to sell']; // these tick "Send to Kendal" automatically
const TABS = [
  ['all', 'All units'], ['exp90', 'Ending in 90 days'], ['up', 'Rent up 10%+'],
  ['port', 'Portfolio owners'], ['mort', 'Mortgaged'], ['never', 'Never called'],
];
const BEDS = ['Studio', '1', '2', '3', '4', '5', '6', '7'];
const EXPIRY = [['30', 'Within 30 days'], ['90', 'Within 90 days'], ['180', 'Within 6 months'], ['365', 'Within a year'], ['', 'Any time']];
const DATA_NOTE = 'Tenancies are registered Ejari contracts loaded to the end of September 2026';

// ── Styles ──────────────────────────────────────────────────────────────────
const CSS = `
:root{--bg:#ffffff;--ink:#1c2120;--muted:#6b7472;--faint:#9aa29f;--line:#e7e9e8;--hover:#f4f6f5;
  --accent:#0f5c56;--accent-ink:#ffffff;--blue:#1a6fe0;--warn:#a15c00;--bad:#b3261e;
  --f:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#141817;--ink:#e4e8e6;--muted:#9aa4a1;--faint:#6e7875;
  --line:#262d2b;--hover:#1b2120;--accent:#6cc3b8;--accent-ink:#0b1f1c;--blue:#4c95f5;--warn:#e9b25a;--bad:#ff8f86;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#141817;--ink:#e4e8e6;--muted:#9aa4a1;--faint:#6e7875;--line:#262d2b;--hover:#1b2120;
  --accent:#6cc3b8;--accent-ink:#0b1f1c;--blue:#4c95f5;--warn:#e9b25a;--bad:#ff8f86;color-scheme:dark}
*{box-sizing:border-box} html,body{margin:0}
body{background:var(--bg);color:var(--ink);font-family:var(--f);font-size:13px;line-height:1.45}
button,input,select,textarea{font:inherit;color:inherit} button{cursor:pointer}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.n{font-variant-numeric:tabular-nums} .muted{color:var(--muted)} .faint{color:var(--faint)}
.gut{padding-left:max(20px,env(safe-area-inset-left,0px));padding-right:max(20px,env(safe-area-inset-right,0px))}
.link{background:none;border:none;padding:0;color:var(--accent);text-decoration:none;cursor:pointer} .link:hover{text-decoration:underline}
.sub{display:block;color:var(--muted);font-size:12px} .soon{color:var(--warn)} .gone{color:var(--bad)} .err{color:var(--bad)}
header.top{position:sticky;top:0;z-index:20;background:var(--bg);border-bottom:1px solid var(--line)}
.bar{display:flex;align-items:center;gap:8px 22px;flex-wrap:wrap;padding-block:11px}
.brand{font-weight:600;font-size:14px}
.nav{display:flex;gap:16px} .nav button{background:none;border:none;padding:0;color:var(--muted)} .nav button.on,.nav button:hover{color:var(--ink)}
.right{margin-left:auto;display:flex;gap:18px;color:var(--muted);flex-wrap:wrap;align-items:center}
.theme{display:inline-flex;border:1px solid var(--line);border-radius:6px;overflow:hidden}
.theme button{background:none;border:none;padding:3px 8px;color:var(--muted);font-size:12px}
.theme button[aria-pressed="true"]{background:var(--hover);color:var(--ink)}
.head{padding-block:22px 6px} .head h1{font-size:20px;font-weight:600;margin:0} .head p{margin:3px 0 0;color:var(--muted)}
.layout{display:grid;grid-template-columns:210px minmax(0,1fr);gap:36px;padding-block:18px 60px;align-items:start}
.filters{display:flex;flex-direction:column;gap:20px;position:sticky;top:60px;max-height:calc(100vh - 80px);overflow:auto;padding-bottom:20px}
.filters h3{font-size:12px;font-weight:600;margin:0 0 6px}
.filters input[type=search],.filters input[type=number],.filters input[type=date],.filters select{width:100%;padding:5px 7px;border:1px solid var(--line);border-radius:4px;background:var(--bg);font-size:12.5px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.cb{display:flex;gap:7px;align-items:center;padding:2px 0;cursor:pointer} .cb input{margin:0;accent-color:var(--accent)}
.tabs{display:flex;gap:20px;border-bottom:1px solid var(--line);margin-bottom:4px;overflow-x:auto}
.tab{background:none;border:none;padding:8px 0 9px;color:var(--muted);border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap}
.tab:hover{color:var(--ink)} .tab.on{color:var(--ink);border-bottom-color:var(--ink);font-weight:500} .tab .c{color:var(--faint);margin-left:5px}
.meta{display:flex;justify-content:space-between;align-items:center;gap:10px;padding-block:10px;color:var(--muted);flex-wrap:wrap}
.tw{overflow-x:auto;transition:opacity .15s;border:1px solid var(--line);border-radius:8px} .tw.busy{opacity:.55}
table.grid{min-width:0;width:100%}
.grid th{position:sticky;top:0;background:var(--bg);padding:9px 14px;border-bottom:1px solid var(--line);font-size:11.5px;letter-spacing:.02em}
.grid td{padding:0 14px;height:44px;vertical-align:middle;white-space:nowrap;border-bottom:1px solid var(--line)}
.grid tbody tr:last-child td{border-bottom:none}
.grid td+td,.grid th+th{border-left:1px solid var(--line)}
.grid .clip{display:inline-block;max-width:240px;overflow:hidden;text-overflow:ellipsis;vertical-align:middle}
.grid .strong{font-weight:500}
.grid .callcol{width:1%;text-align:right;border-left:none}
.grid .up{color:var(--accent)} .grid .down{color:var(--bad)}
.picker{position:relative}
.menu{position:absolute;right:0;top:calc(100% + 6px);z-index:30;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px;width:320px;box-shadow:0 8px 24px rgba(0,0,0,.12)}
.sets{display:flex;flex-wrap:wrap;gap:6px;padding-bottom:10px;margin-bottom:8px;border-bottom:1px solid var(--line)}
.chip{border:1px solid var(--line);background:var(--bg);border-radius:999px;padding:3px 10px;font-size:12px}
.chip.on{border-color:var(--accent);color:var(--accent)}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:0 10px}
table{border-collapse:collapse;width:100%;min-width:980px}
th{text-align:left;font-weight:500;color:var(--muted);font-size:12px;padding:8px 10px 8px 0;border-bottom:1px solid var(--line);white-space:nowrap}
th button{background:none;border:none;padding:0;color:inherit} th button.on{color:var(--ink)}
.th{display:inline-flex;align-items:center;gap:6px} th.r .th{flex-direction:row-reverse}
.fbtn{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:4px;color:var(--faint)!important;opacity:.55}
th:hover .fbtn,.fbtn.open,.fbtn.on{opacity:1} .fbtn:hover,.fbtn.open{background:var(--hover);color:var(--ink)!important}
.fbtn.on{color:var(--accent)!important}
.hf{position:fixed;z-index:40;width:260px;background:var(--bg);border:1px solid var(--line);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.14);font-size:13px;letter-spacing:0;font-weight:400;text-align:left}
.hf-h{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid var(--line)}
.hf .pair{display:grid;grid-template-columns:1fr 1fr;gap:8px} .hf .pair input{width:100%;min-width:0}
.hf-b{padding:10px 12px;display:grid;gap:2px;max-height:340px;overflow:auto} .hf-b select,.hf-b input[type=search]{width:100%}
td{padding:10px 10px 10px 0;border-bottom:1px solid var(--line);vertical-align:top}
tbody tr{cursor:pointer} tbody tr:hover td{background:var(--hover)}
td.r,th.r{text-align:right} .unit{font-weight:600}
.ph{color:var(--muted);user-select:none;-webkit-user-select:none;white-space:nowrap}
.dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:6px;vertical-align:1px;background:var(--faint)}
.dot.t{background:var(--accent)} .dot.v{background:var(--warn)}
.btn{border:1px solid var(--line);background:var(--bg);border-radius:4px;padding:4px 11px;color:var(--ink)}
.btn:hover{border-color:var(--accent);color:var(--accent)} .btn[disabled]{opacity:.4;cursor:not-allowed}
.btn.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.empty{padding:40px 0;color:var(--muted)} .pager{display:flex;gap:16px;justify-content:center;padding:16px 0}
.loadbar{position:fixed;top:0;left:0;height:2px;width:100%;z-index:100;background:linear-gradient(90deg,transparent,var(--accent),transparent);
  background-size:50% 100%;background-repeat:no-repeat;animation:load .9s linear infinite}
@keyframes load{from{background-position:-50% 0}to{background-position:150% 0}}
.scrim{position:fixed;inset:0;background:rgba(0,0,0,.18);z-index:40}
.panel{position:fixed;top:0;right:0;bottom:0;width:min(500px,100%);background:var(--bg);z-index:41;border-left:1px solid var(--line);overflow:auto;
  padding:calc(20px + env(safe-area-inset-top,0px)) max(24px,env(safe-area-inset-right,0px)) calc(40px + env(safe-area-inset-bottom,0px)) 24px}
.panel-head{display:flex;justify-content:space-between;gap:12px;margin-bottom:18px} .panel-head h2{margin:0;font-size:18px;font-weight:600}
.x{background:none;border:none;font-size:20px;line-height:1;color:var(--muted);padding:0 2px}
.blk{border-top:1px solid var(--line);padding-block:14px} .blk h4{margin:0 0 10px;font-size:12px;font-weight:600;color:var(--muted)}
dl{display:grid;grid-template-columns:150px 1fr;gap:6px 12px;margin:0} dt{color:var(--muted)} dd{margin:0}
.owner{display:flex;justify-content:space-between;gap:10px;padding-block:8px} .owner+.owner{border-top:1px dashed var(--line)}
.fine{color:var(--faint);font-size:12px;margin-top:14px}
.modal{position:fixed;inset:0;z-index:70;display:grid;place-items:center;background:rgba(0,0,0,.25);padding:16px}
.box{background:var(--bg);border-radius:8px;width:min(400px,100%);padding:20px 22px;border:1px solid var(--line)}
.box h3{margin:0 0 4px;font-size:16px;font-weight:600}
.radios{display:grid;grid-template-columns:1fr 1fr;gap:2px 12px;margin:14px 0}
.notebox{margin:0 0 8px!important;min-height:64px!important}
.noteact{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px}
.note{border-top:1px solid var(--line);padding:9px 0}
.note p{margin:0 0 3px;white-space:pre-wrap;overflow-wrap:anywhere}
textarea{width:100%;border:1px solid var(--line);border-radius:4px;padding:7px;background:var(--bg);min-height:54px;resize:vertical;margin:10px 0 14px}
.toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:8px 14px;border-radius:6px;z-index:90}
.audit div{display:grid;grid-template-columns:120px 160px 1fr;gap:10px;padding:6px 0;border-bottom:1px solid var(--line)} .audit .bad{color:var(--bad)}
.login{max-width:340px;margin:12vh auto;padding:0 20px} .login h1{font-size:20px;margin:0 0 4px}
.login form{display:flex;flex-direction:column;gap:10px;margin-top:20px} .login input{padding:9px 10px;border:1px solid var(--line);border-radius:6px;background:var(--bg)}
.phone{max-width:460px;margin:0 auto;padding:calc(20px + env(safe-area-inset-top,0px)) 20px 40px;min-height:100vh;display:flex;flex-direction:column;gap:18px}
.phone h1{font-size:18px;margin:0}
.callcard,.alerts{border:1px solid var(--line);border-radius:16px;padding:18px;display:flex;flex-direction:column;gap:6px}
.callcard .who{font-size:20px;font-weight:600} .alerts .ok{color:var(--accent);font-weight:600}
.bigcall{background:var(--blue);color:#fff;border:none;border-radius:999px;padding:16px;font-size:17px;font-weight:600;margin-top:10px;width:100%}
.bigcall[disabled]{opacity:.5}
.waiting{color:var(--muted);text-align:center;padding:50px 0}
.outcomes{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.outcomes button{border:1px solid var(--line);background:var(--bg);border-radius:10px;padding:12px;text-align:left}
.outcomes button.on{border-color:var(--accent);color:var(--accent);font-weight:600}
@media (max-width:820px){.layout{grid-template-columns:1fr;gap:10px}.filters{position:static;max-height:none}.right{margin-left:0;width:100%}}
@media (prefers-reduced-motion:reduce){.loadbar{animation:none;background:var(--accent)}}
`;

// ── Small helpers ───────────────────────────────────────────────────────────
const fmt = (n) => (n == null || n === '' ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }));
const iso = (d) => (d ? String(d).slice(0, 10) : null);
const fd = (d) => (iso(d) ? new Date(iso(d) + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
const fdt = (d) => new Date(d).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const todayDubai = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());
const daysTo = (d) => (iso(d) ? Math.round((Date.parse(iso(d)) - Date.parse(todayDubai())) / 864e5) : null);
const bedsLabel = (b) => (!b ? '—' : b === 'Studio' ? 'Studio' : `${b} bed`);
const placeOf = (u) => (u.unit_type === 'Villa' ? u.subcommunity : u.building);
const pct = (a, b) => (a && b ? Math.round((Number(a) / Number(b) - 1) * 100) : null);

// ── Sign-in and server calls ────────────────────────────────────────────────
let supa = null;
async function getSupa() {
  if (supa) return supa;
  const cfg = await fetch('/api/config').then((r) => r.json());
  supa = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  return supa;
}
async function api(path, opts = {}) {
  const sb = await getSupa();
  const { data } = await sb.auth.getSession();
  const r = await fetch(path, {
    ...opts,
    signal: opts.signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token || ''}`, ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { window.dispatchEvent(new Event('signed-out')); }
  if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong. Try again.'), { status: r.status });
  return j;
}

// ── App shell ───────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(undefined);
  const isPhone = window.location.pathname.startsWith('/phone');

  useEffect(() => {
    let off;
    getSupa().then((sb) => {
      sb.auth.getSession().then(({ data }) => setSession(data.session));
      off = sb.auth.onAuthStateChange((_e, s) => setSession(s)).data.subscription;
    });
    const out = () => getSupa().then((sb) => sb.auth.signOut());
    window.addEventListener('signed-out', out);
    return () => { off?.unsubscribe(); window.removeEventListener('signed-out', out); };
  }, []);

  return (
    <>
      <style>{CSS}</style>
      {session === undefined ? null : !session ? <Login /> : isPhone ? <PhoneScreen /> : <Desk />}
    </>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr('');
    const sb = await getSupa();
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setErr('Email or password is wrong.');
  }
  return (
    <main className="login">
      <h1>Apex Owner Desk</h1>
      <p className="muted">Sign in with your Apex account.</p>
      <form onSubmit={submit}>
        <input id="email" type="email" autoComplete="username" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input id="password" type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {err && <span className="err">{err}</span>}
        <button className="btn primary" disabled={busy} type="submit">{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}

function ThemeToggle() {
  const [mode, setMode] = useState(() => { try { return localStorage.getItem('theme') || 'system'; } catch { return 'system'; } });
  const pick = (m) => {
    setMode(m);
    try { localStorage.setItem('theme', m); } catch {}
    if (m === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', m);
  };
  return (
    <span className="theme" role="group" aria-label="Theme">
      {[['light', 'Light'], ['dark', 'Dark'], ['system', 'Auto']].map(([m, l]) => (
        <button key={m} type="button" aria-pressed={mode === m} onClick={() => pick(m)}>{l}</button>
      ))}
    </span>
  );
}

// ── Laptop: owner list, unit panel, activity ────────────────────────────────
const EMPTY = { q: '', sc: '', bld: '', st: [], exp: '', from: '', to: '', type: [], beds: [], smin: '', smax: '', rmin: '', rmax: '', pmin: '', pmax: '',
  first: false, ren2: false, up: false, down: false, port: false, mort: false, ind: false, phone: false,
  ncall: false, called: false, oc: [] };

function toParams(f, tab, sort, page) {
  const p = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
    else if (v === true) p.set(k, '1');
    else if (v) p.set(k, v);
  });
  p.set('tab', tab); p.set('sort', sort); p.set('page', String(page));
  return p;
}

function Desk() {
  const [view, setView] = useState('owners');
  const [me, setMe] = useState(null);
  const [toast, setToast] = useState('');
  const [unitId, setUnitId] = useState(null);

  const refreshMe = useCallback(() => api('/api/desk?action=me').then(setMe).catch((e) => setToast(e.message)), []);
  useEffect(() => { refreshMe(); }, [refreshMe]);

  // Copy protection: blocks copying owner data and logs the attempt
  useEffect(() => {
    const onCopy = (e) => {
      if (e.target?.closest?.('input,textarea')) return;
      e.preventDefault();
      setToast('Copying is turned off. This was logged.');
      api('/api/desk?action=copyBlocked', { method: 'POST' }).catch(() => {});
    };
    const onMenu = (e) => { if (e.target?.closest?.('.tw,.panel')) e.preventDefault(); };
    document.addEventListener('copy', onCopy);
    document.addEventListener('contextmenu', onMenu);
    return () => { document.removeEventListener('copy', onCopy); document.removeEventListener('contextmenu', onMenu); };
  }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2600); return () => clearTimeout(t); }, [toast]);

  return (
    <>
      <header className="top">
        <div className="bar gut">
          <span className="brand">Apex Owner Desk</span>
          <nav className="nav">
            <button className={view === 'owners' ? 'on' : ''} onClick={() => setView('owners')}>Owners</button>
            <button className={view === 'activity' ? 'on' : ''} onClick={() => setView('activity')}>Activity</button>
            <a className="link" style={{ color: 'var(--muted)' }} href="/phone">Phone</a>
          </nav>
          <div className="right">
            {me && <span>Profiles <span className="n">{me.caps.profiles}/{me.caps.profileCap}</span></span>}
            {me && <span>Calls <span className="n">{me.caps.calls}/{me.caps.callCap}</span></span>}
            <ThemeToggle />
            {me && <span>{me.staff.name}</span>}
            <button className="link" onClick={() => getSupa().then((sb) => sb.auth.signOut())}>Sign out</button>
          </div>
        </div>
      </header>
      {view === 'owners' ? <Owners places={me?.places || []} onOpen={setUnitId} /> : <Activity />}
      {unitId && <UnitPanel id={unitId} onClose={() => setUnitId(null)} onOpen={setUnitId} onCaps={refreshMe} />}
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

function Owners({ places, onOpen }) {
  const [f, setF] = useState(EMPTY);
  const [tab, setTab] = useState('all');
  const [sort, setSort] = useState('unit');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ctl = useRef(null);
  const timer = useRef(null);
  const [calling, setCalling] = useState(null);
  const [cols, setColsState] = useState(loadCols);
  const setCols = (next) => { setColsState(next); try { localStorage.setItem('columns', JSON.stringify(next)); } catch {} };
  const shown = COLUMNS.filter((c) => cols.includes(c.k));

  // Ask the server for the list. Typed fields wait for a short pause; everything else is instant.
  const load = useCallback((ff, t, s, p) => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setBusy(true);
    api('/api/desk?action=units&' + toParams(ff, t, s, p).toString(), { signal: c.signal })
      .then((j) => { setData(j); setErr(''); })
      .catch((e) => { if (e.name !== 'AbortError') setErr(e.message); })
      .finally(() => { if (ctl.current === c) setBusy(false); });
  }, []);
  useEffect(() => { load(EMPTY, 'all', 'unit', 1); }, [load]);

  const change = (patch, typed) => {
    const nf = { ...f, ...patch };
    setF(nf); setPage(1);
    clearTimeout(timer.current);
    if (typed) timer.current = setTimeout(() => load(nf, tab, sort, 1), 300);
    else load(nf, tab, sort, 1);
  };
  const toggle = (k, v) => change({ [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] });
  const goTab = (t) => { setTab(t); setPage(1); load(f, t, sort, 1); };
  const goSort = (s) => { setSort(s); setPage(1); load(f, tab, s, 1); };
  const goPage = (p) => { setPage(p); load(f, tab, sort, p); window.scrollTo({ top: 0 }); };

  const subcommunities = useMemo(() => [...new Set(places.map((p) => p.sc))], [places]);
  const buildings = useMemo(() => places.filter((p) => p.bld && (!f.sc || p.sc === f.sc)).map((p) => p.bld), [places, f.sc]);
  const c = data?.counts || {};
  const total = c[tab] ?? 0;
  const pages = Math.max(1, Math.ceil(total / (data?.pageSize || 100)));

  // Plain render helpers (not components) so inputs keep focus while typing
  const box = (k, v, label) => (
    <label className="cb" key={k + v}><input type="checkbox" checked={f[k].includes(v)} onChange={() => toggle(k, v)} />{label ?? v}</label>
  );
  const flag = (k, label) => (
    <label className="cb" key={k}><input type="checkbox" checked={f[k]} onChange={(e) => change({ [k]: e.target.checked })} />{label}</label>
  );
  const num = (k, ph) => (
    <input key={k} type="number" inputMode="numeric" placeholder={ph} value={f[k]} onChange={(e) => change({ [k]: e.target.value }, true)} />
  );
  // Filters on the column headings. They use the same choices as the side panel, so both always agree.
  const [fcol, setFcol] = useState(null); // { k, x, y } of the open heading filter
  useEffect(() => {
    if (!fcol) return;
    const close = (e) => { if (!e.target.closest?.('.hf,.fbtn')) setFcol(null); };
    const esc = (e) => e.key === 'Escape' && setFcol(null);
    const gone = () => setFcol(null);
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    window.addEventListener('scroll', gone, true); window.addEventListener('resize', gone);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', gone, true); window.removeEventListener('resize', gone); };
  }, [fcol]);
  const pick = (k, list) => (
    <select value={f[k]} onChange={(e) => change(k === 'sc' ? { sc: e.target.value, bld: '' } : { [k]: e.target.value })}>
      <option value="">All</option>{list.map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}
    </select>
  );
  const ends = () => <>
    {EXPIRY.map(([v, l]) => <label className="cb" key={v}><input type="radio" name="hexp" checked={f.exp === v} onChange={() => change({ exp: v })} />{l}</label>)}
    <div className="pair" style={{ marginTop: 6 }}>
      <input type="date" aria-label="Ends from" value={f.from} onChange={(e) => change({ from: e.target.value })} />
      <input type="date" aria-label="Ends to" value={f.to} onChange={(e) => change({ to: e.target.value })} />
    </div></>;
  const search = () => <input type="search" autoFocus placeholder="Search owner, building or unit" value={f.q} onChange={(e) => change({ q: e.target.value }, true)} />;
  const HEAD_FILTERS = {
    unit: { on: ['q'], ui: search },
    place: { on: ['bld'], ui: () => pick('bld', buildings) },
    sc: { on: ['sc'], ui: () => pick('sc', subcommunities) },
    type: { on: ['type'], ui: () => <>{box('type', 'Apartment')}{box('type', 'Villa')}</> },
    beds: { on: ['beds'], ui: () => <div className="cols">{BEDS.map((b) => box('beds', b, bedsLabel(b)))}</div> },
    size: { on: ['smin', 'smax'], ui: () => <div className="pair">{num('smin', 'Min')}{num('smax', 'Max')}</div> },
    lease: { on: ['st'], ui: () => ['Live Ejari', 'No live Ejari', 'Not confirmed'].map((v) => box('st', v)) },
    renewals: { on: ['first', 'ren2'], ui: () => <>{flag('first', 'First year (no renewals)')}{flag('ren2', 'Renewed 2+ times')}</> },
    ends: { on: ['exp', 'from', 'to'], ui: ends },
    days: { on: ['exp', 'from', 'to'], ui: ends },
    rent: { on: ['rmin', 'rmax'], ui: () => <div className="pair">{num('rmin', 'Min')}{num('rmax', 'Max')}</div> },
    change: { on: ['up', 'down'], ui: () => <>{flag('up', 'Rent went up')}{flag('down', 'Rent went down')}</> },
    sale: { on: ['pmin', 'pmax'], ui: () => <div className="pair">{num('pmin', 'Min')}{num('pmax', 'Max')}</div> },
    owner: { on: ['q', 'ind'], ui: () => <>{search()}<div style={{ marginTop: 8 }}>{flag('ind', 'Individuals only')}</div></> },
    mobile: { on: ['phone'], ui: () => flag('phone', 'Has a mobile number') },
    owned: { on: ['port'], ui: () => flag('port', 'Owns 2+ units here') },
    mortgaged: { on: ['mort'], ui: () => flag('mort', 'Mortgaged') },
    lastcall: { on: ['ncall', 'called'], ui: () => <>{flag('ncall', 'Never called')}{flag('called', 'Called before')}</> },
    outcome: { on: ['oc'], ui: () => OUTCOMES.map((o) => box('oc', o)) },
  };
  const isOn = (keys) => keys.some((k) => (Array.isArray(f[k]) ? f[k].length > 0 : !!f[k]));
  const clearKeys = (keys) => change(Object.fromEntries(keys.map((k) => [k, EMPTY[k]])));
  const openHead = (k, e) => {
    if (fcol?.k === k) return setFcol(null);
    const r = e.currentTarget.getBoundingClientRect();
    setFcol({ k, x: Math.max(8, Math.min(r.left, window.innerWidth - 268)), y: r.bottom + 6 });
  };

  const sortBtn = (k, label) => <button className={sort === k ? 'on' : ''} onClick={() => goSort(k)}>{label}{sort === k ? ' ↓' : ''}</button>;

  return (
    <>
      {busy && <div className="loadbar" />}
      <div className="head gut">
        <h1>Owners</h1>
        <p>{fmt(c.all)} units in your areas · {DATA_NOTE}</p>
      </div>
      <main className="layout gut">
        <aside className="filters">
          <div><input id="q" type="search" placeholder="Search owner, building or unit" value={f.q} autoComplete="off" onChange={(e) => change({ q: e.target.value }, true)} /></div>
          <div><h3>Sub-community</h3>
            <select id="sc" value={f.sc} onChange={(e) => change({ sc: e.target.value, bld: '' })}>
              <option value="">All</option>{subcommunities.map((s) => <option key={s}>{s}</option>)}
            </select></div>
          <div><h3>Building</h3>
            <select id="bld" value={f.bld} onChange={(e) => change({ bld: e.target.value })}>
              <option value="">All</option>{buildings.map((b) => <option key={b}>{b}</option>)}
            </select></div>
          <div><h3>Lease</h3>{['Live Ejari', 'No live Ejari', 'Not confirmed'].map((v) => box('st', v))}</div>
          <div><h3>Contract ends</h3>
            {EXPIRY.map(([v, l]) => <label className="cb" key={v}><input type="radio" name="exp" checked={f.exp === v} onChange={() => change({ exp: v })} />{l}</label>)}
            <div className="pair" style={{ marginTop: 6 }}>
              <input type="date" aria-label="Ends from" value={f.from} onChange={(e) => change({ from: e.target.value })} />
              <input type="date" aria-label="Ends to" value={f.to} onChange={(e) => change({ to: e.target.value })} />
            </div></div>
          <div><h3>Type</h3>{box('type', 'Apartment')}{box('type', 'Villa')}</div>
          <div><h3>Beds</h3>{BEDS.map((b) => box('beds', b, bedsLabel(b)))}</div>
          <div><h3>Size, sq ft</h3><div className="pair">{num('smin', 'Min')}{num('smax', 'Max')}</div></div>
          <div><h3>Rent, AED a year</h3><div className="pair">{num('rmin', 'Min')}{num('rmax', 'Max')}</div></div>
          <div><h3>Tenancy</h3>{flag('first', 'First year (no renewals)')}{flag('ren2', 'Renewed 2+ times')}{flag('up', 'Rent went up')}{flag('down', 'Rent went down')}</div>
          <div><h3>Last sale price, AED</h3><div className="pair">{num('pmin', 'Min')}{num('pmax', 'Max')}</div></div>
          <div><h3>Owner</h3>{flag('port', 'Owns 2+ units here')}{flag('mort', 'Mortgaged')}{flag('ind', 'Individuals only')}{flag('phone', 'Has a mobile number')}</div>
          <div><h3>Calls</h3>{flag('ncall', 'Never called')}{flag('called', 'Called before')}</div>
          <button className="link" style={{ textAlign: 'left' }} onClick={() => { setF(EMPTY); setPage(1); load(EMPTY, tab, sort, 1); }}>Clear filters</button>
        </aside>

        <section style={{ minWidth: 0 }}>
          <nav className="tabs">
            {TABS.map(([k, l]) => <button key={k} className={'tab' + (tab === k ? ' on' : '')} onClick={() => goTab(k)}>{l}<span className="c n">{fmt(c[k])}</span></button>)}
          </nav>
          <div className="meta">
            <span>{fmt(total)} units · page {page} of {pages}</span>
            <ColumnPicker cols={cols} setCols={setCols} />
          </div>
          {err && <p className="err">{err}</p>}
          <div className={'tw' + (busy ? ' busy' : '')}>
            <table className="grid">
              <thead><tr>
                {shown.map((col) => {
                  const hf = HEAD_FILTERS[col.k];
                  const on = hf && isOn(hf.on);
                  return (
                    <th key={col.k} className={col.right ? 'r' : ''}>
                      <span className="th">
                        {col.sort ? sortBtn(col.sort, col.label) : col.label}
                        {hf && <button className={'fbtn' + (on ? ' on' : '') + (fcol?.k === col.k ? ' open' : '')} aria-label={'Filter ' + col.label}
                          title={'Filter ' + col.label} onClick={(e) => openHead(col.k, e)}>
                          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 2.5h9L7 6.6v3.2l-2 .9V6.6z" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" /></svg>
                        </button>}
                      </span>
                    </th>
                  );
                })}
                <th className="callcol" aria-label="Call" />
              </tr></thead>
              <tbody>
                {data && data.rows.length === 0 && <tr><td colSpan={shown.length + 1} className="empty">Nothing matches. Try clearing a filter.</td></tr>}
                {data?.rows.map((r) => <OwnerRow key={r.id} r={r} cols={shown} onOpen={onOpen} onCall={setCalling} />)}
              </tbody>
            </table>
          </div>
          {fcol && HEAD_FILTERS[fcol.k] && (
            <div className="hf" style={{ left: fcol.x, top: fcol.y }} role="dialog" aria-label="Column filter">
              <div className="hf-h"><b>{COLUMNS.find((c) => c.k === fcol.k)?.label}</b>
                {isOn(HEAD_FILTERS[fcol.k].on) && <button className="link" onClick={() => clearKeys(HEAD_FILTERS[fcol.k].on)}>Clear</button>}</div>
              <div className="hf-b">{HEAD_FILTERS[fcol.k].ui()}</div>
            </div>
          )}
          <div className="pager">
            {page > 1 && <button className="link" onClick={() => goPage(page - 1)}>Previous</button>}
            {page < pages && <button className="link" onClick={() => goPage(page + 1)}>Next</button>}
          </div>
        </section>
      </main>
      {calling && <CallFlow unitId={calling.r.id} owner={{ id: calling.r.owner_id, name: calling.r.owner_name }}
        label={`${calling.r.owner_name}, ${placeOf(calling.r)} ${calling.r.unit_no}`}
        onClose={(saved) => { setCalling(null); if (saved) load(f, tab, sort, page); }} />}
    </>
  );
}

function LeaseCell({ r }) {
  const cls = r.lease_status === 'Live Ejari' ? 't' : r.lease_status === 'No live Ejari' ? 'v' : '';
  return (
    <><span className={'dot ' + cls} />{r.lease_status === 'Not confirmed' ? <span className="muted">Not confirmed</span> : r.lease_status}
      {r.lease_status === 'Live Ejari' && r.renewals != null && <span className="sub">{r.renewals === 0 ? 'first year' : `renewed ${r.renewals}×`}</span>}</>
  );
}
function EndsCell({ d }) {
  if (!d) return <span className="muted">—</span>;
  const n = daysTo(d);
  return <><span className="n">{fd(d)}</span><span className={'sub ' + (n < 0 ? 'gone' : n <= 90 ? 'soon' : '')}>{n < 0 ? `ended ${-n} days ago` : `in ${n} days`}</span></>;
}

// ── Owner list columns ──────────────────────────────────────────────────────
// Each column: key, header label, how to draw the cell. Add, remove or reorder here.
const titleCase = (s) => (s ? s.toLowerCase().replace(/(^|[\s'-])\S/g, (m) => m.toUpperCase()).replace(/\b(Llc|Fzco|Fze|Dmcc|Pjsc|Psc|Ltd)\b/g, (m) => m.toUpperCase()) : '');
const dash = <span className="faint">—</span>;
const LEASE_SHORT = { 'Live Ejari': 'Live', 'No live Ejari': 'None', 'Not confirmed': 'Unknown' };

const COLUMNS = [
  { k: 'unit', label: 'Unit', sort: 'unit', cell: (r) => <b>{r.unit_no}</b> },
  { k: 'place', label: 'Building', cell: (r) => <span className="clip" title={titleCase(placeOf(r))}>{titleCase(placeOf(r))}</span> },
  { k: 'sc', label: 'Sub-community', cell: (r) => <span className="clip" title={titleCase(r.subcommunity)}>{titleCase(r.subcommunity)}</span> },
  { k: 'type', label: 'Type', cell: (r) => (r.unit_type === 'Villa' ? 'Villa' : 'Apartment') },
  { k: 'beds', label: 'Beds', cell: (r) => bedsLabel(r.beds) },
  { k: 'size', label: 'Size (sq ft)', right: true, sort: 'size', cell: (r) => (r.size_sqft ? fmt(r.size_sqft) : dash) },
  { k: 'lease', label: 'Ejari', cell: (r) => {
    const cls = r.lease_status === 'Live Ejari' ? 't' : r.lease_status === 'No live Ejari' ? 'v' : '';
    return <span className={r.lease_status === 'Not confirmed' ? 'faint' : ''}><span className={'dot ' + cls} />{LEASE_SHORT[r.lease_status]}</span>;
  } },
  { k: 'renewals', label: 'Renewals', right: true, cell: (r) => (r.renewals == null ? dash : r.renewals) },
  { k: 'ends', label: 'Contract ends', sort: 'end', cell: (r) => (r.end_date ? fd(r.end_date) : dash) },
  { k: 'days', label: 'Days left', right: true, cell: (r) => {
    const n = daysTo(r.end_date);
    if (n == null) return dash;
    return <span className={n < 0 ? 'gone' : n <= 90 ? 'soon' : ''}>{n < 0 ? `ended` : n}</span>;
  } },
  { k: 'rent', label: 'Rent (AED)', right: true, sort: 'rent', cell: (r) => (r.annual_rent ? fmt(r.annual_rent) : dash) },
  { k: 'change', label: 'Rent change', right: true, cell: (r) => {
    const c = pct(r.annual_rent, r.prev_rent);
    return c == null ? dash : <span className={c > 0 ? 'up' : c < 0 ? 'down' : ''}>{c > 0 ? '+' : ''}{c}%</span>;
  } },
  { k: 'sale', label: 'Last sale (AED)', right: true, sort: 'sale', cell: (r) => (r.last_sale_price ? fmt(r.last_sale_price) : dash) },
  { k: 'owner', label: 'Owner', cell: (r) => <span className="clip strong" title={titleCase(r.owner_name)}>{r.owner_name ? titleCase(r.owner_name) : '—'}</span> },
  { k: 'mobile', label: 'Mobile', cell: (r) => <span className="ph">{r.owner_masked ?? <span className="faint">none</span>}</span> },
  { k: 'owned', label: 'Units owned', right: true, cell: (r) => r.owner_units },
  { k: 'coowners', label: 'Co-owners', right: true, cell: (r) => (r.owners_n > 1 ? r.owners_n - 1 : dash) },
  { k: 'mortgaged', label: 'Mortgaged', cell: (r) => (r.mortgaged ? 'Yes' : dash) },
  { k: 'lastcall', label: 'Last called', cell: (r) => (r.last_called ? fd(r.last_called) : <span className="faint">Never</span>) },
  { k: 'outcome', label: 'Last outcome', cell: (r) => r.last_outcome ?? dash },
  { k: 'note', label: 'Last note', cell: (r) => (r.last_note ? <span className="clip" title={r.last_note}>{r.last_note}</span> : dash) },
];

const COLUMN_SETS = [
  ['Names and numbers', ['unit', 'place', 'owner', 'mobile', 'lastcall']],
  ['Tenancy', ['unit', 'place', 'beds', 'lease', 'ends', 'days', 'rent', 'change', 'owner', 'mobile', 'lastcall']],
  ['Ownership', ['unit', 'place', 'beds', 'size', 'sale', 'owner', 'owned', 'coowners', 'mortgaged', 'mobile']],
  ['Everything', COLUMNS.map((c) => c.k)],
];
const DEFAULT_COLS = COLUMN_SETS[1][1];
function loadCols() {
  try {
    const v = JSON.parse(localStorage.getItem('columns') || 'null');
    if (Array.isArray(v) && v.length) return v.filter((k) => COLUMNS.some((c) => c.k === k));
  } catch {}
  return DEFAULT_COLS;
}

function ColumnPicker({ cols, setCols }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const toggle = (k) => {
    const next = cols.includes(k) ? cols.filter((x) => x !== k) : COLUMNS.map((c) => c.k).filter((x) => cols.includes(x) || x === k);
    if (next.length) setCols(next);
  };
  const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  return (
    <div className="picker" ref={ref}>
      <button className="btn" onClick={() => setOpen(!open)} aria-expanded={open}>Columns · {cols.length}</button>
      {open && (
        <div className="menu">
          <div className="sets">
            {COLUMN_SETS.map(([name, keys]) => (
              <button key={name} className={'chip' + (same(cols, keys) ? ' on' : '')} onClick={() => setCols(keys)}>{name}</button>
            ))}
          </div>
          <div className="cols">
            {COLUMNS.map((c) => (
              <label key={c.k} className="cb"><input type="checkbox" checked={cols.includes(c.k)} onChange={() => toggle(c.k)} />{c.label}</label>
            ))}
          </div>
          <p className="faint" style={{ margin: '8px 0 0' }}>Saved on this computer.</p>
        </div>
      )}
    </div>
  );
}

const OwnerRow = React.memo(function OwnerRow({ r, cols, onOpen, onCall }) {
  return (
    <tr onClick={() => onOpen(r.id)}>
      {cols.map((c) => <td key={c.k} className={c.right ? 'r n' : ''}>{c.cell(r)}</td>)}
      <td className="callcol">{r.owner_id && r.has_phone && <button className="btn" onClick={(e) => { e.stopPropagation(); onCall({ r }); }}>Call</button>}</td>
    </tr>
  );
});

function UnitPanel({ id, onClose, onOpen, onCaps }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [calling, setCalling] = useState(null);
  const load = useCallback(() => {
    setErr('');
    api('/api/desk?action=unit&id=' + id).then((j) => { setD(j); onCaps(); }).catch((e) => setErr(e.message));
  }, [id, onCaps]);
  useEffect(() => { setD(null); load(); }, [load]);
  useEffect(() => { const k = (e) => e.key === 'Escape' && !calling && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose, calling]);

  const u = d?.unit;
  const place = u ? (u.unit_type === 'Villa' ? u.subcommunity : `${u.building}, ${u.subcommunity}`) : '';
  const chg = u ? pct(u.annual_rent, u.prev_rent) : null;
  const days = u ? daysTo(u.end_date) : null;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="panel" aria-label="Unit">
        <div className="panel-head">
          <div>{u ? <><h2>{u.unit_type === 'Villa' ? 'Villa' : 'Unit'} {u.unit_no}</h2>
            <div className="muted">{place} · {bedsLabel(u.beds)} · {u.size_sqft ? `${fmt(u.size_sqft)} sq ft` : 'size not recorded'}</div></> : <h2>{err ? 'Not available' : 'Loading…'}</h2>}</div>
          <button className="x" aria-label="Close" onClick={onClose}>×</button>
        </div>
        {err && <p className="err">{err}</p>}
        {u && <>
          <div className="blk"><h4>Tenancy</h4><dl>
            <dt>Lease</dt><dd><LeaseCell r={u} /></dd>
            {u.end_date ? <>
              <dt>Contract ends</dt><dd>{fd(u.end_date)} <span className={days < 0 ? 'gone' : days <= 90 ? 'soon' : 'muted'}>({days < 0 ? `ended ${-days} days ago` : `in ${days} days`})</span></dd>
              <dt>Started</dt><dd>{fd(u.start_date)}</dd>
              <dt>Rent</dt><dd className="n">AED {fmt(u.annual_rent)} a year</dd>
              <dt>Previous rent</dt><dd className="n">{u.prev_rent ? <>AED {fmt(u.prev_rent)} {chg ? <span className="muted">({chg > 0 ? '+' : ''}{chg}%)</span> : null}</> : <span className="muted">not recorded</span>}</dd>
              <dt>Renewals</dt><dd>{u.renewals ?? '—'}</dd>
              <dt>Matched by</dt><dd>{u.matched_by === 'Size' ? 'registered size (unit number not returned)' : 'unit number'}</dd>
            </> : <><dt>Contract</dt><dd className="muted">{u.lease_status === 'No live Ejari' ? 'No registered contract running' : 'Not confirmed yet'}</dd></>}
          </dl></div>
          <div className="blk"><h4>Ownership</h4><dl>
            <dt>Last sale price</dt><dd className="n">{u.last_sale_price ? `AED ${fmt(u.last_sale_price)}` : <span className="muted">not available</span>}</dd>
            <dt>Finance</dt><dd>{u.mortgaged ? 'Mortgaged' : 'No bank on title'}</dd>
          </dl>
            <div style={{ marginTop: 10 }}>
              {d.owners.map((o) => (
                <div className="owner" key={o.id}>
                  <div>{o.name}
                    <span className="sub">{o.role === 'mortgagee' ? 'Mortgage bank' : o.is_company ? 'Company' : 'Individual'}
                      {o.role === 'owner' && <> · <span className="ph">{o.masked ?? 'no mobile'}</span></>}{o.dnc ? ' · asked not to be called' : ''}</span>
                    {o.role === 'owner' && o.units > 1 && <span className="sub">Also owns {d.others.filter((x) => x.owner_id === o.id).map((x) => (
                      <button key={x.id} className="link" style={{ marginRight: 8 }} onClick={() => onOpen(x.id)}>{x.unit_type === 'Villa' ? x.subcommunity : x.building} {x.unit_no}</button>))}</span>}
                  </div>
                  <div>{o.role === 'owner' && o.has_phone && !o.dnc && <button className="btn" onClick={() => setCalling(o)}>Call</button>}</div>
                </div>
              ))}
            </div>
          </div>
          <Notes unitId={u.id} notes={d.notes} onAdded={(n) => setD((x) => ({ ...x, notes: [n, ...x.notes] }))} />
          <div className="blk"><h4>Calls</h4>
            {d.calls.length === 0 ? <p className="muted">Not called yet</p> : d.calls.map((c, i) => (
              <div key={i} className="owner"><span>{c.outcome ?? 'No outcome logged'}{c.note && <span className="sub">{c.note}</span>}</span>
                <span className="muted">{c.full_name}, {fdt(c.called_at)}</span></div>
            ))}
          </div>
          <p className="fine">The full number never reaches this laptop. Call sends it to your phone and logs it under your name.</p>
        </>}
      </aside>
      {calling && u && <CallFlow unitId={u.id} owner={calling} label={`${calling.name}, ${place} ${u.unit_no}`}
        onClose={(saved) => { setCalling(null); onCaps(); if (saved) load(); }} />}
    </>
  );
}

// Notes on a unit. Anyone with the area sees them; they stay on the record with the writer's name.
function Notes({ unitId, notes, onAdded }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function save() {
    if (!text.trim()) return;
    setBusy(true); setErr('');
    try { const j = await api('/api/desk?action=addNote', { method: 'POST', body: { unitId, body: text } }); onAdded(j.note); setText(''); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }
  return (
    <div className="blk"><h4>Notes</h4>
      <textarea className="notebox" placeholder="Add a note about this unit or owner" value={text} maxLength={2000}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); }} />
      <div className="noteact">
        <span className="faint">Ctrl/⌘ + Enter to save</span>
        <button className="btn primary" disabled={!text.trim() || busy} onClick={save}>{busy ? 'Saving…' : 'Save note'}</button>
      </div>
      {err && <p className="err">{err}</p>}
      {notes.length === 0 ? <p className="muted">No notes yet</p> : notes.map((n) => (
        <div key={n.id} className="note">
          <p>{n.body}</p>
          <span className="faint">{n.full_name}, {fdt(n.created_at)}</span>
        </div>
      ))}
    </div>
  );
}

// Laptop side of a call: send to phone, wait for the tap, then log the outcome
function CallFlow({ unitId, owner, label, onClose }) {
  const [stage, setStage] = useState('sending');
  const [msg, setMsg] = useState('');
  const [req, setReq] = useState(null);

  useEffect(() => {
    api('/api/desk?action=call', { method: 'POST', body: { unitId, ownerId: owner.id } })
      .then((j) => { setReq(j); setStage('sent'); })
      .catch((e) => { setMsg(e.message); setStage('error'); });
  }, [unitId, owner.id]);
  useEffect(() => {
    if (!req || (stage !== 'sent' && stage !== 'dialled')) return;
    const t = setInterval(() => {
      api('/api/desk?action=callStatus&id=' + req.requestId).then((j) => {
        if (j.status === 'dialled' && stage === 'sent') setStage('dialled');
        if (j.status === 'done') setStage('done');
        if (j.status === 'expired') setStage('expired');
      }).catch(() => {});
    }, 2000);
    return () => clearInterval(t);
  }, [req, stage]);

  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget && stage !== 'dialled') onClose(stage === 'done'); }}>
      <div className="box" role="dialog" aria-label="Call">
        {stage === 'sending' && <><h3>Sending to your phone…</h3><p className="muted">{label}</p></>}
        {stage === 'error' && <><h3>Call not sent</h3><p className="muted">{msg}</p><button className="btn" onClick={() => onClose(false)}>Close</button></>}
        {stage === 'sent' && <><h3>Sent to your phone</h3><p className="muted">{label}</p>
          <p>{req.phones > 0 ? 'Tap the notification on your phone, then the blue Call button.' : 'Open Apex Desk on your phone and tap the blue Call button. Turn on call alerts there to get a notification next time.'}</p>
          <p className="faint">It expires in {req.minutes} minutes.</p>
          <button className="btn" onClick={() => onClose(false)}>Cancel</button></>}
        {stage === 'expired' && <><h3>Call expired</h3><p className="muted">It wasn&apos;t tapped on your phone in time. Press Call again.</p><button className="btn" onClick={() => onClose(false)}>Close</button></>}
        {stage === 'dialled' && <><h3>How did it go?</h3><p className="muted">{label}</p><OutcomeForm requestId={req.requestId} onSaved={() => setStage('done')} /></>}
        {stage === 'done' && <><h3>Saved</h3><p className="muted">The outcome is on the unit&apos;s call history.</p><button className="btn" onClick={() => onClose(true)}>Close</button></>}
      </div>
    </div>
  );
}

function OutcomeForm({ requestId, onSaved, big }) {
  const [pick, setPick] = useState('');
  const [note, setNote] = useState('');
  const [kendal, setKendal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const choose = (o) => { setPick(o); setKendal(HOT_OUTCOMES.includes(o)); };
  async function save() {
    setBusy(true); setErr('');
    try { await api('/api/phone?action=outcome', { method: 'POST', body: { requestId, outcome: pick, note, kendal } }); onSaved(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }
  return (
    <div>
      <div className={big ? 'outcomes' : 'radios'}>
        {OUTCOMES.map((o) => big
          ? <button key={o} type="button" className={pick === o ? 'on' : ''} onClick={() => choose(o)}>{o}</button>
          : <label className="cb" key={o}><input type="radio" name={`oc-${requestId}`} checked={pick === o} onChange={() => choose(o)} />{o}</label>)}
      </div>
      <label className="cb" style={{ marginTop: 10 }}><input type="checkbox" checked={kendal} onChange={(e) => setKendal(e.target.checked)} />Send to Kendal as a lead</label>
      <textarea placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
      {err && <p className="err">{err}</p>}
      <button className={big ? 'bigcall' : 'btn primary'} disabled={!pick || busy} onClick={save}>{busy ? 'Saving…' : 'Save outcome'}</button>
    </div>
  );
}

const ACTIVITY_LABEL = {
  searched: 'Searched', opened_unit: 'Opened a unit', call_sent: 'Sent a call to phone', call_dialled: 'Tapped Call on phone',
  outcome: 'Logged an outcome', copy_blocked: 'Tried to copy owner data', limit_hit: 'Hit a daily limit',
  call_blocked_hours: 'Tried to call outside 9am–6pm', dial_refused: 'Tapped an expired call', phone_alerts_on: 'Turned on phone alerts',
  note_added: 'Added a note',
};
const ACTIVITY_BAD = ['copy_blocked', 'limit_hit', 'call_blocked_hours', 'dial_refused'];

function Activity() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/api/desk?action=activity').then(setD).catch((e) => setErr(e.message)); }, []);
  return (
    <main className="gut" style={{ maxWidth: 1000, paddingBlock: '22px 60px' }}>
      <h2 style={{ marginTop: 0 }}>Activity</h2>
      <p className="muted">Everything done on the Owner Desk is recorded and can&apos;t be edited or deleted.{d?.all ? ' You are seeing everyone.' : ''}</p>
      {err && <p className="err">{err}</p>}
      <div className="audit">
        {d?.rows.map((r, i) => (
          <div key={i}>
            <span className="muted n">{fdt(r.at)}</span>
            <span>{r.full_name ?? '—'}</span>
            <span className={ACTIVITY_BAD.includes(r.action) ? 'bad' : ''}>{ACTIVITY_LABEL[r.action] ?? r.action}{r.unit ? ` · ${r.unit}` : ''}{r.action === 'outcome' && r.detail?.outcome ? ` · ${r.detail.outcome}` : ''}</span>
          </div>
        ))}
      </div>
    </main>
  );
}

// ── Phone screen (/phone) ───────────────────────────────────────────────────
const phonePlace = (x) => (x.unit_type === 'Villa' ? `${x.subcommunity} · villa ${x.unit_no}` : `${x.building} · ${x.unit_no}`);

function PhoneScreen() {
  const [st, setSt] = useState({ name: '', pending: null, awaiting: null });
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  const load = useCallback(() => api('/api/phone?action=pending').then(setSt).catch(() => {}), []);

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    const vis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [load]);

  async function dial(id) {
    setErr('');
    try {
      const j = await api('/api/phone?action=dial', { method: 'POST', body: { id } });
      setSt((s) => ({ ...s, pending: null }));
      window.location.href = 'tel:' + j.tel;
      setTimeout(load, 1500);
    } catch (e) { setErr(e.message); load(); }
  }

  const { name, pending, awaiting } = st;
  return (
    <main className="phone">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'start' }}>
        <div><h1>Apex Owner Desk</h1><span className="muted">{name ? `Signed in as ${name}` : ' '}</span></div>
        <ThemeToggle />
      </div>
      {pending && (
        <div className="callcard">
          <span className="muted">Call</span>
          <span className="who">{pending.owner_name}</span>
          <span>{phonePlace(pending)}</span>
          <span className="n muted">{pending.masked}</span>
          <button className="bigcall" onClick={() => dial(pending.id)}>Call</button>
        </div>
      )}
      {!pending && awaiting && !saved && (
        <div className="callcard">
          <span className="muted">How did the call go?</span>
          <span className="who">{awaiting.owner_name}</span>
          <span>{phonePlace(awaiting)}</span>
          <OutcomeForm big requestId={awaiting.id} onSaved={() => { setSaved(true); setTimeout(() => { setSaved(false); load(); }, 1500); }} />
        </div>
      )}
      {saved && <div className="waiting">Saved</div>}
      <PhoneAlerts onCall={load} />
      {!pending && !awaiting && !saved && <div className="waiting">Waiting for a call from your laptop.<br />Press Call next to an owner and it appears here.</div>}
      {err && <p className="err">{err}</p>}
      <button className="link" style={{ alignSelf: 'center' }} onClick={() => getSupa().then((sb) => sb.auth.signOut())}>Sign out</button>
    </main>
  );
}

const b64ToBytes = (b64) => {
  const raw = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

// Turns on call notifications for this phone. On iPhone it only works from the home screen icon.
function PhoneAlerts({ onCall }) {
  const [state, setState] = useState('checking');
  const [err, setErr] = useState('');
  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (!('serviceWorker' in navigator)) { setState('unsupported'); return; }
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    const onMsg = (e) => { if (e.data?.type === 'call') onCall(); };
    navigator.serviceWorker.addEventListener('message', onMsg);
    if (!('PushManager' in window) || !('Notification' in window)) { setState(ios && !standalone ? 'install' : 'unsupported'); return () => navigator.serviceWorker.removeEventListener('message', onMsg); }
    if (Notification.permission === 'denied') { setState('blocked'); return () => navigator.serviceWorker.removeEventListener('message', onMsg); }
    (async () => {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      const r = await api('/api/phone?action=subscribe').catch(() => ({ phones: 0 }));
      setState(sub && Notification.permission === 'granted' && r.phones > 0 ? 'on' : 'off');
    })();
    return () => navigator.serviceWorker.removeEventListener('message', onMsg);
  }, [onCall]);

  async function turnOn() {
    setErr(''); setState('working');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm === 'denied' ? 'blocked' : 'off'); return; }
      const { publicKey } = await api('/api/phone?action=vapid');
      const reg = await navigator.serviceWorker.ready;
      const old = await reg.pushManager.getSubscription();
      if (old) await old.unsubscribe();
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
      await api('/api/phone?action=subscribe', { method: 'POST', body: { subscription: sub.toJSON(), test: true } });
      setState('on');
    } catch { setErr('Could not turn on alerts. Check your connection and try again.'); setState('off'); }
  }

  if (state === 'checking') return null;
  if (state === 'on') return <div className="alerts"><span className="ok">Call alerts are on</span><span className="muted">Pressing Call on your laptop sends a notification here.</span></div>;
  return (
    <div className="alerts">
      {state === 'install' && <><b>Add Apex Desk to your home screen</b><span className="muted">On iPhone, alerts only work from the home screen icon. In Safari tap Share, then Add to Home Screen, then open Apex Desk from that icon and sign in.</span></>}
      {state === 'unsupported' && <span className="muted">This browser can&apos;t show call alerts. Keep this screen open and calls will still appear here.</span>}
      {state === 'blocked' && <><b>Notifications are blocked</b><span className="muted">Allow notifications for Apex Desk in your phone&apos;s settings, then reopen it.</span></>}
      {(state === 'off' || state === 'working') && <><b>Turn on call alerts</b>
        <span className="muted">Get a notification on this phone whenever you press Call on your laptop.</span>
        <button className="bigcall" onClick={turnOn} disabled={state === 'working'}>{state === 'working' ? 'Turning on…' : 'Turn on call alerts'}</button></>}
      {err && <span className="err">{err}</span>}
    </div>
  );
}
