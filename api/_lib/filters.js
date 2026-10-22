// Turns the filter choices from the screen into safe database conditions.
// User input is always passed as a parameter, never pasted into SQL text.
import { sql } from './core.js';

const today = () => sql`(now() at time zone 'Asia/Dubai')::date`;

export const TABS = ['all', 'exp90', 'up', 'port', 'mort', 'never'];

export function tabSql(tab) {
  switch (tab) {
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
    default: return sql`sort_pos`;
  }
}

export function whereSql(q, areas) {
  const one = (k) => (q.get(k) || '').trim();
  const many = (k) => q.getAll(k).filter(Boolean);
  const num = (k) => { const v = one(k).replace(/,/g, ''); return v === '' || isNaN(Number(v)) ? null : Number(v); };
  const w = [sql`area_id = any(${areas})`];

  one('q').toLowerCase().replace(/[%_\\]/g, '').split(/\s+/).filter(Boolean).slice(0, 5)
    .forEach((word) => w.push(sql`search_text like ${'%' + word + '%'}`));
  if (one('area')) w.push(sql`area_id = (select id from desk.areas where name = ${one('area')})`);
  if (one('sc')) w.push(sql`subcommunity = ${one('sc')}`);
  if (one('bld')) w.push(sql`building = ${one('bld')}`);
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
  if (one('called')) w.push(sql`last_called is not null`);
  if (many('oc').length) w.push(sql`last_outcome = any(${many('oc')})`);
  return w.reduce((a, b) => sql`${a} and ${b}`);
}
