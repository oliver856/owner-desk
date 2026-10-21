'use client';
import { useEffect, useState } from 'react';
import OutcomeForm from './OutcomeForm';

type Stage = 'idle' | 'sending' | 'sent' | 'dialled' | 'done' | 'expired' | 'error';

export default function CallButton({ unitId, ownerId, label }: { unitId: number; ownerId: number; label: string }) {
  const [stage, setStage] = useState<Stage>('idle');
  const [msg, setMsg] = useState('');
  const [reqId, setReqId] = useState<number | null>(null);

  async function start() {
    setStage('sending');
    const r = await fetch('/api/call', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unitId, ownerId }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setStage('error'); setMsg(j.error ?? 'Could not send the call to your phone.'); return; }
    setReqId(j.requestId);
    setStage('sent');
  }

  useEffect(() => {
    if (!reqId || (stage !== 'sent' && stage !== 'dialled')) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/call/status?id=${reqId}`);
      if (!r.ok) return;
      const j = await r.json();
      if (j.status === 'dialled' && stage === 'sent') setStage('dialled');
      if (j.status === 'done') setStage('done');
      if (j.status === 'expired') setStage('expired');
    }, 2500);
    return () => clearInterval(t);
  }, [reqId, stage]);

  const close = () => { setStage('idle'); setReqId(null); if (stage === 'done') location.reload(); };

  return (
    <>
      <button className="btn" onClick={start} disabled={stage === 'sending'}>Call</button>
      {stage !== 'idle' && stage !== 'sending' && (
        <div className="modal" onClick={(e) => { if (e.target === e.currentTarget && stage !== 'dialled') close(); }}>
          <div className="box" role="dialog" aria-label="Call">
            {stage === 'error' && <><h3>Call not sent</h3><p className="muted">{msg}</p><button className="btn" onClick={close}>Close</button></>}
            {stage === 'sent' && <><h3>Sent to your phone</h3><p className="muted">{label}</p>
              <p>Open Apex Desk on your phone and tap the blue Call button. This link expires in a couple of minutes.</p>
              <button className="btn" onClick={close}>Cancel</button></>}
            {stage === 'expired' && <><h3>Call expired</h3><p className="muted">It wasn&apos;t tapped on your phone in time. Press Call again.</p><button className="btn" onClick={close}>Close</button></>}
            {stage === 'dialled' && reqId && <><h3>How did it go?</h3><p className="muted">{label}</p>
              <OutcomeForm requestId={reqId} onSaved={() => setStage('done')} /></>}
            {stage === 'done' && <><h3>Saved</h3><p className="muted">The outcome is on the unit&apos;s call history.</p><button className="btn" onClick={close}>Close</button></>}
          </div>
        </div>
      )}
    </>
  );
}
