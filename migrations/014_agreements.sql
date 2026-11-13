-- Apex Owner Desk · 014 manager agreement terms (targets, override rates, bonuses)
--
-- One row per manager per agreement period, holding the terms the overrides and bonuses are worked out from.
-- Also a view of how far each manager's team (or the company) is towards its target, from the deal log by close date.
-- Schema only: the terms themselves are loaded separately. Safe to run twice. Run after 013.
create table if not exists ops.agreements (
  email                   text not null,
  period_from             date not null,
  period_to               date not null,
  position                text,
  scope                   text not null default 'team' check (scope in ('team', 'company')),
  team                    text,                       -- the team the target and override cover (null when scope = company)
  target                  numeric,                    -- billings target for the whole period
  target_includes_own     boolean not null default true,
  override_rate_hit       numeric,                    -- override rate if the target is achieved
  override_rate_miss      numeric,                    -- override rate if it is not
  override_share          numeric not null default 1, -- 0.5 when one override is split equally between two managers
  bonus_amount            numeric,
  bonus_threshold         numeric,
  bonus_basis             text check (bonus_basis in ('period', 'month')),
  bonus_max               numeric,
  personal_monthly_target numeric,
  note                    text,
  primary key (email, period_from)
);
alter table ops.agreements enable row level security;

create or replace view ops.v_agreement_progress as
with d as (
  select email, deal_date, amount, ops.team_at(email, (month + interval '1 month - 1 day')::date) as team
  from ops.deals where deleted_at is null
)
select a.email, a.position, a.period_from, a.period_to, a.scope, a.team, a.target, a.target_includes_own,
       coalesce(sum(d.amount), 0) as billed_in_scope,
       coalesce(sum(d.amount) filter (where d.email = a.email), 0) as own_billed,
       coalesce(sum(d.amount) filter (where a.target_includes_own or d.email <> a.email), 0) as counts_to_target,
       a.target - coalesce(sum(d.amount) filter (where a.target_includes_own or d.email <> a.email), 0) as left_to_target
from ops.agreements a
left join d on d.deal_date between a.period_from and a.period_to and (a.scope = 'company' or d.team = a.team)
group by a.email, a.position, a.period_from, a.period_to, a.scope, a.team, a.target, a.target_includes_own;
revoke all on all tables in schema ops from public, anon, authenticated;
