/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Icon, Csrf, fmtDate, fmtTime } from '../ui.js';
import type { activityModel } from '../model.js';
import { UNDOABLE } from '../../pipeline/undo.js';
import { DONE_LABEL as LABEL } from '../terms.js';
import { JOBS } from '../../jobs/schedules.js';

const JOB: Record<string, string> = { manual: 'Run now', overlays: 'Poster overlays', ...Object.fromEntries(Object.entries(JOBS).map(([k, v]) => [k, v.label])) };
const TRIGGER: Record<string, string> = { manual: 'started by hand', schedule: 'on schedule', startup: 'at startup' };


type M = ReturnType<typeof activityModel>;
const took = (ms: number) => { const s = Math.max(1, Math.round(ms / 1000)); return s < 90 ? `${s} s` : `${Math.round(s / 60)} min`; };

/** A run in a few words: only what happened, never a count of zero. */
function runSummary(st: Record<string, number>): string {
  const n = (k: string) => Number(st[k] ?? 0);
  const some = (v: number, one: string, many = `${one}s`) => (v ? `${v} ${v === 1 ? one : many}` : '');
  const parts = [
    some(n('newProposals'), 'new change to approve', 'new changes to approve'),
    some(n('applied'), 'change made', 'changes made'),
    some(n('failed'), 'change failed', 'changes failed'),
    some(n('sourcesFailed'), 'source failing', 'sources failing'),
    some(n('sourcesStale'), 'source on old results', 'sources on old results'),
    some(n('boxSetsRepaired'), 'collection tidied', 'collections tidied'),
    some(n('healthFound') + n('artworkFound'), 'new Library health finding', 'new Library health findings'),
    some(n('artworkAutoFixed'), 'poster fixed', 'posters fixed'),
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Nothing to change';
}

/** The run's log with the clock time in the app's timezone, and only warnings and errors marked. */
function tidyLog(log: string, tz: string): string {
  return log.split('\n').map((line) => {
    const m = line.match(/^(\d{4}-\d\d-\d\dT[\d:.]+Z)\s+(INFO|WARN|ERROR|DEBUG)\s+(.*)$/);
    if (!m) return line;
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(m[1]!));
    return `${time}  ${m[2] === 'WARN' ? 'Warning: ' : m[2] === 'ERROR' ? 'Error: ' : ''}${m[3]}`;
  }).join('\n');
}

export const Activity: FC<{ m: M; tz: string; csrf: string }> = ({ m, tz, csrf }) => (
  <>
    <header class="top"><h1>History</h1></header>
    <div class="content">
      <section aria-labelledby="applied-h">
        <div class="section-head"><h2 id="applied-h">Changes made</h2><span class="aside">last 150</span></div>
        <div class="table-wrap">
          <table class="tt">
            <thead><tr><th scope="col">When</th><th scope="col">Collection</th><th scope="col">Change</th><th scope="col" class="hide-sm">By</th><th scope="col" class="r"><span class="sr">Undo</span></th></tr></thead>
            <tbody>
              {m.applied.length === 0 ? <tr class="empty-row"><td colspan={5}>Nothing changed yet. Changes you approve are listed here, each with an Undo.</td></tr> : null}
              {m.applied.map((a) => (
                <tr>
                  <td class="when">{fmtDate(a.appliedAt ?? a.updatedAt, tz)}<span class="t">{fmtTime(a.appliedAt ?? a.updatedAt, tz)}</span></td>
                  <td>{a.definitionId ? m.defs.get(a.definitionId) ?? '—' : '—'}</td>
                  <td>{a.status === 'failed' ? <span class="chip red">failed</span> : null} {LABEL[a.type] ?? a.type} {a.item?.name ? <b>{a.item.name}</b> : null}{a.undoOf ? <span class="faint"> (undo)</span> : null}{a.error ? <><br /><span class="faint">{a.error}</span></> : null}</td>
                  <td class="hide-sm">{a.decidedBy ?? '—'}</td>
                  <td class="r">
                    {a.status === 'applied' && !a.undoOf && !m.undone.has(a.id) && UNDOABLE.includes(a.type) ? (
                      <form method="post" action={`/activity/${a.id}/undo`} class="inline-form"><Csrf token={csrf} /><button class="btn sm" type="submit"><Icon name="undo" /> Undo</button></form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section aria-labelledby="runs-h">
        <div class="section-head"><h2 id="runs-h">Runs</h2><span class="aside">last 30</span></div>
        <div class="table-wrap">
          <table class="tt">
            <thead><tr><th scope="col">Started</th><th scope="col">Run</th><th scope="col" class="hide-sm">Took</th><th scope="col">Result</th><th scope="col" class="hide-sm">Details</th></tr></thead>
            <tbody>
              {m.runs.length === 0 ? <tr class="empty-row"><td colspan={5}>No runs yet. Use Run now on Home.</td></tr> : null}
              {m.runs.map((r) => (
                <tr>
                  <td class="when">{fmtDate(r.startedAt, tz)}<span class="t">{fmtTime(r.startedAt, tz)}</span></td>
                  <td>{JOB[r.job] ?? r.job}<br /><span class="faint">{TRIGGER[r.trigger] ?? r.trigger}</span></td>
                  <td class="hide-sm num">{r.finishedAt ? took(r.finishedAt - r.startedAt) : '—'}</td>
                  <td>{r.status === 'failed' ? <span class="chip red">failed</span> : r.status === 'running' ? <span class="chip">running</span> : null} {r.status === 'running' ? null : runSummary(r.stats as Record<string, number>)}</td>
                  <td class="hide-sm"><details class="how"><summary>Log</summary><pre class="logbox">{r.log ? tidyLog(r.log, tz) : 'Nothing was logged.'}</pre></details></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </>
);
