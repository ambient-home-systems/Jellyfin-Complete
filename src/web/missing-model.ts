// Data for the Missing page: per collection, the titles its sources list that you don't own, with their Radarr or
// Sonarr status. Reads cached sources and Radarr/Sonarr's own lists (cached 5 minutes); never looks titles up one by one.
import { libraryItem } from '../db/schema.js';
import type { AppContext } from '../app-context.js';
import { loadDefinitions, type LoadedDefinition } from '../domain/definitions.js';
import { LibraryIndex, type LibRow } from '../domain/matching.js';
import { missingTitles, statusOf, type MissingStatus, type MissingTitle } from '../domain/missing.js';
import { arrOptions, arrState } from '../pipeline/arr.js';
import { cachedFind, cachedPlan } from './plan-cache.js';
import type { MissingPageModel, MissingRow } from './pages/missing.js';
import { isOpen, localDay, transitions } from '../domain/windows.js';

export const PAGE_SIZE = 50;

const fits = (d: LoadedDefinition, tab: 'movies' | 'shows') => d.enabled && (d.target === 'both' || d.target === (tab === 'movies' ? 'movies' : 'shows'));

/** Missing titles for one collection and tab, best-ranked first. */
export function missingFor(app: AppContext, def: LoadedDefinition, tab: 'movies' | 'shows', index: LibraryIndex): MissingTitle[] {
  const plan = cachedPlan(app, def, index);
  if (!plan) return [];
  const which = tab === 'movies' ? 'radarr' : 'sonarr';
  return missingTitles(def, plan.resolved, index, cachedFind(app)).filter((m) => m.app === which);
}

export async function missingModel(app: AppContext, tab: 'movies' | 'shows', defId: number | null, page: number): Promise<MissingPageModel> {
  const which = tab === 'movies' ? 'radarr' : 'sonarr';
  const s = app.settings();
  const rows = app.db.select().from(libraryItem).all() as LibRow[];
  const index = new LibraryIndex(rows);
  const all = loadDefinitions(app.db);
  const count = (t: 'movies' | 'shows') => all.filter((d) => fits(d, t)).map((d) => ({ def: d, missing: rows.length ? missingFor(app, d, t, index) : [] })).filter((x) => x.missing.length);
  // Collections that are open now come first, then by how soon they open: the page opens on the one that matters next.
  const today = localDay(Date.now(), s.timezone);
  const soon = (d: LoadedDefinition) => (isOpen(d.window, today) ? -1 : (d.window ? (transitions(d.window, today, 2).find((t) => t.kind === 'opens')?.day ?? today + 999) - today : 999));
  const mine = count(tab).sort((a, b) => soon(a.def) - soon(b.def) || a.def.name.localeCompare(b.def.name));
  const other = count(tab === 'movies' ? 'shows' : 'movies');
  const chosen = mine.find((x) => x.def.id === defId) ?? mine[0];
  const client = which === 'radarr' ? app.radarr() : app.sonarr();
  let arrError: string | null = null;
  const state = client ? await arrState(app, which).catch((e: Error) => { arrError = e.message; return null; }) : null;
  const withStatus: MissingRow[] = (chosen?.missing ?? []).map((m) => ({ ...m, status: statusOf(m, state), id: m.keys[0]! }));
  const counts: Partial<Record<MissingStatus, number>> = {};
  for (const r of withStatus) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const pages = Math.max(1, Math.ceil(withStatus.length / PAGE_SIZE));
  const p = Math.min(Math.max(1, page), pages);

  let choices: MissingPageModel['choices'] = null;
  let collections: MissingPageModel['collections'] = [];
  if (client && !arrError) {
    try {
      const [profiles, roots, tags] = await Promise.all([client.qualityProfiles(), client.rootFolders(), client.tags()]);
      choices = { profiles, roots, tags };
      const tmdbIds = (chosen?.def.sources ?? []).filter((x) => x.type === 'tmdb_collection').flatMap((x) => ((x.config.ids ?? []) as unknown[]).map(String));
      if (which === 'radarr' && tmdbIds.length) {
        const radarrColls = await client.collections();
        collections = tmdbIds.map((id) => {
          const c = radarrColls.find((x) => String(x.tmdbId) === id);
          return { tmdbId: id, title: c?.title ?? `TMDb collection ${id}`, radarr: c ? { id: c.id, monitored: c.monitored, missingMovies: c.missingMovies } : null };
        });
      }
    } catch (e) {
      arrError = (e as Error).message;
    }
  }

  return {
    tab, which,
    tabCounts: { [tab]: mine.reduce((n, x) => n + x.missing.length, 0), [tab === 'movies' ? 'shows' : 'movies']: other.reduce((n, x) => n + x.missing.length, 0) } as MissingPageModel['tabCounts'],
    defs: mine.map((x) => ({ id: x.def.id, name: x.def.name, count: x.missing.length })),
    defId: chosen?.def.id ?? null, defName: chosen?.def.name ?? null,
    rows: withStatus.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE), total: withStatus.length, page: p, pages, counts,
    connected: Boolean(client), arrError, choices, values: arrOptions(app, which, chosen?.def.id ?? null), collections,
    cap: s.guardrails.arrCapPerRun, dryRun: s.dryRun,
  };
}
