/** @jsxImportSource hono/jsx */
// Missing (Phase 2, docs/mockups/missing.html): what each collection's sources list that you don't own, and sending it
// to Radarr or Sonarr. Every send re-checks released, already present and excluded first (ADR-007).
import type { FC } from 'hono/jsx';
import { Csrf, Icon, InboxTabs, type InboxCounts } from '../ui.js';
import type { ArrOptions } from '../../db/schema.js';
import type { ArrApp, Option, RootFolder } from '../../clients/arr.js';
import type { MissingStatus, MissingTitle } from '../../domain/missing.js';

export type ArrChoices = { profiles: Option[]; roots: RootFolder[]; tags: Option[] };

const SONARR_MONITOR: [string, string][] = [['all', 'All episodes'], ['future', 'Future episodes'], ['missing', 'Missing episodes'], ['existing', 'Existing episodes'], ['firstSeason', 'First season'], ['lastSeason', 'Last season'], ['pilot', 'Pilot only'], ['none', 'None']];
const gb = (b: number | null) => (b === null ? '' : ` · ${Math.round(b / 1e9).toLocaleString('en-US')} GB free`);

/** Quality profile, root folder, tags and the rest, read live from Radarr/Sonarr. Shared by Settings and Missing. */
export const ArrOptionsFields: FC<{ which: ArrApp; values: ArrOptions; choices: ArrChoices; idPrefix: string }> = ({ which, values, choices, idPrefix }) => (
  <div class="arr-fields">
    <div class="field"><label for={`${idPrefix}-qp`}>Quality profile</label>
      <select id={`${idPrefix}-qp`} name="qualityProfileId">
        <option value="">Choose…</option>
        {choices.profiles.map((p) => <option value={String(p.id)} selected={values.qualityProfileId === p.id}>{p.name}</option>)}
      </select></div>
    <div class="field"><label for={`${idPrefix}-rf`}>Root folder</label>
      <select id={`${idPrefix}-rf`} name="rootFolderPath">
        <option value="">Choose…</option>
        {choices.roots.map((r) => <option value={r.path} selected={values.rootFolderPath === r.path} disabled={!r.accessible}>{r.path}{gb(r.freeSpace)}{r.accessible ? '' : ' · not accessible'}</option>)}
      </select></div>
    {which === 'radarr' ? (
      <div class="field"><label for={`${idPrefix}-ma`}>Minimum availability</label>
        <select id={`${idPrefix}-ma`} name="minimumAvailability">
          {([['released', 'Released'], ['inCinemas', 'In cinemas'], ['announced', 'Announced']] as const).map(([v, l]) => <option value={v} selected={(values.minimumAvailability ?? 'released') === v}>{l}</option>)}
        </select></div>
    ) : (
      <>
        <div class="field"><label for={`${idPrefix}-st`}>Series type</label>
          <select id={`${idPrefix}-st`} name="seriesType">
            {([['standard', 'Standard'], ['anime', 'Anime'], ['daily', 'Daily']] as const).map(([v, l]) => <option value={v} selected={(values.seriesType ?? 'standard') === v}>{l}</option>)}
          </select></div>
        <div class="field"><label for={`${idPrefix}-mon`}>Monitor</label>
          <select id={`${idPrefix}-mon`} name="monitor">{SONARR_MONITOR.map(([v, l]) => <option value={v} selected={(values.monitor ?? 'all') === v}>{l}</option>)}</select></div>
        <label class="check"><input type="checkbox" name="seasonFolder" value="1" checked={values.seasonFolder !== false} /> Season folders</label>
      </>
    )}
    {choices.tags.length ? (
      <fieldset class="plain"><legend class="label">Tags</legend>
        <div class="checks">{choices.tags.map((t) => <label class="check"><input type="checkbox" name="tags" value={String(t.id)} checked={(values.tags ?? []).includes(t.id)} /> {t.name}</label>)}</div>
      </fieldset>
    ) : null}
    <div class="checks">
      <label class="check"><input type="checkbox" name="monitored" value="1" checked={values.monitored !== false} /> Monitored</label>
      <label class="check"><input type="checkbox" name="searchOnAdd" value="1" checked={values.searchOnAdd !== false} /> Search on add</label>
    </div>
  </div>
);

/** Form fields → ArrOptions. Unticked checkboxes are absent from the form, so they read as false. */
export function parseArrOptions(b: Record<string, unknown>, which: ArrApp): ArrOptions {
  const tags = ([] as unknown[]).concat(b.tags ?? []).map(Number).filter((n) => Number.isInteger(n));
  const o: ArrOptions = { tags, monitored: b.monitored === '1', searchOnAdd: b.searchOnAdd === '1' };
  if (b.qualityProfileId) o.qualityProfileId = Number(b.qualityProfileId);
  if (b.rootFolderPath) o.rootFolderPath = String(b.rootFolderPath);
  if (which === 'radarr') {
    const ma = String(b.minimumAvailability ?? 'released');
    o.minimumAvailability = ma === 'announced' || ma === 'inCinemas' ? ma : 'released';
  } else {
    const st = String(b.seriesType ?? 'standard');
    o.seriesType = st === 'anime' || st === 'daily' ? st : 'standard';
    o.monitor = SONARR_MONITOR.some(([v]) => v === b.monitor) ? String(b.monitor) : 'all';
    o.seasonFolder = b.seasonFolder === '1';
  }
  return o;
}

export type MissingRow = MissingTitle & { status: MissingStatus; id: string };
export type MissingPageModel = {
  tab: 'movies' | 'shows';
  which: ArrApp;
  tabCounts: { movies: number; shows: number };
  defs: { id: number; name: string; count: number }[];
  defId: number | null;
  defName: string | null;
  rows: MissingRow[];
  total: number;
  page: number;
  pages: number;
  counts: Partial<Record<MissingStatus, number>>;
  connected: boolean;
  arrError: string | null;
  choices: ArrChoices | null;
  values: ArrOptions;
  collections: { tmdbId: string; title: string; radarr: { id: number; monitored: boolean; missingMovies: number } | null }[];
  cap: number;
  dryRun: boolean;
  /** Whether posters can be shown (they come from TMDb, so they need its key). */
  posters: boolean;
};

/** Where a row's poster comes from; null when it has no ID TMDb can look up. */
const posterSrc = (r: MissingTitle, tab: 'movies' | 'shows'): string | null => {
  const media = tab === 'shows' ? 'tv' : 'movie';
  if (r.tmdb) return `/missing/img/${media}/tmdb/${r.tmdb}`;
  if (r.imdb) return `/missing/img/${media}/imdb/${r.imdb}`;
  return r.tvdb ? `/missing/img/${media}/tvdb/${r.tvdb}` : null;
};

/** "imdb:tt0099785" → "IMDb tt0099785" */
const idLabel = (key: string) => { const [k, v] = key.split(':'); return `${({ imdb: 'IMDb', tmdb: 'TMDb', tvdb: 'TVDB' } as Record<string, string>)[k ?? ''] ?? k} ${v ?? ''}`.trim(); };

const STATUS: Record<MissingStatus, { text: (app: string) => string; cls: string }> = {
  not_in_arr: { text: (a) => `Not in ${a}`, cls: '' },
  in_arr: { text: (a) => `In ${a}`, cls: 'faint' },
  monitored_no_file: { text: () => 'Monitored, no file', cls: 'faint' },
  excluded: { text: () => 'Excluded', cls: 'faint' },
  needs_id: { text: () => 'Needs a TVDB ID', cls: 'faint' },
};

export const Missing: FC<{ m: MissingPageModel; csrf: string; inbox: InboxCounts }> = ({ m, csrf, inbox }) => {
  const app = m.which === 'radarr' ? 'Radarr' : 'Sonarr';
  const href = (o: { tab?: string; def?: number | null; page?: number }) => `/missing?tab=${o.tab ?? m.tab}${(o.def ?? m.defId) ? `&def=${o.def ?? m.defId}` : ''}${o.page && o.page > 1 ? `&page=${o.page}` : ''}`;
  const sendable = (r: MissingRow) => r.status === 'not_in_arr' || (r.status === 'needs_id' && m.which === 'sonarr');
  return (
    <>
      <header class="top">
        <h1>Inbox</h1>
        <InboxTabs at="missing" c={inbox} />
      </header>
      <div class="content">
        <div class="subtabs-row">
          <nav class="subtabs" aria-label="Movies or shows">
            <a href={href({ tab: 'movies', def: null })} aria-current={m.tab === 'movies' ? 'page' : undefined}>Movies <span class="n num">{m.tabCounts.movies}</span></a>
            <a href={href({ tab: 'shows', def: null })} aria-current={m.tab === 'shows' ? 'page' : undefined}>Shows <span class="n num">{m.tabCounts.shows}</span></a>
          </nav>
          <span class="faint">Listed by your collections, not in your library.</span>
        </div>
        {!m.defs.length ? <div class="empty"><h3>Nothing missing</h3><p>Your collections list no {m.tab === 'movies' ? 'movies' : 'shows'} you don’t have, or no run has read them yet.</p></div> : (
          <>
            <form method="get" action="/missing" class="inline-form filter-row">
              <input type="hidden" name="tab" value={m.tab} />
              <label for="mdef">Collection</label>
              <select id="mdef" name="def">{m.defs.map((d) => <option value={String(d.id)} selected={d.id === m.defId}>{d.name} ({d.count})</option>)}</select>
              <button class="btn sm" type="submit">Show</button>
            </form>
            {!m.connected ? <p class="callout"><a href="/settings">Connect {app}</a> to see what it already has and to send titles to it.</p> : null}
            {m.arrError ? <p class="callout err">Couldn’t read {app}: {m.arrError}</p> : null}

            {m.collections.length ? (
              <section class="panel" aria-labelledby="coll-h">
                <div class="section-head"><h2 id="coll-h">Movie series in this collection</h2></div>
                <p class="hint">Monitor a series and Radarr adds its missing movies itself, future ones included. Radarr lists a series once it has one of its movies.</p>
                <ul class="plain-list">
                  {m.collections.map((c) => (
                    <li>
                      <b>{c.title}</b> <span class="faint">TMDb {c.tmdbId}</span>{' '}
                      {!c.radarr ? <span class="chip faint">Not in Radarr yet</span>
                        : c.radarr.monitored ? <span class="chip">Monitored in Radarr · {c.radarr.missingMovies} missing</span>
                        : (
                          <form method="post" action="/missing/monitor" class="inline-form">
                            <Csrf token={csrf} /><input type="hidden" name="def" value={String(m.defId)} /><input type="hidden" name="radarrCollectionId" value={String(c.radarr.id)} /><input type="hidden" name="title" value={c.title} />
                            <button class="btn sm" type="submit">Monitor in Radarr</button> <span class="faint">{c.radarr.missingMovies} missing</span>
                          </form>
                        )}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <form method="post" action="/missing/send" class="missing-layout">
              <Csrf token={csrf} />
              <input type="hidden" name="def" value={String(m.defId)} /><input type="hidden" name="tab" value={m.tab} />
              <section aria-labelledby="miss-h">
                <div class="section-head"><h2 id="miss-h">{m.total.toLocaleString('en-US')} missing from {m.defName}</h2>
                  <span class="aside">{!m.connected ? '' : Object.entries(m.counts).filter(([, n]) => n).map(([k, n]) => { const t = STATUS[k as MissingStatus].text(app); return `${n} ${t[0]!.toLowerCase()}${t.slice(1)}`; }).join(' · ')}</span></div>
                <div class="table-wrap">
                  <table class="tt">
                    <thead><tr><th scope="col"><span class="sr">Select</span></th>{m.posters ? <th scope="col"><span class="sr">Poster</span></th> : null}<th scope="col">Title</th><th scope="col" class="hide-sm">Listed by</th><th scope="col">{app}</th></tr></thead>
                    <tbody>
                      {m.rows.map((r) => (
                        <tr class={sendable(r) ? '' : 'faint'}>
                          <td><input type="checkbox" name="ids" value={r.id} disabled={!sendable(r) || !m.connected} aria-label={`Select ${r.title ?? r.id}`} /></td>
                          {m.posters ? <td class="thumb-cell"><span class="miss-thumb">{posterSrc(r, m.tab) ? <img src={posterSrc(r, m.tab)!} alt="" loading="lazy" width="46" height="69" /> : null}</span></td> : null}
                          <td><b>{r.title ?? r.imdb ?? r.tmdb ?? r.tvdb}</b>{r.year ? <span class="y num"> {r.year}</span> : null}<br /><span class="faint">{r.keys.map(idLabel).join(' · ')}</span></td>
                          <td class="hide-sm">{r.sources.map((s) => <span class="chip">{s.label} #{s.rank}</span>)}</td>
                          <td class="nowrap">{m.connected ? <span class={`chip ${STATUS[r.status].cls}`}>{STATUS[r.status].text(app)}</span> : <span class="faint">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {m.pages > 1 ? (
                  <p class="listfoot">Page {m.page} of {m.pages} · best-ranked first{m.page > 1 ? <> · <a href={href({ page: m.page - 1 })}>previous</a></> : null}{m.page < m.pages ? <> · <a href={href({ page: m.page + 1 })}>next</a></> : null}</p>
                ) : null}
              </section>
              {m.connected && m.choices ? (
                <aside class="panel send-panel" aria-labelledby="send-h">
                  <div class="section-head"><h2 id="send-h">Send to {app}</h2></div>
                  <p class="hint">Defaults come from Settings → Extras.</p>
                  <ArrOptionsFields which={m.which} values={m.values} choices={m.choices} idPrefix="send" />
                  <p class="hint">Each title is checked first: released, not in {app}, not excluded. Up to {m.cap} per send, straight away.</p>
                  <div class="actions-row">
                    <button class="btn primary" type="submit" name="mode" value="send"><Icon name="plus" /> Send to {app}</button>
                    <button class="btn" type="submit" name="mode" value="review" title="Add them to Collection changes, to approve later">Add to Inbox instead</button>
                  </div>
                </aside>
              ) : null}
            </form>
          </>
        )}
      </div>
    </>
  );
};
