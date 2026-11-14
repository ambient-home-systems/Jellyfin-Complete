/** @jsxImportSource hono/jsx */
// Library health (ADR-041, ADR-043): a dashboard of how much of the library has been checked, what needs review, and
// what's been reviewed. Files are only reported, never moved or deleted. Artwork can be reset from TMDb, one finding at
// a time or for findings ticked here (never the whole library), by a TMDb ID the app has confirmed, and undone.
import type { FC } from 'hono/jsx';
import { Csrf, fmtDate, fmtTime, plural } from '../ui.js';
import type { HealthDashboard, HealthRow } from '../../library/health.js';
import type { ArtworkSummary } from '../../library/artwork.js';
import type { HealthKind } from '../../db/schema.js';

export const KIND: Record<HealthKind, string> = {
  runtime: 'Length', title: 'Title tag', audio: 'Audio', no_poster: 'No poster', video_poster: 'Poster from the video or file',
  language: 'Poster language', other_title: 'Artwork from another title',
};
const ARTWORK = new Set<HealthKind>(['no_poster', 'video_poster', 'language', 'other_title']);
const pct = (a: number, b: number) => (b ? Math.floor((a / b) * 100) : 0);
/** Shows with open findings on their episodes, most first. */
const shows = (rows: HealthRow[]) => {
  const by = new Map<string, { id: string; name: string; count: number }>();
  for (const r of rows) if (r.seriesJfId) (by.get(r.seriesJfId) ?? by.set(r.seriesJfId, { id: r.seriesJfId, name: r.show ?? 'Unknown show', count: 0 }).get(r.seriesJfId)!).count++;
  return [...by.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
};
const thumb = (r: HealthRow) => (r.primaryTag && !r.boxSet ? `/health/img/jf/${encodeURIComponent(r.jfId)}?tag=${encodeURIComponent(r.primaryTag)}` : null);
const tmdbThumb = (path: string) => `/health/img/tmdb${path}`;

/** The current poster beside the one a fix would put on. */
const Artwork: FC<{ r: HealthRow }> = ({ r }) => {
  const now = thumb(r);
  return (
    <div class="art-pair">
      {now ? <img src={now} alt="Poster now" width={60} height={90} loading="lazy" /> : <span class="art-none">{r.boxSet ? 'box set' : 'no poster'}</span>}
      {r.proposal ? (
        <>
          <span aria-hidden="true">→</span>
          <img src={tmdbThumb(r.proposal.path)} alt={`TMDb’s ${r.proposal.lang ? `${r.proposal.lang.toUpperCase()} ` : 'textless '}poster`} width={60} height={90} loading="lazy" />
        </>
      ) : null}
    </div>
  );
};

export const HealthPage: FC<{ m: HealthDashboard; a: ArtworkSummary; tz: string; csrf: string }> = ({ m, a, tz, csrf }) => {
  const kinds = (Object.entries(m.byKind) as [HealthKind, number][]).filter(([, n]) => n).map(([k, n]) => `${n} ${KIND[k].toLowerCase()}`);
  const fixable = m.open.some((r) => r.proposal);
  return (
    <>
      <header class="top">
        <h1>Library health</h1>
        <span class="aside faint">{m.lastChecked ? `Last checked ${fmtDate(m.lastChecked, tz)} · ${fmtTime(m.lastChecked, tz)}` : 'Not checked yet'}</span>
      </header>
      <div class="content">
        <p class="lead">
          Films and episodes whose file may not be what it says: it runs much longer or shorter than it should (more than 12 minutes or 15%, whichever is larger), a title tag inside it names another title, or it plays in another language by default.
          A film is measured against TMDb’s runtime. An episode is measured against TMDb’s too, unless TMDb lists the whole season at a different length (often the TV slot, ads included); then it’s measured against the season’s typical file length.
          Artwork is checked too: no poster, a poster from the video or the file, a poster in another language, or artwork from another title.
          The app never moves or deletes files. Artwork is only replaced when you choose it here (or for libraries you’ve set to fix it by themselves), from TMDb, by the title’s confirmed TMDb ID, and can be undone.
        </p>
        {!m.enabled ? <p class="callout">The check is off (Settings → Run and review → Library health), so nothing new is checked or found.</p> : null}

        <div class="answers health-sum">
          <section class="panel" aria-labelledby="hs-need">
            <div class="section-head"><h2 id="hs-need">Needs review</h2></div>
            <p class="lead"><b class={`num big${m.needsReview ? ' bad' : ''}`}>{m.needsReview}</b> {m.needsReview === 1 ? 'finding' : 'findings'}</p>
            <p class="faint">{m.needsReview ? kinds.join(' · ') : 'Nothing waits for you.'}</p>
            {m.needsReview ? <p><a href="#needs-h">See them</a></p> : null}
          </section>
          <section class="panel" aria-labelledby="hs-done">
            <div class="section-head"><h2 id="hs-done">Reviewed</h2></div>
            <p class="lead"><b class="num big">{m.reviewed}</b> marked fine</p>
            <p class="faint">Each stays hidden until its file or artwork changes.{a.fixes.length ? ` ${plural(a.fixes.length, 'artwork fix', 'artwork fixes')} in the last 30 days.` : ''}</p>
            {m.reviewed ? <p><a href="#done-h">See them</a></p> : null}
          </section>
          <section class="panel" aria-labelledby="hs-cov">
            <div class="section-head"><h2 id="hs-cov">Checked</h2></div>
            <p class="lead"><b class="num big">{pct(m.checked, m.files)}%</b> of {plural(m.files, 'file')}</p>
            <progress class="meter" max={Math.max(m.files, 1)} value={m.checked} aria-label="Files checked">{pct(m.checked, m.files)}%</progress>
            <p class="faint">
              {m.checked.toLocaleString('en-US')} checked{m.waiting ? `, ${m.waiting.toLocaleString('en-US')} still to check (a few thousand a night)` : ''}.
              {m.compared !== null ? ` ${m.compared.toLocaleString('en-US')} had a length to compare with; the rest are checked by title tags only.` : ''}
              {` Artwork: ${pct(a.checked, a.titles)}% of ${plural(a.titles, 'film and show', 'films and shows')} (a few hundred a night).`}
            </p>
          </section>
        </div>

        {m.byLibrary.length ? (
          <section class="panel" aria-labelledby="lib-h">
            <div class="section-head"><h2 id="lib-h">By library</h2>{a.autoFix.length ? <span class="aside">Fixes posters by itself: {a.autoFix.join(', ')}</span> : null}</div>
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
          <div class="section-head"><h2 id="needs-h">Needs review</h2><span class="aside">{plural(m.open.length, 'finding')}</span></div>
          {m.open.length ? (
            <>
              {/* Several at once: tick rows, or pick a show. Row checkboxes and buttons belong to this form through form="bulk". */}
              <form id="bulk" method="post" action="/health/dismiss-many" class="bulk-bar">
                <Csrf token={csrf} />
                <button class="btn sm" type="submit" name="what" value="selected">Mark selected fine</button>
                {fixable ? (
                  <span class="bulk-show">
                    <button class="btn sm" type="submit" formaction="/health/artwork/reset" name="what" value="selected">Reset artwork for selected</button>
                    <span class="faint">also:</span>
                    <label class="check inline"><input type="checkbox" name="also" value="Backdrop" /> backdrop</label>
                    <label class="check inline"><input type="checkbox" name="also" value="Logo" /> logo</label>
                    <label class="check inline"><input type="checkbox" name="also" value="Thumb" /> thumb</label>
                  </span>
                ) : null}
                {shows(m.open).length ? (
                  <span class="bulk-show">
                    <label for="bulk-series" class="sr-only">Show</label>
                    <select id="bulk-series" name="series">
                      {shows(m.open).map((x) => <option value={x.id}>{x.name} ({x.count})</option>)}
                    </select>
                    <button class="btn sm ghost" type="submit" name="what" value="series">Mark all for this show fine</button>
                  </span>
                ) : null}
              </form>
              <FindingsTable rows={m.open} tz={tz} csrf={csrf} />
            </>
          ) : <p class="muted">{m.enabled ? 'Nothing to review. Every file and poster checked so far matches its title.' : 'Nothing to review.'}</p>}
        </section>

        {m.info.length ? (
          <section class="panel" aria-labelledby="info-h">
            <div class="section-head"><h2 id="info-h">For information</h2><span class="aside">{plural(m.info.length, 'file')}</span></div>
            <p class="faint">These play in another language by default, but every Jellyfin user’s settings pick the library’s language instead, so nobody hears the dub. They’d matter for a new user, or if those settings change.</p>
            <table class="tt" aria-labelledby="info-h">
              <thead><tr><th scope="col">Title</th><th scope="col">What doesn’t match</th><th scope="col"><span class="sr-only">Action</span></th></tr></thead>
              <tbody>
                {m.info.map((r) => (
                  <tr>
                    <td><b>{r.title}</b><br /><span class="faint">{[r.library, r.rating].filter(Boolean).join(' · ')}</span></td>
                    <td>{r.detail}</td>
                    <td><DismissForm r={r} csrf={csrf} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {a.fixes.length ? (
          <section class="panel" aria-labelledby="fixed-h">
            <div class="section-head"><h2 id="fixed-h">Artwork fixed</h2><span class="aside">last 30 days</span></div>
            <table class="tt" aria-labelledby="fixed-h">
              <thead><tr><th scope="col">Title</th><th scope="col">Before → after</th><th scope="col">What went on</th><th scope="col">When</th><th scope="col"><span class="sr-only">Action</span></th></tr></thead>
              <tbody>
                {a.fixes.map((f) => (
                  <tr class={f.undoneAt ? 'faint' : ''}>
                    <td><b>{f.title}</b><br /><span class="chip">{KIND[f.kind]}</span></td>
                    <td><div class="art-pair">
                      {f.backups.Primary?.length ? <img src={`/health/img/backup/${f.id}`} alt="Poster before" width={60} height={90} loading="lazy" /> : <span class="art-none">no poster</span>}
                      <span aria-hidden="true">→</span>
                      <img src={`/health/img/jf/${encodeURIComponent(f.jfId)}?fix=${f.id}`} alt="Poster now" width={60} height={90} loading="lazy" />
                    </div></td>
                    <td>{f.what}<br /><span class="faint">From TMDb {f.tmdb}</span></td>
                    <td>{fmtDate(f.at, tz, { day: 'numeric', month: 'short' })}<br /><span class="faint">{f.by}</span></td>
                    <td>
                      {f.undoneAt ? <span class="faint">Put back {fmtDate(f.undoneAt, tz, { day: 'numeric', month: 'short' })}</span> : (
                        <form method="post" action={`/health/artwork/undo/${f.id}`} class="inline-form">
                          <Csrf token={csrf} />
                          <button class="btn sm ghost" type="submit" title="Put the old artwork back, from the copy kept when it was replaced">Undo</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {a.collectionRepairs.length ? (
          <section class="panel" aria-labelledby="coll-h">
            <div class="section-head"><h2 id="coll-h">Collection artwork changed</h2><span class="aside">repaired automatically · last 30 days</span></div>
            <p class="faint">The box sets this app made or adopted are checked every run against what it last set: TMDb link, lock, poster and no other images. Anything Jellyfin changed is put back straight away.</p>
            <ul class="plain-list">
              {a.collectionRepairs.map((e) => (
                <li><b>{e.name}</b> <span class="faint">{fmtDate(e.at, tz, { day: 'numeric', month: 'short' })}</span>{e.ok ? null : <span class="chip bad"> repair failed</span>}<br />{e.what}</li>
              ))}
            </ul>
          </section>
        ) : null}

        <section class="panel" aria-labelledby="done-h">
          <div class="section-head"><h2 id="done-h">Reviewed</h2><span class="aside">{plural(m.done.length, 'finding')} marked fine</span></div>
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
};

const DismissForm: FC<{ r: HealthRow; csrf: string }> = ({ r, csrf }) => (
  <form method="post" action="/health/dismiss" class="inline-form">
    <Csrf token={csrf} />
    <input type="hidden" name="jfId" value={r.jfId} /><input type="hidden" name="kind" value={r.kind} />
    <button class="btn sm" type="submit" title={ARTWORK.has(r.kind) ? 'Checked: it’s right. It comes back if the artwork changes.' : 'Checked: it is what it says. It comes back if the file changes.'}>It’s fine</button>
  </form>
);

const FindingsTable: FC<{ rows: HealthRow[]; tz: string; csrf: string }> = ({ rows, tz, csrf }) => (
  <table class="tt" aria-labelledby="needs-h">
    <thead><tr><th scope="col" class="cb"><span class="sr-only">Select</span></th><th scope="col">Title</th><th scope="col">What doesn’t match</th><th scope="col">Artwork</th><th scope="col" class="hide-sm">File</th><th scope="col">Found</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
    <tbody>
      {rows.map((r) => (
        <tr>
          <td class="cb"><input type="checkbox" form="bulk" name="sel" value={`${r.jfId}|${r.kind}`} aria-label={`Select ${r.title}: ${KIND[r.kind]}`} /></td>
          <td><b>{r.title}</b><br /><span class="faint">{[r.library, r.rating].filter(Boolean).join(' · ')}</span></td>
          <td>
            <span class="chip">{KIND[r.kind]}</span> {r.detail}
            {r.frame ? (
              // Hidden until asked for: a mislabelled file can hold anything. The picture only loads when opened.
              <details class="frame"><summary>Show a frame from the middle</summary><img src={`/health/img/frame/${encodeURIComponent(r.jfId)}`} alt={`A frame from the middle of ${r.title}`} width={240} height={135} loading="lazy" /></details>
            ) : null}
          </td>
          <td>{ARTWORK.has(r.kind) ? <Artwork r={r} /> : null}</td>
          <td class="hide-sm"><code class="path">{r.path ?? '—'}</code></td>
          <td class="num">{fmtDate(r.firstSeen, tz, { day: 'numeric', month: 'short' })}</td>
          <td>
            <div class="row-actions">
              {r.proposal ? <button class="btn sm primary" type="submit" form="bulk" formaction="/health/artwork/reset" name="one" value={r.jfId} title="Replace the poster with TMDb’s, by this title’s confirmed TMDb ID. The old one is kept, to undo.">Reset from TMDb</button> : null}
              {r.boxSet ? <a class="btn sm ghost" href="/adoption">Adopt it</a> : null}
              <DismissForm r={r} csrf={csrf} />
            </div>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);
