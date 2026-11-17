// The weekly management meeting: pipeline posts pasted in from the group, the actions agreed, and the saved weekly reports.
// Tables: desk.pipeline_posts, desk.meeting_actions (migrations/017_scorecard.sql), desk.ask_log for the reports.
import { sql } from './core.js';

const dubaiToday = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
// The Monday of the week a day falls in
export function mondayOf(day) {
  const t = new Date((day || dubaiToday()) + 'T12:00:00Z');
  return new Date(t - ((t.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
}
const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

export async function meetingPage(staff, sc, week) {
  const wk = mondayOf(isDay(week) ? week : null);
  const posts = await sql`
    select p.id, p.week::text, p.team, p.body, p.at, coalesce(s.full_name, s.email) as by, p.user_id = ${staff.user_id} as mine
    from desk.pipeline_posts p join desk.staff s on s.user_id = p.user_id
    where p.week = ${wk}::date and p.removed_at is null and (${sc.team}::text is null or p.team = ${sc.team})
    order by p.team nulls last, p.at`;
  const actions = await sql`
    select a.id, a.week::text, a.body, a.owner, a.due::text, a.done_at, a.at, coalesce(s.full_name, s.email) as by
    from desk.meeting_actions a join desk.staff s on s.user_id = a.user_id
    where a.removed_at is null and (a.done_at is null or a.done_at > now() - interval '21 days')
    order by a.done_at nulls first, a.week desc, a.id`;
  const reports = await sql`
    select id, at, question as title from desk.ask_log
    where status = 'ok' and question like 'Weekly report%' and (${sc.team}::text is null or team = ${sc.team})
    order by at desc limit 20`;
  return { week: wk, thisWeek: mondayOf(), posts, actions, reports, team: sc.team, all: sc.all };
}

export async function reportText(sc, id) {
  const [r] = await sql`select id, at, question as title, answer from desk.ask_log
                        where id = ${Number(id) || 0} and status = 'ok' and question like 'Weekly report%' and (${sc.team}::text is null or team = ${sc.team})`;
  return r || null;
}

// Returns [httpStatus, json]
export async function meetingWrite(staff, sc, b) {
  const text = (v, n) => String(v || '').trim().slice(0, n);
  if (b.action === 'pipeline-add') {
    const body = text(b.body, 6000);
    if (!body) return [400, { error: 'Paste the pipeline message first.' }];
    const team = sc.all ? (text(b.team, 60) || null) : sc.team;
    const [r] = await sql`insert into desk.pipeline_posts (week, team, body, user_id) values (${mondayOf(isDay(b.week) ? b.week : null)}::date, ${team}, ${body}, ${staff.user_id}) returning id`;
    return [200, { ok: true, id: r.id }];
  }
  if (b.action === 'pipeline-remove') {
    const n = await sql`update desk.pipeline_posts set removed_at = now()
                        where id = ${Number(b.id) || 0} and removed_at is null and (user_id = ${staff.user_id} or ${sc.all})`;
    return n.count ? [200, { ok: true }] : [404, { error: 'That post is no longer there.' }];
  }
  if (b.action === 'action-add') {
    const body = text(b.body, 500);
    if (!body) return [400, { error: 'Write the action first.' }];
    const due = isDay(b.due) ? b.due : null;
    const [r] = await sql`insert into desk.meeting_actions (week, body, owner, due, user_id)
                          values (${mondayOf()}::date, ${body}, ${text(b.owner, 80) || null}, ${due}::date, ${staff.user_id}) returning id`;
    return [200, { ok: true, id: r.id }];
  }
  if (b.action === 'action-done') {
    const n = await sql`update desk.meeting_actions set done_at = ${b.done ? sql`now()` : null} where id = ${Number(b.id) || 0} and removed_at is null`;
    return n.count ? [200, { ok: true }] : [404, { error: 'That action is no longer there.' }];
  }
  if (b.action === 'action-remove') {
    const n = await sql`update desk.meeting_actions set removed_at = now() where id = ${Number(b.id) || 0} and removed_at is null`;
    return n.count ? [200, { ok: true }] : [404, { error: 'That action is no longer there.' }];
  }
  return null;   // not a meeting action
}

// What the weekly report needs from the meeting side: this week's pipeline posts and last week's actions
export async function meetingForReport(sc, week) {
  const posts = await sql`select p.team, p.body, coalesce(s.full_name, s.email) as by, p.at
                          from desk.pipeline_posts p join desk.staff s on s.user_id = p.user_id
                          where p.removed_at is null and p.week between (${week}::date - 7) and (${week}::date + 7)
                            and (${sc.team}::text is null or p.team = ${sc.team}) order by p.at`;
  const actions = await sql`select body, owner, due::text, week::text as agreed, done_at is not null as done
                            from desk.meeting_actions where removed_at is null and week < ${mondayOf()}::date
                              and (done_at is null or done_at > (${week}::date - 7)) order by week desc, id limit 30`;
  return { posts, actions };
}
