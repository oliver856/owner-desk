// The weekly management meeting: the report, the pipelines managers post in the group, and the actions agreed.
// Server side: api/_lib/meeting.js (posts, actions, saved reports) and report() in api/_lib/ask.js.
import React, { useEffect, useRef, useState } from 'react';
import { useOps, Wait, Bar, Section, Two, Btn, LinkBtn, Field, day, clock } from './kit.jsx';
import { Answer, ASK_CSS, printAnswer, downloadTables, tablesIn } from './Ask.jsx';

const CSS = `
.mt-reports{display:flex;flex-direction:column;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.mt-reports button{font:inherit;text-align:left;background:none;border:none;border-bottom:1px solid var(--line);padding:10px 14px;cursor:pointer;color:var(--ink);display:flex;justify-content:space-between;gap:10px}
.mt-reports button:last-child{border-bottom:none} .mt-reports button:hover{background:var(--hover)} .mt-reports button.on{background:color-mix(in srgb,var(--accent) 8%,var(--bg));font-weight:600}
.mt-post{border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-bottom:10px}
.mt-post header{display:flex;justify-content:space-between;gap:10px;margin-bottom:6px}
.mt-post pre{font:inherit;white-space:pre-wrap;margin:0;line-height:1.5}
.mt-paste textarea{width:100%;min-height:120px;font:inherit;border:1px solid var(--line);border-radius:8px;padding:9px 11px;resize:vertical;background:var(--bg);color:var(--ink)}
.mt-act{display:flex;align-items:flex-start;gap:10px;padding:9px 0;border-bottom:1px solid var(--line)}
.mt-act input[type=checkbox]{margin-top:3px} .mt-act .grow{flex:1} .mt-act.done .txt{text-decoration:line-through;color:var(--muted)}
.mt-addact{display:grid;grid-template-columns:minmax(0,1fr) 150px auto;gap:8px;margin-top:12px;align-items:end}
.mt-addact .ops-field:first-child{grid-column:1/-1}
@media (max-width:700px){.mt-addact{grid-template-columns:1fr}}
`;

export default function Meeting({ api, team, teams, all }) {
  const [week, setWeek] = useState('');
  const { d, err, reload } = useOps(api, 'meeting', { week, team });
  const [open, setOpen] = useState(null);     // the report being read: { id, title, answer, at }
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const card = useRef(null);
  const post = (body) => api('/api/ops' + (team ? '?team=' + encodeURIComponent(team) : ''), { method: 'POST', body });
  useEffect(() => { if (d && !open && d.reports[0]) openReport(d.reports[0].id); }, [d?.reports?.[0]?.id]);
  if (!d) return <Wait err={err} />;

  async function openReport(id) {
    try { setOpen(await api('/api/ops?action=report&id=' + id + (team ? '&team=' + encodeURIComponent(team) : ''))); } catch (e) { setMsg(e.message); }
  }
  const make = async (which) => {
    setBusy(which); setMsg('');
    try { await post({ action: 'report', week: which }); reload(); setOpen(null); }
    catch (e) { setMsg(e.message); }
    setBusy('');
  };
  const shift = (n) => { const t = new Date(d.week + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n * 7); setWeek(t.toISOString().slice(0, 10)); };
  const weekLabel = d.week === d.thisWeek ? 'This week' : 'Week of ' + day(d.week);

  return (
    <>
      <style>{ASK_CSS + CSS}</style>
      <Bar note="Everything for the weekly meeting in one place: the report, the pipelines from the group, and the actions agreed." />

      <Section title="Weekly report" aside="Saved here each time one is made">
        <div className="ops-acts" style={{ marginBottom: 12 }}>
          <Btn primary disabled={!!busy} onClick={() => make('last')}>{busy === 'last' ? 'Writing it up…' : 'Make last week\'s report'}</Btn>
          <Btn disabled={!!busy} onClick={() => make('this')}>{busy === 'this' ? 'Writing it up…' : 'This week so far'}</Btn>
          {busy && <span className="muted">This takes a minute or two.</span>}
        </div>
        {msg && <p className="ops-msg err">{msg}</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 260px', gap: 20, alignItems: 'start' }}>
          <div>
            {open ? <div className="ask-card" ref={card}>
              <div className="ask-brand"><b>Apex Homes DXB</b><span>Management report</span></div>
              <div className="ask-q"><b>{open.title.replace(/^Weekly report: /, 'Weekly report, ')}</b></div>
              <Answer text={open.answer} />
              <div className="ask-foot muted"><span>Made {clock(open.at)}</span><span className="grow" />
                <span className="ask-actions" style={{ display: 'flex', gap: 6 }}>
                  {tablesIn(open.answer).length > 0 && <button type="button" className="ask-act" onClick={() => downloadTables({ question: open.title, answer: open.answer })}>Download tables</button>}
                  <button type="button" className="ask-act" onClick={() => printAnswer(card.current)}>Print or save PDF</button>
                </span></div>
            </div> : <p className="muted">{d.reports.length ? 'Choose a report.' : 'No reports yet. Make last week\'s report to start.'}</p>}
          </div>
          {d.reports.length > 0 && <div className="mt-reports">{d.reports.map((r) => (
            <button key={r.id} type="button" className={open?.id === r.id ? 'on' : ''} onClick={() => openReport(r.id)}>
              <span>{r.title.replace(/^Weekly report: /, '')}</span></button>))}
          </div>}
        </div>
      </Section>

      <Two>
        <Section title={'Pipeline · ' + weekLabel} aside={<><LinkBtn onClick={() => shift(-1)}>← Earlier</LinkBtn>{d.week !== d.thisWeek && <LinkBtn onClick={() => shift(1)}>Later →</LinkBtn>}</>}>
          <Paste teams={teams} all={all} team={team || d.team} onSave={async (b) => { await post({ action: 'pipeline-add', week: d.week, ...b }); reload(); }} />
          <div style={{ marginTop: 12 }}>
            {d.posts.length === 0 ? <p className="muted">Nothing posted for this week yet.</p> : d.posts.map((p) => (
              <div className="mt-post" key={p.id}>
                <header><b>{p.team || 'No team'}</b><span className="muted">{p.by} · {clock(p.at)}{(p.mine || d.all) && <> · <LinkBtn onClick={async () => { if (window.confirm('Remove this pipeline post?')) { await post({ action: 'pipeline-remove', id: p.id }); reload(); } }}>Remove</LinkBtn></>}</span></header>
                <pre>{p.body}</pre>
              </div>))}
          </div>
        </Section>

        <Section title="Actions" aside="Agreed in the meeting, checked at the next one">
          {d.actions.length === 0 ? <p className="muted">No actions yet.</p> : d.actions.map((a) => (
            <div key={a.id} className={'mt-act' + (a.done_at ? ' done' : '')}>
              <input type="checkbox" checked={!!a.done_at} onChange={async (e) => { await post({ action: 'action-done', id: a.id, done: e.target.checked }); reload(); }} />
              <div className="grow"><div className="txt">{a.body}</div>
                <span className="muted">{[a.owner, a.due ? 'by ' + day(a.due) : '', 'agreed w/c ' + day(a.week)].filter(Boolean).join(' · ')}</span></div>
              <LinkBtn onClick={async () => { if (window.confirm('Remove this action?')) { await post({ action: 'action-remove', id: a.id }); reload(); } }}>Remove</LinkBtn>
            </div>))}
          <AddAction onSave={async (b) => { await post({ action: 'action-add', ...b }); reload(); }} />
        </Section>
      </Two>
    </>
  );
}

function Paste({ teams, all, team, onSave }) {
  const [body, setBody] = useState('');
  const [t, setT] = useState(team || '');
  const [s, setS] = useState({ saving: false, err: '' });
  useEffect(() => { setT(team || ''); }, [team]);
  const save = async () => {
    if (!body.trim()) return;
    setS({ saving: true, err: '' });
    try { await onSave({ body, team: t }); setBody(''); setS({ saving: false, err: '' }); } catch (e) { setS({ saving: false, err: e.message }); }
  };
  return (
    <div className="mt-paste">
      <textarea placeholder="Paste the pipeline message from the group here" value={body} maxLength={6000} onChange={(e) => setBody(e.target.value)} />
      <div className="ops-acts" style={{ marginTop: 8 }}>
        {all ? <select className="ops-pick" value={t} onChange={(e) => setT(e.target.value)} style={{ font: 'inherit', padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)' }}>
          <option value="">Which team?</option>{teams.map((x) => <option key={x} value={x}>{x}</option>)}</select> : <span className="muted">{team}</span>}
        <Btn primary disabled={s.saving || !body.trim() || (all && !t)} onClick={save}>{s.saving ? 'Saving…' : 'Add to this week'}</Btn>
        {s.err && <span className="err">{s.err}</span>}
      </div>
    </div>);
}

function AddAction({ onSave }) {
  const [f, setF] = useState({ body: '', owner: '', due: '' });
  const [s, setS] = useState({ saving: false, err: '' });
  const save = async () => {
    if (!f.body.trim()) return;
    setS({ saving: true, err: '' });
    try { await onSave(f); setF({ body: '', owner: '', due: '' }); setS({ saving: false, err: '' }); } catch (e) { setS({ saving: false, err: e.message }); }
  };
  return (
    <form className="mt-addact ops-form" style={{ border: 'none', padding: 0 }} onSubmit={(e) => { e.preventDefault(); save(); }}>
      <Field label="New action"><input value={f.body} maxLength={500} placeholder="What needs doing" onChange={(e) => setF({ ...f, body: e.target.value })} /></Field>
      <Field label="Owner"><input value={f.owner} maxLength={80} onChange={(e) => setF({ ...f, owner: e.target.value })} /></Field>
      <Field label="By"><input type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></Field>
      <button type="submit" className="ops-btn primary" disabled={s.saving || !f.body.trim()}>Add</button>
      {s.err && <span className="err" style={{ gridColumn: '1/-1' }}>{s.err}</span>}
    </form>);
}
