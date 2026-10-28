// Owner holds: stops two brokers calling the same owner one after the other.
// Whoever last called an owner "holds" them for a while; everyone else sees who and until when.
// Hold lengths live in desk.settings 'call_holds' so they can be changed without touching code.
import { sql, schemaOk } from './core.js';

export const HOLD_DEFAULTS = { in_progress_minutes: 15, no_answer_days: 2, spoke_days: 30, hot_days: 60 };

let ready = null;
export function ensureHolds() {
  ready ??= (async () => {
    if (await schemaOk()) return;
    await sql`create index if not exists calls_owner_time_idx on desk.calls (owner_id, called_at desc)`;
    await sql`create index if not exists calls_time_idx on desk.calls (called_at desc)`;
    await sql`create index if not exists call_requests_owner_time_idx on desk.call_requests (owner_id, created_at desc)`;
    await sql`insert into desk.settings (key, value) values ('call_holds', ${sql.json(HOLD_DEFAULTS)}) on conflict (key) do nothing`;
    await sql.unsafe(`
      create or replace function desk.owner_hold(p_owner bigint, p_me uuid)
      returns table (by_user uuid, until timestamptz, why text)
      language sql stable as $f$
        with cfg as (
          select coalesce((v->>'in_progress_minutes')::int, 15) as lockm, coalesce((v->>'no_answer_days')::int, 2) as na,
                 coalesce((v->>'spoke_days')::int, 30) as sp, coalesce((v->>'hot_days')::int, 60) as hot
          from (select coalesce((select value from desk.settings where key = 'call_holds'), '{}'::jsonb) as v) s)
        select by_user, until, why from (
          select cr.user_id as by_user, coalesce(cr.used_at, cr.created_at) + make_interval(mins => cfg.lockm) as until,
                 'Calling now' as why, 1 as pri
          from desk.call_requests cr, cfg
          where cr.owner_id = p_owner and cr.user_id <> p_me and cr.created_at > now() - interval '1 day'
            and ((cr.used_at is null and cr.expires_at > now()) or cr.used_at > now() - make_interval(mins => cfg.lockm))
          union all
          select c.user_id, c.called_at + make_interval(days => case
                   when c.outcome in ('Call back', 'Wants valuation', 'Listing opportunity', 'Wants to sell') then cfg.hot
                   when c.outcome is null and c.note ~* '^(unit available|in discussion|replied|follow up|wants to|send report)' then cfg.hot
                   when c.outcome is null and c.note ~* '^(end user|sold|agent)' then cfg.sp
                   when c.outcome is null or c.outcome = 'No answer' then cfg.na
                   else cfg.sp end),
                 coalesce(c.outcome, split_part(c.note, '.', 1), 'Called'), 2
          from desk.calls c, cfg
          where c.owner_id = p_owner and c.user_id <> p_me and c.called_at > now() - interval '180 days'
        ) x
        where until > now()
        order by pri, until desc
        limit 1
      $f$`);
    await sql`revoke all on function desk.owner_hold(bigint, uuid) from public, anon, authenticated`;
    await sql`comment on function desk.owner_hold(bigint, uuid) is 'hold v1'`;
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

// The hold on one owner for this broker, with the holder's name, or null
export async function holdFor(ownerId, userId) {
  await ensureHolds();
  const [h] = await sql`select h.until, h.why, st.full_name as by_name
    from desk.owner_hold(${ownerId}, ${userId}) h join desk.staff st on st.user_id = h.by_user`;
  return h || null;
}
