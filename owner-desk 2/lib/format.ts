export const fmt = (n: number | string | null | undefined) =>
  n == null || n === '' ? '—' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });

export const toISO = (d: Date | string | null) => {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  // dates come back as midnight UTC from postgres; keep the calendar date
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export const fd = (d: Date | string | null) => {
  const iso = toISO(d);
  if (!iso) return '—';
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

export function daysFromToday(d: Date | string | null): number | null {
  const iso = toISO(d);
  if (!iso) return null;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai' }).format(new Date());
  return Math.round((Date.parse(iso) - Date.parse(today)) / 864e5);
}

export const bedsLabel = (b: string | null) => (!b ? '—' : b === 'Studio' ? 'Studio' : `${b} bed`);
