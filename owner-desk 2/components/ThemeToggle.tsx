'use client';
import { useState } from 'react';

type Mode = 'light' | 'dark' | 'system';

// Saved in a cookie so the server draws the right theme straight away, with no flash on load
export default function ThemeToggle({ initial }: { initial: Mode }) {
  const [mode, setMode] = useState<Mode>(initial);
  const pick = (m: Mode) => {
    setMode(m);
    document.cookie = `theme=${m}; path=/; max-age=31536000; samesite=lax`;
    if (m === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', m);
  };
  return (
    <span className="theme" role="group" aria-label="Theme">
      {(['light', 'dark', 'system'] as Mode[]).map((m) => (
        <button key={m} type="button" aria-pressed={mode === m} onClick={() => pick(m)}>
          {m === 'light' ? 'Light' : m === 'dark' ? 'Dark' : 'Auto'}
        </button>
      ))}
    </span>
  );
}
