/** @jsxImportSource hono/jsx */
import type { Child, FC } from 'hono/jsx';
import { Icon, Dot, Csrf, fmtDate, fmtTime, fmtAgo, plural } from '../ui.js';
import type { dashboardModel } from '../model.js';
import { RunProgress } from './run-progress.js';
import { APPROVAL_ROWS, DATE_CHANGE, whenNext } from '../terms.js';

type M = ReturnType<typeof dashboardModel>;

/** One notice: what it is in a line, with the steps to fix it folded away. */
const Notice: FC<{ state: 'ok' | 'warn' | 'err'; label: string; title: Child; line?: Child; fix?: Child; children?: Child }> = ({ state, label, title, line, fix, children }) => (
  <div class={`notice${state === 'ok' ? ' ok' : ''}`}>
    <Dot state={state} label={label} /><b>{title}</b>
    {line ? <p>{line}</p> : null}
    {children}
    {fix ? <details class="how"><summary>How to fix</summary><p>{fix}</p></details> : null}
  </div>
);

/**
 * Shown once on Home, after the first approved change: the one place a new user meets Automatic. Until then every
 * change waits for approval, and nothing about approvals needs learning.
 */
export const AutomaticOffer: FC<{ m: M; csrf: string }> = ({ m, csrf }) => {
  const auto = APPROVAL_ROWS.filter(([t]) => m.modes[t] === 'auto').map(([, l]) => l.charAt(0).toLowerCase() + l.slice(1));
  return (
    <div class="banner offer" role="region" aria-label="Automatic changes">
      <span><b>Let routine changes happen by themselves?</b> You’ve approved your first changes. From now on the app can {auto.length ? auto.slice(0, 3).join(', ') : 'make the changes you choose'} without asking; everything else still waits in your Inbox. You can change this any time in Settings → Approvals.</span>
      <form method="post" action="/start/automatic" class="offer-actions">
        <Csrf token={csrf} />
        <button class="btn sm on-yellow" type="submit" name="choice" value="yes">Yes, automatically</button>
        <button class="btn sm" type="submit" name="choice" value="no">Keep asking me</button>
      </form>
    </div>
  );
};

export const Dashboard: FC<{ m: M; csrf: string }> = ({ m, csrf }) => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const year = new Date(m.now).getUTCFullYear();
  const todayPct = ((m.today - Date.UTC(year, 0, 1) / 86_400_000 + 0.5) / (Date.UTC(year + 1, 0, 1) / 86_400_000 - Date.UTC(year, 0, 1) / 86_400_000)) * 100;
  const nextAt = m.next[0]?.at;
  const daysAway = nextAt ? Math.max(0, Math.round((nextAt - m.now) / 86_400_000)) : null;
  const creates = m.next.filter((c) => c.kind === 'opens' && m.plannedMembers(c.def.id) >= c.def.minItems).length;
  const deletes = m.next.filter((c) => c.kind === 'closes' && m.liveIds.has(c.def.id)).length;
  const nextPending = m.needs.filter((n) => m.next.some((c) => c.def.id === n.def.id)).reduce((s, n) => s + n.total, 0);
  const running = m.progress?.status === 'running';
  const firstRun = !m.lastRun;
  const nextRun = whenNext(m.nextRunAt, m.tz, m.now);
  const needsAnything = m.pendingTotal > 0 || m.healthOpen > 0 || m.waitingForAdoption > 0;
  const failedRepairs = m.integrity.filter((e) => !e.ok);
  const repaired = m.integrity.filter((e) => e.ok);
  const serverBad = m.server?.level === 'unsupported';
  const problems = m.failing.length + m.stale.length + failedRepairs.length + (m.hashError ? 1 : 0) + (serverBad ? 1 : 0);
  const advice = m.autoCollections.length || m.imageFetcherRisks.length || m.audioPrefRisks.length || repaired.length || (m.server && m.server.level !== 'verified' && !serverBad);
  const showVia = m.timetable.some((c) => c.via);
  const cols = showVia ? 5 : 4;
  let lastMonth = '';
  return (
    <>
      <header class="top">
        <h1>Home</h1>
        <div class="actions">
          <span class="clock num">{fmtDate(m.now, m.tz, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })} · {fmtTime(m.now, m.tz)}</span>
          <RunProgress p={m.progress} csrf={csrf} />
        </div>
      </header>
      <div class="content">
        {!m.configured ? (
          <div class="empty"><h3>Jellyfin isn’t connected</h3><p>Add its address and an API key, then start a run.</p><a class="btn primary" href="/settings">Open Settings</a></div>
        ) : null}
        <div class="answers">
          <section class="panel needs" aria-labelledby="needs-h">
            <div class="section-head"><h2 id="needs-h">Needs you</h2></div>
            {!needsAnything ? (
              firstRun
                ? <p class="lead">{running ? 'The first run is reading your library and lists. Changes to approve appear here when it finishes.' : 'Nothing yet. Start your first run to see what the app would change.'}</p>
                : <p class="lead">You’re all caught up.{nextRun ? ` Next run: ${nextRun}.` : ''}</p>
            ) : (
              <>
                {m.pendingTotal ? (
                  <>
                    <p class="lead"><b class="num">{plural(m.pendingTotal, 'change')}</b> to approve across {plural(m.needs.length, 'collection')}.</p>
                    <ul class="rows">
                      {m.needs.slice(0, 6).map((n) => (
                        <li>
                          <a href={`/review?def=${n.def.id}`}>{n.def.name}</a>
                          <span class="faint">{[n.add && `${n.add} to add`, n.remove && `${n.remove} to remove`, n.suggested && `${n.suggested} suggested`, n.other && `${n.other} other`].filter(Boolean).join(' · ')}</span>
                          <span class="n num">{n.total}</span>
                        </li>
                      ))}
                    </ul>
                    <a class="btn primary" href="/review">Open Inbox</a>
                  </>
                ) : null}
                {m.healthOpen || m.waitingForAdoption ? (
                  <ul class="rows also">
                    {m.healthOpen ? <li><a href="/health">Library health</a><span class="faint">files or posters that don’t match their title</span><span class="n num">{m.healthOpen}</span></li> : null}
                    {m.waitingForAdoption ? <li><a href="/adoption">Already in Jellyfin</a><span class="faint">collections that exist there under the same name; take them over or delete them</span><span class="n num">{m.waitingForAdoption}</span></li> : null}
                  </ul>
                ) : null}
              </>
            )}
          </section>

          <section class="panel" aria-labelledby="svc-h">
            <div class="section-head"><h2 id="svc-h">Problems</h2><span class="aside">{problems ? plural(problems, 'problem') : 'none'}{m.healthyCount ? ` · ${plural(m.healthyCount, 'source')} OK` : ''}</span></div>
            {serverBad && m.server ? <Notice state="err" label="Unsupported" title={`Jellyfin ${m.server.version}`} line={m.server.note} /> : null}
            {failedRepairs.map((e) => (
              <Notice state="err" label="Repair failed" title={`${e.name}: couldn’t be put right`} line={<>{e.what} The next run tries again. ({fmtAgo(e.at, m.now)})</>} />
            ))}
            {m.hashError ? <Notice state="err" label="Failing" title="IMDb can’t be read" line={<>{m.hashError}. IMDb lists keep their last good results until this recovers.</>} /> : null}
            {m.failing.map((s) => (
              <Notice state="err" label="Failing" title={s.label} line={<>{s.error} It has never answered, so nothing is removed from its collections until it does.</>} />
            ))}
            {m.stale.map((s) => (
              <Notice state="warn" label="Using last good results" title={s.label} line={<>{s.error} Using its last good results, from {fmtAgo(s.lastGoodAt, m.now)}. Nothing is removed while a source fails.</>} />
            ))}
            {!problems ? (
              <Notice state="ok" label="OK" title={m.healthyCount ? 'Every source answered' : 'Nothing read yet'} line={m.healthyCount ? `${plural(m.healthyCount, 'source')} read without errors.` : 'Sources are read on the first run.'} />
            ) : null}

            {advice ? (
              <div class="advice">
                <h3>Recommendations</h3>
                <p class="faint">Nothing here is broken. These are settings in Jellyfin worth a look.</p>
                {m.server && m.server.level !== 'verified' && !serverBad ? <Notice state="warn" label={m.server.level} title={`Jellyfin ${m.server.version}`} line={m.server.note} /> : null}
                {m.autoCollections.length ? (
                  <Notice state="warn" label="Recommendation" title={`Jellyfin makes its own collections in ${m.autoCollections.join(', ')}`}
                    line="They can pick up the wrong poster and backdrop."
                    fix="“Automatically add to collection” is on there. Jellyfin finds artwork for those collections with a TMDb name search, which can pick another collection’s poster and backdrop. In Jellyfin: Dashboard → Libraries, open the library’s menu → Manage library, and untick “Automatically add to collection”." />
                ) : null}
                {m.imageFetcherRisks.length ? (
                  <Notice state="warn" label="Recommendation" title={`Jellyfin can take posters from the video itself in ${m.imageFetcherRisks.map((r) => r.library).join(', ')}`}
                    line="A random frame, or a picture inside a mislabelled file, can end up as a poster."
                    fix={<>{m.imageFetcherRisks.map((r) => `${r.library}: ${r.fetchers.join(' and ')}`).join('; ')} {m.imageFetcherRisks.length === 1 ? 'is' : 'are'} on as an image fetcher for movies or shows. In Jellyfin: Dashboard → Libraries, open the library’s menu → Manage library, and untick them under Image fetchers for Movie, Series and Season (episode stills are fine). <a href="/health">Library health</a> lists posters that look like they came from the video or file.</>} />
                ) : null}
                {m.audioPrefRisks.length ? (
                  <Notice state="warn" label="Recommendation" title={m.audioPrefRisks.length === 1 ? `${m.audioPrefRisks[0]!.user} may hear a dub` : `${m.audioPrefRisks.length} Jellyfin users may hear a dub`}
                    line="A file whose default audio is another language plays in that language."
                    fix={<>{m.audioPrefRisks.map((u) => `${u.user}: ${u.why}`).join('; ')}. In Jellyfin, each user can set Settings → Playback → Preferred audio language, and untick “Play default audio track regardless of language”. <a href="/health">Library health</a> lists the files.</>} />
                ) : null}
                {repaired.length ? (
                  <Notice state="ok" label="Repaired" title={`${plural(new Set(repaired.map((e) => e.definitionId)).size, 'collection')} put right this week`}
                    line="Something other than this app changed their TMDb link, lock or artwork; each was put back as soon as it was found.">
                    <details class="how"><summary>What was changed</summary><ul class="plain-list">{repaired.slice(0, 10).map((e) => <li><b>{e.name}</b> <span class="faint">{fmtAgo(e.at, m.now)}</span><br />{e.what}</li>)}</ul></details>
                  </Notice>
                ) : null}
              </div>
            ) : null}
            <dl class="kv lastrun">
              <dt>Last run</dt>
              <dd class="num">{m.lastRun ? <>{fmtDate(m.lastRun.startedAt, m.tz)} {fmtTime(m.lastRun.startedAt, m.tz)} · {m.lastRun.status === 'failed' ? 'failed' : `${m.lastRun.stats.applied ?? 0} applied, ${m.lastRun.stats.newProposals ?? 0} new to approve`} · <a href="/activity">History</a></> : running ? 'Running now' : 'No runs yet'}</dd>
              {nextRun ? <><dt>Next run</dt><dd class="num">{nextRun}</dd></> : null}
            </dl>
          </section>

          {firstRun ? (
            <section class="next-panel" aria-labelledby="next-h">
              <div class="section-head"><h2 id="next-h">{running ? 'First run in progress' : 'Start your first run'}</h2></div>
              <p class="plan">{running
                ? 'The app is reading your library and every list. This can take a few minutes. Nothing changes in Jellyfin: what it would do will wait in your Inbox.'
                : 'The first run reads your library and every list, and works out what it would change. It can take a few minutes. Nothing changes in Jellyfin until you approve it.'}</p>
              {running ? <a class="btn on-yellow" href="/review">Open Inbox</a> : (
                <form method="post" action="/runs"><Csrf token={csrf} /><button class="btn on-yellow" type="submit"><Icon name="play" /> Run now</button></form>
              )}
            </section>
          ) : (
            <section class="next-panel" aria-labelledby="next-h">
              <div class="section-head"><h2 id="next-h">Next change</h2>{daysAway !== null ? <span class="aside">{daysAway === 0 ? 'today' : `in ${plural(daysAway, 'day')}`}</span> : null}</div>
              {nextAt ? (
                <>
                  <p class="dep"><span class="d">{fmtDate(nextAt, m.tz)}</span><span class="t num">{fmtTime(nextAt, m.tz)}</span></p>
                  <ul class="rows">
                    {m.next.map((c) => (
                      <li>
                        <span class={c.kind === 'opens' ? 'chg-open' : 'chg-close'}>{DATE_CHANGE[c.kind]}</span>
                        <a href={`/collections/${c.def.id}`}>{c.def.name}</a>
                        <span class="n num" title="Titles">{c.kind === 'opens' || !m.liveIds.has(c.def.id) ? m.plannedMembers(c.def.id) : m.members.get(c.def.id) ?? 0}</span>
                      </li>
                    ))}
                  </ul>
                  <p class="plan">On this date: {plural(creates, 'collection')} created in Jellyfin, {deletes} removed.{nextPending ? ` ${plural(nextPending, 'change')} still ${nextPending === 1 ? 'needs' : 'need'} your approval.` : ''}</p>
                  {nextPending ? <a class="btn on-yellow" href="/review"><Icon name="check" /> Approve {plural(nextPending, 'change')}</a> : null}
                </>
              ) : (
                <p class="plan">No collection has dates coming up.</p>
              )}
            </section>
          )}
        </div>

        <section aria-labelledby="year-h" class="year-wrap">
          <div class="section-head"><h2 id="year-h">{year} at a glance</h2><span class="aside">{m.strip.bars.length ? `collections appear and go away at midnight, ${m.tz}` : ''}</span></div>
          <div class="hide-sm">
            <div class="year" role="group" aria-label={`Seasonal collections in ${year}`}>
              <div class="months" aria-hidden="true">{months.map((mo) => <span>{mo}</span>)}</div>
              <div class="lanes" style={`height:${m.strip.lanes * 24 + 10}px`}>
                {m.strip.bars.map((b) => (
                  <a class={`w ${b.state}`} href={b.href} style={`left:${b.left.toFixed(3)}%;width:${b.width.toFixed(3)}%;top:${b.lane * 24 + 6}px`} title={b.tip} aria-label={b.tip}>{b.label}</a>
                ))}
                <span class="today" style={`left:${todayPct.toFixed(3)}%`}><b>Today · {fmtDate(m.now, m.tz, { day: 'numeric', month: 'short' })}</b></span>
              </div>
            </div>
            <div class="legend" aria-hidden="true"><span><i class="live"></i>Live now</span><span><i class="next"></i>Appears next</span><span><i></i>Later</span><span><i class="short"></i>A few days only (name on hover)</span></div>
          </div>
          <ul class="rows year-phone show-sm" aria-label="Now and next">
            {m.timetable.slice(0, 5).map((c) => (
              <li><span class={`dot ${c.kind === 'opens' ? 'warn' : 'live'}`}></span><span>{c.def.name} {DATE_CHANGE[c.kind]}</span><span class="n num">{fmtDate(c.at, m.tz)}</span></li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="tt-h">
          <div class="section-head"><h2 id="tt-h">Upcoming changes</h2><span class="aside">next 120 days</span></div>
          <div class="table-wrap">
            <table class="tt">
              <thead><tr><th scope="col">Date</th><th scope="col">Change</th><th scope="col">Collection</th>{showVia ? <th scope="col" class="hide-sm drop-2">From</th> : null}<th scope="col" class="hide-sm">Details</th></tr></thead>
              <tbody>
                {m.timetable.length === 0 ? <tr class="empty-row"><td colspan={cols}>No collection appears or goes away in the next 120 days.</td></tr> : null}
                {m.timetable.map((c) => {
                  const month = fmtDate(c.at, m.tz, { month: 'long', year: 'numeric' });
                  const band = month !== lastMonth ? (lastMonth = month) : null;
                  const isNext = c.day === m.next[0]?.day;
                  return (
                    <>
                      {band ? <tr class="band"><th colspan={cols} scope="rowgroup">{band}</th></tr> : null}
                      <tr class={isNext ? 'next' : ''}>
                        <td class="when">{fmtDate(c.at, m.tz)}<span class="t">{fmtTime(c.at, m.tz)}</span></td>
                        <td class="chg"><span class={c.kind === 'opens' ? 'chg-open' : 'chg-close'}>{DATE_CHANGE[c.kind]}</span></td>
                        <td class="coll"><a href={`/collections/${c.def.id}`}>{c.def.name}</a></td>
                        {showVia ? <td class="hide-sm drop-2">{c.via || '—'}</td> : null}
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
