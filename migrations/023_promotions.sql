-- 023 · Promotions tracker (Management → Performance → Promotions)
--
-- ops.promotion_levels   the FY2026 promotion framework (sales track): each level, the window to serve before moving up,
--                        the cumulative GCI to move up, and the monthly GCI target at that level
-- ops.promotion_track    each broker's current level and the date they reached it (start date, or their last promotion).
--                        GCI counts from that date: it resets at every promotion.
--
-- Rule (FY2026 framework): move up when cumulative GCI since `since` reaches the target AND the window has been served,
-- or straight away on 150% of the target (fast-track). Fast-track to Associate Director also needs 5 closed deals.
-- People are added by a separate seed file (names and emails stay out of this public repo).
-- Safe to run again.

create table if not exists ops.promotion_levels (
  level          smallint primary key,
  title          text not null,
  window_months  smallint,          -- months to serve at this level before moving up (null at the top)
  next_target    numeric,           -- cumulative GCI needed to move up from this level (null at the top)
  monthly_target numeric not null   -- monthly steady-state GCI target at this level
);

insert into ops.promotion_levels (level, title, window_months, next_target, monthly_target) values
  (1, 'Associate Consultant', 3, 45000, 15000),
  (2, 'Property Consultant', 6, 180000, 30000),
  (3, 'Senior Consultant', 9, 540000, 60000),
  (4, 'Principal Consultant', 12, 1080000, 90000),
  (5, 'Associate Director', null, null, 120000)
on conflict (level) do update set title = excluded.title, window_months = excluded.window_months,
  next_target = excluded.next_target, monthly_target = excluded.monthly_target;

create table if not exists ops.promotion_track (
  email      text primary key,      -- lower case, as ops.people
  name       text not null,
  level      smallint references ops.promotion_levels(level),   -- null = level not set yet
  since      date not null,         -- start date, or date of last promotion
  note       text,
  updated_at timestamptz not null default now()
);

select (select count(*) from ops.promotion_levels) as levels, (select count(*) from ops.promotion_track) as people_tracked;
