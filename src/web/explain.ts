// Why a collection has the titles it has (ADR-034): for every title its sources list, the first reason it isn't a
// member, or that it is one. Reads cached source results and the library index only (no network), like the preview.
import type { AppContext } from '../app-context.js';
import type { LoadedDefinition } from '../domain/definitions.js';
import { passesFilters } from '../pipeline/planner.js';
import { cachedPlan } from './plan-cache.js';
import { librariesModel } from './model.js';

export type Verdict = 'member' | 'suggested' | 'excluded' | 'filtered out' | 'outside the chosen libraries' | 'wrong kind' | 'not in your library';
export const VERDICTS: Verdict[] = ['member', 'suggested', 'excluded', 'filtered out', 'outside the chosen libraries', 'wrong kind', 'not in your library'];

export type ExplainedItem = { title: string; year: number | null; verdict: Verdict; detail?: string; jfId?: string };

export function explainCollection(app: AppContext, def: LoadedDefinition) {
  const plan = cachedPlan(app, def);
  if (!plan) return null;
  const { index, resolved } = plan;
  const s = app.settings();
  const libs = librariesModel(app);
  const libName = new Map(libs.map((l) => [l.id, l.name]));
  const movieIds = s.movieLibraryIds ?? libs.filter((l) => l.collectionType === 'movies').map((l) => l.id);
  const showIds = s.showLibraryIds ?? libs.filter((l) => l.collectionType === 'tvshows').map((l) => l.id);
  const scope = new Set(def.libraryIds ?? (def.target === 'movies' ? movieIds : def.target === 'shows' || def.target === 'episodes' ? showIds : [...movieIds, ...showIds]));
  const want = def.target === 'movies' ? 'movie' : def.target === 'shows' ? 'series' : def.target === 'episodes' ? 'episode' : 'any';

  const sources = def.sources.map((src, i) => {
    const r = resolved[i];
    const items: ExplainedItem[] = [];
    for (const item of r?.items ?? []) {
      const title = item.title ?? item.imdb ?? (item.tmdb ? `TMDb ${item.tmdb}` : item.tvdb ? `TVDB ${item.tvdb}` : 'untitled');
      const m = index.matchDirect(item, 'any');
      if (!m) { items.push({ title, year: item.year ?? null, verdict: 'not in your library' }); continue; }
      const row = index.get(m.jfId)!;
      const base = { title: index.displayName(row), year: row.kind === 'episode' ? null : row.year, jfId: row.jfId };
      const lib = row.kind === 'episode' && row.seriesJfId ? index.get(row.seriesJfId)?.libraryId : row.libraryId;
      if (want !== 'any' && row.kind !== want) items.push({ ...base, verdict: 'wrong kind', detail: `It's a ${row.kind}; this collection holds ${def.target}.` });
      else if (!lib || !scope.has(lib)) items.push({ ...base, verdict: 'outside the chosen libraries', detail: `It's in ${libName.get(lib ?? '') ?? 'an unknown library'}, which this collection doesn't use (Settings → Libraries).` });
      else if (!passesFilters(row, def)) items.push({ ...base, verdict: 'filtered out', detail: 'Doesn\'t pass the collection\'s filters.' });
      else if (def.excludes.has(row.jfId)) items.push({ ...base, verdict: 'excluded', detail: 'Excluded on this collection.' });
      else if (src.role === 'suggest') items.push({ ...base, verdict: 'suggested', detail: 'This source asks before adding; its titles wait in your Inbox.' });
      else items.push({ ...base, verdict: 'member' });
    }
    const counts = Object.fromEntries(VERDICTS.map((v) => [v, items.filter((x) => x.verdict === v).length]).filter(([, n]) => n)) as Partial<Record<Verdict, number>>;
    return { sourceId: src.id, source: r?.label ?? src.type, role: src.role, status: r?.status ?? 'unknown', error: r?.error ?? null, listed: r?.items.length ?? 0, counts, items };
  });
  return { members: plan.members.size, minimum: def.minItems, sources };
}
