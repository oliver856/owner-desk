'use client';
import { useEffect, useState } from 'react';
import OutcomeForm from '@/components/OutcomeForm';

type Pending = { id: number; owner_name: string; masked: string; unit_no: string; unit_type: string; subcommunity: string; building: string; end_date: string | null; seconds_left: number };
type Awaiting = { id: number; owner_name: string; unit_no: string; unit_type: string; subcommunity: string; building: string };

const place = (x: { unit_type: string; subcommunity: string; building: string; unit_no: string }) =>
  x.unit_type === 'Villa' ? `${x.subcommunity} · villa ${x.unit_no}` : `${x.building} · ${x.unit_no}`;

// The phone screen. Add it to the home screen once; it waits for calls started on the laptop.
export default function Phone() {
  const [name, setName] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [awaiting, setAwaiting] = useState<Awaiting | null>(null);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);

  async function load() {
    const r = await fetch('/api/phone/pending', { cache: 'no-store' });
    if (r.status === 401) { location.href = '/login?next=/phone'; return; }
    if (!r.ok) return;
    const j = await r.json();
    setName(j.name);
    setPending(j.pending);
    setAwaiting(j.awaiting);
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    const vis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, []);

  async function dial(id: number) {
    setErr('');
    const r = await fetch(`/api/phone/dial/${id}`, { method: 'POST' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.error ?? 'Could not start the call.'); load(); return; }
    setPending(null);
    window.location.href = 'tel:' + j.tel;
    setTimeout(load, 1500);
  }

  return (
    <main className="phone">
      <div>
        <h1>Apex Owner Desk</h1>
        <span className="muted">{name ? `Signed in as ${name}` : ' '}</span>
      </div>

      {pending && (
        <div className="callcard">
          <span className="muted">Call</span>
          <span className="who">{pending.owner_name}</span>
          <span>{place(pending)}</span>
          <span className="num n muted">{pending.masked}</span>
          <button className="bigcall" onClick={() => dial(pending.id)}>Call</button>
        </div>
      )}

      {!pending && awaiting && !saved && (
        <div className="callcard">
          <span className="muted">How did the call go?</span>
          <span className="who">{awaiting.owner_name}</span>
          <span>{place(awaiting)}</span>
          <OutcomeForm big requestId={awaiting.id} onSaved={() => { setSaved(true); setTimeout(() => { setSaved(false); load(); }, 1500); }} />
        </div>
      )}

      {saved && <div className="waiting">Saved</div>}
      {!pending && !awaiting && !saved && <div className="waiting">Waiting for a call from your laptop.<br />Press Call next to an owner and it appears here.</div>}
      {err && <p className="err">{err}</p>}
    </main>
  );
}
