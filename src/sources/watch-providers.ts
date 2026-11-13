// Which streaming services carry the titles you own (ADR-036). Kometa asks TMDb's discover for each service's whole
// catalogue, thousands of titles a service; this asks TMDb about each title you own instead, once a week, a few hundred
// per run, so a big library fills in over a few nights. Results are kept per country. TMDb's data comes from JustWatch.
import { and, inArray, isNotNull, like } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { libraryItem, tmdbCache } from '../db/schema.js';
import type { TmdbClient } from '../clients/tmdb.js';
import { putCached } from '../cache.js';
import { log } from '../log.js';

export const PROVIDER_TTL_DAYS = 7;
export const PROVIDER_LOOKUPS_PER_RUN = 600;
const DAY = 86_400_000;

export type ProviderKind = 'movie' | 'tv';
export const providerKey = (region: string, kind: ProviderKind, tmdb: string) => `providers:${region}:${kind}:${tmdb}`;

export type ProviderRefresh = { lookedUp: number; waiting: number; problem: string | null };

/**
 * Look up titles that have never been looked up in this country first, then the oldest past a week, up to the cap.
 * A failure stops this run's lookups (the rest wait for the next run) but never the run.
 */
export async function refreshWatchProviders(db: DB, tmdb: TmdbClient | null, opts: { region: string; kinds: Set<ProviderKind>; now: number; cap?: number }): Promise<ProviderRefresh> {
  const kinds = [...opts.kinds].map((k) => (k === 'tv' ? 'series' : 'movie'));
  if (!kinds.length) return { lookedUp: 0, waiting: 0, problem: null };
  const titles = db.select({ kind: libraryItem.kind, tmdb: libraryItem.tmdb }).from(libraryItem)
    .where(and(inArray(libraryItem.kind, kinds), isNotNull(libraryItem.tmdb))).all()
    .map((t) => ({ kind: (t.kind === 'series' ? 'tv' : 'movie') as ProviderKind, tmdb: t.tmdb! }));
  const seen = new Map(db.select({ key: tmdbCache.key, fetchedAt: tmdbCache.fetchedAt, ttlDays: tmdbCache.ttlDays }).from(tmdbCache)
    .where(like(tmdbCache.key, `providers:${opts.region}:%`)).all().map((r) => [r.key, r]));
  const unique = [...new Map(titles.map((t) => [providerKey(opts.region, t.kind, t.tmdb), t])).entries()];
  const never = unique.filter(([k]) => !seen.has(k));
  const stale = unique.filter(([k]) => { const r = seen.get(k); return r && opts.now - r.fetchedAt > r.ttlDays * DAY; })
    .sort(([a], [b]) => seen.get(a)!.fetchedAt - seen.get(b)!.fetchedAt);
  if (!never.length && !stale.length) return { lookedUp: 0, waiting: 0, problem: null };
  if (!tmdb) return { lookedUp: 0, waiting: never.length, problem: 'Streaming collections need a TMDb key (Settings → Connections).' };

  const cap = opts.cap ?? PROVIDER_LOOKUPS_PER_RUN;
  let lookedUp = 0;
  let newDone = 0;
  let problem: string | null = null;
  for (const [key, t] of [...never, ...stale].slice(0, cap)) {
    try {
      putCached(db, key, await tmdb.watchProviders(t.kind, t.tmdb, opts.region), PROVIDER_TTL_DAYS, opts.now);
    } catch (e) {
      problem = `TMDb streaming lookups stopped for this run: ${(e as Error).message}`;
      log.warn(problem);
      break;
    }
    lookedUp++;
    if (!seen.has(key)) newDone++;
  }
  return { lookedUp, waiting: never.length - newDone, problem };
}

/** Every title's stored provider IDs in this country, however old, by providerKey. A title missing here hasn't been looked up yet. */
export function storedProviders(db: DB, region: string): Map<string, number[]> {
  return new Map(db.select({ key: tmdbCache.key, payload: tmdbCache.payload }).from(tmdbCache)
    .where(like(tmdbCache.key, `providers:${region}:%`)).all().map((r) => [r.key, r.payload as number[]]));
}
