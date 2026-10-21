'use client';
import { useRef } from 'react';

type Props = {
  sp: Record<string, string | string[] | undefined>;
  subcommunities: string[];
  buildings: { subcommunity: string; building: string }[];
};

const arr = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

export default function Filters({ sp, subcommunities, buildings }: Props) {
  const ref = useRef<HTMLFormElement>(null);
  const submit = () => ref.current?.requestSubmit();
  const sc = one(sp.sc);
  const bl = buildings.filter((b) => !sc || b.subcommunity === sc);
  const box = (name: string, value: string, label: string) => (
    <label className="cb" key={name + value}>
      <input type="checkbox" name={name} value={value} defaultChecked={arr(sp[name]).includes(value)} onChange={submit} />
      {label}
    </label>
  );
  const flag = (name: string, label: string) => (
    <label className="cb" key={name}>
      <input type="checkbox" name={name} value="1" defaultChecked={!!one(sp[name])} onChange={submit} />
      {label}
    </label>
  );
  return (
    <form ref={ref} className="filters" method="get" action="/">
      <input type="hidden" name="tab" value={one(sp.tab) || 'all'} />
      <input type="hidden" name="sort" value={one(sp.sort) || 'unit'} />
      <div><input id="q" type="search" name="q" placeholder="Search owner, building or unit" defaultValue={one(sp.q)} /></div>
      <div><h3>Sub-community</h3>
        <select id="sc" name="sc" defaultValue={sc} onChange={(e) => { const f = ref.current; if (f) (f.elements.namedItem('bld') as HTMLSelectElement).value = ''; submit(); }}>
          <option value="">All</option>
          {subcommunities.map((s) => <option key={s}>{s}</option>)}
        </select></div>
      <div><h3>Building</h3>
        <select id="bld" name="bld" defaultValue={one(sp.bld)} onChange={submit}>
          <option value="">All</option>
          {bl.map((b) => <option key={b.subcommunity + b.building}>{b.building}</option>)}
        </select></div>
      <div><h3>Lease</h3>{box('st', 'Live Ejari', 'Live Ejari')}{box('st', 'No live Ejari', 'No live Ejari')}{box('st', 'Not confirmed', 'Not confirmed')}</div>
      <div><h3>Contract ends</h3>
        {[['30', 'Within 30 days'], ['90', 'Within 90 days'], ['180', 'Within 6 months'], ['365', 'Within a year'], ['', 'Any time']].map(([v, l]) => (
          <label className="cb" key={v}><input type="radio" name="exp" value={v} defaultChecked={one(sp.exp) === v} onChange={submit} />{l}</label>
        ))}
        <div className="pair" style={{ marginTop: 6 }}>
          <input id="from" type="date" name="from" defaultValue={one(sp.from)} onChange={submit} aria-label="Ends from" />
          <input id="to" type="date" name="to" defaultValue={one(sp.to)} onChange={submit} aria-label="Ends to" />
        </div></div>
      <div><h3>Type</h3>{box('type', 'Apartment', 'Apartment')}{box('type', 'Villa', 'Villa')}</div>
      <div><h3>Beds</h3>{['Studio', '1', '2', '3', '4', '5', '6', '7'].map((b) => box('beds', b, b === 'Studio' ? 'Studio' : `${b} bed`))}</div>
      <div><h3>Size, sq ft</h3><div className="pair"><input id="smin" type="number" name="smin" placeholder="Min" defaultValue={one(sp.smin)} onBlur={submit} /><input id="smax" type="number" name="smax" placeholder="Max" defaultValue={one(sp.smax)} onBlur={submit} /></div></div>
      <div><h3>Rent, AED a year</h3><div className="pair"><input id="rmin" type="number" name="rmin" placeholder="Min" defaultValue={one(sp.rmin)} onBlur={submit} /><input id="rmax" type="number" name="rmax" placeholder="Max" defaultValue={one(sp.rmax)} onBlur={submit} /></div></div>
      <div><h3>Tenancy</h3>{flag('first', 'First year (no renewals)')}{flag('ren2', 'Renewed 2+ times')}{flag('up', 'Rent went up')}{flag('down', 'Rent went down')}</div>
      <div><h3>Last sale price, AED</h3><div className="pair"><input id="pmin" type="number" name="pmin" placeholder="Min" defaultValue={one(sp.pmin)} onBlur={submit} /><input id="pmax" type="number" name="pmax" placeholder="Max" defaultValue={one(sp.pmax)} onBlur={submit} /></div></div>
      <div><h3>Owner</h3>{flag('port', 'Owns 2+ units here')}{flag('mort', 'Mortgaged')}{flag('ind', 'Individuals only')}{flag('phone', 'Has a mobile number')}</div>
      <a className="link" href="/">Clear filters</a>
    </form>
  );
}
