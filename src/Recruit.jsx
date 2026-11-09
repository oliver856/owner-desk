// ─────────────────────────────────────────────────────────────────────────────
// Recruitment: the recruiter's pipeline of brokers she is approaching.
// Lives in its own file and only loads for people with recruitment access, so brokers never download it.
// Server side: /api/recruit (api/recruit.js). Tables: desk.rc_candidates, desk.rc_notes, desk.rc_access.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useState } from 'react';

// Board columns, in order. The last two are "closed" and sit folded at the end.
const OPEN = ['To contact', 'Contacted', 'Interested', 'Interview booked', 'Offered', 'Placed'];
const CLOSED = ['Not interested', 'Rejected'];
const STAGES = [...OPEN, ...CLOSED];
const FOCUS = ['Sales', 'Leasing', 'Sales & leasing', 'Off-plan'];
const SOURCES = ['Cold outreach', 'LinkedIn', 'Referral', 'Applied', 'Other'];
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
// Common Dubai brokerages to start the drop-down. Anything she types is added to the list automatically.
const BROKERAGES = ['Allsopp & Allsopp', 'Betterhomes', 'Driven Properties', 'Engel & Völkers', 'Espace', 'fäm Properties', 'Haus & Haus',
  'Hamptons', 'Metropolitan', 'Provident', 'Sotheby\'s International Realty', 'Unique Properties', 'Coldwell Banker', 'Exclusive Links', 'Not in real estate'];
const FOLLOWS = [['day', 'Tomorrow'], ['3days', 'In 3 days'], ['week', 'Next week'], ['month', 'In a month']];

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
const waLink = (phone) => { let d = String(phone || '').replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); if (d.startsWith('0')) d = '971' + d.slice(1); return d.length >= 8 ? 'https://wa.me/' + d : null; };

export default function Recruit({ api, toast }) {
  const [f, setF] = useState({ q: '', stage: '', brokerage: '', area: '', focus: '', temp: '', source: '', due: '' });
  const [view, setView] = useState(() => { try { return localStorage.getItem('rcView') || 'board'; } catch { return 'board'; } });
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);     // candidate id
  const [adding, setAdding] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const qs = useMemo(() => Object.entries(f).filter(([, v]) => v).map(([k, v]) => `&${k}=${encodeURIComponent(v)}`).join(''), [f]);
  const load = useCallback(() => api('/api/recruit?action=list' + qs).then((j) => { setD(j); setErr(''); }).catch((e) => setErr(e.message)), [api, qs]);
  useEffect(() => { const t = setTimeout(load, f.q ? 250 : 0); return () => clearTimeout(t); }, [load, f.q]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const setV = (v) => { setView(v); try { localStorage.setItem('rcView', v); } catch {} };
  const anyFilter = Object.values(f).some(Boolean);
  // Drag a card to another column to move its stage
  const move = async (id, stage) => {
    const c = d.rows.find((r) => r.id === id);
    if (!c || c.stage === stage) return;
    setD((x) => ({ ...x, rows: x.rows.map((r) => (r.id === id ? { ...r, stage } : r)) }));
    try { await api('/api/recruit?action=log', { method: 'POST', body: { id, stage } }); load(); }
    catch (e) { toast(e.message); load(); }
  };

  if (err && !d) return <main className="gut rc"><p className="err" style={{ marginTop: 30 }}>{err}</p></main>;
  if (!d) return <main className="gut rc muted" style={{ padding: 40 }}>Loading…</main>;
  const cols = showClosed ? STAGES : OPEN;
  return (
    <main className="gut rc">
      <style>{CSS}</style>
      <div className="rc-head">
        <div>
          <h1>Recruitment</h1>
          <p className="muted">{d.total} in the pipeline · {d.counts.Placed || 0} placed</p>
        </div>
        <div className="rc-acts">
          <button className={'rc-due' + (f.due === 'today' ? ' on' : '') + (d.overdue ? ' late' : d.due ? ' has' : '')} onClick={() => set('due', f.due === 'today' ? '' : 'today')}>
            Today&apos;s follow-ups <b>{d.due}</b>{d.overdue ? <em>{d.overdue} overdue</em> : null}
          </button>
          <div className="seg">{[['board', 'Board'], ['list', 'List']].map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => setV(k)}>{l}</button>)}</div>
          <button className="btn primary" onClick={() => setAdding(true)}>Add candidate</button>
        </div>
      </div>

      <div className="rc-filters">
        <input type="search" placeholder="Search name, brokerage, number" value={f.q} onChange={(e) => set('q', e.target.value)} />
        <Sel v={f.brokerage} on={(v) => set('brokerage', v)} all="All brokerages" opts={d.brokerages} />
        <Sel v={f.area} on={(v) => set('area', v)} all="All areas" opts={d.areas} />
        <Sel v={f.focus} on={(v) => set('focus', v)} all="Sales and leasing" opts={FOCUS} />
        <Sel v={f.temp} on={(v) => set('temp', v)} all="Hot, warm, cold" opts={TEMPS} />
        <Sel v={f.stage} on={(v) => set('stage', v)} all="Every stage" opts={STAGES} />
        <Sel v={f.source} on={(v) => set('source', v)} all="Every source" opts={SOURCES} />
        <Sel v={f.due} on={(v) => set('due', v)} all="Any follow-up" opts={[['today', 'Due today or late'], ['week', 'Due this week'], ['none', 'No follow-up set']]} />
        {anyFilter && <button className="link" onClick={() => setF({ q: '', stage: '', brokerage: '', area: '', focus: '', temp: '', source: '', due: '' })}>Clear</button>}
      </div>

      {view === 'board' ? (
        <>
          <div className="rc-board" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(210px, 1fr))` }}>
            {cols.map((st) => {
              const cards = d.rows.filter((r) => r.stage === st);
              return (
                <section key={st} className={'rc-col' + (CLOSED.includes(st) ? ' closed' : '') + (st === 'Placed' ? ' won' : '')}
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('over'); }}
                  onDragLeave={(e) => e.currentTarget.classList.remove('over')}
                  onDrop={(e) => { e.currentTarget.classList.remove('over'); move(Number(e.dataTransfer.getData('text/plain')), st); }}>
                  <h3>{st} <span>{cards.length}{anyFilter && d.counts[st] && d.counts[st] !== cards.length ? ` of ${d.counts[st]}` : ''}</span></h3>
                  {cards.map((c) => <Card key={c.id} c={c} onOpen={() => setOpen(c.id)} />)}
                  {!cards.length && <p className="rc-empty">—</p>}
                </section>
              );
            })}
          </div>
          <button className="link rc-closed" onClick={() => setShowClosed(!showClosed)}>
            {showClosed ? 'Hide Not interested and Rejected' : `Show Not interested (${d.counts['Not interested'] || 0}) and Rejected (${d.counts.Rejected || 0})`}
          </button>
        </>
      ) : (
        <div className="rc-tw">
          <table className="rc-t">
            <thead><tr><th>Name</th><th>Brokerage</th><th>Area</th><th>Focus</th><th>Stage</th><th></th><th>Follow up</th><th>Last spoke</th><th>Latest note</th></tr></thead>
            <tbody>{d.rows.map((c) => (
              <tr key={c.id} onClick={() => setOpen(c.id)}>
                <td><b>{c.name}</b></td><td>{c.brokerage || '—'}</td><td>{c.area || '—'}</td><td>{c.focus || '—'}</td><td>{c.stage}</td>
                <td>{c.temp && <span className={'rc-temp ' + c.temp}>{c.temp}</span>}</td>
                <td className={'rc-fu ' + followState(c.follow_up_at)}>{fmtDay(c.follow_up_at) || '—'}</td>
                <td className="muted">{fmtDay(c.last_contact_at) || 'Never'}</td>
                <td className="rc-ln">{c.last_note || ''}</td>
              </tr>))}</tbody>
          </table>
          {!d.rows.length && <p className="muted" style={{ padding: 20 }}>{anyFilter ? 'Nobody matches these filters.' : 'No candidates yet. Add your first one.'}</p>}
        </div>
      )}

      {adding && <AddCandidate api={api} lists={d} onClose={() => setAdding(false)} onSaved={(id) => { setAdding(false); load(); setOpen(id); }} onOpen={(id) => { setAdding(false); setOpen(id); }} />}
      {open && <Candidate api={api} id={open} lists={d} toast={toast} onClose={() => setOpen(null)} onChanged={load} />}
    </main>
  );
}

function Sel({ v, on, all, opts }) {
  return (
    <select value={v} onChange={(e) => on(e.target.value)} className={v ? 'set' : ''}>
      <option value="">{all}</option>
      {opts.map((o) => (Array.isArray(o) ? <option key={o[0]} value={o[0]}>{o[1]}</option> : <option key={o} value={o}>{o}</option>))}
    </select>
  );
}

function Card({ c, onOpen }) {
  const fs = followState(c.follow_up_at);
  return (
    <article className={'rc-card' + (c.temp ? ' t-' + c.temp : '')} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', String(c.id))} onClick={onOpen}>
      <div className="rc-card-top"><b>{c.name}</b>{c.temp && <span className={'rc-temp ' + c.temp}>{c.temp}</span>}</div>
      <div className="rc-card-sub">{[c.brokerage, c.area].filter(Boolean).join(' · ') || <span className="faint">No brokerage yet</span>}</div>
      <div className="rc-card-foot">
        {c.focus && <span className="rc-tag">{c.focus}</span>}
        {c.stage === 'Interview booked' && c.interview_at && <span className="rc-tag iv">Interview {fmtDay(c.interview_at)}</span>}
        {c.follow_up_at && <span className={'rc-fu ' + fs}>{fs === 'late' ? 'Late · ' : ''}{fmtDay(c.follow_up_at)}</span>}
      </div>
    </article>
  );
}

// The fields shared by Add and Edit
function Fields({ v, set, lists }) {
  const brokerages = useMemo(() => [...new Set([...lists.brokerages, ...BROKERAGES])].sort((a, b) => a.localeCompare(b)), [lists.brokerages]);
  return (
    <div className="rc-form">
      <label className="wide">Name<input value={v.name} onChange={(e) => set('name', e.target.value)} autoFocus /></label>
      <label>Mobile<input value={v.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+971 50 …" /></label>
      <label>Email<input type="email" value={v.email} onChange={(e) => set('email', e.target.value)} /></label>
      <label>Brokerage<input list="rc-brokerages" value={v.brokerage} onChange={(e) => set('brokerage', e.target.value)} placeholder="Pick or type a new one" />
        <datalist id="rc-brokerages">{brokerages.map((b) => <option key={b} value={b} />)}</datalist></label>
      <label>Area they cover<input list="rc-areas" value={v.area} onChange={(e) => set('area', e.target.value)} placeholder="Pick or type" />
        <datalist id="rc-areas">{lists.areas.map((a) => <option key={a} value={a} />)}</datalist></label>
      <label>Sales or leasing<select value={v.focus} onChange={(e) => set('focus', e.target.value)}><option value="">—</option>{FOCUS.map((x) => <option key={x}>{x}</option>)}</select></label>
      <label>Source<select value={v.source} onChange={(e) => set('source', e.target.value)}><option value="">—</option>{SOURCES.map((x) => <option key={x}>{x}</option>)}</select></label>
      <label>Stage<select value={v.stage} onChange={(e) => set('stage', e.target.value)}>{STAGES.map((x) => <option key={x}>{x}</option>)}</select></label>
      <label>LinkedIn<input value={v.linkedin} onChange={(e) => set('linkedin', e.target.value)} placeholder="Link (optional)" /></label>
      <div className="wide"><span className="rc-lbl">Hot or cold</span><Temps v={v.temp} on={(t) => set('temp', t)} /></div>
    </div>
  );
}

function Temps({ v, on }) {
  return <div className="rc-chips">{TEMPS.map(([k, l]) => <button type="button" key={k} className={'chip rc-t-' + k + (v === k ? ' on' : '')} onClick={() => on(v === k ? '' : k)}>{l}</button>)}</div>;
}

function FollowPicker({ v, on, current }) {
  return (
    <div className="rc-follow">
      <span className="rc-lbl">Follow up {current ? <em>· now {fmtWhen(current)}</em> : null}</span>
      <div className="rc-chips">
        {FOLLOWS.map(([k, l]) => <button type="button" key={k} className={'chip' + (v.kind === k ? ' on' : '')} onClick={() => on(v.kind === k ? {} : { kind: k })}>{l}</button>)}
        <button type="button" className={'chip' + (v.kind === 'custom' ? ' on' : '')} onClick={() => on(v.kind === 'custom' ? {} : { kind: 'custom', at: v.at || '' })}>Pick a date</button>
        {current && <button type="button" className={'chip' + (v.kind === 'none' ? ' on' : '')} onClick={() => on(v.kind === 'none' ? {} : { kind: 'none' })}>No follow-up</button>}
      </div>
      {v.kind === 'custom' && <input type="datetime-local" value={v.at || ''} onChange={(e) => on({ kind: 'custom', at: e.target.value })} />}
    </div>
  );
}

const blank = { name: '', phone: '', email: '', brokerage: '', area: '', focus: '', source: 'Cold outreach', stage: 'To contact', linkedin: '', temp: '' };
const followBody = (fu) => (fu.kind === 'custom' ? (fu.at ? { kind: 'custom', at: new Date(fu.at).toISOString() } : {}) : fu);

function AddCandidate({ api, lists, onClose, onSaved, onOpen }) {
  const [v, setVal] = useState(blank);
  const [note, setNote] = useState('');
  const [fu, setFu] = useState({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [dupe, setDupe] = useState(null);
  const set = (k, x) => setVal((o) => ({ ...o, [k]: x }));
  const save = async (force = false) => {
    setBusy(true); setErr(''); setDupe(null);
    try { const j = await api('/api/recruit?action=save', { method: 'POST', body: { ...v, note, followUp: followBody(fu), force } }); onSaved(j.id); }
    catch (e) { setErr(e.message); if (/already in the pipeline/.test(e.message)) setDupe(true); }
    setBusy(false);
  };
  return (
    <div className="modal rc" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="box rc-box">
        <h3>Add candidate</h3>
        <Fields v={v} set={set} lists={lists} />
        <label className="rc-note">First note<textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Where you found them, what they're like, anything useful" /></label>
        <FollowPicker v={fu} on={setFu} />
        {err && <p className="err">{err}</p>}
        <div className="rc-btns">
          <button className="btn primary" disabled={busy || !v.name.trim()} onClick={() => save(false)}>{busy ? 'Saving…' : 'Add'}</button>
          {dupe && <button className="btn" onClick={() => save(true)}>Add anyway</button>}
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
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
  const load = useCallback(() => api('/api/recruit?action=get&id=' + id).then(setD).catch((e) => setErr(e.message)), [api, id]);
  useEffect(() => { load(); }, [load]);
  const c = d?.candidate;
  const quick = async (body) => {
    try { await api('/api/recruit?action=log', { method: 'POST', body: { id, ...body } }); await load(); onChanged(); }
    catch (e) { toast(e.message); }
  };
  const logIt = async () => {
    const r = CALL_RESULTS.find((x) => x.k === result);
    const text = [result, note.trim()].filter(Boolean).join('. ');
    setBusy(true); setErr('');
    try {
      await api('/api/recruit?action=log', { method: 'POST', body: {
        id, note: text, call: !!result, followUp: followBody(fu),
        ...(r?.stage && r.stage !== c.stage ? { stage: r.stage } : {}), ...(r?.temp ? { temp: r.temp } : {}) } });
      setResult(''); setNote(''); setFu({});
      await load(); onChanged();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const saveEdit = async () => {
    setBusy(true); setErr('');
    try { await api('/api/recruit?action=save', { method: 'POST', body: { id, ...edit, interview_at: edit.interview_at ? new Date(edit.interview_at).toISOString() : null } }); setEdit(null); await load(); onChanged(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };
  const archive = async () => {
    if (!window.confirm(`Remove ${c.name} from the pipeline?`)) return;
    try { await api('/api/recruit?action=archive', { method: 'POST', body: { id } }); onChanged(); onClose(); } catch (e) { toast(e.message); }
  };
  return (
    <div className="modal rc" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="box rc-box rc-cand">
        {!d ? <p className="muted">{err || 'Loading…'}</p> : edit ? (
          <>
            <h3>Edit {c.name}</h3>
            <Fields v={edit} set={(k, x) => setEdit((o) => ({ ...o, [k]: x }))} lists={lists} />
            {edit.stage === 'Interview booked' && <label className="rc-note">Interview date<input type="datetime-local" value={edit.interview_at || ''} onChange={(e) => setEdit((o) => ({ ...o, interview_at: e.target.value }))} /></label>}
            {err && <p className="err">{err}</p>}
            <div className="rc-btns"><button className="btn primary" disabled={busy || !edit.name.trim()} onClick={saveEdit}>Save</button><button className="btn" onClick={() => setEdit(null)}>Cancel</button>
              <button className="link rc-arch" onClick={archive}>Remove from pipeline</button></div>
          </>
        ) : (
          <>
            <div className="rc-ch">
              <div>
                <h3>{c.name} {c.temp && <span className={'rc-temp ' + c.temp}>{c.temp}</span>}</h3>
                <p className="muted">{[c.brokerage, c.area, c.focus].filter(Boolean).join(' · ') || 'No details yet'}{c.source ? ` · via ${c.source}` : ''}</p>
              </div>
              <div className="rc-btns">
                <button className="btn" onClick={() => setEdit({ ...blank, ...Object.fromEntries(Object.entries(c).map(([k, x]) => [k, x ?? ''])), interview_at: localInput(c.interview_at) })}>Edit</button>
                <button className="btn" onClick={onClose}>Close</button>
              </div>
            </div>
            <div className="rc-contact">
              {c.phone && <a className="btn" href={'tel:' + c.phone}>Call {c.phone}</a>}
              {waLink(c.phone) && <a className="btn" href={waLink(c.phone)} target="_blank" rel="noreferrer">WhatsApp</a>}
              {c.email && <a className="btn" href={'mailto:' + c.email}>Email</a>}
              {c.linkedin && <a className="btn" href={/^https?:/.test(c.linkedin) ? c.linkedin : 'https://' + c.linkedin} target="_blank" rel="noreferrer">LinkedIn</a>}
            </div>

            <div className="rc-row">
              <span className="rc-lbl">Stage</span>
              <div className="rc-stages">{STAGES.map((st) => <button key={st} className={'chip' + (c.stage === st ? ' on' : '') + (CLOSED.includes(st) ? ' cl' : '')} onClick={() => c.stage !== st && quick({ stage: st })}>{st}</button>)}</div>
            </div>
            {c.stage === 'Interview booked' && (
              <div className="rc-row"><span className="rc-lbl">Interview</span>
                <input type="datetime-local" defaultValue={localInput(c.interview_at)} onBlur={(e) => e.target.value !== localInput(c.interview_at) && quick({ interview_at: e.target.value ? new Date(e.target.value).toISOString() : null })} /></div>
            )}
            <div className="rc-row"><span className="rc-lbl">Hot or cold</span><Temps v={c.temp || ''} on={(t) => quick({ temp: t })} /></div>

            <section className="rc-log">
              <h4>Log a call or note</h4>
              <div className="rc-chips">{CALL_RESULTS.map((r) => <button type="button" key={r.k} className={'chip' + (result === r.k ? ' on' : '')} onClick={() => setResult(result === r.k ? '' : r.k)}>{r.k}</button>)}</div>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={result ? 'Add detail (optional)' : 'What was said, what they want, what happens next'} />
              <FollowPicker v={fu} on={setFu} current={c.follow_up_at} />
              {err && <p className="err">{err}</p>}
              <button className="btn primary" disabled={busy || (!result && !note.trim() && !fu.kind)} onClick={logIt}>{busy ? 'Saving…' : 'Save'}</button>
              {(() => { const r = CALL_RESULTS.find((x) => x.k === result); return r && (r.stage || r.temp) ? <p className="faint rc-hint">Also sets {[r.stage && r.stage !== c.stage && `stage to ${r.stage}`, r.temp && `${r.temp}`].filter(Boolean).join(' and ')}.</p> : null; })()}
            </section>

            <section className="rc-hist">
              <h4>History</h4>
              {d.notes.length ? d.notes.map((n) => (
                <div key={n.id} className={'rc-n ' + n.kind}>
                  <span className="rc-nm">{fmtWhen(n.created_at)}{n.by ? ` · ${n.by}` : ''}{n.kind === 'call' ? ' · call' : ''}</span>
                  <span>{n.kind === 'stage' ? `Moved ${n.body}` : n.body}</span>
                </div>)) : <p className="muted">Nothing yet.</p>}
              <p className="faint rc-nm">Added {fmtWhen(c.created_at)}</p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

const CSS = `
.rc h1{margin:0;font-size:24px} .rc .muted{color:var(--muted)}
.rc-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin:22px 0 14px}
.rc-head p{margin:4px 0 0}
.rc-acts{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.rc-due{border:1px solid var(--line);background:var(--bg);border-radius:999px;padding:8px 14px;font-size:14px;cursor:pointer;color:var(--ink);display:flex;gap:8px;align-items:center}
.rc-due b{background:var(--hover);border-radius:999px;padding:1px 8px;font-size:13px} .rc-due em{font-style:normal;font-size:12px;color:var(--cold)}
.rc-due.has b{background:var(--hot);color:#fff} .rc-due.late b{background:var(--cold);color:#fff} .rc-due.on{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.rc .seg{display:inline-flex;border:1px solid var(--line);border-radius:999px;overflow:hidden} .rc .seg button{border:0;background:none;padding:7px 14px;font-size:13px;color:var(--muted);cursor:pointer} .rc .seg button.on{background:var(--accent);color:var(--accent-ink)}
.rc-filters{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
.rc input,.rc select,.rc textarea{font:inherit;font-size:13.5px;padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink)}
.rc textarea{resize:vertical} .rc-row input[type=datetime-local]{max-width:260px}
.rc-filters input[type=search]{width:240px} .rc-filters select{max-width:190px} .rc-filters select.set{border-color:var(--accent);color:var(--accent)}
.rc-board{display:grid;gap:10px;overflow-x:auto;padding-bottom:8px;align-items:start}
.rc-col{background:var(--hover);border-radius:12px;padding:10px;min-height:120px;display:flex;flex-direction:column;gap:8px;transition:box-shadow .1s}
.rc-col.over{box-shadow:inset 0 0 0 2px var(--accent)} .rc-col.closed{opacity:.8} .rc-col.won h3{color:var(--hot)}
.rc-col h3{margin:2px 2px 4px;font-size:13px;font-weight:650;display:flex;justify-content:space-between} .rc-col h3 span{color:var(--muted);font-weight:500}
.rc-empty{margin:4px;color:var(--faint);font-size:13px}
.rc-card{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:9px 10px;cursor:pointer;display:flex;flex-direction:column;gap:4px;border-left:3px solid var(--line)}
.rc-card:hover{border-color:var(--accent)} .rc-card.t-hot{border-left-color:var(--hot)} .rc-card.t-warm{border-left-color:#d79a2b} .rc-card.t-cold{border-left-color:#7b9fc4}
.rc-card-top{display:flex;justify-content:space-between;gap:6px;align-items:center;font-size:14px}
.rc-card-sub{font-size:12.5px;color:var(--muted)}
.rc-card-foot{display:flex;gap:6px;flex-wrap:wrap;align-items:center;font-size:12px}
.rc-tag{background:var(--hover);border-radius:6px;padding:1px 7px;color:var(--muted)} .rc-tag.iv{color:var(--hot)}
.rc-temp{font-size:11px;text-transform:uppercase;letter-spacing:.04em;font-weight:700;border-radius:6px;padding:1px 6px;vertical-align:middle}
.rc-temp.hot{color:var(--hot);background:color-mix(in srgb,var(--hot) 12%,transparent)} .rc-temp.warm{color:#b07a14;background:#d79a2b22} .rc-temp.cold{color:#4f78a3;background:#7b9fc422}
.rc-fu{color:var(--muted)} .rc-fu.due{color:var(--hot);font-weight:600} .rc-fu.late{color:var(--cold);font-weight:600}
.rc-closed{margin-top:8px;font-size:13px}
.rc-tw{border:1px solid var(--line);border-radius:12px;overflow:auto}
.rc-t{width:100%;border-collapse:collapse;font-size:13.5px} .rc-t th{text-align:left;font-weight:600;color:var(--muted);font-size:12px;padding:10px 12px;border-bottom:1px solid var(--line);white-space:nowrap}
.rc-t td{padding:9px 12px;border-bottom:1px solid var(--line);white-space:nowrap} .rc-t tr{cursor:pointer} .rc-t tbody tr:hover{background:var(--hover)}
.rc-ln{max-width:320px;overflow:hidden;text-overflow:ellipsis;color:var(--muted)}
.rc-box{width:min(720px,94vw);max-height:92vh;overflow:auto}
.rc-box h3{margin:0 0 4px} .rc-box h4{margin:0 0 8px;font-size:14px}
.rc-form{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;margin:12px 0}
.rc-form label,.rc-note{display:flex;flex-direction:column;gap:4px;font-size:12.5px;color:var(--muted)} .rc-form .wide{grid-column:1/-1}
.rc-form input,.rc-form select,.rc-note textarea,.rc-note input{color:var(--ink)}
.rc-lbl{font-size:12.5px;color:var(--muted);display:block;margin-bottom:5px} .rc-lbl em{font-style:normal}
.rc-chips{display:flex;flex-wrap:wrap;gap:6px}
.rc-t-hot.on{border-color:var(--hot);color:var(--hot)} .rc-t-warm.on{border-color:#d79a2b;color:#b07a14} .rc-t-cold.on{border-color:#7b9fc4;color:#4f78a3}
.rc-follow{margin:10px 0;display:flex;flex-direction:column;gap:6px} .rc-follow input{max-width:240px}
.rc-btns{display:flex;gap:8px;align-items:center;flex-wrap:wrap} .rc-arch{margin-left:auto;color:var(--cold)}
.rc-ch{display:flex;justify-content:space-between;gap:12px;align-items:flex-start} .rc-ch p{margin:2px 0 0}
.rc-contact{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
.rc-row{display:grid;grid-template-columns:100px 1fr;gap:10px;align-items:center;margin:8px 0} .rc-row .rc-lbl{margin:0}
.rc-stages{display:flex;flex-wrap:wrap;gap:5px} .rc-stages .chip{font-size:12.5px} .rc-stages .chip.cl{opacity:.75}
.rc-log{border:1px solid var(--line);border-radius:12px;padding:12px;margin:14px 0;display:flex;flex-direction:column;gap:8px}
.rc-log textarea{min-height:64px} .rc-log .btn.primary{align-self:flex-start} .rc-hint{margin:0;font-size:12px}
.rc-hist{display:flex;flex-direction:column;gap:2px}
.rc-n{display:flex;flex-direction:column;gap:2px;padding:8px 0;border-bottom:1px solid var(--line);font-size:13.5px;white-space:pre-wrap}
.rc-n.stage{color:var(--muted);font-size:12.5px} .rc-nm{font-size:11.5px;color:var(--faint)}
@media (max-width:640px){.rc-form{grid-template-columns:1fr}.rc-row{grid-template-columns:1fr}}
`;
