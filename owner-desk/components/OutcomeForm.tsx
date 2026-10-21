'use client';
import { useState } from 'react';

export const OUTCOMES = ['No answer', 'Not interested', 'Call back', 'Wants valuation', 'Listing opportunity', 'Wants to sell', 'Wrong number', 'Do not call'];
const HOT = ['Wants valuation', 'Listing opportunity', 'Wants to sell'];

export default function OutcomeForm({ requestId, onSaved, big }: { requestId: number; onSaved: () => void; big?: boolean }) {
  const [pick, setPick] = useState('');
  const [note, setNote] = useState('');
  const [kendal, setKendal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save() {
    setBusy(true);
    const r = await fetch('/api/outcome', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId, outcome: pick, note, kendal }),
    });
    setBusy(false);
    if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error ?? 'Could not save.'); return; }
    onSaved();
  }

  return (
    <div>
      <div className={big ? 'outcomes' : 'radios'}>
        {OUTCOMES.map((o) => big ? (
          <button key={o} type="button" onClick={() => { setPick(o); setKendal(HOT.includes(o)); }}
            style={pick === o ? { borderColor: 'var(--accent)', color: 'var(--accent)', fontWeight: 600 } : undefined}>{o}</button>
        ) : (
          <label className="cb" key={o}><input type="radio" name={`oc-${requestId}`} checked={pick === o}
            onChange={() => { setPick(o); setKendal(HOT.includes(o)); }} />{o}</label>
        ))}
      </div>
      <label className="cb" style={{ marginTop: 10 }}><input type="checkbox" checked={kendal} onChange={(e) => setKendal(e.target.checked)} />Send to Kendal as a lead</label>
      <textarea id={`note-${requestId}`} placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
      {err && <p className="err">{err}</p>}
      <button className={big ? 'bigcall' : 'btn primary'} disabled={!pick || busy} onClick={save}>{busy ? 'Saving…' : 'Save outcome'}</button>
    </div>
  );
}
