/** @jsxImportSource hono/jsx */
import { posterKey } from '../../db/schema.js';
import type { Child, FC } from 'hono/jsx';
import { Icon, Dot, Seg, Csrf, fmtDate, fmtTime, fmtAgo, plural } from '../ui.js';
import type { collectionsModel } from '../model.js';
import type { LoadedDefinition } from '../../domain/definitions.js';
import type { Provenance } from '../../db/schema.js';
import { transitions, localDay, localMidnight } from '../../domain/windows.js';
import { SOURCE_INPUTS } from '../../domain/source-input.js';
import { FAMILY_LABEL, familyOf, type PresetFamily } from '../../presets/index.js';
import type { Parity } from '../../domain/parity.js';
import type { Settings } from '../../settings.js';
import { COLLECTION_APPROVAL_ROWS, DATE_CHANGE, MODE_LABEL, datesLabel, familyNote } from '../terms.js';

type Row = ReturnType<typeof collectionsModel>[number];
const srcDot = (status: string) => (status === 'ok' ? 'ok' : status === 'stale' ? 'warn' : status === 'failed' ? 'err' : 'ok') as 'ok' | 'warn' | 'err';
const srcStatus = (status: string, fetchedAt?: number | null) => (status === 'ok' ? `OK${fetchedAt ? ` ${fmtAgo(fetchedAt)}` : ''}` : status === 'stale' ? 'Using last good results' : status === 'failed' ? 'Failing' : 'Not read yet');

const FAMILY_ORDER: (PresetFamily | 'custom')[] = ['seasonal', 'holiday_episodes', 'basic', 'custom', 'film_series', 'imdb_chart', 'streaming', 'universe', 'show_franchise'];

const StatusChip: FC<{ r: Row }> = ({ r }) => (
  r.status.kind === 'live' ? <span class="chip solid">Live</span>
    : r.waitingForAdoption ? <a class="chip" href="/adoption">{r.status.label}</a>
    : r.status.label === 'Needs your approval' ? <a class="chip y" href={`/review?def=${r.def.id}`}>{r.status.label}</a>
    : <span class={`chip${r.status.kind === 'scheduled' ? '' : ' faint'}`}>{r.status.label}</span>
);

/** What flipping the switch just did, said in the row itself, with a way back. */
export type RowNote = { text: string };

/** One collection's row, with its on/off switch. Rendered alone when the switch is flipped (htmx swaps just the row). */
export const CollectionRow: FC<{ r: Row; tz: string; csrf: string; note?: RowNote | null }> = ({ r, tz, csrf, note }) => {
  const on = r.def.enabled;
  const live = r.status.kind === 'live';
  const bad = r.sources.filter((s) => s.status === 'failed' || s.status === 'stale');
  const toggle = { method: 'post' as const, action: `/collections/${r.def.id}/enabled`, class: 'inline-form', 'hx-post': `/collections/${r.def.id}/enabled`, 'hx-target': `#c-${r.def.id}`, 'hx-swap': 'outerHTML' };
  return (
    <tr id={`c-${r.def.id}`} class={r.status.kind === 'off' ? 'faint' : ''}>
      <td class="sw">
        <form {...toggle}>
          <Csrf token={csrf} />
          <input type="hidden" name="enabled" value={on ? '0' : '1'} />
          {/* The id lets htmx put keyboard focus back on the new switch after the row is swapped. */}
          <button type="submit" id={`sw-${r.def.id}`} class="switch" role="switch" aria-checked={on ? 'true' : 'false'} aria-label={r.def.name}
            title={on ? (live ? 'Turn off. It’s removed from Jellyfin on the next run.' : 'Turn off') : 'Turn on. The next run reads its lists.'}><span class="knob"></span></button>
        </form>
      </td>
      <td class="coll">
        <a href={`/collections/${r.def.id}`}>{r.def.name}</a>
        {r.pending && r.status.label !== 'Needs your approval' ? <> <a class="chip y" href={`/review?def=${r.def.id}`}>{r.pending} to approve</a></> : null}
        {bad.length ? <> <span class="chip red" title={bad.map((s) => `${s.label}: ${s.error ?? s.status}`).join('; ')}>{bad.some((s) => s.status === 'failed') ? 'source failing' : 'using last good results'}</span></> : null}
        {note ? (
          <div class="row-note">
            {note.text}{' '}
            <form {...toggle}><Csrf token={csrf} /><input type="hidden" name="enabled" value={on ? '0' : '1'} /><button class="linklike" type="submit">Undo</button></form>
          </div>
        ) : null}
      </td>
      <td class="hide-sm num nowrap">{datesLabel(r.def.window)}</td>
      <td><StatusChip r={r} /></td>
      <td class="r num">{r.items ?? '—'}</td>
      <td class="hide-md num">{r.next ? `${DATE_CHANGE[r.next.kind]} ${fmtDate(r.next.at, tz)}` : '—'}</td>
    </tr>
  );
};

const CollectionsTable: FC<{ rows: Row[]; tz: string; csrf: string }> = ({ rows, tz, csrf }) => (
  <div class="table-wrap">
    <table class="tt">
      <thead><tr><th scope="col" class="sw">On</th><th scope="col">Collection</th><th scope="col" class="hide-sm">Dates</th><th scope="col">Status</th><th scope="col" class="r">Titles</th><th scope="col" class="hide-md">Next change</th></tr></thead>
      <tbody>
        {rows.map((r) => <CollectionRow r={r} tz={tz} csrf={csrf} />)}
      </tbody>
    </table>
  </div>
);

/** Where a one-click switch says what it did, for screen readers (the switch itself shows it). Filled in place, never replaced. */
export const ToggleStatus: FC<{ text?: string; oob?: boolean }> = ({ text, oob }) => (
  <div id="toggle-status" class="sr-only" role="status" hx-swap-oob={oob ? 'innerHTML' : undefined}>{text ?? ''}</div>
);

/** "3 of 41 on", with an id so flipping one row's switch can update it in place. */
export const FamilyCount: FC<{ fam: string; on: number; total: number; oob?: boolean }> = ({ fam, on, total, oob }) => (
  <span id={`fam-${fam}-count`} class="faint num" hx-swap-oob={oob ? 'true' : undefined}>{on} of {total} on</span>
);

/** All on / All off for a family: a plain form that comes back to the family. */
const FamilySwitches: FC<{ fam: string; csrf: string }> = ({ fam, csrf }) => (
  <span class="fam-switches">
    <form method="post" action={`/collections/family/${fam}/enabled`} class="inline-form"><Csrf token={csrf} /><input type="hidden" name="enabled" value="1" /><button class="btn sm ghost" type="submit">All on</button></form>
    <form method="post" action={`/collections/family/${fam}/enabled`} class="inline-form"><Csrf token={csrf} /><input type="hidden" name="enabled" value="0" /><button class="btn sm ghost" type="submit">All off</button></form>
  </span>
);

/** Collections and the ones Jellyfin already had, as two tabs of one place. */
export const CollectionsTabs: FC<{ at: 'list' | 'existing' }> = ({ at }) => (
  <nav class="tabs" aria-label="Collections">
    <a href="/collections" aria-current={at === 'list' ? 'page' : undefined}>Your collections</a>
    <a href="/adoption" aria-current={at === 'existing' ? 'page' : undefined}>Already in Jellyfin</a>
  </nav>
);

export const CollectionsList: FC<{ rows: Row[]; tz: string; csrf: string; s: Settings }> = ({ rows, tz, csrf, s }) => (
  <>
    <header class="top">
      <h1>Collections</h1>
      <CollectionsTabs at="list" />
      <div class="actions"><a class="btn primary" href="/collections/new"><Icon name="plus" /> New collection</a></div>
    </header>
    <div class="content">
      <ToggleStatus />
      {FAMILY_ORDER.map((fam) => {
        const group = rows.filter((r) => familyOf(r.def.presetKey) === fam);
        if (!group.length) return null;
        const on = group.filter((r) => r.def.enabled).length;
        const id = `fam-${fam}`;
        const title = <>{FAMILY_LABEL[fam]} <FamilyCount fam={fam} on={on} total={group.length} /></>;
        // A family with nothing turned on folds away, so 44 optional ready-made collections don't crowd the page.
        return on === 0 && fam !== 'custom' ? (
          <details class="family" aria-labelledby={id}>
            <summary><h2 id={id}>{title}</h2><span class="faint">{familyNote(fam, group.length, s)} Nothing is created until you turn one on.</span></summary>
            <div class="fam-tools"><FamilySwitches fam={fam} csrf={csrf} /></div>
            <CollectionsTable rows={group} tz={tz} csrf={csrf} />
          </details>
        ) : (
          <section class="family" aria-labelledby={id}>
            <div class="section-head"><h2 id={id}>{title}</h2>{fam !== 'custom' ? <FamilySwitches fam={fam} csrf={csrf} /> : null}</div>
            <CollectionsTable rows={group} tz={tz} csrf={csrf} />
          </section>
        );
      })}
    </div>
  </>
);

export const EDITOR_TABS = ['titles', 'sources', 'dates', 'details', 'advanced'] as const;
export type EditorTab = (typeof EDITOR_TABS)[number];
const TAB_LABEL: Record<EditorTab, string> = { titles: 'Titles', sources: 'Sources', dates: 'Dates', details: 'Name and poster', advanced: 'Advanced' };

/** One tab's content. Every panel is on the page (so one Save covers them all); only the open one shows. */
const Panel: FC<{ name: EditorTab; at: EditorTab; children?: Child }> = ({ name, at, children }) => (
  <div data-panel={name} hidden={name !== at}>{children}</div>
);

/** Where a collection stands, in a sentence. */
function standing(r: Row, tz: string): string {
  const n = r.items;
  if (!r.def.enabled) return 'Turned off. Nothing is created in Jellyfin.';
  if (r.status.kind === 'live') return `In Jellyfin now, with ${plural(n ?? 0, 'title')}.`;
  if (r.status.label === 'Hidden') return 'Hidden in Jellyfin until its dates come round.';
  if (r.waitingForAdoption) return 'Jellyfin already has a collection with this name, so nothing new is created until you take it over or delete it.';
  if (n === null) return 'Not read yet. The next run reads its sources and works out its titles.';
  if (r.status.kind === 'below') return n === 0 ? 'Nothing in your library matches its sources, so it isn’t created.' : `Only ${plural(n, 'title')} in your library ${n === 1 ? 'matches' : 'match'}; it needs ${r.def.minItems} to be created.`;
  if (r.next?.kind === 'opens') return `Appears in Jellyfin on ${fmtDate(r.next.at, tz)}, with ${plural(n, 'title')}.`;
  if (r.status.label === 'Needs your approval') return `Its ${plural(r.pending, 'change')} wait in your Inbox. Once approved, it’s created in Jellyfin with ${plural(n, 'title')}.`;
  return `Ready: the next run creates it in Jellyfin, with ${plural(n, 'title')}.`;
}

export const CollectionEditor: FC<{
  def: LoadedDefinition; tz: string; csrf: string; live: boolean; globalModes: Record<string, string>; dryRun: boolean;
  /** This collection's row from the Collections list: status, titles, next change, changes waiting. */
  row: Row; tab: EditorTab; plex: boolean;
  sources: { id: number; label: string; status: string; error: string | null; listed: number; matched: number; role: string; fetchedAt: number | null }[];
  arr: { addMissing: boolean; radarr: boolean; sonarr: boolean; cap: number };
  /** The ready-made collection's own poster (its key), when there is one to go back to (ADR-042). */
  posterDefault?: string | null;
}> = ({ def, tz, csrf, live, globalModes, dryRun, row, tab, plex, sources, arr, posterDefault }) => {
  const arrApp = def.target === 'movies' ? 'Radarr' : def.target === 'shows' ? 'Sonarr' : def.target === 'both' ? 'Radarr and Sonarr' : null;
  const today = localDay(Date.now(), tz);
  const next = def.window ? transitions(def.window, today, 3) : [];
  const w = def.window?.type === 'range' ? def.window : null;
  const here = `/collections/${def.id}`;
  const bad = sources.filter((s) => s.status === 'failed' || s.status === 'stale');
  return (
    <>
      <header class="top">
        <nav class="crumbs" aria-label="Breadcrumb"><a href="/collections">Collections</a><span aria-hidden="true">/</span><span>{def.presetKey ? `Ready-made · ${FAMILY_LABEL[familyOf(def.presetKey)]}` : 'Your own'}</span></nav>
        <h1>{def.name}</h1>
        <div class="actions">
          <span id="unsaved" class="faint" hidden>Unsaved changes</span>
          <button class="btn primary" type="submit" form="def-form">Save changes</button>
        </div>
      </header>
      <div class="content editor-page">
        <section class="summary" aria-label="At a glance">
          {def.poster.kind !== 'none'
            ? <img class="summary-poster" src={`${here}/poster?v=${encodeURIComponent(posterKey(def.poster) ?? '')}`} alt={`${def.name}’s poster`} width={96} height={144} />
            : <div class="summary-poster none" role="img" aria-label="No poster">No poster</div>}
          <div class="summary-facts">
            <p class="standing"><StatusChip r={row} /> {standing(row, tz)}{row.waitingForAdoption ? <> <a href="/adoption">See it</a></> : null}</p>
            <dl class="kv">
              <dt>Dates</dt><dd>{datesLabel(def.window)}{row.next ? <span class="faint"> · {DATE_CHANGE[row.next.kind]} {fmtDate(row.next.at, tz)}</span> : null}</dd>
              <dt>Sources</dt><dd>{sources.length ? plural(sources.length, 'source') : 'None yet'}{bad.length ? <> <span class="chip red">{bad.length} with a problem</span></> : null}</dd>
              {row.pending ? <><dt>Waiting</dt><dd><a href={`/review?def=${def.id}`}>{plural(row.pending, 'change')} to approve</a></dd></> : null}
            </dl>
          </div>
        </section>

        <nav class="tabs editor-tabs" aria-label="Collection" data-tabs>
          {EDITOR_TABS.map((t) => <a href={`${here}?tab=${t}`} data-tab={t} aria-current={t === tab ? 'page' : undefined}>{TAB_LABEL[t]}{t === 'titles' && row.items !== null ? <span class="n num">{row.items}</span> : null}{t === 'sources' ? <span class="n num">{sources.length}</span> : null}</a>)}
        </nav>

        <Panel name="titles" at={tab}>
          <section class="form-sec" aria-labelledby="pv-h">
            <div class="section-head"><h2 id="pv-h">Titles from your library</h2><span class="aside">as of the last run</span></div>
            <div hx-get={`${here}/preview`} hx-trigger="load" hx-swap="innerHTML">
              <p class="muted">Loading titles…</p>
            </div>
          </section>
          <section class="form-sec" aria-labelledby="par-h">
            <div class="section-head"><h2 id="par-h">Compared with Plex</h2></div>
            {plex ? (
              <div hx-get={`${here}/parity`} hx-trigger="load" hx-swap="innerHTML"><p class="muted">Comparing with Plex…</p></div>
            ) : <p class="muted">Optional. <a href="/settings">Connect Plex</a> to compare this collection with the one of the same name there.</p>}
          </section>
        </Panel>

        <Panel name="sources" at={tab}>
          <section class="form-sec" aria-labelledby="src-h">
            <div class="section-head"><h2 id="src-h">Sources</h2><span class="aside">the lists and searches its titles come from</span></div>
            <p class="muted">A title belongs in the collection when any source lists it and it’s in your library. If a source stops answering, its last good results are kept, so a failure never empties a collection. Adding or removing a source here is saved straight away.</p>
            <div class="table-wrap">
              <table class="tt">
                <thead><tr><th scope="col">Source</th><th scope="col" class="r">Lists</th><th scope="col" class="r">In your library</th><th scope="col" class="hide-sm">Status</th><th scope="col">Ask before adding</th><th scope="col"><span class="sr">Remove</span></th></tr></thead>
                <tbody>
                  {sources.length === 0 ? <tr><td colspan={6} class="muted">No sources yet. Add one below.</td></tr> : null}
                  {sources.map((s) => (
                    <tr>
                      <td class="srcname"><b>{s.label}</b>{s.error && s.status !== 'ok' ? <div class="faint">{s.error}</div> : null}</td>
                      <td class="r num">{s.listed || '—'}</td>
                      <td class="r num">{s.matched || '—'}</td>
                      <td class="hide-sm nowrap"><Dot state={srcDot(s.status)} label={s.status} /> {srcStatus(s.status, s.fetchedAt)}</td>
                      <td>
                        <button class="switch" role="switch" type="submit" form="src-rows" name="op" value={`role:${s.id}:${s.role === 'add' ? 'suggest' : 'add'}`} aria-checked={s.role === 'suggest' ? 'true' : 'false'}
                          aria-label={`Ask before adding titles from ${s.label}`} title={s.role === 'suggest' ? 'On: its titles wait in your Inbox as suggestions. Press to add them without asking.' : 'Off: its titles are added like any other. Press to have them wait in your Inbox as suggestions.'}><span class="knob"></span></button>
                      </td>
                      <td class="r nowrap"><button class="btn sm ghost" type="submit" form="src-rows" name="op" value={`remove:${s.id}`} aria-label={`Remove ${s.label}`}><Icon name="x" /> <span class="hide-md">Remove</span></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div class="addsrc" role="group" aria-label="Add a source">
              <div class="field"><label for="src-type">Add a source</label>
                <select id="src-type" name="type" form="src-form">{SOURCE_INPUTS.map((x) => <option value={x.key}>{x.label}</option>)}</select>
              </div>
              <div class="field grow"><label for="src-value">List, keywords or IDs</label><input id="src-value" name="value" type="text" form="src-form" placeholder="Paste the address from your browser, or an ID or keywords" /></div>
              <label class="check ask"><input type="checkbox" name="role" value="suggest" form="src-form" /> Ask before adding from this source</label>
              <button class="btn" type="submit" form="src-form" name="op" value="add"><Icon name="plus" /> Add source</button>
            </div>
            <details class="how"><summary>What to enter for each kind of source</summary><SourceExamples /></details>
            <p class="hint">A new source is read on the next run; until then the Titles tab can’t show what it lists.</p>
          </section>

          {arrApp ? (
            <section class="form-sec" aria-labelledby="arr-h">
              <div class="section-head"><h2 id="arr-h">Titles you don’t have</h2><span class="aside"><a href={`/missing?tab=${def.target === 'shows' ? 'shows' : 'movies'}&def=${def.id}`}>See what’s missing</a></span></div>
              <input type="hidden" name="arrForm" value="1" form="def-form" />
              <label class="check"><input type="checkbox" name="arrAddMissing" value="1" form="def-form" checked={arr.addMissing} disabled={!arr.radarr && !arr.sonarr} /> Send missing titles to {arrApp} while the collection is in Jellyfin</label>
              <p class="hint">{!arr.radarr && !arr.sonarr ? <><a href="/settings">Connect {arrApp}</a> first. </> : null}Each run looks up the {25} best-ranked missing titles and suggests the released ones that {arrApp} doesn’t have or exclude. Whether they’re sent without asking follows Settings → Approvals (Ask me, to begin with), at most {arr.cap} automatic sends per run. Saved with Save changes.</p>
            </section>
          ) : null}
        </Panel>

        <form id="def-form" class="form" method="post" action={here} enctype="multipart/form-data" aria-label="Collection settings" data-dirty="#unsaved">
          <Csrf token={csrf} />
          <input type="hidden" name="tab" value={tab} data-tab-field />

          <Panel name="dates" at={tab}>
            <section class="form-sec" aria-labelledby="sched-h">
              <div class="section-head"><h2 id="sched-h">Dates</h2><span class="aside">when it’s in Jellyfin</span></div>
              {w || !def.window ? <ScheduleFields from={w?.from} to={w?.to} /> : <p class="muted">This ready-made collection’s dates move each year (they follow the holiday), so they aren’t set here.</p>}
              {next.length ? (
                <table class="mini-tt num" aria-label="Next changes for this collection">
                  {next.map((t) => (
                    <tr><td>{fmtDate(localMidnight(t.day, tz), tz, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</td><td>{fmtTime(localMidnight(t.day, tz), tz)}</td><td><span class={t.kind === 'opens' ? 'chg-open' : 'chg-close'}>{DATE_CHANGE[t.kind]}</span></td><td>{t.kind === 'opens' ? 'created in Jellyfin with its titles' : def.visibility === 'tag_gate' ? 'hidden in Jellyfin until next time' : 'removed from Jellyfin; its poster and description are kept for next time'}</td></tr>
                  ))}
                </table>
              ) : null}
            </section>
          </Panel>

          <Panel name="details" at={tab}>
            <section class="form-sec" aria-labelledby="basics-h">
              <div class="section-head"><h2 id="basics-h">Name</h2></div>
              <div class="field"><label for="f-name">Name</label><input id="f-name" name="name" type="text" value={def.name} required maxlength={200} /><span class="hint">This is the collection’s name in Jellyfin. To compare with Plex, keep it the same as the Plex collection’s name.</span></div>
              <div class="field"><label for="f-sum">Description</label><textarea id="f-sum" name="overview" rows={2}>{def.overview ?? ''}</textarea></div>
              <div class="field"><label class="check"><input type="checkbox" name="enabled" value="1" checked={def.enabled} /> Turned on</label><span class="hint">Turning a collection off removes it from Jellyfin on the next run. The titles themselves stay in your library.</span></div>
            </section>
            <section class="form-sec" aria-labelledby="poster-h">
              <div class="section-head"><h2 id="poster-h">Poster</h2></div>
              <input type="hidden" name="posterForm" value="1" />
              <div class="poster-edit">
                {def.poster.kind !== 'none'
                  ? <img src={`${here}/poster?v=${encodeURIComponent(posterKey(def.poster) ?? '')}`} alt={`${def.name}’s poster`} width={120} height={180} />
                  : <div class="poster-none" role="img" aria-label="No poster">No poster</div>}
                <div class="poster-choices">
                  {posterDefault ? <label class="check"><input type="radio" name="poster" value="default" checked={posterKey(def.poster) === posterDefault} /> The poster it came with</label> : null}
                  <label class="check"><input type="radio" name="poster" value="upload" checked={def.poster.kind === 'file'} /> Upload an image{def.poster.kind === 'file' ? ' (one is uploaded; choose a file to replace it)' : ''}</label>
                  <input type="file" name="posterFile" accept="image/jpeg,image/png,image/webp" aria-label="Image to upload" />
                  <label class="check"><input type="radio" name="poster" value="url" checked={def.poster.kind === 'url' && posterKey(def.poster) !== posterDefault} /> An image on the web</label>
                  <input type="url" name="posterUrl" placeholder="https://…/poster.jpg" value={def.poster.kind === 'url' && posterKey(def.poster) !== posterDefault ? def.poster.url : ''} aria-label="Image address" />
                  <label class="check"><input type="radio" name="poster" value="none" checked={def.poster.kind === 'none'} /> No poster</label>
                  <p class="hint">JPEG, PNG or WebP, up to 10 MB. A new poster goes on the collection in Jellyfin as soon as you save.</p>
                </div>
              </div>
            </section>
          </Panel>

          <Panel name="advanced" at={tab}>
            <p class="muted lede">Most collections never need these.</p>
            <section class="form-sec" aria-labelledby="out-h">
              <div class="section-head"><h2 id="out-h">In Jellyfin</h2></div>
              <div class="grid3">
                <div class="field"><label for="f-min">Fewest titles</label><input id="f-min" name="minItems" type="number" min={1} max={1000} value={String(def.minItems)} class="num" /><span class="hint">With fewer than this in your library, the collection isn’t created (or is removed).</span></div>
                <div class="field"><label for="f-st">Sort title</label><input id="f-st" name="sortTitle" type="text" value={def.sortTitle ?? ''} /><span class="hint">Where it sorts among Jellyfin’s collections. Starting with <code>!00_</code> puts it first.</span></div>
                <div class="field"><span class="label">Home screen</span><input type="hidden" name="homeRowForm" value="1" /><label class="check"><input type="checkbox" name="homeRow" value="1" checked={def.homeRow} /> Show as a row while it’s in Jellyfin</label><span class="hint">Needs two Jellyfin plugins: see <a href="/settings/extras#home">Settings → Extras</a>.</span></div>
              </div>
              <div class="field"><span class="label" id="sm-l">When a title leaves every source</span>
                <div class="choice" role="radiogroup" aria-labelledby="sm-l">
                  <label><input type="radio" name="syncMode" value="sync" checked={def.syncMode !== 'append'} /><b>Keep in step with the lists</b><span>The title is removed from the collection too.</span></label>
                  <label><input type="radio" name="syncMode" value="append" checked={def.syncMode === 'append'} /><b>Only ever add</b><span>Titles stay in the collection once they’re in.</span></label>
                </div>
              </div>
              <div class="field"><span class="label" id="vis-l">Outside its dates</span>
                <div class="choice" role="radiogroup" aria-labelledby="vis-l">
                  <label><input type="radio" name="visibility" value="delete" checked={def.visibility === 'delete'} /><b>Remove it from Jellyfin</b><span>It’s created again, with the same poster, sort title and description, when its dates come round.</span></label>
                  <label><input type="radio" name="visibility" value="tag_gate" checked={def.visibility === 'tag_gate'} /><b>Keep it, hidden</b><span>The collection keeps its titles and poster between seasons and is shown again on its dates. To hide it, the tag <code>maverick-collections:hidden</code> is added to every Jellyfin user’s blocked tags, including new users. The titles themselves stay visible.</span></label>
                </div>
              </div>
            </section>

            <section class="form-sec" aria-labelledby="modes-h">
              <div class="section-head"><h2 id="modes-h">Approvals for this collection</h2></div>
              <p class="muted">Default follows <a href="/settings/approvals">Settings → Approvals</a>. Choose something else to make this collection the exception.{dryRun ? ' While “Approve everything first” is on, every change asks first whatever is set here.' : ''}</p>
              <table class="modes">
                <thead><tr><th scope="col">Change</th><th scope="col">Approval</th></tr></thead>
                <tbody>
                  {COLLECTION_APPROVAL_ROWS.map(([t, label]) => (
                    <tr><td>{label}</td><td><Seg name={`mode:${t}`} value={def.modes[t] ?? 'default'} options={[['default', `Default: ${MODE_LABEL[globalModes[t] as keyof typeof MODE_LABEL] ?? globalModes[t]}`], ['off', MODE_LABEL.off], ['review', MODE_LABEL.review], ['auto', MODE_LABEL.auto]]} label={label} /></td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          </Panel>
        </form>

        <form id="src-form" method="post" action={`${here}/sources`} hidden><Csrf token={csrf} /></form>
        <form id="src-rows" method="post" action={`${here}/sources`} hidden><Csrf token={csrf} /></form>
        {!def.presetKey ? (
          <Panel name="advanced" at={tab}>
            <form method="post" action={`${here}/delete`} class="danger-zone">
              <Csrf token={csrf} />
              <p class="muted">{live ? 'This collection is in Jellyfin. Turn it off and start a run to remove it from Jellyfin, then you can delete it here.' : 'Deleting removes this collection from the app, with its sources, the titles you always include or leave out, and your decisions about it.'}</p>
              <button class="btn danger" type="submit" disabled={live}>Delete collection</button>
            </form>
          </Panel>
        ) : null}
      </div>
    </>
  );
};

const SourceExamples: FC = () => <ul class="hint-list">{SOURCE_INPUTS.map((x) => <li><b>{x.label}</b>: {x.placeholder}</li>)}</ul>;

const ScheduleFields: FC<{ from?: string; to?: string }> = ({ from, to }) => (
  <>
    <div class="choice" role="radiogroup" aria-label="Dates">
      <label><input type="radio" name="schedule" value="always" checked={!from} /><b>All year</b><span>The collection is always in Jellyfin.</span></label>
      <label><input type="radio" name="schedule" value="range" checked={Boolean(from)} /><b>Between two dates each year</b><span>It appears at midnight on the first day and goes away after the last. The dates can run past New Year.</span></label>
    </div>
    <div class="grid2">
      <div class="field"><label for="f-from">First day</label><input id="f-from" name="from" type="text" value={from ?? ''} pattern="\d{1,2}/\d{1,2}" class="num" placeholder="12/01" /><span class="hint">Month/day: 12/01 is 1 December.</span></div>
      <div class="field"><label for="f-to">Last day</label><input id="f-to" name="to" type="text" value={to ?? ''} pattern="\d{1,2}/\d{1,2}" class="num" placeholder="12/31" /><span class="hint">Month/day. The collection is still there on this day.</span></div>
    </div>
  </>
);

export const NewCollection: FC<{ csrf: string; error?: string; values?: Record<string, string> }> = ({ csrf, error, values = {} }) => (
  <>
    <header class="top">
      <nav class="crumbs" aria-label="Breadcrumb"><a href="/collections">Collections</a><span aria-hidden="true">/</span><span>New</span></nav>
      <h1>New collection</h1>
    </header>
    <div class="content">
      <form method="post" action="/collections/new" class="form narrow">
        <Csrf token={csrf} />
        {error ? <p class="flash err" role="alert">{error}</p> : null}
        <section class="form-sec" aria-labelledby="n-basics">
          <div class="section-head"><h2 id="n-basics">Name</h2></div>
          <div class="field"><label for="n-name">Name</label><input id="n-name" name="name" type="text" value={values.name ?? ''} required maxlength={200} placeholder="Heist Movies" /></div>
          <div class="field"><span class="label">Made of</span><Seg name="target" value={values.target ?? 'movies'} options={[['movies', 'Movies'], ['shows', 'Shows'], ['episodes', 'Episodes']]} label="Made of" /></div>
        </section>
        <section class="form-sec" aria-labelledby="n-sched">
          <div class="section-head"><h2 id="n-sched">Dates</h2></div>
          <ScheduleFields from={values.from || undefined} to={values.to || undefined} />
        </section>
        <section class="form-sec" aria-labelledby="n-src">
          <div class="section-head"><h2 id="n-src">Where its titles come from</h2><span class="aside">you can add more sources afterwards</span></div>
          <div class="grid2">
            <div class="field"><label for="n-type">Kind of source</label><select id="n-type" name="type">{SOURCE_INPUTS.map((x) => <option value={x.key} selected={values.type === x.key}>{x.label}</option>)}</select></div>
            <div class="field"><label for="n-value">List, keywords or IDs</label><input id="n-value" name="value" type="text" value={values.value ?? ''} required placeholder="Paste the address from your browser, or an ID or keywords" /></div>
          </div>
          <details class="how"><summary>What to enter for each kind of source</summary><SourceExamples /></details>
        </section>
        <div><button class="btn primary" type="submit">Create collection</button></div>
        <p class="hint">Nothing changes in Jellyfin yet: the next run reads the source, and what it would do waits for your approval like any other change.</p>
      </form>
    </div>
  </>
);

export const ParityPanel: FC<{ p: Parity; fetchedAt: number | null }> = ({ p, fetchedAt }) => {
  const same = p.both === p.plexCount && p.both === p.plannedCount;
  const list = (title: string, rows: { title: string; year: number | null; ids: string }[], why: string) => rows.length ? (
    <details class="more"><summary>{title} ({rows.length})</summary>
      <p class="hint">{why}</p>
      <ul class="plain-list">{rows.map((r) => <li><b>{r.title}</b>{r.year ? <span class="y num"> {r.year}</span> : null} <span class="faint">{r.ids}</span></li>)}</ul>
    </details>
  ) : null;
  return (
    <>
      <p><b class="num">{p.plexCount}</b> in Plex · <b class="num">{p.plannedCount}</b> planned here · <b class="num">{p.both}</b> in both{fetchedAt ? <span class="faint"> · read {fmtAgo(fetchedAt)}</span> : null}</p>
      {same ? <p class="muted">The same titles in both.</p> : null}
      {list('In Plex, not in your Jellyfin library', p.plexOnlyNotInLibrary, 'Plex has these and Jellyfin doesn’t, or Jellyfin has them without matching IMDb/TMDb IDs.')}
      {list('In both libraries, not picked here', p.plexOnlyNotPlanned, 'Usually a source difference: an IMDb list or search returned it for Plex but not here, or a library isn’t selected in Settings. Choose “Always include” on a title if you want it.')}
      {list('Planned here, not in Plex', p.hereOnly, 'Often titles from a library Plex doesn’t have, or a list that changed since Plex’s collection was last built.')}
    </>
  );
};

export type PreviewItem = { jfId: string; name: string; year: number | null; provenance: Provenance; inBoxSet: boolean };

export const Preview: FC<{ defId: number; items: PreviewItem[]; excluded: { jfId: string; name: string }[]; csrf: string; total: number }> = ({ defId, items, excluded, csrf, total }) => (
  <>
    <p class="muted">{total} {total === 1 ? 'title in your library belongs' : 'titles in your library belong'} in this collection right now{excluded.length ? `, and ${excluded.length} ${excluded.length === 1 ? 'is' : 'are'} left out` : ''}. Each shows the source that lists it.</p>
    <div class="titles">
      {items.map((it) => (
        <div class="item">
          <span class="poster type" aria-hidden="true">{it.name}</span>
          <div>
            <div class="t">{it.name}{it.year ? <span class="y num">{it.year}</span> : null}</div>
            <div class="why">
              {it.provenance.pinned ? <span class="chip solid"><Icon name="pin" /> Always included</span> : null}
              {it.provenance.sources.map((s) => <span class="chip">{s.label} #{s.rank}</span>)}
              {it.provenance.sources.length ? <span class="chip">{it.provenance.match}</span> : null}
              {it.inBoxSet ? <span class="chip">in Jellyfin</span> : null}
            </div>
          </div>
          <div class="side">
            <form method="post" action={`/collections/${defId}/pins`} class="inline-form">
              <input type="hidden" name="_csrf" value={csrf} /><input type="hidden" name="jfId" value={it.jfId} />
              {it.provenance.pinned
                ? <button class="btn sm ghost" type="submit" name="kind" value="clear" aria-label={`Stop always including ${it.name}`} title="Stop always including it"><Icon name="x" /></button>
                : <button class="btn sm ghost" type="submit" name="kind" value="pin" aria-label={`Always include ${it.name}`} title="Always include: keep it in the collection even if every source drops it"><Icon name="pin" /></button>}
              <button class="btn sm ghost" type="submit" name="kind" value="exclude" aria-label={`Leave out ${it.name}`} title="Leave out: never put it in this collection"><Icon name="ban" /></button>
            </form>
          </div>
        </div>
      ))}
    </div>
    {excluded.length ? (
      <details class="more"><summary>Left out ({excluded.length})</summary>
        {excluded.map((e) => (
          <form method="post" action={`/collections/${defId}/pins`} class="item">
            <input type="hidden" name="_csrf" value={csrf} /><input type="hidden" name="jfId" value={e.jfId} />
            <span class="poster type" aria-hidden="true">{e.name}</span><div class="t">{e.name}</div>
            <button class="btn sm" type="submit" name="kind" value="clear">Include again</button>
          </form>
        ))}
      </details>
    ) : null}
    {total > items.length ? <p class="listfoot">Showing {items.length} of {total}, sorted by title.</p> : null}
  </>
);
