import { sql } from '@/lib/db';
import { requireStaff } from '@/lib/auth';
import Header from '@/components/Header';

export const dynamic = 'force-dynamic';

const LABEL: Record<string, string> = {
  searched: 'Searched', opened_unit: 'Opened a unit', call_sent: 'Sent a call to phone', call_dialled: 'Tapped Call on phone',
  outcome: 'Logged an outcome', copy_blocked: 'Tried to copy owner data', limit_hit: 'Hit a daily limit',
  call_blocked_hours: 'Tried to call outside 9am–6pm', dial_refused: 'Tapped an expired call',
};
const BAD = new Set(['copy_blocked', 'limit_hit', 'call_blocked_hours', 'dial_refused']);

// Brokers see their own activity; managers and admins see everyone's.
export default async function Activity() {
  const staff = await requireStaff();
  const all = staff.role !== 'broker';
  const rows = await sql`
    select a.at, a.action, a.detail, a.ip, s.full_name,
           case when u.id is null then null else coalesce(case when u.unit_type = 'Villa' then b.subcommunity else b.name end, '') || ' ' || u.unit_no end as unit
    from desk.audit_log a left join desk.staff s on s.user_id = a.user_id
    left join desk.units u on u.id = a.unit_id left join desk.buildings b on b.id = u.building_id
    where ${all ? sql`true` : sql`a.user_id = ${staff.user_id}`}
    order by a.at desc limit 300`;
  return (
    <>
      <Header staff={staff} />
      <main className="detail gut" style={{ maxWidth: 1000 }}>
        <h2 style={{ marginTop: 0 }}>Activity</h2>
        <p className="muted">Everything done on the Owner Desk is recorded and can&apos;t be edited or deleted.{all ? ' You are seeing everyone.' : ''}</p>
        <div className="audit">
          {rows.map((r, i) => (
            <div key={i}>
              <span className="muted n">{new Date(r.at).toLocaleString('en-GB', { timeZone: 'Asia/Dubai', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              <span>{r.full_name ?? '—'}</span>
              <span className={BAD.has(r.action) ? 'bad' : ''}>{LABEL[r.action] ?? r.action}{r.unit ? ` · ${r.unit}` : ''}{r.action === 'outcome' && r.detail?.outcome ? ` · ${r.detail.outcome}` : ''}</span>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
