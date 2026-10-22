'use client';
import { useEffect, useState } from 'react';

type State = 'checking' | 'unsupported' | 'install' | 'off' | 'blocked' | 'on' | 'working';

const b64ToBytes = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

// Turns on call notifications for this phone. On iPhone this only works once
// the site has been added to the home screen and opened from that icon.
export default function PhoneAlerts({ onCall }: { onCall: () => void }) {
  const [state, setState] = useState<State>('checking');
  const [err, setErr] = useState('');

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (!('serviceWorker' in navigator)) { setState('unsupported'); return; }
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'call') onCall(); });
    if (!('PushManager' in window) || !('Notification' in window)) { setState(ios && !standalone ? 'install' : 'unsupported'); return; }
    if (Notification.permission === 'denied') { setState('blocked'); return; }
    (async () => {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      const r = await fetch('/api/phone/subscribe').then((x) => x.json()).catch(() => ({ phones: 0 }));
      setState(sub && Notification.permission === 'granted' && r.phones > 0 ? 'on' : 'off');
    })();
  }, [onCall]);

  async function turnOn() {
    setErr('');
    setState('working');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm === 'denied' ? 'blocked' : 'off'); return; }
      const { publicKey } = await fetch('/api/phone/vapid').then((r) => r.json());
      const reg = await navigator.serviceWorker.ready;
      const old = await reg.pushManager.getSubscription();
      if (old) await old.unsubscribe();
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
      const r = await fetch('/api/phone/subscribe', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subscription: sub.toJSON(), test: true }),
      });
      if (!r.ok) throw new Error('save');
      setState('on');
    } catch {
      setErr('Could not turn on alerts. Check your connection and try again.');
      setState('off');
    }
  }

  if (state === 'checking' || state === 'on') {
    return state === 'on' ? <div className="alerts"><span className="ok">Call alerts are on</span><span className="muted">Pressing Call on your laptop sends a notification here.</span></div> : null;
  }
  return (
    <div className="alerts">
      {state === 'install' && <>
        <b>Add Apex Desk to your home screen</b>
        <span className="muted">On iPhone, alerts only work from the home screen icon. Tap the Share button in Safari, choose Add to Home Screen, then open Apex Desk from that icon and sign in.</span>
      </>}
      {state === 'unsupported' && <span className="muted">This browser can&apos;t show call alerts. Keep this screen open and calls will still appear here.</span>}
      {state === 'blocked' && <>
        <b>Notifications are blocked</b>
        <span className="muted">Allow notifications for Apex Desk in your phone&apos;s settings, then reopen it.</span>
      </>}
      {(state === 'off' || state === 'working') && <>
        <b>Turn on call alerts</b>
        <span className="muted">Get a notification on this phone whenever you press Call on your laptop.</span>
        <button className="bigcall" style={{ marginTop: 4 }} onClick={turnOn} disabled={state === 'working'}>{state === 'working' ? 'Turning on…' : 'Turn on call alerts'}</button>
      </>}
      {err && <span className="err">{err}</span>}
    </div>
  );
}
