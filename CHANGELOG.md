# Changelog

Every change to the Owner Desk is listed here, newest first. Each entry says what changed, which files, and
anything that has to be done by hand (SQL to run, settings to add). The Git history holds every earlier version
of every file, so any change can be rolled back by reverting its commit.

## 2026-11-19 · Meeting slides: managers and personal targets

- **Changed** `api/_lib/slides.js`:
  - Managers and directors (Mahan, Oliver Mollet, Callum, Kamil and anyone else with a manager role) are never flagged
    and aren't counted in the KPI slide. Their listings still count in Listings health.
  - The scorecards no longer show personal targets (Callum, Kamil) as their own rows. They sit inside their team's
    target, which already adds up to the 1.3m.
- History: `history/slides.2026-11-19-v2.js`. No SQL to run.

## 2026-11-19 · Meeting slides: flag changes

- **Changed** `api/_lib/slides.js` and `src/ops/Slides.jsx`:
  - Low stock now means well under the stock KPI: under half by default (12 of 25 apartments, 5 of 12 villas).
    Change it with `low_stock_share` in `mkt.settings 'meeting_flags'`.
  - New flag 7, "No new listing this month": every apartment and villa broker with nothing live since the 1st,
    on top of any other flag, with its own slide.
  - Group 4 is now "Lead follow-up / CRM compliance", because few viewings can mean they aren't being logged.
- History: `history/slides.2026-11-19-v1.js`, `history/Slides.2026-11-19-v1.jsx`. No SQL to run.

## 2026-11-19 · Friday meeting slides and daily listing prices

- **New** `migrations/021_listing_price_log.sql`: every live listing's price once a day (`mkt.listing_price_log`), and
  `mkt.listing_price_drops(days)` for price drops.
- **Changed** `api/ops-sync.js`: records the day's prices after each Kendal listings sync (2 lines; never stops the sync).
- **New** `migrations/022_meeting_slides.sql`: monthly targets for Oct to Dec 2026 (`desk.meeting_targets`) and the
  KPI and flag rules (`mkt.settings` 'meeting_flags').
- **New** `api/_lib/slides.js`, and `GET /api/ops?action=slides` in `api/ops.js`: every figure on the slides.
- **New** `src/ops/Slides.jsx`, and a "Download slides" button on the Meeting page (`src/ops/Meeting.jsx`): the deck,
  saved as a PDF one slide per page. An action starting "Issue:" shows as an issue.

By hand: run 021 and 022. Upload the src files after calling hours.

## 2026-11-18 · Listings tab and owner report

- **New** `migrations/019_listing_price_check.sql`: matches every live Kendal listing to land department sales and new
  Ejari leases for similar units (`mkt.listing_checks()`), the Desk owner on the same unit (`mkt.listing_desk_units()`),
  and adds `title` and `mobile` to `desk.staff` plus `desk.staff_photos` for headshots. Cut-offs live in
  `mkt.settings` 'price_check'. Market data itself is loaded separately (`mkt.dld_*`, `mkt.ejari_*`).
- **New** `api/listings.js`: the Listings tab data and the owner report figures. Read-only.
- **New** `src/Listings.jsx`: the Listings tab (brokers see their own, managers their team, admins everyone) and
  the one-page owner report, saved as a PDF from the print window.
- **New** `public/apex-logo.svg`: the Apex Homes DXB logo for the report.
- **Changed** `src/App.jsx`: a "Listings" button in the top bar and the lazy-loaded page (6 lines).

By hand: run 019, then the staff details file (kept out of this repo). Upload the src files after calling hours.

## 2026-11-13 · Management pages limited to named people

- **Changed** `api/ops.js`: if `ops.settings` holds an `ops_access` list of emails, only those people can open the
  Management pages. Server file only, so nobody's screen reloads. Remove the setting to go back to the role rules.

## 2026-11-12 · Management pages (branch `ops-foundation`)

- **New** `api/ops.js`: read-only data for the management pages. Admins and directors see every team; managers see
  their own team; everyone else is refused.
- **New** `src/Ops.jsx`: Today, Listings, Leads, People and Money. Loads only for admins, directors and managers.
- **Changed** `src/App.jsx`: one new "Management" entry in the top bar (7 lines). Nothing else touched.
- **Changed** `api/ops-sync.js`: starts each run on fresh database connections; status queries run one at a time.

By hand: upload the three files after calling hours (the page reloads for everyone when `App.jsx` changes).

## 2026-11-12 · People, roles, commission and the deal log (branch `ops-foundation`)

- **New** `migrations/012_people_deals.sql`: people, teams and roles with dates (a move or promotion never rewrites
  the past), commission bracket and personal-rate tables, the deal log, and monthly payout views. Functions for the
  four roster actions: join, move team, change role, leave.
- Pay rates, people and deals are loaded from a separate file that is **not** kept in this repository.

By hand: run 012, then the load file. Nothing here changes a screen.

## 2026-11-12 · Ops data foundation (branch `ops-foundation`)

First step of moving the Kendal Ops Dashboard onto the Owner Desk. No screen changes; brokers see nothing new.

- **New** `migrations/010_ops.sql`: the `ops` schema. Kendal listings, inquiries, deals and appointments, each
  record kept whole plus the columns reports need. One definition each for "live listing" and "lead". A log of
  every listing gained or lost, with weekly and monthly views. Run once in the Supabase SQL editor.
- **New** `api/ops-sync.js`: background sync from Kendal (read only) into `ops`. Server file only, so uploading
  it reloads nobody's screen.
- **New** `migrations/011_ops_schedule.sql`: makes the database call the sync once a minute. Run after the two
  above are in place.
- **New** `docs/OPS.md`: how it works, the definitions, and how to check it.

By hand: run 010, upload `api/ops-sync.js`, run 011. If the sync reports that Kendal refused the key, add
`KENDAL_READ_KEY` in Vercel (the key from the old dashboard's Config tab) and redeploy.

## ops 0.6 · 13 Nov 2026 · manager agreement terms
- **New** `migrations/014_agreements.sql`: `ops.agreements` (target, override rates, bonus terms per manager per period)
  and `ops.v_agreement_progress` (billings towards each target from the deal log, by close date).
- The terms themselves are loaded by hand from the Q4 2026 agreements and are not in this repository.
- Overrides and bonuses are not calculated yet: they need a transferred date on each deal.

## ops 0.7 · 13 Nov 2026 · deal entry, and the Management pages rebuilt on shared parts
- **New** `migrations/015_deal_entry.sql`: deals are added, changed, removed and put back only through four database
  functions; every change is logged in `ops.deal_log`; the table now enforces amount above zero, month matching the
  close date and a known broker. Adds `transferred_on` to deals.
- **New Deals tab** (admins and directors): add a deal (with an even split, company lead, property), edit, remove,
  put back, and a list of who changed what.
- **Changed** `api/ops.js` is now a thin router over `api/_lib/ops-access.js`, `ops-pages.js` and `ops-deals.js`.
  Pages that show deal figures stop serving a remembered answer the moment a deal changes.
- **Changed** `src/Ops.jsx` split into `src/ops/`: `kit.jsx` (shared parts and styles), `rules.js` (KPI numbers),
  one file per page. Every page is Bar, Stats, Sections; every table sorts the same way.
- **Changed** Money shows billed and deals only. Commission and retained are no longer sent to the browser until
  they have been checked. The month's deal list moved to Deals.
- **New** Quarter targets on Today, from `ops.v_agreement_progress`.
- Previous single-file version of the pages: commit `71efbcf` (`src/Ops.jsx`, `api/ops.js`).

By hand: run 014 and 015, then upload `api/` and `src/` together after calling hours.
