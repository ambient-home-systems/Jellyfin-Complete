/** @jsxImportSource hono/jsx */
// Library health (ADR-041): a dashboard of how much of the library has been checked against its titles, what needs
// review, and what's been reviewed. Read-only: the app never moves or deletes a file; "It's fine" hides a finding until
// the file changes, and "Review again" puts it back.
import type { FC } from 'hono/jsx';
import { Csrf, fmtDate, fmtTime, plural } from '../ui.js';
import type { HealthDashboard, HealthRow } from '../../library/health.js';

const KIND: Record<HealthRow['kind'], string> = { runtime: 'Length', title: 'Title tag' };
const pct = (a: number, b: number) => (b ? Math.floor((a / b) * 100) : 0);

export const HealthPage: FC<{ m: HealthDashboard; tz: string; csrf: string }> = ({ m, tz, csrf }) => (
  <>
    <header class="top">
      <h1>Library health</h1>
      <span class="aside faint">{m.lastChecked ? `Last checked ${fmtDate(m.lastChecked, tz)} · ${fmtTime(m.lastChecked, tz)}` : 'Not checked yet'}</span>
    </header>
    <div class="content">
      <p class="lead">
        Films and episodes whose file may not be what it says: it runs much longer or shorter than TMDb’s runtime (more than 12 minutes or 15%, whichever is larger), or a title tag inside it names another title.
        Check each one by playing it. The app never moves or deletes files.
      </p>
      {!m.enabled ? <p class="callout">The check is off (Settings → Run and review → Library health), so nothing new is checked or found.</p> : null}

      <div class="answers health-sum">
        <section class="panel" aria-labelledby="hs-need">
          <div class="section-head"><h2 id="hs-need">Needs review</h2></div>
          <p class="lead"><b class={`num big${m.needsReview ? ' bad' : ''}`}>{m.needsReview}</b> {m.needsReview === 1 ? 'file' : 'files'}</p>
          <p class="faint">{m.needsReview ? [m.byKind.runtime && `${m.byKind.runtime} by length`, m.byKind.title && `${m.byKind.title} by title tag`].filter(Boolean).join(' · ') : 'Nothing waits for you.'}</p>
          {m.needsReview ? <p><a href="#needs-h">See them</a></p> : null}
        </section>
        <section class="panel" aria-labelledby="hs-done">
          <div class="section-head"><h2 id="hs-done">Reviewed</h2></div>
          <p class="lead"><b class="num big">{m.reviewed}</b> marked fine</p>
          <p class="faint">Each stays hidden until its file changes.</p>
          {m.reviewed ? <p><a href="#done-h">See them</a></p> : null}
        </section>
        <section class="panel" aria-labelledby="hs-cov">
          <div class="section-head"><h2 id="hs-cov">Checked</h2></div>
          <p class="lead"><b class="num big">{pct(m.checked, m.files)}%</b> of {plural(m.files, 'file')}</p>
          <progress class="meter" max={Math.max(m.files, 1)} value={m.checked} aria-label="Files checked">{pct(m.checked, m.files)}%</progress>
          <p class="faint">
            {m.checked.toLocaleString('en-US')} checked{m.waiting ? `, ${m.waiting.toLocaleString('en-US')} still to check (a few thousand a night)` : ''}.
            {m.compared !== null ? ` ${m.compared.toLocaleString('en-US')} had a TMDb runtime to compare; the rest are checked by title tags only.` : ''}
          </p>
        </section>
      </div>

      {m.byLibrary.length ? (
        <section class="panel" aria-labelledby="lib-h">
          <div class="section-head"><h2 id="lib-h">By library</h2></div>
          <table class="tt" aria-labelledby="lib-h">
            <thead><tr><th scope="col">Library</th><th scope="col" class="num">Files</th><th scope="col" class="num">Checked</th><th scope="col" class="num">Needs review</th><th scope="col" class="num">Reviewed</th></tr></thead>
            <tbody>
              {m.byLibrary.map((b) => (
                <tr>
                  <td><b>{b.library}</b></td>
                  <td class="num">{b.files.toLocaleString('en-US')}</td>
                  <td class="num">{b.checked.toLocaleString('en-US')} <span class="faint">({pct(b.checked, b.files)}%)</span></td>
                  <td class="num">{b.needsReview ? <b class="bad">{b.needsReview}</b> : '0'}</td>
                  <td class="num">{b.reviewed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section class="panel" aria-labelledby="needs-h">
        <div class="section-head"><h2 id="needs-h">Needs review</h2><span class="aside">{plural(m.open.length, 'file')}</span></div>
        {m.open.length ? (
          <table class="tt" aria-labelledby="needs-h">
            <thead><tr><th scope="col">Title</th><th scope="col">What doesn’t match</th><th scope="col" class="hide-sm">File</th><th scope="col">Found</th><th scope="col"><span class="sr-only">Action</span></th></tr></thead>
            <tbody>
              {m.open.map((r) => (
                <tr>
                  <td><b>{r.title}</b><br /><span class="faint">{[r.library, r.rating].filter(Boolean).join(' · ')}</span></td>
                  <td><span class="chip">{KIND[r.kind]}</span> {r.detail}</td>
                  <td class="hide-sm"><code class="path">{r.path ?? '—'}</code></td>
                  <td class="num">{fmtDate(r.firstSeen, tz, { day: 'numeric', month: 'short' })}</td>
                  <td>
                    <form method="post" action="/health/dismiss" class="inline-form">
                      <Csrf token={csrf} />
                      <input type="hidden" name="jfId" value={r.jfId} /><input type="hidden" name="kind" value={r.kind} />
                      <button class="btn sm" type="submit" title="Checked: it is what it says. It comes back if the file changes.">It’s fine</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p class="muted">{m.enabled ? 'Nothing to review. Every file checked so far matches its title.' : 'Nothing to review.'}</p>}
      </section>

      <section class="panel" aria-labelledby="done-h">
        <div class="section-head"><h2 id="done-h">Reviewed</h2><span class="aside">{plural(m.done.length, 'file')} marked fine</span></div>
        {m.done.length ? (
          <table class="tt" aria-labelledby="done-h">
            <thead><tr><th scope="col">Title</th><th scope="col">What didn’t match</th><th scope="col">Marked fine</th><th scope="col"><span class="sr-only">Action</span></th></tr></thead>
            <tbody>
              {m.done.map((r) => (
                <tr>
                  <td><b>{r.title}</b><br /><span class="faint">{[r.library, r.rating].filter(Boolean).join(' · ')}</span></td>
                  <td><span class="chip">{KIND[r.kind]}</span> {r.detail}</td>
                  <td>{r.dismissedAt ? fmtDate(r.dismissedAt, tz, { day: 'numeric', month: 'short' }) : ''}<br /><span class="faint">{r.dismissedBy ?? ''}</span></td>
                  <td>
                    <form method="post" action="/health/reopen" class="inline-form">
                      <Csrf token={csrf} />
                      <input type="hidden" name="jfId" value={r.jfId} /><input type="hidden" name="kind" value={r.kind} />
                      <button class="btn sm ghost" type="submit">Review again</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p class="muted">Nothing marked fine yet.</p>}
      </section>
    </div>
  </>
);
