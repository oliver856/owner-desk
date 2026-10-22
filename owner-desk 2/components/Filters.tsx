'use client';
import { useEffect, useRef, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  sp: Record<string, string | string[] | undefined>;
  subcommunities: string[];
  buildings: { subcommunity: string; building: string }[];
};

const arr = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

// Filters update the list in place: no full page reload, the current results stay on screen
// until the new ones arrive, and typing in search waits for a short pause before asking.
export default function Filters({ sp, subcommunities, buildings }: Props) {
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    document.body.dataset.loading = pending ? '1' : '';
  }, [pending]);

  const apply = () => {
    const f = ref.current;
    if (!f) return;
    const p = new URLSearchParams();
    new FormData(f).forEach((v, k) => { if (typeof v === 'string' && v !== '') p.append(k, v); });
    start(() => router.replace('/?' + p.toString(), { scroll: false }));
  };
  const soon = (ms = 350) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(apply, ms);
  };

  const sc = one(sp.sc);
  const bl = buildings.filter((b) => !sc || b.subcommunity === sc);
  const box = (name: string, value: string, label: string) => (
    <label className="cb" key={name + value}>
      <input type="checkbox" name={name} value={value} defaultChecked={arr(sp[name]).includes(value)} onChange={() => apply()} />
      {label}
    </label>
  );
  const flag = (name: string, label: string) => (
    <label className="cb" key={name}>
      <input type="checkbox" name={name} value="1" defaultChecked={!!one(sp[name])} onChange={() => apply()} />
      {label}
    </label>
  );
  const numIn = (name: string, ph: string) => (
    <input id={name} type="number" inputMode="numeric" name={name} placeholder={ph} defaultValue={one(sp[name])} onChange={() => soon(600)} />
  );

  return (
    <form ref={ref} className="filters" onSubmit={(e) => { e.preventDefault(); apply(); }}>
      <input type="hidden" name="tab" value={one(sp.tab) || 'all'} />
      <input type="hidden" name="sort" value={one(sp.sort) || 'unit'} />
      <div><input id="q" type="search" name="q" placeholder="Search owner, building or unit" defaultValue={one(sp.q)} onChange={() => soon()} autoComplete="off" /></div>
      <div><h3>Sub-community</h3>
        <select id="sc" name="sc" defaultValue={sc} onChange={() => { const f = ref.current; if (f) (f.elements.namedItem('bld') as HTMLSelectElement).value = ''; apply(); }}>
          <option value="">All</option>
          {subcommunities.map((s) => <option key={s}>{s}</option>)}
        </select></div>
      <div><h3>Building</h3>
        <select id="bld" name="bld" key={sc} defaultValue={one(sp.bld)} onChange={() => apply()}>
          <option value="">All</option>
          {bl.map((b) => <option key={b.subcommunity + b.building}>{b.building}</option>)}
        </select></div>
      <div><h3>Lease</h3>{box('st', 'Live Ejari', 'Live Ejari')}{box('st', 'No live Ejari', 'No live Ejari')}{box('st', 'Not confirmed', 'Not confirmed')}</div>
      <div><h3>Contract ends</h3>
        {[['30', 'Within 30 days'], ['90', 'Within 90 days'], ['180', 'Within 6 months'], ['365', 'Within a year'], ['', 'Any time']].map(([v, l]) => (
          <label className="cb" key={v}><input type="radio" name="exp" value={v} defaultChecked={one(sp.exp) === v} onChange={() => apply()} />{l}</label>
        ))}
        <div className="pair" style={{ marginTop: 6 }}>
          <input id="from" type="date" name="from" defaultValue={one(sp.from)} onChange={() => apply()} aria-label="Ends from" />
          <input id="to" type="date" name="to" defaultValue={one(sp.to)} onChange={() => apply()} aria-label="Ends to" />
        </div></div>
      <div><h3>Type</h3>{box('type', 'Apartment', 'Apartment')}{box('type', 'Villa', 'Villa')}</div>
      <div><h3>Beds</h3>{['Studio', '1', '2', '3', '4', '5', '6', '7'].map((b) => box('beds', b, b === 'Studio' ? 'Studio' : `${b} bed`))}</div>
      <div><h3>Size, sq ft</h3><div className="pair">{numIn('smin', 'Min')}{numIn('smax', 'Max')}</div></div>
      <div><h3>Rent, AED a year</h3><div className="pair">{numIn('rmin', 'Min')}{numIn('rmax', 'Max')}</div></div>
      <div><h3>Tenancy</h3>{flag('first', 'First year (no renewals)')}{flag('ren2', 'Renewed 2+ times')}{flag('up', 'Rent went up')}{flag('down', 'Rent went down')}</div>
      <div><h3>Last sale price, AED</h3><div className="pair">{numIn('pmin', 'Min')}{numIn('pmax', 'Max')}</div></div>
      <div><h3>Owner</h3>{flag('port', 'Owns 2+ units here')}{flag('mort', 'Mortgaged')}{flag('ind', 'Individuals only')}{flag('phone', 'Has a mobile number')}</div>
      <button type="button" className="link" style={{ textAlign: 'left' }}
        onClick={() => {
          const f = ref.current;
          if (!f) return;
          Array.from(f.elements).forEach((el) => {
            if (el instanceof HTMLInputElement) {
              if (el.type === 'checkbox') el.checked = false;
              else if (el.type === 'radio') el.checked = el.value === '';
              else if (el.type !== 'hidden') el.value = '';
            } else if (el instanceof HTMLSelectElement) el.value = '';
          });
          apply();
        }}>Clear filters</button>
    </form>
  );
}
