// Ask: management asks a question in plain words and Claude answers from the Desk's own figures.
// Server side: api/_lib/ask.js (tools, limits, log). The limits are in desk.settings 'ask'.
import React, { useEffect, useRef, useState } from 'react';
import { Bar, Btn, Wait, clock } from './kit.jsx';

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

// Pipe tables in an answer, as rows of cells (used by the renderer and the spreadsheet download)
const plain = (c) => c.replace(/\*\*/g, '').trim();
const isNum = (c) => /^[-+]?(AED\s*)?[\d,.]+%?$/.test(plain(c));
export function tablesIn(text) {
  const out = []; let cur = null;
  for (const l of String(text || '').split('\n')) {
    if (/^\s*\|/.test(l)) {
      if (!cur) { cur = []; out.push(cur); }
      if (!/^\s*\|?\s*:?-{2,}/.test(l)) cur.push(l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
    } else cur = null;
  }
  return out.filter((t) => t.length > 1);
}

// A small, safe renderer for the answer: paragraphs, bullet and numbered lists, **bold** and pipe tables
const inline = (t) => t.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p));
export function Answer({ text }) {
  const blocks = []; const lines = String(text || '').split('\n'); let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*\|/.test(l)) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      const cells = rows.filter((r) => !/^\s*\|?\s*:?-{2,}/.test(r)).map((r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
      const [head, ...body] = cells;
      if (!head) continue;
      const right = head.map((_, k) => body.length > 0 && body.every((r) => !plain(r[k] || '') || isNum(r[k] || '')));
      const isTotal = (r) => /^total/i.test(plain(r[0] || ''));
      blocks.push(<div className="ops-tbl ask-tbl" key={i}><table><thead><tr>{head.map((h, k) => <th key={k} className={right[k] ? 'r' : ''}>{inline(h)}</th>)}</tr></thead>
        <tbody>{body.map((r, j) => <tr key={j} className={isTotal(r) ? 'tot' : ''}>{head.map((_, k) => <td key={k} className={right[k] ? 'r' : ''}>{inline(r[k] || '')}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (/^#{1,4}\s+/.test(l)) { blocks.push(<h3 key={i}>{inline(l.replace(/^#+\s*/, ''))}</h3>); i++; continue; }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d/.test(l); const items = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, '')); i++; }
      const L = ordered ? 'ol' : 'ul';
      blocks.push(<L key={i}>{items.map((t, k) => <li key={k}>{inline(t)}</li>)}</L>);
      continue;
    }
    if (l.trim()) {
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^\s*(\||[-*•]\s|\d+[.)]\s|#)/.test(lines[i])) { para.push(lines[i].replace(/^#+\s*/, '')); i++; }
      blocks.push(<p key={i}>{inline(para.join(' '))}</p>);
      continue;
    }
    i++;
  }
  return <div className="ask-ans">{blocks}</div>;
}

// Download every table in an answer as one spreadsheet (CSV, opens in Excel or Google Sheets)
export function downloadTables(item) {
  const csv = tablesIn(item.answer).map((t) => t.map((r) => r.map((c) => {
    const v = plain(c); const n = v.replace(/^AED\s*/, '').replace(/,/g, '');
    const out = isNum(v) && !v.endsWith('%') ? n : v;
    return /[",\n]/.test(out) ? '"' + out.replace(/"/g, '""') + '"' : out;
  }).join(',')).join('\n')).join('\n\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' }));
  a.download = item.question.replace(/[^\w ]+/g, '').trim().slice(0, 60) + '.csv';
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
// Print one answer (or save it as a PDF from the print window), with nothing else on the page
export function printAnswer(el) {
  el.classList.add('ask-printing'); document.body.classList.add('ask-print');
  const done = () => { el.classList.remove('ask-printing'); document.body.classList.remove('ask-print'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  window.print();
  setTimeout(done, 1000);
}

export const ASK_CSS = `
.ask{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:28px;margin-top:16px;align-items:start}
@media (max-width:900px){.ask{grid-template-columns:1fr}.ask-side{order:2}}
.ask-main{display:flex;flex-direction:column}
.ask-main.has{min-height:calc(100vh - 260px)}
.ask-thread{display:flex;flex-direction:column;gap:14px;flex:1}
.ask-empty{padding:28px 0 8px}
.ask-empty h3{font-size:18px;font-weight:650;margin:0 0 4px}
.ask-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.ask-chip{font:inherit;font-size:13px;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:99px;padding:7px 13px;cursor:pointer;text-align:left}
.ask-chip:hover{border-color:var(--accent);color:var(--accent)}
.ask-card{border:1px solid var(--line);border-radius:12px;padding:16px 20px;background:var(--bg)}
.ask-q{display:flex;gap:10px;align-items:baseline;margin:0 0 12px;padding-bottom:12px;border-bottom:1px solid var(--line)}
.ask-q b{font-weight:650;font-size:15px}
.ask-ans{line-height:1.6;font-size:14.5px}
.ask-ans p{margin:0 0 10px} .ask-ans ul,.ask-ans ol{margin:0 0 10px;padding-left:20px} .ask-ans li{margin:3px 0}
.ask-ans h3{font-size:15.5px;font-weight:650;margin:18px 0 8px;padding-top:12px;border-top:1px solid var(--line)} .ask-ans h3:first-child{margin-top:0;padding-top:0;border-top:none}
.ask-tbl{margin:6px 0 12px} .ask-tbl tr.tot td{font-weight:650;border-top:2px solid var(--line)}
.ask-foot{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px;margin-top:6px;font-size:12.5px}
.ask-foot .grow{flex:1}
.ask-act{font:inherit;font-size:12.5px;background:none;border:1px solid var(--line);border-radius:7px;padding:4px 10px;color:var(--ink);cursor:pointer}
.ask-act:hover{border-color:var(--accent);color:var(--accent)}
.ask-dots{display:inline-flex;gap:4px;margin-right:6px} .ask-dots i{width:6px;height:6px;border-radius:50%;background:var(--accent);animation:askb 1s infinite alternate}
.ask-dots i:nth-child(2){animation-delay:.2s} .ask-dots i:nth-child(3){animation-delay:.4s}
@keyframes askb{from{opacity:.25}to{opacity:1}}
.ask-input{position:sticky;bottom:0;padding:14px 0 16px;background:linear-gradient(to bottom,transparent,var(--bg) 14px);margin-top:14px}
.ask-bar{display:flex;align-items:flex-end;gap:8px;border:1px solid var(--line);border-radius:12px;padding:6px 6px 6px 14px;background:var(--bg);box-shadow:0 2px 10px rgba(0,0,0,.05)}
.ask-bar:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 12%,transparent)}
.ask-bar textarea{flex:1;font:inherit;font-size:14.5px;line-height:1.5;color:var(--ink);background:none;border:none;outline:none;resize:none;padding:6px 0;max-height:120px}
.ask-bar .ops-btn{flex:none}
.ask-left{font-size:12px;margin:6px 2px 0}
.ask-rep{border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-top:18px}
.ask-rep p{margin:4px 0 10px;font-size:12.5px} .ask-rep .ops-btn{width:100%;margin-top:6px}
.ask-brand{display:none}
@media print{body.ask-print .ask-printing .ask-brand{display:flex!important;justify-content:space-between;font-size:12px;border-bottom:2px solid #1f5d4f;padding-bottom:8px;margin-bottom:14px}}
.ask-side{position:sticky;top:16px}
.ask-side h2{margin-bottom:8px}
.ask-hist{display:flex;flex-direction:column;max-height:calc(100vh - 200px);overflow:auto}
.ask-hist button{font:inherit;font-size:13px;background:none;border:none;border-bottom:1px solid var(--line);padding:9px 2px;text-align:left;cursor:pointer;color:var(--ink);display:flex;flex-direction:column;gap:2px}
.ask-hist button:hover{color:var(--accent)}
.ask-hist small{font-size:11.5px}
@media print{body.ask-print *{visibility:hidden!important}
  body.ask-print .ask-printing,body.ask-print .ask-printing *{visibility:visible!important}
  body.ask-print .ask-printing{position:absolute;left:0;top:0;width:100%;border:none;padding:0}
  body.ask-print .ask-printing .ask-actions{display:none}}
`;

export default function Ask({ api, team, initial, onInitialUsed }) {
  const [page, setPage] = useState(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [thread, setThread] = useState([]);   // this visit: [{ key, question, answer, used, at }]
  const box = useRef(null); const end = useRef(null); const cards = useRef({});
  const load = () => api('/api/ops?action=ask' + (team ? '&team=' + encodeURIComponent(team) : '')).then(setPage).catch((e) => setErr(e.message));
  useEffect(() => { load(); setThread([]); }, [team]);
  // A question typed in the bar at the top of Management: asked as soon as the page is ready
  useEffect(() => { if (initial && page?.on) { send(initial); onInitialUsed?.(); } }, [initial, page?.on]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [thread.length]);
  useEffect(() => {   // the box grows with the question, up to a few lines
    const t = box.current; if (!t) return;
    t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 120) + 'px';
  }, [q]);

  const send = async (text, week) => {
    const question = week ? (week === 'this' ? 'Weekly report: this week so far' : 'Weekly report: last week') : (text ?? q).trim();
    if (!question || busy) return;
    const key = Date.now();
    setBusy(true); setErr(''); if (!week) setQ('');
    setThread((t) => [...t, { key, question, answer: null, report: !!week }]);
    try {
      const body = week ? { action: 'report', week } : { action: 'ask', question };
      const j = await api('/api/ops' + (team ? '?team=' + encodeURIComponent(team) : ''), { method: 'POST', body });
      setThread((t) => t.map((x) => (x.key === key ? { ...x, answer: j.answer, used: j.used, at: new Date().toISOString() } : x)));
      load();
    } catch (e) {
      setErr(e.message); if (!week) setQ(question);
      setThread((t) => t.filter((x) => x.key !== key));
    }
    setBusy(false);
    box.current?.focus();
  };
  const reopen = (h) => {
    if (thread.some((x) => x.key === 'h' + h.id)) return cards.current['h' + h.id]?.scrollIntoView({ behavior: 'smooth' });
    setThread((t) => [...t, { key: 'h' + h.id, question: h.question, answer: h.status === 'ok' ? h.answer : 'That question didn\'t get an answer.', used: h.used, at: h.at }]);
  };

  if (!page) return <Wait err={err} />;
  const examples = page.all && !team ? EXAMPLES_ALL : EXAMPLES_TEAM;
  return (
    <>
      <style>{ASK_CSS}</style>
      <Bar note={`Ask about calls, listings, leads, people and billing${page.all ? ', and every deal' : ''}. Answers come only from the Desk's own figures${page.team ? ` for ${page.team}` : ''}.`}>
        {page.usage && <span className="muted">Today {page.usage.today} of {page.usage.companyDay} questions · this month ${page.usage.monthUsd.toFixed(2)} of ${page.usage.monthlyUsd}</span>}
      </Bar>
      {!page.on ? <p className="ops-msg warn" style={{ marginTop: 14 }}>Ask isn't switched on yet.</p> : (
        <div className="ask">
          <div className={'ask-main' + (thread.length ? ' has' : '')}>
            <div className="ask-thread">
              {thread.length === 0 && (
                <div className="ask-empty">
                  <h3>What do you want to know?</h3>
                  <span className="muted">Ask in plain words. Try one of these:</span>
                  <div className="ask-chips">{examples.map((x) => <button key={x} type="button" className="ask-chip" disabled={busy} onClick={() => send(x)}>{x}</button>)}</div>
                </div>
              )}
              {thread.map((x) => (
                <div className="ask-card" key={x.key} ref={(el) => { cards.current[x.key] = el; }}>
                  <div className="ask-brand"><b>Apex Homes DXB</b><span>Management report</span></div>
                  <div className="ask-q"><b>{x.question}</b></div>
                  {x.answer == null ? <span className="muted"><span className="ask-dots"><i /><i /><i /></span>{x.report ? 'Putting the report together. This takes a minute or two…' : 'Looking through the figures…'}</span> : <>
                    <Answer text={x.answer} />
                    <div className="ask-foot muted">
                      {x.used?.length ? <span>Based on: {x.used.join(', ')}</span> : null}{x.at && <span>{clock(x.at)}</span>}
                      <span className="grow" />
                      <span className="ask-actions" style={{ display: 'flex', gap: 6 }}>
                        {tablesIn(x.answer).length > 0 && <button type="button" className="ask-act" onClick={() => downloadTables(x)}>Download table</button>}
                        <button type="button" className="ask-act" onClick={() => printAnswer(cards.current[x.key])}>Print or save PDF</button>
                      </span>
                    </div>
                  </>}
                </div>
              ))}
              <div ref={end} />
            </div>
            <div className="ask-input">
              {err && <p className="ops-msg err" style={{ margin: '0 0 8px' }}>{err}</p>}
              <div className="ask-bar" onClick={() => box.current?.focus()}>
                <textarea ref={box} value={q} maxLength={600} rows={1} placeholder={thread.length ? 'Ask another question…' : 'Ask a question about the figures…'}
                  onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} disabled={busy} />
                <Btn primary disabled={busy || !q.trim() || page.left <= 0} onClick={() => send()}>{busy ? 'Working…' : 'Ask'}</Btn>
              </div>
              <p className="ask-left muted">{page.left} question{page.left === 1 ? '' : 's'} left today · Enter to ask, Shift+Enter for a new line</p>
            </div>
          </div>
          <aside className="ask-side">
            <h2>Recent questions</h2>
            {page.history.length === 0 ? <span className="muted">Your questions will show here.</span> : (
              <div className="ask-hist">{page.history.map((h) => (
                <button key={h.id} type="button" onClick={() => reopen(h)}><span>{h.question}</span><small className="muted">{clock(h.at)}</small></button>))}
              </div>
            )}
          </aside>
        </div>
      )}
      {!page.on && err && <p className="ops-msg err" style={{ marginTop: 14 }}>{err}</p>}
    </>
  );
}
