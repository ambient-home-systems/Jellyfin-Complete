// Film series (ADR-035): keep one collection for every TMDb film series the library has at least the minimum number of
// films of, like Kometa's movie "franchise" default. Runs at the start of each run, after indexing. Which series a film
// belongs to comes from Jellyfin (its TmdbCollection provider ID); if Jellyfin records none at all, from TMDb, a few
// hundred films per run, cached. New series become new collections; existing ones gain IDs but are never rewritten,
// so edits stay. A series that drops below the minimum keeps its collection definition; the planner removes the box set.
import { eq, like } from 'drizzle-orm';
import type { AppContext } from '../app-context.js';
import { definition, definitionSource, libraryItem } from '../db/schema.js';
import { insertDefinition } from '../domain/definitions.js';
import { getCached } from '../cache.js';
import { log } from '../log.js';
import { filmSeriesDefinition, SERIES_EXTRA_FILMS, SERIES_OF, SERIES_PREFIX } from '../presets/film-series.js';

export type FilmSeriesResult = { series: number; created: number; lookedUp: number; problem: string | null };

export async function syncFilmSeries(app: AppContext, opts: { lookupCap?: number; step?: (s: string) => void } = {}): Promise<FilmSeriesResult> {
  const settings = app.settings().filmSeries;
  const out: FilmSeriesResult = { series: 0, created: 0, lookedUp: 0, problem: null };
  if (!settings.enabled) return out;
  const tmdb = app.tmdb();
  const films = app.db.select({ jfId: libraryItem.jfId, tmdb: libraryItem.tmdb, series: libraryItem.tmdbCollection }).from(libraryItem).where(eq(libraryItem.kind, 'movie')).all();

  // Jellyfin's TMDb metadata records each film's series. Only if it recorded none at all, ask TMDb (cached for 30 days).
  if (tmdb && films.length && !films.some((f) => f.series)) {
    opts.step?.('Finding film series on TMDb');
    const cap = opts.lookupCap ?? 300;
    for (const f of films) {
      if (!f.tmdb) continue;
      const hit = getCached<string | null>(app.db, `movie-collection:${f.tmdb}`);
      let series: string | null = null;
      if (hit.hit) series = hit.value;
      else if (out.lookedUp < cap) {
        try {
          series = await tmdb.movieCollection(f.tmdb);
          out.lookedUp++;
        } catch (e) {
          log.warn(`TMDb film lookup failed: ${(e as Error).message}`);
          break;
        }
      } else continue;
      if (series) {
        f.series = series;
        app.db.update(libraryItem).set({ tmdbCollection: series }).where(eq(libraryItem.jfId, f.jfId)).run();
      }
    }
  }

  // Films per series, folding add-on series into their main one, plus Kometa's extra films.
  const owned = new Map<string, Set<string>>();
  const add = (series: string, jfId: string) => owned.set(series, (owned.get(series) ?? new Set()).add(jfId));
  for (const f of films) if (f.series) add(SERIES_OF[f.series] ?? f.series, f.jfId);
  const byTmdb = new Map(films.filter((f) => f.tmdb).map((f) => [f.tmdb!, f.jfId]));
  for (const [series, extra] of Object.entries(SERIES_EXTRA_FILMS)) for (const id of extra) { const jf = byTmdb.get(id); if (jf && owned.has(series)) add(series, jf); }

  const wanted = [...owned.entries()].filter(([, s]) => s.size >= settings.minimum).map(([id]) => id);
  out.series = wanted.length;
  const existing = new Map(app.db.select({ id: definition.id, key: definition.presetKey }).from(definition).where(like(definition.presetKey, `${SERIES_PREFIX}%`)).all().map((d) => [d.key!.slice(SERIES_PREFIX.length), d.id]));
  const fresh = wanted.filter((id) => !existing.has(id));
  if (fresh.length && !tmdb) {
    out.problem = `${fresh.length} film series need a TMDb key for their names and posters (Settings → Connections).`;
    return out;
  }
  if (fresh.length) opts.step?.(`Adding ${fresh.length} film series`);
  for (const id of fresh) {
    try {
      const details = await tmdb!.collectionDetails(id);
      if (!details) continue; // TMDb no longer has it
      insertDefinition(app.db, filmSeriesDefinition(id, details, settings.minimum), { enabled: true, homeRow: false });
      out.created++;
    } catch (e) {
      log.warn(`TMDb collection ${id} failed: ${(e as Error).message}`);
      break; // try the rest next run
    }
  }

  // Existing series gain any IDs Kometa's data now has (add-ons, extra films); nothing else changes.
  for (const [id, defId] of existing) {
    const want = filmSeriesDefinition(id, { name: '', overview: null, posterPath: null }, settings.minimum).sources;
    const mine = app.db.select().from(definitionSource).where(eq(definitionSource.definitionId, defId)).all();
    for (const w of want) {
      const src = mine.find((s) => s.type === w.type);
      const ids = (w.config as { ids: string[] }).ids;
      if (!src) { app.db.insert(definitionSource).values({ definitionId: defId, type: w.type, config: w.config, role: 'add', position: mine.length }).run(); continue; }
      const have = ((src.config as { ids?: unknown[] }).ids ?? []).map(String);
      const missing = ids.filter((x) => !have.includes(x));
      if (missing.length) app.db.update(definitionSource).set({ config: { ...(src.config as object), ids: [...have, ...missing] } }).where(eq(definitionSource.id, src.id)).run();
    }
  }
  return out;
}

/** Turn film series on or off: the setting, and every film series collection with it. Optionally a new minimum. */
export function setFilmSeries(app: AppContext, enabled: boolean, minimum?: number): void {
  const s = app.settings().filmSeries;
  const min = minimum ?? s.minimum;
  app.updateSettings({ filmSeries: { enabled, minimum: min } });
  const set: Partial<typeof definition.$inferInsert> = { enabled, updatedAt: Date.now() };
  if (minimum !== undefined) set.minItems = min;
  app.db.update(definition).set(set).where(like(definition.presetKey, `${SERIES_PREFIX}%`)).run();
}
