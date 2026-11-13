/** @jsxImportSource hono/jsx */
// Library health (ADR-041): films and episodes whose file may not be what it says. Read-only: the app never moves or
// deletes a file; "It's fine" hides a finding until the file changes.
import type { FC } from 'hono/jsx';
import { Csrf, fmtDate } from '../ui.js';
import type { HealthRow } from '../../library/health.js';

export const HealthPage: FC<{ rows: HealthRow[]; dismissed: HealthRow[]; showDismissed: boolean; enabled: boolean; tz: string; csrf: string }> = ({ rows, dismissed, showDismissed, enabled, tz, csrf }) => (
  <>
    <header class="top"><h1>Library health</h1></header>
    <div class="content">
      <p class="lead">
        Films and episodes whose file may not be what it says: it runs much longer or shorter than TMDb’s runtime (by more than 12 minutes or 15%, whichever is larger), or a title tag inside it names another title.
        Check each one by playing it. The app never moves or deletes files.
      </p>
      {!enabled ? <p class="callout">The check is off (Settings → Run and review → Library health), so nothing new is found.</p> : null}
      {rows.length ? (
        <table class="tt" aria-label="Files that may not be what they say">
          <thead><tr><th scope="col">Title</th><th scope="col">What doesn’t match</th><th scope="col" class="hide-sm">File</th><th scope="col">Found</th><th scope="col"><span class="sr-only">Action</span></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr>
                <td><b>{r.title}</b><br /><span class="faint">{[r.library, r.rating].filter(Boolean).join(' · ')}</span></td>
                <td>{r.detail}</td>
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
      ) : <p class="notice ok"><b>Nothing to check.</b> {enabled ? 'Every file checked so far matches its title. Big libraries are checked over a few nights.' : ''}</p>}
      {dismissed.length ? (
        showDismissed ? (
          <>
            <h2>Marked as fine</h2>
            <ul class="plain-list">{dismissed.map((r) => <li><b>{r.title}</b> <span class="faint">{r.detail}</span></li>)}</ul>
          </>
        ) : <p class="faint"><a href="/health?dismissed=1">{dismissed.length} marked as fine</a></p>
      ) : null}
    </div>
  </>
);
