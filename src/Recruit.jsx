// ─────────────────────────────────────────────────────────────────────────────
// Recruitment: the recruiter's pipeline of brokers she is approaching.
// Lives in its own file and only loads for people with recruitment access, so brokers never download it.
// Server side: /api/recruit (api/recruit.js). Tables: desk.rc_candidates, desk.rc_notes, desk.rc_access.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Board columns, in order, with a colour each. The last two are "closed" and sit folded at the end.
const STAGE_INFO = [
  ['To contact', '#8a948f'], ['Contacted', '#4f78a3'], ['Interested', '#c08a1e'],
  ['Interview booked', '#7a5bc4'], ['Offered', '#d0702c'], ['Placed', '#1e8a4c'],
  ['Not interested', '#a0a7a4'], ['Rejected', '#c62f26'],
];
const STAGES = STAGE_INFO.map(([s]) => s);
const STAGE_COLOR = Object.fromEntries(STAGE_INFO);
const CLOSED = ['Not interested', 'Rejected'];
const OPEN = STAGES.filter((s) => !CLOSED.includes(s));
const FOCUS = ['Sales', 'Leasing', 'Sales & leasing', 'Off-plan'];
const SOURCES = ['Cold outreach', 'Broker database', 'LinkedIn', 'Referral', 'Applied', 'Other'];
const TEMPS = [['hot', 'Hot'], ['warm', 'Warm'], ['cold', 'Cold']];
// One-tap results when logging a call. stage = moves them on, temp = sets hot/warm/cold.
const CALL_RESULTS = [
  { k: 'No answer' },
  { k: 'Left a message' },
  { k: 'Spoke, interested', stage: 'Interested', temp: 'hot' },
  { k: 'Spoke, open to chat later', temp: 'warm' },
  { k: 'Spoke, not interested', stage: 'Not interested', temp: 'cold' },
  { k: 'Interview booked', stage: 'Interview booked', temp: 'hot' },
  { k: 'Sent details on WhatsApp' },
  { k: 'Wrong number' },
];
// Common Dubai brokerages to start the list. Anything she types is added automatically.
const BROKERAGES = ['Allsopp & Allsopp', 'Betterhomes', 'Driven Properties', 'Engel & Völkers', 'Espace', 'fäm Properties', 'Haus & Haus',
  'Hamptons', 'Metropolitan', 'Provident', 'Sotheby\'s International Realty', 'Unique Properties', 'Coldwell Banker', 'Exclusive Links', 'Not in real estate'];
const FOLLOWS = [['day', 'Tomorrow'], ['3days', 'In 3 days'], ['week', 'Next week'], ['month', 'In a month']];
const DUE = [['today', 'Due today or late'], ['week', 'Due this week'], ['none', 'No follow-up set']];
const NO_FILTERS = { q: '', stage: '', brokerage: '', area: '', focus: '', temp: '', source: '', due: '' };

const dt = (v) => (v ? new Date(v) : null);
const dayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const fmtDay = (v) => {
  const d = dt(v); if (!d) return '';
  const t = dayStart(); const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - t) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(d.getFullYear() !== t.getFullYear() ? { year: 'numeric' } : {}) });
};
const fmtWhen = (v) => { const d = dt(v); return d ? d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''; };
const localInput = (v) => { const d = dt(v); if (!d) return ''; const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 16); };
const followState = (v) => { const d = dt(v); if (!d) return ''; const end = dayStart(); end.setDate(end.getDate() + 1); return d < dayStart() ? 'late' : d < end ? 'due' : ''; };
const waLink = (phone) => { let d = String(phone || '').replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); if (d.startsWith('0')) d = '971' + d.slice(1); if (/^971[1-46-9]/.test(d)) return null;   // UAE landline: not on WhatsApp
  return d.length >= 8 ? 'https://wa.me/' + d : null; };
const initials = (n) => String(n || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const norm = (o) => (Array.isArray(o) ? { v: o[0], l: o[1] } : { v: o, l: o });

// Closes a popup when you click outside it or press Escape
function useOutside(open, ref, close) {
  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) close(); };
    const key = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open, ref, close]);
}

// The list inside every drop-down: optional search, arrow keys, Enter to pick, optional "Add …" row
function OptionList({ options, value, onPick, search, allowNew, placeholder = 'Search…', autoFocus = true, query, setQuery }) {
  const [own, setOwn] = useState('');
  const q = query ?? own; const setQ = setQuery ?? setOwn;
  const [hi, setHi] = useState(0);
  const listRef = useRef(null);
  const items = useMemo(() => {
    const t = q.trim().toLowerCase();
    return options.map(norm).filter((o) => !t || o.l.toLowerCase().includes(t));
  }, [options, q]);
  const exact = items.some((o) => o.l.toLowerCase() === q.trim().toLowerCase());
  const MAX = 100;   // long lists (17,000 brokerages) only draw the first 100 matches; typing narrows them down
  const shown = items.length > MAX ? items.slice(0, MAX) : items;
  const rows = allowNew && q.trim() && !exact ? [...shown, { v: q.trim(), l: `Add "${q.trim()}"`, add: true }] : shown;
  useEffect(() => { setHi(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector('.rc-opt.hi')?.scrollIntoView({ block: 'nearest' }); }, [hi]);
  const key = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(rows.length - 1, h + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (rows[hi]) onPick(rows[hi].v); }
  };
  return (
    <div className="rc-pop-in" onKeyDown={key}>
      {search && setQuery == null && <input className="rc-pop-search" autoFocus={autoFocus} placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} />}
      <div className="rc-opts" ref={listRef} tabIndex={search ? -1 : 0}>
        {rows.map((o, i) => (
          <button type="button" key={(o.add ? '+' : '') + o.v} className={'rc-opt' + (i === hi ? ' hi' : '') + (o.v === value ? ' sel' : '') + (o.add ? ' add' : '')}
            onMouseEnter={() => setHi(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(o.v)}>
            <span>{o.l}</span>{o.v === value && <i className="rc-tick" />}
          </button>))}
        {items.length > MAX && <p className="rc-none">{(items.length - MAX).toLocaleString()} more. Type to narrow down.</p>}
        {!rows.length && <p className="rc-none">{q ? 'No matches' : 'Nothing here yet'}</p>}
      </div>
    </div>
  );
}

// Filter pill: "Brokerage ▾", or "Brokerage: Betterhomes ×" once picked
function FilterPill({ label, value, options, onChange, search }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useOutside(open, ref, close);
  const shown = value ? options.map(norm).find((o) => o.v === value)?.l || value : '';
  return (
    <div className="rc-fp" ref={ref}>
      <button type="button" className={'rc-pill' + (value ? ' set' : '') + (open ? ' open' : '')} onClick={() => setOpen(!open)}>
        <span>{label}{shown ? <b>{shown}</b> : null}</span>
        {value ? <i className="rc-x" role="button" aria-label="Clear" onClick={(e) => { e.stopPropagation(); onChange(''); setOpen(false); }} /> : <i className="rc-caret" />}
      </button>
      {open && <div className="rc-pop"><OptionList options={options} value={value} search={search || options.length > 8} onPick={(v) => { onChange(v === value ? '' : v); setOpen(false); }} /></div>}
    </div>
  );
}

// Form drop-down: pick from a fixed list
function Select({ value, onChange, options, placeholder = 'Choose…' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useOutside(open, ref, close);
  const shown = options.map(norm).find((o) => o.v === value)?.l;
  return (
    <div className="rc-sel" ref={ref}>
      <button type="button" className={'rc-field' + (open ? ' open' : '')} onClick={() => setOpen(!open)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); } }}>
        <span className={shown ? '' : 'ph'}>{shown || placeholder}</span><i className="rc-caret" />
      </button>
      {open && <div className="rc-pop full"><OptionList options={options} value={value} search={options.length > 8} onPick={(v) => { onChange(v); setOpen(false); }} /></div>}
    </div>
  );
}

// Form box you can type in: suggests from the list as you type, and anything new is kept
function Combo({ value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useOutside(open, ref, close);
  return (
    <div className="rc-sel" ref={ref}>
      <div className={'rc-field input' + (open ? ' open' : '')}>
        <input value={value} placeholder={placeholder} onFocus={() => setOpen(true)}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          onKeyDown={(e) => { if (e.key === 'Tab') setOpen(false); }} />
        {value ? <i className="rc-x" role="button" aria-label="Clear" onClick={() => { onChange(''); setOpen(true); }} /> : <i className="rc-caret" onClick={() => setOpen(!open)} />}
      </div>
      {open && <div className="rc-pop full"><OptionList options={options} value={value} query={value} setQuery={onChange} allowNew onPick={(v) => { onChange(v); setOpen(false); }} /></div>}
    </div>
  );
}

// A row of buttons where one (or none) can be picked
function Segs({ value, onChange, options, tone }) {
  return (
    <div className="rc-segs">{options.map(norm).map((o) => (
      <button type="button" key={o.v} className={(value === o.v ? 'on ' : '') + (tone ? 't-' + o.v : '')} onClick={() => onChange(value === o.v ? '' : o.v)}>{o.l}</button>))}</div>
  );
}

// The last board shown, so coming back to Recruitment paints instantly while it refreshes
let lastBoard = null;
// Brokerage and area names for the drop-downs: fetched once (17,000+ brokerages), refreshed after adding someone
let facetsP = null;
const getFacets = (api, fresh) => { if (fresh || !facetsP) facetsP = api('/api/desk?action=rc&op=facets').catch((e) => { facetsP = null; throw e; }); return facetsP; };
const NO_FACETS = { brokerages: [], areas: [] };
export default function Recruit({ api, toast }) {
  const [f, setF] = useState(NO_FILTERS);
  const [view, setView] = useState(() => { try { return localStorage.getItem('rcView') || 'board'; } catch { return 'board'; } });
  const [d, setD] = useState(lastBoard);
  const [err, setErr] = useState('');
  const [facets, setFacets] = useState(NO_FACETS);
  const [more, setMore] = useState('');      // column (or 'list') currently loading more
  const [open, setOpen] = useState(null);     // candidate id
  const [adding, setAdding] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [dragOver, setDragOver] = useState('');
  const qs = useMemo(() => Object.entries(f).filter(([, v]) => v).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join(''), [f]);
  const load = useCallback(() => api('/api/desk?action=rc&op=list&v=4' + (view === 'list' ? '&view=list' : '') + qs)
    .then((j) => { setD({ ...j, view }); setErr(''); if (!qs && view === 'board') lastBoard = { ...j, view }; }).catch((e) => setErr(e.message)), [api, qs, view]);
  useEffect(() => { const t = setTimeout(load, f.q ? 250 : 0); return () => clearTimeout(t); }, [load, f.q]);
  const loadFacets = useCallback((fresh) => getFacets(api, fresh).then(setFacets).catch(() => {}), [api]);
  useEffect(() => { loadFacets(false); }, [loadFacets]);
  const changed = useCallback(() => { load(); loadFacets(true); }, [load, loadFacets]);
  // Next 50 of one board column, or the next 100 rows of the list
  const loadMore = useCallback(async (col) => {
    if (more || !d) return;
    setMore(col);
    try {
      const offset = col === 'list' ? d.rows.length : d.rows.filter((r) => r.stage === col).length;
      const j = await api('/api/desk?action=rc&op=list&v=4' + (col === 'list' ? '&view=list' : '&col=' + encodeURIComponent(col)) + '&offset=' + offset + qs);
      setD((x) => { const have = new Set(x.rows.map((r) => r.id)); return { ...x, rows: [...x.rows, ...j.rows.filter((r) => !have.has(r.id))] }; });
    } catch (e) { toast(e.message); }
    setMore('');
  }, [api, d, more, qs, toast]);
  const lists = useMemo(() => ({ ...facets, brokerages: facets.brokerages, areas: facets.areas }), [facets]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setV = (v) => { setView(v); try { localStorage.setItem('rcView', v); } catch {} };
  const anyFilter = Object.values(f).some(Boolean);
  // Drag a card to another column to move its stage
  const move = async (id, stage) => {
    const c = d.rows.find((r) => r.id === id);
    if (!c || c.stage === stage) return;
    setD((x) => ({ ...x, rows: x.rows.map((r) => (r.id === id ? { ...r, stage } : r)),
      colCounts: x.colCounts && { ...x.colCounts, [c.stage]: (x.colCounts[c.stage] || 1) - 1, [stage]: (x.colCounts[stage] || 0) + 1 } }));
    try { await api('/api/desk?action=rc&op=log', { method: 'POST', body: { id, stage } }); load(); }
    catch (e) { toast(e.message); load(); }
  };

  if (err && !d) return <main className="gut rc"><style>{CSS}</style><p className="err" style={{ marginTop: 30 }}>{err}</p><button className="rc-btn" onClick={load}>Try again</button></main>;
  if (!d || d.view !== view) return <main className="gut rc"><style>{CSS}</style><p className="muted" style={{ padding: '40px 0' }}>Loading…</p></main>;
  const cols = showClosed ? STAGES : OPEN;
  const active = d.total - (d.counts.Placed || 0) - (d.counts['Not interested'] || 0) - (d.counts.Rejected || 0);
  return (
    <main className="gut rc">
      <style>{CSS}</style>
      <div className="rc-head">
        <div>
          <h1>Recruitment</h1>
          <div className="rc-stats">
            <span><b>{active.toLocaleString()}</b> in progress</span>
            <span><b>{d.counts['Interview booked'] || 0}</b> interviews booked</span>
            <span><b>{d.counts.Offered || 0}</b> offered</span>
            <span className="won"><b>{d.counts.Placed || 0}</b> placed</span>
          </div>
        </div>
        <div className="rc-acts">
          <button className={'rc-due' + (f.due === 'today' ? ' on' : '') + (d.overdue ? ' late' : d.due ? ' has' : '')} onClick={() => set('due', f.due === 'today' ? '' : 'today')}>
            <span>Today&apos;s follow-ups</span><b>{d.due}</b>{d.overdue ? <em>{d.overdue} late</em> : null}
          </button>
          <div className="rc-toggle">{[['board', 'Board'], ['list', 'List']].map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => setV(k)}>{l}</button>)}</div>
          <button className="rc-btn primary" onClick={() => setAdding(true)}><i className="rc-plus" />Add candidate</button>
        </div>
      </div>

      <div className="rc-filters">
        <div className="rc-search"><i className="rc-mag" /><input type="search" placeholder="Search name, brokerage or number" value={f.q} onChange={(e) => set('q', e.target.value)} /></div>
        <FilterPill label="Brokerage" value={f.brokerage} onChange={(v) => set('brokerage', v)} options={lists.brokerages} search />
        <FilterPill label="Area" value={f.area} onChange={(v) => set('area', v)} options={lists.areas} search />
        <FilterPill label="Sales / leasing" value={f.focus} onChange={(v) => set('focus', v)} options={FOCUS} />
        <FilterPill label="Hot / cold" value={f.temp} onChange={(v) => set('temp', v)} options={TEMPS} />
        <FilterPill label="Stage" value={f.stage} onChange={(v) => set('stage', v)} options={STAGES} />
        <FilterPill label="Source" value={f.source} onChange={(v) => set('source', v)} options={SOURCES} />
        <FilterPill label="Follow-up" value={f.due} onChange={(v) => set('due', v)} options={DUE} />
        {anyFilter && <button className="rc-clear" onClick={() => setF(NO_FILTERS)}>Clear all</button>}
      </div>

      {d.total === 0 && !anyFilter ? (
        <div className="rc-empty-all">
          <div className="rc-empty-ico" />
          <h3>Your pipeline is empty</h3>
          <p>Add the first broker you&apos;re approaching. Pick their brokerage, area and whether they do sales or leasing, so you can filter by them later.</p>
          <button className="rc-btn primary" onClick={() => setAdding(true)}><i className="rc-plus" />Add your first candidate</button>
        </div>
      ) : view === 'board' ? (
        <>
          <div className="rc-board" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(220px, 1fr))` }}>
            {cols.map((st) => {
              const cards = d.rows.filter((r) => r.stage === st);
              const total = d.colCounts ? (d.colCounts[st] || 0) : cards.length;
              return (
                <section key={st} className={'rc-col' + (dragOver === st ? ' over' : '') + (CLOSED.includes(st) ? ' closed' : '')}
                  onDragOver={(e) => { e.preventDefault(); if (dragOver !== st) setDragOver(st); }}
                  onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(''); }}
                  onDrop={(e) => { setDragOver(''); move(Number(e.dataTransfer.getData('text/plain')), st); }}>
                  <h3><i style={{ background: STAGE_COLOR[st] }} />{st}<span>{total.toLocaleString()}</span></h3>
                  <div className="rc-col-in">
                    {cards.map((c) => <Card key={c.id} c={c} onOpen={() => setOpen(c.id)} />)}
                    {!cards.length && <p className="rc-drop">{anyFilter ? 'None match' : 'Drag a card here'}</p>}
                    {cards.length < total && <MoreRow busy={more === st} left={total - cards.length} onMore={() => loadMore(st)} />}
                  </div>
                </section>
              );
            })}
          </div>
          <button className="rc-clear rc-closed" onClick={() => setShowClosed(!showClosed)}>
            {showClosed ? 'Hide Not interested and Rejected' : `Show Not interested (${(d.counts['Not interested'] || 0).toLocaleString()}) and Rejected (${(d.counts.Rejected || 0).toLocaleString()})`}
          </button>
        </>
      ) : (
        <div className="rc-tw">
          <table className="rc-t">
            <thead><tr><th>Name</th><th>Brokerage</th><th>Area</th><th>Focus</th><th>Stage</th><th>Follow up</th><th>Last spoke</th><th>Latest note</th></tr></thead>
            <tbody>{d.rows.map((c) => (
              <tr key={c.id} onClick={() => setOpen(c.id)}>
                <td><div className="rc-nm-cell"><span className={'rc-av' + (c.temp ? ' t-' + c.temp : '')}>{initials(c.name)}</span><b>{c.name}</b></div></td>
                <td>{c.brokerage || <span className="faint">—</span>}</td><td>{c.area || <span className="faint">—</span>}</td><td>{c.focus || <span className="faint">—</span>}</td>
                <td><span className="rc-stage"><i style={{ background: STAGE_COLOR[c.stage] }} />{c.stage}</span></td>
                <td className={'rc-fu ' + followState(c.follow_up_at)}>{fmtDay(c.follow_up_at) || <span className="faint">—</span>}</td>
                <td className="muted">{fmtDay(c.last_contact_at) || 'Never'}</td>
                <td className="rc-ln">{c.last_note || ''}</td>
              </tr>))}</tbody>
          </table>
          {!d.rows.length && <p className="muted" style={{ padding: 24 }}>{anyFilter ? 'Nobody matches these filters.' : 'No candidates yet.'}</p>}
          {d.matched > d.rows.length && <div className="rc-list-more"><MoreRow busy={more === 'list'} left={d.matched - d.rows.length} onMore={() => loadMore('list')} /></div>}
        </div>
      )}

      {adding && <AddCandidate api={api} lists={lists} onClose={() => setAdding(false)} onSaved={(id) => { setAdding(false); changed(); setOpen(id); }} />}
      {open && <Candidate api={api} id={open} lists={lists} toast={toast} onClose={() => setOpen(null)} onChanged={changed} />}
    </main>
  );
}

// "47,512 more": loads the next lot by itself when it scrolls into view (or on click)
function MoreRow({ busy, left, onMore }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current; if (!el || !('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) onMore(); }, { rootMargin: '300px' });
    io.observe(el); return () => io.disconnect();
  }, [onMore]);
  return <button type="button" ref={ref} className="rc-more" disabled={busy} onClick={onMore}>{busy ? 'Loading…' : `${left.toLocaleString()} more`}</button>;
}

function Card({ c, onOpen }) {
  const fs = followState(c.follow_up_at);
  return (
    <article className="rc-card" draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(c.id)); e.dataTransfer.effectAllowed = 'move'; }} onClick={onOpen}>
      <div className="rc-card-top">
        <span className={'rc-av' + (c.temp ? ' t-' + c.temp : '')}>{initials(c.name)}</span>
        <div className="rc-card-name"><b>{c.name}</b><span>{[c.brokerage, c.area].filter(Boolean).join(' · ') || 'No details yet'}</span></div>
      </div>
      <div className="rc-card-foot">
        {c.temp && <span className={'rc-temp ' + c.temp}>{c.temp}</span>}
        {c.focus && <span className="rc-tag">{c.focus}</span>}
        {c.stage === 'Interview booked' && c.interview_at && <span className="rc-tag iv">Interview {fmtDay(c.interview_at)}</span>}
        {c.follow_up_at && <span className={'rc-fu-chip ' + fs}>{fs === 'late' ? 'Late · ' : ''}{fmtDay(c.follow_up_at)}</span>}
      </div>
    </article>
  );
}

// The fields shared by Add and Edit
function Fields({ v, set, lists }) {
  const brokerages = useMemo(() => [...new Set([...lists.brokerages, ...BROKERAGES])].sort((a, b) => a.localeCompare(b)), [lists.brokerages]);
  return (
    <div className="rc-form">
      <label className="wide"><span>Name</span><input className="rc-in" value={v.name} onChange={(e) => set('name', e.target.value)} autoFocus placeholder="Full name" /></label>
      <label><span>Mobile</span><input className="rc-in" value={v.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+971 50 …" /></label>
      <label><span>Office line</span><input className="rc-in" value={v.phone2} onChange={(e) => set('phone2', e.target.value)} placeholder="Optional" /></label>
      <label><span>Email</span><input className="rc-in" type="email" value={v.email} onChange={(e) => set('email', e.target.value)} placeholder="Optional" /></label>
      <div className="rc-lab"><span>Brokerage</span><Combo value={v.brokerage} onChange={(x) => set('brokerage', x)} options={brokerages} placeholder="Pick or type a new one" /></div>
      <div className="rc-lab"><span>Area they cover</span><Combo value={v.area} onChange={(x) => set('area', x)} options={lists.areas} placeholder="Pick or type" /></div>
      <div className="rc-lab wide"><span>Sales or leasing</span><Segs value={v.focus} onChange={(x) => set('focus', x)} options={FOCUS} /></div>
      <div className="rc-lab"><span>Stage</span><Select value={v.stage} onChange={(x) => set('stage', x)} options={STAGES} /></div>
      <div className="rc-lab"><span>Hot or cold</span><Segs value={v.temp} onChange={(x) => set('temp', x)} options={TEMPS} tone /></div>
      <div className="rc-lab wide"><span>Where you found them</span><Segs value={v.source} onChange={(x) => set('source', x)} options={SOURCES} /></div>
      <label className="wide"><span>LinkedIn</span><input className="rc-in" value={v.linkedin} onChange={(e) => set('linkedin', e.target.value)} placeholder="Link (optional)" /></label>
    </div>
  );
}

function FollowPicker({ v, on, current }) {
  return (
    <div className="rc-follow">
      <span className="rc-lbl">Follow up{current ? <em> · set for {fmtWhen(current)}</em> : null}</span>
      <div className="rc-chips">
        {FOLLOWS.map(([k, l]) => <button type="button" key={k} className={'rc-chip' + (v.kind === k ? ' on' : '')} onClick={() => on(v.kind === k ? {} : { kind: k })}>{l}</button>)}
        <button type="button" className={'rc-chip' + (v.kind === 'custom' ? ' on' : '')} onClick={() => on(v.kind === 'custom' ? {} : { kind: 'custom', at: v.at || '' })}>Pick a date</button>
        {current && <button type="button" className={'rc-chip' + (v.kind === 'none' ? ' on' : '')} onClick={() => on(v.kind === 'none' ? {} : { kind: 'none' })}>Clear it</button>}
      </div>
      {v.kind === 'custom' && <input className="rc-in rc-date" type="datetime-local" value={v.at || ''} onChange={(e) => on({ kind: 'custom', at: e.target.value })} />}
    </div>
  );
}

const blank = { name: '', phone: '', phone2: '', email: '', brokerage: '', area: '', focus: '', source: 'Cold outreach', stage: 'To contact', linkedin: '', temp: '' };
const followBody = (fu) => (fu.kind === 'custom' ? (fu.at ? { kind: 'custom', at: new Date(fu.at).toISOString() } : {}) : fu);

function Sheet({ onClose, wide, children }) {
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape' && !document.querySelector('.rc-pop')) onClose(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="rc-shade" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'rc-sheet' + (wide ? ' wide' : '')}>{children}</div>
    </div>
  );
}

function AddCandidate({ api, lists, onClose, onSaved }) {
  const [v, setVal] = useState(blank);
  const [note, setNote] = useState('');
  const [fu, setFu] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [dupe, setDupe] = useState(false);
  const set = (k, x) => setVal((o) => ({ ...o, [k]: x }));
  const save = async (force = false) => {
    setBusy(true); setErr(''); setDupe(false);
    try { const j = await api('/api/desk?action=rc&op=save', { method: 'POST', body: { ...v, note, followUp: followBody(fu), force } }); onSaved(j.id); }
    catch (e) { setErr(e.message); if (/already in the pipeline/.test(e.message)) setDupe(true); }
    setBusy(false);
  };
  return (
    <Sheet onClose={onClose}>
      <div className="rc-sh-head"><h2>Add candidate</h2><button className="rc-close" onClick={onClose} aria-label="Close" /></div>
      <div className="rc-sh-body">
        <Fields v={v} set={set} lists={lists} />
        <label className="rc-note"><span>First note</span><textarea className="rc-in" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Where you found them, what they're like, anything useful" /></label>
        <FollowPicker v={fu} on={setFu} />
        {err && <p className="rc-err">{err}</p>}
      </div>
      <div className="rc-sh-foot">
        <button className="rc-btn" onClick={onClose}>Cancel</button>
        {dupe && <button className="rc-btn" onClick={() => save(true)}>Add anyway</button>}
        <button className="rc-btn primary" disabled={busy || !v.name.trim()} onClick={() => save(false)}>{busy ? 'Saving…' : 'Add candidate'}</button>
      </div>
    </Sheet>
  );
}

function Candidate({ api, id, lists, toast, onClose, onChanged }) {
  const [d, setD] = useState(null);
  const [edit, setEdit] = useState(null);
  const [result, setResult] = useState('');
  const [note, setNote] = useState('');
  const [fu, setFu] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(() => api('/api/desk?action=rc&op=get&id=' + id).then(setD).catch((e) => setErr(e.message)), [api, id]);
  useEffect(() => { load(); }, [load]);
  const c = d?.candidate;
  const quick = async (body) => {
    try { await api('/api/desk?action=rc&op=log', { method: 'POST', body: { id, ...body } }); await load(); onChanged(); }
    catch (e) { toast(e.message); }
  };
  const r = CALL_RESULTS.find((x) => x.k === result);
  const logIt = async () => {
    const text = [result, note.trim()].filter(Boolean).join('. ');
    setBusy(true); setErr('');
    try {
      await api('/api/desk?action=rc&op=log', { method: 'POST', body: {
        id, note: text, call: !!result, followUp: followBody(fu),
        ...(r?.stage && r.stage !== c.stage ? { stage: r.stage } : {}), ...(r?.temp ? { temp: r.temp } : {}) } });
      setResult(''); setNote(''); setFu({});
      await load(); onChanged();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const saveEdit = async () => {
    setBusy(true); setErr('');
    try { await api('/api/desk?action=rc&op=save', { method: 'POST', body: { id, ...edit, interview_at: edit.interview_at ? new Date(edit.interview_at).toISOString() : null } }); setEdit(null); await load(); onChanged(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const archive = async () => {
    if (!window.confirm(`Remove ${c.name} from the pipeline?`)) return;
    try { await api('/api/desk?action=rc&op=archive', { method: 'POST', body: { id } }); onChanged(); onClose(); } catch (e) { toast(e.message); }
  };
  if (!d) return <Sheet onClose={onClose} wide><div className="rc-sh-body"><p className="muted">{err || 'Loading…'}</p></div></Sheet>;
  if (edit) return (
    <Sheet onClose={() => setEdit(null)} wide>
      <div className="rc-sh-head"><h2>Edit {c.name}</h2><button className="rc-close" onClick={() => setEdit(null)} aria-label="Close" /></div>
      <div className="rc-sh-body">
        <Fields v={edit} set={(k, x) => setEdit((o) => ({ ...o, [k]: x }))} lists={lists} />
        {edit.stage === 'Interview booked' && <label className="rc-note"><span>Interview date</span><input className="rc-in rc-date" type="datetime-local" value={edit.interview_at || ''} onChange={(e) => setEdit((o) => ({ ...o, interview_at: e.target.value }))} /></label>}
        {err && <p className="rc-err">{err}</p>}
      </div>
      <div className="rc-sh-foot">
        <button className="rc-clear rc-arch" onClick={archive}>Remove from pipeline</button>
        <button className="rc-btn" onClick={() => setEdit(null)}>Cancel</button>
        <button className="rc-btn primary" disabled={busy || !edit.name.trim()} onClick={saveEdit}>Save changes</button>
      </div>
    </Sheet>
  );
  return (
    <Sheet onClose={onClose} wide>
      <div className="rc-sh-head rc-person">
        <span className={'rc-av big' + (c.temp ? ' t-' + c.temp : '')}>{initials(c.name)}</span>
        <div className="rc-person-txt">
          <h2>{c.name}</h2>
          <p>{[c.brokerage, c.area, c.focus].filter(Boolean).join(' · ') || 'No details yet'}{c.source ? ` · ${c.source}` : ''}</p>
        </div>
        <button className="rc-btn sm" onClick={() => setEdit({ ...blank, ...Object.fromEntries(Object.entries(c).map(([k, x]) => [k, x ?? ''])), interview_at: localInput(c.interview_at) })}>Edit</button>
        <button className="rc-close" onClick={onClose} aria-label="Close" />
      </div>
      <div className="rc-sh-body">
        <div className="rc-contact">
          {c.phone && <a className="rc-btn" href={'tel:' + c.phone}>Call {c.phone}</a>}
          {waLink(c.phone) && <a className="rc-btn wa" href={waLink(c.phone)} target="_blank" rel="noreferrer">WhatsApp</a>}
          {c.phone2 && <a className="rc-btn" href={'tel:' + c.phone2}>Office {c.phone2}</a>}
          {c.email && <a className="rc-btn" href={'mailto:' + c.email}>Email</a>}
          {c.linkedin && <a className="rc-btn" href={/^https?:/.test(c.linkedin) ? c.linkedin : 'https://' + c.linkedin} target="_blank" rel="noreferrer">LinkedIn</a>}
          {!c.phone && !c.phone2 && !c.email && <span className="faint">No number or email yet. Use Edit to add them.</span>}
        </div>

        <div className="rc-grid2">
          <div className="rc-lab"><span>Stage</span><Select value={c.stage} onChange={(st) => st !== c.stage && quick({ stage: st })} options={STAGES} /></div>
          <div className="rc-lab"><span>Hot or cold</span><Segs value={c.temp || ''} onChange={(t) => quick({ temp: t })} options={TEMPS} tone /></div>
          {c.stage === 'Interview booked' && <label className="rc-lab"><span>Interview</span>
            <input className="rc-in rc-date" type="datetime-local" defaultValue={localInput(c.interview_at)} onBlur={(e) => e.target.value !== localInput(c.interview_at) && quick({ interview_at: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label>}
          <div className="rc-lab"><span>Follow-up</span><p className={'rc-fu-now ' + followState(c.follow_up_at)}>{c.follow_up_at ? fmtWhen(c.follow_up_at) : 'None set'}</p></div>
        </div>

        <section className="rc-log">
          <h4>Log a call or note</h4>
          <div className="rc-chips">{CALL_RESULTS.map((x) => <button type="button" key={x.k} className={'rc-chip' + (result === x.k ? ' on' : '')} onClick={() => setResult(result === x.k ? '' : x.k)}>{x.k}</button>)}</div>
          <textarea className="rc-in" value={note} onChange={(e) => setNote(e.target.value)} placeholder={result ? 'Add detail (optional)' : 'What was said, what they want, what happens next'} />
          <FollowPicker v={fu} on={setFu} current={c.follow_up_at} />
          {err && <p className="rc-err">{err}</p>}
          <div className="rc-log-foot">
            <button className="rc-btn primary" disabled={busy || (!result && !note.trim() && !fu.kind)} onClick={logIt}>{busy ? 'Saving…' : 'Save'}</button>
            {r && (r.stage || r.temp) ? <span className="faint">Also sets {[r.stage && r.stage !== c.stage && `stage to ${r.stage}`, r.temp].filter(Boolean).join(' and ')}</span> : null}
          </div>
        </section>

        <section className="rc-hist">
          <h4>History</h4>
          {d.notes.length ? d.notes.map((n) => (
            <div key={n.id} className={'rc-n ' + n.kind}>
              <i className="rc-n-dot" />
              <div><span className="rc-nm">{fmtWhen(n.created_at)}{n.by ? ` · ${n.by}` : ''}{n.kind === 'call' ? ' · call' : ''}</span>
                <p>{n.kind === 'stage' ? `Moved ${n.body}` : n.body}</p></div>
            </div>)) : <p className="muted">Nothing yet.</p>}
          <p className="rc-nm rc-added">Added {fmtWhen(c.created_at)}</p>
        </section>
      </div>
    </Sheet>
  );
}

const CSS = `
.rc{--r-card:var(--bg);--r-soft:color-mix(in srgb,var(--ink) 4%,var(--bg));--r-shadow:0 1px 2px rgba(16,24,22,.06),0 1px 1px rgba(16,24,22,.04);--r-pop:0 12px 32px rgba(16,24,22,.14),0 2px 6px rgba(16,24,22,.08)}
.rc h1{margin:0;font-size:26px;letter-spacing:-.02em} .rc .muted{color:var(--muted)} .rc .faint{color:var(--faint)}
.rc-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin:26px 0 18px}
.rc-stats{display:flex;gap:18px;flex-wrap:wrap;margin-top:6px;font-size:13.5px;color:var(--muted)} .rc-stats b{color:var(--ink);font-weight:650;margin-right:4px}
.rc-stats .won b{color:var(--hot)}
.rc-acts{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.rc-btn{font:inherit;font-size:13.5px;display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:9px;padding:8px 14px;cursor:pointer;text-decoration:none;transition:border-color .12s,background .12s,box-shadow .12s;box-shadow:var(--r-shadow)}
.rc-btn:hover{border-color:color-mix(in srgb,var(--accent) 45%,var(--line))} .rc-btn[disabled]{opacity:.45;cursor:not-allowed}
.rc-btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);font-weight:600} .rc-btn.primary:hover{filter:brightness(1.08)}
.rc-btn.sm{padding:6px 12px;font-size:13px} .rc-btn.wa{color:#1a8f4a}
.rc-plus{width:10px;height:10px;position:relative} .rc-plus::before,.rc-plus::after{content:'';position:absolute;background:currentColor;border-radius:1px} .rc-plus::before{left:4px;top:0;width:2px;height:10px} .rc-plus::after{top:4px;left:0;height:2px;width:10px}
.rc-due{font:inherit;font-size:13.5px;border:1px solid var(--line);background:var(--bg);border-radius:9px;padding:7px 12px;cursor:pointer;color:var(--ink);display:flex;gap:8px;align-items:center;box-shadow:var(--r-shadow)}
.rc-due b{min-width:22px;text-align:center;background:var(--hover);border-radius:999px;padding:1px 7px;font-size:12.5px} .rc-due em{font-style:normal;font-size:12px;color:var(--cold);font-weight:600}
.rc-due.has b{background:var(--hot);color:#fff} .rc-due.late b{background:var(--cold);color:#fff} .rc-due.on{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 15%,transparent)}
.rc-toggle{display:inline-flex;background:var(--hover);border-radius:9px;padding:3px} .rc-toggle button{font:inherit;font-size:13px;border:0;background:none;padding:5px 13px;border-radius:7px;color:var(--muted);cursor:pointer} .rc-toggle button.on{background:var(--bg);color:var(--ink);font-weight:600;box-shadow:var(--r-shadow)}
.rc-filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:18px;padding-bottom:16px;border-bottom:1px solid var(--line)}
.rc-search{position:relative;flex:0 1 280px} .rc-search input{width:100%;font:inherit;font-size:13.5px;border:1px solid var(--line);border-radius:999px;background:var(--bg);color:var(--ink);padding:8px 14px 8px 34px;outline:none;transition:border-color .12s,box-shadow .12s}
.rc-search input:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 15%,transparent)}
.rc-mag{position:absolute;left:13px;top:50%;width:11px;height:11px;margin-top:-7px;border:1.6px solid var(--faint);border-radius:50%} .rc-mag::after{content:'';position:absolute;width:5px;height:1.6px;background:var(--faint);right:-5px;bottom:-2px;transform:rotate(45deg)}
.rc-fp{position:relative}
.rc-pill{font:inherit;font-size:13px;display:inline-flex;align-items:center;gap:8px;border:1px dashed color-mix(in srgb,var(--ink) 22%,var(--line));background:var(--bg);color:var(--muted);border-radius:999px;padding:7px 12px;cursor:pointer;white-space:nowrap;transition:all .12s}
.rc-pill:hover,.rc-pill.open{border-style:solid;border-color:color-mix(in srgb,var(--accent) 50%,var(--line));color:var(--ink)}
.rc-pill b{font-weight:600;color:var(--accent);margin-left:6px;max-width:170px;overflow:hidden;text-overflow:ellipsis;display:inline-block;vertical-align:bottom}
.rc-pill.set{border-style:solid;border-color:color-mix(in srgb,var(--accent) 40%,var(--line));background:color-mix(in srgb,var(--accent) 7%,var(--bg));color:var(--ink)}
.rc-caret{width:7px;height:7px;border-right:1.6px solid currentColor;border-bottom:1.6px solid currentColor;transform:rotate(45deg);margin-top:-4px;opacity:.6;flex:none}
.rc-x{width:14px;height:14px;position:relative;border-radius:50%;flex:none;cursor:pointer;opacity:.6} .rc-x:hover{opacity:1;background:var(--hover)}
.rc-x::before,.rc-x::after{content:'';position:absolute;left:6px;top:2px;width:1.6px;height:10px;background:currentColor;border-radius:1px} .rc-x::before{transform:rotate(45deg)} .rc-x::after{transform:rotate(-45deg)}
.rc-clear{font:inherit;font-size:13px;background:none;border:0;color:var(--accent);cursor:pointer;padding:6px 4px} .rc-clear:hover{text-decoration:underline}
.rc-pop{position:absolute;z-index:90;top:calc(100% + 6px);left:0;min-width:230px;max-width:320px;background:var(--bg);border:1px solid var(--line);border-radius:12px;box-shadow:var(--r-pop);overflow:hidden;animation:rcPop .12s ease-out}
.rc-pop.full{right:0;max-width:none}
@keyframes rcPop{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.rc-pop-search{width:100%;box-sizing:border-box;font:inherit;font-size:13.5px;border:0;border-bottom:1px solid var(--line);padding:11px 14px;outline:none;background:var(--bg);color:var(--ink)}
.rc-opts{max-height:280px;overflow-y:auto;padding:5px;outline:none}
.rc-opt{width:100%;font:inherit;font-size:13.5px;text-align:left;display:flex;justify-content:space-between;align-items:center;gap:10px;border:0;background:none;color:var(--ink);padding:8px 10px;border-radius:7px;cursor:pointer}
.rc-opt.hi{background:var(--hover)} .rc-opt.sel{font-weight:600;color:var(--accent)} .rc-opt.add{color:var(--accent);font-weight:500}
.rc-tick{width:5px;height:10px;border-right:2px solid var(--accent);border-bottom:2px solid var(--accent);transform:rotate(45deg);margin:-3px 3px 0 0;flex:none}
.rc-none{margin:0;padding:10px;color:var(--faint);font-size:13px}
.rc-board{display:grid;gap:12px;overflow-x:auto;padding-bottom:10px;align-items:start}
.rc-col{background:var(--r-soft);border-radius:14px;padding:10px;min-height:140px;display:flex;flex-direction:column;gap:8px;transition:background .12s,box-shadow .12s}
.rc-col.over{background:color-mix(in srgb,var(--accent) 8%,var(--bg));box-shadow:inset 0 0 0 2px color-mix(in srgb,var(--accent) 45%,transparent)} .rc-col.closed{opacity:.85}
.rc-col h3{margin:2px 4px 4px;font-size:13px;font-weight:650;display:flex;align-items:center;gap:8px} .rc-col h3 i{width:8px;height:8px;border-radius:50%;flex:none}
.rc-col-in{display:flex;flex-direction:column;gap:8px;max-height:calc(100vh - var(--toph, 57px) - 250px);min-height:60px;overflow-y:auto;margin:0 -4px;padding:2px 4px 4px;overscroll-behavior:contain}
.rc-more{border:1.5px dashed var(--line);background:none;border-radius:10px;padding:10px;color:var(--muted);font:inherit;font-size:12.5px;cursor:pointer;flex:none} .rc-more:hover{color:var(--ink);border-color:color-mix(in srgb,var(--accent) 40%,var(--line))}
.rc-list-more{padding:12px;display:flex;justify-content:center} .rc-list-more .rc-more{min-width:200px}
.rc-col h3 span{margin-left:auto;font-weight:600;font-size:12px;color:var(--muted);background:var(--bg);border-radius:999px;padding:1px 8px}
.rc-drop{margin:0;padding:18px 8px;text-align:center;color:var(--faint);font-size:12.5px;border:1.5px dashed var(--line);border-radius:10px}
.rc-card{background:var(--r-card);border:1px solid var(--line);border-radius:11px;padding:11px 12px;cursor:pointer;display:flex;flex-direction:column;gap:9px;box-shadow:var(--r-shadow);transition:transform .12s,box-shadow .12s,border-color .12s}
.rc-card:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(16,24,22,.08);border-color:color-mix(in srgb,var(--accent) 30%,var(--line))} .rc-card:active{cursor:grabbing}
.rc-card-top{display:flex;gap:10px;align-items:center;min-width:0}
.rc-card-name{display:flex;flex-direction:column;min-width:0} .rc-card-name b{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis} .rc-card-name span{font-size:12.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rc-av{width:30px;height:30px;border-radius:50%;flex:none;display:grid;place-items:center;font-size:11.5px;font-weight:650;background:var(--hover);color:var(--muted);box-shadow:inset 0 0 0 2px var(--bg),0 0 0 1.5px var(--line)}
.rc-av.big{width:44px;height:44px;font-size:15px} .rc-av.t-hot{box-shadow:inset 0 0 0 2px var(--bg),0 0 0 2px var(--hot)} .rc-av.t-warm{box-shadow:inset 0 0 0 2px var(--bg),0 0 0 2px #d79a2b} .rc-av.t-cold{box-shadow:inset 0 0 0 2px var(--bg),0 0 0 2px #7b9fc4}
.rc-card-foot{display:flex;gap:5px;flex-wrap:wrap;align-items:center;font-size:11.5px} .rc-card-foot:empty{display:none}
.rc-tag{background:var(--hover);border-radius:6px;padding:2px 7px;color:var(--muted)} .rc-tag.iv{color:#7a5bc4;background:#7a5bc41a}
.rc-temp{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;border-radius:6px;padding:2px 7px}
.rc-temp.hot{color:var(--hot);background:color-mix(in srgb,var(--hot) 13%,transparent)} .rc-temp.warm{color:#b07a14;background:#d79a2b22} .rc-temp.cold{color:#4f78a3;background:#7b9fc422}
.rc-fu-chip{margin-left:auto;color:var(--muted);border-radius:6px;padding:2px 7px;background:var(--hover)} .rc-fu-chip.due{color:#fff;background:var(--hot)} .rc-fu-chip.late{color:#fff;background:var(--cold)}
.rc-fu.due{color:var(--hot);font-weight:600} .rc-fu.late{color:var(--cold);font-weight:600}
.rc-closed{margin-top:10px}
.rc-empty-all{text-align:center;padding:60px 20px;border:1.5px dashed var(--line);border-radius:16px;max-width:560px;margin:30px auto}
.rc-empty-all h3{margin:14px 0 6px;font-size:18px} .rc-empty-all p{color:var(--muted);margin:0 auto 18px;max-width:400px;line-height:1.5}
.rc-empty-ico{width:44px;height:44px;margin:0 auto;border-radius:12px;background:color-mix(in srgb,var(--accent) 12%,var(--bg));position:relative}
.rc-empty-ico::before{content:'';position:absolute;left:15px;top:9px;width:14px;height:14px;border-radius:50%;border:2px solid var(--accent)} .rc-empty-ico::after{content:'';position:absolute;left:10px;top:27px;width:24px;height:10px;border-radius:12px 12px 3px 3px;border:2px solid var(--accent);border-bottom:0}
.rc-tw{border:1px solid var(--line);border-radius:14px;overflow:auto;box-shadow:var(--r-shadow)}
.rc-t{width:100%;border-collapse:collapse;font-size:13.5px} .rc-t th{text-align:left;font-weight:600;color:var(--muted);font-size:12px;padding:11px 14px;border-bottom:1px solid var(--line);white-space:nowrap;background:var(--r-soft)}
.rc-t td{padding:10px 14px;border-bottom:1px solid var(--line);white-space:nowrap} .rc-t tr{cursor:pointer} .rc-t tbody tr:hover{background:var(--hover)} .rc-t tbody tr:last-child td{border-bottom:0}
.rc-nm-cell{display:flex;gap:10px;align-items:center} .rc-nm-cell .rc-av{width:26px;height:26px;font-size:10.5px}
.rc-stage{display:inline-flex;gap:7px;align-items:center} .rc-stage i{width:7px;height:7px;border-radius:50%}
.rc-ln{max-width:320px;overflow:hidden;text-overflow:ellipsis;color:var(--muted)}
.rc-shade{position:fixed;inset:0;z-index:80;background:rgba(14,20,18,.32);display:flex;justify-content:flex-end;animation:rcFade .15s ease-out}
@keyframes rcFade{from{opacity:0}to{opacity:1}}
.rc-sheet{width:min(560px,100vw);height:100%;background:var(--bg);display:flex;flex-direction:column;box-shadow:-12px 0 40px rgba(14,20,18,.18);animation:rcSlide .2s cubic-bezier(.2,.8,.2,1)}
.rc-sheet.wide{width:min(640px,100vw)}
@keyframes rcSlide{from{transform:translateX(30px);opacity:.6}to{transform:none;opacity:1}}
.rc-sh-head{display:flex;align-items:center;gap:12px;padding:18px 22px;border-bottom:1px solid var(--line)} .rc-sh-head h2{margin:0;font-size:18px;flex:1;letter-spacing:-.01em}
.rc-person-txt{flex:1;min-width:0} .rc-person-txt p{margin:2px 0 0;color:var(--muted);font-size:13px}
.rc-close{width:32px;height:32px;border-radius:8px;border:0;background:none;position:relative;cursor:pointer;flex:none} .rc-close:hover{background:var(--hover)}
.rc-close::before,.rc-close::after{content:'';position:absolute;left:15px;top:9px;width:2px;height:14px;background:var(--muted);border-radius:1px} .rc-close::before{transform:rotate(45deg)} .rc-close::after{transform:rotate(-45deg)}
.rc-sh-body{flex:1;overflow-y:auto;padding:18px 22px 24px;display:flex;flex-direction:column;gap:16px}
.rc-sh-foot{display:flex;justify-content:flex-end;gap:8px;padding:14px 22px;border-top:1px solid var(--line);background:var(--r-soft)}
.rc-form{display:grid;grid-template-columns:1fr 1fr;gap:14px 16px}
.rc-form label,.rc-lab,.rc-note{display:flex;flex-direction:column;gap:6px;min-width:0} .rc-form .wide{grid-column:1/-1}
.rc-form label>span,.rc-lab>span,.rc-note>span,.rc-lbl{font-size:12.5px;font-weight:600;color:var(--muted)} .rc-lbl em{font-style:normal;font-weight:400}
.rc-in{font:inherit;font-size:14px;border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--ink);padding:9px 12px;outline:none;transition:border-color .12s,box-shadow .12s;width:100%;box-sizing:border-box}
.rc-in:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 15%,transparent)}
textarea.rc-in{min-height:76px;resize:vertical;line-height:1.45} .rc-date{max-width:260px}
.rc-sel{position:relative}
.rc-field{font:inherit;font-size:14px;width:100%;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:8px;border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--ink);padding:9px 12px;cursor:pointer;text-align:left;transition:border-color .12s,box-shadow .12s}
.rc-field.open,.rc-field:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 15%,transparent)} .rc-field .ph{color:var(--faint)}
.rc-field.input{cursor:text;padding:0 12px 0 0} .rc-field.input input{flex:1;min-width:0;font:inherit;font-size:14px;border:0;outline:none;background:none;color:var(--ink);padding:9px 0 9px 12px}
.rc-field .rc-caret{color:var(--muted)}
.rc-segs{display:inline-flex;flex-wrap:wrap;gap:0;border:1px solid var(--line);border-radius:9px;overflow:hidden;width:fit-content;max-width:100%}
.rc-segs button{font:inherit;font-size:13px;border:0;border-right:1px solid var(--line);background:var(--bg);color:var(--muted);padding:8px 13px;cursor:pointer;transition:background .12s,color .12s} .rc-segs button:last-child{border-right:0}
.rc-segs button:hover{background:var(--hover);color:var(--ink)} .rc-segs button.on{background:var(--accent);color:var(--accent-ink);font-weight:600}
.rc-segs button.on.t-hot{background:var(--hot);color:#fff} .rc-segs button.on.t-warm{background:#d79a2b;color:#fff} .rc-segs button.on.t-cold{background:#6f93b9;color:#fff}
.rc-chips{display:flex;flex-wrap:wrap;gap:6px}
.rc-chip{font:inherit;font-size:13px;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:999px;padding:6px 12px;cursor:pointer;transition:all .12s}
.rc-chip:hover{border-color:color-mix(in srgb,var(--accent) 45%,var(--line))} .rc-chip.on{background:color-mix(in srgb,var(--accent) 10%,var(--bg));border-color:var(--accent);color:var(--accent);font-weight:600}
.rc-follow{display:flex;flex-direction:column;gap:8px}
.rc-err{margin:0;color:var(--bad);font-size:13.5px}
.rc-contact{display:flex;gap:8px;flex-wrap:wrap}
.rc-grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px 16px;padding:14px;border:1px solid var(--line);border-radius:12px}
.rc-fu-now{margin:0;padding:9px 0;font-size:14px} .rc-fu-now.due{color:var(--hot);font-weight:600} .rc-fu-now.late{color:var(--cold);font-weight:600}
.rc-log{border:1px solid var(--line);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:12px;background:var(--r-soft)}
.rc-log h4,.rc-hist h4{margin:0;font-size:14px} .rc-log .rc-chip{background:var(--bg)}
.rc-log-foot{display:flex;gap:12px;align-items:center;font-size:12.5px}
.rc-hist{display:flex;flex-direction:column;gap:0}
.rc-hist h4{margin-bottom:8px}
.rc-n{display:flex;gap:12px;padding:9px 0;position:relative} .rc-n::before{content:'';position:absolute;left:4px;top:24px;bottom:-9px;width:1.5px;background:var(--line)} .rc-n:last-of-type::before{display:none}
.rc-n-dot{width:10px;height:10px;border-radius:50%;background:var(--bg);border:2px solid var(--accent);margin-top:4px;flex:none;box-sizing:border-box}
.rc-n.stage .rc-n-dot{border-color:var(--faint)} .rc-n.call .rc-n-dot{background:var(--accent)}
.rc-n p{margin:2px 0 0;font-size:13.5px;white-space:pre-wrap;line-height:1.45} .rc-n.stage p{color:var(--muted);font-size:13px}
.rc-nm{font-size:11.5px;color:var(--faint)} .rc-added{margin:10px 0 0 22px}
.rc-arch{margin-right:auto;color:var(--cold)}
@media (max-width:640px){.rc-form,.rc-grid2{grid-template-columns:1fr}.rc-sheet,.rc-sheet.wide{width:100vw}}
`;
