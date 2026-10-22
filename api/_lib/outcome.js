import { sql, audit } from './core.js';

export const OUTCOMES = ['No answer', 'Not interested', 'Call back', 'Wants valuation', 'Listing opportunity', 'Wants to sell', 'Wrong number', 'Do not call'];

export async function saveOutcome(s, requestId, outcome, note, kendal, ip) {
  const [c] = await sql`
    update desk.calls set outcome = ${outcome}, note = ${String(note || '').slice(0, 1000) || null},
      sent_to_kendal = ${kendal}, outcome_at = now()
    where request_id = ${requestId} and user_id = ${s.user_id}
    returning id, unit_id, owner_id`;
  if (!c) return false;
  if (outcome === 'Do not call') {
    await sql`insert into desk.do_not_call (owner_id, added_by, reason) values (${c.owner_id}, ${s.user_id}, 'Owner asked on a call')
              on conflict (owner_id) do nothing`;
  }
  await audit(s.user_id, 'outcome', { unitId: c.unit_id, detail: { outcome, kendal, call_id: c.id }, ip });
  return true;
}
