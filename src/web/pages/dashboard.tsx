/** @jsxImportSource hono/jsx */
import type { FC } from 'hono/jsx';
import { Icon, Dot, fmtDate, fmtTime, fmtAgo, plural } from '../ui.js';
import type { dashboardModel } from '../model.js';
import { RunProgress } from './run-progress.js';

type M = ReturnType<typeof dashboardModel>;

export const Dashboard: FC<{ m: M; csrf: string }> = ({ m, csrf }) => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const year = new Date(m.now).getUTCFullYear();
  const todayPct = ((m.today - Date.UTC(year, 0, 1) / 86_400_000 + 0.5) / (Date.UTC(year + 1, 0, 1) / 86_400_000 - Date.UTC(year, 0, 1) / 86_400_000)) * 100;
  const nextAt = m.next[0]?.at;
  const daysAway = nextAt ? Math.max(0, Math.round((nextAt - m.now) / 86_400_000)) : null;
  const creates = m.next.filter((c) => c.kind === 'opens' && m.plannedMembers(c.def.id) >= c.def.minItems).length;
  const deletes = m.next.filter((c) => c.kind === 'closes' && m.liveIds.has(c.def.id)).length;
  const nextPending = m.needs.filter((n) => m.next.some((c) => c.def.id === n.def.id)).reduce((s, n) => s + n.total, 0);
  let lastMonth = '';
  return (
    <>
      <header class="top">
        <h1>Dashboard</h1>
        <div class="actions">
          <span class="clock num">{fmtDate(m.now, m.tz, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · {fmtTime(m.now, m.tz)}</span>
          <RunProgress p={m.progress} csrf={csrf} />
        </div>
      </header>
      <div class="content">
        {!m.configured ? (
          <div class="empty"><h3>Jellyfin isn’t connected</h3><p>Add its address and an API key in Settings, then run once.</p><a class="btn primary" href="/settings">Open Settings</a></div>
        ) : null}
        <div class="answers">
          <section class="panel needs" aria-labelledby="needs-h">
            <div class="section-head"><h2 id="needs-h">Needs you</h2></div>
            {m.pendingTotal === 0 ? (
              <p class="lead">Nothing waits for review.</p>
            ) : (
              <>
                <p class="lead"><b class="num">{plural(m.pendingTotal, 'proposal')}</b> wait in Review across {plural(m.needs.length, 'collection')}.</p>
                <ul class="rows">
                  {m.needs.slice(0, 6).map((n) => (
                    <li>
                      <a href={`/review?def=${n.def.id}`}>{n.def.name}</a>
                      <span class="faint">{[n.add && `${n.add} add`, n.remove && `${n.remove} remove`, n.suggested && `${n.suggested} suggested`, n.other && `${n.other} other`].filter(Boolean).join(' · ')}</span>
                      <span class="n num">{n.total}</span>
                    </li>
                  ))}
                </ul>
                <a class="btn" href="/review">Open Review queue</a>
              </>
            )}
          </section>

          <section class="panel" aria-labelledby="svc-h">
            <div class="section-head"><h2 id="svc-h">Service notices</h2><span class="aside">{m.failing.length} failing · {m.stale.length} from cache · {m.healthyCount} OK</span></div>
            {m.server && m.server.level !== 'verified' ? (
              <div class="notice"><Dot state={m.server.level === 'unsupported' ? 'err' : 'warn'} label={m.server.level} /><b>Jellyfin {m.server.version}</b><p>{m.server.note}</p></div>
            ) : null}
            {m.autoCollections.length ? (
              <div class="notice"><Dot state="err" label="Risk" /><b>Jellyfin makes its own box sets in {m.autoCollections.join(', ')}</b><p>“Automatically add to collection” is on there. Jellyfin creates those box sets unlocked and finds their artwork with a TMDb name search, which can pick the wrong collection and show another collection’s poster and backdrop. Turn it off in Jellyfin: Dashboard → Libraries, open the library’s menu → Manage library, and untick “Automatically add to collection”.</p></div>
            ) : null}
            {m.integrity.filter((e) => !e.ok).map((e) => (
              <div class="notice"><Dot state="err" label="Repair failed" /><b>{e.name}: box set check failed</b><p>{e.what} The next run tries again. ({fmtAgo(e.at, m.now)})</p></div>
            ))}
            {m.integrity.some((e) => e.ok) ? (
              <div class="notice"><Dot state="warn" label="Repaired" /><b>{plural(new Set(m.integrity.filter((e) => e.ok).map((e) => e.definitionId)).size, 'box set')} repaired this week</b>
                <p>Something other than this app changed their TMDb link, lock or artwork; each was put back as soon as it was found.</p>
                <ul class="plain-list">{m.integrity.filter((e) => e.ok).slice(0, 10).map((e) => <li><b>{e.name}</b> <span class="faint">{fmtAgo(e.at, m.now)}</span><br />{e.what}</li>)}</ul>
              </div>
            ) : null}
            {m.waitingForAdoption ? (
              <div class="notice"><Dot state="warn" label="Waiting" /><b>{m.waitingForAdoption} {m.waitingForAdoption === 1 ? 'collection has' : 'collections have'} a box set to adopt</b><p>Jellyfin already has a matching box set, so nothing new is created until you adopt it (or delete it) on <a href="/adoption">Existing box sets</a>.</p></div>
            ) : null}
            {m.hashError ? (
              <div class="notice"><Dot state="err" label="Failing" /><b>IMDb query hashes</b><p>{m.hashError}. IMDb sources are served from their last good results until the published hashes are updated.</p></div>
            ) : null}
            {m.failing.map((s) => (
              <div class="notice"><Dot state="err" label="Failing" /><b>{s.label}</b><p>{s.error} No previous result, so its collections make no removals or deletes until it recovers.</p></div>
            ))}
            {m.stale.map((s) => (
              <div class="notice"><Dot state="warn" label="Served from cache" /><b>{s.label}</b><p>{s.error} Serving the last good result from {fmtAgo(s.lastGoodAt, m.now)}. Nothing is removed while a source fails.</p></div>
            ))}
            {!m.failing.length && !m.stale.length && !m.hashError ? (
              <div class="notice ok"><Dot state="ok" label="OK" /><b>All sources answered</b><p>{m.healthyCount ? `${plural(m.healthyCount, 'source')} fetched without errors.` : 'No sources fetched yet.'}</p></div>
            ) : null}
            <dl class="kv lastrun">
              <dt>Last run</dt>
              <dd class="num">{m.lastRun ? <>{fmtDate(m.lastRun.startedAt, m.tz)} {fmtTime(m.lastRun.startedAt, m.tz)} · {m.lastRun.status === 'failed' ? 'failed' : `${m.lastRun.stats.planned ?? 0} planned, ${m.lastRun.stats.applied ?? 0} applied, ${m.lastRun.stats.newProposals ?? 0} new to review`} · <a href="/activity">log</a></> : 'No runs yet'}</dd>
            </dl>
          </section>

          <section class="next-panel" aria-labelledby="next-h">
            <div class="section-head"><h2 id="next-h">Next change</h2>{daysAway !== null ? <span class="aside">in {plural(daysAway, 'day')}</span> : null}</div>
            {nextAt ? (
              <>
                <p class="dep"><span class="d">{fmtDate(nextAt, m.tz)}</span><span class="t num">{fmtTime(nextAt, m.tz)}</span></p>
                <ul class="rows">
                  {m.next.map((c) => (
                    <li>
                      <span class={c.kind === 'opens' ? 'chg-open' : 'chg-close'}>{c.kind}</span>
                      <span>{c.def.name}</span>
                      <span class="n num">{c.kind === 'opens' || !m.liveIds.has(c.def.id) ? m.plannedMembers(c.def.id) : m.members.get(c.def.id) ?? 0}</span>
                    </li>
                  ))}
                </ul>
                <p class="plan">Plan: create {plural(creates, 'box set')}, delete {deletes}.{nextPending ? ` ${nextPending} still need your review.` : ''}</p>
                <a class="btn on-yellow" href="/review"><Icon name="eye" /> Review the plan</a>
              </>
            ) : (
              <p class="plan">No windows are scheduled.</p>
            )}
          </section>
        </div>

        <section aria-labelledby="year-h" class="year-wrap">
          <div class="section-head"><h2 id="year-h">{year} at a glance</h2><span class="aside">{m.strip.bars.length ? `windows flip at midnight, ${m.tz}` : ''}</span></div>
          <div class="hide-sm">
            <div class="year" role="group" aria-label={`Seasonal windows in ${year}`}>
              <div class="months" aria-hidden="true">{months.map((mo) => <span>{mo}</span>)}</div>
              <div class="lanes" style={`height:${m.strip.lanes * 24 + 10}px`}>
                {m.strip.bars.map((b) => (
                  <a class={`w ${b.state}`} href={b.href} style={`left:${b.left.toFixed(3)}%;width:${b.width.toFixed(3)}%;top:${b.lane * 24 + 6}px`} title={b.tip} aria-label={b.tip}>{b.label}</a>
                ))}
                <span class="today" style={`left:${todayPct.toFixed(3)}%`}><b>Today · {fmtDate(m.now, m.tz, { day: 'numeric', month: 'short' })}</b></span>
              </div>
            </div>
            <div class="legend" aria-hidden="true"><span><i class="live"></i>Live now</span><span><i class="next"></i>Opens next</span><span><i></i>Scheduled</span><span><i class="short"></i>Short window (name on hover)</span></div>
          </div>
          <ul class="rows year-phone show-sm" aria-label="Now and next">
            {m.timetable.slice(0, 5).map((c) => (
              <li><span class={`dot ${c.kind === 'opens' ? 'warn' : 'live'}`}></span><span>{c.kind === 'opens' ? 'Opens' : 'Closes'}: {c.def.name}</span><span class="n num">{fmtDate(c.at, m.tz)}</span></li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="tt-h">
          <div class="section-head"><h2 id="tt-h">Upcoming changes</h2><span class="aside">next 120 days</span></div>
          <div class="table-wrap">
            <table class="tt">
              <thead><tr><th scope="col">Date</th><th scope="col">Change</th><th scope="col">Collection</th><th scope="col" class="hide-sm drop-2">Via</th><th scope="col" class="hide-sm">Remarks</th></tr></thead>
              <tbody>
                {m.timetable.length === 0 ? <tr class="empty-row"><td colspan={5}>No window changes in the next 120 days.</td></tr> : null}
                {m.timetable.map((c) => {
                  const month = fmtDate(c.at, m.tz, { month: 'long', year: 'numeric' });
                  const band = month !== lastMonth ? (lastMonth = month) : null;
                  const isNext = c.day === m.next[0]?.day;
                  return (
                    <>
                      {band ? <tr class="band"><th colspan={5} scope="rowgroup">{band}</th></tr> : null}
                      <tr class={isNext ? 'next' : ''}>
                        <td class="when">{fmtDate(c.at, m.tz)}<span class="t">{fmtTime(c.at, m.tz)}</span></td>
                        <td class="chg"><span class={c.kind === 'opens' ? 'chg-open' : 'chg-close'}>{c.kind}</span></td>
                        <td class="coll"><a href={`/collections/${c.def.id}`}>{c.def.name}</a></td>
                        <td class="hide-sm drop-2">{c.via || '—'}</td>
                        <td class="rmk hide-sm">{c.failing.length ? <><Dot state={c.failing.some((f) => f.status === 'failed') ? 'err' : 'warn'} label="Source problem" /> {c.failing.map((f) => f.label).join(', ')} · </> : null}{c.remarks}</td>
                      </tr>
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
};
