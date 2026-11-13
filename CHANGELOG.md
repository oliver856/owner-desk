# Changelog

Every change to the Owner Desk is listed here, newest first. Each entry says what changed, which files, and
anything that has to be done by hand (SQL to run, settings to add). The Git history holds every earlier version
of every file, so any change can be rolled back by reverting its commit.

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
