// Source adapters and the source cache (ARCHITECTURE §4, ADR-008).
// Every adapter returns SourceItem[]; the cache keeps the last good result when a fetch fails.
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { sourceResult, imdbHash, libraryItem, type SourceItem } from '../db/schema.js';
import type { FetchLike } from '../clients/http.js';
import { USER_AGENT, request, requestJson, HttpError } from '../clients/http.js';
import type { TmdbClient } from '../clients/tmdb.js';
import type { PlexClient } from '../clients/plex.js';
import type { ImdbRoute } from '../settings.js';
import { fetchHashes, imdbChart, imdbList, imdbSearch, isImdbChart, kometaServiceChart, kometaServiceSearch, ImdbError, IMDB_CHARTS, type KometaImdbSearch, type ImdbTitle } from '../imdb/index.js';
import { cached, getCached } from '../cache.js';
import { readSnapshot, searchKey, listKey, chartKey, stableJson, type ImdbSnapshot } from '../imdb/snapshot.js';
import { providerIdsIn, serviceByKey } from '../presets/streaming.js';
import { providerKey, storedProviders } from './watch-providers.js';
import { episodeSearches } from '../imdb/queries.js';
import { log } from '../log.js';

export type SourceSpec = { type: string; config: Record<string, unknown> };

export type SourceContext = {
  db: DB;
  fetch: FetchLike;
  tmdb: TmdbClient | null;
  plex?: PlexClient | null;
  mdblistKey: string | null;
  imdbRoute: ImdbRoute;
  /** Per-run memo for IMDb hashes. */
  hashes?: { list: string; search: string };
  now?: () => number;
  /** Pause between first-time Letterboxd film page fetches (default 1 s). */
  politeDelayMs?: number;
  /** First-time Letterboxd film lookups per run (default 120); the rest resolve on later runs. */
  letterboxdLookupsPerRun?: number;
  /** Where the IMDb snapshot route reads from (ADR-011 route 4). */
  imdbSnapshot?: { url: string; token: string | null };
  /** Per-run memo of the snapshot. */
  snapshot?: Promise<ImdbSnapshot>;
  /** The country whose streaming services count (Settings → Run and review), default US. */
  streamingRegion?: string;
  /** Per-run memo of the stored watch providers for that country. */
  providers?: Map<string, number[]>;
};

/** A snapshot older than this is treated as a failure, so sources fall back to their last good result (ADR-008). */
export const SNAPSHOT_MAX_AGE_MS = 3 * 86_400_000;

async function snapshotFor(ctx: SourceContext): Promise<ImdbSnapshot> {
  if (!ctx.imdbSnapshot?.url) throw new SourceError('IMDb snapshot route chosen but no snapshot URL is set (Settings → IMDb)', 'NO_SNAPSHOT_URL');
  ctx.snapshot ??= readSnapshot(ctx.fetch, ctx.imdbSnapshot.url, ctx.imdbSnapshot.token);
  const snap = await ctx.snapshot;
  const age = (ctx.now?.() ?? Date.now()) - Date.parse(snap.generatedAt);
  if (!(age <= SNAPSHOT_MAX_AGE_MS)) throw new SourceError(`IMDb snapshot is from ${snap.generatedAt.slice(0, 10)}, more than 3 days old`, 'SNAPSHOT_STALE');
  return snap;
}

function fromSnapshot<T>(snap: ImdbSnapshot, table: 'searches' | 'lists' | 'charts', key: string): T {
  const hit = snap[table]?.[key] as T | undefined;
  if (hit) return hit;
  const err = snap.errors[key];
  throw new SourceError(err ? `IMDb snapshot couldn’t resolve this: ${err}` : 'Not in the IMDb snapshot; add it to the snapshot job (npm run imdb:snapshot reads your collections)', err ? 'SNAPSHOT_ERROR' : 'NOT_IN_SNAPSHOT');
}

export class SourceError extends Error {
  constructor(message: string, public code = 'SOURCE_ERROR') {
    super(message);
  }
}

const IMDB_KIND: Record<string, SourceItem['kind']> = {
  movie: 'movie', tvMovie: 'movie', video: 'movie', tvSeries: 'show', tvMiniSeries: 'show', tvEpisode: 'episode',
};

// ── IMDb hashes: fetched each run, last good kept, errors recorded for the Dashboard (ADR-013) ──
export async function imdbHashes(ctx: SourceContext, force = false): Promise<{ list: string; search: string }> {
  if (ctx.hashes && !force) return ctx.hashes;
  const now = ctx.now?.() ?? Date.now();
  try {
    const h = await fetchHashes(ctx.fetch);
    for (const [name, value] of Object.entries(h)) {
      const values = { value, lastGood: value, checkedAt: now, error: null };
      ctx.db.insert(imdbHash).values({ name, ...values }).onConflictDoUpdate({ target: imdbHash.name, set: values }).run();
    }
    ctx.hashes = h;
  } catch (e) {
    const rows = ctx.db.select().from(imdbHash).all();
    const list = rows.find((r) => r.name === 'list')?.lastGood;
    const search = rows.find((r) => r.name === 'search')?.lastGood;
    for (const r of rows) ctx.db.update(imdbHash).set({ checkedAt: now, error: String((e as Error).message) }).where(eq(imdbHash.name, r.name)).run();
    if (!list || !search) throw new SourceError('IMDb hash files unavailable and no previous hashes', 'HASH_FETCH_FAILED');
    ctx.hashes = { list, search };
  }
  return ctx.hashes;
}

async function withHashRetry<T>(ctx: SourceContext, fn: (h: { list: string; search: string }) => Promise<T>): Promise<T> {
  try {
    return await fn(await imdbHashes(ctx));
  } catch (e) {
    if (e instanceof ImdbError && e.code === 'PERSISTED_QUERY_NOT_FOUND') {
      const fresh = await imdbHashes(ctx, true);
      try {
        return await fn(fresh);
      } catch (e2) {
        if (e2 instanceof ImdbError && e2.code === 'PERSISTED_QUERY_NOT_FOUND') {
          ctx.db.update(imdbHash).set({ error: 'PERSISTED_QUERY_NOT_FOUND' }).run();
        }
        throw e2;
      }
    }
    throw e;
  }
}

// ── adapters ──
type Adapter = {
  label: (config: Record<string, unknown>) => string;
  /** Reads only this app's own data, so it's resolved afresh every run rather than kept for a day. */
  fresh?: boolean;
  resolve: (config: Record<string, unknown>, ctx: SourceContext) => Promise<{ items: SourceItem[]; meta?: Record<string, unknown> }>;
};

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v === undefined || v === null ? [] : String(v).split(',').map((s) => s.trim()).filter(Boolean));

export const ADAPTERS: Record<string, Adapter> = {
  imdb_list: {
    label: (c) => `IMDb list ${c.listId}`,
    async resolve(c, ctx) {
      const limit = c.limit ? Number(c.limit) : undefined;
      const { ids, total, titles } = ctx.imdbRoute === 'snapshot'
        ? fromSnapshot<{ ids: string[]; total: number; titles?: ImdbTitle[] }>(await snapshotFor(ctx), 'lists', listKey(String(c.listId), limit))
        : await withHashRetry(ctx, (h) => imdbList(ctx.fetch, h.list, String(c.listId), { limit }));
      const about = new Map((titles ?? []).map((t) => [t.id, t]));
      return {
        items: ids.map((imdb, i) => {
          const t = about.get(imdb);
          return { imdb, kind: (t?.type ? IMDB_KIND[t.type] : undefined) ?? 'other', rank: i + 1, title: t?.title, year: t?.year };
        }),
        meta: { total },
      };
    },
  },

  imdb_search: {
    label: (c) => {
      const s = (c.search ?? {}) as KometaImdbSearch;
      if (s['list.any']) return `IMDb lists ×${arr(s['list.any']).length}`;
      if (s['keyword.any']) return `IMDb keyword ${arr(s['keyword.any']).join(', ')}`;
      return 'IMDb search';
    },
    async resolve(c, ctx) {
      const search = (c.search ?? {}) as KometaImdbSearch;
      let r: { titles: { id: string; type?: string; title?: string; year?: number; seriesId?: string }[]; total: number };
      if (ctx.imdbRoute === 'kometa_service') r = await kometaServiceSearch(ctx.fetch, search);
      else if (ctx.imdbRoute === 'direct') r = await withHashRetry(ctx, (h) => imdbSearch(ctx.fetch, h.search, search));
      else if (ctx.imdbRoute === 'snapshot') r = fromSnapshot(await snapshotFor(ctx), 'searches', searchKey(search));
      else throw new SourceError(`IMDb route "${ctx.imdbRoute}" is not available yet; choose "direct" in Settings`, 'ROUTE_UNAVAILABLE');
      return {
        items: r.titles.map((t, i) => ({ imdb: t.id, kind: IMDB_KIND[t.type ?? ''] ?? (t.type ? 'other' : 'other'), rank: i + 1, title: t.title, year: t.year, seriesImdb: t.seriesId })),
        meta: { total: r.total },
      };
    },
  },

  // IMDb's Top 250, Most Popular and Lowest Rated charts (Kometa's imdb_chart, ADR-036).
  imdb_chart: {
    label: (c) => `IMDb chart: ${isImdbChart(c.chart) ? IMDB_CHARTS[c.chart].label : String(c.chart)}`,
    async resolve(c, ctx) {
      if (!isImdbChart(c.chart)) throw new SourceError(`Unknown IMDb chart: ${String(c.chart)}`, 'BAD_INPUT');
      const chart = c.chart;
      let titles: ImdbTitle[];
      if (ctx.imdbRoute === 'snapshot') titles = fromSnapshot<{ titles: ImdbTitle[] }>(await snapshotFor(ctx), 'charts', chartKey(chart)).titles;
      else if (ctx.imdbRoute === 'kometa_service') titles = await kometaServiceChart(ctx.fetch, chart);
      else titles = await imdbChart(ctx.fetch, chart);
      if (!titles.length) throw new SourceError(`IMDb returned an empty ${IMDB_CHARTS[chart].label} chart`, 'EMPTY');
      const kind = IMDB_CHARTS[chart].kind;
      return { items: titles.map((t, i) => ({ imdb: t.id, kind, rank: i + 1, title: t.title, year: t.year })), meta: { total: titles.length } };
    },
  },

  // The titles you own that stream on a service in your country (ADR-036), from the weekly per-title TMDb lookups
  // the run makes first. Until every title has been looked up once the result is partial, so nothing is removed.
  tmdb_watch_provider: {
    fresh: true,
    label: (c) => `Streaming on ${serviceByKey(c.service)?.name ?? String(c.service)}`,
    async resolve(c, ctx) {
      const service = serviceByKey(c.service);
      if (!service) throw new SourceError(`Unknown streaming service: ${String(c.service)}`, 'BAD_INPUT');
      const region = ctx.streamingRegion ?? 'US';
      const wanted = new Set(providerIdsIn(service, region));
      const show = c.kind === 'show';
      const rows = ctx.db.select().from(libraryItem).where(eq(libraryItem.kind, show ? 'series' : 'movie')).all();
      ctx.providers ??= storedProviders(ctx.db, region);
      const items: SourceItem[] = [];
      let waiting = 0;
      for (const r of rows) {
        if (!r.tmdb) continue; // TMDb can't be asked about a title Jellyfin has no TMDb ID for
        const ids = ctx.providers.get(providerKey(region, show ? 'tv' : 'movie', r.tmdb));
        if (!ids) waiting++;
        else if (ids.some((id) => wanted.has(id))) {
          items.push({ jf: r.jfId, imdb: r.imdb ?? undefined, tmdb: r.tmdb, tvdb: r.tvdb ?? undefined, kind: show ? 'show' : 'movie', rank: items.length + 1, title: r.name, year: r.year ?? undefined });
        }
      }
      return { items, meta: { region, titles: rows.length, waiting, partial: waiting > 0 } };
    },
  },

  // Holiday episodes (ADR-017): IMDb episodes with these keywords, only from series you own, 50 series per search.
  imdb_episodes: {
    label: (c) => `IMDb episodes: ${arr(c.keywords).join(', ')}`,
    async resolve(c, ctx) {
      const series = ctx.db.select({ imdb: libraryItem.imdb }).from(libraryItem).where(eq(libraryItem.kind, 'series')).all().map((r) => r.imdb).filter((x): x is string => Boolean(x));
      if (!series.length) return { items: [], meta: { series: 0 } };
      const items: SourceItem[] = [];
      for (const search of episodeSearches(arr(c.keywords), series)) {
        let r: { titles: { id: string; type?: string; title?: string; year?: number; seriesId?: string }[] };
        if (ctx.imdbRoute === 'kometa_service') r = await kometaServiceSearch(ctx.fetch, search);
        else if (ctx.imdbRoute === 'snapshot') r = fromSnapshot(await snapshotFor(ctx), 'searches', searchKey(search));
        else r = await withHashRetry(ctx, (h) => imdbSearch(ctx.fetch, h.search, search));
        for (const t of r.titles) items.push({ imdb: t.id, kind: 'episode', rank: items.length + 1, title: t.title, year: t.year, seriesImdb: t.seriesId });
      }
      return { items, meta: { series: series.length, searches: Math.ceil(series.length / 50) } };
    },
  },

  // Episodes whose title names the holiday. Title matching is only ever a suggestion (ADR-017, ADR-018), and it is
  // the only way to reach episodes Jellyfin has no IDs for.
  jellyfin_episode_title: {
    label: (c) => `Episode titles: ${arr(c.words).join(', ')}`,
    async resolve(c, ctx) {
      const words = arr(c.words).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      if (!words.length) throw new SourceError('No words to look for in episode titles', 'BAD_INPUT');
      const re = new RegExp(`\\b(${words.join('|')})\\b`, 'i');
      const rows = ctx.db.select().from(libraryItem).where(eq(libraryItem.kind, 'episode')).all().filter((r) => re.test(r.name));
      return { items: rows.map((r, i) => ({ jf: r.jfId, imdb: r.imdb ?? undefined, kind: 'episode' as const, rank: i + 1, title: r.name })) };
    },
  },

  // A collection Kometa (or anyone) built in Plex, read by GUID (ADR-024). Read-only.
  plex_collection: {
    label: (c) => `Plex collection ${c.name}`,
    async resolve(c, ctx) {
      if (!ctx.plex) throw new SourceError('Plex isn’t connected (Settings → Connections)', 'NO_KEY');
      const found = await ctx.plex.findCollection(String(c.name));
      if (!found.length) return { items: [], meta: { found: false } };
      const items: SourceItem[] = [];
      for (const coll of found) {
        for (const it of await ctx.plex.items(coll.ratingKey)) {
          items.push({ imdb: it.imdb, tmdb: it.tmdb, tvdb: it.tvdb, kind: it.type === 'show' ? 'show' : it.type === 'episode' ? 'episode' : 'movie', rank: items.length + 1, title: it.title, year: it.year });
        }
      }
      return { items, meta: { found: true, libraries: found.map((x) => x.section) } };
    },
  },

  mdblist_list: {
    label: (c) => `MDBList ${String(c.url ?? '').replace(/^https?:\/\/mdblist\.com\/lists\//, '')}`,
    async resolve(c, ctx) {
      const url = String(c.url ?? '').replace(/[?#].*$/, '').replace(/\/+$/, '');
      // The whole path after /lists/: "user/list-name", or "user/external/15110" for lists MDBList imports from elsewhere.
      const path = url.match(/mdblist\.com\/lists\/([^/]+\/[^/]+(?:\/[^/]+)?)$/)?.[1];
      if (!path) throw new SourceError(`Not an MDBList list URL: ${url}`, 'BAD_INPUT');
      type Ids = { imdb?: string | null; tmdb?: number | string | null; tvdb?: number | string | null };
      type Row = { id?: number; imdb_id?: string; tvdbid?: number; tvdb_id?: number; ids?: Ids; mediatype?: string; title?: string; release_year?: number; rank?: number };
      const publicJson = () => requestJson<Row[]>(ctx.fetch, `https://mdblist.com/lists/${path}/json`);
      // External lists (lists MDBList imports from elsewhere) aren't served by the API's /lists/{user}/{slug} route,
      // only by their public JSON, which needs no key. Any other list the API doesn't know falls back to it too.
      const external = /\/external\/\d+$/.test(path);
      let rows: Row[];
      if (ctx.mdblistKey && !external) {
        try {
          const r = await requestJson<Row[] | { movies?: Row[]; shows?: Row[] }>(ctx.fetch, `https://api.mdblist.com/lists/${path}/items?apikey=${encodeURIComponent(ctx.mdblistKey)}`);
          rows = Array.isArray(r) ? r : [...(r.movies ?? []), ...(r.shows ?? [])];
        } catch (e) {
          if (!(e instanceof HttpError && e.status === 404)) throw e;
          rows = await publicJson();
        }
      } else {
        rows = await publicJson();
      }
      const str = (v: unknown) => (v === null || v === undefined || v === '' || v === 0 ? undefined : String(v));
      return {
        items: rows.map((x, i) => ({
          imdb: str(x.ids?.imdb ?? x.imdb_id), tmdb: str(x.ids?.tmdb ?? x.id), tvdb: str(x.ids?.tvdb ?? x.tvdb_id ?? x.tvdbid),
          kind: x.mediatype === 'show' ? 'show' : 'movie', rank: x.rank ?? i + 1, title: x.title, year: x.release_year,
        })),
      };
    },
  },

  tmdb_collection: {
    label: (c) => `TMDb collections ×${arr(c.ids).length}`,
    async resolve(c, ctx) {
      if (!ctx.tmdb) throw new SourceError('TMDb key not set (Settings → Connections)', 'NO_KEY');
      const items: SourceItem[] = [];
      for (const id of arr(c.ids)) for (const p of await ctx.tmdb.collectionParts(id)) items.push({ tmdb: p.tmdb, kind: 'movie', rank: items.length + 1, title: p.title, year: p.year });
      return { items };
    },
  },

  tmdb_keyword: {
    label: (c) => `TMDb keyword ${arr(c.keywords).join(', ')}`,
    async resolve(c, ctx) {
      if (!ctx.tmdb) throw new SourceError('TMDb key not set (Settings → Connections)', 'NO_KEY');
      const ids: string[] = [];
      for (const k of arr(c.keywords)) {
        const id = /^\d+$/.test(k) ? k : await ctx.tmdb.keywordId(k);
        if (!id) throw new SourceError(`TMDb has no keyword "${k}"`, 'BAD_INPUT');
        ids.push(id);
      }
      const media = c.media === 'tv' ? 'tv' : 'movie';
      const titles = await ctx.tmdb.discoverByKeywords(media, ids, c.limit ? Number(c.limit) : 500);
      return { items: titles.map((t, i) => ({ tmdb: t.tmdb, kind: media === 'tv' ? ('show' as const) : ('movie' as const), rank: i + 1, title: t.title, year: t.year })), meta: { keywordIds: ids } };
    },
  },

  tmdb_list: {
    label: (c) => `TMDb list ${c.listId}`,
    async resolve(c, ctx) {
      if (!ctx.tmdb) throw new SourceError('TMDb key not set (Settings → Connections)', 'NO_KEY');
      const titles = await ctx.tmdb.list(String(c.listId));
      return { items: titles.map((t, i) => ({ tmdb: t.tmdb, kind: t.media === 'tv' ? ('show' as const) : ('movie' as const), rank: i + 1, title: t.title, year: t.year })) };
    },
  },

  tmdb_movie: {
    label: (c) => `TMDb movies ×${arr(c.ids).length}`,
    resolve: async (c) => ({ items: arr(c.ids).map((tmdb, i) => ({ tmdb, kind: 'movie' as const, rank: i + 1 })) }),
  },

  tmdb_show: {
    label: (c) => `TMDb shows ×${arr(c.ids).length}`,
    resolve: async (c) => ({ items: arr(c.ids).map((tmdb, i) => ({ tmdb, kind: 'show' as const, rank: i + 1 })) }),
  },

  letterboxd_list: {
    label: (c) => `Letterboxd ${String(c.url ?? '').replace(/^https?:\/\/letterboxd\.com\//, '').replace(/\/$/, '')}`,
    async resolve(c, ctx) {
      const base = String(c.url ?? '').replace(/\/$/, '');
      if (!/^https:\/\/letterboxd\.com\/[^/]+\/list\/[^/]+$/.test(base)) throw new SourceError(`Not a Letterboxd list URL: ${base}`, 'BAD_INPUT');
      const slugs: string[] = [];
      for (let page = 1; page <= 30; page++) {
        const res = await request(ctx.fetch, page === 1 ? `${base}/` : `${base}/page/${page}/`, { headers: { accept: 'text/html' } });
        const html = await res.text();
        if (!res.ok) {
          const challenged = res.headers.get('cf-mitigated') || /Just a moment/.test(html);
          throw new SourceError(`Letterboxd HTTP ${res.status}${challenged ? ' (Cloudflare challenge)' : ''}`, challenged ? 'CHALLENGED' : 'HTTP_ERROR');
        }
        const found = [...html.matchAll(/data-(?:film-slug|item-slug|target-link)="\/?(?:film\/)?([a-z0-9-]+)\/?"/g)].map((m) => m[1] as string);
        const fresh = found.filter((s) => !slugs.includes(s));
        if (!fresh.length) break;
        slugs.push(...fresh);
      }
      const items: SourceItem[] = [];
      let fresh = 0;
      let unresolved = 0;
      const cap = ctx.letterboxdLookupsPerRun ?? 120;
      for (const slug of slugs) {
        const hit = getCached<{ imdb: string | null; tmdb: string | null }>(ctx.db, `lbx:${slug}`);
        if (!hit.hit && fresh >= cap) { unresolved++; continue; }
        if (!hit.hit) fresh++;
        const ids = hit.hit ? hit.value : await cached(ctx.db, `lbx:${slug}`, 3650, async () => {
          await new Promise((r) => setTimeout(r, ctx.politeDelayMs ?? 1000)); // be polite: about one film page a second, first time only
          const res = await request(ctx.fetch, `https://letterboxd.com/film/${slug}/`, { headers: { accept: 'text/html' } });
          const html = await res.text();
          if (!res.ok) throw new SourceError(`Letterboxd film page HTTP ${res.status}`, 'HTTP_ERROR');
          return { imdb: html.match(/imdb\.com\/title\/(tt\d+)/)?.[1] ?? null, tmdb: html.match(/themoviedb\.org\/movie\/(\d+)/)?.[1] ?? null };
        });
        items.push({ imdb: ids.imdb ?? undefined, tmdb: ids.tmdb ?? undefined, kind: 'movie', rank: items.length + 1, title: slug });
      }
      return { items, meta: { films: slugs.length, partial: unresolved > 0, unresolved } };
    },
  },

  // Titles from your library by date (ADR-037): released, first aired or aired in the last N days (Jellyfin's
  // PremiereDate), or added in the last N days (DateCreated). Kometa's Newly Released and New Episodes, and Recently Added.
  // Counted in whole days, today included; dates in the future don't count. Newest first.
  jellyfin_recent: {
    fresh: true,
    label: (c) => `${c.field === 'added' ? 'Added' : c.kind === 'episode' ? 'Aired' : 'Released'} in the last ${Number(c.days)} days`,
    async resolve(c, ctx) {
      const days = Number(c.days);
      if (!Number.isInteger(days) || days < 1 || days > 3650) throw new SourceError('Days must be a whole number from 1 to 3650', 'BAD_INPUT');
      const kind = c.kind === 'series' || c.kind === 'episode' ? c.kind : 'movie';
      const today = Math.floor((ctx.now?.() ?? Date.now()) / 86_400_000);
      // Added: when the title first arrived, not when its file was last replaced (ADR-038). A show was added when its
      // newest episode was, as in Plex and Kometa, so it comes back when new episodes arrive.
      const newestEpisode = new Map<string, number>();
      if (c.field === 'added' && kind === 'series') {
        for (const e of ctx.db.select({ series: libraryItem.seriesJfId, first: libraryItem.firstAdded, added: libraryItem.dateAdded }).from(libraryItem).where(eq(libraryItem.kind, 'episode')).all()) {
          const at = e.first ?? e.added;
          if (e.series && at !== null && at > (newestEpisode.get(e.series) ?? -Infinity)) newestEpisode.set(e.series, at);
        }
      }
      const addedAt = (r: typeof libraryItem.$inferSelect) => (kind === 'series' ? newestEpisode.get(r.jfId) ?? r.dateAdded : r.firstAdded ?? r.dateAdded);
      const rows = ctx.db.select().from(libraryItem).where(eq(libraryItem.kind, kind)).all()
        .map((r) => ({ r, at: c.field === 'added' ? addedAt(r) : r.premiereDate }))
        .filter((x): x is { r: typeof x.r; at: number } => x.at !== null && Math.floor(x.at / 86_400_000) > today - days && Math.floor(x.at / 86_400_000) <= today)
        .sort((a, b) => b.at - a.at);
      const as = kind === 'series' ? ('show' as const) : kind;
      return {
        items: rows.map(({ r }, i) => ({ jf: r.jfId, imdb: r.imdb ?? undefined, tmdb: r.tmdb ?? undefined, tvdb: r.tvdb ?? undefined, kind: as, rank: i + 1, title: r.name, year: r.year ?? undefined })),
        meta: { days, field: c.field === 'added' ? 'added' : 'released' },
      };
    },
  },

  jellyfin_query: {
    label: (c) => `Jellyfin ${['tags', 'genres', 'studios'].filter((k) => c[k]).map((k) => `${k} ${arr(c[k]).join('|')}`).join(', ')}`,
    async resolve(c, ctx) {
      const want = (field: string) => arr(c[field]).map((s) => s.toLowerCase());
      const [tags, genres, studios] = [want('tags'), want('genres'), want('studios')];
      const kind = c.kind === 'series' ? 'series' : 'movie';
      const rows = ctx.db.select().from(libraryItem).where(eq(libraryItem.kind, kind)).all();
      const hit = (vals: string[], wanted: string[]) => !wanted.length || vals.some((v) => wanted.includes(v.toLowerCase()));
      const items = rows
        .filter((r) => hit(r.tags, tags) && hit(r.genres, genres) && hit(r.studios, studios))
        .map((r, i) => ({ jf: r.jfId, imdb: r.imdb ?? undefined, tmdb: r.tmdb ?? undefined, tvdb: r.tvdb ?? undefined, kind: kind === 'series' ? ('show' as const) : ('movie' as const), rank: i + 1, title: r.name, year: r.year ?? undefined }));
      return { items };
    },
  },
};

/** JSON with object keys sorted at every depth, so equal configs always produce the same key. */
export const stableStringify = stableJson;

export function sourceKey(spec: SourceSpec): string {
  return `${spec.type}:${createHash('sha1').update(stableStringify(spec.config)).digest('hex').slice(0, 16)}`;
}

export function sourceLabel(spec: SourceSpec): string {
  return ADAPTERS[spec.type]?.label(spec.config) ?? spec.type;
}

export type ResolvedSource = {
  key: string;
  label: string;
  status: 'ok' | 'stale' | 'failed';
  items: SourceItem[];
  error: string | null;
  fetchedAt: number | null;
  meta: Record<string, unknown> | null;
};

/**
 * Resolve a source with Kometa's cache_builders: 1 (results reused for a day).
 * On failure the last good result is served and marked stale; with no last good result it is failed (ADR-008).
 */
export async function resolveSource(ctx: SourceContext, spec: SourceSpec, opts: { maxAgeMs?: number; force?: boolean } = {}): Promise<ResolvedSource> {
  const key = sourceKey(spec);
  const label = sourceLabel(spec);
  const now = ctx.now?.() ?? Date.now();
  const prev = ctx.db.select().from(sourceResult).where(eq(sourceResult.sourceKey, key)).get();
  const maxAge = opts.maxAgeMs ?? 86_400_000;
  const adapter = ADAPTERS[spec.type];
  if (!opts.force && !adapter?.fresh && prev?.status === 'ok' && prev.fetchedAt && now - prev.fetchedAt < maxAge && prev.items) {
    return { key, label, status: 'ok', items: prev.items, error: null, fetchedAt: prev.fetchedAt, meta: prev.meta ?? null };
  }
  try {
    if (!adapter) throw new SourceError(`Unknown source type ${spec.type}`, 'BAD_INPUT');
    const { items, meta } = await adapter.resolve(spec.config, ctx);
    const values = { label, status: 'ok' as const, error: null, fetchedAt: now, items, meta: meta ?? null, lastGoodAt: now };
    ctx.db.insert(sourceResult).values({ sourceKey: key, ...values }).onConflictDoUpdate({ target: sourceResult.sourceKey, set: values }).run();
    return { key, label, status: 'ok', items, error: null, fetchedAt: now, meta: meta ?? null };
  } catch (e) {
    const message = e instanceof HttpError ? e.message : (e as Error).message;
    log.warn(`Source ${label} failed: ${message}`);
    if (prev?.items && prev.lastGoodAt) {
      ctx.db.update(sourceResult).set({ status: 'stale', error: message }).where(eq(sourceResult.sourceKey, key)).run();
      return { key, label, status: 'stale', items: prev.items, error: message, fetchedAt: prev.lastGoodAt, meta: prev.meta ?? null };
    }
    const values = { label, status: 'failed' as const, error: message, fetchedAt: null, items: null, meta: null, lastGoodAt: null };
    ctx.db.insert(sourceResult).values({ sourceKey: key, ...values }).onConflictDoUpdate({ target: sourceResult.sourceKey, set: values }).run();
    return { key, label, status: 'failed', items: [], error: message, fetchedAt: null, meta: null };
  }
}

export { USER_AGENT };
