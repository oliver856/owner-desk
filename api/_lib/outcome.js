import { sql, audit } from './core.js';
import { setReportOptin } from './reports.js';
import { pushCallToKendal } from './kendal.js';

export const OUTCOMES = ['No answer', 'Not interested', 'Call back', 'Wants valuation', 'Listing opportunity', 'Wants to sell', 'Wrong number', 'Do not call'];

// Outcome is optional: a broker can save just a note (e.g. one of the quick notes)
export async function saveOutcome(s, requestId, outcome, note, kendal, ip, report = false) {
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
  if (!c) return null;
  if (outcome === 'Do not call') {
    await sql`insert into desk.do_not_call (owner_id, added_by, reason) values (${c.owner_id}, ${s.user_id}, 'Owner asked on a call')
              on conflict (owner_id) do nothing`;
  }
  // Ticked "Send a market report every month": put the unit on the monthly list
  if (report) await setReportOptin(s.user_id, c.unit_id, true);
  await audit(s.user_id, 'outcome', { unitId: c.unit_id, detail: { outcome, kendal, report: !!report, call_id: c.id }, ip });
  // Ticked "Send to Kendal": create the lead in Kendal, assigned to this broker. A Kendal problem never loses the outcome.
  let k = null;
  if (kendal) {
    k = await pushCallToKendal(c.id).catch((e) => ({ status: 'error', detail: String(e.message || e) }));
    if (k.status !== 'off') await audit(s.user_id, 'kendal_push', { unitId: c.unit_id, detail: { call_id: c.id, status: k.status, detail: k.detail }, ip });
  }
  return { ok: true, kendal: k };
}
