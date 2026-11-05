// ─────────────────────────────────────────────────────────────────────────────
// Apex Owner Desk: the whole screen lives in this one file.
// Change the look or layout here. The secure server code is in the /api folder
// and doesn't need touching for UI changes.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

// ── Settings you might want to change ───────────────────────────────────────
const OUTCOMES = ['No answer', 'Not interested', 'Call back', 'Wants valuation', 'Listing opportunity', 'Wants to sell', 'Wrong number', 'Do not call'];
// One-tap notes offered after a call and in the unit's Notes box. Brokers can still type their own.
// Each one also picks the WhatsApp follow-up message (see WHATSAPP_BY_NOTE). 'kendal' ticks "Send to Kendal".
// ── Call results ──
// One list drives the call outcome panel, the unit notes, hot/cold colouring, the WhatsApp message and the Hot & cold
// report. k = what's saved at the start of the note (never change an existing k, old notes and reports match on it),
// label = what the broker sees, o = the outcome saved with it, kendal = ticks "Send to Kendal", report = ticks the
// monthly report, wa: false = no WhatsApp afterwards.
const RESULTS = {
  owner: [
    { tone: 'cold', title: "Didn't get through", items: [
      { k: 'Called, no reply', label: 'No reply', o: 'No answer' },
      { k: 'Called, line busy, call again later', label: 'Line busy', o: 'No answer' },
      { k: 'Called, unreachable', label: 'Unreachable', o: 'No answer' },
      { k: 'Phone off', o: 'No answer' },
      { k: 'Wrong number', o: 'Wrong number', wa: false }] },
    { tone: 'cold', title: 'Spoke, not interested', items: [
      { k: 'Not interested', o: 'Not interested' },
      { k: 'Not selling yet', o: 'Not interested' },
      { k: 'Price too high', label: 'Price expectations too high', o: 'Not interested' },
      { k: 'End user', label: 'Lives in it', o: 'Not interested' },
      { k: 'Rented', label: 'Already rented', o: 'Not interested' },
      { k: 'Sold', label: 'Already sold', o: 'Not interested' },
      { k: 'Agent', label: 'Has an agent', o: 'Not interested' },
      { k: 'Other', label: 'Other (say why)', o: 'Not interested' },
      { k: 'Do not call', o: 'Do not call', wa: false }] },
    { tone: 'hot', title: 'Ready now', items: [
      { k: 'Wants to sell', o: 'Wants to sell', kendal: true },
      { k: 'Wants to rent', label: 'Wants to rent it out', o: 'Listing opportunity', kendal: true },
      { k: 'Wants valuation', label: 'Wants a valuation', o: 'Wants valuation', kendal: true },
      { k: 'Unit available, send WhatsApp', label: 'Unit available, send details', o: 'Listing opportunity', kendal: true },
      { k: 'Wants to buy', o: 'Call back', kendal: true }] },
    { tone: 'hot', title: 'Keep warm', items: [
      { k: 'Follow up', label: 'Call back', o: 'Call back' },
      { k: 'In discussion', o: 'Call back' },
      { k: 'Send report', label: 'Send a market report', o: 'Call back', report: true },
      { k: 'Replied', o: 'Call back' }] },
  ],
  lead: [
    { tone: 'cold', title: "Didn't get through", items: [
      { k: 'Called, no reply', label: 'No reply', o: 'No answer' },
      { k: 'Called, line busy, call again later', label: 'Line busy', o: 'No answer' },
      { k: 'Called, unreachable', label: 'Unreachable', o: 'No answer' },
      { k: 'Phone off', o: 'No answer' },
      { k: 'Wrong number', o: 'Wrong number', wa: false }] },
    { tone: 'cold', title: 'Spoke, not interested', items: [
      { k: 'Already found', o: 'Not interested' },
      { k: 'Not looking anymore', o: 'Not interested' },
      { k: 'Agent', label: 'Using another agent', o: 'Not interested' },
      { k: 'Not interested', o: 'Not interested' },
      { k: 'Other', label: 'Other (say why)', o: 'Not interested' },
      { k: 'Do not call', o: 'Do not call', wa: false }] },
    { tone: 'hot', title: 'Ready now', items: [
      { k: 'Viewing booked', o: 'Call back' },
      { k: 'Send options', o: 'Call back' },
      { k: 'Still looking', o: 'Call back' }] },
    { tone: 'hot', title: 'Keep warm', items: [
      { k: 'Follow up', label: 'Call back', o: 'Call back' },
      { k: 'Replied', o: 'Call back' }] },
  ],
};
const resultsFor = (lead) => RESULTS[lead ? 'lead' : 'owner'];
const findResult = (k, lead) => resultsFor(lead).flatMap((g) => g.items.map((x) => ({ ...x, tone: g.tone }))).find((x) => x.k === k);
const resultLabel = (k) => findResult(k)?.label || findResult(k, true)?.label || k;
// The unit notes use the same notes, just as Cold and Hot
const notesOf = (lead, tone) => [...new Set(resultsFor(lead).filter((g) => g.tone === tone).flatMap((g) => g.items.map((x) => x.k)).filter((k) => k !== 'Do not call' && k !== 'Wrong number'))];
const QUICK_NOTES = { Cold: notesOf(false, 'cold'), Hot: notesOf(false, 'hot') };
const LEAD_NOTES = { Cold: notesOf(true, 'cold'), Hot: notesOf(true, 'hot') };
// Hot or cold, from how a note starts. Shown as green (hot) or red (cold) wherever notes appear.
function noteTone(text) {
  const t = String(text || '').toLowerCase();
  const hit = (list) => list.some((q) => t.startsWith(q.toLowerCase()));
  if (hit(QUICK_NOTES.Hot) || hit(LEAD_NOTES.Hot) || hit(HOT_OUTCOMES) || t.startsWith('call back')) return 'hot';
  if (hit(QUICK_NOTES.Cold) || hit(LEAD_NOTES.Cold) || t.startsWith('cold') || hit(['No answer', 'Not interested', 'Wrong number', 'Do not call', 'Not selling', 'Price too high'])) return 'cold';
  return '';
}
function NoteTag({ text, clip, wrap }) {
  const tone = noteTone(text);
  return <span className={'notetag ' + tone + (clip ? ' clip' : '') + (wrap ? ' wrap' : '')} title={text}>{tone && <i className="nd" />}<span className="nt">{text}</span></span>;
}
// A quick note plus the broker's own words: "Wants to sell. Asking 2.1m, vacant in March".
// "Other" is a cold note in their own words: "Other: lives abroad, call in December".
function composeNote(chip, extra) {
  const e = String(extra || '').trim();
  if (!chip) return e;
  if (chip === 'Other') return e ? `Other: ${e}` : '';
  return e ? `${chip}. ${e}` : chip;
}
const notePlaceholder = (chip, fallback) => (chip === 'Other' ? 'Write the note' : chip ? 'Add your own words (optional)' : fallback);
// Each person can drag the quick notes into their own order (saved to their account, so laptop and phone match)
let quickOrderP = null;
const loadQuickOrder = () => (quickOrderP ??= api('/api/desk?action=quickOrder').then((j) => j.order || {}).catch(() => { quickOrderP = null; return {}; }));
const orderedNotes = (group, order, lead) => {
  const list = (lead ? LEAD_NOTES : QUICK_NOTES)[group];
  const mine = (order?.[(lead ? 'Lead ' : '') + group] || []).filter((q) => list.includes(q));
  return [...mine, ...list.filter((q) => !mine.includes(q))];   // new notes we add later go at the end
};
function QuickNotes({ value, onPick, lead }) {
  const NOTES = lead ? LEAD_NOTES : QUICK_NOTES;
  const keyOf = (group) => (lead ? 'Lead ' : '') + group;
  const [order, setOrder] = useState(null);
  const [drag, setDrag] = useState(null);   // { group, q }
  const [over, setOver] = useState(null);
  useEffect(() => { let on = true; loadQuickOrder().then((o) => on && setOrder(o)); return () => { on = false; }; }, []);
  const move = (group, from, to) => {
    if (from === to) return;
    const list = orderedNotes(group, order, lead);
    const ti = list.indexOf(to);
    list.splice(list.indexOf(from), 1);
    list.splice(ti, 0, from);   // dragging down lands after the note you drop on, dragging up lands before it
    const next = { ...(order || {}), [keyOf(group)]: list };
    setOrder(next);
    quickOrderP = Promise.resolve(next);
    api('/api/desk?action=quickOrder', { method: 'POST', body: { order: next } }).catch(() => {});
  };
  const reset = () => {
    const next = Object.fromEntries(Object.entries(order || {}).filter(([g]) => g.startsWith('Lead ') !== !!lead));
    setOrder(next); quickOrderP = Promise.resolve(next); api('/api/desk?action=quickOrder', { method: 'POST', body: { order: next } }).catch(() => {});
  };
  const custom = order && Object.keys(NOTES).some((g) => (order[keyOf(g)] || []).length);
  return (
    <div className="qnotes">
      {Object.keys(NOTES).map((group) => (
        <div key={group} className={'qcol ' + group.toLowerCase()} onDragOver={(e) => { if (drag?.group === group) e.preventDefault(); }}>
          <span className="qh" title="Drag the notes to put them in your own order">{group}</span>
          {orderedNotes(group, order, lead).map((q) => (
            <button type="button" key={q} draggable
              className={'chip' + (value === q ? ' on' : '') + (drag?.q === q ? ' dragging' : '') + (over === q && drag && drag.q !== q ? ' over' : '')}
              onDragStart={(e) => { setDrag({ group, q }); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', q); }}
              onDragEnter={() => drag?.group === group && setOver(q)}
              onDragOver={(e) => { if (drag?.group === group) e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); if (drag?.group === group) move(group, drag.q, q); setDrag(null); setOver(null); }}
              onDragEnd={() => { setDrag(null); setOver(null); }}
              onClick={() => onPick(value === q ? '' : q)}>{resultLabel(q)}</button>))}
        </div>
      ))}
      {custom && <button type="button" className="link qreset" onClick={reset}>Reset note order</button>}
    </div>
  );
}
const HOT_OUTCOMES = ['Wants valuation', 'Listing opportunity', 'Wants to sell']; // these tick "Send to Kendal" automatically
const TABS = [
  ['all', 'All units'], ['exp90', 'Ending in 90 days'], ['reports', 'Reports today'], ['monthly', 'Monthly reports'],
  ['port', 'Portfolio owners'], ['mort', 'Mortgaged'], ['never', 'Never called'], ['callbacks', 'Callbacks this week'],
];
// First week of the month (Dubai): the Monthly reports tab is highlighted as due
const monthStart = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', day: 'numeric' }).format(new Date())) <= 7;
const BEDS = ['Studio', '1', '2', '3', '4', '5', '6', '7'];
const EXPIRY = [['30', 'Within 30 days'], ['90', 'Within 90 days'], ['180', 'Within 6 months'], ['365', 'Within a year'], ['', 'Any time']];
// WhatsApp follow-up after a call. {first} = owner's first name, {me} = broker's first name,
// {property} = e.g. "villa 12 in Maple 1" or "apartment 504 in Acacia A", {area} = e.g. "Dubai Hills Estate".
// The broker can edit the message before it opens in WhatsApp. No message is offered for Wrong number or Do not call.
// Message for each quick note. Used first when the note starts with one of these; otherwise the outcome decides.
const WHATSAPP_BY_NOTE = {
  'Called, no reply': 'Hi {first}, this is {me} from Apex Homes. I just tried giving you a call regarding your {property}, {area}. When would be a good time to talk?',
  'Called, unreachable': 'Hi {first}, this is {me} from Apex Homes. I just tried giving you a call regarding your {property}, {area}. When would be a good time to talk?',
  'Called, line busy, call again later': 'Hi {first}, this is {me} from Apex Homes. I just tried giving you a call regarding your {property}, {area} but the line was busy. When would be a good time to talk?',
  'Phone off': 'Hi {first}, this is {me} from Apex Homes. I just tried giving you a call regarding your {property}, {area}. When would be a good time to talk?',
  'Rented': 'Hi {first}, this is {me} from Apex Homes. Thanks for your time just now regarding your {property}, {area}. Good to hear it\'s rented. When the lease comes up for renewal, or if you ever think about selling, I can send you an up-to-date valuation and what similar units are renting for. Save my number and message me here any time.',
  'Sold': 'Hi {first}, this is {me} from Apex Homes. Thanks for your time just now, and congratulations on selling your {property}, {area}. If you\'re ever thinking about reinvesting or looking for your next property, I\'d be happy to help. Save my number and message me here any time.',
  'End user': 'Hi {first}, this is {me} from Apex Homes. Thanks for your time just now regarding your {property}, {area}. Glad to hear you\'re enjoying living there. If you ever want an up-to-date valuation or have questions about the market, save my number and message me here any time.',
  'Send report': 'Hi {first}, this is {me} from Apex Homes. Great speaking with you just now. As promised, I\'ll send over a market report for your {property}, {area} today.',
  'Unit available, send WhatsApp': 'Hi {first}, this is {me} from Apex Homes. Great speaking with you just now. As discussed, could you send me a few details on your {property}, {area}: photos, when it\'s available and the price you have in mind? I\'ll take it from there.',
  'In discussion': 'Hi {first}, this is {me} from Apex Homes. Thanks for your time just now regarding your {property}, {area}. Saving my number here so we can keep the conversation going.',
  'Replied': 'Hi {first}, this is {me} from Apex Homes. Thanks for getting back to me about your {property}, {area}. When is a good time for a quick call?',
  'Follow up': 'Hi {first}, this is {me} from Apex Homes, following up on our conversation about your {property}, {area}. Let me know a good time to catch up.',
  'Wants to sell': 'Hi {first}, this is {me} from Apex Homes. Thanks for your time just now. As discussed, I\'ll put together a valuation and recent sales for your {property}, {area} and send it over shortly.',
  'Wants to rent': 'Hi {first}, this is {me} from Apex Homes. Thanks for your time just now. As discussed, I\'ll pull together current rents for your {property}, {area} and come back to you with a plan to get it rented.',
  'Wants to buy': 'Hi {first}, this is {me} from Apex Homes. Great speaking with you just now. Send me your budget and what you\'re looking for, and I\'ll share the best options available.',
  'Wants valuation': 'Hi {first}, this is {me} from Apex Homes. Thanks for your time just now. As promised, I\'ll put together an up-to-date valuation for your {property}, {area}, with recent sales nearby, and send it over shortly.',
  'Not interested': 'Hi {first}, this is {me} from Apex Homes. Thanks for your time just now regarding your {property}, {area}. No problem at all. If anything changes, or you\'d like to know what it\'s worth, save my number and message me here any time.',
  'Not selling yet': 'Hi {first}, this is {me} from Apex Homes. Thanks for your time just now regarding your {property}, {area}. Understood, not just yet. I\'ll keep you updated on what similar units are selling for, so you have the numbers when the time is right. Save my number and message me here any time.',
  'Price too high': 'Hi {first}, this is {me} from Apex Homes. Thanks for your time just now regarding your {property}, {area}. I\'ll send you the most recent sales nearby so you can see where the market is today. If the numbers move your way, I\'ll let you know straight away.',
  'Agent': 'Hi {first}, this is {me} from Apex Homes. Thanks for your time just now regarding your {property}, {area}. Glad it\'s in good hands. If things don\'t work out, or you\'d like a second opinion on price, save my number and message me here any time.',
  'Other': 'Hi {first}, this is {me} from Apex Homes. Thanks for your time on the phone just now regarding your {property}, {area}. Save my number and message me here any time.',
};
const WHATSAPP = {
  'No answer': 'Hi {first}, this is {me} from Apex Homes. I just tried giving you a call regarding your {property}, {area}. When would be a good time to talk?',
  'Call back': 'Hi {first}, this is {me} from Apex Homes. Thanks for picking up just now. As discussed, I\'ll call you back regarding your {property}, {area}. Save my number and message me here any time.',
  default: 'Hi {first}, this is {me} from Apex Homes. Thanks for your time on the phone just now regarding your {property}, {area}. Save my number and feel free to message me here any time.',
};
const DATA_NOTE = 'Tenancies are registered Ejari contracts loaded to the end of September 2026';

// ── Styles ──────────────────────────────────────────────────────────────────
const CSS = `
:root{--bg:#ffffff;--ink:#1c2120;--muted:#6b7472;--faint:#9aa29f;--line:#e7e9e8;--hover:#f4f6f5;
  --accent:#0f5c56;--accent-ink:#ffffff;--blue:#1a6fe0;--warn:#a15c00;--bad:#b3261e;--hot:#1e8a4c;--cold:#c62f26;
  --f:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#141817;--ink:#e4e8e6;--muted:#9aa4a1;--faint:#6e7875;
  --line:#262d2b;--hover:#1b2120;--accent:#6cc3b8;--accent-ink:#0b1f1c;--blue:#4c95f5;--warn:#e9b25a;--bad:#ff8f86;--hot:#4fd18b;--cold:#ff7a70;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#141817;--ink:#e4e8e6;--muted:#9aa4a1;--faint:#6e7875;--line:#262d2b;--hover:#1b2120;
  --accent:#6cc3b8;--accent-ink:#0b1f1c;--blue:#4c95f5;--warn:#e9b25a;--bad:#ff8f86;--hot:#4fd18b;--cold:#ff7a70;color-scheme:dark}
*{box-sizing:border-box} html,body{margin:0}
body{background:var(--bg);color:var(--ink);font-family:var(--f);font-size:13px;line-height:1.45}
button,input,select,textarea{font:inherit;color:inherit} button{cursor:pointer}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.n{font-variant-numeric:tabular-nums} .muted{color:var(--muted)} .faint{color:var(--faint)}
.gut{padding-left:max(20px,env(safe-area-inset-left,0px));padding-right:max(20px,env(safe-area-inset-right,0px))}
.link{background:none;border:none;padding:0;color:var(--accent);text-decoration:none;cursor:pointer} .link:hover{text-decoration:underline}
.sub{display:block;color:var(--muted);font-size:12px} .soon{color:var(--warn)} .gone{color:var(--bad)} .err{color:var(--bad)}
header.top{position:sticky;top:0;z-index:20;background:var(--bg);border-bottom:1px solid var(--line)}
.bar{display:flex;align-items:center;gap:8px 22px;flex-wrap:wrap;padding-block:11px}
.brand{font-weight:600;font-size:14px}
.nav{display:flex;gap:16px} .nav button{background:none;border:none;padding:0;color:var(--muted)} .nav button.on,.nav button:hover{color:var(--ink)}
.right{margin-left:auto;display:flex;gap:18px;color:var(--muted);flex-wrap:wrap;align-items:center}
.theme{display:inline-flex;border:1px solid var(--line);border-radius:6px;overflow:hidden}
.theme button{background:none;border:none;padding:3px 8px;color:var(--muted);font-size:12px}
.theme button[aria-pressed="true"]{background:var(--hover);color:var(--ink)}
.head{padding-block:22px 6px} .head h1{font-size:20px;font-weight:600;margin:0} .head p{margin:3px 0 0;color:var(--muted)}
.layout{display:grid;grid-template-columns:210px minmax(0,1fr);gap:36px;padding-block:18px 40px;align-items:start}
.layout.noside{grid-template-columns:minmax(0,1fr)}
.hide-side{align-self:flex-start;background:none;border:1px solid var(--line);border-radius:6px;padding:4px 10px;font-size:12px;color:var(--muted)}
.hide-side:hover{color:var(--ink);background:var(--hover)}
.show-side{border-color:color-mix(in srgb,var(--accent) 50%,var(--line));color:var(--accent);font-weight:500}
.meta-l,.meta-r{display:inline-flex;align-items:center;gap:12px;flex-wrap:wrap}
.btn.saved{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 40%,var(--line));opacity:1}
.more{padding:14px;text-align:center;color:var(--faint);font-size:12px;min-height:44px}
.owners-page{display:block}
.owners-page>.layout{align-items:start;padding-block:14px 24px}
.listcol{min-width:0}
/* The page scrolls normally. Once the call bar has scrolled away, the filters and the table each fill the screen. */
.listcol>.tw{max-height:calc(100vh - var(--toph, 49px) - 24px)}
.owners-page .head{padding-block:14px 0}
.filters{display:flex;flex-direction:column;gap:14px;position:sticky;top:calc(var(--toph, 49px) + 12px);max-height:calc(100vh - var(--toph, 49px) - 24px);overflow-y:auto;
  scroll-behavior:smooth;scrollbar-width:thin;padding:2px 6px 24px 2px}
.filters::-webkit-scrollbar{width:6px} .filters::-webkit-scrollbar-thumb{background:var(--line);border-radius:6px}
.ms-btn{width:100%;display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 9px;border:1px solid var(--line);border-radius:6px;background:var(--bg);font-size:12.5px;text-align:left}
.ms-btn:hover{border-color:color-mix(in srgb,var(--accent) 40%,var(--line))}
.ms-btn.on{border-color:color-mix(in srgb,var(--accent) 55%,var(--line));color:var(--accent);font-weight:500}
.ms-sum{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chev{color:var(--faint);font-size:10px;transition:transform .15s} .open>button .chev{transform:rotate(180deg)}
.checklist{margin-top:6px;border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--bg)}
.cl-search{width:100%;padding:5px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);font-size:12.5px;margin-bottom:6px}
.cl-acts{display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px}
.cl-list{max-height:220px;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:1px;scrollbar-width:thin}
.sec{border-top:1px solid var(--line);padding-top:10px}
.sec-h{width:100%;display:flex;justify-content:space-between;align-items:center;background:none;border:none;padding:0;font-size:12px;font-weight:600;color:var(--ink)}
.sec-h:hover{color:var(--accent)}
.sec-b{padding-top:8px}
.sec-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--accent);margin-left:6px;vertical-align:middle}
.filters h3{font-size:12px;font-weight:600;margin:0 0 6px}
.filters input[type=search],.filters input[type=number],.filters input[type=date],.filters select{width:100%;padding:5px 7px;border:1px solid var(--line);border-radius:4px;background:var(--bg);font-size:12.5px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.cb{display:flex;gap:7px;align-items:center;padding:2px 0;cursor:pointer} .cb input{margin:0;accent-color:var(--accent)}
.tabs{display:flex;gap:20px;border-bottom:1px solid var(--line);margin-bottom:4px;overflow-x:auto}
.tab{background:none;border:none;padding:8px 0 9px;color:var(--muted);border-bottom:2px solid transparent;margin-bottom:-1px;white-space:nowrap}
.tab:hover{color:var(--ink)} .tab.on{color:var(--ink);border-bottom-color:var(--ink);font-weight:500} .tab .c{color:var(--faint);margin-left:5px}
.meta{display:flex;justify-content:space-between;align-items:center;gap:10px;padding-block:10px;color:var(--muted);flex-wrap:wrap}
.tw{overflow:auto;max-height:calc(100vh - 130px);transition:opacity .15s;border:1px solid var(--line);border-radius:8px} .tw.busy{opacity:.55}
table.grid{min-width:0;width:100%}
table.grid.fixed{table-layout:fixed;min-width:100%}
.grid.fixed td{overflow:hidden;text-overflow:ellipsis}
.grid.fixed .clip{max-width:100%}
.grid th{position:sticky}
.rz{position:absolute;top:0;right:-4px;width:9px;height:100%;cursor:col-resize;z-index:2}
.rz::after{content:'';position:absolute;top:25%;bottom:25%;left:4px;width:2px;border-radius:2px;background:transparent}
th:hover .rz::after,.col-resizing .rz::after{background:var(--line)} .rz:hover::after{background:var(--accent)!important}
body.col-resizing{cursor:col-resize;user-select:none}
.qnotes{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px}
.result{display:flex;flex-direction:column;gap:10px;margin-top:6px}
.res-cols{display:grid;grid-template-columns:1fr 1fr;gap:10px} @media (max-width:640px){.res-cols{grid-template-columns:1fr}}
.res-col{border:1px solid var(--line);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:10px}
.res-col.cold{border-color:color-mix(in srgb,var(--cold) 35%,var(--line))} .res-col.hot{border-color:color-mix(in srgb,var(--hot) 35%,var(--line))}
.res-h{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em} .res-col.cold .res-h{color:var(--cold)} .res-col.hot .res-h{color:var(--hot)}
.res-g{display:flex;flex-direction:column;gap:5px} .res-gt{font-size:11.5px;color:var(--muted)}
.res-chips{display:flex;flex-wrap:wrap;gap:5px} .res-chips .chip{font-size:12.5px}
.res-col.cold .chip.on{border-color:var(--cold);color:var(--cold);background:color-mix(in srgb,var(--cold) 10%,var(--bg));font-weight:600}
.res-col.hot .chip.on{border-color:var(--hot);color:var(--hot);background:color-mix(in srgb,var(--hot) 10%,var(--bg));font-weight:600}
.result textarea{min-height:56px}
.res-opts{display:flex;gap:6px 18px;flex-wrap:wrap} .res-opts .cb{margin:0}
.res-warn{margin:0;padding:8px 10px;border-radius:8px;font-size:13px;color:var(--cold);background:color-mix(in srgb,var(--cold) 9%,var(--bg))}
.res-hint{margin:0;font-size:12px}
.result.big .res-chips .chip{font-size:14px;padding:9px 13px} .result.big .res-gt{font-size:12.5px}
.qcol{display:flex;flex-direction:column;align-items:flex-start;gap:5px;border:1px solid var(--line);border-radius:10px;padding:8px 10px}
.qcol .chip[draggable]{cursor:grab} .qcol .chip.dragging{opacity:.4} .qcol .chip.over{box-shadow:0 -2px 0 0 var(--accent)}
.qreset{grid-column:1/-1;justify-self:end;font-size:12px}
.qcol .qh{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em}
.qcol.cold{border-color:color-mix(in srgb,var(--cold) 35%,var(--line))} .qcol.hot{border-color:color-mix(in srgb,var(--hot) 35%,var(--line))}
.qcol.cold .qh{color:var(--cold)} .qcol.hot .qh{color:var(--hot)}
.qcol.cold .chip.on{border-color:var(--cold);color:var(--cold);background:color-mix(in srgb,var(--cold) 10%,var(--bg))}
.qcol.hot .chip.on{border-color:var(--hot);color:var(--hot);background:color-mix(in srgb,var(--hot) 10%,var(--bg))}
.stack{display:flex;flex-direction:column;gap:2px;padding:6px 0} .stack>div{min-height:30px;display:flex;align-items:center;min-width:0}
.grid td.callcol .stack{align-items:flex-end}
.nstack{display:flex;flex-direction:column;gap:4px;padding:6px 0;min-width:0;width:100%}
/* Time on the left at a fixed width, the note takes the rest; each note is at most 3 lines (full text on hover) */
.nitem{display:flex;flex-wrap:wrap;column-gap:8px;row-gap:2px;align-items:flex-start;min-width:0}
.nmore{font-size:11px;color:var(--accent);padding-left:2px}
.nitem>.nmeta{flex:none}
.nitem>.notetag.wrap{flex:1 1 130px;min-width:0}
.nmeta{font-size:11px;color:var(--faint);white-space:nowrap;padding-top:3px}
.grid td:has(.nstack){white-space:normal}
.notetag.wrap{display:block;min-width:0;max-width:100%;white-space:normal;overflow-wrap:anywhere;line-height:1.35;
  overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;line-clamp:3}
.notetag.wrap.hot,.notetag.wrap.cold{border-radius:10px;padding:2px 9px}
.notetag.wrap .nd{display:inline-block;vertical-align:middle;margin:-2px 6px 0 0}
.notetag.wrap .nt{display:inline}
.tab.due .c{background:var(--cold);color:#fff;border-radius:999px;padding:0 7px;margin-left:6px}
.notetag{display:inline-flex;align-items:center;gap:6px;max-width:100%}
.notetag.hot,.notetag.cold{padding:2px 9px;border-radius:999px;font-size:12.5px;font-weight:500}
.notetag.hot{color:var(--hot);background:color-mix(in srgb,var(--hot) 12%,var(--bg))}
.notetag.cold{color:var(--cold);background:color-mix(in srgb,var(--cold) 10%,var(--bg))}
.tonepick{display:flex;flex-direction:column;gap:2px}.tonepick .nd{width:8px;height:8px;border-radius:50%;flex:none;display:inline-block;margin-right:2px}.tonepick .hot .nd{background:var(--hot)}.tonepick .cold .nd{background:var(--cold)}.tonepick .small{font-size:11.5px;margin-top:6px}
.notetag .nd{flex:none;width:7px;height:7px;border-radius:50%;background:currentColor}
.notetag.clip{overflow:hidden;white-space:nowrap} .notetag.clip .nt{overflow:hidden;text-overflow:ellipsis;min-width:0}
.wa-other{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
.qnotes .chip{font-size:12px;text-align:left}
@media (max-width:520px){.qnotes{grid-template-columns:1fr}}
.qnotes + textarea{margin-top:8px}
.kline{margin:4px 0 0;font-size:13px} .kline.sent{color:var(--hot)} .kline.existing{color:var(--muted)} .kline.error,.kline.off{color:var(--cold)} .kline.small{display:block;font-size:11.5px;margin-top:2px}
.box.rocket{width:min(560px,100%)} .rk-h{display:flex;justify-content:space-between;align-items:center} .rk-h h3{margin:0} .rk-h .x{border:none;background:none;font-size:22px;cursor:pointer;color:var(--muted)}
.rk-f{display:flex;flex-direction:column;gap:5px;margin-top:12px;font-size:12px;color:var(--muted)} .rk-f span{display:flex;align-items:center;gap:8px;color:var(--ink);font-size:13px}
.rk-f input{width:72px;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink)} .rk-f textarea{min-height:110px;font:inherit;font-size:13.5px;color:var(--ink);padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg)}
.rocket .cb{margin-top:10px} .rocket .small{font-size:12px;display:block;margin-top:4px} .rocket .acts{display:flex;gap:8px;justify-content:flex-end;align-items:center;margin-top:16px}
.rk-warn{padding:8px 10px;border-radius:8px;color:var(--cold);background:color-mix(in srgb,var(--cold) 10%,var(--bg));font-size:13px}
.rk-prog{height:8px;border-radius:999px;background:var(--hover);overflow:hidden;margin:12px 0 8px} .rk-prog div{height:100%;background:#1f9d55;transition:width .5s}
.rk-n{display:flex;gap:16px;font-size:13px;color:var(--muted)} .rk-n b{color:var(--ink);font-size:16px}
.rk-list{margin-top:12px;border-top:1px solid var(--line)} .rk-i{display:flex;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid var(--line);font-size:13px}
.rk-i.sent span:last-child{color:var(--hot)} .rk-i.failed span:last-child{color:var(--cold)} .rk-i span:last-child{color:var(--muted);white-space:nowrap}
.mrep{display:flex;flex-direction:column;gap:2px} .mrep .faint{font-size:12px;padding-left:22px}
.grid th{position:sticky;top:0;background:var(--bg);padding:9px 14px;border-bottom:1px solid var(--line);font-size:11.5px;letter-spacing:.02em}
.grid td{padding:0 14px;height:44px;vertical-align:middle;white-space:nowrap;border-bottom:1px solid var(--line)}
.grid tbody tr:last-child td{border-bottom:none}
.grid td+td,.grid th+th{border-left:1px solid var(--line)}
.grid .clip{display:inline-block;max-width:240px;overflow:hidden;text-overflow:ellipsis;vertical-align:middle}
.grid .strong{font-weight:500}
.grid .callcol{width:1%;text-align:right;border-left:none}
.grid .up{color:var(--accent)} .grid .down{color:var(--bad)}
.picker{position:relative}
.menu{position:absolute;right:0;top:calc(100% + 6px);z-index:30;max-height:calc(100vh - var(--toph, 49px) - 90px);overflow-y:auto;overscroll-behavior:contain;background:var(--bg);border:1px solid var(--line);border-radius:8px;padding:12px;width:320px;box-shadow:0 8px 24px rgba(0,0,0,.12)}
.sets{display:flex;flex-wrap:wrap;gap:6px;padding-bottom:10px;margin-bottom:8px;border-bottom:1px solid var(--line)}
.chip{border:1px solid var(--line);background:var(--bg);border-radius:999px;padding:3px 10px;font-size:12px}
.chip.on{border-color:var(--accent);color:var(--accent)}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:0 10px}
table{border-collapse:collapse;width:100%;min-width:980px}
th{text-align:left;font-weight:500;color:var(--muted);font-size:12px;padding:8px 10px 8px 0;border-bottom:1px solid var(--line);white-space:nowrap}
th button{background:none;border:none;padding:0;color:inherit} th button.on{color:var(--ink)}
.th{display:inline-flex;align-items:center;gap:6px} th.r .th{flex-direction:row-reverse}
.fbtn{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:4px;color:var(--faint)!important;opacity:.55}
th:hover .fbtn,.fbtn.open,.fbtn.on{opacity:1} .fbtn:hover,.fbtn.open{background:var(--hover);color:var(--ink)!important}
.fbtn.on{color:var(--accent)!important}
.hf{position:fixed;z-index:40;width:260px;background:var(--bg);border:1px solid var(--line);border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.14);font-size:13px;letter-spacing:0;font-weight:400;text-align:left}
.hf-h{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid var(--line)}
.unums{display:grid;gap:6px;margin-top:10px} .sect .unums,.section .unums{margin-top:0} .unums .lbl{font-size:12px;color:var(--muted);margin-top:2px} .unums input{width:100%;min-width:0} .unums .ulx label{display:grid;gap:4px;min-width:0}
.hf .pair{display:grid;grid-template-columns:1fr 1fr;gap:8px} .hf .pair input{width:100%;min-width:0}
.hf-b{padding:10px 12px;display:grid;gap:2px;max-height:340px;overflow:auto} .hf-b select,.hf-b input[type=search]{width:100%}
td{padding:10px 10px 10px 0;border-bottom:1px solid var(--line);vertical-align:top}
tbody tr{cursor:pointer} tbody tr:hover td{background:var(--hover)}
td.r,th.r{text-align:right} .unit{font-weight:600}
.ph{color:var(--muted);user-select:none;-webkit-user-select:none;white-space:nowrap}
.copyph{font:inherit;background:none;border:1px solid transparent;border-radius:6px;padding:2px 6px;margin:-3px -7px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.copyph svg{opacity:0;transition:opacity .15s} .copyph:hover{border-color:var(--line);background:var(--hover);color:var(--ink)} .copyph:hover svg{opacity:.7}
.copyph.ok{color:var(--hot)} .copyph.bad{color:var(--cold)} .same{font-size:12px}
.dot{display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:6px;vertical-align:1px;background:var(--faint)}
.dot.t{background:var(--accent)} .dot.v{background:var(--warn)}
.btn{border:1px solid var(--line);background:var(--bg);border-radius:4px;padding:4px 11px;color:var(--ink)}
.btn:hover{border-color:var(--accent);color:var(--accent)} .btn[disabled]{opacity:.4;cursor:not-allowed}
.btn.primary{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.empty{padding:40px 0;color:var(--muted)} .pager{display:flex;gap:16px;justify-content:center;padding:16px 0}
.loadbar{position:fixed;top:0;left:0;height:2px;width:100%;z-index:100;background:linear-gradient(90deg,transparent,var(--accent),transparent);
  background-size:50% 100%;background-repeat:no-repeat;animation:load .9s linear infinite}
@keyframes load{from{background-position:-50% 0}to{background-position:150% 0}}
.scrim{position:fixed;inset:0;background:rgba(0,0,0,.18);z-index:40}
.panel{position:fixed;top:0;right:0;bottom:0;width:min(500px,100%);background:var(--bg);z-index:41;border-left:1px solid var(--line);overflow:auto;
  padding:calc(20px + env(safe-area-inset-top,0px)) max(24px,env(safe-area-inset-right,0px)) calc(40px + env(safe-area-inset-bottom,0px)) 24px}
.panel-head{display:flex;justify-content:space-between;gap:12px;margin-bottom:18px} .panel-head h2{margin:0;font-size:18px;font-weight:600}
.x{background:none;border:none;font-size:20px;line-height:1;color:var(--muted);padding:0 2px}
.blk{border-top:1px solid var(--line);padding-block:14px} .blk h4{margin:0 0 10px;font-size:12px;font-weight:600;color:var(--muted)}
dl{display:grid;grid-template-columns:150px 1fr;gap:6px 12px;margin:0} dt{color:var(--muted)} dd{margin:0}
.owner{display:flex;justify-content:space-between;gap:10px;padding-block:8px} .owner+.owner{border-top:1px dashed var(--line)}
.fine{color:var(--faint);font-size:12px;margin-top:14px}
.modal{position:fixed;inset:0;z-index:70;display:grid;place-items:center;background:rgba(0,0,0,.25);padding:16px}
.box{background:var(--bg);border-radius:8px;width:min(440px,100%);padding:20px 22px;border:1px solid var(--line);max-height:calc(100dvh - 32px);overflow-y:auto;overscroll-behavior:contain}
.box h3{margin:0 0 4px;font-size:16px;font-weight:600}
.radios{display:grid;grid-template-columns:1fr 1fr;gap:2px 12px;margin:14px 0}
.hold{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--warn);background:color-mix(in srgb,var(--warn) 11%,var(--bg));border-radius:999px;padding:3px 9px;white-space:nowrap}
.hold.live{color:var(--blue);background:color-mix(in srgb,var(--blue) 11%,var(--bg))}
.hold .pulse{width:7px;height:7px;border-radius:50%;background:currentColor;animation:pulse 1.2s ease-in-out infinite}
@keyframes pulse{50%{opacity:.25}}
.heldcell{display:inline-flex;align-items:center;gap:6px} .btn.ghost{opacity:.7;white-space:nowrap}
tr.held-row td:not(.callcol){color:var(--muted)}
.target.race{grid-template-columns:minmax(230px,auto) 1fr auto}
.r-track{position:relative;height:58px;margin:0 22px 0 8px}
.r-line{position:absolute;left:0;right:0;top:50%;height:8px;margin-top:-4px;border-radius:999px;background:var(--hover);border:1px solid var(--line)}
.r-fill{position:absolute;left:0;top:50%;height:8px;margin-top:-4px;border-radius:999px;background:linear-gradient(90deg,color-mix(in srgb,var(--accent) 60%,#fff),var(--accent));transition:width .6s cubic-bezier(.2,.8,.2,1)}
.r-goal{position:absolute;top:2px;bottom:2px;width:0;border-left:2px dashed color-mix(in srgb,var(--ink) 35%,transparent)}
.r-goal span{position:absolute;top:-2px;left:4px;font-size:10.5px;color:var(--muted);white-space:nowrap}
.r-dot{position:absolute;transform:translate(-50%,-50%);width:26px;height:26px;border-radius:50%;display:grid;place-items:center;
  background:var(--bg);border:2px solid var(--line);font-size:10px;font-weight:700;color:var(--muted);transition:left .7s cubic-bezier(.2,.8,.2,1);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.r-dot.lead{border-color:#d4a017;color:#a87b00}
.r-dot.me{width:34px;height:34px;background:var(--accent);border-color:var(--accent);color:var(--accent-ink);font-size:10.5px;box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 18%,transparent)}
.r-dot .crown{position:absolute;top:-15px;font-style:normal;font-size:13px}
.r-podium{display:flex;gap:10px;font-size:12px;white-space:nowrap} .r-podium b{font-variant-numeric:tabular-nums}
.r-podium .mine{color:var(--accent);font-weight:600}
.co-start{font:inherit;font-weight:600;background:var(--accent);color:var(--accent-ink);border:none;border-radius:999px;padding:6px 14px;margin-left:14px;cursor:pointer}
.co-pill{display:inline-flex;align-items:center;gap:6px;margin-left:14px;font-weight:600;color:var(--accent)} .co-pill i{width:8px;height:8px;border-radius:50%;background:#ff6b5f;animation:copulse 1.2s infinite}
@keyframes copulse{50%{opacity:.3}}
.cbk{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:10px 0 14px} .cbk .lbl{font-size:12px;color:var(--muted);font-weight:600;width:100%}
.cbk-chips{display:flex;gap:6px;flex-wrap:wrap} .cbk-chips button{font:inherit;font-size:13px;padding:6px 12px;border:1px solid var(--line);border-radius:999px;background:var(--bg);color:var(--ink);cursor:pointer}
.cbk-chips button.on{border-color:var(--accent);color:var(--accent);font-weight:600;background:color-mix(in srgb,var(--accent) 8%,var(--bg))}
.cbk input{padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit;font-size:13px} .cbk-hint{font-size:12px}
.todaybtn{margin-left:auto;font:inherit;font-size:14px;font-weight:600;display:inline-flex;align-items:center;gap:8px;padding:7px 14px;border:1px solid var(--line);border-radius:999px;background:var(--bg);color:var(--ink);cursor:pointer}
.todaybtn .n{min-width:22px;padding:1px 7px;border-radius:999px;background:var(--hover);font-size:12.5px;text-align:center}
.todaybtn.due{border-color:var(--accent);color:var(--accent)} .todaybtn.due .n{background:var(--accent);color:var(--accent-ink)}
.ta-box{width:min(760px,calc(100vw - 32px));max-height:min(86vh,900px);display:flex;flex-direction:column;gap:10px}
.ta-head{display:flex;justify-content:space-between;align-items:center} .ta-head h3{margin:0}
.ta-list{overflow:auto;display:flex;flex-direction:column;gap:14px;padding-right:4px}
.ta-sec{display:flex;flex-direction:column;gap:6px} .ta-sec .lbl{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.ta-row{display:grid;grid-template-columns:90px 1fr auto;gap:12px;align-items:center;padding:10px 12px;border:1px solid var(--line);border-radius:10px}
.ta-row.late{border-color:color-mix(in srgb,#c0392b 40%,var(--line))} .ta-row.late .ta-when{color:#c0392b}
.ta-when{font-weight:600;font-size:13px} .ta-who{display:flex;flex-direction:column;gap:3px;min-width:0} .ta-who b{font-size:14px} .ta-who .muted{font-size:12.5px}
.ta-acts{display:flex;gap:6px;align-items:center} .ta-move{grid-column:1/-1;display:flex;gap:8px;justify-content:flex-end}
.ta-move input{padding:6px 8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit}
@media (max-width:640px){.ta-row{grid-template-columns:1fr}.ta-acts{justify-content:flex-start}}

.head-row{display:flex;align-items:center;gap:16px;flex-wrap:wrap} .srcsw button{padding:5px 14px}
.leadpool{display:flex;flex-direction:column;min-height:0}
.lp-tools{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin:10px 0 12px}
.lp-tools input[type=search]{padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);min-width:260px;font:inherit;font-size:14px}
.lp-tools .ms{position:relative;display:flex;flex-direction:column;gap:3px;min-width:220px} .lp-tools .ms h3{font-size:11px;font-weight:400;color:var(--muted);margin:0;text-transform:none;letter-spacing:0}
.lp-tools .ms .ms-btn{padding:8px 10px;font-size:14px;border-radius:8px} .lp-tools .ms>:last-child:not(.ms-btn){position:absolute;top:calc(100% + 4px);left:0;z-index:30;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:8px;width:300px;max-height:340px;overflow:auto;box-shadow:0 10px 30px rgba(0,0,0,.14)} .lp-sel{display:flex;flex-direction:column;gap:3px} .lp-sel .lbl{font-size:11px;color:var(--muted)}
.lp-sel select{padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit;font-size:14px}
.lp-tw{max-height:calc(100vh - var(--toph, 60px) - 230px)} .lp-tw .more .btn{margin:6px auto}

.co-testmode{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px dashed var(--line);border-radius:10px;font-size:13px;color:var(--muted);cursor:pointer} .co-testnote{display:block;font-style:normal;margin-top:4px;color:var(--ink)} .co-testmode b{color:var(--ink);margin-right:6px} .co-testmode.on{border-style:solid;border-color:var(--accent);background:color-mix(in srgb,var(--accent) 7%,var(--bg))}
.co-tv{margin-left:10px;font-weight:600;color:var(--accent);text-decoration:none;font-size:14px} .co-tv:hover{text-decoration:underline}
.tv{--logo-bg:#fff;--gold:#b08a3e;--gold2:#d9b86a;--goldbg:#faf5ea;--ink:#0b0b0b;--card:#f6f5f2;--line2:#e8e5df;--grey:#8a8a8a;position:fixed;inset:0;background:#fff;color:var(--ink);display:flex;flex-direction:column;padding:2.6vh 3vw 2.4vh;gap:1.8vh;overflow:hidden;font-size:1.6vh;font-family:"Helvetica Neue",Helvetica,Arial,sans-serif}
.tv.nomouse{cursor:none} .tv .n{font-variant-numeric:tabular-nums}
.tv-top{display:flex;justify-content:space-between;align-items:center;gap:2vw;flex-shrink:0} .tv-logo{display:block;height:7vh;color:var(--ink)} .tv-logo svg{height:100%;width:auto;display:block}
.tv-clock{font-size:2.6vh;font-weight:300;letter-spacing:.12em;color:#555}
.tv-test{font-size:1.4vh;font-weight:700;letter-spacing:.24em;color:var(--gold);border:1.5px solid var(--gold);background:var(--goldbg);padding:.9vh 1.4vw;border-radius:99px}
.tv-center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2.6vh;text-align:center;position:relative}
.tv2-k{font-size:1.45vh;font-weight:700;letter-spacing:.28em;color:var(--grey);display:inline-flex;align-items:center;gap:1vh}
.tv2-sub{font-size:2vh;color:#555} .tv2-sub.dim{color:var(--grey)}
.tv2-live{width:1.2vh;height:1.2vh;border-radius:50%;background:#ff3b30;box-shadow:0 0 0 0 rgba(255,59,48,.6);animation:tvping 1.6s infinite}
@keyframes tvping{0%{box-shadow:0 0 0 0 rgba(255,59,48,.6)}100%{box-shadow:0 0 0 1.4vh rgba(255,59,48,0)}}
.tv2-card{background:var(--card);border:1px solid var(--line2);border-radius:2.2vh;padding:2.4vh 2vw;min-width:0;position:relative;overflow:hidden}
.tv2-hero{display:grid;grid-template-columns:30fr 40fr 30fr;gap:1.4vw;flex-shrink:0;height:31vh}
.tv2-time{background:var(--ink);color:#fff;border-color:var(--ink);display:flex;flex-direction:column;justify-content:space-between}
.tv2-time .tv2-k{color:#a8a8a8} .tv2-time .tv2-sub{color:#bdbdbd}
.tv2-timer{font-size:13vh;font-weight:800;letter-spacing:-.05em;line-height:.9}
.tv2-time.close .tv2-timer{color:#ff6b5f} .tv2-time.last{background:#e0362c;border-color:#e0362c;color:#fff;animation:tvbeat 1s infinite} .tv2-time.last .tv2-k,.tv2-time.last .tv2-sub{color:#ffe1de}
@keyframes tvbeat{50%{transform:scale(1.015)}}
.tv2-bar{height:.6vh;border-radius:99px;background:rgba(255,255,255,.15);overflow:hidden} .tv2-bar i{display:block;height:100%;background:var(--gold2);border-radius:99px;transition:width 1s linear}
.tv2-calls{display:grid;grid-template-columns:auto 1fr;gap:2vw;align-items:center;background:#fff}
.tv2-ringwrap{position:relative;height:25vh;width:25vh}
.tv2-ring{width:100%;height:100%;transform:rotate(-90deg)} .tv2-ring circle{fill:none;stroke-width:7} .tv2-ring .bg{stroke:#efece6}
.tv2-ring .fg{stroke:var(--gold);stroke-linecap:round;transition:stroke-dashoffset 1s ease}
.tv2-ringin{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.tv2-ringin b{font-size:8.5vh;font-weight:800;letter-spacing:-.05em;line-height:1;animation:tvpop .6s cubic-bezier(.2,1.6,.4,1)} .tv2-ringin span{font-size:1.5vh;font-weight:700;letter-spacing:.3em;color:var(--grey)}
.tv2-callstats{display:flex;flex-direction:column;gap:1.4vh;min-width:0}
.tv2-callstats div{display:grid;grid-template-columns:1fr auto;grid-template-rows:auto auto;column-gap:1vw;border-bottom:1px solid var(--line2);padding-bottom:1.1vh}
.tv2-callstats div:last-child{border-bottom:none;padding-bottom:0}
.tv2-callstats .tv2-k{grid-column:1} .tv2-callstats b{grid-column:2;grid-row:1/3;font-size:5vh;font-weight:800;letter-spacing:-.04em;line-height:1;align-self:center}
.tv2-callstats em{grid-column:1;font-style:normal;font-size:1.7vh;color:#666}
.tv2-callstats div:last-child b{color:var(--gold)}
.tv2-prize{display:flex;flex-direction:column;justify-content:space-between;background:linear-gradient(140deg,#fbf6ea,#f3e6c6);border-color:#e6d3a3}
.tv2-prize::after{content:'';position:absolute;inset:0;background:linear-gradient(105deg,transparent 35%,rgba(255,255,255,.65) 50%,transparent 65%);transform:translateX(-100%);animation:tvsweep 5s ease-in-out infinite;pointer-events:none}
.tv2-prize .tv2-k{color:var(--gold)}
.tv2-prize-top{display:flex;gap:1.4vw;align-items:center} .tv2-prize-top>div{display:flex;flex-direction:column;gap:.9vh;min-width:0}
.tv2-prize-top b{font-size:5.2vh;font-weight:800;letter-spacing:-.035em;line-height:1.02;color:var(--ink)}
.tv2-prize .tv-cup{width:7vh;height:7vh;color:var(--gold);flex-shrink:0;animation:tvfloat 3s ease-in-out infinite}
.tv2-lead{border-top:1px solid #e6d3a3;padding-top:1.6vh;display:flex;flex-direction:column;gap:1vh}
.tv2-lead-row{display:flex;align-items:center;gap:1vw;animation:tvpop .7s cubic-bezier(.2,1.6,.4,1)} .tv2-lead-row b{font-size:3.6vh;font-weight:800;letter-spacing:-.02em} .tv2-lead-row em{font-style:normal;font-size:1.8vh;color:#6b5a35;margin-left:auto}
.tv2-lead .tv2-av{background:var(--ink);color:#fff}
.tv2-prize.big{width:min(90vw,110vh);padding:3.4vh 3vw} .tv2-prize.big .tv2-prize-top b{font-size:8vh} .tv2-prize.big .tv-cup{width:11vh;height:11vh}
.tv2-av{display:inline-grid;place-items:center;width:4.6vh;height:4.6vh;border-radius:50%;background:#ecebe7;color:var(--ink);font-style:normal;font-weight:700;font-size:1.7vh;letter-spacing:.04em;flex-shrink:0}
.tv2-av.big{width:9vh;height:9vh;font-size:3.2vh}
.tv2-line{text-align:center;font-size:2.4vh;font-weight:600;letter-spacing:-.01em;color:var(--ink);animation:tvfade .6s ease;flex-shrink:0}
@keyframes tvfade{from{opacity:0;transform:translateY(.8vh)}to{opacity:1;transform:none}}
.tv2-main{flex:1;display:grid;grid-template-columns:52fr 48fr;gap:1.4vw;min-height:0}
.tv2-podium{display:grid;grid-template-columns:repeat(3,1fr);gap:1vw;align-items:end;min-height:0}
.tv2-pod{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:.8vh;padding:2.4vh 1vw 2vh;border-radius:2.2vh;background:var(--card);border:1px solid var(--line2);text-align:center;transition:transform .4s}
.tv2-pod.p1{height:100%;background:var(--ink);color:#fff;border-color:var(--ink);box-shadow:0 2vh 4vh rgba(176,138,62,.18)} .tv2-pod.p2{height:86%} .tv2-pod.p3{height:76%}
.tv2-pod.p1 .tv2-av{background:linear-gradient(140deg,var(--gold2),var(--gold));color:#fff} .tv2-pod.p1 .tv2-pteam{color:#bdbdbd}
.tv2-pod.p1 .tv2-place{background:linear-gradient(140deg,var(--gold2),var(--gold));color:#fff}
.tv2-pod.p1 .tv2-pscore{color:var(--gold2)}
.tv2-pod.empty{background:transparent;border-style:dashed}
.tv2-place{font-size:1.5vh;font-weight:800;letter-spacing:.24em;padding:.6vh 1vw;border-radius:99px;background:#ecebe7;color:var(--ink)}
.tv2-pname{font-size:3.2vh;font-weight:800;letter-spacing:-.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.tv2-pteam{font-size:1.6vh;color:var(--grey)}
.tv2-pscore{font-size:9vh;font-weight:800;letter-spacing:-.05em;line-height:1;margin-top:auto}
.tv2-pod.bump{animation:tvbump .9s cubic-bezier(.2,1.6,.4,1)} @keyframes tvbump{30%{transform:translateY(-1.2vh)}}
.tv2-plus{position:absolute;top:1.2vh;right:1.2vw;font-size:2.6vh;font-weight:800;color:#fff;background:var(--gold);padding:.3vh .8vw;border-radius:99px;animation:tvplus 6s ease forwards}
@keyframes tvplus{0%{transform:scale(.4);opacity:0}10%{transform:scale(1.15);opacity:1}20%{transform:scale(1)}80%{opacity:1}100%{opacity:0}}
.tv2-list{display:flex;flex-direction:column;min-height:0;gap:.8vh}
.tv2-list ol{list-style:none;margin:0;padding:0;display:grid;grid-template-rows:repeat(9,minmax(0,1fr));gap:.5vh;flex:1;min-height:0}
.tv2-list li{display:grid;grid-template-columns:4vh auto 1fr auto 8vh;align-items:center;gap:1vw;padding:0 1.2vw;border-radius:1.4vh;background:var(--card);border:1px solid var(--line2);min-height:0;overflow:hidden;transition:background .4s}
.tv2-list li.bump{background:var(--goldbg);border-color:var(--gold2)}
.tv2-list li em{font-style:normal;font-size:2.2vh;font-weight:700;color:var(--grey)}
.tv2-list .tv2-av{width:3.8vh;height:3.8vh;font-size:1.4vh;background:#fff;border:1px solid var(--line2)}
.tv2-who{display:flex;align-items:baseline;gap:1vw;min-width:0;white-space:nowrap;line-height:1.25} .tv2-who b{font-size:2.3vh;font-weight:600;overflow:hidden;text-overflow:ellipsis} .tv2-who span{font-size:1.6vh;color:var(--grey);overflow:hidden;text-overflow:ellipsis}
.tv2-up{font-size:1.8vh;font-weight:800;color:var(--gold)}
.tv2-score{font-size:3.2vh;font-weight:800;letter-spacing:-.04em;text-align:right;line-height:1}
.tv2-pod.p1 .tv2-plus{background:#fff;color:var(--gold)}
.tv2-more{font-size:1.6vh;color:var(--grey);text-align:right}
.tv2-ticker{display:flex;align-items:center;gap:1.4vw;flex-shrink:0;height:5vh;border-radius:99px;background:var(--card);border:1px solid var(--line2);padding:0 .6vh;overflow:hidden}
.tv2-tk{font-size:1.4vh;font-weight:800;letter-spacing:.28em;color:#fff;background:linear-gradient(140deg,var(--gold2),var(--gold));padding:1vh 1.4vw;border-radius:99px;flex-shrink:0}
.tv2-tick-track{flex:1;overflow:hidden;white-space:nowrap;font-size:2vh;color:#333}
.tv2-tick-move{display:inline-flex;gap:4vw;animation:tvmarq 30s linear infinite;padding-left:2vw} .tv2-tick-move b{color:var(--ink);font-weight:800}
@keyframes tvmarq{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.tv2-tick-wait{color:var(--grey)}
.tv2-countwrap{position:relative;display:grid;place-items:center}
.tv2-count{font-size:30vh;line-height:.9;font-weight:800;letter-spacing:-.05em;animation:tvpop .5s cubic-bezier(.2,1.6,.4,1)}
.tv2-pulse{position:absolute;width:34vh;height:34vh;border-radius:50%;border:.4vh solid var(--gold);animation:tvring 1s ease-out infinite}
@keyframes tvring{0%{transform:scale(.6);opacity:.8}100%{transform:scale(1.35);opacity:0}}
.tv2-win{font-size:8vh;margin:0;font-weight:800;letter-spacing:-.04em}
.tv-shine{background:linear-gradient(100deg,var(--ink) 0%,var(--ink) 40%,var(--gold2) 50%,var(--ink) 60%,var(--ink) 100%);background-size:250% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:tvshine 5s linear infinite}
.tv-podium{display:flex;align-items:flex-end;gap:2vw;margin:1vh 0}
.tv-podium>div{width:22vh;display:flex;flex-direction:column;align-items:center;gap:.8vh} .tv-podium b{font-size:3.6vh;font-weight:800;letter-spacing:-.02em} .tv-podium span{font-size:2vh;color:#555}
.tv-podium>div>div{width:100%;background:var(--card);border:1px solid var(--line2);border-radius:1.6vh 1.6vh 0 0;display:flex;align-items:flex-start;justify-content:center;padding-top:1.6vh;font-size:5vh;font-weight:800}
.tv-podium .s1>div{height:26vh;background:linear-gradient(160deg,var(--gold2),var(--gold));border-color:var(--gold);color:#fff} .tv-podium .s2>div{height:19vh} .tv-podium .s3>div{height:14vh}
.tv-podium .s1 .tv2-av{background:var(--ink);color:#fff}
.tv2-confetti{position:absolute;inset:-10vh 0 0;pointer-events:none;overflow:hidden}
.tv2-confetti i{position:absolute;top:-4vh;width:1vh;height:1.8vh;background:var(--gold2);opacity:.9;animation:tvfall linear infinite}
.tv2-confetti i:nth-child(3n){background:var(--ink)} .tv2-confetti i:nth-child(4n){background:#d6d3cc;width:1.4vh;height:1vh}
@keyframes tvfall{0%{transform:translateY(0) rotate(0)}100%{transform:translateY(115vh) rotate(720deg)}}
.tv-today{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(5,auto);grid-auto-flow:column;gap:1vh 2vw;min-width:62vw}
.tv-today li{display:grid;grid-template-columns:4vh auto 1fr auto;align-items:center;gap:1vw;font-size:2.6vh;padding:1.2vh 1.4vw;border-radius:1.4vh;background:var(--card);border:1px solid var(--line2);text-align:left}
.tv-today li:first-child{background:var(--goldbg);border-color:var(--gold2)}
.tv-today em{font-style:normal;color:var(--grey);font-weight:700} .tv-today b{font-weight:600} .tv-today span{font-weight:800;font-size:3.2vh}
.tv-full{position:fixed;right:2vw;bottom:2vh;font:inherit;font-size:13px;letter-spacing:.12em;text-transform:uppercase;padding:9px 16px;border:1px solid var(--ink);border-radius:99px;background:#fff;color:var(--ink);cursor:pointer}
@keyframes tvsweep{0%,55%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
@keyframes tvshine{0%{background-position:100% 0}100%{background-position:-150% 0}}
@keyframes tvfloat{50%{transform:translateY(-.6vh) rotate(-4deg)}}
@keyframes tvpop{0%{transform:scale(.6);opacity:0}100%{transform:scale(1);opacity:1}}
.tv-topr{display:flex;align-items:center;gap:1.4vw}
.tv3-line{font-size:2.6vh;font-weight:700;letter-spacing:-.01em;animation:tvfade .6s ease;text-align:center}
.tv3{flex:1;display:grid;grid-template-columns:34fr 66fr;grid-template-rows:1fr auto;gap:1.6vh 1.4vw;min-height:0}
.tv3-side{display:grid;grid-template-rows:auto 1fr auto;gap:1.6vh;min-height:0}
.tv3-side .tv2-time{gap:1.2vh} .tv3-side .tv2-timer{font-size:12vh}
.tv3-calls{display:grid;grid-template-columns:auto 1fr;gap:1.6vw;align-items:center;background:#fff;padding:2vh 1.6vw}
.tv3-calls .tv2-ringwrap{width:22vh;height:22vh} .tv3-calls .tv2-ringin b{font-size:7vh}
.tv3-stats{display:flex;flex-direction:column;gap:1.2vh}
.tv3-stats div{display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto auto;column-gap:1vw;align-items:center}
.tv3-stats b{grid-row:1/3;font-size:4.4vh;font-weight:800;letter-spacing:-.04em;line-height:1;min-width:14vh}
.tv3-stats .tv2-k{font-size:1.3vh} .tv3-stats em{font-style:normal;font-size:1.6vh;color:#666}
.tv3-stats .gold b{color:var(--gold)}
.tv3-prize{gap:1.2vh} .tv3-prize .tv2-prize-top b{font-size:4.6vh} .tv3-mode{font-size:1.7vh;color:#6b5a35}
.tv3-board{display:flex;flex-direction:column;gap:1.2vh;min-height:0;background:#fff;border:1px solid var(--line2);border-radius:2.2vh;padding:2.2vh 1.8vw}
.tv3-head{display:flex;justify-content:space-between;align-items:baseline} .tv3-lead{font-size:2.2vh;font-weight:700;color:var(--gold)}
.tv3-top{list-style:none;margin:0;padding:0;display:grid;grid-template-rows:1.25fr 1fr 1fr;gap:1vh;flex:0 0 38%;min-height:0}
.tv3-top li{position:relative;display:grid;grid-template-columns:5vh auto 1fr auto auto;align-items:center;gap:1.4vw;padding:0 1.8vw;border-radius:1.8vh;background:var(--card);border:1px solid var(--line2);min-height:0;transition:transform .4s}
.tv3-top li.r1{background:var(--ink);color:#fff;border-color:var(--ink);box-shadow:0 1.4vh 3vh rgba(176,138,62,.18)}
.tv3-top li.r1 .tv2-av{background:linear-gradient(140deg,var(--gold2),var(--gold));color:#fff} .tv3-top li.r1 .tv3-who span{color:#bdbdbd} .tv3-top li.r1 .tv3-score{color:var(--gold2)}
.tv3-top li.r1 .tv3-medal{background:linear-gradient(140deg,var(--gold2),var(--gold));color:#fff}
.tv3-top .tv2-av.big{width:7vh;height:7vh;font-size:2.4vh} .tv3-top li.r1 .tv2-av.big{width:8.5vh;height:8.5vh;font-size:2.8vh}
.tv3-medal{display:grid;place-items:center;width:4.6vh;height:4.6vh;border-radius:50%;background:#ecebe7;font-weight:800;font-size:2.2vh}
.tv3-who{display:flex;flex-direction:column;gap:.5vh;min-width:0} .tv3-who b{font-size:3.2vh;font-weight:800;letter-spacing:-.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis} .tv3-who span{font-size:1.7vh;color:var(--grey)}
.tv3-top li.r1 .tv3-who b{font-size:3.8vh}
.tv3-score{font-size:6.4vh;font-weight:800;letter-spacing:-.05em;line-height:1} .tv3-top li.r1 .tv3-score{font-size:8vh}
.tv3-top li.bump{animation:tvbump .9s cubic-bezier(.2,1.6,.4,1)}
.tv3-top .tv2-plus{position:static}
.tv3-top li.r1 .tv2-plus{background:#fff;color:var(--gold)}
.tv3-rest{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(4,minmax(0,1fr));grid-auto-flow:column;gap:.8vh 1vw;flex:1;min-height:0}
.tv3-rest li{display:grid;grid-template-columns:3.6vh auto 1fr auto 6vh;align-items:center;gap:.8vw;padding:0 1.2vw;border-radius:1.4vh;background:var(--card);border:1px solid var(--line2);min-height:0;overflow:hidden;transition:background .4s}
.tv3-rest li.bump{background:var(--goldbg);border-color:var(--gold2)}
.tv3-rest li em{font-style:normal;font-size:2vh;font-weight:700;color:var(--grey)}
.tv3-rest .tv2-av{width:4vh;height:4vh;font-size:1.4vh;background:#fff;border:1px solid var(--line2)}
.tv3-rest .tv2-score{font-size:3.4vh}
.tv3-ticker{grid-column:1/-1}


.box.co-setup{width:min(560px,calc(100vw - 32px));display:flex;flex-direction:column;gap:16px} .co-setup h3{margin:0 0 4px} .co-setup p{margin:0}
.co-f{display:flex;flex-direction:column;gap:7px} .co-f .lbl,.co-next .lbl{font-size:11px;color:var(--muted);font-weight:600;letter-spacing:.05em;text-transform:uppercase}
.co-f input{font:inherit;font-size:14px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink)}
.co-chips{display:flex;gap:8px;flex-wrap:wrap;align-items:center} .co-chips button{font:inherit;font-size:14px;padding:8px 14px;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:9px;cursor:pointer}
.co-chips.round button{border-radius:999px} .co-chips button.on{border:2px solid var(--accent);color:var(--accent);font-weight:650;padding:7px 13px} .co-chips input{width:100px}
.co-teams{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 14px;font-size:14px} .co-two{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.co-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;border-top:1px solid var(--line);padding-top:14px;flex-wrap:wrap}
.co-cover{position:fixed;inset:0;z-index:60;background:#0f2e2b;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;text-align:center;padding:24px;overflow:auto}
.co-kicker{font-size:12px;font-weight:700;letter-spacing:.13em;color:#6cc3b8;display:inline-flex;align-items:center;gap:8px} .co-kicker i{width:8px;height:8px;border-radius:50%;background:#ff6b5f;animation:copulse 1.2s infinite}
.co-big{font-size:180px;line-height:1;font-weight:800;font-variant-numeric:tabular-nums} .co-sub{font-size:16px;color:#a9c9c4}
.co-cover.results h2{margin:0;font-size:40px;letter-spacing:-.02em}
.co-podium{display:flex;align-items:flex-end;gap:14px;margin-top:14px} .co-step{width:200px;display:flex;flex-direction:column;align-items:center;gap:6px}
.co-step b{font-size:19px} .co-step span{font-size:13px;color:#a9c9c4}
.co-step div{width:100%;border-radius:14px 14px 0 0;color:#0f2e2b;font-size:40px;font-weight:800;padding-top:12px;margin-top:4px}
.co-step.s1 div{height:190px;background:#f2c14e} .co-step.s2 div{height:140px;background:#c9d1cf} .co-step.s3 div{height:100px;background:#d79a6a} .co-step.gap{visibility:hidden}
.co-awards{display:flex;gap:12px;flex-wrap:wrap;justify-content:center} .co-awards div{background:rgba(255,255,255,.08);border-radius:12px;padding:12px 18px;display:flex;flex-direction:column;gap:2px;min-width:180px;text-align:left}
.co-awards span{font-size:11px;color:#a9c9c4;font-weight:600;letter-spacing:.06em} .co-awards b{font-size:17px}
.co-done{font:inherit;font-size:14px;font-weight:650;padding:12px 22px;border:none;background:#6cc3b8;color:#0b1f1c;border-radius:10px;cursor:pointer;margin-top:6px}
.co-live{display:flex;flex-direction:column}
.co-bar{background:#0f2e2b;color:#fff;padding:16px 24px;border-radius:16px;margin:18px 0 6px;display:flex;align-items:center;gap:26px;flex-wrap:wrap}
.co-lbs{display:flex;gap:6px;flex-wrap:wrap} .co-lbs span{background:rgba(255,255,255,.1);border-radius:999px;padding:3px 11px 3px 4px;font-size:13px;display:inline-flex;align-items:center;gap:6px}
.co-lbs em{font-style:normal;font-size:11px;font-weight:700;background:rgba(255,255,255,.16);border-radius:999px;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center}
.co-lbs span.me{background:#6cc3b8;color:#0b1f1c} .co-lbs span.me em{background:rgba(0,0,0,.12)} .co-lbs .more{padding:3px 11px}
.co-me .co-ctl{display:flex;gap:6px;margin-top:6px} .co-me .co-ctl button{font:inherit;font-size:12px;background:transparent;color:#fff;border:1px solid rgba(255,255,255,.35);border-radius:7px;padding:4px 10px;cursor:pointer}
.co-clock{display:flex;flex-direction:column;gap:2px;min-width:200px} .co-clock>b{font-size:52px;line-height:1;font-weight:700;letter-spacing:-.02em}
.co-dim{font-size:13px;color:#a9c9c4} .co-mid{flex:1 1 380px;display:flex;flex-direction:column;gap:9px;min-width:0}
.co-row{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap} .co-mid .co-row b{color:#fff;font-size:15px}
.co-track{height:10px;background:rgba(255,255,255,.12);border-radius:999px;overflow:hidden} .co-track i{display:block;height:100%;background:#6cc3b8;border-radius:999px;transition:width .6s}
.co-tick{display:flex;gap:8px;flex-wrap:wrap} .co-tick span{font-size:12px;color:#a9c9c4} .co-tick span+span::before{content:'· ';}
.co-me{display:flex;flex-direction:column;align-items:flex-end;gap:2px;min-width:160px} .co-me>b{font-size:38px;line-height:1}
.co-body{display:flex;gap:22px;padding:22px 28px 40px;flex-wrap:wrap;align-items:flex-start}
.co-main{flex:999 1 560px;min-width:0;display:flex;flex-direction:column;gap:14px} .co-main .co-row b{font-size:15px}
.co-next{border:2px solid var(--accent);border-radius:16px;padding:20px 22px;display:flex;align-items:center;gap:20px;flex-wrap:wrap}
.co-next.empty{flex-direction:column;align-items:flex-start;gap:4px;border-style:dashed} .co-who{flex:1 1 320px;display:flex;flex-direction:column;gap:4px;min-width:0}
.co-name{font-size:24px;font-weight:650;color:var(--ink);text-align:left} .co-who .muted{font-size:14px}
.co-acts{display:flex;gap:10px;align-items:center;flex-wrap:wrap} .co-calls{display:flex;flex-direction:column;gap:8px}
.co-call{font:inherit;font-size:16px;font-weight:700;padding:13px 22px;border:none;background:var(--blue);color:#fff;border-radius:12px;display:flex;align-items:center;gap:9px;cursor:pointer}
.co-call .co-num{font-weight:400;font-size:13px;opacity:.85}
.co-list{border:1px solid var(--line);border-radius:12px;overflow:hidden}
.co-item{display:grid;grid-template-columns:minmax(150px,1.1fr) minmax(0,2fr) 90px 150px;gap:10px;padding:11px 16px;border-top:1px solid var(--line);font-size:14px} .co-item:first-child{border-top:none}
.co-lb{flex:1 1 320px;max-width:400px;border:1px solid var(--line);border-radius:16px;padding:16px 18px;display:flex;flex-direction:column;gap:2px;min-height:420px}
.co-lb>.co-row{margin-bottom:8px} .co-lbr{display:grid;grid-template-columns:28px minmax(0,1fr) 70px 64px;align-items:center;padding:8px;border-radius:9px;font-size:14px}
.co-lbr.me{background:var(--hover);outline:1px solid var(--accent)} .co-lbr .top{color:var(--warn);font-weight:700} .co-lbr b{text-align:right} .co-lbr b small{color:var(--muted);font-weight:400}
.co-lbr>span:last-child{text-align:right;font-size:12px} .co-ctl{display:flex;gap:8px;justify-content:flex-end;border-top:1px solid var(--line);padding-top:12px}
@media (max-width:760px){.co-item{grid-template-columns:1fr 1fr}.co-big{font-size:120px}.co-podium{gap:6px}.co-step{width:30vw}}
.box.msg-ed{width:min(680px,calc(100vw - 32px));display:flex;flex-direction:column;gap:14px} .box.msg-ed h3{margin:0}
.msg-ed code{background:var(--hover);border-radius:4px;padding:0 4px;font-size:12px}
.msg-f{display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--line);padding-top:12px} .msg-h{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.msg-h .link{margin-left:auto} .msg-f textarea{font:inherit;font-size:14px;line-height:1.45;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);resize:vertical}
.msg-std{margin:0;color:var(--muted)} .msg-prev{background:#e7f6e9;color:#14301b;border-radius:10px;padding:10px 12px;font-size:13px;white-space:pre-wrap}
.msg-prev .lbl{display:block;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:#4b6b53;margin-bottom:4px}
.msg-ed .acts{display:flex;justify-content:flex-end;align-items:center;gap:8px}
.msg-list{display:flex;flex-direction:column;gap:12px;max-height:min(58vh,560px);overflow:auto;padding-right:4px}
.msg-group{display:flex;flex-direction:column;gap:4px} .msg-group>.lbl{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.msg-row{border:1px solid var(--line);border-radius:10px} .msg-row.open{border-color:var(--accent)}
.msg-top{display:grid;grid-template-columns:max-content max-content minmax(0,1fr);gap:10px;align-items:center;width:100%;text-align:left;background:none;border:none;padding:9px 12px;cursor:pointer;font:inherit;color:var(--ink)}
.msg-top .tag{font-size:11px;border-radius:999px;padding:1px 8px;background:var(--hover);color:var(--muted)} .msg-top .tag.mine{background:var(--accent);color:var(--accent-ink)}
.msg-peek{color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.msg-body{display:flex;flex-direction:column;gap:8px;padding:0 12px 12px} .msg-body textarea{font:inherit;font-size:14px;line-height:1.45;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);resize:vertical}
.msg-acts{display:flex;gap:16px;flex-wrap:wrap}
.dash{padding-block:20px 60px;max-width:1300px}
.teamp .dash-ctl input{padding:7px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);min-width:200px}
.teamp .card{margin-bottom:12px} .teamp td.wrapc{white-space:normal;max-width:340px} .teamp tr.idle td{color:var(--faint)}
.box.person{display:flex;flex-direction:column;gap:10px;width:min(480px,calc(100vw - 32px))} .box.person h3{margin:0 0 4px}
.box.person label:not(.cb){display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--muted)}
.box.person input:not([type=checkbox]),.box.person select{padding:8px 10px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink);font-size:14px}
.box.person .pair{display:grid;grid-template-columns:1fr 1fr;gap:10px} .box.person .lbl{font-size:12px;color:var(--muted)}
.box.person .cl-list{max-height:220px} .box.person .acts{display:flex;justify-content:flex-end;gap:8px;margin-top:4px}
.dash-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin-bottom:16px}
.dash:not(.teamp) .dash-head{flex-direction:column;align-items:flex-start;gap:14px} .dash:not(.teamp) .dash-head .dash-ctl{justify-content:flex-start;flex-wrap:nowrap} @media (max-width:900px){.dash:not(.teamp) .dash-head .dash-ctl{flex-wrap:wrap}}
.dash-head h1{font-size:22px;margin:0;font-weight:650} .dash-head p{margin:4px 0 0}
.pp{display:flex;align-items:center;gap:10px;flex-wrap:nowrap} .pp-dates{display:flex;gap:6px;align-items:center;white-space:nowrap} .pp-dates input{opacity:.75} .pp-dates.on input{opacity:1;border-color:var(--accent)} @media (max-width:900px){.pp{flex-wrap:wrap}} .pp-dates input{padding:5px 8px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font:inherit;font-size:13px}
.dash-ctl{display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:flex-end} .dash-ctl select{padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg)}
.kpis{display:grid;grid-template-columns:1.6fr repeat(4,1fr);gap:12px;margin-bottom:12px}
.rep .small{font-size:12px;margin:2px 0 10px} .rep .dash-ctl .btn{white-space:nowrap} .rep-more{margin-top:8px} .rep .rep-top{font-size:18px;line-height:1.25;color:var(--cold)}
.rep-split{display:flex;height:34px;border-radius:8px;overflow:hidden;gap:2px} .rep-split i{display:flex;align-items:center;justify-content:center;font-style:normal;font-size:12.5px;font-weight:650;color:#fff;min-width:4px}
.rep-split .hot,.rep-key .hot,.hb-t .hot{background:var(--hot)} .rep-split .cold,.rep-key .cold,.hb-t .cold{background:var(--cold)}
.rep-split .noc,.rep-key .noc,.hb-t .noc{background:#9aa29f} .rep-split .none,.rep-key .none{background:var(--line);color:var(--muted)}
.rep-key{display:flex;gap:18px;flex-wrap:wrap;margin-top:10px;font-size:13px;color:var(--muted)} .rep-key i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.rep-grid{grid-template-columns:1fr 1fr} @media (max-width:900px){.rep-grid{grid-template-columns:1fr}}
.hbars{display:flex;flex-direction:column;gap:7px}
.hb-row{display:grid;grid-template-columns:minmax(120px,38%) 1fr 74px;align-items:center;gap:10px;font-size:13px}
.hb-l{white-space:nowrap;overflow:hidden;text-overflow:ellipsis} .hb-t{height:14px;background:var(--hover);border-radius:4px;overflow:hidden} .hb-t i{display:block;height:100%;border-radius:4px}
.hb-n{text-align:right;white-space:nowrap} .hb-n em{font-style:normal;color:var(--faint);font-size:12px;margin-left:2px}
.rep-gh{display:flex;justify-content:space-between;align-items:center;gap:10px} .rep-gh h4{margin:0}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:999px;overflow:hidden} .seg button{border:0;background:none;padding:5px 12px;font-size:12.5px;color:var(--muted);cursor:pointer} .seg button.on{background:var(--accent);color:var(--accent-ink)}
.rep-wrap{overflow-x:auto} .rep-t th.rep-c{max-width:96px;white-space:normal;line-height:1.2;font-size:11.5px;vertical-align:bottom}
.rep-t td.heat{background:color-mix(in srgb,var(--cold) calc(var(--h,0) * 42%),transparent)}
.rep-own{list-style:none;margin:0;padding:0;columns:2 340px;column-gap:24px} .rep-own li{break-inside:avoid;padding:7px 0;border-bottom:1px solid var(--line);font-size:13px;display:flex;justify-content:space-between;gap:12px}
.rep-own em{font-style:normal;color:var(--faint);white-space:nowrap;font-size:12px}
@media print{
  header.top,.noprint,.toast{display:none!important}
  :root{--bg:#fff;--ink:#1c2120;--line:#e2e5e4;--hover:#f1f3f2}
  body{background:#fff}
  .rep{padding:0!important;max-width:none;zoom:.72}
  .rep .card,.rep .kpi{break-inside:avoid;box-shadow:none}
  .rep-split i,.hb-t i,.rep-key i,.rep-t td.heat{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .rep-wrap{overflow:visible}
  @page{size:A4 landscape;margin:12mm}
}
@media (max-width:1000px){.kpis{grid-template-columns:1fr 1fr}}
.kpi{border:1px solid var(--line);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:4px;background:var(--bg)}
.kpi span{font-size:12px;color:var(--muted)} .kpi b{font-size:28px;font-weight:700;letter-spacing:-.02em} .kpi b small{font-size:15px;color:var(--faint);font-weight:500}
.kpi em{font-style:normal;font-size:12px;color:var(--faint)}
.kpi.hot b{color:var(--hot)} .kpi.cold b{color:var(--cold)}
.kpi.big{background:linear-gradient(110deg,color-mix(in srgb,var(--accent) 9%,var(--bg)),var(--bg) 70%)} .kpi.big b{color:var(--accent)}
.kbar{height:8px;border-radius:999px;background:var(--hover);overflow:hidden;margin-top:4px}
.kbar i{display:block;height:100%;background:var(--accent);border-radius:999px;transition:width .5s} .kbar i.hit{background:var(--hot)}
.kbar.sm{display:inline-block;width:70%;height:6px;vertical-align:middle;margin:0 8px 0 0}
.dash-ctl .btn{padding:7px 14px;border-radius:999px}
.mypos{display:flex;gap:28px;align-items:center;margin-bottom:12px;padding:20px 24px;background:linear-gradient(110deg,color-mix(in srgb,var(--accent) 10%,var(--bg)),var(--bg) 75%)}
.mp-rank{display:flex;flex-direction:column;gap:2px;min-width:150px} .mp-rank span{font-size:12px;color:var(--muted)}
.mp-rank b{font-size:52px;line-height:1.05;font-weight:750;letter-spacing:-.03em;color:var(--accent)} .mp-rank em{font-style:normal;font-size:13px;color:var(--muted)}
.mypos.podium .mp-rank b{color:#b7861b}
.mp-next{flex:1;min-width:0;display:flex;flex-direction:column;gap:10px} .mp-next p{margin:0;font-size:15px}
.mp-ladder{display:flex;gap:10px;flex-wrap:wrap}
.mp-step{border:1px solid var(--line);border-radius:10px;padding:8px 14px;display:flex;align-items:baseline;gap:8px;background:var(--bg)}
.mp-step span{font-size:12px;color:var(--muted)} .mp-step b{font-size:20px} .mp-step em{font-style:normal;font-size:12px;color:var(--faint)}
.mp-step.you{border-color:var(--accent)} .mp-step.you b{color:var(--accent)}
@media (max-width:700px){.mypos{flex-direction:column;align-items:flex-start;gap:12px}}
.dash-grid{display:grid;grid-template-columns:1.4fr 1fr;gap:12px;margin-bottom:12px} @media (max-width:1000px){.dash-grid{grid-template-columns:1fr}}
.dash-grid>.card:only-child{grid-column:1/-1} .dash-grid>*{min-width:0} .dash .card{overflow-x:auto}
.card{border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--bg)}
.card h4{margin:0 0 12px;font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.bars{display:flex;align-items:flex-end;gap:6px;height:150px}
.bar-c{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;justify-content:flex-end;min-width:0}
.bar-v{width:100%;max-width:38px;min-height:2px;border-radius:6px 6px 2px 2px;background:linear-gradient(180deg,var(--accent),color-mix(in srgb,var(--accent) 60%,#fff));position:relative;transition:height .5s}
.bar-v span{position:absolute;top:-17px;left:50%;transform:translateX(-50%);font-size:11px;color:var(--muted)}
.bar-c em{font-style:normal;font-size:10.5px;color:var(--faint);white-space:nowrap}
.bars.many{gap:3px} .bars.many .bar-c{overflow:visible} .bars.many .bar-v span{font-size:10px}
table.mini{width:100%;min-width:0;border-collapse:collapse} table.mini th{text-align:left;font-size:11.5px;color:var(--muted);font-weight:500;padding:6px 8px;border-bottom:1px solid var(--line)}
table.mini td{padding:9px 8px;border-bottom:1px solid var(--line)} table.mini tr:last-child td{border-bottom:none} table.mini .r{text-align:right}
table.mini tr.click{cursor:pointer} table.mini tr.click:hover td{background:var(--hover)}
.lb .rank{font-size:17px;text-align:center} .lb tr.idle td{color:var(--faint)}
.hotc{color:var(--hot)} .coldc{color:var(--cold)}
.target{position:relative;overflow:hidden;margin-top:18px;border:1px solid var(--line);border-radius:14px;padding:14px 18px;
  display:grid;grid-template-columns:minmax(220px,auto) 1fr auto;gap:8px 22px;align-items:center;
  background:linear-gradient(100deg,color-mix(in srgb,var(--accent) 8%,var(--bg)),var(--bg) 60%)}
@media (max-width:900px){.target{grid-template-columns:1fr}}
.t-num{display:flex;align-items:baseline;gap:6px} .tset{font-size:12px;margin-left:6px}
.tedit{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:6px 0 2px;font-size:13px} .tedit label{display:flex;align-items:center;gap:8px;color:var(--muted)} .tedit input{width:76px;padding:5px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--ink)} .tedit .faint{font-size:12px} .tedit .err{color:var(--cold)}
 .t-num b{font-size:28px;font-weight:700;letter-spacing:-.02em;color:var(--accent)} .t-num span{color:var(--muted)}
.t-line{font-size:12.5px;color:var(--ink);margin-top:1px}
.t-track{position:relative;height:12px;border-radius:999px;background:var(--hover);border:1px solid var(--line)}
.t-fill{position:absolute;inset:0 auto 0 0;border-radius:999px;background:linear-gradient(90deg,color-mix(in srgb,var(--accent) 70%,#fff),var(--accent));transition:width .6s cubic-bezier(.2,.8,.2,1)}
.t-pace{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--ink);opacity:.35;border-radius:2px}
.t-mark{position:absolute;top:50%;width:6px;height:6px;margin:-3px 0 0 -3px;border-radius:50%;background:var(--line)} .t-mark.hit{background:var(--bg)}
.t-side{display:grid;justify-items:end;gap:3px;text-align:right} @media (max-width:900px){.t-side{justify-items:start;text-align:left}}
.t-pill{font-size:12px;font-weight:600;border-radius:999px;padding:3px 10px;background:var(--hover);color:var(--muted)}
.t-pill.good{background:color-mix(in srgb,var(--accent) 14%,var(--bg));color:var(--accent)} .t-pill.warn{background:color-mix(in srgb,var(--warn) 14%,var(--bg));color:var(--warn)}
.target.done{border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}
.t-burst{position:absolute;left:50%;top:50%;pointer-events:none}
.t-burst i{position:absolute;width:6px;height:6px;border-radius:2px;background:var(--accent);opacity:0;animation:burst 1.1s ease-out var(--d) 2}
.t-burst i:nth-child(3n){background:var(--warn)} .t-burst i:nth-child(4n){background:var(--blue)}
@keyframes burst{0%{opacity:1;transform:rotate(var(--a)) translateX(0)}100%{opacity:0;transform:rotate(var(--a)) translateX(70px)}}
@media (prefers-reduced-motion:reduce){.t-burst{display:none}.t-fill{transition:none}}
th[draggable]{cursor:grab} th.dragging{opacity:.4} th.dropto{box-shadow:inset 3px 0 0 var(--accent)}
.cpick{width:340px} .cpick h5{margin:10px 0 6px;font-size:11px;font-weight:600;color:var(--faint);text-transform:uppercase;letter-spacing:.04em}
.order{list-style:none;margin:0;padding:0;display:grid;gap:3px;max-height:280px;overflow:auto}
.order li{display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:7px;padding:5px 6px 5px 8px;background:var(--bg);cursor:grab}
.order li.dragging{opacity:.45;border-style:dashed}
.order .grip{color:var(--faint);font-size:11px;letter-spacing:-2px} .order .nm{flex:1}
.order .ud{display:flex;gap:2px} .order .ud button{background:none;border:none;width:22px;height:22px;border-radius:4px;color:var(--muted)}
.order .ud button:hover:not([disabled]){background:var(--hover);color:var(--ink)} .order .ud button[disabled]{opacity:.3}
.addcols{display:flex;flex-wrap:wrap;gap:5px}
.lk{max-width:720px;margin:0 auto;padding:36px 16px 60px}
.lk .c{text-align:center}
.lk-hero{text-align:center;display:grid;justify-items:center;gap:8px;margin-bottom:22px}
.lk-hero h1{font-size:30px;line-height:1.15;font-weight:650;letter-spacing:-.02em;margin:6px 0 0}
.lk-hero p{margin:0;color:var(--muted);font-size:14px}
.pill{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:999px;padding:4px 11px;font-size:12px;white-space:nowrap;background:var(--bg)}
.pill .dot{margin:0} .pill.ok{color:var(--accent)} .pill.warn{color:var(--warn)}
.lk-search{display:grid;justify-items:center;gap:12px}
.seg{display:inline-flex;border:1px solid var(--line);border-radius:999px;padding:3px;gap:2px;background:var(--hover)}
.seg button{background:none;border:none;padding:6px 16px;border-radius:999px;color:var(--muted);font-size:13px}
.seg button.on{background:var(--bg);color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.1)}
.lk-bar{width:100%;display:flex;align-items:center;gap:10px;border:1px solid var(--line);border-radius:16px;padding:7px 7px 7px 16px;background:var(--bg);
  box-shadow:0 1px 2px rgba(0,0,0,.04),0 8px 24px rgba(0,0,0,.06);transition:border-color .15s,box-shadow .15s;color:var(--faint)}
.lk-bar:focus-within{border-color:var(--accent);box-shadow:0 0 0 4px color-mix(in srgb,var(--accent) 14%,transparent),0 8px 24px rgba(0,0,0,.06)}
.lk-bar input{flex:1;min-width:0;border:none;background:none;outline:none;font-size:15px;padding:8px 0;color:var(--ink)}
.lk-bar .btn{border-radius:11px;padding:10px 20px;font-size:14px}
.lk-permit{width:100%;border:1px solid var(--line);border-radius:14px;background:var(--hover);padding:12px 14px 14px}
.lk-permit-h{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline;margin-bottom:8px}
.lk-permit-h b{font-size:12.5px;font-weight:600} .lk-permit-h span{color:var(--muted);font-size:12px}
.lk-permit textarea{width:100%;margin:0;min-height:84px;border:1px solid var(--line);border-radius:10px;background:var(--bg);padding:10px 12px;font-size:13.5px}
.lk-permit textarea:focus{outline:none;border-color:var(--accent)}
.lk-meta{display:flex;flex-wrap:wrap;justify-content:center;align-items:center;gap:6px 12px;color:var(--muted);font-size:12px}
.lk-meta b{color:var(--ink);font-weight:600} .lk-meta .sep{width:3px;height:3px;border-radius:50%;background:var(--faint)}
.lk-sec{margin-top:34px}
.lk-sec h4{margin:0 0 10px;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:var(--faint);font-weight:600}
.lk-row{display:flex;align-items:center;gap:14px;width:100%;text-align:left;border:1px solid var(--line);border-radius:14px;padding:12px 14px;margin-bottom:8px;background:var(--bg);color:inherit}
.link-row{cursor:pointer;transition:border-color .15s,transform .15s} .link-row:hover{border-color:color-mix(in srgb,var(--accent) 45%,var(--line));transform:translateY(-1px)}
.lk-ico{flex:none;width:42px;height:42px;border-radius:11px;display:grid;place-items:center;background:color-mix(in srgb,var(--accent) 12%,var(--bg));color:var(--accent);font-weight:600;font-size:12px}
.lk-main{flex:1;min-width:0;display:grid;gap:2px} .lk-main b{font-weight:600}
.lk-main span{color:var(--muted);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lk-by{flex:none;text-align:right;color:var(--faint);font-size:11.5px;line-height:1.4}
.lk-empty{border:1px dashed var(--line);border-radius:14px;padding:22px;text-align:center;color:var(--muted)}
@media (max-width:560px){.lk-hero h1{font-size:24px} .lk-by{display:none}}
.notebox{margin:0 0 8px!important;min-height:64px!important}
.noteact{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px}
.note{border-top:1px solid var(--line);padding:9px 0}
.note p{margin:0 0 3px;white-space:pre-wrap;overflow-wrap:anywhere}
textarea{width:100%;border:1px solid var(--line);border-radius:4px;padding:7px;background:var(--bg);min-height:54px;resize:vertical;margin:10px 0 14px}
.toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:8px 14px;border-radius:6px;z-index:90}
.audit div{display:grid;grid-template-columns:120px 160px 1fr;gap:10px;padding:6px 0;border-bottom:1px solid var(--line)} .audit .bad{color:var(--bad)}
.login{max-width:340px;margin:12vh auto;padding:0 20px} .login h1{font-size:20px;margin:0 0 4px}
.login-alt{margin-top:16px;font-size:13px;color:var(--muted)}
.login form{display:flex;flex-direction:column;gap:10px;margin-top:20px} .login input{padding:9px 10px;border:1px solid var(--line);border-radius:6px;background:var(--bg)}
.phone{max-width:460px;margin:0 auto;padding:calc(20px + env(safe-area-inset-top,0px)) 20px 40px;min-height:100vh;display:flex;flex-direction:column;gap:18px}
.phone h1{font-size:18px;margin:0}
.callcard,.alerts{border:1px solid var(--line);border-radius:16px;padding:18px;display:flex;flex-direction:column;gap:6px}
.callcard .who{font-size:20px;font-weight:600} .alerts .ok{color:var(--accent);font-weight:600}
.bigcall{background:var(--blue);color:#fff;border:none;border-radius:999px;padding:16px;font-size:17px;font-weight:600;margin-top:10px;width:100%}
.bigcall[disabled]{opacity:.5}
.wa-laptop{display:flex;flex-direction:column;gap:4px;border:1px solid var(--line);border-radius:10px;padding:12px;margin-top:8px}
.wa-laptop .who{font-weight:600} .wa-laptop .wamsg{min-height:200px!important;font-size:13.5px}
.wa-warn{margin:0;padding:6px 10px;border-radius:8px;font-size:13px;color:var(--cold);background:color-mix(in srgb,var(--cold) 10%,var(--bg))}
.wa-how{font-size:12px;text-align:center} .wa-how .link{font-size:12px}
.wa-fix{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px}
.wa-laptop .bigcall{padding:11px;font-size:14px;margin-top:6px} .bigcall.wa{background:#1f9d55}
.wamsg{min-height:170px!important;font-size:15px;margin:8px 0 0!important;border-radius:10px!important}
.waiting{color:var(--muted);text-align:center;padding:50px 0}
.outcomes{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.outcomes button{border:1px solid var(--line);background:var(--bg);border-radius:10px;padding:12px;text-align:left}
.outcomes button.on{border-color:var(--accent);color:var(--accent);font-weight:600}
@media (max-width:820px){.layout{grid-template-columns:1fr;gap:10px}.filters{position:static;max-height:none}.right{margin-left:0;width:100%}}
@media (prefers-reduced-motion:reduce){.loadbar{animation:none;background:var(--accent)}}
`;

// ── Small helpers ───────────────────────────────────────────────────────────
const fmt = (n) => (n == null || n === '' ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }));
const iso = (d) => (d ? String(d).slice(0, 10) : null);
const fd = (d) => (iso(d) ? new Date(iso(d) + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
const fdt = (d) => new Date(d).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const todayDubai = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());
const daysTo = (d) => (iso(d) ? Math.round((Date.parse(iso(d)) - Date.parse(todayDubai())) / 864e5) : null);
const bedsLabel = (b) => (!b ? '—' : b === 'Studio' ? 'Studio' : `${b} bed`);
const placeOf = (u) => (u.unit_type === 'Villa' ? u.subcommunity : u.building);
const pct = (a, b) => (a && b ? Math.round((Number(a) / Number(b) - 1) * 100) : null);

// ── Sign-in and server calls ────────────────────────────────────────────────
let supa = null;
async function getSupa() {
  if (supa) return supa;
  const cfg = await fetch('/api/config').then((r) => r.json());
  supa = createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  return supa;
}
async function api(path, opts = {}, retried = false) {
  const sb = await getSupa();
  const { data } = await sb.auth.getSession();
  const r = await fetch(path, {
    ...opts,
    signal: opts.signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token || ''}`, ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  // The server cut off a stuck request and opened fresh connections: try a read again once, straight away
  if (r.status === 503 && j.retry && !retried && !opts.body && !opts.signal?.aborted) return api(path, opts, true);
  if (r.status === 401) { window.dispatchEvent(new Event('signed-out')); }
  if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong. Try again.'), { status: r.status });
  return j;
}

// ── App shell ───────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(undefined);
  const isPhone = window.location.pathname.startsWith('/phone');
  const isTv = window.location.pathname.startsWith('/tv');

  // Picks up new releases by itself: every minute it checks whether the site has been redeployed, and reloads
  // as soon as nothing is open (no call, panel or pop-up), so no one is left on an old version.
  useEffect(() => {
    const mine = [...document.scripts].map((x) => x.src).find((x) => /\/assets\/index-[^/]+\.js/.test(x));
    if (!mine) return;
    let newer = false;
    const check = async () => {
      try {
        if (!newer) {
          const html = await (await fetch('/?v=' + Date.now(), { cache: 'no-store' })).text();
          const live = (html.match(/\/assets\/index-[^"']+\.js/) || [])[0];
          newer = !!live && !mine.endsWith(live);
        }
        const busy = document.querySelector('.modal,.panel,.co-cover,textarea:focus,input:focus');
        if (newer && !busy) window.location.reload();
      } catch {}
    };
    const t = setInterval(check, 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let off;
    getSupa().then((sb) => {
      sb.auth.getSession().then(({ data }) => setSession(data.session));
      off = sb.auth.onAuthStateChange((_e, s) => setSession(s)).data.subscription;
    });
    const out = () => getSupa().then((sb) => sb.auth.signOut());
    window.addEventListener('signed-out', out);
    return () => { off?.unsubscribe(); window.removeEventListener('signed-out', out); };
  }, []);

  return (
    <>
      <style>{CSS}</style>
      {session === undefined ? null : !session ? <Login /> : isPhone ? <PhoneScreen /> : isTv ? <TvScreen /> : <Desk />}
    </>
  );
}

function Login() {
  const [mode, setMode] = useState('in'); // 'in' = sign in, 'new' = first time, set a password
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const switchTo = (m) => { setMode(m); setErr(''); setPassword(''); setConfirm(''); };
  async function submit(e) {
    e.preventDefault();
    setErr('');
    if (mode === 'new') {
      if (password.length < 8) return setErr('Use at least 8 characters for your password.');
      if (password !== confirm) return setErr('The two passwords don\'t match.');
    }
    setBusy(true);
    try {
      if (mode === 'new') {
        const r = await fetch('/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) { setErr(j.error || 'Something went wrong. Try again.'); setBusy(false); return; }
      }
      const sb = await getSupa();
      const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      if (error) setErr(mode === 'new' ? 'Your password is set. Sign in with it now.' : 'Email or password is wrong.');
      if (error && mode === 'new') switchTo('in');
    } catch { setErr('Something went wrong. Try again.'); }
    setBusy(false);
  }
  return (
    <main className="login">
      <h1>Apex Owner Desk</h1>
      <p className="muted">{mode === 'in' ? 'Sign in with your Apex account.' : 'First time here? Enter your work email and choose a password.'}</p>
      <form onSubmit={submit}>
        <input id="email" type="email" autoComplete="username" placeholder="Work email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input id="password" type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} placeholder={mode === 'in' ? 'Password' : 'Choose a password (8+ characters)'}
          value={password} onChange={(e) => setPassword(e.target.value)} required />
        {mode === 'new' && <input id="confirm" type="password" autoComplete="new-password" placeholder="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />}
        {err && <span className="err">{err}</span>}
        <button className="btn primary" disabled={busy} type="submit">{busy ? (mode === 'in' ? 'Signing in…' : 'Setting up…') : mode === 'in' ? 'Sign in' : 'Set password and sign in'}</button>
      </form>
      <p className="login-alt">{mode === 'in'
        ? <>First time here? <button className="link" type="button" onClick={() => switchTo('new')}>Set your password</button></>
        : <>Already set up? <button className="link" type="button" onClick={() => switchTo('in')}>Sign in</button></>}</p>
    </main>
  );
}

function ThemeToggle() {
  const [mode, setMode] = useState(() => { try { return localStorage.getItem('theme') || 'system'; } catch { return 'system'; } });
  const pick = (m) => {
    setMode(m);
    try { localStorage.setItem('theme', m); } catch {}
    if (m === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', m);
  };
  return (
    <span className="theme" role="group" aria-label="Theme">
      {[['light', 'Light'], ['dark', 'Dark'], ['system', 'Auto']].map(([m, l]) => (
        <button key={m} type="button" aria-pressed={mode === m} onClick={() => pick(m)}>{l}</button>
      ))}
    </span>
  );
}

// ── Laptop: owner list, unit panel, activity ────────────────────────────────
const EMPTY = { q: '', area: [], sc: [], bld: [], st: [], exp: '', from: '', to: '', type: [], beds: [], smin: '', smax: '', umin: '', umax: '', useries: '', uletter: '', rmin: '', rmax: '', pmin: '', pmax: '',
  first: false, ren2: false, up: false, down: false, port: false, mort: false, ind: false, phone: false,
  ncall: false, called: false, oc: [], free: true, tone: '' };

// Older saved views stored one area/cluster/building as text; these are now lists
function normF(f) {
  const n = { ...EMPTY, ...(f || {}) };
  for (const k of ['area', 'sc', 'bld']) n[k] = Array.isArray(n[k]) ? n[k] : n[k] ? [n[k]] : [];
  return n;
}

function toParams(f, tab, sort, page) {
  const p = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => {
    if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
    else if (v === true) p.set(k, '1');
    else if (v) p.set(k, v);
  });
  p.set('tab', tab); p.set('sort', sort); p.set('page', String(page));
  return p;
}

function Desk() {
  const [view, setView] = useState('owners');
  // Owners page: call from the owner data or from the lead pool (remembered in this browser)
  const [src, setSrcState] = useState(() => { try { return localStorage.getItem('callSource') === 'leads' ? 'leads' : 'owners'; } catch { return 'owners'; } });
  const setSrc = (v) => { setSrcState(v); try { localStorage.setItem('callSource', v); } catch {} };
  const [me, setMe] = useState(null);
  const [toast, setToast] = useState('');
  const [unitId, setUnitId] = useState(null);
  // The Owners page fills the screen under this header; keep its height in a CSS variable
  const headerRef = useRef(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--toph', el.offsetHeight + 'px');
    set();
    const ro = new ResizeObserver(set); ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const refreshMe = useCallback(() => api('/api/desk?action=me').then(setMe).catch((e) => setToast(e.message)), []);
  // A number was copied: update the counters in the header
  useEffect(() => { const f = () => refreshMe(); window.addEventListener('desk:caps', f); return () => window.removeEventListener('desk:caps', f); }, [refreshMe]);
  const savePrefs = useCallback(async (prefs) => {
    try { await api('/api/desk?action=savePrefs', { method: 'POST', body: { prefs } }); setMe((m) => ({ ...m, prefs })); setToast('View saved. The Owners page will open like this every time.'); }
    catch (e) { setToast(e.message); }
  }, []);
  useEffect(() => {
    refreshMe();
    // Keeps the call target fresh (calls are dialled on the phone); only while this tab is on screen
    const t = setInterval(() => { if (document.visibilityState === 'visible') refreshMe(); }, 60000);
    return () => clearInterval(t);
  }, [refreshMe]);

  // Call out mode: polled so every screen switches together (every 4s while one runs, every 15s otherwise)
  const [co, setCo] = useState(null);
  const [startOpen, setStartOpen] = useState(false);
  const [msgFor, setMsgFor] = useState(null); // 'me' or a user id (admins) for the WhatsApp messages editor
  const [, setTick] = useState(0);
  const loadCo = useCallback(() => api('/api/desk?action=callout')
    .then((j) => setCo({ ...j, offset: j.callout ? new Date(j.callout.serverNow).getTime() - Date.now() : 0 })).catch(() => {}), []);
  const phase = calloutPhase(co);
  useEffect(() => {
    loadCo();
    const fast = phase === 'countdown' || phase === 'live';
    const t = setInterval(() => { if (document.visibilityState === 'visible') loadCo(); }, fast ? 8000 : 20000);
    return () => clearInterval(t);
  }, [loadCo, phase]);
  useEffect(() => {
    if (phase !== 'countdown' && phase !== 'live') return;
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);
  const [seenTick, setSeenTick] = useState(0);
  const resultsSeen = co?.callout ? (() => { try { return localStorage.getItem('callout-seen-' + co.callout.id) === '1'; } catch { return false; } })() : true;
  const closeResults = () => { try { localStorage.setItem('callout-seen-' + co.callout.id, '1'); } catch {} setSeenTick(seenTick + 1); };
  const boss = me && me.staff.role !== 'broker';
  // Managers, directors and admins always see a running call out (to watch it), even when it's for other teams
  const calloutOn = phase === 'live' && (co?.meIn || boss);

  // Copy protection: blocks copying owner data and logs the attempt
  useEffect(() => {
    const onCopy = (e) => {
      if (e.target?.closest?.('input,textarea')) return;
      e.preventDefault();
      setToast('Copying is turned off. This was logged.');
      api('/api/desk?action=copyBlocked', { method: 'POST' }).catch(() => {});
    };
    const onMenu = (e) => { if (e.target?.closest?.('.tw,.panel')) e.preventDefault(); };
    document.addEventListener('copy', onCopy);
    document.addEventListener('contextmenu', onMenu);
    return () => { document.removeEventListener('copy', onCopy); document.removeEventListener('contextmenu', onMenu); };
  }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2600); return () => clearTimeout(t); }, [toast]);

  return (
    <>
      <header className="top" ref={headerRef}>
        <div className="bar gut">
          <span className="brand">Apex Owner Desk</span>
          <nav className="nav">
            <button className={view === 'owners' ? 'on' : ''} onClick={() => setView('owners')}>Owners</button>
            <button className={view === 'lookup' ? 'on' : ''} onClick={() => setView('lookup')}>Lookup</button>
            {me && <button className={view === 'dash' ? 'on' : ''} onClick={() => setView('dash')}>Dashboard</button>}
            <button className={view === 'activity' ? 'on' : ''} onClick={() => setView('activity')}>Activity</button>
            {me && ['admin', 'director'].includes(me.staff.role) && <button className={view === 'team' ? 'on' : ''} onClick={() => setView('team')}>Team</button>}
            <a className="link" style={{ color: 'var(--muted)' }} href="/phone">Phone</a>
          </nav>
          {boss && (phase === 'live' || phase === 'countdown') && <span className="co-pill"><i />{co?.callout?.test ? 'Test running' : 'Call out running'}</span>}
          {boss && <button className="co-start" onClick={() => setStartOpen(true)}>{(phase === 'live' || phase === 'countdown') && !co?.callout?.test ? 'Test mode' : 'Start call out'}</button>}
          {boss && <a className="co-tv" href="/tv" target="apex-tv" title="Open the big screen for the office TV">TV screen</a>}
          <div className="right">
            {me?.caps && <span title="Owner profiles opened today">Profiles <span className="n">{me.caps.profiles}</span></span>}
            {me?.caps && <span>Calls <span className="n">{me.caps.calls}</span></span>}
            {me?.caps && me.caps.copies != null && <span title="Numbers copied today">Numbers <span className="n">{me.caps.copies}</span></span>}
            <ThemeToggle />
            {me && <button className="link" onClick={() => setMsgFor('me')}>My messages</button>}
            {me && <span>{me.staff.name}</span>}
            <button className="link" onClick={() => getSupa().then((sb) => sb.auth.signOut())}>Sign out</button>
          </div>
        </div>
      </header>
      {view === 'owners' && me && src === 'leads' ? <LeadPool me={me} switcher={<SourceSwitch v={src} onChange={setSrc} />} banner={calloutOn ? <CalloutBar co={co} boss={boss} onChange={loadCo} /> : null} onCaps={refreshMe} />
        : view === 'owners' ? (me ? <Owners switcher={<SourceSwitch v={src} onChange={setSrc} />} keepKey={'ownersNow:' + me.staff.email} rocket={!!me.rocket} banner={calloutOn ? <CalloutBar co={co} boss={boss} onChange={loadCo} /> : null} places={me.places || []} target={me.target} prefs={me.prefs} onSavePrefs={savePrefs} canOverride={me.staff.role !== 'broker'} onCaps={refreshMe} onOpen={setUnitId} /> : <div className="gut muted" style={{ padding: 40 }}>Loading…</div>) : view === 'lookup' ? <Lookup onOpen={setUnitId} /> : view === 'dash' ? <DashPage role={me?.staff.role} /> : view === 'team' ? <Team myRole={me?.staff.role} onMessages={setMsgFor} /> : <Activity />}
      {unitId && <UnitPanel id={unitId} canOverride={me && me.staff.role !== 'broker'} onClose={() => setUnitId(null)} onOpen={setUnitId} onCaps={refreshMe} />}
      {phase === 'countdown' && co?.meIn && <CalloutCountdown co={co} />}
      {phase === 'done' && (co?.meIn || boss) && !resultsSeen && <CalloutResults co={co} onClose={closeResults} />}
      {msgFor && <MessagesEditor user={msgFor === 'me' ? null : msgFor} onClose={() => setMsgFor(null)} />}
      {startOpen && <StartCallout testReady={!!co?.features?.test} realRunning={(phase === 'live' || phase === 'countdown') && !co?.callout?.test} onClose={() => setStartOpen(false)} onStarted={() => { setStartOpen(false); loadCo(); }} />}
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

function Owners({ places, onOpen, target, onCaps, canOverride, prefs, onSavePrefs, banner, keepKey, rocket, switcher }) {
  const [rocketOpen, setRocketOpen] = useState(false);
  // Start where this person left off (filters, tab and sort survive a refresh), otherwise from their saved view
  const start = useRef((() => {
    let last = null;
    try { last = JSON.parse(localStorage.getItem(keepKey) || 'null'); } catch {}
    const ok = last && typeof last === 'object' && last.f && typeof last.f === 'object';
    return {
      f: normF(ok ? last.f : prefs?.f),
      tab: (ok && TABS.some(([k]) => k === last.tab) ? last.tab : prefs?.tab) || 'all',
      sort: (ok && typeof last.sort === 'string' ? last.sort : prefs?.sort) || 'unit',
      cols: (prefs?.cols || []).filter((k) => COLUMNS.some((c) => c.k === k)), side: prefs?.side !== false,
    };
  })()).current;
  const [f, setF] = useState(start.f);
  const [tab, setTab] = useState(start.tab);
  const [sort, setSort] = useState(start.sort);
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [rows, setRows] = useState([]);
  const [moreBusy, setMoreBusy] = useState(false);
  const [side, setSide] = useState(start.side);
  const tw = useRef(null);
  const sentinel = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const ctl = useRef(null);
  const timer = useRef(null);
  const [calling, setCalling] = useState(null);
  const [cols, setColsState] = useState(() => (start.cols.length ? start.cols : loadCols()));
  const [widths, setWidthsState] = useState(() => ({ ...loadWidths(), ...(prefs?.widths || {}) }));
  const setWidths = (w) => { setWidthsState(w); try { localStorage.setItem('colWidths', JSON.stringify(w)); } catch {} };
  const wOf = (k) => { const w = widths[k] || COL_W[k] || 130; return k === 'note' ? Math.max(200, w) : w; };
  // Drag the right edge of a heading to resize; double-click it to reset
  const resizing = useRef(null);
  const startResize = (k, e) => {
    e.preventDefault(); e.stopPropagation();
    const x0 = e.clientX, w0 = wOf(k);
    resizing.current = k;
    let last = w0;
    const move = (ev) => { last = Math.max(k === 'note' ? 200 : 60, Math.min(600, Math.round(w0 + ev.clientX - x0))); setWidthsState((w) => ({ ...w, [k]: last })); };
    const up = () => {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
      document.body.classList.remove('col-resizing');
      setWidthsState((w) => { const n = { ...w, [k]: last }; try { localStorage.setItem('colWidths', JSON.stringify(n)); } catch {} return n; });
      setTimeout(() => { resizing.current = null; }, 0);
    };
    document.body.classList.add('col-resizing');
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  };
  const resetWidth = (k) => { const n = { ...widths }; delete n[k]; setWidths(n); };
  const setCols = (next) => { setColsState(next); try { localStorage.setItem('columns', JSON.stringify(next)); } catch {} };
  const shown = cols.map((k) => COLUMNS.find((c) => c.k === k)).filter(Boolean);
  // Drag a column heading onto another to move it
  const [dragCol, setDragCol] = useState(null);
  const [overCol, setOverCol] = useState(null);
  const moveCol = (from, to) => {
    if (!from || from === to) return;
    const rest = cols.filter((k) => k !== from);
    const i = rest.indexOf(to);
    const after = cols.indexOf(from) < cols.indexOf(to);
    rest.splice(i + (after ? 1 : 0), 0, from);
    setCols(rest);
  };

  // Ask the server for the list. Typed fields wait for a short pause; everything else is instant.
  const load = useCallback((ff, t, s, p) => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setBusy(true);
    api('/api/desk?action=units&' + toParams(ff, t, s, p).toString(), { signal: c.signal })
      .then((j) => { setData(j); setRows(j.rows); setPage(1); setErr(''); if (tw.current) tw.current.scrollTop = 0; })
      .catch((e) => { if (e.name !== 'AbortError') setErr(e.message); })
      .finally(() => { if (ctl.current === c) setBusy(false); });
  }, []);
  useEffect(() => { load(start.f, start.tab, start.sort, 1); }, [load, start]);
  // Remember the filters, tab and sort in this browser so a refresh (or an update reload) keeps them
  useEffect(() => { try { localStorage.setItem(keepKey, JSON.stringify({ f, tab, sort })); } catch {} }, [keepKey, f, tab, sort]);

  // After a call, update just that unit's row and the tab counts, so the page stays exactly where it was
  const refreshRow = useCallback((id) => {
    api('/api/desk?action=units&only=' + id + '&' + toParams(f, tab, sort, 1).toString())
      .then((j) => {
        const nr = j.rows?.[0];
        if (nr) setRows((rs) => rs.map((x) => (x.id === id ? nr : x)));
        if (j.counts) setData((d) => (d ? { ...d, counts: j.counts } : d));
      })
      .catch(() => {});
  }, [f, tab, sort]);

  // Keep scrolling: the next 100 load in the background as you near the bottom of the list
  const loadMore = useCallback(() => {
    if (moreBusy || busy || !data) return;
    const total = (data.counts || {})[tab] ?? 0;
    if (rows.length >= total) return;
    const next = page + 1;
    setMoreBusy(true);
    const c = ctl.current;
    api('/api/desk?action=units&more=1&' + toParams(f, tab, sort, next).toString())
      .then((j) => { if (ctl.current !== c) return; setRows((r) => [...r, ...j.rows.filter((x) => !r.some((y) => y.id === x.id))]); setPage(next); })
      .catch((e) => setErr(e.message))
      .finally(() => setMoreBusy(false));
  }, [moreBusy, busy, data, rows.length, page, f, tab, sort]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) loadMore(); }, { root: tw.current, rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  const change = (patch, typed) => {
    const nf = { ...f, ...patch };
    setF(nf); setPage(1);
    clearTimeout(timer.current);
    if (typed) timer.current = setTimeout(() => load(nf, tab, sort, 1), 300);
    else load(nf, tab, sort, 1);
  };
  const toggle = (k, v) => change({ [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] });
  const goTab = (t) => { setTab(t); setPage(1); load(f, t, sort, 1); };
  const goSort = (s) => { setSort(s); setPage(1); load(f, tab, s, 1); };
  // Saved view: compare what's on screen with what was saved
  const snap = { f, tab, sort, cols, side, widths };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const savedSnap = prefs ? { f: normF(prefs.f), tab: prefs.tab || 'all', sort: prefs.sort || 'unit', cols: prefs.cols || cols, side: prefs.side !== false, widths: prefs.widths || {} } : null;
  const isSaved = savedSnap && same(snap, savedSnap);
  const [savingView, setSavingView] = useState(false);
  const saveView = async () => { setSavingView(true); try { await onSavePrefs(snap); } finally { setSavingView(false); } };
  const backToSaved = () => { setF(savedSnap.f); setTab(savedSnap.tab); setSort(savedSnap.sort); setCols(savedSnap.cols); setSide(savedSnap.side); setWidths(savedSnap.widths); load(savedSnap.f, savedSnap.tab, savedSnap.sort, 1); };
  const activeFilters = Object.keys(EMPTY).filter((k) => k !== 'free' && (Array.isArray(f[k]) ? f[k].length : !!f[k])).length;

  const areas = useMemo(() => [...new Set(places.map((p) => p.area))], [places]);
  const inArea = useMemo(() => places.filter((p) => !f.area.length || f.area.includes(p.area)), [places, f.area]);
  const subcommunities = useMemo(() => [...new Set(inArea.map((p) => p.sc))], [inArea]);
  const buildings = useMemo(() => [...new Set(inArea.filter((p) => p.bld && (!f.sc.length || f.sc.includes(p.sc))).map((p) => p.bld))], [inArea, f.sc]);
  // Picking areas/clusters keeps only the clusters/buildings that still belong to them
  const setPlace = (k, list) => {
    const patch = { [k]: list };
    if (k === 'area') {
      const ok = places.filter((p) => !list.length || list.includes(p.area));
      patch.sc = f.sc.filter((x) => ok.some((p) => p.sc === x));
      patch.bld = f.bld.filter((x) => ok.some((p) => p.bld === x && (!patch.sc.length || patch.sc.includes(p.sc))));
    }
    if (k === 'sc') patch.bld = f.bld.filter((x) => inArea.some((p) => p.bld === x && (!list.length || list.includes(p.sc))));
    change(patch);
  };
  const c = data?.counts || {};
  const total = c[tab] ?? 0;


  // Plain render helpers (not components) so inputs keep focus while typing
  const box = (k, v, label) => (
    <label className="cb" key={k + v}><input type="checkbox" checked={f[k].includes(v)} onChange={() => toggle(k, v)} />{label ?? v}</label>
  );
  const flag = (k, label) => (
    <label className="cb" key={k}><input type="checkbox" checked={f[k]} onChange={(e) => change({ [k]: e.target.checked })} />{label}</label>
  );
  const num = (k, ph) => (
    <input key={k} type="number" inputMode="numeric" placeholder={ph} value={f[k]} onChange={(e) => change({ [k]: e.target.value }, true)} />
  );
  // Filters on the column headings. They use the same choices as the side panel, so both always agree.
  const [fcol, setFcol] = useState(null); // { k, x, y } of the open heading filter
  useEffect(() => {
    if (!fcol) return;
    const close = (e) => { if (!e.target.closest?.('.hf,.fbtn')) setFcol(null); };
    const esc = (e) => e.key === 'Escape' && setFcol(null);
    // Close when the page or table scrolls, but not when scrolling inside the filter box itself
    const gone = (e) => { if (e.target instanceof Element && e.target.closest('.hf')) return; setFcol(null); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    window.addEventListener('scroll', gone, true); window.addEventListener('resize', gone);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', gone, true); window.removeEventListener('resize', gone); };
  }, [fcol]);
  const pick = (k, list) => <CheckList options={list} selected={f[k]} onChange={(v) => setPlace(k, v)} />;
  const ends = () => <>
    {EXPIRY.map(([v, l]) => <label className="cb" key={v}><input type="radio" name="hexp" checked={f.exp === v} onChange={() => change({ exp: v })} />{l}</label>)}
    <div className="pair" style={{ marginTop: 6 }}>
      <input type="date" aria-label="Ends from" value={f.from} onChange={(e) => change({ from: e.target.value })} />
      <input type="date" aria-label="Ends to" value={f.to} onChange={(e) => change({ to: e.target.value })} />
    </div></>;
  const unitNums = (side) => <div className="unums">
    {!side && <span className="lbl">Unit number</span>}
    <div className="pair">{num('umin', 'From')}{num('umax', 'To')}</div>
    <div className="pair ulx">
      <label><span className="lbl">Letter</span>
        <input type="text" maxLength={3} placeholder="e.g. J" value={f.uletter} aria-label="Letter before the unit number"
          onChange={(e) => change({ uletter: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') }, true)} /></label>
      <label><span className="lbl">Series</span>
        <input type="text" inputMode="numeric" maxLength={4} placeholder="e.g. 02" value={f.useries} aria-label="Unit series, e.g. 02 for 102, 202, 302"
          onChange={(e) => change({ useries: e.target.value.replace(/\D/g, '') }, true)} /></label>
    </div>
  </div>;
  const search = () => <input type="search" autoFocus placeholder="Search owner, building or unit" value={f.q} onChange={(e) => change({ q: e.target.value }, true)} />;
  const HEAD_FILTERS = {
    unit: { on: ['q', 'umin', 'umax', 'useries', 'uletter'], ui: () => <>{search()}{unitNums()}</> },
    place: { on: ['bld'], ui: () => pick('bld', buildings) },
    sc: { on: ['sc'], ui: () => pick('sc', subcommunities) },
    area: { on: ['area'], ui: () => pick('area', areas) },
    type: { on: ['type'], ui: () => <>{box('type', 'Apartment')}{box('type', 'Villa')}</> },
    beds: { on: ['beds'], ui: () => <div className="cols">{BEDS.map((b) => box('beds', b, bedsLabel(b)))}</div> },
    size: { on: ['smin', 'smax'], ui: () => <div className="pair">{num('smin', 'Min')}{num('smax', 'Max')}</div> },
    lease: { on: ['st'], ui: () => ['Live Ejari', 'No live Ejari', 'Not confirmed'].map((v) => box('st', v)) },
    renewals: { on: ['first', 'ren2'], ui: () => <>{flag('first', 'First year (no renewals)')}{flag('ren2', 'Renewed 2+ times')}</> },
    ends: { on: ['exp', 'from', 'to'], ui: ends },
    days: { on: ['exp', 'from', 'to'], ui: ends },
    rent: { on: ['rmin', 'rmax'], ui: () => <div className="pair">{num('rmin', 'Min')}{num('rmax', 'Max')}</div> },
    change: { on: ['up', 'down'], ui: () => <>{flag('up', 'Rent went up')}{flag('down', 'Rent went down')}</> },
    sale: { on: ['pmin', 'pmax'], ui: () => <div className="pair">{num('pmin', 'Min')}{num('pmax', 'Max')}</div> },
    owner: { on: ['q', 'ind'], ui: () => <>{search()}<div style={{ marginTop: 8 }}>{flag('ind', 'Individuals only')}</div></> },
    mobile: { on: ['phone'], ui: () => flag('phone', 'Has a mobile number') },
    owned: { on: ['port'], ui: () => flag('port', 'Owns 2+ units here') },
    mortgaged: { on: ['mort'], ui: () => flag('mort', 'Mortgaged') },
    lastcall: { on: ['ncall', 'called'], ui: () => <>{flag('ncall', 'Never called')}{flag('called', 'Called before')}{flag('free', 'Hide owners others are working')}</> },
    outcome: { on: ['oc'], ui: () => OUTCOMES.map((o) => box('oc', o)) },
    note: { on: ['tone'], ui: () => <div className="tonepick">
      {[['', 'All notes'], ['hot', 'Green · positive'], ['cold', 'Red · negative']].map(([v, l]) => (
        <label className={'cb' + (v ? ' ' + v : '')} key={v || 'all'}><input type="radio" name="htone" checked={f.tone === v} onChange={() => change({ tone: v })} />{v && <i className="nd" />}{l}</label>))}
      <span className="muted small">Goes by the latest note on each unit</span></div> },
  };
  const isOn = (keys) => keys.some((k) => (Array.isArray(f[k]) ? f[k].length > 0 : !!f[k]));
  const clearKeys = (keys) => change(Object.fromEntries(keys.map((k) => [k, EMPTY[k]])));
  const openHead = (k, e) => {
    if (fcol?.k === k) return setFcol(null);
    const r = e.currentTarget.getBoundingClientRect();
    setFcol({ k, x: Math.max(8, Math.min(r.left, window.innerWidth - 268)), y: r.bottom + 6 });
  };

  const sortBtn = (k, label) => <button className={sort === k ? 'on' : ''} onClick={() => goSort(k)}>{label}{sort === k ? ' ↓' : ''}</button>;

  return (
    <>
      <div className="owners-page">
      {busy && <div className="loadbar" />}
      {banner || (target && <TargetBar t={target} onTarget={onCaps} />)}
      <div className="head gut">
        <div className="head-row"><h1>Owners</h1>{switcher}<TodayActionsButton /></div>
        <p>{fmt(c.all)} units in your areas · {DATA_NOTE}</p>
      </div>
      <main className={'layout gut' + (side ? '' : ' noside')}>
        {side && <aside className="filters">
          <button className="hide-side" onClick={() => setSide(false)} title="Hide filters to see the whole table">‹ Hide filters</button>
          <div><input id="q" type="search" placeholder="Search owner, building or unit" value={f.q} autoComplete="off" onChange={(e) => change({ q: e.target.value }, true)} /></div>
          {areas.length > 1 && <MultiSelect label="Area" options={areas} selected={f.area} onChange={(v) => setPlace('area', v)} />}
          <MultiSelect label="Sub-community" options={subcommunities} selected={f.sc} onChange={(v) => setPlace('sc', v)} />
          <MultiSelect label="Building" options={buildings} selected={f.bld} onChange={(v) => setPlace('bld', v)} />
          <Section title="Lease" on={f.st.length}>{['Live Ejari', 'No live Ejari', 'Not confirmed'].map((v) => box('st', v))}</Section>
          <Section title="Contract ends" on={f.exp || f.from || f.to}>
            {EXPIRY.map(([v, l]) => <label className="cb" key={v}><input type="radio" name="exp" checked={f.exp === v} onChange={() => change({ exp: v })} />{l}</label>)}
            <div className="pair" style={{ marginTop: 6 }}>
              <input type="date" aria-label="Ends from" value={f.from} onChange={(e) => change({ from: e.target.value })} />
              <input type="date" aria-label="Ends to" value={f.to} onChange={(e) => change({ to: e.target.value })} />
            </div></Section>
          <Section title="Type" on={f.type.length}>{box('type', 'Apartment')}{box('type', 'Villa')}</Section>
          <Section title="Beds" on={f.beds.length}><div className="cols">{BEDS.map((b) => box('beds', b, bedsLabel(b)))}</div></Section>
          <Section title="Unit number" on={f.umin || f.umax || f.useries || f.uletter}>{unitNums(true)}</Section>
          <Section title="Size, sq ft" on={f.smin || f.smax}><div className="pair">{num('smin', 'Min')}{num('smax', 'Max')}</div></Section>
          <Section title="Rent, AED a year" on={f.rmin || f.rmax}><div className="pair">{num('rmin', 'Min')}{num('rmax', 'Max')}</div></Section>
          <Section title="Tenancy" on={f.first || f.ren2 || f.up || f.down}>{flag('first', 'First year (no renewals)')}{flag('ren2', 'Renewed 2+ times')}{flag('up', 'Rent went up')}{flag('down', 'Rent went down')}</Section>
          <Section title="Last sale price, AED" on={f.pmin || f.pmax}><div className="pair">{num('pmin', 'Min')}{num('pmax', 'Max')}</div></Section>
          <Section title="Owner" on={f.port || f.mort || f.ind || f.phone}>{flag('port', 'Owns 2+ units here')}{flag('mort', 'Mortgaged')}{flag('ind', 'Individuals only')}{flag('phone', 'Has a mobile number')}</Section>
          <Section title="Calls" open on={f.ncall || f.called}>{flag('free', 'Hide owners others are working')}{flag('ncall', 'Never called')}{flag('called', 'Called before')}</Section>
          <button className="link" style={{ textAlign: 'left' }} onClick={() => { setF(EMPTY); load(EMPTY, tab, sort, 1); }}>Clear filters</button>
        </aside>}

        <section className="listcol">
          <nav className="tabs">
            {TABS.map(([k, l]) => <button key={k} className={'tab' + (tab === k ? ' on' : '') + ((k === 'callbacks' || k === 'reports' || (k === 'monthly' && monthStart())) && c[k] ? ' due' : '')}
              title={k === 'callbacks' ? 'Owners whose last call this week got no answer. Work through them on Friday.'
                : k === 'monthly' ? 'Owners who asked for a market report every month. Send them at the start of each month.' : undefined}
              onClick={() => goTab(k)}>{l}<span className="c n">{fmt(c[k])}</span></button>)}
          </nav>
          <div className="meta">
            <span className="meta-l">
              {!side && <button className="btn show-side" onClick={() => setSide(true)}>☰ Filters{activeFilters ? ` · ${activeFilters} on` : ''}</button>}
              <span>{fmt(total)} units{total > rows.length ? ` · showing ${fmt(rows.length)}` : ''}</span>
            </span>
            <span className="meta-r">
              {savedSnap && !isSaved && <button className="link" onClick={backToSaved}>Back to my saved view</button>}
              <button className={'btn' + (isSaved ? ' saved' : '')} disabled={isSaved || savingView} onClick={saveView}
                title="Opens the Owners page with these filters, tab, sort and columns every time">{isSaved ? '✓ View saved' : savingView ? 'Saving…' : 'Save view'}</button>
              {rocket && <button className="btn" onClick={() => setRocketOpen(true)} title="Send one WhatsApp to the owners in this list, from your own WhatsApp">WhatsApp rocket</button>}
              <ColumnPicker cols={cols} setCols={setCols} />
            </span>
          </div>
          {rocketOpen && <Rocket params={toParams(f, tab, sort, 1).toString()} total={total} onClose={() => setRocketOpen(false)} />}
          {err && <p className="err">{err}</p>}
          <div className={'tw' + (busy ? ' busy' : '')} ref={tw}>
            <table className="grid fixed" style={{ width: shown.reduce((a, c) => a + wOf(c.k), canOverride ? 180 : 130) }}>
              <thead><tr>
                {shown.map((col) => {
                  const hf = HEAD_FILTERS[col.k];
                  const on = hf && isOn(hf.on);
                  return (
                    <th key={col.k} className={(col.right ? 'r' : '') + (overCol === col.k && dragCol && dragCol !== col.k ? ' dropto' : '') + (dragCol === col.k ? ' dragging' : '')}
                      draggable title="Drag to move this column" style={{ width: wOf(col.k) }}
                      onDragStart={(e) => { if (resizing.current) { e.preventDefault(); return; } setDragCol(col.k); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', col.k); }}
                      onDragOver={(e) => { e.preventDefault(); if (overCol !== col.k) setOverCol(col.k); }}
                      onDragLeave={() => setOverCol((o) => (o === col.k ? null : o))}
                      onDrop={(e) => { e.preventDefault(); moveCol(dragCol, col.k); setDragCol(null); setOverCol(null); }}
                      onDragEnd={() => { setDragCol(null); setOverCol(null); }}>
                      <span className="th">
                        {col.sort ? sortBtn(col.sort, col.label) : col.label}
                        {hf && <button className={'fbtn' + (on ? ' on' : '') + (fcol?.k === col.k ? ' open' : '')} aria-label={'Filter ' + col.label}
                          title={'Filter ' + col.label} onClick={(e) => openHead(col.k, e)}>
                          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 2.5h9L7 6.6v3.2l-2 .9V6.6z" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" /></svg>
                        </button>}
                      </span>
                      <span className="rz" title="Drag to resize · double-click to reset" draggable={false}
                        onMouseDown={(e) => startResize(col.k, e)} onDoubleClick={(e) => { e.stopPropagation(); resetWidth(col.k); }} onClick={(e) => e.stopPropagation()} />
                    </th>
                  );
                })}
                <th className="callcol" aria-label="Call" style={{ width: canOverride ? 180 : 130 }} />
              </tr></thead>
              <tbody>
                {data && rows.length === 0 && <tr><td colSpan={shown.length + 1} className="empty">Nothing matches. Try clearing a filter.</td></tr>}
                {rows.map((r) => <OwnerRow key={r.id} r={r} cols={shown} onOpen={onOpen} onCall={setCalling} canOverride={canOverride} />)}
              </tbody>
            </table>
            <div ref={sentinel} className="more">{moreBusy ? 'Loading more…' : data && rows.length >= total && rows.length > 0 ? `All ${fmt(total)} units shown` : ''}</div>
          </div>
          {fcol && HEAD_FILTERS[fcol.k] && (
            <div className="hf" style={{ left: fcol.x, top: fcol.y }} role="dialog" aria-label="Column filter">
              <div className="hf-h"><b>{COLUMNS.find((c) => c.k === fcol.k)?.label}</b>
                {isOn(HEAD_FILTERS[fcol.k].on) && <button className="link" onClick={() => clearKeys(HEAD_FILTERS[fcol.k].on)}>Clear</button>}</div>
              <div className="hf-b">{HEAD_FILTERS[fcol.k].ui()}</div>
            </div>
          )}

        </section>
      </main>
      </div>
      {calling && <CallFlow unitId={calling.r.id} owner={{ id: (calling.owner || {}).id ?? calling.r.owner_id, name: (calling.owner || {}).name ?? calling.r.owner_name }} force={!!calling.force}
        label={`${(calling.owner || {}).name ?? calling.r.owner_name}, ${placeOf(calling.r)} ${calling.r.unit_no}`}
        onClose={(saved) => { const id = calling.r.id; setCalling(null); onCaps(); if (saved) refreshRow(id); }} />}
    </>
  );
}

// ── Today's actions: call-backs due today or overdue ─────────────────────────
function TodayActionsButton() {
  const [n, setN] = useState(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => api('/api/desk?action=actions&count=1').then((j) => setN(j.due)).catch(() => {}), []);
  useEffect(() => { load(); const t = setInterval(() => document.visibilityState === 'visible' && load(), 120000); return () => clearInterval(t); }, [load]);
  return (<>
    <button className={'todaybtn' + (n ? ' due' : '')} onClick={() => setOpen(true)} title="Call-backs due today">Today&apos;s actions{n != null && <span className="n">{n}</span>}</button>
    {open && <TodayActions onClose={() => { setOpen(false); load(); }} />}
  </>);
}
function TodayActions({ onClose }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [calling, setCalling] = useState(null);
  const [moving, setMoving] = useState(null);
  const load = useCallback(() => api('/api/desk?action=actions').then((j) => { setD(j); setErr(''); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  const done = (id, moveTo) => api('/api/desk?action=followupDone', { method: 'POST', body: moveTo ? { id, moveTo: new Date(moveTo).toISOString() } : { id } })
    .then(() => { setMoving(null); load(); }).catch((e) => setErr(e.message));
  const rows = d?.rows || [];
  const overdue = rows.filter((r) => r.overdue), today = rows.filter((r) => !r.overdue);
  const nameOf = (r) => (r.lead ? (r.lead.name ? titleCase(r.lead.name) : 'Lead') : titleCase(r.owner_name));
  const section = (title, list) => list.length > 0 && (
    <div className="ta-sec"><span className="lbl">{title} · {list.length}</span>
      {list.map((r) => (
        <div key={r.id} className={'ta-row' + (r.overdue ? ' late' : '')}>
          <span className="ta-when n">{new Date(r.due_at).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', ...(r.overdue ? { day: 'numeric', month: 'short' } : {}), hour: '2-digit', minute: '2-digit' })}</span>
          <div className="ta-who"><b>{nameOf(r)}</b><span className="muted">{phonePlace(r)}</span>
            {r.last_note && <NoteTag text={r.last_note} clip />}</div>
          <div className="ta-acts">
            {r.hold ? <HoldChip h={r.hold} /> : r.has_phone && <button className="btn primary" onClick={() => setCalling(r)}>Call</button>}
            <button className="btn" onClick={() => setMoving(moving === r.id ? null : r.id)}>Move</button>
            <button className="btn ghost" onClick={() => done(r.id)} title="Sorted without a call">Done</button>
          </div>
          {moving === r.id && <div className="ta-move"><input type="datetime-local" defaultValue={localInput(new Date(Date.now() + 864e5))} min={localInput(new Date())} id={'mv' + r.id} />
            <button className="btn" onClick={() => done(r.id, document.getElementById('mv' + r.id).value)}>Save</button></div>}
        </div>))}
    </div>);
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="box ta-box" role="dialog" aria-label="Today's actions">
        <div className="ta-head"><h3>Today&apos;s actions</h3><button className="link" onClick={onClose}>Close</button></div>
        <p className="muted" style={{ margin: 0 }}>Your call-backs due today and anything overdue.{d ? ` ${d.comingWeek} more due in the next 7 days.` : ''}</p>
        {err && <p className="err">{err}</p>}
        {!d ? <p className="muted">Loading…</p> : rows.length === 0 ? <p className="muted" style={{ padding: '20px 0' }}>Nothing due today. Nice.</p>
          : <div className="ta-list">{section('Overdue', overdue)}{section('Due today', today)}</div>}
      </div>
      {calling && <CallFlow lead={!!calling.lead} unitId={calling.unit_id} owner={{ id: calling.owner_id, name: calling.owner_name }}
        label={`${nameOf(calling)}, ${phonePlace(calling)}`} onClose={() => { setCalling(null); load(); }} />}
    </div>
  );
}

// Owners page switch: call from the owner data, or from the lead pool
function SourceSwitch({ v, onChange }) {
  return (
    <div className="seg srcsw" role="tablist" aria-label="What to call">
      <button className={v === 'owners' ? 'on' : ''} onClick={() => onChange('owners')}>Owners</button>
      <button className={v === 'leads' ? 'on' : ''} onClick={() => onChange('leads')}>Lead pool</button>
    </div>
  );
}

// ── Lead pool ───────────────────────────────────────────────────────────────
// Buyer and tenant enquiries, split evenly and at random so everyone has their own to call. Fixed columns.
const LEAD_TABS_UI = [['todo', 'To call', 'Not called yet'], ['retry', 'Try again', 'No reply, unreachable, line busy or phone off last time'],
  ['hot', 'Hot', 'Still looking, viewing booked, send options, follow up or call back'], ['called', 'Called', 'Called at least once'], ['all', 'All', '']];
const LEAD_SORTS = [['', 'Shuffled'], ['budget_hi', 'Budget, high to low'], ['budget_lo', 'Budget, low to high'], ['recent', 'Last called']];
function LeadPool({ me, switcher, banner, onCaps }) {
  const boss = me.staff.role !== 'broker';
  const keep = 'leadsNow:' + me.staff.email;
  const start = useRef((() => { try { return JSON.parse(localStorage.getItem(keep) || '{}') || {}; } catch { return {}; } })()).current;
  const [tab, setTab] = useState(LEAD_TABS_UI.some(([k]) => k === start.tab) ? start.tab : 'todo');
  const [sort, setSort] = useState(LEAD_SORTS.some(([k]) => k === start.sort) ? start.sort : '');
  const [loc, setLoc] = useState(Array.isArray(start.loc) ? start.loc : []);
  const [who, setWho] = useState(boss && start.who ? start.who : 'me');
  const [q, setQ] = useState('');
  const [d, setD] = useState(null);
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [calling, setCalling] = useState(null);
  const [splitMsg, setSplitMsg] = useState('');
  const ctl = useRef(null);
  const qTimer = useRef(null);
  const [qLive, setQLive] = useState('');
  useEffect(() => { try { localStorage.setItem(keep, JSON.stringify({ tab, sort, loc, who })); } catch {} }, [keep, tab, sort, loc, who]);
  const params = (p) => new URLSearchParams({ action: 'leads', tab, sort, loc: loc.join('|'), q: qLive, who, page: String(p) }).toString();
  const load = useCallback((p = 1) => {
    ctl.current?.abort();
    const c = new AbortController(); ctl.current = c;
    setBusy(true);
    api('/api/desk?' + params(p), { signal: c.signal })
      .then((j) => { setD(j); setRows((r) => (p === 1 ? j.rows : [...r, ...j.rows.filter((x) => !r.some((y) => y.id === x.id))])); setPage(p); setErr(''); })
      .catch((e) => { if (e.name !== 'AbortError') setErr(e.message); })
      .finally(() => { if (ctl.current === c) setBusy(false); });
  }, [tab, sort, loc, qLive, who]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(1); }, [load]);
  const typed = (v) => { setQ(v); clearTimeout(qTimer.current); qTimer.current = setTimeout(() => setQLive(v), 300); };
  const c = d?.counts || {};
  const total = c[tab] ?? 0;
  async function split() {
    if (!window.confirm('Share every lead nobody has called yet evenly and at random between everyone active? Leads someone has already called stay with them.')) return;
    try { const j = await api('/api/desk?action=leadsSplit', { method: 'POST' }); setSplitMsg(`${fmt(j.leads)} uncalled leads shared between ${j.people} people.`); load(1); }
    catch (e) { setSplitMsg(e.message); }
  }
  const mineCount = d?.people?.find((p) => p.user_id === d.me)?.leads;
  return (
    <>
      <div className="owners-page">
        {busy && <div className="loadbar" />}
        {banner || (me.target && <TargetBar t={me.target} onTarget={onCaps} />)}
        <div className="head gut">
          <div className="head-row"><h1>Lead pool</h1>{switcher}<TodayActionsButton /></div>
          <p>{who === 'me' ? `${fmt(c.all)} leads are yours. Nobody else has them.` : who === 'all' ? `${fmt(c.all)} leads across the team` : `${fmt(c.all)} leads`} · Buyer and tenant enquiries from August to October 2026, shuffled</p>
        </div>
        <main className="gut leadpool">
          {d && !d.ready ? <p className="muted" style={{ padding: '30px 0' }}>The lead pool hasn&apos;t been loaded yet.</p> : <>
          <nav className="tabs">
            {LEAD_TABS_UI.map(([k, l, tip]) => <button key={k} title={tip || undefined} className={'tab' + (tab === k ? ' on' : '') + (k === 'retry' && c.retry ? ' due' : '')}
              onClick={() => setTab(k)}>{l}<span className="c n">{fmt(c[k])}</span></button>)}
          </nav>
          <div className="lp-tools">
            <input type="search" placeholder="Search name, location, beds or budget" value={q} onChange={(e) => typed(e.target.value)} />
            <MultiSelect label="Location" options={(d?.locations || []).map((x) => x.name)} selected={loc} onChange={setLoc} />
            <label className="lp-sel"><span className="lbl">Sort</span>
              <select value={sort} onChange={(e) => setSort(e.target.value)}>{LEAD_SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            {boss && <label className="lp-sel"><span className="lbl">Whose leads</span>
              <select value={who} onChange={(e) => setWho(e.target.value)}>
                <option value="me">Mine{mineCount != null ? ` (${mineCount})` : ''}</option>
                <option value="all">Everyone</option>
                {(d?.people || []).filter((p) => p.user_id !== d.me).map((p) => <option key={p.user_id} value={p.user_id}>{p.name} ({p.called}/{p.leads} called)</option>)}
              </select></label>}
            {d?.canSplit && <button className="btn" onClick={split} title="Share the uncalled leads evenly between everyone active, e.g. after someone joins or leaves">Re-split uncalled leads</button>}
          </div>
          {splitMsg && <p className="muted" style={{ margin: '0 0 8px' }}>{splitMsg}</p>}
          {err && <p className="err">{err}</p>}
          <div className={'tw lp-tw' + (busy ? ' busy' : '')}>
            <table className="grid fixed lp-grid">
              <thead><tr>
                <th style={{ width: 200 }}>Name</th><th style={{ width: 230 }}>Looking for</th><th className="r" style={{ width: 170 }}>Budget (AED)</th>
                <th style={{ width: 160 }}>Mobile</th><th style={{ width: 115 }}>Last called</th>
                {who !== 'me' && <th style={{ width: 150 }}>Given to</th>}
                <th style={{ width: 340 }}>Notes</th><th className="callcol" style={{ width: boss ? 180 : 110 }} aria-label="Call" />
              </tr></thead>
              <tbody>
                {d && rows.length === 0 && <tr><td colSpan={who !== 'me' ? 8 : 7} className="empty">
                  {tab === 'todo' && !q && !loc.length ? 'You\'ve called every lead you were given. Nice work.' : 'Nothing here. Try another tab or clear the search.'}</td></tr>}
                {rows.map((r) => {
                  const mineLead = !!r.mine;
                  const canCall = r.has_phone && !r.dnc && (mineLead || boss);
                  return (
                    <tr key={r.id} className={r.hold ? 'held-row' : ''}>
                      <td><span className="clip strong" title={r.name || ''}>{r.name ? titleCase(r.name) : <span className="faint">No name given</span>}</span></td>
                      <td><span className="clip" title={`${r.beds || ''} ${r.location}`}>{[r.beds ? (/^\d+$/.test(r.beds) ? `${r.beds} bed` : r.beds) : '', r.location].filter(Boolean).join(' · ')}</span></td>
                      <td className="r n">{r.budget ? String(r.budget).split(' - ').map((x) => (Number(x) ? fmt(Number(x)) : x)).join(' – ') : dash}</td>
                      <td>{r.dnc ? <span className="faint">Do not call</span> : r.masked && (mineLead || boss) ? <CopyNumber unitId={r.id} owner={{ id: r.owner_id, masked: r.masked }} /> : <span className="ph">{r.masked || <span className="faint">none</span>}</span>}</td>
                      <td>{r.last_called ? fd(r.last_called) : <span className="faint">Never</span>}</td>
                      {who !== 'me' && <td><span className="clip" title={r.assigned_name || ''}>{r.assigned_name || dash}</span></td>}
                      <td>{r.notes?.length ? <div className="nstack">{r.notes.map((n, i) => (
                        <div key={i} className="nitem"><span className="nmeta">{fdt(n.t)} · {String(n.by || '').split(' ')[0]}</span><NoteTag text={n.text} wrap /></div>))}
                        {r.notes_total > r.notes.length && <span className="nmore">+ {r.notes_total - r.notes.length} earlier</span>}</div> : dash}</td>
                      <td className="callcol">{canCall && (r.hold
                        ? <span className="heldcell"><HoldChip h={r.hold} />{boss && <button className="btn ghost" onClick={() => setCalling({ r, force: true })}>Call</button>}</span>
                        : <button className="btn" onClick={() => setCalling({ r })}>Call</button>)}</td>
                    </tr>);
                })}
              </tbody>
            </table>
            <div className="more">{rows.length < total
              ? <button className="btn" disabled={busy} onClick={() => load(page + 1)}>{busy ? 'Loading…' : `Show more (${fmt(total - rows.length)} left)`}</button>
              : rows.length > 0 ? `All ${fmt(total)} shown` : ''}</div>
          </div>
          </>}
        </main>
      </div>
      {calling && <CallFlow lead unitId={calling.r.id} owner={{ id: calling.r.owner_id, name: calling.r.name }} force={!!calling.force}
        label={`${calling.r.name ? titleCase(calling.r.name) : 'Lead'}, ${leadWhat(calling.r)}`}
        onClose={(saved) => { setCalling(null); onCaps(); if (saved) load(1); }} />}
    </>
  );
}

function LeaseCell({ r }) {
  const cls = r.lease_status === 'Live Ejari' ? 't' : r.lease_status === 'No live Ejari' ? 'v' : '';
  return (
    <><span className={'dot ' + cls} />{r.lease_status === 'Not confirmed' ? <span className="muted">Not confirmed</span> : r.lease_status}
      {r.lease_status === 'Live Ejari' && r.renewals != null && <span className="sub">{r.renewals === 0 ? 'first year' : `renewed ${r.renewals}×`}</span>}</>
  );
}
function EndsCell({ d }) {
  if (!d) return <span className="muted">—</span>;
  const n = daysTo(d);
  return <><span className="n">{fd(d)}</span><span className={'sub ' + (n < 0 ? 'gone' : n <= 90 ? 'soon' : '')}>{n < 0 ? `ended ${-n} days ago` : `in ${n} days`}</span></>;
}

// ── Owner list columns ──────────────────────────────────────────────────────
// Each column: key, header label, how to draw the cell. Add, remove or reorder here.
const titleCase = (s) => (s ? s.toLowerCase().replace(/(^|[\s'-])\S/g, (m) => m.toUpperCase()).replace(/\b(Llc|Fzco|Fze|Dmcc|Pjsc|Psc|Ltd)\b/g, (m) => m.toUpperCase()) : '');
const dash = <span className="faint">—</span>;
const LEASE_SHORT = { 'Live Ejari': 'Live', 'No live Ejari': 'None', 'Not confirmed': 'Unknown' };

const COLUMNS = [
  { k: 'unit', label: 'Unit', sort: 'unit', cell: (r) => <b>{r.unit_no}</b> },
  { k: 'place', label: 'Building', cell: (r) => <span className="clip" title={titleCase(placeOf(r))}>{titleCase(placeOf(r))}</span> },
  { k: 'area', label: 'Area', cell: (r) => <span className="clip" title={r.area}>{r.area}</span> },
  { k: 'sc', label: 'Sub-community', cell: (r) => <span className="clip" title={titleCase(r.subcommunity)}>{titleCase(r.subcommunity)}</span> },
  { k: 'type', label: 'Type', cell: (r) => (r.unit_type === 'Villa' ? 'Villa' : 'Apartment') },
  { k: 'beds', label: 'Beds', cell: (r) => bedsLabel(r.beds) },
  { k: 'size', label: 'Size (sq ft)', right: true, sort: 'size', cell: (r) => (r.size_sqft ? fmt(r.size_sqft) : dash) },
  { k: 'lease', label: 'Ejari', cell: (r) => {
    const cls = r.lease_status === 'Live Ejari' ? 't' : r.lease_status === 'No live Ejari' ? 'v' : '';
    return <span className={r.lease_status === 'Not confirmed' ? 'faint' : ''}><span className={'dot ' + cls} />{LEASE_SHORT[r.lease_status]}</span>;
  } },
  { k: 'renewals', label: 'Renewals', right: true, cell: (r) => (r.renewals == null ? dash : r.renewals) },
  { k: 'ends', label: 'Contract ends', sort: 'end', cell: (r) => (r.end_date ? fd(r.end_date) : dash) },
  { k: 'days', label: 'Days left', right: true, cell: (r) => {
    const n = daysTo(r.end_date);
    if (n == null) return dash;
    return <span className={n < 0 ? 'gone' : n <= 90 ? 'soon' : ''}>{n < 0 ? `ended` : n}</span>;
  } },
  { k: 'rent', label: 'Rent (AED)', right: true, sort: 'rent', cell: (r) => (r.annual_rent ? fmt(r.annual_rent) : dash) },
  { k: 'change', label: 'Rent change', right: true, cell: (r) => {
    const c = pct(r.annual_rent, r.prev_rent);
    return c == null ? dash : <span className={c > 0 ? 'up' : c < 0 ? 'down' : ''}>{c > 0 ? '+' : ''}{c}%</span>;
  } },
  { k: 'sale', label: 'Last sale (AED)', right: true, sort: 'sale', cell: (r) => (r.last_sale_price ? fmt(r.last_sale_price) : dash) },
  { k: 'owner', label: 'Owner', cell: (r) => (ownersOf(r).length
    ? <div className="stack">{ownersOf(r).map((o) => <div key={o.id}><span className="clip strong" title={titleCase(o.name)}>{titleCase(o.name)}</span></div>)}</div> : dash) },
  { k: 'mobile', label: 'Mobile', cell: (r) => (ownersOf(r).length
    ? <div className="stack">{ownersOf(r).map((o) => <div key={o.id}>{o.dup ? <span className="faint same">same number</span>
      : o.masked && o.has_phone !== false && !o.dnc ? <CopyNumber unitId={r.id} owner={o} /> : <span className="ph">{o.masked ?? <span className="faint">none</span>}</span>}</div>)}</div> : <span className="faint">none</span>) },
  { k: 'owned', label: 'Units owned', right: true, cell: (r) => r.owner_units },
  { k: 'mortgaged', label: 'Mortgaged', cell: (r) => (r.mortgaged ? 'Yes' : dash) },
  { k: 'lastcall', label: 'Last called', cell: (r) => (r.last_called ? fd(r.last_called) : <span className="faint">Never</span>) },
  { k: 'outcome', label: 'Last outcome', cell: (r) => r.last_outcome ?? dash },
  { k: 'note', label: 'Notes', cell: (r) => (r.notes?.length
    ? <div className="nstack">{r.notes.map((n, i) => (
        <div key={i} className="nitem"><span className="nmeta">{fdt(n.t)} · {String(n.by || '').split(' ')[0]}</span><NoteTag text={n.text} wrap /></div>))}
      {r.notes_total > r.notes.length && <span className="nmore">+ {r.notes_total - r.notes.length} earlier · open the unit to see all</span>}</div>
    : dash) },
];

const COLUMN_SETS = [
  ['Names and numbers', ['unit', 'place', 'owner', 'mobile', 'lastcall']],
  ['Tenancy', ['unit', 'place', 'beds', 'lease', 'ends', 'days', 'rent', 'change', 'owner', 'mobile', 'lastcall']],
  ['Ownership', ['unit', 'place', 'beds', 'size', 'sale', 'owner', 'mobile', 'owned', 'mortgaged']],
  ['Everything', COLUMNS.map((c) => c.k)],
];
const DEFAULT_COLS = COLUMN_SETS[1][1];
// Starting widths (px) for each column; brokers can drag them wider or narrower
const COL_W = { unit: 110, area: 140, place: 170, sc: 160, type: 100, beds: 80, size: 110, lease: 125, renewals: 95, ends: 125,
  days: 95, rent: 115, change: 110, sale: 135, owner: 230, mobile: 150, owned: 105, coowners: 100, mortgaged: 105,
  lastcall: 120, outcome: 140, note: 340 };
function loadWidths() { try { const w = JSON.parse(localStorage.getItem('colWidths') || '{}'); return w && typeof w === 'object' ? w : {}; } catch { return {}; } }

function loadCols() {
  try {
    const v = JSON.parse(localStorage.getItem('columns') || 'null');
    if (Array.isArray(v) && v.length) return v.filter((k) => COLUMNS.some((c) => c.k === k));
  } catch {}
  return DEFAULT_COLS;
}

function ColumnPicker({ cols, setCols }) {
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(null);
  const [maxH, setMaxH] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  // Make room for the menu: if it wouldn't fit below the button, scroll the page up first, then size it to the screen
  const toggleOpen = () => {
    if (open) return setOpen(false);
    const top = () => ref.current.getBoundingClientRect();
    const head = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--toph')) || 49;
    if (window.innerHeight - top().bottom < 480) window.scrollBy({ top: top().top - head - 12 });
    setMaxH(Math.max(240, window.innerHeight - top().bottom - 16));
    setOpen(true);
  };
  const label = (k) => COLUMNS.find((c) => c.k === k)?.label;
  const remove = (k) => { if (cols.length > 1) setCols(cols.filter((x) => x !== k)); };
  const add = (k) => setCols([...cols, k]);
  const move = (from, to) => {
    if (from == null || from === to) return;
    const next = [...cols]; const [x] = next.splice(from, 1); next.splice(to, 0, x); setCols(next);
  };
  const same = (a, b) => a.length === b.length && a.every((x, i) => b[i] === x);
  const hidden = COLUMNS.filter((c) => !cols.includes(c.k));
  return (
    <div className="picker" ref={ref}>
      <button className="btn" onClick={toggleOpen} aria-expanded={open}>Columns · {cols.length}</button>
      {open && (
        <div className="menu cpick" style={maxH ? { maxHeight: maxH } : undefined}>
          <div className="sets">
            {COLUMN_SETS.map(([name, keys]) => (
              <button key={name} className={'chip' + (same(cols, keys) ? ' on' : '')} onClick={() => setCols(keys)}>{name}</button>
            ))}
          </div>
          <h5>Showing · drag to reorder</h5>
          <ol className="order">
            {cols.map((k, i) => (
              <li key={k} draggable className={drag === i ? 'dragging' : ''}
                onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', k); }}
                onDragOver={(e) => { e.preventDefault(); if (drag != null && drag !== i) { move(drag, i); setDrag(i); } }}
                onDragEnd={() => setDrag(null)}>
                <span className="grip" aria-hidden="true">⋮⋮</span>
                <span className="nm">{label(k)}</span>
                <span className="ud">
                  <button aria-label={'Move ' + label(k) + ' up'} disabled={i === 0} onClick={() => move(i, i - 1)}>↑</button>
                  <button aria-label={'Move ' + label(k) + ' down'} disabled={i === cols.length - 1} onClick={() => move(i, i + 1)}>↓</button>
                  <button aria-label={'Hide ' + label(k)} disabled={cols.length === 1} onClick={() => remove(k)}>×</button>
                </span>
              </li>
            ))}
          </ol>
          {hidden.length > 0 && <>
            <h5>Add a column</h5>
            <div className="addcols">{hidden.map((c) => <button key={c.k} className="chip" onClick={() => add(c.k)}>+ {c.label}</button>)}</div>
          </>}
          <p className="faint" style={{ margin: '10px 0 0' }}>You can also drag the column headings. Saved on this computer.</p>
        </div>
      )}
    </div>
  );
}

// Today's call target at the top of the Owners page
const TARGET_LINES = [
  [0, 'Fresh list, fresh day. The first call is the hardest, so make it now.'],
  [0.01, 'You\'re off the mark. Keep the rhythm going.'],
  [0.2, 'Warming up nicely.'],
  [0.5, 'Halfway there. Same again and you\'re done.'],
  [0.75, 'Final stretch. Finish strong.'],
  [0.9, 'So close. A few more dials.'],
  [1, 'Target smashed. Everything from here is a bonus.'],
  [1.5, 'Unstoppable. Take a bow.'],
];
// The race: everyone calling today on one track, with the leader, who's chasing and how far behind you are
const first = (n) => String(n || '').split(' ')[0];
const initials = (n) => String(n || '').split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
function raceLine(board, me) {
  const i = board.findIndex((b) => b.me);
  const leader = board[0];
  if (!me || !leader) return 'Get on the board.';
  const others = board.filter((b) => !b.me);
  if (me.calls === 0) return others.length ? `${first(leader.name)} is already on ${leader.calls}. Time to get on the board!` : 'Nobody has called yet. Be first on the board!';
  if (i === 0) {
    const second = board[1];
    if (!second) return 'You\'re first on the board today. Set the pace!';
    if (second.calls === me.calls) return `Neck and neck with ${first(second.name)} at the top. The next call takes the lead!`;
    const gap = me.calls - second.calls;
    return gap <= 2 ? `You're leading, but ${first(second.name)} is only ${gap} behind. Don't slow down!` : `You're in the lead by ${gap}. ${first(second.name)} is chasing.`;
  }
  const above = board[i - 1];
  if (!above) return 'Every call moves you up the board.';
  const gap = above.calls - me.calls;
  if (gap === 0) return `Level with ${first(above.name)}. One more call and you're ahead!`;
  const chase = gap <= 2 ? `So close! ${gap} more and you pass ${first(above.name)}.` : `${gap} calls behind ${first(above.name)} for #${i}.`;
  return i === 1 ? chase : `${chase} ${first(leader.name)} leads with ${leader.calls}.`;
}
// Set your own daily call target: anything from the company target (50) up, never lower
function TargetEditor({ goal, base, onSaved, onClose }) {
  const [v, setV] = useState(String(goal));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const n = Number(v);
  const bad = !v || !Number.isFinite(n) || n < base;
  const save = async () => {
    setBusy(true); setErr('');
    try { await api('/api/desk?action=setTarget', { method: 'POST', body: { target: n } }); onSaved(n); onClose(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <div className="tedit" onClick={(e) => e.stopPropagation()}>
      <label>My daily target
        <input type="number" inputMode="numeric" min={base} max={500} value={v} autoFocus
          onChange={(e) => setV(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter' && !bad) save(); if (e.key === 'Escape') onClose(); }} /></label>
      <button className="btn primary" disabled={bad || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      <button className="btn" onClick={onClose}>Cancel</button>
      <span className={'faint' + (v && n < base ? ' err' : '')}>{v && n < base ? `Can't be lower than ${base}` : `Lowest is ${base}`}</span>
      {err && <span className="err">{err}</span>}
    </div>
  );
}

function TargetBar({ t, onTarget }) {
  const [editT, setEditT] = useState(false);
  const { goal, made } = t;
  const board = t.board || [];
  const meRow = board.find((b) => b.me) || { me: true, name: 'You', calls: made };
  const myRank = board.findIndex((b) => b.me) + 1;
  const pct = goal ? made / goal : 0;
  // Pace through calling hours (Dubai time): how many calls you'd have made by now at an even rate
  const toMin = (h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  const now = Number(parts.find((p) => p.type === 'hour').value) * 60 + Number(parts.find((p) => p.type === 'minute').value);
  const from = toMin(t.hours.from), to = toMin(t.hours.to);
  const share = Math.min(1, Math.max(0, (now - from) / (to - from)));
  const due = Math.round(goal * share);
  const done = made >= goal;
  const pace = done ? `+${made - goal} bonus` : now < from ? 'Calling opens at ' + t.hours.from : now >= to ? 'Calling closed for today'
    : made >= due ? 'On pace' : `${due - made} behind pace`;
  // Overtakes: remember your place and celebrate when you climb
  const prev = useRef(myRank);
  const [flash, setFlash] = useState('');
  useEffect(() => {
    if (prev.current && myRank && myRank < prev.current) {
      const passed = board[myRank];
      setFlash(myRank === 1 ? 'You just took the lead! 🚀' : `You just overtook ${first(passed?.name)}! 🚀`);
      const x = setTimeout(() => setFlash(''), 9000); prev.current = myRank; return () => clearTimeout(x);
    }
    prev.current = myRank;
  }, [myRank]); // eslint-disable-line react-hooks/exhaustive-deps
  const scale = Math.max(goal, board[0]?.calls || 0, 1);
  const medal = ['🥇', '🥈', '🥉'];
  return (
    <div className="gut">
      <div className={'target race' + (done ? ' done' : '')}>
        <div className="t-main">
          <div className="t-num"><b className="n">{made}</b><span>/ {goal} calls today</span>
            {onTarget && !editT && <button className="link tset" onClick={() => setEditT(true)}>Set my target</button>}</div>
          {editT && <TargetEditor goal={goal} base={t.base || 50} onSaved={() => onTarget?.()} onClose={() => setEditT(false)} />}
          <div className="t-line">{flash || raceLine(board, meRow)}</div>
        </div>
        <div className="r-track" aria-label="Today's race">
          <div className="r-line" />
          <div className="r-fill" style={{ width: `${Math.min(100, (made / scale) * 100)}%` }} />
          {!done && share > 0 && share < 1 && <div className="t-pace" style={{ left: `${(due / scale) * 100}%` }} title={`Pace: ${due} by now`} />}
          <div className="r-goal" style={{ left: `${(goal / scale) * 100}%` }} title={`Target: ${goal}`}><span>🏁 {goal}</span></div>
          {board.map((b, i) => (
            <div key={b.name + i} className={'r-dot' + (b.me ? ' me' : '') + (i === 0 && b.calls > 0 ? ' lead' : '')}
              style={{ left: `${(b.calls / scale) * 100}%`, top: b.me ? '50%' : i % 2 ? '78%' : '22%', zIndex: b.me ? 5 : 3 - Math.min(i, 2) }}
              title={`${b.name}: ${b.calls} calls`}>
              {i === 0 && b.calls > 0 && <i className="crown">👑</i>}
              <span>{b.me ? 'You' : initials(b.name)}</span>
            </div>
          ))}
        </div>
        <div className="t-side">
          <span className={'t-pill' + (pace === 'On pace' || done ? ' good' : pace.includes('behind') ? ' warn' : '')}>{pace}</span>
          <span className="r-podium">
            {board.slice(0, 3).filter((b) => b.calls > 0).map((b, i) => <span key={i} className={b.me ? 'mine' : ''}>{medal[i]} {b.me ? 'You' : first(b.name)} <b>{b.calls}</b></span>)}
            {myRank > 3 && <span className="mine">#{myRank} You <b>{made}</b></span>}
          </span>
          <span className="faint">{t.team} call{t.team === 1 ? '' : 's'} across the team today</span>
        </div>
        {done && <div className="t-burst" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ '--a': `${i * 26}deg`, '--d': `${(i % 4) * 60}ms` }} />)}</div>}
      </div>
    </div>
  );
}

// ── Filter building blocks ──────────────────────────────────────────────────
// Tick-box list with a search box, for areas, clusters and buildings
function CheckList({ options, selected, onChange }) {
  const [q, setQ] = useState('');
  const shown = q ? options.filter((o) => String(o).toLowerCase().includes(q.toLowerCase())) : options;
  const toggle = (o) => onChange(selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o]);
  return (
    <div className="checklist">
      {options.length > 6 && <input type="search" className="cl-search" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />}
      <div className="cl-acts">
        <button className="link" onClick={() => onChange([...new Set([...selected, ...shown])])}>Select {q ? 'shown' : 'all'}</button>
        {selected.length > 0 && <button className="link" onClick={() => onChange([])}>Clear</button>}
      </div>
      <div className="cl-list">
        {shown.length === 0 && <span className="faint">Nothing matches</span>}
        {shown.map((o) => <label key={o} className="cb"><input type="checkbox" checked={selected.includes(o)} onChange={() => toggle(o)} />{titleCase(o)}</label>)}
      </div>
    </div>
  );
}
// A filter that shows what's picked, and opens its tick-box list underneath when clicked
function MultiSelect({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const summary = selected.length === 0 ? 'All' : selected.length === 1 ? titleCase(selected[0]) : `${selected.length} selected`;
  return (
    <div className={'ms' + (open ? ' open' : '')}>
      <h3>{label}</h3>
      <button className={'ms-btn' + (selected.length ? ' on' : '')} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="ms-sum">{summary}</span><span className="chev">▾</span>
      </button>
      {open && <CheckList options={options} selected={selected} onChange={onChange} />}
    </div>
  );
}
// A filter group that folds away. Opens by itself when something in it is switched on.
function Section({ title, on, open: startOpen, children }) {
  const [open, setOpen] = useState(!!startOpen || !!on);
  return (
    <div className={'sec' + (open ? ' open' : '')}>
      <button className="sec-h" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{title}{on ? <i className="sec-dot" /> : null}</span><span className="chev">▾</span>
      </button>
      {open && <div className="sec-b">{children}</div>}
    </div>
  );
}

// Who is working this owner and for how long
function holdLeft(until) {
  const m = Math.max(1, Math.round((new Date(until) - Date.now()) / 60000));
  return m < 60 ? `${m}m` : m < 2880 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}
function HoldChip({ h, long }) {
  const first = String(h.by || '').split(' ')[0];
  const live = h.why === 'Calling now';
  const tip = live ? `${h.by} is calling this owner right now` : `${h.by} is working this owner (${h.why}). Free to call in ${holdLeft(h.until)}.`;
  return <span className={'hold' + (live ? ' live' : '')} title={tip}>{live ? <span className="pulse" /> : null}{long ? (live ? `${h.by} is calling now` : `${h.by} · ${h.why} · free in ${holdLeft(h.until)}`) : `${first} · ${live ? 'now' : holdLeft(h.until)}`}</span>;
}

// Click a hidden number to copy it (e.g. to paste into WhatsApp). The number never shows on screen.
// The server checks it's allowed, logs it and counts it against a daily limit.
function CopyNumber({ unitId, owner }) {
  const [st, setSt] = useState(null); // null | 'busy' | 'ok' | error text
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const show = (v) => { setSt(v); clearTimeout(timer.current); timer.current = setTimeout(() => setSt(null), v === 'ok' ? 2500 : 4000); };
  const copy = async (e) => {
    e.stopPropagation();
    if (st === 'busy') return;
    setSt('busy');
    const get = api('/api/desk?action=copyNumber', { method: 'POST', body: { unitId, ownerId: owner.id } });
    try {
      // Safari only allows clipboard writes started straight from the click, so hand it the pending number
      if (window.ClipboardItem && navigator.clipboard?.write) {
        await navigator.clipboard.write([new window.ClipboardItem({ 'text/plain': get.then((j) => new Blob([j.phone], { type: 'text/plain' })) })]);
      } else {
        await navigator.clipboard.writeText((await get).phone);
      }
      await get;
      show('ok');
      window.dispatchEvent(new Event('desk:caps'));
    } catch (err) {
      let msg = 'Couldn\'t copy';
      try { await get; } catch (x) { msg = x.message; }
      show(msg);
    }
  };
  return (
    <button type="button" className={'ph copyph' + (st === 'ok' ? ' ok' : st && st !== 'busy' ? ' bad' : '')} onClick={copy}
      title={st && st !== 'ok' && st !== 'busy' ? st : 'Click to copy the number. It stays hidden here.'}>
      {st === 'ok' ? 'Copied' : st && st !== 'busy' ? 'Not copied' : owner.masked}
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
    </button>
  );
}

// All owners of a unit, in one row (falls back to the main owner if the list didn't include them)
function ownersOf(r) {
  if (Array.isArray(r.owners) && r.owners.length) return r.owners;
  return r.owner_id ? [{ id: r.owner_id, name: r.owner_name, masked: r.owner_masked, has_phone: r.has_phone, hold: r.hold }] : [];
}
const OwnerRow = React.memo(function OwnerRow({ r, cols, onOpen, onCall, canOverride }) {
  const owners = ownersOf(r);
  // A hold on any co-owner holds the whole unit, so one broker calls them all
  const unitHold = owners.map((o) => o.hold).find(Boolean) || null;
  const call = (o, force) => (e) => { e.stopPropagation(); onCall({ r, owner: o, force }); };
  return (
    <tr onClick={() => onOpen(r.id)} className={unitHold ? 'held-row' : ''}>
      {cols.map((c) => <td key={c.k} className={c.right ? 'r n' : ''}>{c.cell(r)}</td>)}
      <td className="callcol"><div className="stack">{owners.map((o) => (
        <div key={o.id}>{o.has_phone && !o.dnc && !o.dup && (unitHold
          ? <span className="heldcell"><HoldChip h={unitHold} />{canOverride && <button className="btn ghost" title="Managers can call anyway" onClick={call(o, true)}>Call</button>}</span>
          : <button className="btn" onClick={call(o, false)}>Call</button>)}</div>))}</div></td>
    </tr>
  );
});

function UnitPanel({ id, onClose, onOpen, onCaps, canOverride }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [calling, setCalling] = useState(null);
  const load = useCallback(() => {
    setErr('');
    api('/api/desk?action=unit&id=' + id).then((j) => { setD(j); onCaps(); }).catch((e) => setErr(e.message));
  }, [id, onCaps]);
  useEffect(() => { setD(null); load(); }, [load]);
  useEffect(() => { const k = (e) => e.key === 'Escape' && !calling && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose, calling]);

  const u = d?.unit;
  const place = u ? (u.unit_type === 'Villa' ? u.subcommunity : `${u.building}, ${u.subcommunity}`) : '';
  const chg = u ? pct(u.annual_rent, u.prev_rent) : null;
  const days = u ? daysTo(u.end_date) : null;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="panel" aria-label="Unit">
        <div className="panel-head">
          <div>{u ? <><h2>{/^Street /.test(u.unit_no) ? '' : u.unit_type === 'Villa' ? 'Villa ' : 'Unit '}{u.unit_no}</h2>
            <div className="muted">{[titleCase(place), u.layout, u.beds ? bedsLabel(u.beds) : null, u.size_sqft ? `${fmt(u.size_sqft)} sq ft` : null].filter(Boolean).join(' · ')}</div>
            {u.old_code && <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>Old unit code: {u.old_code}</div>}</> : <h2>{err ? 'Not available' : 'Loading…'}</h2>}</div>
          <button className="x" aria-label="Close" onClick={onClose}>×</button>
        </div>
        {err && <p className="err">{err}</p>}
        {u && <>
          <div className="blk"><h4>Tenancy</h4><dl>
            <dt>Lease</dt><dd><LeaseCell r={u} /></dd>
            {u.end_date ? <>
              <dt>Contract ends</dt><dd>{fd(u.end_date)} <span className={days < 0 ? 'gone' : days <= 90 ? 'soon' : 'muted'}>({days < 0 ? `ended ${-days} days ago` : `in ${days} days`})</span></dd>
              <dt>Started</dt><dd>{fd(u.start_date)}</dd>
              <dt>Rent</dt><dd className="n">AED {fmt(u.annual_rent)} a year</dd>
              <dt>Previous rent</dt><dd className="n">{u.prev_rent ? <>AED {fmt(u.prev_rent)} {chg ? <span className="muted">({chg > 0 ? '+' : ''}{chg}%)</span> : null}</> : <span className="muted">not recorded</span>}</dd>
              <dt>Renewals</dt><dd>{u.renewals ?? '—'}</dd>
              <dt>Matched by</dt><dd>{u.matched_by === 'Size' ? 'registered size (unit number not returned)' : 'unit number'}</dd>
            </> : <><dt>Contract</dt><dd className="muted">{u.lease_status === 'No live Ejari' ? 'No registered contract running' : 'Not confirmed yet'}</dd></>}
          </dl></div>
          <div className="blk"><h4>Ownership</h4><dl>
            <dt>Last sale price</dt><dd className="n">{u.last_sale_price ? `AED ${fmt(u.last_sale_price)}` : <span className="muted">not available</span>}</dd>
            <dt>Finance</dt><dd>{u.mortgaged ? 'Mortgaged' : 'No bank on title'}</dd>
          </dl>
            <div style={{ marginTop: 10 }}>
              {d.owners.map((o) => (
                <div className="owner" key={o.id}>
                  <div>{o.name}
                    <span className="sub">{o.role === 'mortgagee' ? 'Mortgage bank' : o.is_company ? 'Company' : 'Individual'}
                      {o.role === 'owner' && <> · {o.dup ? <span className="faint">same number as above</span> : o.masked && !o.dnc ? <CopyNumber unitId={u.id} owner={o} /> : <span className="ph">{o.masked ?? 'no mobile'}</span>}</>}{o.dnc ? ' · asked not to be called' : ''}</span>
                    {o.role === 'owner' && o.units > 1 && <span className="sub">Also owns {d.others.filter((x) => x.owner_id === o.id).map((x) => (
                      <button key={x.id} className="link" style={{ marginRight: 8 }} onClick={() => onOpen(x.id)}>{x.unit_type === 'Villa' ? x.subcommunity : x.building} {x.unit_no}</button>))}</span>}
                  </div>
                  <div>{o.role === 'owner' && o.has_phone && !o.dnc && !o.dup && (o.hold
                    ? <span className="heldcell"><HoldChip h={o.hold} long />{canOverride && <button className="btn ghost" onClick={() => setCalling({ ...o, force: true })}>Call anyway</button>}</span>
                    : <button className="btn" onClick={() => setCalling(o)}>Call</button>)}</div>
                </div>
              ))}
            </div>
          </div>
          <MonthlyReport unitId={u.id} report={d.report} onChange={(r) => setD((x) => ({ ...x, report: r }))} />
          <Notes unitId={u.id} notes={d.notes} onAdded={(n) => setD((x) => ({ ...x, notes: [n, ...x.notes] }))} />
          <div className="blk"><h4>Calls</h4>
            {d.calls.length === 0 ? <p className="muted">Not called yet</p> : d.calls.map((c, i) => (
              <div key={i} className="owner"><span>{c.outcome ?? (c.note ? '' : 'No outcome logged')}{c.note && <span className="sub"><NoteTag text={c.note} /></span>}{c.kendal && <span className={'kline small ' + c.kendal} title={c.kendal_detail}>{c.kendal === 'existing' ? 'Already in Kendal' : c.kendal === 'error' ? 'Kendal: not sent' : 'Sent to Kendal'}</span>}</span>
                <span className="muted">{c.full_name}, {fdt(c.called_at)}</span></div>
            ))}
          </div>
          <p className="fine">Numbers stay hidden here. Call sends the number to your phone and logs it under your name.</p>
        </>}
      </aside>
      {calling && u && <CallFlow unitId={u.id} owner={calling} force={!!calling.force} label={`${calling.name}, ${place} ${u.unit_no}`}
        onClose={(saved) => { setCalling(null); onCaps(); if (saved) load(); }} />}
    </>
  );
}

// Monthly market report sign-up for this unit (also ticked from the call outcome)
function MonthlyReport({ unitId, report, onChange }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const toggle = async (on) => {
    setBusy(true); setErr('');
    try { await api('/api/desk?action=reportOptin', { method: 'POST', body: { unitId, on } }); onChange(on ? { by: 'You', at: new Date().toISOString() } : null); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <div className="blk mrep">
      <label className="cb"><input type="checkbox" checked={!!report} disabled={busy} onChange={(e) => toggle(e.target.checked)} />Send a market report every month</label>
      {report && <span className="faint">Signed up by {report.by}, {fd(report.at)}. Shows in the Monthly reports tab.</span>}
      {err && <p className="err">{err}</p>}
    </div>
  );
}

// Notes on a unit. Anyone with the area sees them; they stay on the record with the writer's name.
function Notes({ unitId, notes, onAdded }) {
  const [chip, setChip] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const full = composeNote(chip, text);
  async function save() {
    if (!full) return;
    setBusy(true); setErr('');
    try { const j = await api('/api/desk?action=addNote', { method: 'POST', body: { unitId, body: full } }); onAdded(j.note); setText(''); setChip(''); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }
  return (
    <div className="blk"><h4>Notes</h4>
      <QuickNotes value={chip} onPick={setChip} />
      <textarea className="notebox" placeholder={notePlaceholder(chip, 'Add a note about this unit or owner')} value={text} maxLength={1800}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); }} />
      <div className="noteact">
        <span className="faint">Ctrl/⌘ + Enter to save</span>
        <button className="btn primary" disabled={!full || busy} onClick={save}>{busy ? 'Saving…' : 'Save note'}</button>
      </div>
      {err && <p className="err">{err}</p>}
      {notes.length === 0 ? <p className="muted">No notes yet</p> : notes.map((n) => (
        <div key={n.id} className="note">
          <p><NoteTag text={n.body} /></p>
          <span className="faint">{n.full_name}, {fdt(n.created_at)}</span>
        </div>
      ))}
    </div>
  );
}

// What happened when the lead was sent to Kendal
function KendalLine({ k }) {
  if (!k) return null;
  const txt = k.status === 'off' ? 'Not sent to Kendal: the Kendal link isn\'t switched on yet.' : k.detail;
  return <p className={'kline ' + k.status}>{txt}</p>;
}

// Laptop side of a call: send to phone, wait for the tap, then log the outcome
// After the outcome is saved on the laptop: offer the WhatsApp follow-up here too (it also shows on the phone)
function DoneStep({ requestId, onClose, kendal, callBack }) {
  const [f, setF] = useState(undefined);
  const [me, setMe] = useState('');
  const [sent, setSent] = useState(false);
  useEffect(() => {
    api('/api/phone?action=pending').then((j) => { setMe(j.name); setF(j.followup && j.followup.id === requestId ? j.followup : null); }).catch(() => setF(null));
  }, [requestId]);
  return <>
    <h3>Saved</h3>
    <p className="muted">The outcome is on the call history.{callBack ? ` Call back ${fdtShort(callBack.due_at)}.` : ''}</p>
    <KendalLine k={kendal} />
    {f && !sent && <FollowUp laptop f={f} me={me} onDone={(r) => setSent(r)} />}
    {sent && <p className="muted">{sent === 'sent' ? 'WhatsApp opened. Added "WhatsApp sent" to the note.' : sent === 'unavailable' ? 'Added "WhatsApp unavailable" to the note.' : 'Added "WhatsApp not sent" to the note.'}</p>}
    {sent === 'sent' && <NotOnWhatsApp requestId={requestId} />}
    <button className="btn" style={{ marginTop: 10 }} onClick={onClose}>Close</button>
  </>;
}

function CallFlow({ unitId, owner, label, onClose, force, lead }) {
  const [stage, setStage] = useState('sending');
  const [msg, setMsg] = useState('');
  const [req, setReq] = useState(null);
  const [kres, setKres] = useState(null);
  const [cb, setCb] = useState(null);

  useEffect(() => {
    api('/api/desk?action=call', { method: 'POST', body: { unitId, ownerId: owner.id, force } })
      .then((j) => { setReq(j); setStage('sent'); })
      .catch((e) => { setMsg(e.message); setStage('error'); });
  }, [unitId, owner.id]);
  useEffect(() => {
    if (!req || (stage !== 'sent' && stage !== 'dialled')) return;
    const t = setInterval(() => {
      api('/api/desk?action=callStatus&id=' + req.requestId).then((j) => {
        if (j.status === 'dialled' && stage === 'sent') setStage('dialled');
        if (j.status === 'done') setStage('done');
        if (j.status === 'expired') setStage('expired');
      }).catch(() => {});
    }, 2000);
    return () => clearInterval(t);
  }, [req, stage]);

  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget && stage !== 'dialled') onClose(stage === 'done'); }}>
      <div className="box" role="dialog" aria-label="Call">
        {stage === 'sending' && <><h3>Sending to your phone…</h3><p className="muted">{label}</p></>}
        {stage === 'error' && <><h3>Call not sent</h3><p className="muted">{msg}</p><button className="btn" onClick={() => onClose(false)}>Close</button></>}
        {stage === 'sent' && <><h3>Sent to your phone</h3><p className="muted">{label}</p>
          <p>{req.phones > 0 ? 'Tap the notification on your phone, then the blue Call button.' : 'Open Apex Desk on your phone and tap the blue Call button. Turn on call alerts there to get a notification next time.'}</p>
          <p className="faint">It expires in {req.minutes} minutes.</p>
          <button className="btn" onClick={() => onClose(false)}>Cancel</button></>}
        {stage === 'expired' && <><h3>Call expired</h3><p className="muted">It wasn&apos;t tapped on your phone in time. Press Call again.</p><button className="btn" onClick={() => onClose(false)}>Close</button></>}
        {stage === 'dialled' && <><h3>How did it go?</h3><p className="muted">{label}</p><OutcomeForm requestId={req.requestId} lead={lead} onSaved={(j) => { setKres(j?.kendal || null); setCb(j?.callBack || null); setStage('done'); }} /></>}
        {stage === 'done' && <DoneStep requestId={req.requestId} kendal={kres} callBack={cb} onClose={() => onClose(true)} />}
      </div>
    </div>
  );
}

// When to call back. Not picked = a month later (set by the server). Do not call = none.
const CALLBACKS = [['day', 'Tomorrow'], ['week', 'In a week'], ['custom', 'Pick a date']];
const localInput = (d) => { const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return x.toISOString().slice(0, 16); };
const fdtShort = (d) => new Date(d).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
function CallBackPicker({ value, onChange }) {
  const set = (kind) => onChange(value.kind === kind ? { kind: '', at: value.at } : { kind, at: value.at || localInput(new Date(Date.now() + 2 * 864e5)) });
  return (
    <div className="cbk">
      <span className="lbl">Call back</span>
      <div className="cbk-chips">{CALLBACKS.map(([k, l]) => <button type="button" key={k} className={value.kind === k ? 'on' : ''} onClick={() => set(k)}>{l}</button>)}</div>
      {value.kind === 'custom' && <input type="datetime-local" value={value.at} min={localInput(new Date())} onChange={(e) => onChange({ kind: 'custom', at: e.target.value })} />}
      <span className="faint cbk-hint">{value.kind ? '' : 'Not picked: set for a month from now.'}</span>
    </div>
  );
}
function OutcomeForm({ requestId, onSaved, big, lead }) {
  const [chip, setChip] = useState('');
  const [callBack, setCallBack] = useState({ kind: '', at: '' });
  const [extra, setExtra] = useState('');
  const [kendal, setKendal] = useState(false);
  const [report, setReport] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const r = chip ? findResult(chip, lead) : null;
  const note = composeNote(chip, extra);
  const pickResult = (x) => {
    const next = chip === x.k ? null : x;
    setChip(next ? next.k : '');
    setKendal(!lead && !!next?.kendal);
    setReport(!lead && !!next?.report);
  };
  const needsWords = chip === 'Other' && !extra.trim();
  const noCallBack = r && (r.o === 'Do not call' || r.o === 'Wrong number');
  async function save() {
    setBusy(true); setErr('');
    try { const j = await api('/api/phone?action=outcome', { method: 'POST', body: { requestId, outcome: r?.o || '', note, kendal, report,
      callBack: noCallBack ? { kind: '' } : callBack.kind === 'custom' ? { kind: 'custom', at: callBack.at ? new Date(callBack.at).toISOString() : null } : { kind: callBack.kind } } }); onSaved(j); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }
  return (
    <div className={'result' + (big ? ' big' : '')}>
      <div className="res-cols">
        {['cold', 'hot'].map((tone) => (
          <div key={tone} className={'res-col ' + tone}>
            <span className="res-h">{tone === 'cold' ? 'Cold' : 'Hot'}</span>
            {resultsFor(lead).filter((g) => g.tone === tone).map((g) => (
              <div key={g.title} className="res-g">
                <span className="res-gt">{g.title}</span>
                <div className="res-chips">{g.items.map((x) => (
                  <button type="button" key={x.k} className={'chip' + (chip === x.k ? ' on' : '')} onClick={() => pickResult(x)}>{x.label || x.k}</button>))}</div>
              </div>))}
          </div>))}
      </div>
      <textarea placeholder={chip === 'Other' ? 'Why? (needed for Other)' : chip ? 'Add your own words (optional)' : 'Pick a result above, then add anything useful'} value={extra} maxLength={900} onChange={(e) => setExtra(e.target.value)} />
      <div className="res-opts">
        {!lead && <label className="cb"><input type="checkbox" checked={kendal} onChange={(e) => setKendal(e.target.checked)} />Send to Kendal as a lead</label>}
        {!lead && <label className="cb"><input type="checkbox" checked={report} onChange={(e) => setReport(e.target.checked)} />Send a market report every month</label>}
      </div>
      {!noCallBack && <CallBackPicker value={callBack} onChange={setCallBack} />}
      {r?.o === 'Do not call' && <p className="res-warn">The owner goes on the Do not call list. Nobody will be able to call them again.</p>}
      {err && <p className="err">{err}</p>}
      <button className={big ? 'bigcall' : 'btn primary'} disabled={!chip || needsWords || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      <p className="faint res-hint">{!chip ? 'Pick how the call went.' : needsWords ? 'Write why for "Other".' : r.wa === false ? 'No WhatsApp follow-up for this one.' : 'A WhatsApp follow-up is ready after you save.'}</p>
    </div>
  );
}

// ── WhatsApp rocket ─────────────────────────────────────────────────────────
// One message to the owners in the current list, sent from your own WhatsApp Web by the Apex WhatsApp Rocket
// Chrome extension, one owner every 30-90 seconds. The numbers go straight from the server to the extension, one at
// a time: they never appear on this page.
const ROCKET_MSG = 'Hi {first}, this is {me} from Apex Homes. I\'m reaching out regarding your {property}, {area}. Are you open to selling or renting it out? Happy to share what similar units have recently gone for.';
const hasRocketExt = () => !!document.documentElement.dataset.apexRocket;
function Rocket({ params, total, onClose }) {
  const [st, setSt] = useState(undefined);         // latest run + progress
  const [v, setV] = useState({ limit: String(Math.min(50, total || 50)), message: ROCKET_MSG, gapMin: '30', gapMax: '90', skipRecent: true });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ext, setExt] = useState(hasRocketExt());
  const [dismissed, setDismissed] = useState(0);
  const load = useCallback(() => api('/api/rocket?action=status').then(setSt).catch((e) => { setErr(e.message); setSt(null); }), []);
  useEffect(() => { load(); const t = setInterval(() => { setExt(hasRocketExt()); load(); }, 4000); return () => clearInterval(t); }, [load]);
  const run = st?.run;
  const live = run && (run.status === 'running' || run.status === 'paused');
  async function start() {
    setBusy(true); setErr('');
    try {
      const j = await api('/api/rocket?action=create', { method: 'POST', body: { params, limit: Number(v.limit), message: v.message,
        gapMin: Number(v.gapMin), gapMax: Number(v.gapMax), skipRecent: v.skipRecent } });
      const ok = await new Promise((resolve) => {
        const t = setTimeout(() => { window.removeEventListener('message', on); resolve(false); }, 4000);
        function on(e) { if (e.source === window && e.data?.source === 'apex-rocket' && e.data.type === 'STARTED') { clearTimeout(t); window.removeEventListener('message', on); resolve(e.data.ok); } }
        window.addEventListener('message', on);
        window.postMessage({ source: 'apex-desk', type: 'ROCKET_START', runId: j.runId, token: j.token, gapMin: j.gapMin, gapMax: j.gapMax }, location.origin);
      });
      if (!ok) setErr('The extension didn\'t pick it up. Check it\'s switched on in chrome://extensions, then press Resume.');
      await load();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }
  const act = async (a) => { setBusy(true); try { await api('/api/rocket?action=' + a, { method: 'POST', body: { runId: run.id } }); await load(); } catch (e) { setErr(e.message); } setBusy(false); };
  const n = Number(v.limit), gmin = Number(v.gapMin), gmax = Number(v.gapMax);
  const bad = !n || n < 1 || n > 100 || !v.message.trim() || gmin < 20 || gmax < gmin;
  const mins = Math.round((Math.min(n || 0, total) * ((gmin + gmax) / 2 + 12)) / 60);
  const statusLabel = { running: 'Sending', paused: 'Paused', stopped: 'Stopped', done: 'Finished' };
  return (
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="box rocket" role="dialog" aria-label="WhatsApp rocket">
        <div className="rk-h"><h3>WhatsApp rocket</h3><button className="x" aria-label="Close" onClick={onClose}>×</button></div>
        {st === undefined ? <p className="muted">Loading…</p> : live || (run && run.id !== dismissed && Date.now() - new Date(run.createdAt).getTime() < 3600e3) ? (
          <>
            <p className="muted">{statusLabel[run.status] || run.status} · one owner every {run.gapMin}–{run.gapMax} seconds from your WhatsApp Web. Keep Chrome open; you can close this box.</p>
            <div className="rk-prog"><div style={{ width: `${run.total ? ((run.sent + run.failed + run.skipped) / run.total) * 100 : 0}%` }} /></div>
            <div className="rk-n"><span><b>{run.sent}</b> sent</span><span><b>{run.failed}</b> not sent</span><span><b>{run.left}</b> to go</span><span className="faint">of {run.total}</span></div>
            {st.recent?.length > 0 && <div className="rk-list">{st.recent.map((r) => (
              <div key={r.pos} className={'rk-i ' + r.status}><span>{titleCase(r.is_company ? r.owner_name : String(r.owner_name).split(' ')[0])} · {r.unit_type === 'Villa' ? titleCase(r.subcommunity) : titleCase(r.building)} {r.unit_no}</span>
                <span>{r.status === 'sent' ? 'Sent' : r.status === 'sending' ? 'Sending…' : r.status === 'skipped' ? 'Skipped' : r.detail || 'Not sent'}</span></div>))}</div>}
            <div className="acts">
              {run.status === 'running' && <button className="btn" disabled={busy} onClick={() => act('pause')}>Pause</button>}
              {run.status === 'paused' && <button className="btn primary" disabled={busy} onClick={() => act('resume')}>Resume</button>}
              {live && <button className="btn" disabled={busy} onClick={() => act('stop')}>Stop</button>}
              {!live && <button className="btn primary" onClick={() => setDismissed(run.id)}>New rocket</button>}
            </div>
            <p className="faint small">{st.today}/{st.cap} rocket messages sent today.</p>
          </>
        ) : (
          <>
            <p className="muted">Sends one WhatsApp to the owners in your current list, from your own WhatsApp Web, one every {gmin || 30}–{gmax || 90} seconds. Numbers never show here.</p>
            {!ext && <p className="rk-warn">Install the Apex WhatsApp Rocket extension in Chrome first, then reload this page.</p>}
            <label className="rk-f">Owners to message
              <span><input type="number" min={1} max={100} value={v.limit} onChange={(e) => setV({ ...v, limit: e.target.value.replace(/\D/g, '') })} /> from the top of this list ({fmt(total)} units, max 100)</span></label>
            <label className="cb"><input type="checkbox" checked={v.skipRecent} onChange={(e) => setV({ ...v, skipRecent: e.target.checked })} />Skip owners who had a WhatsApp in the last 30 days</label>
            <label className="rk-f">Message
              <textarea value={v.message} maxLength={1000} onChange={(e) => setV({ ...v, message: e.target.value })} /></label>
            <span className="faint small">{'{first}'} owner&apos;s first name · {'{me}'} your first name · {'{property}'} e.g. villa DL-J120 in Costa Brava (1) · {'{area}'} e.g. Damac Lagoons</span>
            <label className="rk-f">Seconds between messages
              <span><input type="number" min={20} value={v.gapMin} onChange={(e) => setV({ ...v, gapMin: e.target.value.replace(/\D/g, '') })} /> to <input type="number" min={20} value={v.gapMax} onChange={(e) => setV({ ...v, gapMax: e.target.value.replace(/\D/g, '') })} /> random</span></label>
            {err && <p className="err">{err}</p>}
            <div className="acts"><span className="faint" style={{ marginRight: 'auto' }}>{n && total ? `About ${mins} min` : ''}</span>
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn primary" disabled={bad || busy || !ext} onClick={start}>{busy ? 'Starting…' : `Send to ${Math.min(n || 0, total)} owners`}</button></div>
          </>
        )}
        {err && live && <p className="err">{err}</p>}
      </div>
    </div>
  );
}

// ── Lookup tab ──────────────────────────────────────────────────────────────
// Finds the registered unit and owner from a listing link or DEWA number. Kept apart from the Owners list:
// results go into their own "Lookups" area and open in the normal unit panel (call, notes, WhatsApp).
function Lookup({ onOpen }) {
  const [mode, setMode] = useState('link');
  const [url, setUrl] = useState('');
  const [card, setCard] = useState('');
  const [dewa, setDewa] = useState('');
  const [st, setSt] = useState(null);
  const [res, setRes] = useState(null);
  const [recent, setRecent] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const refresh = useCallback(() => {
    api('/api/lookup?action=status').then(setSt).catch((e) => setErr(e.message));
    api('/api/lookup?action=recent').then((j) => setRecent(j.rows)).catch(() => {});
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function search() {
    setErr(''); setRes(null); setBusy('search');
    try {
      const j = await api('/api/lookup?action=search', { method: 'POST', body: mode === 'dewa' ? { dewa } : { url, card } });
      setRes(j);
    } catch (e) { setErr(e.message); }
    setBusy(''); refresh();
  }
  async function owner(c) {
    if (c.unitId) return onOpen(c.unitId);
    setErr(''); setBusy('owner' + c.i);
    try {
      const j = await api('/api/lookup?action=owner', { method: 'POST', body: { lookupId: res.lookupId, i: c.i } });
      setRes((r) => ({ ...r, candidates: r.candidates.map((x) => (x.i === c.i ? { ...x, unitId: j.unitId } : x)) }));
      onOpen(j.unitId);
    } catch (e) { setErr(e.message); }
    setBusy(''); refresh();
  }
  const prop = (p) => [p.building_name_en || p.project_name_en, p.property_number && `unit ${p.property_number}`].filter(Boolean).join(', ');
  const propSub = (p) => [p.master_project_en, p.area_name_en, p.rooms_en, p.actual_area && `${fmt(Math.round(p.actual_area * 10.7639))} sq ft`, p.property_sub_type_en || p.property_type_en].filter(Boolean).join(' · ');
  const ready = mode === 'dewa' ? /\d{5,}/.test(dewa) : /^https?:\/\//i.test(url.trim());

  const go = (e) => { e.preventDefault(); if (ready && !busy && st?.configured) search(); };
  return (
    <main className="lk">
      <div className="lk-hero">
        {st && (st.configured
          ? <span className="pill ok"><span className="dot t" />Connected{st.credits != null ? ` · ${st.credits} credits` : ''}</span>
          : <span className="pill warn"><span className="dot v" />Not connected</span>)}
        <h1>Find any owner</h1>
        <p>Paste a listing link or a DEWA number to see who owns the unit.</p>
      </div>

      <form className="lk-search" onSubmit={go}>
        <div className="seg">
          <button type="button" className={mode === 'link' ? 'on' : ''} onClick={() => setMode('link')}>Listing link</button>
          <button type="button" className={mode === 'dewa' ? 'on' : ''} onClick={() => setMode('dewa')}>DEWA number</button>
        </div>
        <div className="lk-bar">
          <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M13.5 13.5 18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          {mode === 'link'
            ? <input key="u" type="url" autoFocus placeholder="https://www.propertyfinder.ae/en/plp/…" value={url} onChange={(e) => setUrl(e.target.value)} />
            : <input key="d" inputMode="numeric" autoFocus placeholder="DEWA premise number, e.g. 2015846395" value={dewa} onChange={(e) => setDewa(e.target.value.replace(/\D/g, ''))} />}
          <button className="btn primary" disabled={!ready || !!busy || (st && !st.configured)}>{busy === 'search' ? 'Searching…' : 'Find unit'}</button>
        </div>
        {mode === 'link' && (
          <div className="lk-permit">
            <div className="lk-permit-h"><b>Permit card</b><span>Copy everything in the listing&apos;s permit section. Most listings need it.</span></div>
            <textarea placeholder="Paste the permit card text here" value={card} onChange={(e) => setCard(e.target.value)} />
          </div>
        )}
        {st && !st.configured && <p className="err c">Add the API key in Vercel to switch this on (DXB_HAWK_KEY).</p>}
        {err && <p className="err c">{err}</p>}
        <div className="lk-meta">
          <span>{st ? `${st.used} of ${st.cap} lookups today` : ' '}</span>
          <span className="sep" /><span>Find unit <b>2 credits</b></span>
          <span className="sep" /><span>Get owner <b>3 credits</b></span>
          <span className="sep" /><span>Already found <b>free</b></span>
        </div>
      </form>

      {res && (
        <section className="lk-sec">
          <h4>{res.candidates.length > 1 ? `${res.candidates.length} possible units · pick the right one` : 'Unit found'}</h4>
          {res.candidates.map((c) => (
            <div className="lk-row" key={c.i}>
              <div className="lk-ico" aria-hidden="true">{(c.property?.property_number || '#').slice(0, 4)}</div>
              <div className="lk-main"><b>{prop(c.property) || 'Registered unit'}</b><span>{propSub(c.property)}</span></div>
              <button className={c.unitId ? 'btn' : 'btn primary'} disabled={!!busy} onClick={() => owner(c)}>
                {c.unitId ? 'Open' : busy === 'owner' + c.i ? 'Getting owner…' : 'Get owner'}</button>
            </div>
          ))}
        </section>
      )}

      <section className="lk-sec">
        <h4>Recent lookups</h4>
        {!recent ? <p className="muted c">Loading…</p> : recent.length === 0
          ? <div className="lk-empty">Nothing looked up yet. Owners you find appear here for the whole team.</div>
          : recent.map((r) => (
            <button className="lk-row link-row" key={r.unit_id} onClick={() => onOpen(r.unit_id)}>
              <div className="lk-ico" aria-hidden="true">{String(r.unit_no || '#').slice(0, 4)}</div>
              <div className="lk-main">
                <b>{titleCase(r.property?.building_name_en || r.property?.project_name_en)} {r.unit_no}</b>
                <span>{titleCase(r.owners) || 'Owner not listed'}{r.masked ? <> · <span className="ph">{r.masked}</span></> : ''}{r.previous_n ? ` · previously ${titleCase(r.previous)}` : ''}</span>
              </div>
              <span className="lk-by">{r.by_name}<br />{fdt(r.created_at)}</span>
            </button>
          ))}
      </section>
    </main>
  );
}

const ACTIVITY_LABEL = {
  searched: 'Searched', opened_unit: 'Opened a unit', call_sent: 'Sent a call to phone', call_dialled: 'Tapped Call on phone',
  outcome: 'Logged an outcome', copy_blocked: 'Tried to copy owner data', number_copied: 'Copied a number', copy_number_blocked: 'Tried to copy a number someone else is working',
  whatsapp_unavailable: 'Number not on WhatsApp', target_set: 'Set their daily call target', report_optin: 'Signed an owner up for monthly reports', kendal_push: 'Sent a lead to Kendal', rocket_started: 'Started a WhatsApp rocket', rocket_stopped: 'Stopped a WhatsApp rocket', rocket_sent: 'WhatsApp rocket sent', rocket_failed: 'WhatsApp rocket not sent', rocket_number: 'Rocket fetched a number', report_optout: 'Took an owner off monthly reports', limit_hit: 'Hit a daily limit',
  call_blocked_hours: 'Tried to call outside 9am–6pm', dial_refused: 'Tapped an expired call', phone_alerts_on: 'Turned on phone alerts',
  note_added: 'Added a note', call_blocked_hold: 'Tried to call an owner someone else is working', call_hold_override: 'Called an owner someone else was working', lookup_property: 'Looked up a unit', lookup_owner: 'Looked up an owner', lookup_failed: 'Lookup failed', whatsapp_opened: 'Sent a WhatsApp follow-up', whatsapp_skipped: 'Skipped the WhatsApp follow-up',
};
const ACTIVITY_BAD = ['call_blocked_hold', 'copy_blocked', 'limit_hit', 'call_blocked_hours', 'dial_refused'];

// ── Dashboard: managers see their team, directors and admins see every team ──
// ── Call out mode ─────────────────────────────────────────────────────────
// phase: 'countdown' (10s before the start), 'live', 'done' (finished in the last 15 min) or null
function calloutPhase(co) {
  const c = co?.callout;
  if (!c) return null;
  const now = Date.now() + (co.offset || 0);
  if (c.running && now < new Date(c.startsAt).getTime()) return 'countdown';
  if (c.running && now < new Date(c.endsAt).getTime()) return 'live';
  return 'done';
}
const coNow = (co) => Date.now() + (co?.offset || 0);
const mmss = (ms) => { const t = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
const CO_MODE = { calls: 'Most calls wins', hot: 'Most hot leads wins', points: 'Points: call 1, hot lead 5' };
const coScore = (co, b) => (co.callout.mode === 'hot' ? b.hot : co.callout.mode === 'points' ? b.points : b.calls);
const coUnit = (mode) => (mode === 'hot' ? 'hot' : mode === 'points' ? 'pts' : 'calls');
const pl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10 < 4 ? n % 10 : 0] || 'th');

function StartCallout({ onClose, onStarted, realRunning, testReady }) {
  const [info, setInfo] = useState(null);
  const [v, setV] = useState({ minutes: 45, custom: '', teams: [], target: 15, prize: 'Lunch on Mahan', mode: 'calls', test: !!realRunning && !!testReady });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/api/desk?action=calloutTeams').then(setInfo).catch((e) => setErr(e.message)); }, []);
  const mins = v.minutes === 'custom' ? Number(v.custom) || 0 : v.minutes;
  const manager = info?.role === 'manager';
  const people = info ? (manager ? info.teams.filter((t) => t.team === (info.myTeam || 'No team'))
    : v.teams.length ? info.teams.filter((t) => v.teams.includes(t.team)) : info.teams).reduce((a, t) => a + t.people, 0) : 0;
  const toggle = (t) => setV({ ...v, teams: v.teams.includes(t) ? v.teams.filter((x) => x !== t) : [...v.teams, t] });
  async function start() {
    if (mins < 5 || mins > 180) return setErr('Pick between 5 and 180 minutes.');
    if (realRunning && !v.test) return setErr('A call out is already running. Wait for it to finish first.');
    setBusy(true); setErr('');
    try { await api('/api/desk?action=calloutStart', { method: 'POST', body: { ...v, minutes: mins } }); onStarted(); }
    catch (e) { setErr(e.message); setBusy(false); }
  }
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="box co-setup" role="dialog" aria-label="Start a call out">
        <div><h3>{realRunning ? 'Test mode' : 'Start a call out'}</h3>
          <p className="muted">{v.test ? 'A practice run on your screen and the TV only. Nobody else sees it or is switched into it.' : 'Everyone in it switches into call out mode after a 10 second countdown. Only calls dialled during the timer count.'}</p></div>
        <div className="co-f"><span className="lbl">How long</span>
          <div className="co-chips">{[15, 30, 45, 60].map((m) => <button key={m} className={v.minutes === m ? 'on' : ''} onClick={() => setV({ ...v, minutes: m })}>{m} min</button>)}
            <button className={v.minutes === 'custom' ? 'on' : ''} onClick={() => setV({ ...v, minutes: 'custom' })}>Custom</button>
            {v.minutes === 'custom' && <input type="number" min="5" max="180" placeholder="Minutes" value={v.custom} onChange={(e) => setV({ ...v, custom: e.target.value })} autoFocus />}</div></div>
        <div className="co-f"><span className="lbl">Who's in</span>
          {!info ? <span className="faint">Loading…</span> : manager ? <span>Your team ({info.myTeam || 'No team'}) · {pl(people, 'person').replace('persons', 'people')}</span>
            : <div className="co-teams">
              <label className="cb"><input type="checkbox" checked={v.teams.length === 0} onChange={() => setV({ ...v, teams: [] })} />Everyone ({pl(info.teams.reduce((a, t) => a + t.people, 0), 'person').replace('persons', 'people')})</label>
              {info.teams.map((t) => <label key={t.team} className="cb"><input type="checkbox" checked={v.teams.includes(t.team)} onChange={() => toggle(t.team)} />{t.team} ({t.people})</label>)}
            </div>}</div>
        <div className="co-two">
          <label className="co-f"><span className="lbl">Target per person</span><input type="number" min="0" value={v.target} onChange={(e) => setV({ ...v, target: e.target.value })} /></label>
          <label className="co-f"><span className="lbl">Prize (optional)</span><input maxLength={80} placeholder="e.g. Lunch on Mahan" value={v.prize} onChange={(e) => setV({ ...v, prize: e.target.value })} /></label>
        </div>
        <div className="co-f"><span className="lbl">What wins</span>
          <div className="co-chips round">{[['calls', 'Most calls'], ['hot', 'Most hot leads'], ['points', 'Points (call 1, hot 5)']].map(([k, l]) =>
            <button key={k} className={v.mode === k ? 'on' : ''} onClick={() => setV({ ...v, mode: k })}>{l}</button>)}</div></div>
        <label className={`co-testmode${v.test ? ' on' : ''}`}><input type="checkbox" checked={v.test} disabled={realRunning || !testReady} onChange={(e) => setV({ ...v, test: e.target.checked })} />
          <span><b>Test mode</b> Only you see it, with made-up numbers, so you can check the screens and the TV. Nobody else is switched into it, and a real call out that's running carries on as normal.
            {!testReady ? <em className="co-testnote">Test mode isn't switched on yet: the site needs the latest desk.js and callout.js.</em>
              : realRunning && <em className="co-testnote">A real call out is running, so only a test can be started until it ends.</em>}</span></label>
        {err && <p className="err" style={{ margin: 0 }}>{err}</p>}
        <div className="co-foot"><span className="muted">{people ? `${pl(people, 'person').replace('persons', 'people')} · team target ${(Number(v.target) || 0) * people} calls` : ''}</span>
          <div style={{ display: 'flex', gap: 8 }}><button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={busy || !info} onClick={start}>{busy ? 'Starting…' : `Start ${mins || ''} min ${v.test ? 'test' : 'call out'}`}</button></div></div>
      </div>
    </div>
  );
}

function CalloutCountdown({ co }) {
  const left = Math.ceil((new Date(co.callout.startsAt).getTime() - coNow(co)) / 1000);
  return (
    <div className="co-cover" role="status" aria-live="polite">
      <span className="co-kicker">CALL OUT · {co.callout.minutes} MIN{co.callout.prize ? ` · ${co.callout.prize.toUpperCase()}` : ''}</span>
      <b className="co-big">{Math.max(1, left)}</b>
      <span className="co-sub">Get your phone ready. {CO_MODE[co.callout.mode]}.</span>
    </div>
  );
}

// Call out bar: sits where the daily race bar normally is. Brokers keep their normal list, filters and calling.
function CalloutBar({ co, boss, onChange }) {
  const c = co.callout;
  const board = co.board || [];
  const myIdx = board.findIndex((b) => b.me);
  const me = board[myIdx];
  const total = board.reduce((a, b) => a + b.calls, 0);
  const teamTarget = (c.target || 0) * board.length;
  const now = coNow(co);
  const start = new Date(c.startsAt).getTime(), end = new Date(c.endsAt).getTime();
  // Overtakes since the last poll go in the ticker with the hot leads
  const prev = useRef(null);
  const [moves, setMoves] = useState([]);
  const order = board.map((b) => b.name).join('|');
  useEffect(() => {
    const names = order ? order.split('|') : [];
    if (prev.current) {
      const out = [];
      names.forEach((n, i) => { const was = prev.current.indexOf(n); if (was > i && prev.current[i] && prev.current[i] !== n && i < 5) out.push(`${n.split(' ')[0]} passed ${prev.current[i].split(' ')[0]} for ${ordinal(i + 1)}`); });
      if (out.length) setMoves((m) => [...out, ...m].slice(0, 3));
    }
    prev.current = names;
  }, [order]);
  const ticker = [...moves, ...(co.recent || []).map((r) => `${r.name.split(' ')[0]}: ${r.what}`)].slice(0, 3);
  const ahead = myIdx > 0 && me ? coScore(co, board[myIdx - 1]) - coScore(co, me) : null;
  const lead = myIdx === 0 && board[1] ? coScore(co, me) - coScore(co, board[1]) : null;
  const control = (a) => api(`/api/desk?action=${a}`, { method: 'POST' }).then(onChange).catch(() => {});
  return (
    <div className="gut"><section className="co-bar">
      <div className="co-clock"><span className="co-kicker"><i />{c.test ? 'TEST CALL OUT · ONLY YOU' : 'CALL OUT LIVE'}</span>
        <b className="n">{mmss(end - now)}</b>
        <span className="co-dim">left · ends {new Date(end).toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' })}{c.prize ? ` · ${c.prize}` : ''}</span></div>
      <div className="co-mid">
        <div className="co-dim co-row"><span>Team total <b className="n">{total}</b> {total === 1 ? 'call' : 'calls'}{teamTarget ? ` · target ${teamTarget}` : ''} · {CO_MODE[c.mode]}</span><span>{mmss(now - start)} in</span></div>
        <div className="co-track"><i style={{ width: `${Math.min(100, teamTarget ? (total / teamTarget) * 100 : ((now - start) / (end - start)) * 100)}%` }} /></div>
        <div className="co-lbs">{board.slice(0, 6).map((b, i) => (
          <span key={b.name + i} className={b.me ? 'me' : ''}><em>{i + 1}</em>{b.me ? 'You' : b.name.split(' ')[0]} <b className="n">{coScore(co, b)}</b></span>))}
          {board.length > 6 && <span className="more">+{board.length - 6}</span>}</div>
        {ticker.length > 0 && <div className="co-tick">{ticker.map((t, i) => <span key={i}>{t}</span>)}</div>}
      </div>
      <div className="co-me"><span className="co-dim">{me ? 'YOU' : 'WATCHING'}</span>
        <b>{me && (coScore(co, me) || myIdx > 0) ? ordinal(myIdx + 1) : me ? '–' : `${board.length}`}</b>
        {!me && <span className="co-dim">people in this call out</span>}
        <span className="co-dim">{me ? `${pl(me.calls, 'call')}${me.hot ? ` · ${me.hot} hot` : ''}` : ''}
          {ahead != null ? ` · ${ahead} behind ${board[myIdx - 1].name.split(' ')[0]}` : lead ? ` · ${lead} ahead` : ''}</span>
        {boss && <span className="co-ctl"><button onClick={() => control('calloutExtend')}>+10 min</button>
          <button onClick={() => { if (window.confirm('End the call out now for everyone?')) control('calloutEnd'); }}>End now</button></span>}</div>
    </section></div>
  );
}

function CalloutResults({ co, onClose }) {
  const c = co.callout;
  const board = co.board || [];
  const total = board.reduce((a, b) => a + b.calls, 0);
  const hot = board.reduce((a, b) => a + b.hot, 0);
  const wa = board.reduce((a, b) => a + b.wa, 0);
  const winner = board[0] && coScore(co, board[0]) > 0 ? board[0] : null;
  const myIdx = board.findIndex((b) => b.me);
  const me = board[myIdx];
  const topHot = [...board].sort((a, b) => b.hot - a.hot)[0];
  const ranked = board.filter((b) => coScore(co, b) > 0);
  const podium = [ranked[1], ranked[0], ranked[2]];
  return (
    <div className="co-cover results" role="dialog" aria-label="Call out results">
      <span className="co-kicker">CALL OUT FINISHED · {c.minutes} MIN</span>
      <h2>{winner ? `${winner.name.split(' ')[0]} wins${c.prize ? ` ${c.prize.charAt(0).toLowerCase() + c.prize.slice(1)}` : '!'}` : 'Call out finished'}</h2>
      <span className="co-sub">{pl(total, 'call')} across the team{c.target ? ` · target was ${c.target * board.length}` : ''} · {pl(hot, 'hot lead')} · {pl(wa, 'WhatsApp')} sent</span>
      <div className="co-podium">{podium.map((b, i) => b ? (
        <div key={i} className={'co-step s' + [2, 1, 3][i]}><b>{b.name.split(' ')[0]}</b><span>{pl(b.calls, 'call')} · {b.hot} hot</span><div>{[2, 1, 3][i]}</div></div>
      ) : <div key={i} className={'co-step s' + [2, 1, 3][i] + ' gap'} />)}</div>
      <div className="co-awards">
        {topHot && topHot.hot > 0 && <div><span>MOST HOT LEADS</span><b>{topHot.name.split(' ')[0]} · {topHot.hot}</b></div>}
        {me && <div><span>YOUR RESULT</span><b>{ordinal(myIdx + 1)} · {pl(me.calls, 'call')}{me.hot ? ` · ${me.hot} hot` : ''}</b></div>}
        <div><span>PEOPLE CALLING</span><b>{board.filter((b) => b.calls > 0).length} of {board.length}</b></div>
      </div>
      <button className="co-done" onClick={onClose}>Back to my owners</button>
    </div>
  );
}

// The Apex Homes DXB logo (from the brand SVG): black parts follow the text colour
const APEX_LOGO = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"236 540 600 312\"><path d=\"M0 0 C2.25 0.875 2.25 0.875 3.25 1.875 C3.63381293 7.19544129 2.76393526 10.77674674 0.625 15.625 C-3.16368341 24.50078736 -5.94944266 33.64905046 -8.75 42.875 C-9.41 42.875 -10.07 42.875 -10.75 42.875 C-10.903479 43.71200439 -10.903479 43.71200439 -11.06005859 44.56591797 C-12.50511524 52.13228937 -14.4136285 59.55316673 -16.375 67 C-16.69984375 68.24265625 -17.0246875 69.4853125 -17.359375 70.765625 C-18.1537028 73.80276069 -18.95063126 76.83918794 -19.75 79.875 C-18.56510986 79.62322998 -17.38021973 79.37145996 -16.15942383 79.11206055 C-4.24691014 76.62820714 7.67261108 74.66886357 19.73364258 73.06469727 C22.57953048 72.68522917 25.42353931 72.29345331 28.26757812 71.90039062 C42.16407639 70.0064398 55.95724417 68.69860978 70 68.6875 C70.86109375 68.67525391 71.7221875 68.66300781 72.609375 68.65039062 C73.434375 68.64845703 74.259375 68.64652344 75.109375 68.64453125 C75.83608398 68.64042236 76.56279297 68.63631348 77.31152344 68.63208008 C79.25 68.875 79.25 68.875 82.25 70.875 C83.06757318 75.32623178 82.34669509 78.27844186 80.0625 82.0625 C69.03133958 97.29847921 51.78401809 107.79654477 36.25 117.875 C35.64236816 118.27299805 35.03473633 118.67099609 34.40869141 119.08105469 C25.70669657 124.76142662 16.74927144 129.90230986 7.625 134.875 C6.59318604 135.43936768 5.56137207 136.00373535 4.49829102 136.58520508 C3.51658936 137.1139624 2.5348877 137.64271973 1.5234375 138.1875 C0.65122559 138.65800781 -0.22098633 139.12851562 -1.11962891 139.61328125 C-8.86142531 143.32681418 -16.1142951 144.05356904 -24.4375 141.9375 C-30.07707994 138.42606344 -35.41463493 133.53700419 -37.25 126.9375 C-37.9465083 122.25265253 -37.94264156 117.47968144 -38 112.75 C-38.01450195 111.60349976 -38.01450195 111.60349976 -38.02929688 110.43383789 C-37.99967584 105.55006894 -37.2988991 101.50940446 -35.75 96.875 C-39.62826094 97.97597011 -43.506007 99.07873399 -47.38330078 100.18310547 C-48.70022041 100.55793844 -50.01727559 100.93229551 -51.33447266 101.30615234 C-53.23636555 101.84605381 -55.13771915 102.3878539 -57.0390625 102.9296875 C-58.18068848 103.25437012 -59.32231445 103.57905273 -60.49853516 103.91357422 C-61.57151855 104.23084473 -62.64450195 104.54811523 -63.75 104.875 C-64.80461426 105.13643799 -65.85922852 105.39787598 -66.94580078 105.66723633 C-70.52575862 107.20911787 -71.43055257 108.77473351 -73.328125 112.14453125 C-73.93140625 113.19833984 -74.5346875 114.25214844 -75.15625 115.33789062 C-75.7646875 116.44326172 -76.373125 117.54863281 -77 118.6875 C-77.62390625 119.78126953 -78.2478125 120.87503906 -78.890625 122.00195312 C-81.46263767 126.55009191 -83.9027519 130.97890123 -85.75 135.875 C-86.41 135.875 -87.07 135.875 -87.75 135.875 C-88.02070313 136.72707031 -88.29140625 137.57914063 -88.5703125 138.45703125 C-89.76477158 141.91779844 -91.12747442 145.22216445 -92.625 148.5625 C-93.11742187 149.68011719 -93.60984375 150.79773438 -94.1171875 151.94921875 C-95.75208947 154.87874405 -96.85464231 156.2463613 -99.75 157.875 C-102.875 158.1875 -102.875 158.1875 -105.75 157.875 C-107.75 155.875 -107.75 155.875 -108.03515625 153.56420898 C-107.7006997 150.41006612 -106.77986323 148.58362107 -105.1875 145.84765625 C-104.6411792 144.89640869 -104.0948584 143.94516113 -103.53198242 142.96508789 C-102.94392822 141.96598389 -102.35587402 140.96687988 -101.75 139.9375 C-101.16001221 138.9158374 -100.57002441 137.8941748 -99.9621582 136.84155273 C-98.78066442 134.79682733 -97.59493712 132.75454173 -96.40478516 130.71484375 C-94.22291472 126.97044762 -92.0795528 123.20474963 -89.9375 119.4375 C-88.87559269 117.58299383 -87.81336944 115.72866818 -86.75 113.875 C-95.33021087 115.81149848 -102.79023102 119.05450031 -110.625 123 C-112.80729788 124.09114894 -114.99210579 125.17729581 -117.1796875 126.2578125 C-118.13085449 126.73621582 -119.08202148 127.21461914 -120.06201172 127.70751953 C-122.64757666 128.83051422 -124.97361237 129.4409335 -127.75 129.875 C-127.75 130.535 -127.75 131.195 -127.75 131.875 C-130.37433632 133.70408289 -132.9908445 134.97510652 -135.9453125 136.203125 C-139.9846411 137.91807917 -143.75640843 140.01147067 -147.5625 142.1875 C-148.26101074 142.58122803 -148.95952148 142.97495605 -149.67919922 143.38061523 C-153.64999126 145.63018037 -157.52566057 147.98420325 -161.375 150.4375 C-164.94991392 152.61982519 -167.46867552 153.64344286 -171.75 152.875 C-172.75 151.875 -172.75 151.875 -173.25 148.6875 C-172.75 144.875 -172.75 144.875 -170.0625 141.9375 C-162.05986152 135.90351058 -153.29603011 131.021319 -144.375 126.5 C-143.72152588 126.16629395 -143.06805176 125.83258789 -142.39477539 125.48876953 C-138.25178389 123.43757481 -134.22992748 122.02102796 -129.75 120.875 C-129.75 120.215 -129.75 119.555 -129.75 118.875 C-129.03457031 118.59301758 -128.31914062 118.31103516 -127.58203125 118.02050781 C-124.30320227 116.72573091 -121.02659818 115.42541132 -117.75 114.125 C-116.62464844 113.6815625 -115.49929688 113.238125 -114.33984375 112.78125 C-107.30577026 109.98806815 -107.30577026 109.98806815 -100.48046875 106.73046875 C-95.80732603 104.30504272 -90.86040745 102.80123396 -85.84179688 101.25195312 C-77.7758194 98.58268916 -73.92121483 93.01455884 -69.25 86.25 C-68.477771 85.14543457 -68.477771 85.14543457 -67.68994141 84.01855469 C-64.34648984 79.22261181 -61.05754033 74.39039569 -57.77416992 69.55322266 C-52.72215565 62.11468321 -47.55729712 54.85249054 -42.0078125 47.77734375 C-39.87737791 45.03874011 -37.83405325 42.2570348 -35.8125 39.4375 C-28.90628788 29.89311485 -21.58077322 20.72260905 -13.875 11.8125 C-13.33979736 11.19342773 -12.80459473 10.57435547 -12.25317383 9.93652344 C-10.76734239 8.23483779 -9.26643609 6.54944093 -7.75 4.875 C-7.28916016 4.36453125 -6.82832031 3.8540625 -6.35351562 3.328125 C-3.08435411 -0.14019791 -3.08435411 -0.14019791 0 0 Z \" fill=\"currentColor\" transform=\"translate(561.75,550.125)\"/><path d=\"M0 0 C1.17175781 0.01353516 1.17175781 0.01353516 2.3671875 0.02734375 C2.94726562 0.03894531 3.52734375 0.05054688 4.125 0.0625 C-1.26518939 12.01465909 -16.0625188 19.68654028 -26.5625 26.5 C-27.13637451 26.87412018 -27.71024902 27.24824036 -28.30151367 27.63369751 C-35.75551102 32.49014876 -43.25036567 37.20103385 -51.04296875 41.49609375 C-53.81035608 43.02674522 -56.49717184 44.6509468 -59.1875 46.3125 C-67.52219424 51.2726595 -74.85444582 55.04619049 -84.875 53.0625 C-87.87385336 50.97412653 -89.2510762 48.31034759 -90.875 45.0625 C-91.14331512 41.94435302 -91.10673204 38.81588732 -91.125 35.6875 C-91.145625 34.84316406 -91.16625 33.99882813 -91.1875 33.12890625 C-91.2299144 26.09871979 -89.81264729 19.80042734 -87.875 13.0625 C-62.38148415 7.76711095 -62.38148415 7.76711095 -50.5703125 6.421875 C-47.78251481 6.1361562 -47.78251481 6.1361562 -44.875 5.0625 C-42.36835856 4.71638025 -39.86945064 4.40565776 -37.35546875 4.125 C-36.61927811 4.04000244 -35.88308746 3.95500488 -35.12458801 3.86743164 C-32.77089476 3.59609063 -30.41674283 3.32902713 -28.0625 3.0625 C-25.71904165 2.79539252 -23.37570009 2.52734085 -21.032547 2.25756836 C-19.57577991 2.09002918 -18.11882762 1.92408992 -16.66166687 1.76000977 C-1.13953026 -0.01726561 -1.13953026 -0.01726561 0 0 Z \" fill=\"var(--logo-bg,#000)\" transform=\"translate(625.875,628.9375)\"/><path d=\"M0 0 C8.04656452 -0.44877078 13.88590802 1.24712644 20.26171875 6.26953125 C25.97710491 12.99873314 26.89991532 19.65387752 26.26171875 28.26953125 C24.85881397 35.12949782 21.02348021 40.29695052 15.5859375 44.59375 C8.75172101 48.76452452 0.29055085 48.27985552 -7.32421875 46.75 C-14.29076572 44.26893152 -19.44336503 38.76089494 -22.73828125 32.26953125 C-24.40368337 24.70139073 -23.78924794 16.94226844 -19.73828125 10.26953125 C-18.01953125 8.22265625 -18.01953125 8.22265625 -16.23828125 6.51953125 C-15.65046875 5.9471875 -15.06265625 5.37484375 -14.45703125 4.78515625 C-9.85383134 0.72597088 -5.80315684 0.57120945 0 0 Z \" fill=\"var(--logo-bg,#000)\" transform=\"translate(589.73828125,747.73046875)\"/><path d=\"M0 0 C27.45 0 27.45 0 32.875 5 C33.44992187 5.515625 34.02484375 6.03125 34.6171875 6.5625 C37.84137983 9.91420276 37.38631746 13.74829623 37.3515625 18.16796875 C36.69699469 23.44087613 33.74144974 26.31472606 30.0625 29.875 C24.94499479 32.66636648 18.79601696 32.12497731 13.125 32.0625 C12.34125 32.05798828 11.5575 32.05347656 10.75 32.04882812 C8.83329986 32.03714093 6.91663952 32.01920908 5 32 C5 36.95 5 41.9 5 47 C3.35 47 1.7 47 0 47 C0 31.49 0 15.98 0 0 Z \" fill=\"var(--logo-bg,#000)\" transform=\"translate(299,748)\"/><path d=\"M0 0 C2.31 0 4.62 0 7 0 C12.94515909 12.79459804 12.94515909 12.79459804 14.5625 16.6875 C15.73053345 19.37905535 16.97823104 21.95307526 18.3125 24.5625 C20.45006749 28.79853314 22.42066974 33.08769591 24.3125 37.4375 C24.82425781 38.61183594 25.33601563 39.78617188 25.86328125 40.99609375 C27 44 27 44 27 47 C25.35 47 23.7 47 22 47 C21.35309078 45.3962669 20.70751236 43.79199694 20.0625 42.1875 C19.70285156 41.29417969 19.34320313 40.40085937 18.97265625 39.48046875 C18.26386514 37.6729091 17.6139753 35.84192591 17 34 C8.09 34 -0.82 34 -10 34 C-10.33 35.32 -10.66 36.64 -11 38 C-11.65789642 39.59586121 -12.34647343 41.17936107 -13.0625 42.75 C-13.42472656 43.54921875 -13.78695312 44.3484375 -14.16015625 45.171875 C-14.43730469 45.77515625 -14.71445313 46.3784375 -15 47 C-16.65 47 -18.3 47 -20 47 C-17.56123394 40.44331748 -15.14346689 33.96230869 -11.8984375 27.7578125 C-11.02173856 26.04253197 -10.25882276 24.27058644 -9.5 22.5 C-8.42729198 19.99701462 -7.31806653 17.65365266 -6.0625 15.25 C-3.56316912 10.34783749 -1.7945658 5.19278615 0 0 Z \" fill=\"currentColor\" transform=\"translate(251,748)\"/><path d=\"M0 0 C1.32 0 2.64 0 4 0 C4 15.84 4 31.68 4 48 C2.68 48 1.36 48 0 48 C0 35.79 0 23.58 0 11 C-0.66 11 -1.32 11 -2 11 C-2.23074219 11.81726563 -2.46148438 12.63453125 -2.69921875 13.4765625 C-4.28524883 17.77265598 -6.45106304 21.46593499 -8.8125 25.375 C-9.23853516 26.09171875 -9.66457031 26.8084375 -10.10351562 27.546875 C-10.96020211 28.9828941 -11.82360247 30.41493034 -12.69384766 31.84277344 C-13.59135339 33.32508384 -14.47032739 34.81872443 -15.33349609 36.32128906 C-15.76355957 37.0531543 -16.19362305 37.78501953 -16.63671875 38.5390625 C-17.01916748 39.20373535 -17.40161621 39.8684082 -17.7956543 40.55322266 C-18.19308838 41.03065918 -18.59052246 41.5080957 -19 42 C-19.99 42 -20.98 42 -22 42 C-22.44730469 41.154375 -22.89460937 40.30875 -23.35546875 39.4375 C-26.37081865 33.77970061 -29.40989968 28.18469321 -32.8671875 22.78125 C-38 14.71034483 -38 14.71034483 -38 12 C-38.66 12 -39.32 12 -40 12 C-40 23.88 -40 35.76 -40 48 C-41.65 48 -43.3 48 -45 48 C-45 32.49 -45 16.98 -45 1 C-43.35 1 -41.7 1 -40 1 C-38.41015625 2.8359375 -38.41015625 2.8359375 -37.0625 5.375 C-36.5571875 6.2928125 -36.051875 7.210625 -35.53125 8.15625 C-35.0259375 9.0946875 -34.520625 10.033125 -34 11 C-33.02997238 12.63047195 -32.05094751 14.25562855 -31.0625 15.875 C-30.04059509 17.58269255 -29.01984239 19.29107491 -28 21 C-27.36191406 22.06476562 -26.72382812 23.12953125 -26.06640625 24.2265625 C-25.42574219 25.30679688 -24.78507813 26.38703125 -24.125 27.5 C-23.52945313 28.5003125 -22.93390625 29.500625 -22.3203125 30.53125 C-21 33 -21 33 -21 35 C-20.34 35 -19.68 35 -19 35 C-18.66742187 33.80117188 -18.66742187 33.80117188 -18.328125 32.578125 C-16.6206659 27.97802932 -14.2488013 23.96041157 -11.75 19.75 C-11.25491943 18.91041748 -10.75983887 18.07083496 -10.24975586 17.20581055 C-9.27291506 15.5500694 -8.29437236 13.89533092 -7.31396484 12.24169922 C-6.20851213 10.35573362 -5.14074908 8.44774834 -4.08203125 6.53515625 C-3.58058594 5.63667969 -3.07914063 4.73820313 -2.5625 3.8125 C-1.94568359 2.67748047 -1.94568359 2.67748047 -1.31640625 1.51953125 C-0.88199219 1.01808594 -0.44757812 0.51664063 0 0 Z \" fill=\"currentColor\" transform=\"translate(685,747)\"/><path d=\"M0 0 C1.36574212 4.39360088 0.17676598 7.72415331 -1.125 12 C-1.59504079 13.60601423 -2.06238614 15.21281927 -2.52734375 16.8203125 C-2.77081543 17.66110352 -3.01428711 18.50189453 -3.26513672 19.36816406 C-4.75157852 24.6916998 -6.02140103 30.07238726 -7.29931641 35.44921875 C-7.49315918 36.24714844 -7.68700195 37.04507813 -7.88671875 37.8671875 C-8.05389404 38.56956543 -8.22106934 39.27194336 -8.39331055 39.99560547 C-9.07438418 42.24575216 -9.69256543 44.03390756 -11 46 C-13.13891602 46.98901367 -13.13891602 46.98901367 -15.75390625 47.66796875 C-16.69041016 47.92126953 -17.62691406 48.17457031 -18.59179688 48.43554688 C-20.06229492 48.80776367 -20.06229492 48.80776367 -21.5625 49.1875 C-23.50195544 49.69935366 -25.44079466 50.21354995 -27.37890625 50.73046875 C-28.67163452 51.06147583 -28.67163452 51.06147583 -29.99047852 51.39916992 C-31.978641 51.82033621 -31.978641 51.82033621 -33 53 C-34.66617115 53.04063832 -36.33388095 53.042721 -38 53 C-36.02964249 48.90647031 -33.57700704 45.29320577 -31 41.5625 C-30.51233154 40.85456299 -30.02466309 40.14662598 -29.5222168 39.41723633 C-25.63203403 33.81554919 -21.54178394 28.39992241 -17.34375 23.02734375 C-14.43955962 19.27609784 -11.66873041 15.43756194 -8.89453125 11.58984375 C-6.01791048 7.6574735 -3.02031612 3.82258759 0 0 Z \" fill=\"var(--logo-bg,#000)\" transform=\"translate(540,589)\"/><path d=\"M0 0 C8.04656452 -0.44877078 13.88590802 1.24712644 20.26171875 6.26953125 C25.97710491 12.99873314 26.89991532 19.65387752 26.26171875 28.26953125 C24.85881397 35.12949782 21.02348021 40.29695052 15.5859375 44.59375 C8.75172101 48.76452452 0.29055085 48.27985552 -7.32421875 46.75 C-14.29076572 44.26893152 -19.44336503 38.76089494 -22.73828125 32.26953125 C-24.40368337 24.70139073 -23.78924794 16.94226844 -19.73828125 10.26953125 C-18.01953125 8.22265625 -18.01953125 8.22265625 -16.23828125 6.51953125 C-15.65046875 5.9471875 -15.06265625 5.37484375 -14.45703125 4.78515625 C-9.85383134 0.72597088 -5.80315684 0.57120945 0 0 Z M-13.61328125 10.14453125 C-17.82007424 16.33099153 -18.74233206 21.88924021 -17.73828125 29.26953125 C-15.50681372 34.94875976 -11.62071405 38.76691642 -6.73828125 42.26953125 C-1.504004 44.01429033 4.37765802 44.39407258 9.5859375 42.36328125 C14.85414414 39.2324613 19.28785056 35.19113583 21.26171875 29.26953125 C21.73926301 23.40591405 22.12387486 18.08963859 19.57421875 12.70703125 C14.00357839 6.83527519 9.48569664 4.60476759 1.32421875 3.95703125 C-4.52504561 4.14973957 -9.67304418 5.66121166 -13.61328125 10.14453125 Z \" fill=\"currentColor\" transform=\"translate(589.73828125,747.73046875)\"/><path d=\"M0 0 C1.65 0 3.3 0 5 0 C5 15.84 5 31.68 5 48 C3.35 48 1.7 48 0 48 C0 41.07 0 34.14 0 27 C-9.57 27 -19.14 27 -29 27 C-29 33.93 -29 40.86 -29 48 C-30.65 48 -32.3 48 -34 48 C-34 32.49 -34 16.98 -34 1 C-32.35 1 -30.7 1 -29 1 C-29 7.93 -29 14.86 -29 22 C-19.43 22 -9.86 22 0 22 C0 14.74 0 7.48 0 0 Z \" fill=\"currentColor\" transform=\"translate(538,747)\"/><path d=\"M0 0 C10.56 0 21.12 0 32 0 C32 1.65 32 3.3 32 5 C23.09 5 14.18 5 5 5 C5 10.61 5 16.22 5 22 C12.92 22 20.84 22 29 22 C29 23.32 29 24.64 29 26 C21.08 26 13.16 26 5 26 C5 31.94 5 37.88 5 44 C14.24 44 23.48 44 33 44 C33 45.32 33 46.64 33 48 C22.11 48 11.22 48 0 48 C0 32.16 0 16.32 0 0 Z \" fill=\"currentColor\" transform=\"translate(717,747)\"/><path d=\"M0 0 C10.56 0 21.12 0 32 0 C32 1.32 32 2.64 32 4 C23.09 4 14.18 4 5 4 C5 9.61 5 15.22 5 21 C12.92 21 20.84 21 29 21 C29 22.65 29 24.3 29 26 C21.08 26 13.16 26 5 26 C5 31.61 5 37.22 5 43 C14.24 43 23.48 43 33 43 C33 44.32 33 45.64 33 47 C22.11 47 11.22 47 0 47 C0 31.49 0 15.98 0 0 Z \" fill=\"currentColor\" transform=\"translate(360,748)\"/><path d=\"M0 0 C27.45 0 27.45 0 32.875 5 C33.44992187 5.515625 34.02484375 6.03125 34.6171875 6.5625 C37.84137983 9.91420276 37.38631746 13.74829623 37.3515625 18.16796875 C36.69699469 23.44087613 33.74144974 26.31472606 30.0625 29.875 C24.94499479 32.66636648 18.79601696 32.12497731 13.125 32.0625 C12.34125 32.05798828 11.5575 32.05347656 10.75 32.04882812 C8.83329986 32.03714093 6.91663952 32.01920908 5 32 C5 36.95 5 41.9 5 47 C3.35 47 1.7 47 0 47 C0 31.49 0 15.98 0 0 Z M5 4 C5 11.92 5 19.84 5 28 C7.660625 28.0825 10.32125 28.165 13.0625 28.25 C13.8862915 28.28641602 14.71008301 28.32283203 15.55883789 28.36035156 C22.0153656 28.45622145 26.08389072 26.63390515 30.9375 22.25 C32.53810671 18.86047991 32.52150326 15.63603664 32 12 C30.64805213 8.62013032 29.52780769 7.3388395 26.46875 5.375 C22.02712883 3.61435737 18.34034789 3.66699636 13.625 3.8125 C10.77875 3.874375 7.9325 3.93625 5 4 Z \" fill=\"currentColor\" transform=\"translate(299,748)\"/><path d=\"M0 0 C-0.33 1.32 -0.66 2.64 -1 4 C-5 3 -5 3 -6.76953125 2.484375 C-12.55276494 1.22847136 -18.83871957 0.94054881 -24.1875 3.5625 C-26.5068672 6.68164899 -26.77871438 9.16438252 -27 13 C-22.47131582 15.59980018 -17.371637 16.68169798 -12.375 18.05664062 C-1.17901802 21.23147297 -1.17901802 21.23147297 2 26 C2.68681317 30.71185778 2.69895195 34.73650993 0.375 38.9375 C-5.42141646 43.97123008 -10.22210095 44.46849484 -17.73046875 44.296875 C-23.51302257 43.77181635 -28.18402983 42.21064678 -33 39 C-32.67 37.68 -32.34 36.36 -32 35 C-30.35 35.33 -28.7 35.66 -27 36 C-27 36.66 -27 37.32 -27 38 C-21.02609278 39.35973261 -15.09219988 39.68644506 -9 39 C-5.5518732 37.14067097 -5.5518732 37.14067097 -4 34 C-3.16600125 30.91318914 -3.16600125 30.91318914 -4 28 C-7.46403539 25.46260963 -10.6408576 24.46698287 -14.8125 23.625 C-21.43906544 22.07444897 -27.59686229 19.39613019 -32 14 C-32.84678178 10.2953297 -32.80242565 6.56522534 -31.05078125 3.1484375 C-23.99186677 -5.89231732 -9.45842431 -4.72921215 0 0 Z \" fill=\"currentColor\" transform=\"translate(803,751)\"/><path d=\"M0 0 C2.18359375 -0.390625 2.18359375 -0.390625 5 0 C6.93507329 2.06328307 8.46872702 3.94925199 10.0625 6.25 C10.90482473 7.42383691 11.74982965 8.59575574 12.59765625 9.765625 C12.99871582 10.32185547 13.39977539 10.87808594 13.81298828 11.45117188 C15.37213748 13.48556977 17.12821522 15.25357725 19 17 C20.60446931 14.91689914 22.20858518 12.83352773 23.8125 10.75 C24.26431641 10.16347656 24.71613281 9.57695313 25.18164062 8.97265625 C25.62314453 8.39902344 26.06464844 7.82539062 26.51953125 7.234375 C26.95048096 6.67782227 27.38143066 6.12126953 27.82543945 5.54785156 C28.8053163 4.25655678 29.73717798 2.92900558 30.65625 1.59375 C32 0 32 0 34.6875 -0.25 C35.450625 -0.1675 36.21375 -0.085 37 0 C33.86620526 5.73183535 30.2699954 10.85697145 26.27148438 16.01367188 C23.72557824 19.14206028 23.72557824 19.14206028 23.20800781 22.94799805 C24.10780999 25.2793289 25.24503088 27.023749 26.72265625 29.0390625 C27.26083984 29.78414062 27.79902344 30.52921875 28.35351562 31.296875 C29.19946289 32.44929687 29.19946289 32.44929687 30.0625 33.625 C31.18260868 35.15577282 32.29871202 36.68948716 33.41015625 38.2265625 C33.90652588 38.90283691 34.40289551 39.57911133 34.91430664 40.27587891 C36 42 36 42 36 44 C36.99 44.33 37.98 44.66 39 45 C39 45.66 39 46.32 39 47 C36.41796875 47.5546875 36.41796875 47.5546875 33 47 C30.33325992 44.34967785 28.36629855 41.26162397 26.3125 38.125 C25.18796418 36.45798095 24.0592289 34.79378503 22.92578125 33.1328125 C22.43505127 32.38918457 21.94432129 31.64555664 21.4387207 30.87939453 C19.96294664 28.74165524 19.96294664 28.74165524 17 27 C16.690625 28.0209375 16.690625 28.0209375 16.375 29.0625 C14.85020841 32.32000931 12.9748204 34.44701946 10.57421875 37.0859375 C8.91729091 39.1005644 7.74798719 41.15154288 6.5 43.4375 C5.30078125 45.46484375 5.30078125 45.46484375 4 47 C0.6875 47.5 0.6875 47.5 -2 47 C-0.65089758 44.14986742 0.87751976 41.6270221 2.71484375 39.06640625 C3.23626953 38.33486328 3.75769531 37.60332031 4.29492188 36.84960938 C5.10799805 35.71749023 5.10799805 35.71749023 5.9375 34.5625 C10.70432877 27.93658159 10.70432877 27.93658159 15 21 C14.01 20.67 13.02 20.34 12 20 C11.07887413 18.43067445 10.16873608 16.85382178 9.31640625 15.24609375 C7.06073277 11.39739271 4.29647051 7.91047649 1.609375 4.35546875 C0 2 0 2 0 0 Z \" fill=\"currentColor\" transform=\"translate(412,748)\"/><path d=\"M0 0 C7.22364571 6.01970476 8.77862875 14.11451501 11 23 C4.07 23 -2.86 23 -10 23 C-9.10831533 18.54157664 -7.90799356 15.0845124 -6.125 10.9375 C-5.61195313 9.72964844 -5.09890625 8.52179687 -4.5703125 7.27734375 C-3.24987015 4.52149515 -1.94438045 2.33442084 0 0 Z \" fill=\"var(--logo-bg,#000)\" transform=\"translate(254,755)\"/><path d=\"M0 0 C10.03296703 -0.48351648 10.03296703 -0.48351648 14.125 1.5625 C16.61328559 4.79727127 17 6.93536918 17 11 C15.63571607 13.92346557 14.27249091 15.72750909 12 18 C7.98805634 18.27783543 4.02552638 18.0856495 0 18 C0 12.06 0 6.12 0 0 Z \" fill=\"var(--logo-bg,#000)\" transform=\"translate(454,829)\"/><path d=\"M0 0 C9.1796875 -0.1953125 9.1796875 -0.1953125 12 0 C12.66 0.66 13.32 1.32 14 2 C13.96712417 4.72869407 13.43602229 7.2966618 13 10 C13.99 10.33 14.98 10.66 16 11 C16 12.65 16 14.3 16 16 C10.99791398 19.08381031 5.70008452 18.12391488 0 18 C0 12.06 0 6.12 0 0 Z \" fill=\"currentColor\" transform=\"translate(565,829)\"/><path d=\"M0 0 C1.32 0 2.64 0 4 0 C4 15.84 4 31.68 4 48 C2.68 48 1.36 48 0 48 C0 35.79 0 23.58 0 11 C-0.66 11 -1.32 11 -2 11 C-2.66 12.32 -3.32 13.64 -4 15 C-4.66 14.67 -5.32 14.34 -6 14 C-5.60026466 8.6701955 -3.68506131 3.91351525 0 0 Z \" fill=\"currentColor\" transform=\"translate(685,747)\"/><path d=\"M0 0 C10.03296703 -0.48351648 10.03296703 -0.48351648 14.125 1.5625 C16.61328559 4.79727127 17 6.93536918 17 11 C15.63571607 13.92346557 14.27249091 15.72750909 12 18 C7.98805634 18.27783543 4.02552638 18.0856495 0 18 C0 12.06 0 6.12 0 0 Z M2 2 C2 6.62 2 11.24 2 16 C8.39825263 16.47326369 8.39825263 16.47326369 14 14 C15.39551161 8.55212258 15.39551161 8.55212258 13.625 3.5 C9.67400229 1.24228702 6.51004296 1.73470336 2 2 Z \" fill=\"currentColor\" transform=\"translate(454,829)\"/><path d=\"M0 0 C0.99 0.33 1.98 0.66 3 1 C2.4462522 6.10454793 -0.02592796 9.96575557 -2.5625 14.3125 C-2.98724609 15.05306641 -3.41199219 15.79363281 -3.84960938 16.55664062 C-4.89351653 18.37468118 -5.94592192 20.18783748 -7 22 C-8.32 21.67 -9.64 21.34 -11 21 C-9.53171057 15.82064939 -7.18508737 11.65626588 -4.375 7.125 C-3.95476563 6.43664062 -3.53453125 5.74828125 -3.1015625 5.0390625 C-2.07307528 3.35608342 -1.037279 1.67757468 0 0 Z \" fill=\"currentColor\" transform=\"translate(678,759)\"/><path d=\"M0 0 C0.99 0 1.98 0 3 0 C4.37868281 1.62935241 5.71274093 3.29749607 7 5 C7.66 5.33 8.32 5.66 9 6 C9.268125 5.195625 9.53625 4.39125 9.8125 3.5625 C10.204375 2.716875 10.59625 1.87125 11 1 C11.99 0.67 12.98 0.34 14 0 C12 5 12 5 10.5625 7.3125 C9.8549982 10.69278639 10.58459286 11.44784858 12.375 14.3125 C13.23298844 15.55360093 14.10292921 16.78684721 15 18 C14.01 18 13.02 18 12 18 C9.8125 15 9.8125 15 8 12 C6.8553125 13.2065625 6.8553125 13.2065625 5.6875 14.4375 C3 17 3 17 0 18 C1.07401108 15.08482708 1.77810176 13.22189824 4 11 C4.61923571 7.28458576 3.98494724 5.97506886 2 2.6875 C1.34 1.800625 0.68 0.91375 0 0 Z \" fill=\"currentColor\" transform=\"translate(510,829)\"/><path d=\"M0 0 C1.32 0 2.64 0 4 0 C4 15.84 4 31.68 4 48 C3.67 48 3.34 48 3 48 C2.67 32.82 2.34 17.64 2 2 C1.01 2.33 0.02 2.66 -1 3 C-0.67 2.01 -0.34 1.02 0 0 Z \" fill=\"currentColor\" transform=\"translate(685,747)\"/><path d=\"M0 0 C2.64 0 5.28 0 8 0 C8.38218767 1.65614657 8.71395102 3.32457024 9 5 C8 6 8 6 6.15234375 6.09765625 C4.1015625 6.06510417 2.05078125 6.03255208 0 6 C0 4.02 0 2.04 0 0 Z \" fill=\"var(--logo-bg,#000)\" transform=\"translate(568,831)\"/><path d=\"M0 0 C3.3 0 6.6 0 10 0 C9.67 1.65 9.34 3.3 9 5 C6.03 5 3.06 5 0 5 C0 3.35 0 1.7 0 0 Z \" fill=\"var(--logo-bg,#000)\" transform=\"translate(568,840)\"/><path d=\"M0 0 C0.99 0.33 1.98 0.66 3 1 C2.38461538 6.53846154 2.38461538 6.53846154 0.4375 8.875 C-0.2740625 9.431875 -0.2740625 9.431875 -1 10 C-1.99 9.67 -2.98 9.34 -4 9 C-2.94124926 5.59687262 -1.99097846 2.98646769 0 0 Z \" fill=\"currentColor\" transform=\"translate(671,771)\"/><path d=\"M0 0 C0.99 0 1.98 0 3 0 C3.81302325 1.45804169 4.62540131 2.91644315 5.4375 4.375 C5.88996094 5.18710937 6.34242188 5.99921875 6.80859375 6.8359375 C7.5650536 8.20996622 8.29854631 9.59709261 9 11 C8.01 11 7.02 11 6 11 C4.61876037 9.03277992 3.28511874 7.03131672 2 5 C1.34 4.67 0.68 4.34 0 4 C0 2.68 0 1.36 0 0 Z \" fill=\"currentColor\" transform=\"translate(516,836)\"/><path d=\"M0 0 C0.66 0.99 1.32 1.98 2 3 C0.625 5.0625 0.625 5.0625 -2 7 C-5.40060685 7.05863115 -8.65559323 6.58718592 -12 6 C-12 5.67 -12 5.34 -12 5 C-11.06027344 4.90912109 -11.06027344 4.90912109 -10.1015625 4.81640625 C-8.87566406 4.69072266 -8.87566406 4.69072266 -7.625 4.5625 C-6.81289063 4.48128906 -6.00078125 4.40007813 -5.1640625 4.31640625 C-2.95727195 4.10909886 -2.95727195 4.10909886 -1 3 C-0.67 2.01 -0.34 1.02 0 0 Z \" fill=\"currentColor\" transform=\"translate(468,840)\"/><path d=\"M0 0 C0.66 1.32 1.32 2.64 2 4 C1.21654285 5.17219543 0.42297164 6.33763668 -0.375 7.5 C-0.81585937 8.1496875 -1.25671875 8.799375 -1.7109375 9.46875 C-2.13632812 9.9740625 -2.56171875 10.479375 -3 11 C-3.66 11 -4.32 11 -5 11 C-3.92598892 8.08482708 -3.22189824 6.22189824 -1 4 C-0.3574765 1.93125966 -0.3574765 1.93125966 0 0 Z \" fill=\"currentColor\" transform=\"translate(515,836)\"/><path d=\"M0 0 C0.93065133 2.60582371 1.14917407 3.64198224 0.0625 6.25 C-0.4634375 7.11625 -0.4634375 7.11625 -1 8 C-1.33 7.34 -1.66 6.68 -2 6 C-2.99 6 -3.98 6 -5 6 C-3.35 4.02 -1.7 2.04 0 0 Z \" fill=\"var(--logo-bg,#000)\" transform=\"translate(540,589)\"/><path d=\"M0 0 C0.33 0.99 0.66 1.98 1 3 C-0.3125 4.5 -0.3125 4.5 -2 6 C-2.99 6 -3.98 6 -5 6 C-3.86695008 2.60085025 -2.87481525 1.94745549 0 0 Z \" fill=\"currentColor\" transform=\"translate(440,757)\"/><path d=\"M0 0 C0.99 0.33 1.98 0.66 3 1 C1.37660195 2.70884005 -0.29319053 4.37446717 -2 6 C-2.66 6 -3.32 6 -4 6 C-2.84826645 3.53199953 -1.95216435 1.95216435 0 0 Z \" fill=\"currentColor\" transform=\"translate(776,750)\"/><path d=\"M0 0 C-1.39332574 3.36720387 -2.9789286 4.9859524 -6 7 C-5.37162381 3.35541809 -4.14650034 0 0 0 Z \" fill=\"currentColor\" transform=\"translate(395,691)\"/></svg>";

const Trophy = () => (
  <svg className="tv-cup" viewBox="0 0 64 64" aria-hidden="true"><path fill="currentColor" d="M18 6h28v6h10v6c0 8-6 14-13.5 14.8A15 15 0 0 1 35 40v8h9v6H20v-6h9v-8a15 15 0 0 1-7.5-7.2C14 32 8 26 8 18v-6h10V6Zm-4 12c0 4 2.5 7.5 6 8.7V18h-6Zm30 0v8.7c3.5-1.2 6-4.7 6-8.7h-6Z"/></svg>
);
const shortName = (n) => { const p = String(n || '').split(/\s+/).filter(Boolean); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0] || ''; };
const unitWord = (mode, n) => (mode === 'hot' ? 'hot' : mode === 'points' ? 'pts' : n === 1 ? 'call' : 'calls');

// The prize card: what they're playing for, and who's taking it right now
function TvPrize({ c, lead, second, big }) {
  const ls = lead ? coScore({ callout: c }, lead) : 0;
  const gap = lead && second ? ls - coScore({ callout: c }, second) : 0;
  return (
    <section className={'tv2-card tv2-prize' + (big ? ' big' : '')}>
      <div className="tv2-prize-top"><Trophy /><div><span className="tv2-k">PLAYING FOR</span><b className="tv-shine">{c.prize || CO_MODE[c.mode]}</b></div></div>
      {!big && <div className="tv2-lead"><span className="tv2-k">IN THE LEAD</span>
        {lead ? <div className="tv2-lead-row" key={lead.name}><i className="tv2-av">{initials(lead.name)}</i><b>{shortName(lead.name)}</b>
          <em className="n">{ls} {unitWord(c.mode, ls)}{gap > 0 ? ` · ${gap} clear` : gap === 0 && second ? ' · tied' : ''}</em></div>
          : <div className="tv2-lead-row"><b>Up for grabs</b></div>}</div>}
    </section>
  );
}

// Team calls against the target, as a ring
function TvRing({ pct }) {
  const r = 46, l = 2 * Math.PI * r;
  return (
    <svg className="tv2-ring" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r={r} className="bg" />
      <circle cx="50" cy="50" r={r} className="fg" strokeDasharray={l} strokeDashoffset={l * (1 - Math.min(1, pct))} />
    </svg>
  );
}

// ── TV screen (/tv): for the office TV. Big timer, team calls and the leaderboard while a call out runs;
// the countdown before it starts, the results after it ends, and today's board in between. Nothing to click.
function TvScreen() {
  const [co, setCo] = useState(null);
  const [today, setToday] = useState(null);
  const [, setTick] = useState(0);
  const [full, setFull] = useState(!!document.fullscreenElement);
  const [idleMouse, setIdleMouse] = useState(false);
  const load = useCallback(() => api('/api/desk?action=callout')
    .then((j) => setCo({ ...j, offset: j.callout ? new Date(j.callout.serverNow).getTime() - Date.now() : 0 })).catch(() => {}), []);
  const phase = calloutPhase(co);
  useEffect(() => { load(); const t = setInterval(load, phase === 'live' || phase === 'countdown' ? 4000 : 15000); return () => clearInterval(t); }, [load, phase]);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  // Between call outs: today's numbers (managers and directors only; brokers just see the waiting screen)
  useEffect(() => {
    if (phase === 'live' || phase === 'countdown') return;
    const get = () => api('/api/desk?action=dashboard&period=today').then(setToday).catch(() => setToday(null));
    get(); const t = setInterval(get, 60000); return () => clearInterval(t);
  }, [phase]);
  // Keep the TV awake, and hide the mouse when it isn't moving
  useEffect(() => {
    let lock;
    const ask = () => navigator.wakeLock?.request('screen').then((l) => { lock = l; }).catch(() => {});
    ask(); const vis = () => document.visibilityState === 'visible' && ask();
    document.addEventListener('visibilitychange', vis);
    return () => { document.removeEventListener('visibilitychange', vis); lock?.release?.(); };
  }, []);
  useEffect(() => {
    let t; const move = () => { setIdleMouse(false); clearTimeout(t); t = setTimeout(() => setIdleMouse(true), 3000); };
    const fs = () => setFull(!!document.fullscreenElement);
    move(); window.addEventListener('mousemove', move); document.addEventListener('fullscreenchange', fs);
    return () => { clearTimeout(t); window.removeEventListener('mousemove', move); document.removeEventListener('fullscreenchange', fs); };
  }, []);
  const goFull = () => document.documentElement.requestFullscreen?.().catch(() => {});
  const clock = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' });

  const c = co?.callout;
  const board = co?.board || [];
  const now = coNow(co);

  // What changed since the last update: who scored (+1 flash) and who climbed (▲)
  const prev = useRef(null);
  const [moves, setMoves] = useState({});
  const samples = useRef([]);
  const sig = board.map((b) => `${b.name}:${b.calls}:${b.hot}`).join('|');
  useEffect(() => {
    if (!c) return;
    const nowT = Date.now();
    const cur = Object.fromEntries(board.map((b, i) => [b.name, { s: coScore(co, b), r: i }]));
    if (prev.current && prev.current.id === c.id) {
      const m = {};
      for (const [n, v] of Object.entries(cur)) {
        const p = prev.current.map[n];
        if (!p) continue;
        if (v.s > p.s || v.r < p.r) m[n] = { up: Math.max(0, p.r - v.r), plus: v.s - p.s, at: nowT };
      }
      if (Object.keys(m).length) setMoves((old) => ({ ...Object.fromEntries(Object.entries(old).filter(([, x]) => nowT - x.at < 6000)), ...m }));
    }
    prev.current = { id: c.id, map: cur };
    const total = board.reduce((a, b) => a + b.calls, 0);
    samples.current = [...samples.current.filter((x) => x.id === c.id && nowT - x.t < 6 * 60000), { id: c.id, t: nowT, total }];
  }, [sig, c?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const fresh = (n) => moves[n] && Date.now() - moves[n].at < 6000 ? moves[n] : null;

  let body;
  let headLine = null;
  if (phase === 'countdown') {
    const left = Math.ceil((new Date(c.startsAt).getTime() - now) / 1000);
    body = (<div className="tv-center">
      <span className="tv2-k">CALL OUT STARTS IN</span>
      <div className="tv2-countwrap"><span className="tv2-pulse" /><b className="tv2-count n" key={left}>{left > 59 ? mmss(left * 1000) : Math.max(1, left)}</b></div>
      <TvPrize c={c} big />
      <span className="tv2-sub">{c.minutes} minutes · {CO_MODE[c.mode]} · {board.length} people · phones ready</span>
    </div>);
  } else if (phase === 'live') {
    const start = new Date(c.startsAt).getTime(), end = new Date(c.endsAt).getTime();
    const total = board.reduce((a, b) => a + b.calls, 0);
    const hot = board.reduce((a, b) => a + b.hot, 0);
    const teamTarget = (c.target || 0) * board.length;
    const leftMs = end - now;
    const elapsed = Math.max(1, now - start);
    const pace = Math.round(total / elapsed * (end - start));
    const old = samples.current.find((x) => x.id === c.id && Date.now() - x.t >= 4.5 * 60000) || samples.current[0];
    const lastFive = old ? total - old.total : 0;
    const fiveLabel = old && Date.now() - old.t >= 4.5 * 60000 ? 'in the last 5 min' : 'since this screen opened';
    const calling = board.filter((b) => b.calls > 0).length;
    const ranked = board.filter((b) => coScore(co, b) > 0);
    const lead = ranked[0] || null;
    // One motivating line, changing every 8 seconds
    const lines = [
      teamTarget > total ? `${fmt(teamTarget - total)} calls to the team target` : teamTarget ? 'Team target smashed. Keep going.' : null,
      lastFive > 0 ? `${lastFive} calls ${fiveLabel}` : null,
      board[1] && lead && coScore(co, board[0]) - coScore(co, board[1]) <= 3 ? `${board[1].name.split(' ')[0]} is ${coScore(co, board[0]) - coScore(co, board[1]) || 'level'}${coScore(co, board[0]) - coScore(co, board[1]) ? ' behind 1st' : ' with 1st'}` : null,
      `On pace for ${fmt(pace)} calls`,
      'The next call could be the one.',
    ].filter(Boolean);
    const line = lines[Math.floor(Date.now() / 8000) % lines.length];
    const lead2 = ranked[1];
    const gap = lead && lead2 ? coScore(co, lead) - coScore(co, lead2) : 0;
    const top3 = board.slice(0, 3);
    const rest = board.slice(3, 11);
    headLine = line;
    body = (<div className="tv3">
      <aside className="tv3-side">
        <section className={'tv2-card tv2-time' + (leftMs < 60000 ? ' last' : leftMs < 5 * 60000 ? ' close' : '')}>
          <span className="tv2-k"><i className="tv2-live" />LIVE · TIME LEFT</span>
          <b className="tv2-timer n">{mmss(leftMs)}</b>
          <div className="tv2-bar"><i style={{ width: `${Math.min(100, ((now - start) / (end - start)) * 100)}%` }} /></div>
          <span className="tv2-sub">Ends {new Date(end).toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' })}</span>
        </section>
        <section className="tv2-card tv3-calls">
          <div className="tv2-ringwrap"><TvRing pct={teamTarget ? total / teamTarget : 0} />
            <div className="tv2-ringin"><b className="n" key={total}>{fmt(total)}</b><span>CALLS</span></div></div>
          <div className="tv3-stats">
            <div><b className="n">{teamTarget ? `${Math.round((total / teamTarget) * 100)}%` : '—'}</b><span className="tv2-k">OF TARGET</span><em>{teamTarget ? fmt(teamTarget) : 'none set'}</em></div>
            <div><b className="n">{hot}</b><span className="tv2-k">HOT LEADS</span><em>{calling}/{board.length} calling</em></div>
            <div className="gold"><b className="n">+{lastFive}</b><span className="tv2-k">MOMENTUM</span><em>{fiveLabel === 'in the last 5 min' ? 'last 5 min' : 'so far'}</em></div>
          </div>
        </section>
        <section className="tv2-card tv2-prize tv3-prize">
          <div className="tv2-prize-top"><Trophy /><div><span className="tv2-k">PLAYING FOR</span><b className="tv-shine">{c.prize || CO_MODE[c.mode]}</b></div></div>
          <span className="tv3-mode">{CO_MODE[c.mode]}</span>
        </section>
      </aside>
      <section className="tv3-board">
        <div className="tv3-head"><span className="tv2-k">LEADERBOARD</span>
          <span className="tv3-lead">{lead ? <>{shortName(lead.name)} leads{gap > 0 ? ` by ${gap}` : lead2 ? ', tied' : ''}</> : 'Up for grabs'}</span></div>
        <ol className="tv3-top">{top3.map((b, i) => {
          const f = fresh(b.name);
          return (
            <li key={b.name + i} className={'r' + (i + 1) + (f ? ' bump' : '')}>
              <span className="tv3-medal">{i + 1}</span>
              <i className="tv2-av big">{initials(b.name)}</i>
              <div className="tv3-who"><b>{b.name}</b><span>{b.team}{b.hot ? ` · ${b.hot} hot` : ''}</span></div>
              {f && f.plus > 0 ? <span className="tv2-plus">+{f.plus}</span> : <span />}
              <b className="tv3-score n">{coScore(co, b)}</b>
            </li>);
        })}</ol>
        <ol className="tv3-rest" start={4}>{rest.map((b, i) => {
          const f = fresh(b.name);
          return (
            <li key={b.name + i} className={f ? 'bump' : ''}>
              <em className="n">{i + 4}</em>
              <i className="tv2-av">{initials(b.name)}</i>
              <div className="tv2-who"><b>{shortName(b.name)}</b><span>{b.team}</span></div>
              {f && f.up > 0 ? <span className="tv2-up">▲ {f.up}</span> : f && f.plus > 0 ? <span className="tv2-up">+{f.plus}</span> : <span />}
              <b className="tv2-score n">{coScore(co, b)}</b>
            </li>);
        })}</ol>
        {board.length > 11 && <span className="tv2-more">+{board.length - 11} more in this call out</span>}
      </section>
      <div className="tv2-ticker tv3-ticker"><span className="tv2-tk">HOT</span>
        <div className="tv2-tick-track">{(co.recent || []).length
          ? <div className="tv2-tick-move">{[...co.recent, ...co.recent].map((r, i) => <span key={i}><b>{r.name.split(' ')[0]}</b> {r.what}</span>)}</div>
          : <span className="tv2-tick-wait">First hot lead of the call out goes here. Who&apos;s it going to be?</span>}</div></div>
    </div>);
  } else if (phase === 'done') {
    const ranked = board.filter((b) => coScore(co, b) > 0);
    const total = board.reduce((a, b) => a + b.calls, 0);
    const hot = board.reduce((a, b) => a + b.hot, 0);
    const podium = [ranked[1], ranked[0], ranked[2]];
    body = (<div className="tv-center tv2-done">
      <div className="tv2-confetti" aria-hidden="true">{Array.from({ length: 36 }, (_, i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 12) * 0.35}s`, animationDuration: `${3.5 + (i % 5) * 0.6}s` }} />)}</div>
      <span className="tv2-k">CALL OUT FINISHED · {c.minutes} MIN</span>
      <h1 className="tv2-win">{ranked[0] ? <>{ranked[0].name.split(' ')[0]} wins{c.prize ? <> <span className="tv-shine dark">{c.prize.charAt(0).toLowerCase() + c.prize.slice(1)}</span></> : ''}.</> : 'Call out finished.'}</h1>
      <div className="tv-podium">{podium.map((b, i) => b ? (
        <div key={i} className={'s' + [2, 1, 3][i]}><i className="tv2-av big">{initials(b.name)}</i><b>{b.name.split(' ')[0]}</b><span>{coScore(co, b)} {unitWord(c.mode, coScore(co, b))}</span><div>{[2, 1, 3][i]}</div></div>
      ) : <div key={i} className={'s' + [2, 1, 3][i] + ' gap'} />)}</div>
      <span className="tv2-sub">{fmt(total)} calls · {hot} hot leads · {ranked.length} of {board.length} people calling</span>
    </div>);
  } else {
    const rows = (today?.rows || []).filter((r) => r.calls > 0).sort((a, b) => b.calls - a.calls).slice(0, 10);
    const total = (today?.rows || []).reduce((a, r) => a + r.calls, 0);
    body = (<div className="tv-center">
      <span className="tv2-k">NO CALL OUT RUNNING</span>
      <h1 className="tv2-win">{today ? `${fmt(total)} calls today.` : 'Waiting for the next call out.'}</h1>
      {rows.length > 0 && <ol className="tv-today">{rows.map((r, i) => <li key={r.name + i}><em>{i + 1}</em><i className="tv2-av">{initials(r.name)}</i><b>{r.name}</b><span className="n">{r.calls}</span></li>)}</ol>}
      <span className="tv2-sub dim">This screen switches over by itself when a call out starts.</span>
    </div>);
  }
  return (
    <div className={`tv${idleMouse ? ' nomouse' : ''}`}>
      <header className="tv-top"><span className="tv-logo" aria-label="Apex Homes DXB" dangerouslySetInnerHTML={{ __html: APEX_LOGO }} />
        {headLine ? <span className="tv3-line" key={headLine}>{headLine}</span> : <span />}
        <span className="tv-topr">{c?.test && <span className="tv-test">TEST · ONLY YOU SEE THIS</span>}<span className="tv-clock n">{clock}</span></span></header>
      {co === null ? <div className="tv-center"><span className="tv2-sub dim">Loading…</span></div> : body}
      {!full && !idleMouse && <button className="tv-full" onClick={goFull}>Full screen</button>}
    </div>
  );
}

// ── Team: add people and choose their areas (admins and directors) ─────────
const ROLE_LABEL = { broker: 'Broker', manager: 'Manager', director: 'Director', admin: 'Admin' };
function Team({ myRole, onMessages }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(null); // { mode: 'new' | 'edit', ...person }
  const [q, setQ] = useState('');
  const load = useCallback(() => {
    setErr('');
    // Never sit on "Loading…" forever: after 20 seconds say so and offer to try again
    const slow = setTimeout(() => setErr('The Team page is taking too long to load.'), 20000);
    return api('/api/desk?action=team').then((j) => { setD(j); setErr(''); }).catch((e) => setErr(e.message)).finally(() => clearTimeout(slow));
  }, []);
  useEffect(() => { load(); }, [load]);
  if (err && !d) return <main className="gut"><p className="err" style={{ marginTop: 30 }}>{err}</p><button className="btn" onClick={load}>Try again</button></main>;
  if (!d) return <main className="gut muted" style={{ padding: 40 }}>Loading…</main>;
  const areaName = Object.fromEntries(d.areas.map((a) => [Number(a.id), a.name]));
  const teams = [...new Set(d.people.map((p) => p.team).filter(Boolean))].sort();
  const areasOf = (ids) => (ids || []).map((i) => areaName[Number(i)]).filter(Boolean);
  const match = (p) => !q || `${p.full_name} ${p.email} ${p.team || ''}`.toLowerCase().includes(q.toLowerCase());
  return (
    <main className="gut dash teamp">
      <div className="dash-head">
        <div><h1>Team</h1><p className="muted">Add someone here, then they go to the sign-in page, click "Set your password" and use their email.</p></div>
        <div className="dash-ctl">
          <input type="search" placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn primary" onClick={() => setEdit({ mode: 'new', full_name: '', email: '', role: 'broker', team: '', areas: [] })}>Add person</button>
        </div>
      </div>
      {d.invites.length > 0 && <section className="card">
        <h4>Waiting to set a password · {d.invites.length}</h4>
        <table className="mini"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Team</th><th>Areas</th><th>Added</th><th /></tr></thead>
          <tbody>{d.invites.filter(match).map((i) => (
            <tr key={i.email}><td><b>{i.full_name}</b></td><td className="muted">{i.email}</td><td>{ROLE_LABEL[i.role]}</td><td>{i.team || <span className="faint">—</span>}</td>
              <td className="wrapc">{['admin', 'director'].includes(i.role) ? <span className="faint">All areas</span> : areasOf(i.areas).join(', ') || <span className="faint">None yet</span>}</td>
              <td className="muted">{fdt(i.created_at)}</td>
              <td className="r"><button className="link" onClick={() => setEdit({ mode: 'new', ...i, areas: (i.areas || []).map(Number) })}>Edit</button>{' · '}
                <button className="link" onClick={() => api('/api/desk?action=cancelInvite', { method: 'POST', body: { email: i.email } }).then(load)}>Remove</button></td></tr>))}</tbody></table>
      </section>}
      <section className="card">
        <h4>On the desk · {d.people.filter((p) => p.active).length}</h4>
        <table className="mini"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Team</th><th>Areas</th><th>Last active</th><th /></tr></thead>
          <tbody>{d.people.filter(match).map((p) => (
            <tr key={p.user_id} className={p.active ? '' : 'idle'}><td><b>{p.full_name}</b>{!p.active && <span className="faint"> · switched off</span>}</td><td className="muted">{p.email}</td>
              <td>{ROLE_LABEL[p.role] || p.role}</td><td>{p.team || <span className="faint">—</span>}</td>
              <td className="wrapc">{['admin', 'director'].includes(p.role) ? <span className="faint">All areas</span> : areasOf(p.areas).join(', ') || <span className="faint">None</span>}</td>
              <td className="muted">{p.last_seen ? fdt(p.last_seen) : 'Never'}</td>
              <td className="r"><button className="link" onClick={() => onMessages(p.user_id)}>Messages</button>{' · '}<button className="link" onClick={() => setEdit({ mode: 'edit', ...p, areas: (p.areas || []).map(Number) })}>Edit</button></td></tr>))}</tbody></table>
      </section>
      {edit && <PersonForm p={edit} areas={d.areas} teams={teams} myRole={myRole} isMe={edit.user_id === d.me} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </main>
  );
}

function PersonForm({ p, areas, teams, myRole, isMe, onClose, onSaved }) {
  const [v, setV] = useState({ full_name: p.full_name || '', email: p.email || '', role: p.role || 'broker', team: p.team || '', areas: p.areas || [], active: p.active !== false });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const isNew = p.mode === 'new';
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const allAreas = ['admin', 'director'].includes(v.role);
  const names = areas.map((a) => a.name);
  const picked = areas.filter((a) => v.areas.includes(Number(a.id))).map((a) => a.name);
  const pick = (list) => setV({ ...v, areas: areas.filter((a) => list.includes(a.name)).map((a) => Number(a.id)) });
  async function save(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      await api(`/api/desk?action=${isNew ? 'invite' : 'saveStaff'}`, { method: 'POST', body: isNew ? v : { ...v, user_id: p.user_id } });
      onSaved();
    } catch (x) { setErr(x.message); }
    setBusy(false);
  }
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form className="box person" role="dialog" aria-label="Person" onSubmit={save}>
        <h3>{isNew ? (p.email ? 'Edit invite' : 'Add person') : `Edit ${p.full_name}`}</h3>
        <label>Full name<input value={v.full_name} onChange={set('full_name')} required autoFocus={isNew} /></label>
        <label>Work email<input type="email" value={v.email} onChange={set('email')} required disabled={!isNew} /></label>
        <div className="pair">
          <label>Role<select value={v.role} onChange={set('role')} disabled={isMe}>
            {Object.entries(ROLE_LABEL).filter(([k]) => k !== 'admin' || myRole === 'admin').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label>Team<input list="team-names" value={v.team} onChange={set('team')} placeholder="e.g. Mahan's team" />
            <datalist id="team-names">{teams.map((t) => <option key={t} value={t} />)}</datalist></label>
        </div>
        <div className="lbl">Areas</div>
        {allAreas ? <p className="faint" style={{ margin: 0 }}>{ROLE_LABEL[v.role]}s see every area.</p>
          : <CheckList options={names} selected={picked} onChange={pick} />}
        {!isNew && !isMe && <label className="cb"><input type="checkbox" checked={!v.active} onChange={(e) => setV({ ...v, active: !e.target.checked })} />Switch off their access</label>}
        {err && <p className="err">{err}</p>}
        <div className="acts"><button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : isNew ? 'Save' : 'Save changes'}</button></div>
        {isNew && <p className="faint" style={{ margin: 0, fontSize: 12 }}>They then open the desk, click "Set your password" and enter this email. The invite lasts 14 days.</p>}
      </form>
    </div>
  );
}

// Chart bars: by hour today, by day for this week / this month
// Chart bars: by hour for a single day, otherwise by day across the chosen dates
function makeBars(d) {
  if (d.byHour) return Array.from({ length: 11 }, (_, i) => { const h = 8 + i; return { k: `${h}:00`, n: d.series.find((x) => Number(x.k) === h)?.n || 0 }; });
  const out = []; const start = new Date(String(d.start)); const end = new Date(Math.min(Date.now(), new Date(String(d.end)).getTime() - 1));
  const days = Math.round((end - start) / 86400000) + 1;
  for (let x = new Date(start); x <= end; x.setDate(x.getDate() + 1)) {
    const k = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(x);
    const lab = new Intl.DateTimeFormat('en-GB', days <= 7 ? { timeZone: 'Asia/Dubai', weekday: 'short', day: 'numeric' } : { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short' }).format(x);
    if (!out.some((o) => o.key === k)) out.push({ key: k, k: lab, n: d.series.find((s) => s.k === k)?.n || 0 });
  }
  // Long ranges: only label every few days so the dates don't run into each other
  const step = out.length <= 12 ? 1 : Math.ceil(out.length / 10);
  out.forEach((o, i) => { o.show = i % step === 0 || i === out.length - 1 && (out.length - 1) % step >= step / 2; });
  return out;
}
// The bar chart. Many days: thinner gaps, numbers only on the taller bars, dates every few days.
function Bars({ bars, max }) {
  const many = bars.length > 14;
  return (
    <div className={`bars${many ? ' many' : ''}`}>{bars.map((b, i) => (
      <div key={i} className="bar-c" title={`${b.k}: ${b.n} call${b.n === 1 ? '' : 's'}`}>
        <div className="bar-v" style={{ height: `${(b.n / max) * 100}%` }}>{b.n && (!many || b.n >= max * 0.15) ? <span>{b.n}</span> : null}</div>
        <em>{b.show === false ? '\u00a0' : b.k}</em></div>))}</div>
  );
}
const PERIODS = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['lastmonth', 'Last month'], ['custom', 'Dates']];
const dubaiDay = (offsetDays = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date(Date.now() + offsetDays * 86400000));
const prettyDay = (ymd) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(ymd + 'T00:00:00Z'));
// "today", "this week" ... or "1 Oct – 31 Oct" for last month and chosen dates
const periodLabel = (d) => (d.period === 'lastmonth' || d.period === 'custom'
  ? (d.from === d.to ? `on ${prettyDay(d.from)}` : `${prettyDay(d.from)} – ${prettyDay(d.to)}`)
  : { today: 'today', week: 'this week', month: 'this month' }[d.period]);
const periodQuery = (p) => `period=${p.period}${p.period === 'custom' ? `&from=${p.from}&to=${p.to}` : ''}`;
// Today / This week / This month / Last month / Dates (pick any from and to)
function PeriodPicker({ value, onChange, shown }) {
  // The date boxes are always there so nothing moves when you switch. They show the dates you're looking at;
  // changing either one switches to Dates.
  const today = dubaiDay();
  const cap = (x) => (x && x > today ? today : x);
  const from = value.period === 'custom' ? value.from : cap(shown?.from) || '';
  const to = value.period === 'custom' ? value.to : cap(shown?.to) || '';
  const pick = (k) => onChange(k === 'custom'
    ? { period: 'custom', from: value.from || from || dubaiDay(-30), to: value.to || to || today }
    : { ...value, period: k });
  return (
    <div className="pp">
      <div className="seg">{PERIODS.map(([k, l]) => <button key={k} className={value.period === k ? 'on' : ''} onClick={() => pick(k)}>{l}</button>)}</div>
      <div className={`pp-dates${value.period === 'custom' ? ' on' : ''}`}>
        <input type="date" aria-label="From" value={from} max={to || today} onChange={(e) => e.target.value && onChange({ period: 'custom', from: e.target.value, to: to || today })} />
        <span className="muted">to</span>
        <input type="date" aria-label="To" value={to} min={from || undefined} max={today} onChange={(e) => e.target.value && onChange({ period: 'custom', from: from || e.target.value, to: e.target.value })} />
      </div>
    </div>
  );
}

// Brokers only see their own numbers. Managers and directors see their team, and can switch to their own.
function DashPage({ role }) {
  const [mine, setMine] = useState(role === 'broker');
  return mine ? <MyDashboard onTeam={role === 'broker' ? null : () => setMine(false)} /> : <Dashboard onMine={() => setMine(true)} />;
}

// My numbers: your own calls, hot, cold and WhatsApps, and your place in the company.
// The person above you is shown by their call count only, never their name.
function MyDashboard({ onTeam }) {
  const [pick, setPick] = useState({ period: 'today', from: '', to: '' });
  const [editT, setEditT] = useState(false);
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => {
    api(`/api/desk?action=myStats&${periodQuery(pick)}`).then((j) => { setD(j); setErr(''); }).catch((e) => setErr(e.message));
  }, [pick]);
  useEffect(() => { load(); const t = setInterval(() => document.visibilityState === 'visible' && load(), 60000); return () => clearInterval(t); }, [load]);
  if (err) return <main className="gut"><p className="err" style={{ marginTop: 30 }}>{err}</p></main>;
  if (!d) return <main className="gut muted" style={{ padding: 40 }}>Loading…</main>;
  const m = d.me;
  const label = periodLabel(d);
  const per = d.goal * d.workdays;
  const bars = makeBars(d);
  const maxBar = Math.max(1, ...bars.map((b) => b.n));
  const gap = d.above ? d.above.calls - m.calls : 0;
  let line;
  if (!m.calls) line = d.top ? `Make your first call to get on the board. The top caller ${label} has ${pl(d.top, 'call')}.` : `Nobody has called yet ${label}. First call puts you top.`;
  else if (!d.above) line = d.level ? `Top of the company ${label}, level with ${pl(d.level, 'other person')}. One more call and it's yours.` : `Top of the company ${label}. Nobody has made more calls.`;
  else if (gap > 0) line = `The person above you has ${pl(d.above.calls, 'call')}. You're ${gap} behind, so ${gap + 1} more puts you ahead.`;
  else line = `The person above you also has ${pl(d.above.calls, 'call')} but more hot leads (${d.above.hot}). One more call puts you ahead.`;
  return (
    <main className="gut dash">
      <div className="dash-head">
        <div><h1>My numbers</h1>
          <p className="muted">Your calls {label} · your target {d.goal} a day{!d.byHour ? ` · ${d.workdays} working day${d.workdays > 1 ? 's' : ''}` : ''}
            {!editT && <> · <button className="link" onClick={() => setEditT(true)}>Change</button></>}</p>
          {editT && <TargetEditor goal={d.goal} base={d.base || 50} onSaved={() => load()} onClose={() => setEditT(false)} />}</div>
        <div className="dash-ctl">
          {onTeam && <button className="btn" onClick={onTeam}>Team view</button>}
          <PeriodPicker value={pick} onChange={setPick} shown={d} />
        </div>
      </div>

      <section className={'card mypos' + (m.calls && d.rank <= 3 ? ' podium' : '')}>
        <div className="mp-rank"><span>Your place {label}</span>
          <b className="n">{m.calls ? ordinal(d.rank) : '–'}</b>
          <em>{m.calls ? `of ${d.of} in the company${d.level ? ` · level with ${d.level}` : ''}` : `${d.of} people in the company`}</em></div>
        <div className="mp-next">
          {d.above && m.calls > 0 && <div className="mp-ladder">
            <div className="mp-step up"><span>Above you</span><b className="n">{d.above.calls}</b><em>calls · {d.above.hot} hot</em></div>
            <div className="mp-step you"><span>You</span><b className="n">{m.calls}</b><em>calls · {m.hot} hot</em></div>
          </div>}
          <p>{line}</p>
        </div>
      </section>

      <div className="kpis">
        <div className="kpi big"><span>Calls</span><b className="n">{fmt(m.calls)}</b>
          <div className="kbar"><i className={m.calls >= per ? 'hit' : ''} style={{ width: `${Math.min(100, (m.calls / per) * 100)}%` }} /></div>
          <em>{Math.round((m.calls / per) * 100)}% of your {fmt(per)} target</em></div>
        <div className="kpi hot"><span>Hot</span><b className="n">{fmt(m.hot)}</b><em>{m.calls ? Math.round((m.hot / m.calls) * 100) : 0}% of your calls</em></div>
        <div className="kpi cold"><span>Cold</span><b className="n">{fmt(m.cold)}</b><em>no answer, unreachable</em></div>
        <div className="kpi"><span>WhatsApps sent</span><b className="n">{fmt(m.wa)}</b><em>after calls</em></div>
        <div className="kpi"><span>Owners reached</span><b className="n">{fmt(m.owners)}</b><em>{m.last_at ? `last call ${fdt(m.last_at)}` : `no calls ${label}`}</em></div>
      </div>

      <section className="card">
        <h4>{d.byHour ? 'Your calls by hour' : 'Your calls by day'}</h4>
        <Bars bars={bars} max={maxBar} />
      </section>
    </main>
  );
}

function Dashboard({ onMine }) {
  const [report, setReport] = useState(false);
  const [pick, setPick] = useState({ period: 'today', from: '', to: '' });
  const [team, setTeam] = useState('');
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => {
    api(`/api/desk?action=dashboard&${periodQuery(pick)}&team=${encodeURIComponent(team)}`).then((j) => { setD(j); setErr(''); }).catch((e) => setErr(e.message));
  }, [pick, team]);
  useEffect(() => { if (report) return; load(); const t = setInterval(() => document.visibilityState === 'visible' && load(), 60000); return () => clearInterval(t); }, [load, report]);
  if (report) return <CallReport onBack={() => setReport(false)} />;
  if (err) return <main className="gut"><p className="err" style={{ marginTop: 30 }}>{err}</p></main>;
  if (!d) return <main className="gut muted" style={{ padding: 40 }}>Loading…</main>;
  const per = d.goal * d.workdays;
  const perOf = (r) => (r.goal || d.goal) * d.workdays;   // each person's own target, never below the company one
  const total = d.rows.reduce((a, r) => a + r.calls, 0);
  const hot = d.rows.reduce((a, r) => a + r.hot, 0);
  const cold = d.rows.reduce((a, r) => a + r.cold, 0);
  const wa = d.rows.reduce((a, r) => a + r.wa, 0);
  const active = d.rows.filter((r) => r.calls > 0).length;
  const teamTarget = Math.max(per, d.rows.reduce((a, r) => a + perOf(r), 0));
  const label = periodLabel(d);
  const bars = makeBars(d);
  const maxBar = Math.max(1, ...bars.map((b) => b.n));
  const medal = ['🥇', '🥈', '🥉'];
  return (
    <main className="gut dash">
      <div className="dash-head">
        <div><h1>{d.all ? (d.team ? d.team : 'Director overview') : `${d.myTeam || 'Your team'}`}</h1>
          <p className="muted">{d.all ? 'Calls across every team' : 'Your team\'s calls'} {label} · target {d.goal} a day per person (or their own, if higher){!d.byHour ? ` · ${d.workdays} working day${d.workdays > 1 ? 's' : ''}` : ''}</p></div>
        <div className="dash-ctl">
          {onMine && <button className="btn" onClick={onMine}>My numbers</button>}
          <button className="btn" onClick={() => setReport(true)}>Hot &amp; cold report</button>
          {d.all && <select value={team} onChange={(e) => setTeam(e.target.value)}><option value="">All teams</option>{d.teamNames.map((t) => <option key={t} value={t}>{t}</option>)}</select>}
          <PeriodPicker value={pick} onChange={setPick} shown={d} />
        </div>
      </div>

      <div className="kpis">
        <div className="kpi big"><span>Calls</span><b className="n">{fmt(total)}</b>
          <div className="kbar"><i style={{ width: `${Math.min(100, (total / teamTarget) * 100)}%` }} /></div>
          <em>{Math.round((total / teamTarget) * 100)}% of {fmt(teamTarget)} target</em></div>
        <div className="kpi hot"><span>Hot</span><b className="n">{fmt(hot)}</b><em>{total ? Math.round((hot / total) * 100) : 0}% of calls</em></div>
        <div className="kpi cold"><span>Cold</span><b className="n">{fmt(cold)}</b><em>no answer, unreachable</em></div>
        <div className="kpi"><span>WhatsApps sent</span><b className="n">{fmt(wa)}</b><em>after calls</em></div>
        <div className="kpi"><span>Calling</span><b className="n">{active}<small> / {d.rows.length}</small></b><em>people with a call {label}</em></div>
      </div>

      <div className="dash-grid">
        <section className="card">
          <h4>{d.byHour ? 'Calls by hour' : 'Calls by day'}</h4>
          <Bars bars={bars} max={maxBar} />
        </section>
        {d.all && !d.team && <section className="card">
          <h4>Teams</h4>
          <table className="mini"><thead><tr><th>Team</th><th className="r">People</th><th className="r">Calls</th><th className="r">Per person</th><th className="r">Hot</th></tr></thead>
            <tbody>{d.teams.map((t) => <tr key={t.team} onClick={() => setTeam(t.team)} className="click"><td>{t.team}</td><td className="r n">{t.people}</td><td className="r n"><b>{fmt(t.calls)}</b></td>
              <td className="r n">{t.people ? Math.round(t.calls / t.people) : 0}</td><td className="r n hotc">{t.hot}</td></tr>)}</tbody></table>
        </section>}
      </div>

      <section className="card">
        <h4>Leaderboard {label}</h4>
        <table className="mini lb"><thead><tr><th style={{ width: 44 }} /><th>Name</th>{d.all && !d.team && <th>Team</th>}<th className="r">Calls</th><th style={{ width: '28%' }}>Target</th><th className="r">Hot</th><th className="r">Cold</th><th className="r">WhatsApps</th><th>Last call</th></tr></thead>
          <tbody>{d.rows.map((r, i) => (
            <tr key={r.name + i} className={r.calls ? '' : 'idle'}>
              <td className="rank">{r.calls ? medal[i] || `#${i + 1}` : ''}</td>
              <td><b>{r.name}</b>{r.role === 'manager' && <span className="faint"> · manager</span>}</td>
              {d.all && !d.team && <td className="muted">{r.team}</td>}
              <td className="r n"><b>{r.calls}</b></td>
              <td><div className="kbar sm"><i style={{ width: `${Math.min(100, (r.calls / perOf(r)) * 100)}%` }} className={r.calls >= perOf(r) ? 'hit' : ''} /></div><span className="faint" title={`Target ${perOf(r)}`}>{Math.round((r.calls / perOf(r)) * 100)}%{r.goal > d.goal ? ` of ${perOf(r)}` : ''}</span></td>
              <td className="r n hotc">{r.hot}</td><td className="r n coldc">{r.cold}</td><td className="r n">{r.wa}</td>
              <td className="muted">{r.last_at ? fdt(r.last_at) : 'No calls yet'}</td>
            </tr>))}</tbody></table>
        {d.rows.length === 0 && <p className="muted">Nobody is set up in this team yet.</p>}
      </section>
    </main>
  );
}

// ── Hot & cold report ──
// Why calls went the way they did (from the quick note or outcome on each call), for everyone, a team or one broker.
// Export PDF prints just the report; Download CSV gives the per-person numbers.
const pctOf = (n, of) => (of ? Math.round((n / of) * 100) : 0);
function HBars({ items, of, tone, empty }) {
  const max = Math.max(1, ...items.map((x) => x.n));
  if (!items.length) return <p className="muted small">{empty}</p>;
  return (
    <div className="hbars">{items.map((x) => (
      <div key={x.reason} className="hb-row" title={`${x.reason}: ${x.n}`}>
        <span className="hb-l">{x.reason}</span>
        <span className="hb-t"><i className={tone} style={{ width: `${(x.n / max) * 100}%` }} /></span>
        <span className="hb-n n"><b>{x.n}</b> <em>{pctOf(x.n, of)}%</em></span>
      </div>))}</div>
  );
}
function CallReport({ onBack }) {
  const [pick, setPick] = useState({ period: 'week', from: '', to: '' });
  const [scope, setScope] = useState('');   // '', 'team:<name>' or 'user:<id>'
  const [by, setBy] = useState('broker');   // grid rows: broker or team
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [allOwn, setAllOwn] = useState(false);
  useEffect(() => {
    const [k, v] = scope ? [scope.slice(0, scope.indexOf(':')), scope.slice(scope.indexOf(':') + 1)] : ['', ''];
    setErr('');
    api(`/api/desk?action=insights&${periodQuery(pick)}${k ? `&${k}=${encodeURIComponent(v)}` : ''}`).then(setD).catch((e) => setErr(e.message));
  }, [pick, scope]);
  if (err) return <main className="gut"><p className="err" style={{ marginTop: 30 }}>{err}</p><button className="btn" onClick={onBack}>Back</button></main>;
  if (!d) return <main className="gut muted" style={{ padding: 40 }}>Loading…</main>;
  const sum = (g) => d.reasons.filter((r) => r.grp === g).reduce((a, r) => a + r.n, 0);
  const calls = d.reasons.reduce((a, r) => a + r.n, 0);
  const hot = sum('hot'), obj = sum('objection'), noc = sum('nocontact'), rest = calls - hot - obj - noc;
  const spoke = hot + obj;
  const objections = d.reasons.filter((r) => r.grp === 'objection');
  const hots = d.reasons.filter((r) => r.grp === 'hot');
  const nocs = d.reasons.filter((r) => r.grp === 'nocontact');
  const cols = objections.slice(0, 6).map((r) => r.reason);
  const broker = d.user ? d.brokers.find((b) => b.user_id === d.user) : null;
  const title = broker ? broker.name : d.team ? d.team : d.all ? 'Every team' : (d.myTeam || 'Your team');
  // Grid rows: each person, or each team added up
  const rows = by === 'team' && !d.team && !d.user
    ? Object.values(d.people.reduce((acc, p) => {
        const t = acc[p.team] ||= { key: 'team:' + p.team, name: p.team, calls: 0, hot: 0, objection: 0, nocontact: 0, reasons: {} };
        t.calls += p.calls; t.hot += p.hot; t.objection += p.objection; t.nocontact += p.nocontact;
        for (const [k, n] of Object.entries(p.reasons || {})) t.reasons[k] = (t.reasons[k] || 0) + n;
        return acc; }, {})).sort((a, b) => b.calls - a.calls)
    : d.people.map((p) => ({ ...p, key: 'user:' + p.user_id }));
  const top = (r) => Object.entries(r.reasons || {}).filter(([k]) => objections.some((o) => o.reason === k) || cols.includes(k))
    .filter(([k]) => d.reasons.find((x) => x.reason === k)?.grp === 'objection').sort((a, b) => b[1] - a[1])[0];
  const cell = (r, c) => { const n = r.reasons?.[c] || 0; const sp = r.hot + r.objection; return { n, p: pctOf(n, sp) }; };
  const maxCell = Math.max(1, ...rows.flatMap((r) => cols.map((c) => cell(r, c).p)));
  const label = periodLabel(d);
  const csv = () => {
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = [by === 'team' && !d.team && !d.user ? 'Team' : 'Name', ...(by === 'team' && !d.team && !d.user ? [] : ['Team']), 'Calls', 'Got through', 'Hot', 'Hot % of conversations', 'Not interested', "Didn't get through", ...cols.map((c) => `${c}`), 'Biggest objection'];
    const lines = rows.map((r) => [r.name, ...(by === 'team' && !d.team && !d.user ? [] : [r.team]), r.calls, r.hot + r.objection, r.hot, pctOf(r.hot, r.hot + r.objection) + '%', r.objection, r.nocontact,
      ...cols.map((c) => cell(r, c).n), top(r)?.[0] || '']);
    const blob = new Blob([[head, ...lines].map((l) => l.map(q).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Hot and cold ${title} ${d.from} to ${d.to}.csv`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const seg = (n, cls, name) => n ? <i className={cls} style={{ flexGrow: n }} title={`${name}: ${n} (${pctOf(n, calls)}%)`}>{pctOf(n, calls) >= 7 ? `${pctOf(n, calls)}%` : ''}</i> : null;
  return (
    <main className="gut dash rep">
      <div className="dash-head">
        <div><h1>Hot &amp; cold report · {title}</h1>
          <p className="muted">{label} · {fmt(calls)} calls · why each call went the way it did, from the quick note or outcome</p></div>
        <div className="dash-ctl noprint">
          <button className="btn" onClick={onBack}>Back</button>
          <select value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">{d.all ? 'Every team' : (d.myTeam || 'My team')}</option>
            {d.all && <optgroup label="Teams">{d.teams.map((t) => <option key={t} value={'team:' + t}>{t}</option>)}</optgroup>}
            <optgroup label="Brokers">{d.brokers.map((b) => <option key={b.user_id} value={'user:' + b.user_id}>{b.name}{d.all ? ` · ${b.team}` : ''}</option>)}</optgroup>
          </select>
          <PeriodPicker value={pick} onChange={setPick} shown={d} />
          <button className="btn" onClick={() => window.print()}>Export PDF</button>
          <button className="btn" onClick={csv} disabled={!rows.length}>Download CSV</button>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi big"><span>Calls</span><b className="n">{fmt(calls)}</b><em>{fmt(spoke)} conversations · {pctOf(spoke, calls)}% got through</em></div>
        <div className="kpi hot"><span>Hot</span><b className="n">{fmt(hot)}</b><em>{pctOf(hot, spoke)}% of conversations</em></div>
        <div className="kpi cold"><span>Not interested</span><b className="n">{fmt(obj)}</b><em>{pctOf(obj, spoke)}% of conversations</em></div>
        <div className="kpi"><span>Didn&apos;t get through</span><b className="n">{fmt(noc)}</b><em>{pctOf(noc, calls)}% of calls</em></div>
        <div className="kpi"><span>Biggest objection</span><b className="n rep-top">{objections[0]?.reason || '—'}</b><em>{objections[0] ? `${objections[0].n} calls · ${pctOf(objections[0].n, obj)}% of objections` : 'none yet'}</em></div>
      </div>

      <section className="card">
        <h4>How the calls went</h4>
        <div className="rep-split">{seg(hot, 'hot', 'Hot')}{seg(obj, 'cold', 'Not interested')}{seg(noc, 'noc', "Didn't get through")}{seg(rest, 'none', 'Nothing logged')}</div>
        <div className="rep-key"><span><i className="hot" />Hot {hot}</span><span><i className="cold" />Not interested {obj}</span><span><i className="noc" />Didn&apos;t get through {noc}</span>{rest > 0 && <span><i className="none" />Nothing logged {rest}</span>}</div>
      </section>

      <div className="dash-grid rep-grid">
        <section className="card"><h4>Top objections</h4><p className="muted small">Spoke to them, not interested · % of all objections</p>
          <HBars items={objections} of={obj} tone="cold" empty="No objections logged." /></section>
        <section className="card"><h4>What&apos;s working</h4><p className="muted small">Hot calls · % of all hot</p>
          <HBars items={hots} of={hot} tone="hot" empty="No hot calls yet." />
          <h4 style={{ marginTop: 18 }}>Didn&apos;t get through</h4>
          <HBars items={nocs} of={noc} tone="noc" empty="—" /></section>
      </div>

      {!d.user && <section className="card">
        <div className="rep-gh"><h4>Who&apos;s struggling with what</h4>
          {d.all && !d.team && <div className="seg noprint">{[['broker', 'By broker'], ['team', 'By team']].map(([k, l]) => <button key={k} className={by === k ? 'on' : ''} onClick={() => setBy(k)}>{l}</button>)}</div>}</div>
        <p className="muted small">Each objection as a % of that {by === 'team' && !d.team ? 'team' : 'person'}&apos;s conversations. Darker means it comes up more. Click a row to see just them.</p>
        <div className="rep-wrap"><table className="mini rep-t"><thead><tr><th>{by === 'team' && !d.team ? 'Team' : 'Name'}</th><th className="r">Calls</th><th className="r">Got through</th><th className="r">Hot</th>
          {cols.map((c) => <th key={c} className="r rep-c">{c}</th>)}<th>Biggest objection</th></tr></thead>
          <tbody>{rows.map((r) => { const sp = r.hot + r.objection; const t = top(r); return (
            <tr key={r.key} className="click" onClick={() => { setScope(r.key); setBy('broker'); }}>
              <td><b>{r.name}</b>{r.team && by !== 'team' && d.all && !d.team ? <span className="faint"> · {r.team}</span> : null}</td>
              <td className="r n">{r.calls}</td><td className="r n">{pctOf(sp, r.calls)}%</td><td className="r n hotc">{pctOf(r.hot, sp)}%</td>
              {cols.map((c) => { const x = cell(r, c); return <td key={c} className="r n heat" style={{ '--h': x.p / maxCell }} title={`${x.n} of ${sp} conversations`}>{x.n ? `${x.p}%` : ''}</td>; })}
              <td className="coldc">{t ? `${t[0]} (${t[1]})` : '—'}</td>
            </tr>); })}</tbody></table></div>
        {!rows.length && <p className="muted">No calls {label}.</p>}
      </section>}

      <section className="card">
        <h4>In their own words</h4><p className="muted small">The latest &quot;Other&quot; notes{d.user ? '' : ', newest first'}</p>
        {d.own.length ? <><ul className="rep-own">{(allOwn ? d.own : d.own.slice(0, 12)).map((o, i) => <li key={i}><span>{o.note.replace(/^Other:\s*/i, '')}</span>{!d.user && <em>{o.name}</em>}</li>)}</ul>
          {d.own.length > 12 && <button className="link rep-more noprint" onClick={() => setAllOwn(!allOwn)}>{allOwn ? 'Show fewer' : `Show all ${d.own.length}`}</button>}</>
          : <p className="muted small">None {label}.</p>}
      </section>
    </main>
  );
}

function Activity() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/api/desk?action=activity').then(setD).catch((e) => setErr(e.message)); }, []);
  return (
    <main className="gut" style={{ maxWidth: 1000, paddingBlock: '22px 60px' }}>
      <h2 style={{ marginTop: 0 }}>Activity</h2>
      <p className="muted">Everything done on the Owner Desk is recorded and can&apos;t be edited or deleted.{d?.all ? ' You are seeing everyone.' : ''}</p>
      {err && <p className="err">{err}</p>}
      <div className="audit">
        {d?.rows.map((r, i) => (
          <div key={i}>
            <span className="muted n">{fdt(r.at)}</span>
            <span>{r.full_name ?? '—'}</span>
            <span className={ACTIVITY_BAD.includes(r.action) ? 'bad' : ''}>{ACTIVITY_LABEL[r.action] ?? r.action}{r.unit ? ` · ${r.unit}` : ''}{r.action === 'outcome' && r.detail?.outcome ? ` · ${r.detail.outcome}` : ''}</span>
          </div>
        ))}
      </div>
    </main>
  );
}

// ── Phone screen (/phone) ───────────────────────────────────────────────────
// A person's own messages (My messages) replace the standard ones: 'noanswer' for no answer / unreachable, 'spoke' for everything else
const isNoAnswer = (f) => f.outcome === 'No answer' || /^(called, (no reply|unreachable|line busy)|phone off)/i.test(String(f.note || ''));
function fillTemplate(t, v) {
  return t.split('{first}').join(v.first).split('{me}').join(v.me).split('{property}').join(v.property).split('{area}').join(v.area)
    .replace(/Hi ,/g, 'Hi,').replace(/Hi\s+\n/g, 'Hi,\n');
}
function whatsappText(f, me) {
  if (f.lead) return leadWhatsappText(f, me);
  const first = f.is_company ? '' : titleCase(String(f.owner_name || '').split(/\s+/)[0]);
  const st = /^Street (\d+), Villa (\S+)$/.exec(String(f.unit_no || ''));
  const place = f.area === 'Commercial' ? `unit ${f.unit_no} in ${titleCase(f.building || f.subcommunity)}`
    : st ? `villa ${st[2]} on Street ${st[1]} in ${titleCase(f.subcommunity)}`
    : f.unit_type === 'Villa' ? `villa ${f.unit_no} in ${titleCase(f.subcommunity)}` : `apartment ${f.unit_no} in ${titleCase(f.building)}`;
  const v = { first, me: String(me || '').split(/\s+/)[0], property: place, area: f.area || '' };
  const n = String(f.note || '').toLowerCase();
  const byNote = Object.keys(WHATSAPP_BY_NOTE).sort((a, b) => b.length - a.length).find((k) => n.startsWith(k.toLowerCase()));
  const key = byNote || (WHATSAPP[f.outcome] ? f.outcome : 'default');
  const own = f.templates || {};
  const mine = own[key] || (isNoAnswer(f) ? own.noanswer : own.spoke);   // noanswer/spoke: messages saved by the first version
  return fillTemplate(mine || standardMessage(key), v);
}
const standardMessage = (key) => LEAD_WHATSAPP[key] || WHATSAPP_BY_NOTE[key] || WHATSAPP[key] || WHATSAPP.default;
// Lead pool messages: {property} is what they asked about ("2 bed in Dubai Marina"), {area} the location
const LEAD_TRIED = 'Hi {first}, this is {me} from Apex Homes. You enquired with us recently about a {property}, so I just tried giving you a call. Are you still looking? I have a few options that could suit.';
const LEAD_WHATSAPP = {
  'Lead - Called, no reply': LEAD_TRIED, 'Lead - Called, unreachable': LEAD_TRIED, 'Lead - Phone off': LEAD_TRIED,
  'Lead - Called, line busy, call again later': 'Hi {first}, this is {me} from Apex Homes. You enquired with us recently about a {property}. I just tried calling but the line was busy. When is a good time to talk?',
  'Lead - Still looking': 'Hi {first}, this is {me} from Apex Homes. Great speaking with you just now. Save my number, I\'ll send over the best options for a {property} that match what you\'re after.',
  'Lead - Viewing booked': 'Hi {first}, this is {me} from Apex Homes. Great speaking with you just now. Saving my number here so we can confirm the viewing. I\'ll send the details and location shortly.',
  'Lead - Send options': 'Hi {first}, this is {me} from Apex Homes. Thanks for your time just now. As promised, I\'ll send a few options for a {property} over shortly.',
  'Lead - Follow up': 'Hi {first}, this is {me} from Apex Homes, following up on your search for a {property}. Let me know a good time to catch up.',
  'Lead - Replied': 'Hi {first}, this is {me} from Apex Homes. Thanks for getting back to me about the {property}. When is a good time for a quick call?',
  'Lead - Already found': 'Hi {first}, this is {me} from Apex Homes. Thanks for your time just now, and glad you found a place. If you ever need help renting, buying or selling in Dubai, save my number and message me here any time.',
  'Lead - Agent': 'Hi {first}, this is {me} from Apex Homes. Thanks for your time just now. If you don\'t find the right {property} with your agent, save my number. I\'m happy to send options any time.',
  'Lead - Not interested': 'Hi {first}, this is {me} from Apex Homes. Thanks for your time just now. If you start looking again, renting, buying or selling, save my number and message me here any time.',
  'Lead - Other': 'Hi {first}, this is {me} from Apex Homes. Thanks for your time on the phone just now about the {property}. Save my number and message me here any time.',
  'Lead - Not looking anymore': 'Hi {first}, this is {me} from Apex Homes. Thanks for your time just now. If you start looking again, renting, buying or selling, save my number and message me here any time.',
  'Lead - default': 'Hi {first}, this is {me} from Apex Homes. Thanks for your time on the phone just now about the {property}. Save my number and message me here any time.',
};
function leadWhatsappText(f, me) {
  const first = titleCase(String(f.lead.name || '').split(/\s+/)[0]);
  const v = { first, me: String(me || '').split(/\s+/)[0], property: leadWhat(f.lead), area: f.lead.location && f.lead.location !== 'Not given' ? f.lead.location : 'Dubai' };
  const n = String(f.note || '').toLowerCase();
  const byNote = Object.keys(LEAD_WHATSAPP).filter((k) => k !== 'Lead - default').sort((a, b) => b.length - a.length)
    .find((k) => n.startsWith(k.slice(7).toLowerCase()));
  const key = byNote || (f.outcome === 'No answer' ? 'Lead - Called, no reply' : 'Lead - default');
  return fillTemplate((f.templates || {})[key] || LEAD_WHATSAPP[key], v);
}
// The messages someone can make their own, in the order the editor shows them
const waKeys = (lead, tone) => resultsFor(lead).filter((g) => g.tone === tone).flatMap((g) => g.items).filter((x) => x.wa !== false).map((x) => (lead ? 'Lead - ' : '') + x.k);
const MESSAGE_GROUPS = [
  ['Cold', waKeys(false, 'cold')],
  ['Hot', waKeys(false, 'hot')],
  ['Anything else', ['default']],
  ['Lead pool · cold', waKeys(true, 'cold')],
  ['Lead pool · hot', waKeys(true, 'hot')],
];
const msgLabel = (k) => (k === 'default' ? 'Any other outcome' : k.startsWith('Lead - ') ? (findResult(k.slice(7), true)?.label || k.slice(7)) : resultLabel(k));

// Edit your own WhatsApp messages, one per note (admins and directors can open anyone's from the Team page).
// Every message starts as the standard one; change any of them, and put any back to standard.
function MessagesEditor({ user, onClose }) {
  const [d, setD] = useState(null);
  const [v, setV] = useState({});
  const [open, setOpen] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    api('/api/desk?action=templates' + (user ? '&user=' + user : '')).then((j) => {
      const t = { ...j.templates };
      // Carry over messages saved by the first version (one for all no-answers, one for everything else)
      if (t.noanswer) MESSAGE_GROUPS[0][1].forEach((k) => { t[k] ??= t.noanswer; });
      if (t.spoke) [...MESSAGE_GROUPS[1][1], 'default'].forEach((k) => { t[k] ??= t.spoke; });
      delete t.noanswer; delete t.spoke;
      setD(j); setV(t);
    }).catch((e) => setErr(e.message));
  }, [user]);
  const first = d ? String(d.name).split(/\s+/)[0] : '';
  const ex0 = { first: 'Alaa', me: first, property: 'villa XK2060B in Zinnia', area: 'Damac Hills 2' };
  const exLead = { first: 'Alaa', me: first, property: '2 bed in Dubai Marina', area: 'Dubai Marina' };
  const exOf = (k) => (k.startsWith('Lead - ') ? exLead : ex0);
  const custom = Object.keys(v).filter((k) => v[k]).length;
  async function save() {
    setBusy(true); setErr('');
    try { await api('/api/desk?action=saveTemplates', { method: 'POST', body: { user, templates: v } }); setSaved(true); setTimeout(onClose, 700); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }
  const cold = resultsFor(false)[0].items.filter((x) => x.wa !== false).map((x) => x.k);   // the didn't-get-through messages
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="box msg-ed" role="dialog" aria-label="WhatsApp messages">
        <h3>{user && d ? `${d.name}'s WhatsApp messages` : 'My WhatsApp messages'}</h3>
        <p className="muted" style={{ margin: 0 }}>Each note has its own message. Change any of them to make it {user ? 'theirs' : 'yours'}, or leave the standard one.
          Use <code>{'{first}'}</code> owner's first name, <code>{'{me}'}</code> {user ? 'their' : 'your'} first name, <code>{'{property}'}</code> the unit (villa XK2060B in Zinnia), <code>{'{area}'}</code> the area (Damac Hills 2).</p>
        {!d && !err ? <p className="muted">Loading…</p> : <div className="msg-list">
          {MESSAGE_GROUPS.map(([g, keys]) => (
            <div key={g} className="msg-group"><span className={'lbl ' + (g === 'Cold' ? 'coldc' : g === 'Hot' ? 'hotc' : '')}>{g}</span>
              {keys.map((k) => {
                const mine = !!v[k];
                const isOpen = open === k;
                return (
                  <div key={k} className={'msg-row' + (isOpen ? ' open' : '')}>
                    <button className="msg-top" onClick={() => setOpen(isOpen ? null : k)} aria-expanded={isOpen}>
                      <b>{msgLabel(k)}</b><span className={mine ? 'tag mine' : 'tag'}>{mine ? (user ? 'Their own' : 'Your own') : 'Standard'}</span>
                      <span className="msg-peek">{fillTemplate(v[k] || standardMessage(k), exOf(k)).replace(/\s+/g, ' ')}</span></button>
                    {isOpen && <div className="msg-body">
                      <textarea rows={7} value={v[k] || standardMessage(k)} onChange={(e) => setV({ ...v, [k]: e.target.value === standardMessage(k) ? '' : e.target.value })} />
                      <div className="msg-prev"><span className="lbl">Preview</span><div>{fillTemplate(v[k] || standardMessage(k), exOf(k))}</div></div>
                      <div className="msg-acts">
                        {mine && <button className="link" onClick={() => setV({ ...v, [k]: '' })}>Put back the standard message</button>}
                        {mine && cold.includes(k) && <button className="link" onClick={() => setV({ ...v, ...Object.fromEntries(cold.map((c) => [c, v[k]])) })}>Use this for all the no-answer messages</button>}
                      </div>
                    </div>}
                  </div>);
              })}
            </div>))}
        </div>}
        {err && <p className="err" style={{ margin: 0 }}>{err}</p>}
        <div className="acts"><span className="muted" style={{ marginRight: 'auto' }}>{custom ? `${custom} changed` : 'All standard'}</span>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !d} onClick={save}>{saved ? 'Saved' : busy ? 'Saving…' : 'Save messages'}</button></div>
      </div>
    </div>
  );
}

// Laptop: WhatsApp Web (default) or the WhatsApp app, remembered in this browser
const getWaOpen = () => { try { return localStorage.getItem('waOpen') === 'app' ? 'app' : 'web'; } catch { return 'web'; } };
function FollowUp({ f, me, onDone, laptop }) {
  const [text, setText] = useState(() => whatsappText(f, me));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [how, setHow] = useState(getWaOpen);
  const flip = () => { const n = how === 'web' ? 'app' : 'web'; setHow(n); try { localStorage.setItem('waOpen', n); } catch {} };
  // result: 'sent' opens WhatsApp; 'unavailable' or 'not_sent' just records it. Each is added to the call's note.
  async function send(result) {
    setBusy(true); setErr('');
    // Laptop, WhatsApp Web: one "WhatsApp" tab is reused for every message and goes straight to the chat.
    // It's opened right away so the browser doesn't block it, then pointed at the chat once the server answers.
    const w = laptop && result === 'sent' && how === 'web' ? window.open('', 'apex-whatsapp') : null;
    try {
      const j = await api('/api/phone?action=whatsapp', { method: 'POST', body: { requestId: f.id, text, result } });
      if (j.url) {
        if (!laptop) window.location.href = j.url;
        else if (how === 'app') window.location.href = j.app;
        else if (w) { w.location.href = j.web; w.focus?.(); }
        else window.open(j.web, 'apex-whatsapp');
      }
      onDone(result);
    } catch (e) { w?.close(); setErr(e.message); }
    setBusy(false);
  }
  return (
    <div className={laptop ? 'wa-laptop' : 'callcard'}>
      <span className="muted">Follow up on WhatsApp · {f.note ? resultLabel(String(f.note).split(/[.:]/)[0]) : f.outcome}</span>
      <span className="who">{titleCase(f.owner_name)}</span>
      <span>{phonePlace({ ...f, subcommunity: titleCase(f.subcommunity), building: titleCase(f.building) })}</span>
      {f.wa_last && f.wa_last.missing && <p className="wa-warn">{f.wa_last.by.split(' ')[0]} marked this number &quot;not on WhatsApp&quot; on {fd(f.wa_last.at)}. Worth trying anyway.</p>}
      <textarea className="wamsg" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} />
      {err && <p className="err">{err}</p>}
      <button className="bigcall wa" disabled={busy || !text.trim()} onClick={() => send('sent')}>Open WhatsApp · mark as sent</button>
      {laptop && <span className="faint wa-how">Opens in {how === 'web' ? 'WhatsApp Web' : 'the WhatsApp app'} · <button className="link" onClick={flip}>use {how === 'web' ? 'the WhatsApp app' : 'WhatsApp Web'} instead</button></span>}
      <div className="wa-other">
        <button className="btn" disabled={busy} onClick={() => send('unavailable')}>Not on WhatsApp</button>
        <button className="btn" disabled={busy} onClick={() => send('not_sent')}>Not sent</button>
      </div>
    </div>
  );
}

// "WhatsApp sent" turned out wrong because the number isn't on WhatsApp: change the note to "WhatsApp unavailable"
function NotOnWhatsApp({ requestId, name, onFixed }) {
  const [st, setSt] = useState('');
  const fix = async () => {
    setSt('busy');
    try { await api('/api/phone?action=whatsappMissing', { method: 'POST', body: { requestId } }); setSt('done'); onFixed?.(); }
    catch (e) { setSt(e.message); }
  };
  if (st === 'done') return <p className="muted wa-fix">Changed to &quot;WhatsApp unavailable&quot;{name ? ` for ${titleCase(name)}` : ''}.</p>;
  return (
    <div className="wa-fix">
      <span className="muted">{name ? `WhatsApp to ${titleCase(name)} marked as sent.` : 'Number not on WhatsApp after all?'}</span>
      <button className="btn" disabled={st === 'busy'} onClick={fix}>Number not on WhatsApp</button>
      {st && st !== 'busy' && <span className="err">{st}</span>}
    </div>
  );
}

const leadWhat = (l) => {
  const b = String(l?.beds || '').trim();
  const kind = /^studio$/i.test(b) ? 'studio' : /^\d+$/.test(b) ? `${b} bed` : 'property';
  return kind + (l?.location && l.location !== 'Not given' ? ` in ${l.location}` : '');
};
const budgetText = (b) => (b ? 'AED ' + String(b).split(' - ').map((x) => (Number(x) ? fmt(Number(x)) : x)).join(' – ') : '');
const phonePlace = (x) => (x.lead ? `Lead · ${[bedsLabel(x.lead.beds) !== '—' ? bedsLabel(x.lead.beds) : '', x.lead.location, budgetText(x.lead.budget)].filter(Boolean).join(' · ')}` : x.unit_type === 'Villa' ? `${x.subcommunity} · ${/^Street /.test(x.unit_no) ? '' : 'villa '}${x.unit_no}` : `${x.building} · ${x.unit_no}`);

function PhoneScreen() {
  const [st, setSt] = useState({ name: '', pending: null, awaiting: null, followup: null });
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(false);
  const fails = useRef(0);
  const load = useCallback(() => api('/api/phone?action=pending')
    .then((j) => { fails.current = 0; setErr(''); setSt(j); })
    .catch((e) => { if (++fails.current >= 2) setErr(e.message || 'Can\'t reach the Owner Desk. Check your connection.'); }), []);

  useEffect(() => {
    // Checks every 3 seconds only while this screen is open and on show; nothing runs in the background.
    load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 3000);
    const vis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [load]);

  async function dial(id) {
    setErr('');
    try {
      const j = await api('/api/phone?action=dial', { method: 'POST', body: { id } });
      setSt((s) => ({ ...s, pending: null }));
      window.location.href = 'tel:' + j.tel;
      setTimeout(load, 1500);
    } catch (e) { setErr(e.message); load(); }
  }

  const { name, pending, awaiting, followup } = st;
  return (
    <main className="phone">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'start' }}>
        <div><h1>Apex Owner Desk</h1><span className="muted">{name ? `Signed in as ${name}` : ' '}</span></div>
        <ThemeToggle />
      </div>
      {pending && (
        <div className="callcard">
          <span className="muted">Call</span>
          <span className="who">{pending.owner_name}</span>
          <span>{phonePlace(pending)}</span>
          <span className="n muted">{pending.masked}</span>
          <button className="bigcall" onClick={() => dial(pending.id)}>Call</button>
        </div>
      )}
      {!pending && awaiting && !saved && (
        <div className="callcard">
          <span className="muted">How did the call go?</span>
          <span className="who">{awaiting.owner_name}</span>
          <span>{phonePlace(awaiting)}</span>
          <OutcomeForm big lead={!!awaiting.lead} requestId={awaiting.id} onSaved={(j) => { setSaved(j?.kendal || true); setSt((x) => ({ ...x, awaiting: null })); load().then(() => setTimeout(() => setSaved(false), j?.kendal ? 3000 : 0)); }} />
        </div>
      )}
      {!pending && !awaiting && !saved && followup && <FollowUp key={followup.id} f={followup} me={name} onDone={() => { setSt((x) => ({ ...x, followup: null })); load(); }} />}
      {!pending && !awaiting && !saved && !followup && st.lastWa && <NotOnWhatsApp key={st.lastWa.id} requestId={st.lastWa.id} name={st.lastWa.owner_name} />}
      {saved && <div className="waiting">Saved{saved.status && <KendalLine k={saved} />}</div>}
      <PhoneAlerts onCall={load} />
      {!pending && !awaiting && !saved && !followup && <div className="waiting">Waiting for a call from your laptop.<br />Press Call next to an owner or a lead and it appears here.</div>}
      {err && <p className="err">{err}</p>}
      <button className="link" style={{ alignSelf: 'center' }} onClick={() => getSupa().then((sb) => sb.auth.signOut())}>Sign out</button>
    </main>
  );
}

const b64ToBytes = (b64) => {
  const raw = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

// Turns on call notifications for this phone. On iPhone it only works from the home screen icon.
function PhoneAlerts({ onCall }) {
  const [state, setState] = useState('checking');
  const [err, setErr] = useState('');
  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (!('serviceWorker' in navigator)) { setState('unsupported'); return; }
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    const onMsg = (e) => { if (e.data?.type === 'call') onCall(); };
    navigator.serviceWorker.addEventListener('message', onMsg);
    if (!('PushManager' in window) || !('Notification' in window)) { setState(ios && !standalone ? 'install' : 'unsupported'); return () => navigator.serviceWorker.removeEventListener('message', onMsg); }
    if (Notification.permission === 'denied') { setState('blocked'); return () => navigator.serviceWorker.removeEventListener('message', onMsg); }
    (async () => {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      const r = await api('/api/phone?action=subscribe').catch(() => ({ phones: 0 }));
      setState(sub && Notification.permission === 'granted' && r.phones > 0 ? 'on' : 'off');
    })();
    return () => navigator.serviceWorker.removeEventListener('message', onMsg);
  }, [onCall]);

  async function turnOn() {
    setErr(''); setState('working');
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { setState(perm === 'denied' ? 'blocked' : 'off'); return; }
      const { publicKey } = await api('/api/phone?action=vapid');
      const reg = await navigator.serviceWorker.ready;
      const old = await reg.pushManager.getSubscription();
      if (old) await old.unsubscribe();
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
      await api('/api/phone?action=subscribe', { method: 'POST', body: { subscription: sub.toJSON(), test: true } });
      setState('on');
    } catch { setErr('Could not turn on alerts. Check your connection and try again.'); setState('off'); }
  }

  if (state === 'checking') return null;
  if (state === 'on') return <div className="alerts"><span className="ok">Call alerts are on</span><span className="muted">Pressing Call on your laptop sends a notification here.</span></div>;
  return (
    <div className="alerts">
      {state === 'install' && <><b>Add Apex Desk to your home screen</b><span className="muted">On iPhone, alerts only work from the home screen icon. In Safari tap Share, then Add to Home Screen, then open Apex Desk from that icon and sign in.</span></>}
      {state === 'unsupported' && <span className="muted">This browser can&apos;t show call alerts. Keep this screen open and calls will still appear here.</span>}
      {state === 'blocked' && <><b>Notifications are blocked</b><span className="muted">Allow notifications for Apex Desk in your phone&apos;s settings, then reopen it.</span></>}
      {(state === 'off' || state === 'working') && <><b>Turn on call alerts</b>
        <span className="muted">Get a notification on this phone whenever you press Call on your laptop.</span>
        <button className="bigcall" onClick={turnOn} disabled={state === 'working'}>{state === 'working' ? 'Turning on…' : 'Turn on call alerts'}</button></>}
      {err && <span className="err">{err}</span>}
    </div>
  );
}
