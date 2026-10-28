// Turns the filter choices from the screen into safe database conditions.
// User input is always passed as a parameter, never pasted into SQL text.
import { sql } from './core.js';

const today = () => sql`(now() at time zone 'Asia/Dubai')::date`;

// Same lists as the green and red quick notes on screen (QUICK_NOTES in App.jsx)
const NOTE_HOT = 'unit available, send whatsapp|in discussion|replied|follow up|send report|wants to sell|wants to rent|wants to buy|wants valuation|listing opportunity|call back';
const NOTE_COLD = 'called, no reply|called, unreachable|phone off|end user|sold|agent|cold|no answer|not interested|wrong number|do not call';

export const TABS = ['all', 'exp90', 'up', 'port', 'mort', 'never', 'callbacks', 'reports'];

// Callbacks: units whose latest call this week (Monday 00:00 Dubai onwards) got no answer.
// Brokers see their own; managers and admins see everyone's.
function callbacksSql(me, all) {
  return sql`id in (
    select x.unit_id from (
      select distinct on (c.unit_id) c.unit_id, c.user_id, c.outcome, c.note
      from desk.calls c
      where c.called_at >= date_trunc('week', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai'
      order by c.unit_id, c.called_at desc) x
    where (${all} or x.user_id = ${me})
      and (x.outcome = 'No answer'
        or (x.outcome is null and (coalesce(x.note, '') = '' or x.note ~* '^(called, no reply|called, unreachable|phone off|cold)'))))`;
}

// Reports to send today: units noted "Send report" today (Dubai time). Brokers see their own; managers and admins everyone's.
function reportsSql(me, all) {
  const start = sql`(date_trunc('day', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai')`;
  return sql`id in (
    select c.unit_id from desk.calls c where coalesce(c.outcome_at, c.called_at) >= ${start} and c.note ~* '^send report' and (${all} or c.user_id = ${me})
    union
    select n.unit_id from desk.notes n where n.created_at >= ${start} and n.body ~* '^send report' and (${all} or n.user_id = ${me}))`;
}

export function tabSql(tab, me, all = false) {
  switch (tab) {
    case 'reports': return me ? reportsSql(me, all) : sql`false`;
    case 'callbacks': return me ? callbacksSql(me, all) : sql`false`;
    case 'exp90': return sql`end_date between ${today()} and ${today()} + 90`;
    case 'up': return sql`annual_rent >= prev_rent * 1.1 and prev_rent > 0`;
    case 'port': return sql`owner_units >= 2`;
    case 'mort': return sql`mortgaged`;
    case 'never': return sql`last_called is null`;
    default: return sql`true`;
  }
}

export function sortSql(k) {
  switch (k) {
    case 'end': return sql`end_date asc nulls last, id`;
    case 'rent': return sql`annual_rent desc nulls last, id`;
    case 'sale': return sql`last_sale_price desc nulls last, id`;
    case 'size': return sql`size_sqft desc nulls last, id`;
    // Springs/Meadows/Lakes style "Street 1, Villa 3": street first, then villa number
    default: return sql`subcommunity, (substring(unit_no from '^Street ([0-9]+),'))::int nulls first, sort_pos`;
  }
}

export function whereSql(q, areas, me) {
  const one = (k) => (q.get(k) || '').trim();
  const many = (k) => q.getAll(k).filter(Boolean);
  const num = (k) => { const v = one(k).replace(/,/g, ''); return v === '' || isNaN(Number(v)) ? null : Number(v); };
  const w = [sql`area_id = any(${areas})`];

  one('q').toLowerCase().replace(/[%_\\]/g, '').split(/\s+/).filter(Boolean).slice(0, 5)
    .forEach((word) => w.push(sql`(search_text like ${'%' + word + '%'}
      or id in (select u.id from desk.units u where lower(u.old_code) like ${'%' + word + '%'}))`));
  if (many('area').length) w.push(sql`area_id in (select id from desk.areas where name = any(${many('area')}))`);
  if (many('sc').length) w.push(sql`subcommunity = any(${many('sc')})`);
  if (many('bld').length) w.push(sql`building = any(${many('bld')})`);
  if (many('st').length) w.push(sql`lease_status = any(${many('st')})`);
  if (many('type').length) w.push(sql`unit_type = any(${many('type')})`);
  if (many('beds').length) w.push(sql`beds = any(${many('beds')})`);
  const exp = num('exp');
  if (exp) w.push(sql`end_date between ${today()} and ${today()} + ${exp}::int`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(one('from'))) w.push(sql`end_date >= ${one('from')}::date`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(one('to'))) w.push(sql`end_date <= ${one('to')}::date`);
  const range = (a, b, col) => {
    const x = num(a), y = num(b);
    if (x != null) w.push(sql`${sql(col)} >= ${x}`);
    if (y != null) w.push(sql`${sql(col)} <= ${y}`);
  };
  // Unit number range and series use the number at the end of the unit (DL-J105 -> 105, 1302 -> 1302)
  const unitNo = sql`nullif(coalesce(substring(unit_no from '^([0-9]+)[A-Z]?, Street'), substring(unit_no from '([0-9]+)[^0-9]*$')), '')`;
  const ua = num('umin'), ub = num('umax');
  if (ua != null) w.push(sql`${unitNo}::bigint >= ${ua}`);
  if (ub != null) w.push(sql`${unitNo}::bigint <= ${ub}`);
  // Letter before the number: DL-J104 -> J, so Damac Lagoons J and K clusters can be picked apart
  const letter = one('uletter').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  if (letter) w.push(sql`substring(upper(unit_no) from '([A-Z]+)[0-9]+[^0-9]*$') = ${letter}`);
  const series = one('useries').replace(/\D/g, '').slice(0, 4);
  if (series) w.push(sql`${unitNo} like ${'%' + series}`);
  range('smin', 'smax', 'size_sqft');
  range('rmin', 'rmax', 'annual_rent');
  range('pmin', 'pmax', 'last_sale_price');
  if (one('first')) w.push(sql`renewals = 0`);
  if (one('ren2')) w.push(sql`renewals >= 2`);
  if (one('up')) w.push(sql`annual_rent > prev_rent`);
  if (one('down')) w.push(sql`annual_rent < prev_rent`);
  if (one('port')) w.push(sql`owner_units >= 2`);
  if (one('mort')) w.push(sql`mortgaged`);
  if (one('ind')) w.push(sql`not is_company`);
  if (one('phone')) w.push(sql`has_phone`);
  if (one('ncall')) w.push(sql`last_called is null`);
  // Hide owners another broker is holding (called recently, or calling right now)
  // Only owners other brokers have touched recently are checked, so this stays fast on big lists.
  if (one('free') && me) w.push(sql`(owner_id is null or owner_id not in (
      select x.owner_id from (
        select owner_id from desk.calls where user_id <> ${me} and called_at > now() - interval '180 days'
        union select owner_id from desk.call_requests where user_id <> ${me} and created_at > now() - interval '1 day') x
      where exists (select 1 from desk.owner_hold(x.owner_id, ${me}))))`);
  if (one('called')) w.push(sql`last_called is not null`);
  if (many('oc').length) w.push(sql`last_outcome = any(${many('oc')})`);
  // Notes column: green (positive) or red (negative), judged by the latest note on the unit, same as the colour shown
  const tone = one('tone');
  if (tone === 'hot' || tone === 'cold') {
    const isHot = sql`z.txt ~* ${'^(' + NOTE_HOT + ')'}`;
    const isCold = sql`z.txt ~* ${'^(' + NOTE_COLD + ')'}`;
    w.push(sql`id in (select z.unit_id from (
        select distinct on (a.unit_id) a.unit_id, a.txt from (
          select n.unit_id, n.body as txt, n.created_at as t from desk.notes n
          union all
          select c.unit_id, coalesce(nullif(c.note, ''), c.outcome), coalesce(c.outcome_at, c.called_at) from desk.calls c
          where coalesce(c.note, '') <> '' or c.outcome is not null) a
        order by a.unit_id, a.t desc) z
      where ${tone === 'hot' ? isHot : sql`not ${isHot} and ${isCold}`})`);
  }
  return w.reduce((a, b) => sql`${a} and ${b}`);
}
