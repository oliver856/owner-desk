-- Apex Owner Desk · 016 Ask (management questions answered by Claude from the Desk's figures)
-- One log row per question: who asked, what, the answer, which data it used, and what it cost.
-- The limits live in desk.settings 'ask'; change them there (no code change, takes effect on the next question).
create table if not exists desk.ask_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references desk.staff(user_id),
  at         timestamptz not null default now(),
  team       text,
  question   text not null,
  answer     text,
  tools      jsonb,
  tokens_in  int,
  tokens_out int,
  usd        numeric(10, 5) not null default 0,
  status     text not null default 'running' check (status in ('running', 'ok', 'error'))
);
create index if not exists ask_log_user_at_idx on desk.ask_log (user_id, at desc);
create index if not exists ask_log_at_idx on desk.ask_log (at desc);
alter table desk.ask_log enable row level security;
revoke all on desk.ask_log from public, anon, authenticated;

-- The limits. enabled false switches Ask off for everyone straight away.
insert into desk.settings (key, value) values ('ask', '{"enabled": true, "perPersonDay": 20, "companyDay": 200, "monthlyUsd": 60, "cooldownSec": 8, "model": "claude-sonnet-5-5"}')
on conflict (key) do nothing;

select 'Ask ready' as result;
