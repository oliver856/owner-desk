import { sql } from './db';

export async function audit(
  userId: string | null,
  action: string,
  opts: { unitId?: number | null; detail?: Record<string, unknown>; ip?: string } = {},
) {
  await sql`
    insert into desk.audit_log (user_id, action, unit_id, detail, ip)
    values (${userId}, ${action}, ${opts.unitId ?? null}, ${sql.json((opts.detail ?? {}) as never)},
            ${opts.ip ? opts.ip : null})`;
}

export async function setting<T>(key: string, fallback: T): Promise<T> {
  const r = await sql<{ value: T }[]>`select value from desk.settings where key = ${key}`;
  return r[0]?.value ?? fallback;
}

// How many times this person did something today (Dubai day)
export async function todayCount(userId: string, action: string): Promise<number> {
  const r = await sql<{ n: number }[]>`
    select count(*)::int as n from desk.audit_log
    where user_id = ${userId} and action = ${action}
      and at >= date_trunc('day', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai'`;
  return r[0]?.n ?? 0;
}

export async function caps(userId: string) {
  const [profileCap, callCap, profiles, calls] = await Promise.all([
    setting<number>('daily_profile_cap', 80),
    setting<number>('daily_call_cap', 60),
    todayCount(userId, 'opened_unit'),
    todayCount(userId, 'call_sent'),
  ]);
  return { profileCap: Number(profileCap), callCap: Number(callCap), profiles, calls };
}

export function dubaiNow() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === 'hour')?.value);
  const m = Number(parts.find((p) => p.type === 'minute')?.value);
  return { h, m, minutes: h * 60 + m };
}

export async function withinCallHours(): Promise<boolean> {
  const hrs = await setting<{ from: string; to: string }>('call_hours', { from: '09:00', to: '18:00' });
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  const now = dubaiNow().minutes;
  return now >= toMin(hrs.from) && now < toMin(hrs.to);
}
