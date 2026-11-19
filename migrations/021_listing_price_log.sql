-- 021 Listing price log
-- One row per live Kendal listing per day with its asking price (sales) or yearly rent, so the Desk can show price
-- drops week to week (the Friday meeting slides and the "underperforming listings" flag). Filled after every Kendal
-- listings sync (api/ops-sync.js) and whenever the Listings tab cache is rebuilt. Run once. Safe to run twice.

do $$ begin if to_regclass('ops.kendal_listings') is null then raise exception 'ops.kendal_listings is missing - stop'; end if; end $$;

begin;
create table if not exists mkt.listing_price_log (
  listing_id text not null, day date not null, agent_email text, market_type text, price bigint not null,
  seen_at timestamptz not null default now(), primary key (listing_id, day)
);
create index if not exists listing_price_log_day_idx on mkt.listing_price_log (day);

-- Today's price for every live listing (the last one seen today wins)
create or replace function mkt.snapshot_listing_prices() returns int language plpgsql as $f$
declare n int;
begin
  insert into mkt.listing_price_log (listing_id, day, agent_email, market_type, price, seen_at)
  select k.listing_id, ops.dubai_day(now()), lower(k.agent_email), k.market_type,
         case when k.market_type = 'Rent' then
                coalesce(k.rent, (k.raw->'rentAndFees'->>'rentAmount')::numeric)
                * case coalesce(k.rent_frequency, k.raw->'rentAndFees'->>'frequency') when 'Monthly' then 12 else 1 end
              else coalesce(k.price, nullif((k.raw->'askingPrice'->>'value')::numeric, 0)) end::bigint,
         now()
  from ops.kendal_listings k
  where k.is_live
    and coalesce(k.price, k.rent, nullif((k.raw->'askingPrice'->>'value')::numeric, 0), (k.raw->'rentAndFees'->>'rentAmount')::numeric) > 0
  on conflict (listing_id, day) do update set price = excluded.price, agent_email = excluded.agent_email, seen_at = now();
  get diagnostics n = row_count;
  return n;
end $f$;

-- Price drops: every live listing whose price today is lower than its highest price in the last p_days days
create or replace function mkt.listing_price_drops(p_days int default 7)
returns table (listing_id text, agent_email text, market_type text, was bigint, now_price bigint, dropped_on date)
language sql stable as $f$
  with today as (select distinct on (listing_id) * from mkt.listing_price_log order by listing_id, day desc),
  before as (select listing_id, max(price) as was from mkt.listing_price_log
             where day >= ops.dubai_day(now()) - p_days and day < ops.dubai_day(now()) group by 1)
  select t.listing_id, t.agent_email, t.market_type, b.was, t.price,
         (select min(l.day) from mkt.listing_price_log l where l.listing_id = t.listing_id and l.price = t.price and l.day >= ops.dubai_day(now()) - p_days)
  from today t join before b using (listing_id)
  join ops.kendal_listings k on k.listing_id = t.listing_id and k.is_live
  where t.price < b.was
$f$;

select mkt.snapshot_listing_prices();

create temp table res on commit preserve rows as
select (select count(*) from ops.kendal_listings where is_live) as live_listings,
       (select count(*) from mkt.listing_price_log where day = ops.dubai_day(now())) as prices_logged_today,
       (select min(day) from mkt.listing_price_log) as history_starts;
commit;
select * from res;
drop table res;
