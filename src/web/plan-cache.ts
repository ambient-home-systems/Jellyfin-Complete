// A collection's plan as the next run would see it, from cached source results only (no network).
// Used by the editor preview, Plex parity and the Missing page.
import { eq } from 'drizzle-orm';
import type { AppContext } from '../app-context.js';
import { libraryItem, sourceResult } from '../db/schema.js';
import type { LoadedDefinition } from '../domain/definitions.js';
import { LibraryIndex, type LibRow } from '../domain/matching.js';
import { members as computeMembers } from '../pipeline/planner.js';
import { sourceKey, sourceLabel, type ResolvedSource } from '../sources/index.js';
import { getCached } from '../cache.js';
import type { FindResult } from '../clients/tmdb.js';
import { librariesModel } from './model.js';

export function cachedPlan(app: AppContext, def: LoadedDefinition, index?: LibraryIndex) {
  const s = app.settings();
  if (!index) {
    const rows = app.db.select().from(libraryItem).all() as LibRow[];
    if (!rows.length) return null;
    index = new LibraryIndex(rows);
  }
  const libs = librariesModel(app);
  const resolved: ResolvedSource[] = def.sources.map((src) => {
    const key = sourceKey({ type: src.type, config: src.config });
    const r = app.db.select().from(sourceResult).where(eq(sourceResult.sourceKey, key)).get();
    return { key, label: r?.label ?? sourceLabel({ type: src.type, config: src.config }), status: r?.status ?? 'failed', items: r?.items ?? [], error: r?.error ?? null, fetchedAt: r?.fetchedAt ?? null, meta: r?.meta ?? null };
  });
  const { members } = computeMembers(def, {
    now: Date.now(), tz: s.timezone, leadDays: s.leadDays, definitions: [def], index,
    movieLibraryIds: s.movieLibraryIds ?? libs.filter((l) => l.collectionType === 'movies').map((l) => l.id),
    showLibraryIds: s.showLibraryIds ?? libs.filter((l) => l.collectionType === 'tvshows').map((l) => l.id),
    resolved: new Map([[def.id, resolved]]), live: new Map(), saved: new Map(), found: new Map(),
  });
  return { members, index, resolved };
}

/** Cached TMDb /find results (no network). */
export const cachedFind = (app: AppContext) => (imdb: string): FindResult | undefined => {
  const hit = getCached<FindResult>(app.db, `find:${imdb}`);
  return hit.hit ? hit.value : undefined;
};
