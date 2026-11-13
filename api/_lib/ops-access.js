// Who may see and do what on the Management pages. The one place this is decided.
//   admin, director   everything, all teams; the only ones who can open Deals and Money or change anything
//   manager           Today, Listings, Leads and People for their own team
//   everyone else     "Not allowed", so the pages can't be found by guessing the address
// ops.settings 'ops_access' (a list of emails) narrows all of this to named people while the pages are being set up.
// An empty or missing list means the role rules above apply to everyone.
import { sql } from './core.js';

const TTL_MS = 60e3;
let allow = { at: 0, list: [] };
async function allowList() {
  if (allow.at > Date.now() - TTL_MS) return allow.list;
  const [r] = await sql`select value from ops.settings where key = 'ops_access'`;
  allow = { at: Date.now(), list: Array.isArray(r?.value) ? r.value.map((e) => String(e).toLowerCase()) : [] };
  return allow.list;
}

// null = not allowed. Otherwise { all, team, email }: all = every team (and may change things), team = the team shown.
export async function scopeFor(staff, asked) {
  const email = String(staff.email || '').toLowerCase();
  const list = await allowList();
  if (list.length && !list.includes(email)) return null;
  if (['admin', 'director'].includes(staff.role)) return { all: true, team: asked || null, email };
  if (staff.role !== 'manager') return null;
  const [r] = await sql`select ops.team_at(${email}, ops.dubai_day(now())) as team`;
  return r?.team ? { all: false, team: r.team, email } : null;
}
