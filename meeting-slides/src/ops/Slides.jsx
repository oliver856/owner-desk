// ─────────────────────────────────────────────────────────────────────────────
// The Friday meeting slides, made from that week's real figures (GET /api/ops?action=slides, api/_lib/slides.js).
// Opens as a preview over the Meeting page; "Download PDF" prints it, one 1280 x 720 slide per page, so the same
// file goes on the TV and out to everyone. Slides with nothing to show are left out (no last week's actions in the
// first week, no group slide for a group with nobody in it).
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const INK = '#1a1a1a', MUT = '#5f5f5f', GOLD = '#8c7a5b', LINE = '#e6e1d6';
const G = ['#2f6b4f', '#e6efe9'], A = ['#8a5a12', '#f6ecd9'], R = ['#a33a2b', '#f5e1dd'], GREY = ['#6b6b6b', '#efefef'];
const sans = "Inter, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif", jost = 'Jost, Inter, sans-serif';

const CSS = `
.sl-scrim{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.45);overflow:auto;padding:20px 12px 60px}
.sl-bar{position:sticky;top:0;z-index:2;display:flex;gap:8px;align-items:center;justify-content:flex-end;max-width:1280px;margin:0 auto 14px;padding:10px 12px;background:var(--bg);border-radius:10px}
.sl-bar .grow{flex:1}
.sl-list{display:flex;flex-direction:column;align-items:center;gap:18px}
.sl-zoom{zoom:.62}
@media (min-width:1500px){.sl-zoom{zoom:.8}}
`;
const PRINT_CSS = `
@media print{
  @page{size:1280px 720px;margin:0}
  html,body{background:#fff!important}
  body>*:not(.sl-print){display:none!important}
  .sl-print .sl-scrim{position:static;background:none;padding:0;overflow:visible}
  .sl-print .sl-bar,.sl-print .sl-hint{display:none!important}
  .sl-print .sl-zoom{zoom:1}
  .sl-print .sl-list{display:block}
  .sl-slide{box-shadow:none!important;break-after:page;page-break-after:always;margin:0!important}
  .sl-slide:last-child{break-after:auto;page-break-after:auto}
}`;

// ── Formatting ──
const n0 = (v) => Math.round(Number(v || 0)).toLocaleString('en-GB');
const money = (v) => {
  const x = Math.round(Number(v || 0));
  return x >= 1e6 ? 'AED ' + (x / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M' : x >= 1e3 ? 'AED ' + Math.round(x / 1e3) + 'k' : 'AED ' + x;
};
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const noon = (s) => new Date(String(s).slice(0, 10) + 'T12:00:00');
const longDate = (s) => noon(s).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = (s) => noon(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const monthName = (s) => noon(s).toLocaleDateString('en-GB', { month: 'long' });
const weekNo = (s) => { const d = noon(s); d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7)); const y = new Date(d.getFullYear(), 0, 4); return 1 + Math.round(((d - y) / 864e5 - 3 + ((y.getDay() + 6) % 7)) / 7); };
const quarterName = (s) => 'Q' + (Math.floor((noon(s).getMonth()) / 3) + 1) + ' ' + noon(s).getFullYear();
const status = (billed, target, pace) => { const p = target ? billed / target : 1; return p >= 1 || p >= pace ? G : p >= pace - 0.1 ? A : R; };
const share = (ok, of) => { if (!of) return GREY; const r = ok / of; return r >= 0.8 ? G : r >= 0.6 ? A : R; };

// ── Building blocks ──
const Pill = ({ c, children }) => <span style={{ display: 'inline-block', padding: '3px 10px', borderRadius: 999, fontSize: 13, fontWeight: 500, color: c[0], background: c[1], whiteSpace: 'nowrap' }}>{children}</span>;
const Card = ({ children, style }) => <div style={{ background: '#fff', border: '1px solid ' + LINE, borderRadius: 4, ...style }}>{children}</div>;
const Stat = ({ label, value, sub }) => (
  <div style={{ borderTop: '2px solid ' + INK, paddingTop: 10 }}>
    <p style={{ margin: 0, fontSize: 13, color: MUT }}>{label}</p>
    <p style={{ margin: '4px 0 0', fontSize: 26, fontWeight: 600 }}>{value}</p>
    {sub ? <p style={{ margin: 0, fontSize: 13, color: MUT }}>{sub}</p> : null}
  </div>);
function Table({ cols, rows, head }) {
  const grid = cols.map((c) => c.w || 'minmax(0, 1fr)').join(' ');
  return (
    <Card style={{ paddingTop: 14 }}>
      <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 16, padding: '0 16px 10px', fontSize: 13, color: MUT, fontWeight: 500, borderBottom: '1px solid ' + LINE }}>
        {(head || cols.map((c) => c.label)).map((h, i) => <span key={i} style={{ textAlign: cols[i].num ? 'right' : cols[i].center ? 'center' : 'left' }}>{h}</span>)}
      </div>
      {rows.map((r, j) => (
        <div key={j} style={{ display: 'grid', gridTemplateColumns: grid, gap: 16, padding: '12px 16px', fontSize: 16, alignItems: 'center', borderBottom: j === rows.length - 1 ? 'none' : '1px solid ' + LINE }}>
          {cols.map((c, i) => <span key={i} style={{ textAlign: c.num ? 'right' : c.center ? 'center' : 'left', fontVariantNumeric: c.num ? 'tabular-nums' : undefined, minWidth: 0 }}>{c.render(r)}</span>)}
        </div>))}
    </Card>);
}
const Bar = ({ value, pace, c }) => (
  <div style={{ position: 'relative', height: 10, background: '#eeeae2', borderRadius: 5 }}>
    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: Math.min(100, value * 100) + '%', background: c[0], borderRadius: 5 }} />
    <div style={{ position: 'absolute', top: -5, width: 2, height: 20, background: INK, left: Math.min(100, pace * 100) + '%' }} />
  </div>);

function Slide({ i, n, date, title, sub, children }) {
  return (
    <div className="sl-slide" style={{ width: 1280, height: 720, boxSizing: 'border-box', background: '#fbfaf7', color: INK, fontFamily: sans, padding: '40px 64px 32px', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 24px rgba(0,0,0,.25)', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid ' + LINE, paddingBottom: 16 }}>
        <img src="/apex-logo.svg" alt="Apex Homes DXB" style={{ height: 34, width: 'auto', display: 'block' }} />
        <span style={{ fontFamily: jost, fontSize: 13, letterSpacing: '0.2em', textTransform: 'uppercase', color: GOLD }}>Management meeting · {shortDate(date)} {noon(date).getFullYear()}</span>
      </div>
      {title ? <div style={{ marginTop: 26 }}>
        <h1 style={{ margin: 0, fontFamily: jost, fontWeight: 400, fontSize: 34 }}>{title}</h1>
        {sub ? <p style={{ margin: '6px 0 0', fontSize: 16, color: MUT }}>{sub}</p> : null}
      </div> : null}
      <div style={{ flex: 1, minHeight: 0, marginTop: 24, display: 'flex', flexDirection: 'column' }}>{children}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#8a8a8a', borderTop: '1px solid ' + LINE, paddingTop: 12 }}>
        <span>Apex Homes Real Estate L.L.C. · Internal</span><span>{String(i).padStart(2, '0')} / {String(n).padStart(2, '0')}</span>
      </div>
    </div>);
}

// ── The deck ──
function deck(d) {
  const out = [];
  const add = (key, title, sub, body) => out.push({ key, title, sub, body });
  const mTotal = d.monthScore.find((m) => m.scope === 'company');
  const qTotal = d.quarterScore.find((m) => m.scope === 'company');
  const groups = d.groups.filter((g) => g.brokers.length);
  const month = monthName(d.month);
  const stillDue = (r) => (r.needed > 0 ? money(r.needed) : 'Hit');

  add('cover', '', '', (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <p style={{ margin: 0, fontFamily: jost, fontSize: 15, letterSpacing: '0.3em', textTransform: 'uppercase', color: GOLD }}>Week {weekNo(d.today)} · {quarterName(d.today)}</p>
      <h1 style={{ margin: '14px 0 0', fontFamily: jost, fontWeight: 300, fontSize: 64, letterSpacing: '0.06em', textTransform: 'uppercase', lineHeight: 1.05 }}>Management meeting</h1>
      <p style={{ margin: '14px 0 0', fontSize: 20, color: MUT }}>{longDate(d.today)}{d.team ? ' · ' + d.team : ''}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 20, marginTop: 56, maxWidth: 980 }}>
        {mTotal && <Stat label={month + ' billed'} value={money(mTotal.billed)} sub={`of ${money(mTotal.target)} · ${mTotal.needed > 0 ? money(mTotal.needed) + ' still needed in ' + d.workingDaysLeft + ' working days' : 'target hit'}`} />}
        {qTotal && <Stat label={quarterName(d.today) + ' billed so far'} value={money(qTotal.billed)} sub={`of ${money(qTotal.target)} · ${qTotal.needed > 0 ? money(qTotal.needed) + ' still needed' : 'target hit'}`} />}
        <Stat label="Brokers flagged this week" value={`${d.flagged} of ${d.brokerCount}`} sub={`in ${groups.length} group session${groups.length === 1 ? '' : 's'}`} />
      </div>
    </div>));

  if (d.lastWeek.length) add('last', "Last week's actions", `${d.lastWeek.filter((a) => a.done).length} of ${d.lastWeek.length} done.`, (
    <Table cols={[{ label: 'Action', w: 'minmax(0, 3fr)', render: (a) => a.body }, { label: 'Owner', render: (a) => a.owner || '' },
      { label: 'Due', w: 'minmax(0, 0.6fr)', render: (a) => (a.due ? shortDate(a.due) : '') }, { label: 'Status', render: (a) => <Pill c={a.done ? G : A}>{a.done ? 'Done' : 'Not done'}</Pill> }]}
      rows={d.lastWeek.slice(0, 9)} />));

  const scoreCols = (pace, lastLabel, lastFn) => [
    { label: 'Team', w: 'minmax(0, 1.3fr)', render: (r) => <b style={{ fontWeight: 600 }}>{r.label}</b> },
    { label: 'Target', num: true, w: 'minmax(0, 0.7fr)', render: (r) => <span style={{ color: MUT }}>{money(r.target)}</span> },
    { label: 'Billed', num: true, w: 'minmax(0, 0.7fr)', render: (r) => <b style={{ fontWeight: 600 }}>{money(r.billed)}</b> },
    { label: `Progress · line = where we should be today (${Math.round(pace * 100)}%)`, w: 'minmax(0, 1.9fr)', render: (r) => <Bar value={r.target ? r.billed / r.target : 0} pace={pace} c={status(r.billed, r.target, pace)} /> },
    { label: 'Still needed', num: true, w: 'minmax(0, 0.8fr)', render: (r) => <b style={{ fontWeight: 600, color: status(r.billed, r.target, pace)[0] }}>{stillDue(r)}</b> },
    { label: lastLabel, num: true, w: 'minmax(0, 0.8fr)', render: lastFn },
  ];
  add('month', `${month} scorecard`, `Billed this month against target, and what each team still needs to bring in before ${shortDate(d.monthEnd)}.`, (<>
    <Table cols={scoreCols(d.pace.month, 'Per working day', (r) => (r.needed > 0 && r.perDay ? money(r.perDay) : '–'))} rows={d.monthScore} />
    <div style={{ display: 'flex', gap: 40, marginTop: 20, fontSize: 15, color: MUT }}>
      <span><b style={{ color: INK }}>{d.workingDaysLeft} working days</b> left in {month}, today included</span>
      {d.monthDeals && <span><b style={{ color: INK }}>{n0((d.monthDeals.sales || 0) + (d.monthDeals.rentals || 0))} deals</b> so far · {n0(d.monthDeals.sales)} sales, {n0(d.monthDeals.rentals)} rentals</span>}
    </div></>));

  add('quarter', quarterName(d.today) + ' scorecard', `The quarter so far, and what each team still needs by ${shortDate(d.quarterEnd)}. Green on pace, amber within 10%, red behind.`, (<>
    <Table cols={scoreCols(d.pace.quarter, 'Per month left', (r) => (r.needed > 0 && r.perMonth ? money(r.perMonth) : '–'))} rows={d.quarterScore} />
    <div style={{ display: 'flex', gap: 40, marginTop: 20, fontSize: 15, color: MUT }}>
      <span><b style={{ color: INK }}>{d.monthsLeft} month{d.monthsLeft === 1 ? '' : 's'}</b> left in the quarter, this one included</span>
    </div></>));

  const kCell = (v) => (v[1] ? <Pill c={share(v[0], v[1])}>{v[0]} of {v[1]}</Pill> : <span style={{ color: '#9a9a9a' }}>not judged</span>);
  const R0 = d.rules;
  add('kpis', 'KPIs this week', 'Brokers meeting each KPI over the last 7 full days.', (<>
    <Table cols={[{ label: 'Team', w: 'minmax(0, 1.4fr)', render: (r) => <b style={{ fontWeight: 600 }}>{r.team}<span style={{ display: 'block', fontWeight: 400, fontSize: 13, color: MUT }}>{r.brokers} brokers</span></b> },
      { label: `Calls · ${R0.calls_a_day} a day`, center: true, render: (r) => kCell(r.calls) },
      { label: `New listings · ${R0.listed_week.apartment} apt / ${R0.listed_week.villa} villa a week`, center: true, render: (r) => kCell(r.listed) },
      { label: `Stock · ${R0.stock.apartment} apt / ${R0.stock.villa} villa`, center: true, render: (r) => kCell(r.stock) },
      { label: `Viewings · ${R0.viewings_week} a week`, center: true, render: (r) => kCell(r.viewings) }]} rows={d.kpis} />
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 20, marginTop: 22 }}>
      <Stat label="Owner calls" value={n0(d.totals.calls)} sub={`target ${n0(d.totals.callsTarget)} · ${pct(d.totals.calls, d.totals.callsTarget)}%`} />
      <Stat label="New listings" value={n0(d.totals.listed)} sub={`target ${n0(d.totals.listedTarget)} · ${pct(d.totals.listed, d.totals.listedTarget)}%`} />
      <Stat label="Viewings" value={n0(d.totals.viewings)} sub={`target ${n0(d.totals.viewingsTarget)} · ${pct(d.totals.viewings, d.totals.viewingsTarget)}%`} />
      <Stat label="Price drops" value={n0(d.totals.drops)} sub={d.priceFrom && d.priceFrom > shortIso(d.today, -7) ? 'prices recorded from ' + shortDate(d.priceFrom) : 'last 7 days'} />
    </div></>));

  const RULES = {
    calls: `Under the stock KPI and under ${R0.calls_a_day} calls a day`, pitch: `${R0.calls_a_day}+ calls a day, new listings under KPI`,
    listings: `Half their listings overpriced or under ${R0.low_leads} leads in ${R0.low_leads_days} days`, leads: `${R0.leads_week_high}+ leads this week, under ${R0.viewings_week} viewings`,
    closing: `${R0.viewings_30_high}+ viewings in 30 days, no deal in 30 days`, nodeal: `Past ${R0.settled_days} days, no deal in ${R0.no_deal_days}, no other flag`,
  };
  add('flags', "What's working and what isn't", `${d.flagged} broker${d.flagged === 1 ? '' : 's'} flagged. Each goes into one group session this week.`, (
    <Table head={['Flag · each broker gets the first one in their funnel', ...d.flagTeams, 'Group session']}
      cols={[{ w: 'minmax(0, 2.6fr)', render: (g) => <span><b style={{ fontWeight: 600 }}>{g.i}. {g.name}</b><span style={{ display: 'block', fontSize: 13, color: MUT }}>{RULES[g.key]}</span></span> },
        ...d.flagTeams.map((_, t) => ({ w: 'minmax(0, 0.7fr)', center: true, render: (g) => { const v = d.flagByTeam[g.i - 1][t]; return <span style={{ fontSize: 18, fontWeight: v ? 600 : 400, color: v ? R[0] : '#b5b5b5' }}>{v || '–'}</span>; } })),
        { w: 'minmax(0, 1.7fr)', render: (g) => <b style={{ fontWeight: 600 }}>{g.session}</b> }]}
      rows={d.groups.map((g, i) => ({ ...g, i: i + 1 }))} />));

  const groupCols = {
    calls: [['Stock', (b) => `${b.stock} / ${b.stockTarget}`], ['Calls', (b) => `${b.callsPerDay} a day`], ['New listings', (b) => `${b.listed} / ${b.listedTarget}`]],
    pitch: [['Calls', (b) => `${b.callsPerDay} a day`], ['New listings', (b) => `${b.listed} / ${b.listedTarget}`], ['Stock', (b) => `${b.stock} / ${b.stockTarget}`]],
    listings: [['Live', (b) => b.live], ['Underperforming', (b) => b.bad], ['Overpriced', (b) => b.over], [`Under ${R0.low_leads} leads`, (b) => b.low]],
    leads: [['Leads', (b) => b.leads], ['Viewings', (b) => b.viewings], ['Calls', (b) => `${b.callsPerDay} a day`]],
    closing: [['Viewings, 30 days', (b) => b.viewings30], ['Viewings, 7 days', (b) => b.viewings]],
    nodeal: [['Viewings, 30 days', (b) => b.viewings30], ['Stock', (b) => (b.stockTarget ? `${b.stock} / ${b.stockTarget}` : b.stock)]],
  };
  const SUBS = {
    calls: 'The fix is call time: a supervised power hour, everyone on the Desk at once.',
    pitch: 'Calling enough but not turning calls into listings: the script, objections and listening back to calls.',
    listings: 'Listings not pulling leads or priced above the market. Each listing gets checked on title, photos, price and portal spend: it isn\'t always the price.',
    leads: 'Getting the leads but not booking the viewings: response time, qualifying, booking on the first call.',
    closing: 'Plenty of viewings, no deals: negotiation and offers, paired with a senior for their next viewings.',
    nodeal: 'No deal in 60 days and nothing else explains it. A 1:1 with Billie, not a group session.',
  };
  const PER = 8;   // brokers per group slide; a bigger group carries on onto another slide
  groups.forEach((g) => {
    const n = d.groups.indexOf(g) + 1;
    const extra = groupCols[g.key];
    for (let p = 0; p < g.brokers.length; p += PER) {
      const part = g.brokers.slice(p, p + PER), more = p > 0;
      add('g-' + g.key + p, `Group ${n}: ${g.session}${more ? ' (continued)' : ''}`,
        more ? `${g.name}. ${g.brokers.length} brokers.` : `${g.name}. ${g.brokers.length} broker${g.brokers.length === 1 ? '' : 's'}. ${SUBS[g.key]}`, (
        <Table cols={[{ label: 'Broker', w: 'minmax(0, 1.1fr)', render: (b) => <b style={{ fontWeight: 600 }}>{b.name}</b> },
          { label: 'Team', w: 'minmax(0, 1.4fr)', render: (b) => <span style={{ color: MUT, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[b.team, b.type ? b.type[0].toUpperCase() + b.type.slice(1) : ''].filter(Boolean).join(' · ')}</span> },
          ...extra.map(([label, f]) => ({ label, num: true, w: 'minmax(0, 0.7fr)', render: f })),
          ...(g.key === 'listings' ? [{ label: 'Worst listing', w: 'minmax(0, 2.2fr)', render: (b) => <span style={{ fontSize: 14, display: 'block', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.worst}</span> }] : [])]}
          rows={part} />));
    }
  });

  const sumH = d.health.reduce((a, h) => ({ live: a.live + h.live, low: a.low + h.low }), { live: 0, low: 0 });
  add('listings', 'Listings health', 'Live listings against recent sales and new Ejari leases, leads in the last 14 days, and price drops in the last 7.', (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 28 }}>
      <div>
        <Table cols={[{ label: 'Team', w: 'minmax(0, 1.4fr)', render: (h) => <b style={{ fontWeight: 600 }}>{h.team}</b> },
          { label: 'Live', num: true, w: 'minmax(0, 0.5fr)', render: (h) => n0(h.live) },
          { label: 'Overpriced', num: true, w: 'minmax(0, 0.8fr)', render: (h) => n0(h.over) },
          { label: 'Of checked', num: true, w: 'minmax(0, 0.7fr)', render: (h) => (h.checked ? pct(h.over, h.checked) + '%' : '–') },
          { label: `Under ${R0.low_leads} leads`, num: true, w: 'minmax(0, 0.8fr)', render: (h) => n0(h.low) },
          { label: 'Price drops', num: true, w: 'minmax(0, 0.7fr)', render: (h) => n0(h.drops) }]} rows={d.health} />
        <div style={{ display: 'flex', gap: 36, marginTop: 18, fontSize: 15, color: MUT }}>
          <span><b style={{ color: INK }}>{n0(sumH.low)}</b> of {n0(sumH.live)} live listings had under {R0.low_leads} leads in {R0.low_leads_days} days</span>
          {d.priceFrom && <span>Prices recorded from {shortDate(d.priceFrom)}</span>}
        </div>
      </div>
      <Card style={{ padding: '16px 20px' }}>
        <p style={{ margin: '0 0 4px', fontSize: 13, color: MUT }}>Most overpriced</p>
        {d.worst.map((w, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: i === d.worst.length - 1 ? 'none' : '1px solid ' + LINE, fontSize: 15 }}>
            <span><b style={{ fontWeight: 600 }}>{w.building}{w.beds != null ? `, ${w.beds === 0 ? 'studio' : w.beds + ' bed'}` : ''}</b>
              <span style={{ display: 'block', fontSize: 13, color: MUT }}>{w.purpose === 'rent' ? 'Rent' : 'Sale'} · {money(w.listed)} vs {money(w.target)} · {w.broker}</span></span>
            <span style={{ color: R[0], fontWeight: 600 }}>+{Math.round(w.gap)}%</span>
          </div>))}
        {d.worst.length === 0 && <p style={{ color: MUT, fontSize: 15 }}>None flagged.</p>}
      </Card>
    </div>));

  add('actions', 'Issues and actions', "Issues raised before the meeting, and the actions agreed. Every action has an owner and a date, and opens next week's meeting.", (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.6fr)', gap: 28 }}>
      <Card style={{ padding: '16px 20px' }}>
        <p style={{ margin: '0 0 4px', fontSize: 13, color: MUT }}>Issues</p>
        {d.issues.length ? d.issues.slice(0, 7).map((a, i) => (
          <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid ' + LINE, fontSize: 15 }}><b style={{ fontWeight: 600 }}>{a.body}</b>
            {a.owner ? <span style={{ display: 'block', fontSize: 13, color: MUT }}>Raised by {a.owner}</span> : null}</div>))
          : <p style={{ color: MUT, fontSize: 15 }}>No issues raised.</p>}
      </Card>
      <div>
        <p style={{ margin: '0 0 10px', fontSize: 13, color: MUT }}>Actions · read back before we finish</p>
        {d.actions.length ? <Table cols={[{ label: 'Action', w: 'minmax(0, 3fr)', render: (a) => a.body }, { label: 'Owner', render: (a) => a.owner || '' },
          { label: 'Due', w: 'minmax(0, 0.6fr)', render: (a) => (a.due ? shortDate(a.due) : '') }]} rows={d.actions.slice(0, 8)} />
          : <Card style={{ padding: 16, color: MUT, fontSize: 15 }}>Actions added on the Meeting page this week show here.</Card>}
      </div>
    </div>));
  return out;
}
const shortIso = (s, n) => { const t = noon(s); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); };

export default function Slides({ api, team, onClose }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api('/api/ops?action=slides' + (team ? '&team=' + encodeURIComponent(team) : '')).then(setD).catch((e) => setErr(e.message));
    if (!document.getElementById('orpt-fonts')) {
      const l = document.createElement('link'); l.id = 'orpt-fonts'; l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500&family=Inter:wght@400;500;600;700&display=swap';
      document.head.appendChild(l);
    }
  }, [api, team]);
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const slides = d ? deck(d) : [];
  const download = () => {
    const was = document.title;
    document.title = `Management meeting ${d.today}${d.team ? ' - ' + d.team : ''}`;
    window.print();
    setTimeout(() => { document.title = was; }, 500);
  };
  return createPortal(
    <div className="sl-print"><style>{CSS + PRINT_CSS}</style>
      <div className="sl-scrim">
        <div className="sl-bar">
          <span className="muted sl-hint">{d ? `${slides.length} slides · in the print window choose "Save as PDF"` : err ? '' : 'Working out this week\'s figures…'}</span>
          <span className="grow" />
          <button type="button" className="ops-btn primary" disabled={!d} onClick={download}>Download PDF</button>
          <button type="button" className="ops-btn" onClick={onClose}>Close</button>
        </div>
        {err ? <p className="err" style={{ maxWidth: 1280, margin: '0 auto', background: 'var(--bg)', padding: 12, borderRadius: 8 }}>{err}</p> : null}
        <div className="sl-zoom"><div className="sl-list">
          {slides.map((s, i) => <Slide key={s.key} i={i + 1} n={slides.length} date={d.today} title={s.title} sub={s.sub}>{s.body}</Slide>)}
        </div></div>
      </div>
    </div>, document.body);
}
