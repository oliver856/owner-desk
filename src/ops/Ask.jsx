// Ask: management asks a question in plain words and Claude answers from the Desk's own figures.
// Server side: api/_lib/ask.js (tools, limits, log). The limits are in desk.settings 'ask'.
import React, { useEffect, useRef, useState } from 'react';
import { Bar, Section, Btn, Wait, clock } from './kit.jsx';

const EXAMPLES_ALL = [
  'Which brokers made fewer than 100 calls this month?',
  'How is each team doing on billing this month compared with last month?',
  'Who has the most overdue call-backs?',
  'Who hasn\'t billed in the last 3 months?',
  'How many listing opportunities came from calls this month, by broker?',
  'Why have listings come off the portals this month?',
];
const EXAMPLES_TEAM = [
  'Who in my team made the fewest calls this week?',
  'Who has overdue call-backs?',
  'How many listings has my team added this month?',
  'Who in my team hasn\'t billed this month?',
  'How many listing opportunities has my team got from calls this week?',
  'Why have my team\'s listings come off this month?',
];

// A small, safe renderer for the answer: paragraphs, bullet and numbered lists, **bold** and pipe tables
const inline = (t) => t.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p));
function Answer({ text }) {
  const blocks = []; const lines = String(text || '').split('\n'); let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      const cells = rows.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r)).map((r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      const [head, ...body] = cells;
      const num = (c) => /^[-+]?(AED\s*)?[\d,.]+%?$/.test(c);
      blocks.push(<div className="ops-tbl ask-tbl" key={i}><table><thead><tr>{head.map((h, k) => <th key={k} className={body.every((r) => num(r[k] || '')) ? 'r' : ''}>{inline(h)}</th>)}</tr></thead>
        <tbody>{body.map((r, j) => <tr key={j}>{head.map((_, k) => <td key={k} className={num(r[k] || '') ? 'r' : ''}>{inline(r[k] || '')}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d/.test(l); const items = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, '')); i++; }
      const L = ordered ? 'ol' : 'ul';
      blocks.push(<L key={i}>{items.map((t, k) => <li key={k}>{inline(t)}</li>)}</L>);
      continue;
    }
    if (l.trim()) {
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^\s*(\||[-*•]\s|\d+[.)]\s)/.test(lines[i])) { para.push(lines[i].replace(/^#+\s*/, '')); i++; }
      blocks.push(<p key={i}>{inline(para.join(' '))}</p>);
      continue;
    }
    i++;
  }
  return <div className="ask-ans">{blocks}</div>;
}

const CSS = `
.ask-box{display:flex;flex-direction:column;gap:10px;margin-top:14px;border:1px solid var(--line);border-radius:12px;padding:14px;background:var(--bg)}
.ask-box:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 12%,transparent)}
.ask-box textarea{font:inherit;font-size:15px;line-height:1.5;color:var(--ink);background:none;border:none;outline:none;resize:none;min-height:52px}
.ask-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.ask-row .grow{flex:1}
.ask-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.ask-chip{font:inherit;font-size:13px;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:99px;padding:6px 12px;cursor:pointer;text-align:left}
.ask-chip:hover{border-color:var(--accent);color:var(--accent)}
.ask-card{border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-top:14px}
.ask-q{font-weight:650;margin:0 0 10px}
.ask-ans{line-height:1.6}
.ask-ans p{margin:0 0 10px} .ask-ans ul,.ask-ans ol{margin:0 0 10px;padding-left:20px} .ask-ans li{margin:3px 0}
.ask-tbl{margin:4px 0 12px}
.ask-meta{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:10px;font-size:12.5px}
.ask-dots{display:inline-flex;gap:4px} .ask-dots i{width:6px;height:6px;border-radius:50%;background:var(--accent);animation:askb 1s infinite alternate}
.ask-dots i:nth-child(2){animation-delay:.2s} .ask-dots i:nth-child(3){animation-delay:.4s}
@keyframes askb{from{opacity:.25}to{opacity:1}}
.ask-hist{display:flex;flex-direction:column}
.ask-hist button{font:inherit;background:none;border:none;border-bottom:1px solid var(--line);padding:10px 2px;text-align:left;cursor:pointer;color:var(--ink);display:flex;gap:12px;justify-content:space-between}
.ask-hist button:hover{color:var(--accent)}
`;

export default function Ask({ api, team }) {
  const [page, setPage] = useState(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(null);   // { question, answer, used, at }
  const box = useRef(null);
  const load = () => api('/api/ops?action=ask' + (team ? '&team=' + encodeURIComponent(team) : '')).then(setPage).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [team]);

  const send = async (text) => {
    const question = (text ?? q).trim();
    if (!question || busy) return;
    setBusy(true); setErr(''); setShown({ question, answer: null });
    try {
      const j = await api('/api/ops' + (team ? '?team=' + encodeURIComponent(team) : ''), { method: 'POST', body: { action: 'ask', question } });
      setShown({ question, answer: j.answer, used: j.used, at: new Date().toISOString() });
      setQ('');
      load();
    } catch (e) { setErr(e.message); setShown(null); }
    setBusy(false);
  };

  if (!page) return <Wait err={err} />;
  const examples = page.all && !team ? EXAMPLES_ALL : EXAMPLES_TEAM;
  return (
    <>
      <style>{CSS}</style>
      <Bar note={`Ask about calls, listings, leads, people and billing${page.all ? ', and every deal' : ''}. Answers come only from the Desk's own figures${page.team ? ` for ${page.team}` : ''}.`}>
        {page.usage && <span className="muted">Today {page.usage.today} of {page.usage.companyDay} questions · this month ${page.usage.monthUsd.toFixed(2)} of ${page.usage.monthlyUsd}</span>}
      </Bar>
      {!page.on ? <p className="ops-msg warn" style={{ marginTop: 14 }}>Ask isn't switched on yet.</p> : (
        <>
          <div className="ask-box" onClick={() => box.current?.focus()}>
            <textarea ref={box} value={q} maxLength={600} rows={2} placeholder="For example: who made the fewest calls this week, and how many owners did they reach?"
              onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} disabled={busy} />
            <div className="ask-row">
              <span className="muted grow">{page.left} question{page.left === 1 ? '' : 's'} left today</span>
              <Btn primary disabled={busy || !q.trim() || page.left <= 0} onClick={() => send()}>{busy ? 'Working…' : 'Ask'}</Btn>
            </div>
          </div>
          {!shown && <div className="ask-chips">{examples.map((x) => <button key={x} type="button" className="ask-chip" disabled={busy} onClick={() => { setQ(x); send(x); }}>{x}</button>)}</div>}
        </>
      )}
      {err && <p className="ops-msg err" style={{ marginTop: 14 }}>{err}</p>}
      {shown && (
        <div className="ask-card">
          <p className="ask-q">{shown.question}</p>
          {shown.answer == null ? <span className="muted"><span className="ask-dots"><i /><i /><i /></span> Looking through the figures…</span> : <>
            <Answer text={shown.answer} />
            <div className="ask-meta muted">{shown.used?.length ? <span>Based on: {shown.used.join(', ')}</span> : null}{shown.at && <span>{clock(shown.at)}</span>}</div>
          </>}
        </div>
      )}
      {page.history.length > 0 && (
        <Section title="Your recent questions">
          <div className="ask-hist">{page.history.map((h) => (
            <button key={h.id} type="button" onClick={() => setShown({ question: h.question, answer: h.status === 'ok' ? h.answer : 'That question didn\'t get an answer.', used: h.used, at: h.at })}>
              <span>{h.question}</span><span className="muted">{clock(h.at)}</span>
            </button>))}
          </div>
        </Section>
      )}
    </>
  );
}
