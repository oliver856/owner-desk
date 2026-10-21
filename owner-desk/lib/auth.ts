import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { sql } from './db';
import { supabaseServer } from './supabase';
import { clientIp } from './net';

export type Staff = {
  user_id: string;
  full_name: string;
  email: string;
  role: 'broker' | 'manager' | 'admin';
  team: string | null;
};

export async function currentUserId(): Promise<string | null> {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  return data.user?.id ?? null;
}

export async function getStaff(): Promise<Staff | null> {
  const id = await currentUserId();
  if (!id) return null;
  const rows = await sql<Staff[]>`
    select user_id, full_name, email, role, team
    from desk.staff where user_id = ${id} and active`;
  return rows[0] ?? null;
}

export async function requireStaff(): Promise<Staff> {
  const s = await getStaff();
  if (!s) redirect('/login?e=access');
  return s;
}

export async function requestIp(): Promise<string> {
  return clientIp(await headers());
}

// Area ids this person may see. Admins see everything; others get core areas plus unexpired grants.
export async function allowedAreaIds(s: Staff): Promise<number[]> {
  if (s.role === 'admin') {
    const r = await sql<{ id: number }[]>`select id from desk.areas`;
    return r.map((x) => Number(x.id));
  }
  const r = await sql<{ area_id: number }[]>`
    select area_id from desk.staff_areas
    where user_id = ${s.user_id} and (expires_at is null or expires_at >= (now() at time zone 'Asia/Dubai')::date)`;
  return r.map((x) => Number(x.area_id));
}
