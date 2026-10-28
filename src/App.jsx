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
const QUICK_NOTES = {
  Cold: ['Called, no reply', 'Called, unreachable', 'Phone off', 'Sold', 'Agent'],
  Hot: ['Unit available, send WhatsApp', 'In discussion', 'Replied', 'Follow up', 'Send report', 'Wants to sell', 'Wants to rent', 'Wants to buy'],
};
// Hot or cold, from how a note starts. Shown as green (hot) or red (cold) wherever notes appear.
function noteTone(text) {
  const t = String(text || '').toLowerCase();
  const hit = (list) => list.some((q) => t.startsWith(q.toLowerCase()));
  if (hit(QUICK_NOTES.Hot) || hit(HOT_OUTCOMES) || t.startsWith('call back')) return 'hot';
  if (hit(QUICK_NOTES.Cold) || t.startsWith('cold') || hit(['No answer', 'Not interested', 'Wrong number', 'Do not call'])) return 'cold';
  return '';
}
function NoteTag({ text, clip, wrap }) {
  const tone = noteTone(text);
  return <span className={'notetag ' + tone + (clip ? ' clip' : '') + (wrap ? ' wrap' : '')} title={text}>{tone && <i className="nd" />}<span className="nt">{text}</span></span>;
}
const KENDAL_NOTES = ['Unit available, send WhatsApp', 'Wants to sell', 'Wants to rent', 'Wants to buy'];
function QuickNotes({ value, onPick }) {
  return (
    <div className="qnotes">
      {Object.entries(QUICK_NOTES).map(([group, list]) => (
        <div key={group} className={'qcol ' + group.toLowerCase()}>
          <span className="qh">{group}</span>
          {list.map((q) => <button type="button" key={q} className={'chip' + (value === q ? ' on' : '')} onClick={() => onPick(value === q ? '' : q)}>{q}</button>)}
        </div>
      ))}
    </div>
  );
}
const HOT_OUTCOMES = ['Wants valuation', 'Listing opportunity', 'Wants to sell']; // these tick "Send to Kendal" automatically
const TABS = [
  ['all', 'All units'], ['exp90', 'Ending in 90 days'], ['reports', 'Reports today'],
  ['port', 'Portfolio owners'], ['mort', 'Mortgaged'], ['never', 'Never called'], ['callbacks', 'Callbacks this week'],
];
const BEDS = ['Studio', '1', '2', '3', '4', '5', '6', '7'];
const EXPIRY = [['30', 'Within 30 days'], ['90', 'Within 90 days'], ['180', 'Within 6 months'], ['365', 'Within a year'], ['', 'Any time']];
// WhatsApp follow-up after a call. {first} = owner's first name, {me} = broker's first name,
// {property} = e.g. "villa 12 in Maple 1" or "apartment 504 in Acacia A", {area} = e.g. "Dubai Hills Estate".
// The broker can edit the message before it opens in WhatsApp. No message is offered for Wrong number or Do not call.
// Message for each quick note. Used first when the note starts with one of these; otherwise the outcome decides.
const WHATSAPP_BY_NOTE = {
  'Called, no reply': 'Hi {first}, this is {me} from Apex Homes. I just tried giving you a call regarding your {property}, {area}. When would be a good time to talk?',
  'Called, unreachable': 'Hi {first}, this is {me} from Apex Homes. I just tried giving you a call regarding your {property}, {area}. When would be a good time to talk?',
  'Phone off': 'Hi {first}, this is {me} from Apex Homes. I just tried giving you a call regarding your {property}, {area}. When would be a good time to talk?',
  'Send report': 'Hi {first}, this is {me} from Apex Homes. Great speaking with you just now. As promised, I\'ll send over a market report for your {property}, {area} today.',
  'Unit available, send WhatsApp': 'Hi {first}, this is {me} from Apex Homes. Great speaking with you just now. As discussed, could you send me a few details on your {property}, {area}: photos, when it\'s available and the price you have in mind? I\'ll take it from there.',
  'In discussion': 'Hi {first}, this is {me} from Apex Homes. Thanks for your time just now regarding your {property}, {area}. Saving my number here so we can keep the conversation going.',
  'Replied': 'Hi {first}, this is {me} from Apex Homes. Thanks for getting back to me about your {property}, {area}. When is a good time for a quick call?',
  'Follow up': 'Hi {first}, this is {me} from Apex Homes, following up on our conversation about your {property}, {area}. Let me know a good time to catch up.',
  'Wants to sell': 'Hi {first}, this is {me} from Apex Homes. Thanks for your time just now. As discussed, I\'ll put together a valuation and recent sales for your {property}, {area} and send it over shortly.',
  'Wants to rent': 'Hi {first}, this is {me} from Apex Homes. Thanks for your time just now. As discussed, I\'ll pull together current rents for your {property}, {area} and come back to you with a plan to get it rented.',
  'Wants to buy': 'Hi {first}, this is {me} from Apex Homes. Great speaking with you just now. Send me your budget and what you\'re looking for, and I\'ll share the best options available.',
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
.qcol{display:flex;flex-direction:column;align-items:flex-start;gap:5px;border:1px solid var(--line);border-radius:10px;padding:8px 10px}
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
.unums{display:grid;gap:6px;margin-top:10px} .sect .unums,.section .unums{margin-top:0} .unums .lbl{font-size:12px;color:var(--muted);margin-top:2px} .unums input{width:100%;min-width:0}
.hf .pair{display:grid;grid-template-columns:1fr 1fr;gap:8px} .hf .pair input{width:100%;min-width:0}
.hf-b{padding:10px 12px;display:grid;gap:2px;max-height:340px;overflow:auto} .hf-b select,.hf-b input[type=search]{width:100%}
td{padding:10px 10px 10px 0;border-bottom:1px solid var(--line);vertical-align:top}
tbody tr{cursor:pointer} tbody tr:hover td{background:var(--hover)}
td.r,th.r{text-align:right} .unit{font-weight:600}
.ph{color:var(--muted);user-select:none;-webkit-user-select:none;white-space:nowrap}
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
.dash-head h1{font-size:22px;margin:0;font-weight:650} .dash-head p{margin:4px 0 0}
.dash-ctl{display:flex;gap:10px;align-items:center} .dash-ctl select{padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg)}
.kpis{display:grid;grid-template-columns:1.6fr repeat(4,1fr);gap:12px;margin-bottom:12px}
@media (max-width:1000px){.kpis{grid-template-columns:1fr 1fr}}
.kpi{border:1px solid var(--line);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:4px;background:var(--bg)}
.kpi span{font-size:12px;color:var(--muted)} .kpi b{font-size:28px;font-weight:700;letter-spacing:-.02em} .kpi b small{font-size:15px;color:var(--faint);font-weight:500}
.kpi em{font-style:normal;font-size:12px;color:var(--faint)}
.kpi.hot b{color:var(--hot)} .kpi.cold b{color:var(--cold)}
.kpi.big{background:linear-gradient(110deg,color-mix(in srgb,var(--accent) 9%,var(--bg)),var(--bg) 70%)} .kpi.big b{color:var(--accent)}
.kbar{height:8px;border-radius:999px;background:var(--hover);overflow:hidden;margin-top:4px}
.kbar i{display:block;height:100%;background:var(--accent);border-radius:999px;transition:width .5s} .kbar i.hit{background:var(--hot)}
.kbar.sm{display:inline-block;width:70%;height:6px;vertical-align:middle;margin:0 8px 0 0}
.dash-grid{display:grid;grid-template-columns:1.4fr 1fr;gap:12px;margin-bottom:12px} @media (max-width:1000px){.dash-grid{grid-template-columns:1fr}}
.dash-grid>.card:only-child{grid-column:1/-1} .dash-grid>*{min-width:0} .dash .card{overflow-x:auto}
.card{border:1px solid var(--line);border-radius:12px;padding:14px 16px;background:var(--bg)}
.card h4{margin:0 0 12px;font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.bars{display:flex;align-items:flex-end;gap:6px;height:150px}
.bar-c{flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;height:100%;justify-content:flex-end;min-width:0}
.bar-v{width:100%;max-width:38px;min-height:2px;border-radius:6px 6px 2px 2px;background:linear-gradient(180deg,var(--accent),color-mix(in srgb,var(--accent) 60%,#fff));position:relative;transition:height .5s}
.bar-v span{position:absolute;top:-17px;left:50%;transform:translateX(-50%);font-size:11px;color:var(--muted)}
.bar-c em{font-style:normal;font-size:10.5px;color:var(--faint);white-space:nowrap}
table.mini{width:100%;min-width:0;border-collapse:collapse} table.mini th{text-align:left;font-size:11.5px;color:var(--muted);font-weight:500;padding:6px 8px;border-bottom:1px solid var(--line)}
table.mini td{padding:9px 8px;border-bottom:1px solid var(--line)} table.mini tr:last-child td{border-bottom:none} table.mini .r{text-align:right}
table.mini tr.click{cursor:pointer} table.mini tr.click:hover td{background:var(--hover)}
.lb .rank{font-size:17px;text-align:center} .lb tr.idle td{color:var(--faint)}
.hotc{color:var(--hot)} .coldc{color:var(--cold)}
.target{position:relative;overflow:hidden;margin-top:18px;border:1px solid var(--line);border-radius:14px;padding:14px 18px;
  display:grid;grid-template-columns:minmax(220px,auto) 1fr auto;gap:8px 22px;align-items:center;
  background:linear-gradient(100deg,color-mix(in srgb,var(--accent) 8%,var(--bg)),var(--bg) 60%)}
@media (max-width:900px){.target{grid-template-columns:1fr}}
.t-num{display:flex;align-items:baseline;gap:6px} .t-num b{font-size:28px;font-weight:700;letter-spacing:-.02em;color:var(--accent)} .t-num span{color:var(--muted)}
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
async function api(path, opts = {}) {
  const sb = await getSupa();
  const { data } = await sb.auth.getSession();
  const r = await fetch(path, {
    ...opts,
    signal: opts.signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token || ''}`, ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { window.dispatchEvent(new Event('signed-out')); }
  if (!r.ok) throw Object.assign(new Error(j.error || 'Something went wrong. Try again.'), { status: r.status });
  return j;
}

// ── App shell ───────────────────────────────────────────────────────────────
export default function App() {
  const [session, setSession] = useState(undefined);
  const isPhone = window.location.pathname.startsWith('/phone');

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
      {session === undefined ? null : !session ? <Login /> : isPhone ? <PhoneScreen /> : <Desk />}
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
const EMPTY = { q: '', area: [], sc: [], bld: [], st: [], exp: '', from: '', to: '', type: [], beds: [], smin: '', smax: '', umin: '', umax: '', useries: '', rmin: '', rmax: '', pmin: '', pmax: '',
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
    const t = setInterval(() => { if (document.visibilityState === 'visible') loadCo(); }, fast ? 4000 : 15000);
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
  const calloutOn = phase === 'live' && co?.meIn;

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
            {me && me.staff.role !== 'broker' && <button className={view === 'dash' ? 'on' : ''} onClick={() => setView('dash')}>Dashboard</button>}
            <button className={view === 'activity' ? 'on' : ''} onClick={() => setView('activity')}>Activity</button>
            {me && ['admin', 'director'].includes(me.staff.role) && <button className={view === 'team' ? 'on' : ''} onClick={() => setView('team')}>Team</button>}
            <a className="link" style={{ color: 'var(--muted)' }} href="/phone">Phone</a>
          </nav>
          {boss && (phase === 'live' || phase === 'countdown'
            ? <span className="co-pill"><i />Call out running</span>
            : <button className="co-start" onClick={() => setStartOpen(true)}>Start call out</button>)}
          <div className="right">
            {me && <span>Profiles <span className="n">{me.caps.profiles}/{me.caps.profileCap}</span></span>}
            {me && <span>Calls <span className="n">{me.caps.calls}/{me.caps.callCap}</span></span>}
            <ThemeToggle />
            {me && <button className="link" onClick={() => setMsgFor('me')}>My messages</button>}
            {me && <span>{me.staff.name}</span>}
            <button className="link" onClick={() => getSupa().then((sb) => sb.auth.signOut())}>Sign out</button>
          </div>
        </div>
      </header>
      {view === 'owners' ? (me ? <Owners banner={calloutOn ? <CalloutBar co={co} boss={boss} onChange={loadCo} /> : null} places={me.places || []} target={me.target} prefs={me.prefs} onSavePrefs={savePrefs} canOverride={me.staff.role !== 'broker'} onCaps={refreshMe} onOpen={setUnitId} /> : <div className="gut muted" style={{ padding: 40 }}>Loading…</div>) : view === 'lookup' ? <Lookup onOpen={setUnitId} /> : view === 'dash' ? <Dashboard /> : view === 'team' ? <Team myRole={me?.staff.role} onMessages={setMsgFor} /> : <Activity />}
      {unitId && <UnitPanel id={unitId} canOverride={me && me.staff.role !== 'broker'} onClose={() => setUnitId(null)} onOpen={setUnitId} onCaps={refreshMe} />}
      {phase === 'countdown' && co?.meIn && <CalloutCountdown co={co} />}
      {phase === 'done' && co?.meIn && !resultsSeen && <CalloutResults co={co} onClose={closeResults} />}
      {msgFor && <MessagesEditor user={msgFor === 'me' ? null : msgFor} onClose={() => setMsgFor(null)} />}
      {startOpen && <StartCallout onClose={() => setStartOpen(false)} onStarted={() => { setStartOpen(false); loadCo(); }} />}
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}

function Owners({ places, onOpen, target, onCaps, canOverride, prefs, onSavePrefs, banner }) {
  // Start from the broker's saved view if they have one
  const start = useRef({
    f: normF(prefs?.f), tab: prefs?.tab || 'all', sort: prefs?.sort || 'unit',
    cols: (prefs?.cols || []).filter((k) => COLUMNS.some((c) => c.k === k)), side: prefs?.side !== false,
  }).current;
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
    <span className="lbl">Series</span>
    <input type="text" inputMode="numeric" maxLength={4} placeholder="e.g. 02 for 102, 202, 302" value={f.useries}
      onChange={(e) => change({ useries: e.target.value.replace(/\D/g, '') }, true)} />
  </div>;
  const search = () => <input type="search" autoFocus placeholder="Search owner, building or unit" value={f.q} onChange={(e) => change({ q: e.target.value }, true)} />;
  const HEAD_FILTERS = {
    unit: { on: ['q', 'umin', 'umax', 'useries'], ui: () => <>{search()}{unitNums()}</> },
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
      {banner || (target && <TargetBar t={target} />)}
      <div className="head gut">
        <h1>Owners</h1>
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
          <Section title="Unit number" on={f.umin || f.umax || f.useries}>{unitNums(true)}</Section>
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
            {TABS.map(([k, l]) => <button key={k} className={'tab' + (tab === k ? ' on' : '') + ((k === 'callbacks' || k === 'reports') && c[k] ? ' due' : '')}
              title={k === 'callbacks' ? 'Owners whose last call this week got no answer. Work through them on Friday.' : undefined}
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
              <ColumnPicker cols={cols} setCols={setCols} />
            </span>
          </div>
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
    ? <div className="stack">{ownersOf(r).map((o) => <div key={o.id}><span className="ph">{o.masked ?? <span className="faint">none</span>}</span></div>)}</div> : <span className="faint">none</span>) },
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
  const gap = above.calls - me.calls;
  if (gap === 0) return `Level with ${first(above.name)}. One more call and you're ahead!`;
  const chase = gap <= 2 ? `So close! ${gap} more and you pass ${first(above.name)}.` : `${gap} calls behind ${first(above.name)} for #${i}.`;
  return i === 1 ? chase : `${chase} ${first(leader.name)} leads with ${leader.calls}.`;
}
function TargetBar({ t }) {
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
          <div className="t-num"><b className="n">{made}</b><span>/ {goal} calls today</span></div>
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
        <div key={o.id}>{o.has_phone && !o.dnc && (unitHold
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
                      {o.role === 'owner' && <> · <span className="ph">{o.masked ?? 'no mobile'}</span></>}{o.dnc ? ' · asked not to be called' : ''}</span>
                    {o.role === 'owner' && o.units > 1 && <span className="sub">Also owns {d.others.filter((x) => x.owner_id === o.id).map((x) => (
                      <button key={x.id} className="link" style={{ marginRight: 8 }} onClick={() => onOpen(x.id)}>{x.unit_type === 'Villa' ? x.subcommunity : x.building} {x.unit_no}</button>))}</span>}
                  </div>
                  <div>{o.role === 'owner' && o.has_phone && !o.dnc && (o.hold
                    ? <span className="heldcell"><HoldChip h={o.hold} long />{canOverride && <button className="btn ghost" onClick={() => setCalling({ ...o, force: true })}>Call anyway</button>}</span>
                    : <button className="btn" onClick={() => setCalling(o)}>Call</button>)}</div>
                </div>
              ))}
            </div>
          </div>
          <Notes unitId={u.id} notes={d.notes} onAdded={(n) => setD((x) => ({ ...x, notes: [n, ...x.notes] }))} />
          <div className="blk"><h4>Calls</h4>
            {d.calls.length === 0 ? <p className="muted">Not called yet</p> : d.calls.map((c, i) => (
              <div key={i} className="owner"><span>{c.outcome ?? (c.note ? '' : 'No outcome logged')}{c.note && <span className="sub"><NoteTag text={c.note} /></span>}</span>
                <span className="muted">{c.full_name}, {fdt(c.called_at)}</span></div>
            ))}
          </div>
          <p className="fine">The full number never reaches this laptop. Call sends it to your phone and logs it under your name.</p>
        </>}
      </aside>
      {calling && u && <CallFlow unitId={u.id} owner={calling} force={!!calling.force} label={`${calling.name}, ${place} ${u.unit_no}`}
        onClose={(saved) => { setCalling(null); onCaps(); if (saved) load(); }} />}
    </>
  );
}

// Notes on a unit. Anyone with the area sees them; they stay on the record with the writer's name.
function Notes({ unitId, notes, onAdded }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function save() {
    if (!text.trim()) return;
    setBusy(true); setErr('');
    try { const j = await api('/api/desk?action=addNote', { method: 'POST', body: { unitId, body: text } }); onAdded(j.note); setText(''); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }
  return (
    <div className="blk"><h4>Notes</h4>
      <QuickNotes value={text} onPick={setText} />
      <textarea className="notebox" placeholder="Add a note about this unit or owner" value={text} maxLength={2000}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save(); }} />
      <div className="noteact">
        <span className="faint">Ctrl/⌘ + Enter to save</span>
        <button className="btn primary" disabled={!text.trim() || busy} onClick={save}>{busy ? 'Saving…' : 'Save note'}</button>
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

// Laptop side of a call: send to phone, wait for the tap, then log the outcome
// After the outcome is saved on the laptop: offer the WhatsApp follow-up here too (it also shows on the phone)
function DoneStep({ requestId, onClose }) {
  const [f, setF] = useState(undefined);
  const [me, setMe] = useState('');
  const [sent, setSent] = useState(false);
  useEffect(() => {
    api('/api/phone?action=pending').then((j) => { setMe(j.name); setF(j.followup && j.followup.id === requestId ? j.followup : null); }).catch(() => setF(null));
  }, [requestId]);
  return <>
    <h3>Saved</h3>
    <p className="muted">The outcome is on the unit&apos;s call history.</p>
    {f && !sent && <FollowUp laptop f={f} me={me} onDone={(r) => setSent(r)} />}
    {sent && <p className="muted">{sent === 'sent' ? 'WhatsApp opened in a new tab. Added "WhatsApp sent" to the note.' : sent === 'unavailable' ? 'Added "WhatsApp unavailable" to the note.' : 'Added "WhatsApp not sent" to the note.'}</p>}
    <button className="btn" style={{ marginTop: 10 }} onClick={onClose}>Close</button>
  </>;
}

function CallFlow({ unitId, owner, label, onClose, force }) {
  const [stage, setStage] = useState('sending');
  const [msg, setMsg] = useState('');
  const [req, setReq] = useState(null);

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
        {stage === 'dialled' && <><h3>How did it go?</h3><p className="muted">{label}</p><OutcomeForm requestId={req.requestId} onSaved={() => setStage('done')} /></>}
        {stage === 'done' && <DoneStep requestId={req.requestId} onClose={() => onClose(true)} />}
      </div>
    </div>
  );
}

function OutcomeForm({ requestId, onSaved, big }) {
  const [pick, setPick] = useState('');
  const [note, setNote] = useState('');
  const [kendal, setKendal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const choose = (o) => { const n = pick === o ? '' : o; setPick(n); setKendal(HOT_OUTCOMES.includes(n) || KENDAL_NOTES.includes(note)); };
  const pickNote = (q) => { setNote(q); setKendal(HOT_OUTCOMES.includes(pick) || KENDAL_NOTES.includes(q)); };
  async function save() {
    setBusy(true); setErr('');
    try { await api('/api/phone?action=outcome', { method: 'POST', body: { requestId, outcome: pick, note, kendal } }); onSaved(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }
  return (
    <div>
      <div className={big ? 'outcomes' : 'radios'}>
        {OUTCOMES.map((o) => big
          ? <button key={o} type="button" className={pick === o ? 'on' : ''} onClick={() => choose(o)}>{o}</button>
          : <label className="cb" key={o}><input type="radio" name={`oc-${requestId}`} checked={pick === o} onChange={() => {}} onClick={() => choose(o)} />{o}</label>)}
      </div>
      <label className="cb" style={{ marginTop: 10 }}><input type="checkbox" checked={kendal} onChange={(e) => setKendal(e.target.checked)} />Send to Kendal as a lead</label>
      <QuickNotes value={note} onPick={pickNote} />
      <textarea placeholder="Or type your own note" value={note} onChange={(e) => setNote(e.target.value)} />
      {err && <p className="err">{err}</p>}
      <button className={big ? 'bigcall' : 'btn primary'} disabled={(!pick && !note.trim()) || busy} onClick={save}>{busy ? 'Saving…' : pick ? 'Save outcome' : 'Save note'}</button>
      <p className="faint" style={{ margin: '6px 0 0', fontSize: 12 }}>An outcome is optional. A note on its own is enough.</p>
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
  outcome: 'Logged an outcome', copy_blocked: 'Tried to copy owner data', limit_hit: 'Hit a daily limit',
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

function StartCallout({ onClose, onStarted }) {
  const [info, setInfo] = useState(null);
  const [v, setV] = useState({ minutes: 45, custom: '', teams: [], target: 15, prize: '', mode: 'calls' });
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
    setBusy(true); setErr('');
    try { await api('/api/desk?action=calloutStart', { method: 'POST', body: { ...v, minutes: mins } }); onStarted(); }
    catch (e) { setErr(e.message); setBusy(false); }
  }
  return (
    <div className="modal" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="box co-setup" role="dialog" aria-label="Start a call out">
        <div><h3>Start a call out</h3>
          <p className="muted">Everyone in it switches into call out mode after a 10 second countdown. Only calls dialled during the timer count.</p></div>
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
          <label className="co-f"><span className="lbl">Prize (optional)</span><input maxLength={80} placeholder="e.g. Lunch on Ollie" value={v.prize} onChange={(e) => setV({ ...v, prize: e.target.value })} /></label>
        </div>
        <div className="co-f"><span className="lbl">What wins</span>
          <div className="co-chips round">{[['calls', 'Most calls'], ['hot', 'Most hot leads'], ['points', 'Points (call 1, hot 5)']].map(([k, l]) =>
            <button key={k} className={v.mode === k ? 'on' : ''} onClick={() => setV({ ...v, mode: k })}>{l}</button>)}</div></div>
        {err && <p className="err" style={{ margin: 0 }}>{err}</p>}
        <div className="co-foot"><span className="muted">{people ? `${pl(people, 'person').replace('persons', 'people')} · team target ${(Number(v.target) || 0) * people} calls` : ''}</span>
          <div style={{ display: 'flex', gap: 8 }}><button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" disabled={busy || !info} onClick={start}>{busy ? 'Starting…' : `Start ${mins || ''} min call out`}</button></div></div>
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
      <div className="co-clock"><span className="co-kicker"><i />CALL OUT LIVE</span>
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
      <div className="co-me"><span className="co-dim">YOU</span>
        <b>{me && (coScore(co, me) || myIdx > 0) ? ordinal(myIdx + 1) : '–'}</b>
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

// ── Team: add people and choose their areas (admins and directors) ─────────
const ROLE_LABEL = { broker: 'Broker', manager: 'Manager', director: 'Director', admin: 'Admin' };
function Team({ myRole, onMessages }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(null); // { mode: 'new' | 'edit', ...person }
  const [q, setQ] = useState('');
  const load = useCallback(() => api('/api/desk?action=team').then((j) => { setD(j); setErr(''); }).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (err && !d) return <main className="gut"><p className="err" style={{ marginTop: 30 }}>{err}</p></main>;
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

function Dashboard() {
  const [period, setPeriod] = useState('today');
  const [team, setTeam] = useState('');
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => {
    api(`/api/desk?action=dashboard&period=${period}&team=${encodeURIComponent(team)}`).then((j) => { setD(j); setErr(''); }).catch((e) => setErr(e.message));
  }, [period, team]);
  useEffect(() => { load(); const t = setInterval(() => document.visibilityState === 'visible' && load(), 60000); return () => clearInterval(t); }, [load]);
  if (err) return <main className="gut"><p className="err" style={{ marginTop: 30 }}>{err}</p></main>;
  if (!d) return <main className="gut muted" style={{ padding: 40 }}>Loading…</main>;
  const per = d.goal * d.workdays;
  const total = d.rows.reduce((a, r) => a + r.calls, 0);
  const hot = d.rows.reduce((a, r) => a + r.hot, 0);
  const cold = d.rows.reduce((a, r) => a + r.cold, 0);
  const wa = d.rows.reduce((a, r) => a + r.wa, 0);
  const active = d.rows.filter((r) => r.calls > 0).length;
  const teamTarget = per * Math.max(1, d.rows.length);
  const label = { today: 'today', week: 'this week', month: 'this month' }[period];
  // Chart: by hour today, by day for week/month
  let bars;
  if (period === 'today') { bars = Array.from({ length: 11 }, (_, i) => { const h = 8 + i; return { k: `${h}:00`, n: d.series.find((x) => Number(x.k) === h)?.n || 0 }; }); }
  else {
    const out = []; const start = new Date(String(d.start)); const end = new Date();
    for (let x = new Date(start); x <= end; x.setDate(x.getDate() + 1)) {
      const k = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(x);
      const lab = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dubai', weekday: period === 'week' ? 'short' : undefined, day: 'numeric' }).format(x);
      if (!out.some((o) => o.key === k)) out.push({ key: k, k: lab, n: d.series.find((s) => s.k === k)?.n || 0 });
    }
    bars = out;
  }
  const maxBar = Math.max(1, ...bars.map((b) => b.n));
  const medal = ['🥇', '🥈', '🥉'];
  return (
    <main className="gut dash">
      <div className="dash-head">
        <div><h1>{d.all ? (d.team ? d.team : 'Director overview') : `${d.myTeam || 'Your team'}`}</h1>
          <p className="muted">{d.all ? 'Calls across every team' : 'Your team\'s calls'} {label} · target {d.goal} a day per person{period !== 'today' ? ` · ${d.workdays} working day${d.workdays > 1 ? 's' : ''} so far` : ''}</p></div>
        <div className="dash-ctl">
          {d.all && <select value={team} onChange={(e) => setTeam(e.target.value)}><option value="">All teams</option>{d.teamNames.map((t) => <option key={t} value={t}>{t}</option>)}</select>}
          <div className="seg">{[['today', 'Today'], ['week', 'This week'], ['month', 'This month']].map(([k, l]) => <button key={k} className={period === k ? 'on' : ''} onClick={() => setPeriod(k)}>{l}</button>)}</div>
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
          <h4>{period === 'today' ? 'Calls by hour' : 'Calls by day'}</h4>
          <div className="bars">{bars.map((b, i) => (
            <div key={i} className="bar-c" title={`${b.k}: ${b.n}`}><div className="bar-v" style={{ height: `${(b.n / maxBar) * 100}%` }}>{b.n ? <span>{b.n}</span> : null}</div><em>{b.k}</em></div>))}</div>
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
              <td><div className="kbar sm"><i style={{ width: `${Math.min(100, (r.calls / per) * 100)}%` }} className={r.calls >= per ? 'hit' : ''} /></div><span className="faint">{Math.round((r.calls / per) * 100)}%</span></td>
              <td className="r n hotc">{r.hot}</td><td className="r n coldc">{r.cold}</td><td className="r n">{r.wa}</td>
              <td className="muted">{r.last_at ? fdt(r.last_at) : 'No calls yet'}</td>
            </tr>))}</tbody></table>
        {d.rows.length === 0 && <p className="muted">Nobody is set up in this team yet.</p>}
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
const isNoAnswer = (f) => f.outcome === 'No answer' || /^(called, (no reply|unreachable)|phone off)/i.test(String(f.note || ''));
function fillTemplate(t, v) {
  return t.split('{first}').join(v.first).split('{me}').join(v.me).split('{property}').join(v.property).split('{area}').join(v.area)
    .replace(/Hi ,/g, 'Hi,').replace(/Hi\s+\n/g, 'Hi,\n');
}
function whatsappText(f, me) {
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
const standardMessage = (key) => WHATSAPP_BY_NOTE[key] || WHATSAPP[key] || WHATSAPP.default;
// The messages someone can make their own, in the order the editor shows them
const MESSAGE_GROUPS = [
  ['Cold', ['Called, no reply', 'Called, unreachable', 'Phone off', 'No answer']],
  ['Hot', ['Unit available, send WhatsApp', 'In discussion', 'Replied', 'Follow up', 'Send report', 'Wants to sell', 'Wants to rent', 'Wants to buy', 'Call back']],
  ['Anything else', ['default']],
];
const msgLabel = (k) => (k === 'default' ? 'Any other outcome' : k === 'No answer' || k === 'Call back' ? `${k} (outcome)` : k);

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
  const ex = { first: 'Alaa', me: first, property: 'villa XK2060B in Zinnia', area: 'Damac Hills 2' };
  const custom = Object.keys(v).filter((k) => v[k]).length;
  async function save() {
    setBusy(true); setErr('');
    try { await api('/api/desk?action=saveTemplates', { method: 'POST', body: { user, templates: v } }); setSaved(true); setTimeout(onClose, 700); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  }
  const cold = MESSAGE_GROUPS[0][1];
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
                      <span className="msg-peek">{fillTemplate(v[k] || standardMessage(k), ex).replace(/\s+/g, ' ')}</span></button>
                    {isOpen && <div className="msg-body">
                      <textarea rows={7} value={v[k] || standardMessage(k)} onChange={(e) => setV({ ...v, [k]: e.target.value === standardMessage(k) ? '' : e.target.value })} />
                      <div className="msg-prev"><span className="lbl">Preview</span><div>{fillTemplate(v[k] || standardMessage(k), ex)}</div></div>
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

function FollowUp({ f, me, onDone, laptop }) {
  const [text, setText] = useState(() => whatsappText(f, me));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // result: 'sent' opens WhatsApp; 'unavailable' or 'not_sent' just records it. Each is added to the call's note.
  async function send(result) {
    setBusy(true); setErr('');
    // On the laptop WhatsApp opens in a new tab (WhatsApp Desktop or WhatsApp Web). The tab is opened
    // straight away so the browser doesn't block it, then pointed at WhatsApp once the server answers.
    const w = laptop && result === 'sent' ? window.open('', '_blank') : null;
    try {
      const j = await api('/api/phone?action=whatsapp', { method: 'POST', body: { requestId: f.id, text, result } });
      if (j.url) { if (w) w.location.href = j.url; else if (laptop) window.open(j.url, '_blank'); else window.location.href = j.url; }
      onDone(result);
    } catch (e) { w?.close(); setErr(e.message); }
    setBusy(false);
  }
  return (
    <div className={laptop ? 'wa-laptop' : 'callcard'}>
      <span className="muted">Follow up on WhatsApp · {f.outcome || String(f.note || '').split('.')[0]}</span>
      <span className="who">{titleCase(f.owner_name)}</span>
      <span>{phonePlace({ ...f, subcommunity: titleCase(f.subcommunity), building: titleCase(f.building) })}</span>
      <textarea className="wamsg" value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} />
      {err && <p className="err">{err}</p>}
      <button className="bigcall wa" disabled={busy || !text.trim()} onClick={() => send('sent')}>Open WhatsApp · mark as sent</button>
      <div className="wa-other">
        <button className="btn" disabled={busy} onClick={() => send('unavailable')}>WhatsApp unavailable</button>
        <button className="btn" disabled={busy} onClick={() => send('not_sent')}>Not sent</button>
      </div>
    </div>
  );
}

const phonePlace = (x) => (x.unit_type === 'Villa' ? `${x.subcommunity} · ${/^Street /.test(x.unit_no) ? '' : 'villa '}${x.unit_no}` : `${x.building} · ${x.unit_no}`);

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
          <OutcomeForm big requestId={awaiting.id} onSaved={() => { setSaved(true); setSt((x) => ({ ...x, awaiting: null })); load().then(() => setSaved(false)); }} />
        </div>
      )}
      {!pending && !awaiting && !saved && followup && <FollowUp key={followup.id} f={followup} me={name} onDone={() => { setSt((x) => ({ ...x, followup: null })); load(); }} />}
      {saved && <div className="waiting">Saved</div>}
      <PhoneAlerts onCall={load} />
      {!pending && !awaiting && !saved && !followup && <div className="waiting">Waiting for a call from your laptop.<br />Press Call next to an owner and it appears here.</div>}
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
