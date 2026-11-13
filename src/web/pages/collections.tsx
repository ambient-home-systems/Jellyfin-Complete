/** @jsxImportSource hono/jsx */
import { posterKey } from '../../db/schema.js';
import type { FC } from 'hono/jsx';
import { Icon, Dot, Seg, Csrf, fmtDate, fmtTime, fmtAgo } from '../ui.js';
import type { collectionsModel } from '../model.js';
import type { LoadedDefinition } from '../../domain/definitions.js';
import type { ActionType, Provenance } from '../../db/schema.js';
import { transitions, localDay, localMidnight } from '../../domain/windows.js';
import { SOURCE_INPUTS } from '../../domain/source-input.js';
import { FAMILY_LABEL, familyOf, type PresetFamily } from '../../presets/index.js';
import type { Parity } from '../../domain/parity.js';

type Row = ReturnType<typeof collectionsModel>[number];
const srcDot = (status: string) => (status === 'ok' ? 'ok' : status === 'stale' ? 'warn' : status === 'failed' ? 'err' : 'ok') as 'ok' | 'warn' | 'err';

const FAMILY_ORDER: (PresetFamily | 'custom')[] = ['seasonal', 'holiday_episodes', 'basic', 'custom', 'film_series', 'imdb_chart', 'streaming', 'universe', 'show_franchise'];

const CollectionsTable: FC<{ rows: Row[]; tz: string; csrf: string }> = ({ rows, tz, csrf }) => (
  <div class="table-wrap">
    <table class="tt">
      <thead><tr><th scope="col">Collection</th><th scope="col" class="hide-sm">Window</th><th scope="col">Status</th><th scope="col" class="r">Items</th><th scope="col" class="hide-md">Next change</th><th scope="col" class="hide-sm">Sources</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr class={r.status.kind === 'off' ? 'faint' : ''}>
            <td class="coll"><a href={`/collections/${r.def.id}`}>{r.def.name}</a>{r.pending ? <> <span class="chip">{r.pending} to review</span></> : null}</td>
            <td class="hide-sm num nowrap">{r.def.window?.type === 'range' ? `${r.def.window.from}–${r.def.window.to}` : r.def.window ? 'rule' : 'always'}</td>
            <td>
              {r.status.kind === 'live' ? <span class="chip solid">Live</span> : r.status.kind === 'scheduled' ? <span class="chip">Scheduled</span> : <span class="chip faint">{r.status.label}</span>}
              {r.status.kind === 'off' && r.def.presetKey ? (
                <form method="post" action={`/collections/${r.def.id}/enabled`} class="inline-form"><Csrf token={csrf} /><button class="btn sm" type="submit" name="enabled" value="1">Turn on</button></form>
              ) : null}
            </td>
            <td class="r num">{r.items ?? '—'}</td>
            <td class="hide-md num">{r.next ? `${r.next.kind} ${fmtDate(r.next.at, tz)}` : '—'}</td>
            <td class="hide-sm">{r.sources.map((s) => <span class="nowrap"><Dot state={srcDot(s.status)} label={s.status} /> {s.label} </span>)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

export const CollectionsList: FC<{ rows: Row[]; tz: string; csrf: string }> = ({ rows, tz, csrf }) => (
  <>
    <header class="top">
      <h1>Collections</h1>
      <div class="actions"><a class="btn" href="/adoption">Existing box sets</a><a class="btn primary" href="/collections/new"><Icon name="plus" /> New collection</a></div>
    </header>
    <div class="content">
      {FAMILY_ORDER.map((fam) => {
        const group = rows.filter((r) => familyOf(r.def.presetKey) === fam);
        if (!group.length) return null;
        const on = group.filter((r) => r.def.enabled).length;
        const id = `fam-${fam}`;
        const title = <>{FAMILY_LABEL[fam]} <span class="faint num">{on} of {group.length} on</span></>;
        // A family with nothing turned on folds away, so 44 optional presets don't crowd the page.
        return on === 0 && fam !== 'custom' ? (
          <details class="family" aria-labelledby={id}>
            <summary><h2 id={id}>{title}</h2><span class="faint">Ready-made collections. Turn on the ones you want; nothing is created until then.</span></summary>
            <CollectionsTable rows={group} tz={tz} csrf={csrf} />
          </details>
        ) : (
          <section class="family" aria-labelledby={id}>
            <div class="section-head"><h2 id={id}>{title}</h2></div>
            <CollectionsTable rows={group} tz={tz} csrf={csrf} />
          </section>
        );
      })}
    </div>
  </>
);

const ACTIONS: [ActionType, string][] = [
  ['collection.create', 'Create and delete box set'],
  ['collection.add_items', 'Add items'],
  ['collection.remove_items', 'Remove items'],
  ['collection.update_metadata', 'Update metadata'],
];

export const CollectionEditor: FC<{
  def: LoadedDefinition; tz: string; csrf: string; live: boolean; globalModes: Record<string, string>;
  sources: { id: number; label: string; status: string; error: string | null; listed: number; matched: number; role: string; fetchedAt: number | null }[];
  arr: { addMissing: boolean; radarr: boolean; sonarr: boolean; cap: number };
  /** The preset's own poster (its key), when the collection is a preset with one to go back to (ADR-042). */
  posterDefault?: string | null;
}> = ({ def, tz, csrf, live, globalModes, sources, arr, posterDefault }) => {
  const arrApp = def.target === 'movies' ? 'Radarr' : def.target === 'shows' ? 'Sonarr' : def.target === 'both' ? 'Radarr and Sonarr' : null;
  const today = localDay(Date.now(), tz);
  const next = def.window ? transitions(def.window, today, 3) : [];
  const w = def.window?.type === 'range' ? def.window : null;
  return (
    <>
      <header class="top">
        <nav class="crumbs" aria-label="Breadcrumb"><a href="/collections">Collections</a><span aria-hidden="true">/</span><span>{def.presetKey ? 'Preset' : 'Custom'}</span></nav>
        <h1>{def.name}</h1>
        {def.presetKey ? <span class="chip">Preset · {FAMILY_LABEL[familyOf(def.presetKey)]}</span> : null}
        {live ? <span class="chip solid">Live</span> : next[0]?.kind === 'opens' ? <span class="chip y">Opens {fmtDate(localMidnight(next[0].day, tz), tz)}</span> : null}
        <div class="actions">
          <a class="btn jump" href="#pv-h"><Icon name="eye" /> Live preview</a>
          <button class="btn primary" type="submit" form="def-form">Save changes</button>
        </div>
      </header>
      <div class="content">
        <div class="editor">
          <div class="editor-main">
          <form id="def-form" class="form" method="post" action={`/collections/${def.id}`} aria-label="Collection definition">
            <Csrf token={csrf} />
            <section class="form-sec" aria-labelledby="basics-h">
              <div class="section-head"><h2 id="basics-h">Basics</h2></div>
              <div class="field"><label for="f-name">Name</label><input id="f-name" name="name" type="text" value={def.name} required maxlength={200} /><span class="hint">If you compare with Plex, keep this the same as the Plex collection’s name.</span></div>
              <div class="field"><label class="check"><input type="checkbox" name="enabled" value="1" checked={def.enabled} /> Enabled</label><span class="hint">Turning a collection off removes its box set on the next run, following the delete mode. Its films stay in your library.</span></div>
              <div class="field"><label for="f-sum">Overview</label><textarea id="f-sum" name="overview" rows={2}>{def.overview ?? ''}</textarea></div>
            </section>

            <section class="form-sec" aria-labelledby="sched-h">
              <div class="section-head"><h2 id="sched-h">Schedule</h2></div>
              {w || !def.window ? <ScheduleFields from={w?.from} to={w?.to} /> : <p class="muted">Relative rule (from the preset)</p>}
              {next.length ? (
                <table class="mini-tt num" aria-label="Next changes for this collection">
                  {next.map((t) => (
                    <tr><td>{fmtDate(localMidnight(t.day, tz), tz, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</td><td>{fmtTime(localMidnight(t.day, tz), tz)}</td><td><span class={t.kind === 'opens' ? 'chg-open' : 'chg-close'}>{t.kind}</span></td><td>{t.kind === 'opens' ? 'create box set and add members' : 'delete box set; keep poster, sort title, overview'}</td></tr>
                  ))}
                </table>
              ) : null}
              <div class="field"><span class="label">When the window is closed</span>
                <div class="choice" role="radiogroup">
                  <label><input type="radio" name="visibility" value="delete" checked={def.visibility === 'delete'} /><b>Delete the box set (default)</b><span>Recreated with the same poster, sort title and overview when the window opens.</span></label>
                  <label><input type="radio" name="visibility" value="tag_gate" checked={def.visibility === 'tag_gate'} /><b>Keep it, hidden with a blocked tag</b><span>The box set keeps its films, poster and ID between seasons and is shown again when the window opens. Adds the tag <code>maverick-collections:hidden</code> to every Jellyfin user’s blocked tags, including new users. Films stay visible.</span></label>
                </div>
              </div>
            </section>

            <section class="form-sec" aria-labelledby="src-h">
              <div class="section-head"><h2 id="src-h">Sources</h2><span class="aside">Merged · last good result kept on failure</span></div>
              <div class="table-wrap">
                <table class="tt">
                  <thead><tr><th scope="col">Source</th><th scope="col" class="r">Listed</th><th scope="col" class="r">Owned</th><th scope="col" class="hide-sm">Status</th><th scope="col"><span class="sr">Actions</span></th></tr></thead>
                  <tbody>
                    {sources.length === 0 ? <tr><td colspan={5} class="muted">No sources yet. Add one below.</td></tr> : null}
                    {sources.map((s) => (
                      <tr>
                        <td class="srcname"><b>{s.label}{s.role === 'suggest' ? <> <span class="chip">suggests</span></> : null}</b>{s.error && s.status !== 'ok' ? <div class="faint">{s.error}</div> : null}</td>
                        <td class="r num">{s.listed || '—'}</td>
                        <td class="r num">{s.matched || '—'}</td>
                        <td class="hide-sm nowrap"><Dot state={srcDot(s.status)} label={s.status} /> {s.status === 'ok' ? `OK ${s.fetchedAt ? fmtAgo(s.fetchedAt) : ''}` : s.status === 'stale' ? 'From cache' : s.status === 'failed' ? 'Failing' : 'Not fetched yet'}</td>
                        <td class="r nowrap">
                          <button class="btn sm ghost" type="submit" form="src-rows" name="op" value={`role:${s.id}:${s.role === 'add' ? 'suggest' : 'add'}`} title={s.role === 'add' ? 'Send this source’s titles to Review as suggestions instead of adding them' : 'Add this source’s titles directly'}>{s.role === 'add' ? 'Make suggestion' : 'Make direct'}</button>
                          <button class="btn sm ghost" type="submit" form="src-rows" name="op" value={`remove:${s.id}`} aria-label={`Remove ${s.label}`}><Icon name="x" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div class="addsrc" role="group" aria-label="Add a source">
                <div class="field"><label for="src-type">Add a source</label>
                  <select id="src-type" name="type" form="src-form">{SOURCE_INPUTS.map((x) => <option value={x.key}>{x.label}</option>)}</select>
                </div>
                <div class="field grow"><label for="src-value">List, keywords or IDs</label><input id="src-value" name="value" type="text" form="src-form" placeholder="ID, URL or keywords" /></div>
                <div class="field"><label for="src-role">Titles</label>
                  <select id="src-role" name="role" form="src-form"><option value="add">Add directly</option><option value="suggest">Suggest for review</option></select>
                </div>
                <button class="btn" type="submit" form="src-form" name="op" value="add"><Icon name="plus" /> Add</button>
              </div>
              <details class="more"><summary>What to enter for each type</summary><SourceExamples /></details>
              <p class="hint">IDs or the URL from your browser both work. The next run fetches a new source; until then the preview can’t show its titles.</p>
            </section>

            <section class="form-sec" aria-labelledby="out-h">
              <div class="section-head"><h2 id="out-h">Output in Jellyfin</h2></div>
              <div class="grid3">
                <div class="field"><label for="f-min">Minimum items</label><input id="f-min" name="minItems" type="number" min={1} max={1000} value={String(def.minItems)} class="num" /><span class="hint">Below this, the box set isn’t created (or is deleted).</span></div>
                <div class="field"><span class="label" id="sm-l">Sync mode</span><Seg name="syncMode" value={def.syncMode} options={[['sync', 'Sync'], ['append', 'Append']]} label="Sync mode" /><span class="hint">Sync removes items that leave every source.</span></div>
                <div class="field"><span class="label">Home screen</span><input type="hidden" name="homeRowForm" value="1" /><label class="check"><input type="checkbox" name="homeRow" value="1" checked={def.homeRow} /> Show as a row while it’s live</label><span class="hint">Needs Home Screen Sections and Collection Sections; see Settings → Home-screen rows.</span></div>
                <div class="field"><label for="f-st">Sort title</label><input id="f-st" name="sortTitle" type="text" value={def.sortTitle ?? ''} /><span class="hint">Jellyfin 12.4 stores !00_ as !0000000000_, which still sorts first.</span></div>
              </div>
            </section>

            {arrApp ? (
              <section class="form-sec" aria-labelledby="arr-h">
                <div class="section-head"><h2 id="arr-h">Missing titles</h2><span class="aside"><a href={`/missing?tab=${def.target === 'shows' ? 'shows' : 'movies'}&def=${def.id}`}>See what’s missing</a></span></div>
                <input type="hidden" name="arrForm" value="1" />
                <label class="check"><input type="checkbox" name="arrAddMissing" value="1" checked={arr.addMissing} disabled={!arr.radarr && !arr.sonarr} /> Send missing titles to {arrApp} while the collection is open</label>
                <p class="hint">{!arr.radarr && !arr.sonarr ? `Connect ${arrApp} in Settings first. ` : ''}Each run looks up the {25} best-ranked missing titles and proposes the released ones that {arrApp} doesn’t have or exclude. Adds follow the Radarr/Sonarr modes in Settings (Review by default), at most {arr.cap} automatic adds per run.</p>
              </section>
            ) : null}

            <section class="form-sec" aria-labelledby="modes-h">
              <div class="section-head"><h2 id="modes-h">Action modes for this collection</h2></div>
              <p class="muted">“Default” follows Settings ({ACTIONS.map(([t, l]) => `${l.toLowerCase()}: ${globalModes[t]}`).join(', ')}).</p>
              <table class="modes">
                <thead><tr><th scope="col">Action</th><th scope="col">Mode</th></tr></thead>
                <tbody>
                  {ACTIONS.map(([t, label]) => (
                    <tr><td>{label}</td><td><Seg name={`mode:${t}`} value={def.modes[t] ?? 'default'} options={[['default', 'Default'], ['off', 'Off'], ['review', 'Review'], ['auto', 'Auto']]} label={label} /></td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          </form>
          <section class="form-sec" aria-labelledby="poster-h">
            <div class="section-head"><h2 id="poster-h">Poster</h2><span class="aside">the only image its box set carries</span></div>
            <div class="poster-edit">
              {def.poster.kind !== 'none'
                ? <img src={`/collections/${def.id}/poster?v=${encodeURIComponent(def.poster.kind === 'url' ? def.poster.url : def.poster.file)}`} alt={`${def.name}’s poster`} width={120} height={180} />
                : <div class="poster-none" role="img" aria-label="No poster">No poster</div>}
              <form method="post" action={`/collections/${def.id}/poster`} enctype="multipart/form-data" class="form">
                <Csrf token={csrf} />
                <label class="check"><input type="radio" name="poster" value="url" checked={def.poster.kind === 'url' && posterKey(def.poster) !== posterDefault} /> Image address</label>
                <input type="url" name="posterUrl" placeholder="https://…/poster.jpg" value={def.poster.kind === 'url' ? def.poster.url : ''} aria-label="Image address" />
                <label class="check"><input type="radio" name="poster" value="upload" checked={def.poster.kind === 'file'} /> Upload an image</label>
                <input type="file" name="posterFile" accept="image/jpeg,image/png,image/webp" aria-label="Image to upload" />
                {posterDefault ? <label class="check"><input type="radio" name="poster" value="default" checked={posterKey(def.poster) === posterDefault} /> The preset’s own poster</label> : null}
                <label class="check"><input type="radio" name="poster" value="none" checked={def.poster.kind === 'none'} /> No poster</label>
                <p class="hint">JPEG, PNG or WebP, up to 10 MB. Saving puts it on the box set in Jellyfin straight away. Uploads are kept in <code>/config/posters</code>.</p>
                <div class="actions-row"><button class="btn" type="submit">Save poster</button></div>
              </form>
            </div>
          </section>
          <form id="src-form" method="post" action={`/collections/${def.id}/sources`} hidden><Csrf token={csrf} /></form>
          <form id="src-rows" method="post" action={`/collections/${def.id}/sources`} hidden><Csrf token={csrf} /></form>
          {!def.presetKey ? (
            <form method="post" action={`/collections/${def.id}/delete`} class="danger-zone">
              <Csrf token={csrf} />
              <p class="muted">{live ? 'This collection has a box set in Jellyfin. Turn it off and run once to remove the box set, then you can delete the collection.' : 'Deleting removes this collection’s definition, sources, pins and history of decisions.'}</p>
              <button class="btn danger" type="submit" disabled={live}>Delete collection</button>
            </form>
          ) : null}
          </div>

          <aside class="preview" aria-labelledby="pv-h">
            <section class="panel">
              <div class="section-head"><h2 id="pv-h">Live preview</h2><span class="aside">from cached sources</span></div>
              <div hx-get={`/collections/${def.id}/preview`} hx-trigger="load" hx-swap="innerHTML">
                <p class="muted">Loading matches…</p>
              </div>
            </section>
            <section class="panel" aria-labelledby="par-h">
              <div class="section-head"><h2 id="par-h">Plex parity</h2><span class="aside">vs Plex</span></div>
              <div hx-get={`/collections/${def.id}/parity`} hx-trigger="load" hx-swap="innerHTML">
                <p class="muted">Comparing with Plex…</p>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </>
  );
};

const SourceExamples: FC = () => <ul class="hint-list">{SOURCE_INPUTS.map((x) => <li><b>{x.label}</b>: {x.placeholder}</li>)}</ul>;

const ScheduleFields: FC<{ from?: string; to?: string }> = ({ from, to }) => (
  <>
    <div class="choice" role="radiogroup" aria-label="Schedule">
      <label><input type="radio" name="schedule" value="always" checked={!from} /><b>Always on</b><span>The box set exists all year.</span></label>
      <label><input type="radio" name="schedule" value="range" checked={Boolean(from)} /><b>Between two dates each year</b><span>Created at midnight on the first day, deleted after the last. Ranges can wrap past New Year.</span></label>
    </div>
    <div class="grid2">
      <div class="field"><label for="f-from">From (MM/DD)</label><input id="f-from" name="from" type="text" value={from ?? ''} pattern="\d{1,2}/\d{1,2}" class="num" placeholder="12/01" /></div>
      <div class="field"><label for="f-to">To, inclusive (MM/DD)</label><input id="f-to" name="to" type="text" value={to ?? ''} pattern="\d{1,2}/\d{1,2}" class="num" placeholder="12/31" /></div>
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
          <div class="section-head"><h2 id="n-basics">Basics</h2></div>
          <div class="field"><label for="n-name">Name</label><input id="n-name" name="name" type="text" value={values.name ?? ''} required maxlength={200} placeholder="Heist Movies" /></div>
          <div class="field"><span class="label">Contains</span><Seg name="target" value={values.target ?? 'movies'} options={[['movies', 'Films'], ['shows', 'Shows'], ['episodes', 'Episodes']]} label="Contains" /></div>
        </section>
        <section class="form-sec" aria-labelledby="n-sched">
          <div class="section-head"><h2 id="n-sched">Schedule</h2></div>
          <ScheduleFields from={values.from || undefined} to={values.to || undefined} />
        </section>
        <section class="form-sec" aria-labelledby="n-src">
          <div class="section-head"><h2 id="n-src">First source</h2><span class="aside">You can add more in the editor</span></div>
          <div class="grid2">
            <div class="field"><label for="n-type">Type</label><select id="n-type" name="type">{SOURCE_INPUTS.map((x) => <option value={x.key} selected={values.type === x.key}>{x.label}</option>)}</select></div>
            <div class="field"><label for="n-value">List, keywords or IDs</label><input id="n-value" name="value" type="text" value={values.value ?? ''} required /></div>
          </div>
          <SourceExamples />
        </section>
        <div><button class="btn primary" type="submit">Create collection</button></div>
        <p class="hint">Dry run and your modes apply as usual: nothing changes in Jellyfin until the next run plans it and it’s approved.</p>
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
      {same ? <p class="muted">Same titles in both. Parity.</p> : null}
      {list('In Plex, not in your Jellyfin library', p.plexOnlyNotInLibrary, 'Plex has these and Jellyfin doesn’t, or Jellyfin has them without matching IMDb/TMDb IDs.')}
      {list('In both libraries, not picked here', p.plexOnlyNotPlanned, 'Usually a source difference: an IMDb list or search returned it for Plex but not here, or a library isn’t selected in Settings. Pin it if you want it.')}
      {list('Planned here, not in Plex', p.hereOnly, 'Often titles from a library Plex doesn’t have, or a list that changed since Plex’s collection was last built.')}
    </>
  );
};

export type PreviewItem = { jfId: string; name: string; year: number | null; provenance: Provenance; inBoxSet: boolean };

export const Preview: FC<{ defId: number; items: PreviewItem[]; excluded: { jfId: string; name: string }[]; csrf: string; total: number }> = ({ defId, items, excluded, csrf, total }) => (
  <>
    <p class="muted">{total} {total === 1 ? 'title matches' : 'titles match'} right now{excluded.length ? `, ${excluded.length} excluded` : ''}.</p>
    {items.map((it) => (
      <div class="item">
        <span class="poster type" aria-hidden="true">{it.name}</span>
        <div>
          <div class="t">{it.name}{it.year ? <span class="y num">{it.year}</span> : null}</div>
          <div class="why">
            {it.provenance.pinned ? <span class="chip solid"><Icon name="pin" /> Pinned by you</span> : null}
            {it.provenance.sources.map((s) => <span class="chip">{s.label} #{s.rank}</span>)}
            {it.provenance.sources.length ? <span class="chip">{it.provenance.match}</span> : null}
            {it.inBoxSet ? <span class="chip">in box set</span> : null}
          </div>
        </div>
        <div class="side">
          <form method="post" action={`/collections/${defId}/pins`} class="inline-form">
            <input type="hidden" name="_csrf" value={csrf} /><input type="hidden" name="jfId" value={it.jfId} />
            {it.provenance.pinned
              ? <button class="btn sm ghost" type="submit" name="kind" value="clear" aria-label={`Unpin ${it.name}`}><Icon name="x" /></button>
              : <button class="btn sm ghost" type="submit" name="kind" value="pin" aria-label={`Pin ${it.name}`}><Icon name="pin" /></button>}
            <button class="btn sm ghost" type="submit" name="kind" value="exclude" aria-label={`Exclude ${it.name}`}><Icon name="ban" /></button>
          </form>
        </div>
      </div>
    ))}
    {excluded.length ? (
      <details class="more"><summary>Excluded ({excluded.length})</summary>
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
