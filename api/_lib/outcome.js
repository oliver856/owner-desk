import { sql, audit } from './core.js';

export const OUTCOMES = ['No answer', 'Not interested', 'Call back', 'Wants valuation', 'Listing opportunity', 'Wants to sell', 'Wrong number', 'Do not call'];

// Outcome is optional: a broker can save just a note (e.g. one of the quick notes)
export async function saveOutcome(s, requestId, outcome, note, kendal, ip) {
  const [c] = await sql`
    update desk.calls set
      -- Saved twice (laptop and phone both open)? Never wipe what's there: keep the first outcome and add the new note to it
      outcome = coalesce(${outcome || null}, outcome),
      note = case
        when outcome_at is null or coalesce(note, '') = '' then ${String(note || '').slice(0, 1000) || null}
        when coalesce(${String(note || '').trim()}, '') = '' or position(lower(${String(note || '').trim()}) in lower(note)) > 0 then note
        else left(rtrim(note, '. ') || '. ' || ${String(note || '').trim()}, 2000) end,
      sent_to_kendal = sent_to_kendal or ${!!kendal}, outcome_at = coalesce(outcome_at, now())
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
