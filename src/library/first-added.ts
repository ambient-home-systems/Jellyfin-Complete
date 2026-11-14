// When each film and episode first arrived (ADR-038). Jellyfin's DateCreated moves when a file is replaced (an upgrade
// to a better copy is often indexed as a new item), so Recently Added would show upgrades as new. After each index, the
// earliest date seen for a title is kept by a stable key, and written to library_item.first_added for the sources.
//
// - While Radarr is connected, a film it knows arrived when Radarr first imported it (its history), which upgrades don't
//   move; a film added to Radarr long before it downloaded counts from the download. This is worked out afresh on every
//   pass, so it doesn't matter whether Radarr was connected the first time films were remembered.
// - Otherwise the earliest date Jellyfin has shown for the title counts, and a title that was missing from every index
//   for over a week and then comes back counts as newly added.
import { eq, like, sql } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { libraryItem, titleAdded } from '../db/schema.js';

const WEEK = 7 * 86_400_000;

type Row = typeof libraryItem.$inferSelect;

/** A film's key: TMDb ID, else IMDb ID, else its Jellyfin ID. */
export function movieKey(r: Pick<Row, 'jfId' | 'tmdb' | 'imdb'>): string {
  return r.tmdb ? `movie:tmdb:${r.tmdb}` : r.imdb ? `movie:imdb:${r.imdb}` : `movie:jf:${r.jfId}`;
}

/** An episode's key: its series' stable ID with season and episode numbers, else its Jellyfin ID. */
export function episodeKey(r: Pick<Row, 'jfId' | 'season' | 'episode'>, series: Pick<Row, 'jfId' | 'tmdb' | 'tvdb' | 'imdb'> | undefined): string {
  if (!series || r.season === null || r.episode === null) return `episode:jf:${r.jfId}`;
  const s = series.tmdb ? `tmdb:${series.tmdb}` : series.tvdb ? `tvdb:${series.tvdb}` : series.imdb ? `imdb:${series.imdb}` : `jf:${series.jfId}`;
  return `episode:${s}:${r.season}:${r.episode}`;
}

/** True when no film has been remembered yet. */
export const needsSeeding = (db: DB): boolean => !db.select({ k: titleAdded.key }).from(titleAdded).where(like(titleAdded.key, 'movie:%')).limit(1).get();

/**
 * Remember first-added dates after an index pass made at `indexedAt`. `radarrArrivals` maps "tmdb:<id>" and
 * "imdb:<id>" to when Radarr first imported each film (ArrClient.arrivals); films it covers take that date.
 */
export function rememberFirstAdded(db: DB, indexedAt: number, radarrArrivals?: Map<string, number>): { remembered: number; seeded: boolean; fromRadarr: number } {
  const seeding = needsSeeding(db);
  // The latest complete index before this one: a title last seen before it was missing from at least one index.
  const previousIndex = db.select({ at: sql<number | null>`max(${titleAdded.lastSeen})` }).from(titleAdded).get()?.at ?? null;
  const rows = db.select().from(libraryItem).all();
  const series = new Map(rows.filter((r) => r.kind === 'series').map((r) => [r.jfId, r]));
  const known = new Map(db.select().from(titleAdded).all().map((t) => [t.key, t]));
  let remembered = 0, fromRadarr = 0;
  db.transaction((tx) => {
    for (const r of rows) {
      if (r.kind === 'series' || r.dateAdded === null) continue;
      const key = r.kind === 'movie' ? movieKey(r) : episodeKey(r, series.get(r.seriesJfId ?? ''));
      const prev = known.get(key);
      const radarr = r.kind === 'movie' && radarrArrivals
        ? Math.min(...[r.tmdb && radarrArrivals.get(`tmdb:${r.tmdb}`), r.imdb && radarrArrivals.get(`imdb:${r.imdb}`)].filter((x): x is number => typeof x === 'number'))
        : Infinity;
      const cameBack = Boolean(prev) && prev!.lastSeen < indexedAt - WEEK && previousIndex !== null && prev!.lastSeen < previousIndex;
      // The date remembered for it, unless it was gone for over a week and has come back.
      const remembered_ = prev && !cameBack ? prev.firstAdded : Infinity;
      let first: number;
      if (Number.isFinite(radarr)) {
        // Radarr's first import; Jellyfin's date or the remembered one if earlier (the file was here before Radarr's
        // history begins). An earlier date is never forgotten because Radarr only knows a later one.
        first = Math.min(radarr, r.dateAdded, remembered_);
        fromRadarr++;
      } else {
        first = Math.min(remembered_, r.dateAdded);
      }
      const values = { firstAdded: first, lastSeen: indexedAt };
      tx.insert(titleAdded).values({ key, ...values }).onConflictDoUpdate({ target: titleAdded.key, set: values }).run();
      known.set(key, { key, ...values });
      if (r.firstAdded !== first) tx.update(libraryItem).set({ firstAdded: first }).where(eq(libraryItem.jfId, r.jfId)).run();
      remembered++;
    }
  });
  return { remembered, seeded: seeding, fromRadarr };
}
