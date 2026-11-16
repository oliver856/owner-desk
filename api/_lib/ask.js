// Ask: management types a question, Claude answers it from the Desk's own figures.
//
// How it stays safe and cheap:
//   - Claude never touches the database. It can only call the read-only "tools" below, which run fixed queries the
//     server already uses for the Management pages, and which only return counts and totals (no owner names or numbers).
//   - The same team rules as the Management pages: a manager only ever gets their own team's figures.
//   - Limits are checked before every question (desk.settings 'ask', defaults in LIMITS): on/off switch, questions
//     per person per day, questions per day for the whole company, a dollar ceiling for the month, a cooldown between
//     questions, and one question at a time per person. Every question is logged with its cost in desk.ask_log.
//   - Each question can make at most MAX_ROUNDS rounds of tool calls and a fixed number of words in its answer.
// The API key is ANTHROPIC_API_KEY in Vercel. It never reaches the browser.
import { sql, setting } from './core.js';
import * as pages from './ops-pages.js';
import { dealsPage } from './ops-deals.js';
import { REASONS } from './reasons.js';

const LIMITS = { enabled: true, perPersonDay: 20, companyDay: 200, monthlyUsd: 60, cooldownSec: 8, model: 'claude-sonnet-5-5' };
// US dollars per million tokens (Sonnet 5.5): input, output, cache write, cache read
const PRICE = { in: 2, out: 10, cacheWrite: 2.5, cacheRead: 0.1 };
const MAX_ROUNDS = 5;
const MAX_TOKENS = 1500;
const MAX_TOOL_CHARS = 14000;

export const limitsNow = async () => ({ ...LIMITS, ...((await setting('ask', {})) || {}) });

const dubaiToday = () => new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
const isMonth = (m) => /^\d{4}-\d{2}$/.test(m || '');
const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');

// ── The tools Claude may call ─────────────────────────────────────────────────────
const TOOLS = [
  { name: 'overview', description: 'This week so far versus the same days last week: new listings, listings gained and lost, portal leads, viewings, deals and Desk calls; listings live now; this month\'s billing and deals by team; team targets and progress.', input_schema: { type: 'object', properties: {} } },
  { name: 'people', description: 'One row per active broker and manager: team, role, new listings, live stock, portal leads, viewings, deals and Desk calls for the period, plus billed this month.', input_schema: { type: 'object', properties: { period: { type: 'string', enum: ['week', 'month'], description: 'This week so far, or this month so far' } }, required: ['period'] } },
  { name: 'listings', description: 'Live listings now, new, gained and lost listings, by broker and community.', input_schema: { type: 'object', properties: {} } },
  { name: 'leads', description: 'Portal leads by broker, source and listing, recent weeks.', input_schema: { type: 'object', properties: {} } },
  { name: 'calls', description: 'Owner Desk calls between two days (at most 366 days; first_call says when Desk calls start), grouped one way. Each group has: calls; owners (distinct owners called); reached (owner answered); no_answer; listing_opps (owner wants to list for rent or sale: "Listing opportunity", "Wants to sell", "Wants to rent", "Unit available"); valuations (owner wants a valuation); call_backs (owner asked to be called back or is in discussion); hot (all hot results together, including the three before). group_by "result" lists every result with the same labels as the Hot & cold report, and which group it is in (hot, objection = spoke but no, nocontact = didn\'t get through).', input_schema: { type: 'object', properties: { from: { type: 'string', description: 'First day, YYYY-MM-DD (Dubai time)' }, to: { type: 'string', description: 'Last day, YYYY-MM-DD' }, group_by: { type: 'string', enum: ['broker', 'team', 'day', 'area', 'result'] } }, required: ['from', 'to', 'group_by'] } },
  { name: 'listings_off', description: 'Listings that came off the portals between two days (at most 186 days), with the reason recorded when they came off. group_by reason (counts per reason), broker (counts per broker, with their top reasons) or week. Records only start on the day in "since".', input_schema: { type: 'object', properties: { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' }, group_by: { type: 'string', enum: ['reason', 'broker', 'week'] } }, required: ['from', 'to', 'group_by'] } },
  { name: 'billing', description: 'Every active broker and manager (one row each, including those who billed nothing) with: billed and deals between two months inclusive (at most 24 months), months in that range with any billing, their last deal date ever and first deal date ever (null = no deal on record). Use it for "who hasn\'t billed" questions. Sorted lowest billed first.', input_schema: { type: 'object', properties: { from_month: { type: 'string', description: 'YYYY-MM' }, to_month: { type: 'string', description: 'YYYY-MM' } }, required: ['from_month', 'to_month'] } },
  { name: 'followups', description: 'Owner call-backs each broker has booked: overdue, due today, due in the next 7 days.', input_schema: { type: 'object', properties: {} } },
  { name: 'money', description: 'Billing (commission due to the company, excluding VAT, by close date) and deal counts month by month since records began, and by broker for one month. Admins and directors only.', input_schema: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM' } }, required: ['month'] }, allOnly: true },
  { name: 'deals', description: 'Every deal in one month: date, broker, commission, sale or rental, who it was split with, company lead or not, property, deal value. Admins and directors only.', input_schema: { type: 'object', properties: { month: { type: 'string', description: 'YYYY-MM' } }, required: ['month'] }, allOnly: true },
];
export const TOOL_LABELS = { overview: 'This week', people: 'People', listings: 'Listings', leads: 'Leads', calls: 'Calls', followups: 'Call-backs', money: 'Money', deals: 'Deals', listings_off: 'Listings off', billing: 'Billing' };

// Each call's result, the same way the Hot & cold report reads it: the longest quick note its note starts with, else its outcome
const reasonRows = sql`(values ${sql(REASONS.map((x) => [x[0], x[1], x[2]]))}) as r(prefix, label, grp)`;
const LISTING = ['Listing opportunity', 'Wants to sell', 'Wants to rent', 'Unit available'];
const CALLBACK = ['Call back', 'In discussion', 'Replied'];

async function calls(team, { from, to, group_by }) {
  if (!isDay(from) || !isDay(to) || from > to) return { error: 'from and to must be days, YYYY-MM-DD, from first' };
  if ((Date.parse(to) - Date.parse(from)) / 864e5 > 366) return { error: 'At most 366 days at a time' };
  const key = { broker: sql`broker`, team: sql`team`, day: sql`day`, area: sql`area`, result: sql`reason` }[group_by];
  if (!key) return { error: 'Unknown group_by' };
  const rows = await sql`
    with c as (
      select c.owner_id, coalesce(s.full_name, s.email) as broker, coalesce(ops.team_at(lower(s.email), ops.dubai_day(c.called_at)), 'No team') as team,
        ops.dubai_day(c.called_at)::text as day, coalesce(a.name, 'Unknown') as area,
        coalesce(n.label, o.label, case when coalesce(c.note, '') = '' then 'Nothing logged' else 'Other (own words)' end) as reason,
        coalesce(n.grp, o.grp, case when coalesce(c.note, '') = '' then 'nocontact' else 'objection' end) as grp
      from desk.calls c
      join desk.staff s on s.user_id = c.user_id
      left join desk.units u on u.id = c.unit_id left join desk.buildings b on b.id = u.building_id left join desk.areas a on a.id = b.area_id
      left join lateral (select label, grp from ${reasonRows} where r.prefix not like 'outcome:%' and lower(coalesce(c.note, '')) like lower(r.prefix) || '%'
                         order by length(r.prefix) desc limit 1) n on true
      left join lateral (select label, grp from ${reasonRows} where r.prefix = 'outcome:' || c.outcome limit 1) o on true
      where c.called_at >= (${from}::date::timestamp at time zone 'Asia/Dubai') and c.called_at < ((${to}::date + 1)::timestamp at time zone 'Asia/Dubai')
        and (${team}::text is null or ops.team_at(lower(s.email), ops.dubai_day(c.called_at)) = ${team}))
    select ${key} as "group", ${group_by === 'result' ? sql`min(grp)` : sql`null`} as kind,
      count(*)::int as calls, count(distinct owner_id)::int as owners,
      count(*) filter (where grp <> 'nocontact')::int as reached, count(*) filter (where grp = 'nocontact')::int as no_answer,
      count(*) filter (where reason = any(${LISTING}))::int as listing_opps, count(*) filter (where reason = 'Wants valuation')::int as valuations,
      count(*) filter (where reason = any(${CALLBACK}))::int as call_backs, count(*) filter (where grp = 'hot')::int as hot
    from c group by 1 order by 3 desc limit 200`;
  const [f] = await sql`select ops.dubai_day(min(called_at))::text as first_call from desk.calls`;
  return { from, to, group_by, team: team || 'all teams', first_call: f?.first_call || null, rows: rows.map(({ kind, ...r }) => (group_by === 'result' ? { ...r, kind } : r)) };
}

async function listingsOff(team, { from, to, group_by }) {
  if (!isDay(from) || !isDay(to) || from > to) return { error: 'from and to must be days, YYYY-MM-DD, from first' };
  if ((Date.parse(to) - Date.parse(from)) / 864e5 > 186) return { error: 'At most 186 days at a time' };
  if (!['reason', 'broker', 'week'].includes(group_by)) return { error: 'Unknown group_by' };
  const rows = await sql`
    with e as (
      select coalesce(nullif(e.reason, ''), 'No reason recorded') as reason, coalesce(p.full_name, nullif(e.agent_email, ''), 'No broker') as broker,
        date_trunc('week', e.day)::date::text as week
      from ops.listing_events e left join ops.people p on p.email = e.agent_email
      where e.event = 'off' and e.day between ${from}::date and ${to}::date
        and (${team}::text is null or ops.team_at(e.agent_email, e.day) = ${team})),
    g as (select ${group_by === 'reason' ? sql`reason` : group_by === 'broker' ? sql`broker` : sql`week`} as "group", count(*)::int as off from e group by 1)
    select g.*, ${group_by === 'reason' ? sql`null::json` : sql`(select json_agg(json_build_object('reason', reason, 'n', n) order by n desc) from (
        select reason, count(*)::int as n from e where ${group_by === 'broker' ? sql`e.broker` : sql`e.week`} = g."group" group by 1 order by 2 desc limit 5) t)`} as top_reasons
    from g order by ${group_by === 'week' ? sql`1 desc` : sql`2 desc`} limit 200`;
  const [m] = await sql`select min(day)::text as since from ops.listing_events`;
  return { from, to, group_by, team: team || 'all teams', since: m?.since || null, rows: rows.map(({ top_reasons, ...r }) => (top_reasons ? { ...r, top_reasons } : r)) };
}

async function billing(team, { from_month, to_month }) {
  if (!isMonth(from_month) || !isMonth(to_month) || from_month > to_month) return { error: 'from_month and to_month must be YYYY-MM, from first' };
  const [y1, m1] = from_month.split('-').map(Number); const [y2, m2] = to_month.split('-').map(Number);
  if ((y2 - y1) * 12 + (m2 - m1) > 23) return { error: 'At most 24 months at a time' };
  const rows = await sql`
    with ppl as (select p.email, p.full_name, ops.team_at(p.email, ops.dubai_day(now())) as team, ops.role_at(p.email, ops.dubai_day(now())) as role
                 from ops.people p where p.status = 'active' and p.kind in ('broker', 'manager') and not p.hide_from_kpi
                   and (${team}::text is null or ops.team_at(p.email, ops.dubai_day(now())) = ${team}))
    select p.full_name as name, p.team, p.role,
      coalesce(sum(x.amount) filter (where x.month between ${from_month + '-01'}::date and ${to_month + '-01'}::date), 0)::float as billed,
      (count(*) filter (where x.counts_as_deal and x.month between ${from_month + '-01'}::date and ${to_month + '-01'}::date))::int as deals,
      (count(distinct x.month) filter (where x.month between ${from_month + '-01'}::date and ${to_month + '-01'}::date and x.amount > 0))::int as months_billed,
      max(x.deal_date)::text as last_deal, min(x.deal_date)::text as first_deal
    from ppl p left join ops.deals x on x.email = p.email and x.deleted_at is null
    group by 1, 2, 3 order by 4, 1`;
  return { from_month, to_month, team: team || 'all teams', rows };
}

async function followups(team) {
  const rows = await sql`
    select coalesce(s.full_name, s.email) as broker, ops.team_at(lower(s.email), ops.dubai_day(now())) as team,
      count(*) filter (where f.due_at < date_trunc('day', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai')::int as overdue,
      count(*) filter (where ops.dubai_day(f.due_at) = ops.dubai_day(now()))::int as due_today,
      count(*) filter (where f.due_at > now() and f.due_at < now() + interval '7 days')::int as next_7_days
    from desk.followups f join desk.staff s on s.user_id = f.user_id
    where f.done_at is null and s.active and (${team}::text is null or ops.team_at(lower(s.email), ops.dubai_day(now())) = ${team})
    group by 1, 2 order by 3 desc limit 200`;
  return { team: team || 'all teams', rows };
}

async function runTool(name, input, sc) {
  const team = sc.team || null;
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return { error: 'Unknown tool' };
  if (t.allOnly && !sc.all) return { error: 'Not available to managers' };
  switch (name) {
    case 'overview': return pages.today(team);
    case 'people': return pages.people(team, input.period === 'month' ? 'month' : 'week');
    case 'listings': return pages.listings(team);
    case 'leads': return pages.leads(team);
    case 'calls': return calls(team, input);
    case 'followups': return followups(team);
    case 'listings_off': return listingsOff(team, input);
    case 'billing': return billing(team, input);
    case 'money': return isMonth(input.month) ? pages.money(input.month + '-01') : { error: 'month must be YYYY-MM' };
    case 'deals': {
      if (!isMonth(input.month)) return { error: 'month must be YYYY-MM' };
      const d = await dealsPage(input.month + '-01');
      return { month: d.month, totals: d.totals, deals: d.deals };
    }
  }
}

// Long results are cut to fit, and Claude is told so
function fit(v) {
  const s = JSON.stringify(v ?? null);
  return s.length <= MAX_TOOL_CHARS ? s : s.slice(0, MAX_TOOL_CHARS) + ' …[cut short: ask for a narrower period or one team]';
}

const system = (sc, today, firstCall) => `You answer questions from Apex Homes Dubai's management about their brokers, using only figures from the tools.
Today is ${today} (Dubai). The first Owner Desk call was on ${firstCall || 'an unknown day'}. ${sc.team ? `This person manages the ${sc.team} team and only sees that team.` : 'This person can see every team.'}
Rules:
- Every number you give must come from a tool result. Never estimate, extrapolate or fill a gap. If the data isn't there, say plainly what is missing.
- Say which period your figures cover (for example "1 to 16 November").
- Deal counts are whole numbers. Billed is commission due to the company, excluding VAT, by close date. Money is AED, written like AED 1,234,567.
- Write in plain UK English, short and direct, like a sharp operations manager. Lead with the answer. Use a small table when comparing more than three people or teams. No headings for short answers, no closing summaries or offers.
- Calls are Owner Desk calls. "Reached" means the owner answered. A listing opportunity is a call where the owner wants to list for rent or sale (listing opportunity, wants to sell, wants to rent, unit available). Valuations and call-backs are counted separately. Call these "listing opportunities from calls", not listings won.
- For "all calls" or "so far" questions, start from the first Desk call day given above, so nothing is missed. "No team" means calls by people not on a team that day (for example managers, leavers or admin).
- Listings off: give the reasons exactly as recorded. If many say "No reason recorded", say so rather than guessing why.
- "Who hasn't billed": use the billing tool, name everyone at zero for the period asked, and give their last deal date (or say there is no deal on record). Don't call someone new because they have no deals; you don't know start dates.
- If a question is not about the business data, say you can only answer questions about the Desk's figures.`;

async function claude(key, model, body) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: MAX_TOKENS, ...body }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j?.error?.message || 'Claude did not answer'), { status: r.status });
  return j;
}

const usd = (u) => ((u.input_tokens || 0) * PRICE.in + (u.output_tokens || 0) * PRICE.out
  + (u.cache_creation_input_tokens || 0) * PRICE.cacheWrite + (u.cache_read_input_tokens || 0) * PRICE.cacheRead) / 1e6;

// Returns [httpStatus, json]
export async function ask(staff, sc, question) {
  const q = String(question || '').trim().slice(0, 600);
  if (q.length < 3) return [400, { error: 'Type a question first.' }];
  const L = await limitsNow();
  const key = process.env.ANTHROPIC_API_KEY;
  if (!L.enabled) return [503, { error: 'Ask is switched off at the moment.' }];
  if (!key) return [503, { error: 'Ask isn\'t set up yet (no API key in Vercel).' }];

  const [u] = await sql`
    with day as (select date_trunc('day', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai' as start)
    select
      (select count(*) from desk.ask_log, day where user_id = ${staff.user_id} and at >= day.start)::int as mine,
      (select count(*) from desk.ask_log, day where at >= day.start)::int as everyone,
      (select coalesce(sum(usd), 0) from desk.ask_log where at >= date_trunc('month', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai')::float as month_usd,
      (select extract(epoch from now() - max(at)) from desk.ask_log where user_id = ${staff.user_id})::float as since_last,
      exists (select 1 from desk.ask_log where user_id = ${staff.user_id} and status = 'running' and at > now() - interval '90 seconds') as busy,
      (select ops.dubai_day(min(called_at))::text from desk.calls) as first_call`;
  if (u.busy) return [429, { error: 'Your last question is still being answered.' }];
  if (u.since_last != null && u.since_last < L.cooldownSec) return [429, { error: 'Give it a few seconds between questions.' }];
  if (u.mine >= L.perPersonDay) return [429, { error: `That's your ${L.perPersonDay} questions for today. It resets at midnight.` }];
  if (u.everyone >= L.companyDay) return [429, { error: 'The company limit for today has been reached. It resets at midnight.' }];
  if (u.month_usd >= L.monthlyUsd) return [429, { error: 'This month\'s budget for Ask has been used. Ollie can raise it.' }];

  const [row] = await sql`insert into desk.ask_log (user_id, question, team, status) values (${staff.user_id}, ${q}, ${sc.team || null}, 'running') returning id`;
  const tools = TOOLS.filter((t) => sc.all || !t.allOnly).map(({ allOnly, ...t }) => t);
  tools[tools.length - 1] = { ...tools[tools.length - 1], cache_control: { type: 'ephemeral' } };
  const sys = [{ type: 'text', text: system(sc, dubaiToday(), u.first_call), cache_control: { type: 'ephemeral' } }];
  const messages = [{ role: 'user', content: q }];
  const used = []; const total = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  try {
    let answer = '';
    for (let round = 0; round <= MAX_ROUNDS; round++) {
      const last = round === MAX_ROUNDS;
      const r = await claude(key, L.model, { system: sys, tools, messages, ...(last ? { tool_choice: { type: 'none' } } : {}) });
      for (const k of Object.keys(total)) total[k] += r.usage?.[k] || 0;
      const calls = (r.content || []).filter((b) => b.type === 'tool_use');
      answer = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      if (r.stop_reason !== 'tool_use' || !calls.length) break;
      messages.push({ role: 'assistant', content: r.content });
      const results = [];
      for (const c of calls) {   // one at a time: the database connection pool is small on purpose
        used.push({ tool: c.name, input: c.input });
        let out;
        try { out = await runTool(c.name, c.input || {}, sc); } catch (e) { console.error(e); out = { error: 'That data could not be read just now' }; }
        results.push({ type: 'tool_result', tool_use_id: c.id, content: fit(out) });
      }
      messages.push({ role: 'user', content: results });
    }
    if (!answer) answer = 'I couldn\'t find an answer to that in the Desk\'s figures.';
    const cost = usd(total);
    await sql`update desk.ask_log set status = 'ok', answer = ${answer}, tools = ${sql.json(used)}, tokens_in = ${total.input_tokens + total.cache_creation_input_tokens + total.cache_read_input_tokens},
      tokens_out = ${total.output_tokens}, usd = ${cost} where id = ${row.id}`;
    return [200, { id: row.id, answer, used: [...new Set(used.map((x) => x.tool))].map((t) => TOOL_LABELS[t] || t), left: Math.max(0, L.perPersonDay - u.mine - 1) }];
  } catch (e) {
    console.error('ask failed', e.status, e.message);
    const cost = usd(total);
    await sql`update desk.ask_log set status = 'error', answer = ${String(e.message).slice(0, 500)}, tools = ${sql.json(used)}, usd = ${cost} where id = ${row.id}`;
    return [502, { error: e.status === 429 || e.status === 529 ? 'Claude is busy right now. Try again in a minute.' : 'Something went wrong getting the answer. Try again.' }];
  }
}

// The person's own recent questions, and (for admins) how much Ask has used
export async function askPage(staff, sc) {
  const L = await limitsNow();
  const mine = await sql`select id, at, question, answer, status, tools from desk.ask_log where user_id = ${staff.user_id} and status <> 'running' order by id desc limit 15`;
  const [u] = await sql`
    with day as (select date_trunc('day', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai' as start)
    select (select count(*) from desk.ask_log, day where user_id = ${staff.user_id} and at >= day.start)::int as mine_today,
           (select count(*) from desk.ask_log, day where at >= day.start)::int as all_today,
           (select coalesce(sum(usd), 0) from desk.ask_log where at >= date_trunc('month', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai')::float as month_usd`;
  return {
    on: !!L.enabled && !!process.env.ANTHROPIC_API_KEY, left: Math.max(0, L.perPersonDay - u.mine_today), team: sc.team, all: sc.all,
    history: mine.map((m) => ({ ...m, used: [...new Set((m.tools || []).map((x) => x.tool))].map((t) => TOOL_LABELS[t] || t) })),
    usage: sc.all ? { today: u.all_today, companyDay: L.companyDay, monthUsd: Math.round(u.month_usd * 100) / 100, monthlyUsd: L.monthlyUsd } : null,
  };
}
