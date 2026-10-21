// Client IP as seen by Vercel's edge, and the office allow-list check.
export function clientIp(h: Headers): string {
  const fwd = h.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return h.get('x-real-ip') ?? '';
}

export function officeIps(): string[] {
  return (process.env.OFFICE_IPS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// While OFFICE_IPS is empty (testing), every IP is allowed. Once it is set, only those IPs are.
export function officeAllowed(ip: string): boolean {
  const list = officeIps();
  return list.length === 0 || list.includes(ip);
}
