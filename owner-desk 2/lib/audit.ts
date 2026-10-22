import { cache } from 'react';
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

// Fire-and-forget version for page views, so logging never slows the page down
export function auditLater(...args: Parameters<typeof audit>) {
  audit(...args).catch(() => {});
}

export async function setting<T>(key: string, fallback: T): Promise<T> {
  const r = await sql<{ value: T }[]>`select value from desk.settings where key = ${key}`;
  return r[0]?.value ?? fallback;
}

// Today's limits and usage in one query
export const caps = cache(async (userId: string) => {
  const [r] = await sql<{ profile_cap: number; call_cap: number; profiles: number; calls: number }[]>`
    with day as (select date_trunc('day', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai' as start)
    select
      coalesce((select (value #>> '{}')::int from desk.settings where key = 'daily_profile_cap'), 80) as profile_cap,
      coalesce((select (value #>> '{}')::int from desk.settings where key = 'daily_call_cap'), 60) as call_cap,
      (select count(*) from desk.audit_log, day where user_id = ${userId} and action = 'opened_unit' and at >= day.start)::int as profiles,
      (select count(*) from desk.audit_log, day where user_id = ${userId} and action = 'call_sent' and at >= day.start)::int as calls`;
  return { profileCap: r.profile_cap, callCap: r.call_cap, profiles: r.profiles, calls: r.calls };
});

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
