// Each person's own WhatsApp follow-up messages. Empty = the standard message. Created once, without touching other tables.
import { sql } from './core.js';

let ready = null;
export function ensureTemplates() {
  ready ??= (async () => {
    const [r] = await sql`select to_regclass('desk.staff_templates') is not null as ok`;
    if (r.ok) return;
    await sql`create table if not exists desk.staff_templates (
      user_id uuid primary key references desk.staff(user_id) on delete cascade,
      templates jsonb not null default '{}',
      updated_at timestamptz not null default now())`;
    await sql`alter table desk.staff_templates enable row level security`;
    await sql`revoke all on desk.staff_templates from anon, authenticated`;
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

export const TEMPLATE_KEYS = ['noanswer', 'spoke'];

export async function getTemplates(userId) {
  await ensureTemplates();
  const [r] = await sql`select templates from desk.staff_templates where user_id = ${userId}`;
  return r?.templates || {};
}

export async function saveTemplates(userId, t) {
  await ensureTemplates();
  const clean = {};
  for (const k of TEMPLATE_KEYS) { const v = String(t?.[k] || '').replace(/\r/g, '').trim().slice(0, 1000); if (v) clean[k] = v; }
  await sql`insert into desk.staff_templates (user_id, templates) values (${userId}, ${sql.json(clean)})
            on conflict (user_id) do update set templates = excluded.templates, updated_at = now()`;
  return clean;
}
