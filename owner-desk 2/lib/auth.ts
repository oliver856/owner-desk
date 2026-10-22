import { cache } from 'react';
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
  areas: number[];
};

// Verifies the signed-in session. getClaims checks the token's signature locally when the
// project uses asymmetric signing keys (no round trip to Supabase), otherwise it asks the auth server.
export const currentUserId = cache(async (): Promise<string | null> => {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getClaims();
  return (data?.claims?.sub as string | undefined) ?? null;
});

// One query: the staff record and the areas they may see. Cached for the rest of this request.
export const getStaff = cache(async (): Promise<Staff | null> => {
  const id = await currentUserId();
  if (!id) return null;
  const rows = await sql<Staff[]>`
    select s.user_id, s.full_name, s.email, s.role, s.team,
      case when s.role = 'admin' then (select coalesce(array_agg(id), '{}') from desk.areas)
           else coalesce((select array_agg(area_id) from desk.staff_areas sa
                 where sa.user_id = s.user_id
                   and (sa.expires_at is null or sa.expires_at >= (now() at time zone 'Asia/Dubai')::date)), '{}')
      end as areas
    from desk.staff s where s.user_id = ${id} and s.active`;
  const s = rows[0];
  if (!s) return null;
  return { ...s, areas: (s.areas ?? []).map(Number) };
});

export async function requireStaff(): Promise<Staff> {
  const s = await getStaff();
  if (!s) redirect('/login?e=access');
  return s;
}

export async function requestIp(): Promise<string> {
  return clientIp(await headers());
}

export async function allowedAreaIds(s: Staff): Promise<number[]> {
  return s.areas;
}
