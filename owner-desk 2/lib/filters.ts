import type postgres from 'postgres';
import { sql } from './db';

export type SP = Record<string, string | string[] | undefined>;

export const one = (sp: SP, k: string) => {
  const v = sp[k];
  return (Array.isArray(v) ? v[0] : v) ?? '';
};
export const many = (sp: SP, k: string) => {
  const v = sp[k];
  return (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);
};
const num = (sp: SP, k: string) => {
  const v = one(sp, k).replace(/,/g, '');
  return v === '' || isNaN(Number(v)) ? null : Number(v);
};

export const TABS = [
  { k: 'all', l: 'All units' },
  { k: 'exp90', l: 'Ending in 90 days' },
  { k: 'up', l: 'Rent up 10%+' },
  { k: 'port', l: 'Portfolio owners' },
  { k: 'mort', l: 'Mortgaged' },
  { k: 'never', l: 'Never called' },
] as const;

const today = () => sql`(now() at time zone 'Asia/Dubai')::date`;

export function tabFragment(tab: string): postgres.PendingQuery<postgres.Row[]> {
  switch (tab) {
    case 'exp90': return sql`end_date between ${today()} and ${today()} + 90`;
    case 'up': return sql`annual_rent >= prev_rent * 1.1 and prev_rent > 0`;
    case 'port': return sql`owner_units >= 2`;
    case 'mort': return sql`mortgaged`;
    case 'never': return sql`last_called is null`;
    default: return sql`true`;
  }
}

// Every filter becomes a parameterised condition — user input is never pasted into SQL text.
export function whereFor(sp: SP, areaIds: number[]) {
  const w: postgres.PendingQuery<postgres.Row[]>[] = [sql`area_id = any(${areaIds})`];
  const q = one(sp, 'q').trim();
  if (q) {
    // Every word must appear somewhere in the unit's text (unit, building, area, owner names). Uses a trigram index.
    q.toLowerCase().replace(/[%_\\]/g, '').split(/\s+/).filter(Boolean).slice(0, 5)
      .forEach((word) => w.push(sql`search_text like ${'%' + word + '%'}`));
  }
  const sc = one(sp, 'sc'); if (sc) w.push(sql`subcommunity = ${sc}`);
  const bld = one(sp, 'bld'); if (bld) w.push(sql`building = ${bld}`);
  const st = many(sp, 'st'); if (st.length) w.push(sql`lease_status = any(${st})`);
  const ty = many(sp, 'type'); if (ty.length) w.push(sql`unit_type = any(${ty})`);
  const beds = many(sp, 'beds'); if (beds.length) w.push(sql`beds = any(${beds})`);
  const exp = num(sp, 'exp'); if (exp) w.push(sql`end_date between ${today()} and ${today()} + ${exp}::int`);
  const from = one(sp, 'from'); if (/^\d{4}-\d{2}-\d{2}$/.test(from)) w.push(sql`end_date >= ${from}::date`);
  const to = one(sp, 'to'); if (/^\d{4}-\d{2}-\d{2}$/.test(to)) w.push(sql`end_date <= ${to}::date`);
  const rng = (k1: string, k2: string, col: postgres.PendingQuery<postgres.Row[]>) => {
    const a = num(sp, k1), b = num(sp, k2);
    if (a != null) w.push(sql`${col} >= ${a}`);
    if (b != null) w.push(sql`${col} <= ${b}`);
  };
  rng('smin', 'smax', sql`size_sqft`);
  rng('rmin', 'rmax', sql`annual_rent`);
  rng('pmin', 'pmax', sql`last_sale_price`);
  if (one(sp, 'first')) w.push(sql`renewals = 0`);
  if (one(sp, 'ren2')) w.push(sql`renewals >= 2`);
  if (one(sp, 'up')) w.push(sql`annual_rent > prev_rent`);
  if (one(sp, 'down')) w.push(sql`annual_rent < prev_rent`);
  if (one(sp, 'port')) w.push(sql`owner_units >= 2`);
  if (one(sp, 'mort')) w.push(sql`mortgaged`);
  if (one(sp, 'ind')) w.push(sql`not coalesce(is_company, false)`);
  if (one(sp, 'phone')) w.push(sql`has_phone`);
  return w.reduce((a, b) => sql`${a} and ${b}`);
}

export const SORT_KEYS = ['unit', 'end', 'rent', 'sale', 'size'] as const;
export function sortFragment(k: string) {
  switch (k) {
    case 'end': return sql`end_date asc nulls last, id`;
    case 'rent': return sql`annual_rent desc nulls last, id`;
    case 'sale': return sql`last_sale_price desc nulls last, id`;
    case 'size': return sql`size_sqft desc nulls last, id`;
    default: return sql`sort_pos`;
  }
}
