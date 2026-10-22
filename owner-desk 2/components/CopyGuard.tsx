'use client';
import { useEffect, useState } from 'react';

// Blocks copying and right-click on owner data and records each attempt in the activity log.
export default function CopyGuard() {
  const [msg, setMsg] = useState('');
  useEffect(() => {
    const onCopy = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest && t.closest('input,textarea')) return;
      e.preventDefault();
      setMsg('Copying is turned off. This was logged.');
      fetch('/api/audit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'copy_blocked' }) });
      setTimeout(() => setMsg(''), 2400);
    };
    const onMenu = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest && t.closest('.tw,.detail')) e.preventDefault();
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('contextmenu', onMenu);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('contextmenu', onMenu);
    };
  }, []);
  return msg ? <div className="toast">{msg}</div> : null;
}
