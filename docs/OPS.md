# Ops data on the Owner Desk

The Kendal Ops Dashboard (Google Sheet + Apps Script) is being moved onto the Owner Desk. This file describes
the part that has been moved so far.

## How data gets in

1. The database's scheduler calls `/api/ops-sync` once a minute (`migrations/011_ops_schedule.sql`).
2. The sync asks Kendal for the next few pages of whichever feed is due and saves them in the `ops` schema.
3. It only ever sends GET requests to Apex's own Kendal feeds. It cannot change anything in Kendal.

| Feed | Table | Fresh pass every | Notes |
|---|---|---|---|
| Listings | `ops.kendal_listings` | 2 hours | Always a full pass, which is how removed listings are caught |
| Inquiries | `ops.kendal_inquiries` | 15 minutes | Re-reads the last 6 hours each time so late edits aren't missed |
| Appointments | `ops.kendal_appointments` | 30 minutes | |
| Deals | `ops.kendal_deals` | 60 minutes | Reference only. Money comes from the deal ledger |

The timings are the `every_min` column in `ops.sync_state` and can be changed with one line of SQL.

## The definitions (written once, in `migrations/010_ops.sql`)

- **Live listing** (`ops.listing_is_live`): published, on the market, and on Bayut or Property Finder.
  This is meant to equal Kendal's own Live Listings tab.
- **Gained / lost** (`ops.listing_events`): one row each time a listing becomes live or stops being live,
  with the date, the broker and the reason. `ops.v_listing_flow_weekly` and `_monthly` add them up.
  Logging starts after the first full pass; that first pass is the baseline and logs nothing.
- **Lead** (`ops.v_portal_leads`): a Bayut or Property Finder inquiry that isn't a system message. Dated by
  when it was received, or when Kendal created it if the received time is blank. Dubai dates.
- **Owner Desk leads** (`ops.v_owner_desk_leads`): "Send to Kendal" pushes. Counted separately, never mixed in.

To change a definition: edit the function, run it in Supabase, then `select ops.rederive();`.

## Checking it

```sql
-- Is each feed running, and when did it last finish?
select endpoint, status, error, last_finished, last_rows from ops.sync_state order by 1;

-- Live listings right now (compare with Kendal's Live Listings tab)
select count(*) from ops.v_live_listings;

-- Gained and lost by week
select week, sum(gained) gained, sum(lost) lost, sum(net) net from ops.v_listing_flow_weekly group by 1 order by 1 desc;

-- Leads this month by source
select channel, count(*) from ops.kendal_inquiries
where is_genuine and lead_day >= date_trunc('month', current_date) group by 1;
```

## Why this can't slow brokers down

- Its own schema: the sync never reads or locks a `desk` table.
- Small slices: 25 records at a time, a pause between pages, at most one sync running at once.
- Server file only: nothing is added to the page brokers load.

## How the Management pages are built (keep it this way)

Each kind of thing is decided in exactly one place. Before adding anything, find its place below; if it has none,
it needs a decision first, not a workaround.

| What | Where | Rule |
|---|---|---|
| What a number means (live listing, lead, deal, billed) | SQL functions and views in `migrations/` | Pages never re-work a definition; they read the view |
| Who may see or change what | `api/_lib/ops-access.js` | Nothing else checks roles |
| What a page shows | one query per page in `api/_lib/ops-pages.js` | Read only. One JSON object per page |
| Changes to deals | database functions in `015_deal_entry.sql`, called from `api/_lib/ops-deals.js` | No code writes to `ops.deals` directly. Every change lands in `ops.deal_log` |
| How pages look | `src/ops/kit.jsx` | Pages use Bar, Stats, Section, Table and the form parts. No page has its own table markup or styles |
| KPI targets and names | `src/ops/rules.js` | No number is typed into a page |
| One page | `src/ops/<Page>.jsx` | Bar, then up to four Stats, then Sections |

Rules that hold everywhere:

- A figure goes on a page only once it has been checked against its source. Commission, retained and overrides are
  worked out in the database but are not sent to the browser until they have been checked by hand.
- Nothing is deleted. Deals are marked removed and can be put back; people and teams keep dated history.
- Red means a missed mark and nothing else.
- Names, pay rates, targets and deal amounts are loaded by hand and never committed here.
- Schema changes are numbered files in `migrations/`, each safe to run twice, each noted in `CHANGELOG.md`.

To add a page: write `src/ops/<Page>.jsx` from the kit, add one line to `TABS` in `src/Ops.jsx`, add its query to
`api/_lib/ops-pages.js` and one line to `api/ops.js`.

## Deals

A deal is one row per broker in `ops.deals`. A split is two rows sharing a `split_id`; only the first broker's row
counts towards the number of deals, so counts are whole numbers. Amounts are commission due to the company excluding
VAT, and a deal belongs to the month of its close date.

`ops.deal_add`, `ops.deal_change`, `ops.deal_remove` and `ops.deal_restore` are the only way in. They refuse a future
date, a date before 2026, a zero or negative amount, a missing type and an unknown broker, and `deal_add` stops and
asks when the same broker already has the same amount on the same day.
