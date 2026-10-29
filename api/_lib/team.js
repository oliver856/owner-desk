// People on the desk: invites (added by an admin or director) and setting up a first password.
import { createClient } from '@supabase/supabase-js';
import { sql } from './core.js';

export const ROLES = ['broker', 'manager', 'director', 'admin'];

let invitesReady = null;
// Only creates the invites table if it's missing. It never alters the staff table here: that needs a lock on every
// sign-in and could leave the Team page waiting behind everyone else's requests.
export const ensureInvites = () => (invitesReady ??= sql`select to_regclass('desk.staff_invites') is not null as ok`.then(([r]) => r.ok || sql`create table if not exists desk.staff_invites (
    email text primary key,
    full_name text not null,
    role text not null,
    team text,
    areas bigint[] not null default '{}',
    created_by uuid references desk.staff(user_id),
    created_at timestamptz not null default now(),
    claimed_at timestamptz,
    user_id uuid)`
  .then(() => sql`alter table desk.staff_invites enable row level security`)
  .then(() => sql`revoke all on desk.staff_invites from anon, authenticated`))
  .catch((e) => { invitesReady = null; throw e; }));

export const cleanEmail = (e) => String(e || '').trim().toLowerCase();
export const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;

// The service key only lives on the server (Vercel setting SUPABASE_SERVICE_ROLE_KEY). It is never sent to the browser.
export function adminAuth() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }).auth.admin;
}

// Gives a person exactly these areas (their core areas)
export async function setAreas(tx, userId, areaIds, by) {
  await tx`delete from desk.staff_areas where user_id = ${userId} and kind = 'core'`;
  if (areaIds.length) {
    await tx`insert into desk.staff_areas (user_id, area_id, kind, granted_by)
             select ${userId}, a, 'core', ${by} from unnest(${areaIds}::bigint[]) a
             on conflict (user_id, area_id) do update set kind = 'core', expires_at = null`;
  }
}
