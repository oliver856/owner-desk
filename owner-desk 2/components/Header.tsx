import Link from 'next/link';
import type { Staff } from '@/lib/auth';
import { caps } from '@/lib/audit';
import { themeMode } from '@/lib/theme';
import CopyGuard from './CopyGuard';
import ThemeToggle from './ThemeToggle';

export default async function Header({ staff }: { staff: Staff }) {
  const [c, mode] = await Promise.all([caps(staff.user_id), themeMode()]);
  return (
    <header className="top">
      <CopyGuard />
      <div className="bar gut">
        <Link href="/" className="brand">Apex Owner Desk</Link>
        <nav className="nav">
          <Link href="/">Owners</Link>
          <Link href="/activity">Activity</Link>
          <Link href="/phone">Phone</Link>
        </nav>
        <div className="right">
          <span>Profiles <span className="n">{c.profiles}/{c.profileCap}</span></span>
          <span>Calls <span className="n">{c.calls}/{c.callCap}</span></span>
          <ThemeToggle initial={mode} />
          <span>{staff.full_name}</span>
          <form action="/api/logout" method="post"><button className="link" type="submit">Sign out</button></form>
        </div>
      </div>
    </header>
  );
}
