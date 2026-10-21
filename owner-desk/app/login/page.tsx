'use client';
import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const noAccess = params?.get('e') === 'access';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    const sb = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    );
    const { error } = await sb.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      setErr('Email or password is wrong.');
      return;
    }
    const next = params?.get('next');
    window.location.href = next === '/phone' ? '/phone' : '/';
  }

  return (
    <main className="login">
      <h1>Apex Owner Desk</h1>
      <p className="muted">Sign in with your Apex account.</p>
      {noAccess && <p className="err">This account isn&apos;t set up for the Owner Desk yet. Ask the Operations Manager.</p>}
      <form onSubmit={submit}>
        <input id="email" type="email" autoComplete="username" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input id="password" type="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {err && <span className="err">{err}</span>}
        <button className="btn primary" disabled={busy} type="submit">{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
