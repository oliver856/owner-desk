// First sign-in: someone an admin has added sets their own password. No sign-in needed for this route,
// but it still only works from the office network, and only for an email that has been added and not yet set up.
import { route, body, sql, audit } from './_lib/core.js';
import { ensureInvites, cleanEmail, validEmail, adminAuth, setAreas } from './_lib/team.js';

const tries = new Map(); // ip -> [timestamps], a simple brake on guessing

export default route(async (req, res, _s, ip) => {
  if (req.method !== 'POST') return res.status(405).end();
  const now = Date.now();
  const recent = (tries.get(ip) || []).filter((t) => now - t < 10 * 60000);
  if (recent.length >= 10) return res.status(429).json({ error: 'Too many tries. Wait 10 minutes and try again.' });
  tries.set(ip, [...recent, now]);

  const b = body(req);
  const email = cleanEmail(b.email);
  const password = String(b.password || '');
  if (!validEmail(email)) return res.status(400).json({ error: 'Enter your work email.' });
  if (password.length < 8) return res.status(400).json({ error: 'Use at least 8 characters for your password.' });
  if (password.length > 72) return res.status(400).json({ error: 'That password is too long.' });

  await ensureInvites();
  const [inv] = await sql`select * from desk.staff_invites where email = ${email}`;
  const [already] = await sql`select 1 from desk.staff where lower(email) = ${email} and active`;
  if (already || inv?.claimed_at) return res.status(409).json({ error: 'This email is already set up. Sign in instead, or ask Ollie to reset your password.' });
  if (!inv) return res.status(404).json({ error: 'This email hasn\'t been added yet. Ask Ollie to add you, then try again.' });
  if (now - new Date(inv.created_at).getTime() > 14 * 86400000) return res.status(410).json({ error: 'This invite has expired. Ask Ollie to add you again.' });

  const admin = adminAuth();
  if (!admin) return res.status(503).json({ error: 'Setting up new logins isn\'t switched on yet. Ask Ollie.' });

  // Create the login, or set the password on one that was made by hand without a desk record
  let userId;
  const [existing] = await sql`select id from auth.users where lower(email) = ${email}`;
  if (existing) {
    const { error } = await admin.updateUserById(existing.id, { password, email_confirm: true });
    if (error) throw error;
    userId = existing.id;
  } else {
    const { data, error } = await admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: inv.full_name } });
    if (error) throw error;
    userId = data.user.id;
  }

  await sql.begin(async (tx) => {
    await tx`insert into desk.staff (user_id, full_name, email, role, team, active)
             values (${userId}, ${inv.full_name}, ${email}, ${inv.role}, ${inv.team}, true)
             on conflict (user_id) do update set full_name = excluded.full_name, email = excluded.email,
               role = excluded.role, team = excluded.team, active = true`;
    await setAreas(tx, userId, (inv.areas || []).map(Number), inv.created_by);
    await tx`update desk.staff_invites set claimed_at = now(), user_id = ${userId} where email = ${email}`;
  });
  await audit(userId, 'account_set_up', { ip }).catch(() => {});
  res.json({ ok: true });
}, { auth: false });
