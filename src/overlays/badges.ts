// Which badges each poster should carry (ADR-039), following Kometa's overlay defaults:
// - status.yml (shows): AIRING if an episode aired in the last 14 days; else RETURNING, CANCELED or ENDED from TMDb's
//   status (Jellyfin's own Continuing/Ended when TMDb has none). One status per show: AIRING > RETURNING > CANCELED > ENDED.
// - ribbon.yml: the IMDb Top 250 ribbon on films and shows on IMDb's Top 250 charts.
// Only titles in the libraries collections draw from (Settings → Libraries) get overlays.
import { eq } from 'drizzle-orm';
import type { AppContext } from '../app-context.js';
import { library, libraryItem, sourceResult } from '../db/schema.js';
import { getCached, putCached } from '../cache.js';
import { resolveSource, sourceKey, type SourceContext, type SourceSpec } from '../sources/index.js';
import { log } from '../log.js';
import type { Badge } from './render.js';

const DAY = 86_400_000;
export const AIRING_DAYS = 14;
export const STATUS_LOOKUPS_PER_RUN = 300;
const STATUS_TTL_DAYS = 7;
const CHARTS: Record<'movie' | 'series', SourceSpec> = {
  movie: { type: 'imdb_chart', config: { chart: 'top_movies' } },
  series: { type: 'imdb_chart', config: { chart: 'top_shows' } },
};
const TMDB_STATUS: Record<string, Badge> = { 'Returning Series': 'status:returning', Canceled: 'status:canceled', Ended: 'status:ended' };
const JELLYFIN_STATUS: Record<string, Badge> = { Continuing: 'status:returning', Ended: 'status:ended' };
const ORDER: Badge[] = ['status:airing', 'status:returning', 'status:canceled', 'status:ended', 'ribbon:imdb_top_250'];

export type DesiredBadges = {
  /** Badges per title that should have any. */
  desired: Map<string, Badge[]>;
  /** Kinds whose IMDb Top 250 chart couldn't be read: their existing ribbons are kept as they are. */
  ribbonUnknown: Set<'movie' | 'series'>;
  statusLookups: number;
};

/**
 * Work out every title's badges. With `network: false` nothing is fetched: charts come from their last stored result
 * and TMDb statuses from the cache (for the Settings page).
 */
export async function desiredBadges(app: AppContext, opts: { now: number; network: boolean; ctx?: SourceContext; lookupCap?: number }): Promise<DesiredBadges> {
  const s = app.settings();
  const out: DesiredBadges = { desired: new Map(), ribbonUnknown: new Set(), statusLookups: 0 };
  if (!s.overlays.status && !s.overlays.imdbTop250) return out;
  const libs = app.db.select().from(library).all();
  const movieLibs = new Set(s.movieLibraryIds ?? libs.filter((l) => l.collectionType === 'movies').map((l) => l.id));
  const showLibs = new Set(s.showLibraryIds ?? libs.filter((l) => l.collectionType === 'tvshows').map((l) => l.id));
  const rows = app.db.select().from(libraryItem).all();
  const films = rows.filter((r) => r.kind === 'movie' && movieLibs.has(r.libraryId));
  const shows = rows.filter((r) => r.kind === 'series' && showLibs.has(r.libraryId));
  const add = (jfId: string, b: Badge) => out.desired.set(jfId, [...(out.desired.get(jfId) ?? []), b]);

  if (s.overlays.status) {
    const today = Math.floor(opts.now / DAY);
    const airing = new Set(rows.filter((r) => r.kind === 'episode' && r.seriesJfId && r.premiereDate !== null && Math.floor(r.premiereDate / DAY) > today - AIRING_DAYS && Math.floor(r.premiereDate / DAY) <= today).map((r) => r.seriesJfId!));
    const tmdb = opts.network ? app.tmdb() : null;
    const cap = opts.lookupCap ?? STATUS_LOOKUPS_PER_RUN;
    let tmdbOk = true;
    for (const show of shows) {
      if (airing.has(show.jfId)) { add(show.jfId, 'status:airing'); continue; }
      let status: string | null | undefined;
      if (show.tmdb) {
        const hit = getCached<string | null>(app.db, `tv-status:${show.tmdb}`, opts.now);
        if (hit.hit) status = hit.value;
        else if (tmdb && tmdbOk && out.statusLookups < cap) {
          try {
            status = await tmdb.tvStatus(show.tmdb);
            putCached(app.db, `tv-status:${show.tmdb}`, status, STATUS_TTL_DAYS, opts.now);
            out.statusLookups++;
          } catch (e) {
            tmdbOk = false; // the rest use Jellyfin's status this run
            log.warn(`TMDb show status lookups stopped for this run: ${(e as Error).message}`);
          }
        }
      }
      const badge = (status ? TMDB_STATUS[status] : undefined) ?? (status === undefined || status === null ? JELLYFIN_STATUS[show.status ?? ''] : undefined);
      if (badge) add(show.jfId, badge);
    }
  }

  if (s.overlays.imdbTop250) {
    for (const [kind, spec] of Object.entries(CHARTS) as ['movie' | 'series', SourceSpec][]) {
      let ids: Set<string> | null = null;
      if (opts.network && opts.ctx) {
        const r = await resolveSource(opts.ctx, spec);
        if (r.status !== 'failed') ids = new Set(r.items.map((i) => i.imdb).filter((x): x is string => Boolean(x)));
      } else {
        const stored = app.db.select().from(sourceResult).where(eq(sourceResult.sourceKey, sourceKey(spec))).get();
        if (stored?.items) ids = new Set(stored.items.map((i) => i.imdb).filter((x): x is string => Boolean(x)));
      }
      if (!ids) { out.ribbonUnknown.add(kind); continue; }
      for (const r of kind === 'movie' ? films : shows) if (r.imdb && ids.has(r.imdb)) add(r.jfId, 'ribbon:imdb_top_250');
    }
  }
  for (const [id, b] of out.desired) out.desired.set(id, ORDER.filter((x) => b.includes(x)));
  return out;
}
