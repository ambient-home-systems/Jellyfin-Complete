// TMDb v3 client: rate-limited (~35 requests / 10 s) and cached in SQLite (ADR-018, ADR-020).
import type { DB } from '../db/index.js';
import { cached } from '../cache.js';
import { type FetchLike, RateLimiter, requestJson, HttpError } from './http.js';

const BASE = 'https://api.themoviedb.org/3';

export type FindResult =
  | { kind: 'movie'; tmdb: string }
  | { kind: 'tv'; tmdb: string }
  | { kind: 'episode'; showTmdb: string; season: number; episode: number }
  | null;

export type TmdbTitle = { tmdb: string; media: 'movie' | 'tv'; title: string | undefined; year: number | undefined };
type PagedItem = { id: number; media_type?: string; title?: string; name?: string; release_date?: string; first_air_date?: string };
type Paged = { results: PagedItem[]; total_pages: number };
const title = (x: PagedItem, media: 'movie' | 'tv'): TmdbTitle => {
  const date = x.release_date || x.first_air_date;
  return { tmdb: String(x.id), media, title: x.title ?? x.name, year: date ? Number(date.slice(0, 4)) : undefined };
};

export type CollectionDetails = { name: string; overview: string | null; posterPath: string | null; parts: { tmdb: string; title: string; year: number | undefined }[] };

export class TmdbClient {
  private limiter = new RateLimiter(35, 10_000);
  constructor(private db: DB, private apiKey: string, private f: FetchLike = fetch) {}

  private async get<T>(path: string): Promise<T> {
    await this.limiter.take();
    const sep = path.includes('?') ? '&' : '?';
    return requestJson<T>(this.f, `${BASE}${path}${sep}api_key=${encodeURIComponent(this.apiKey)}`);
  }

  /** Quick credentials check for Settings → Test connection. */
  async ping(): Promise<void> {
    await this.get('/configuration');
  }

  /** IMDb ID → TMDb movie, show, or (show, season, episode). Cached for 90 days. */
  find(imdbId: string): Promise<FindResult> {
    return cached(this.db, `find:${imdbId}`, 90, async () => {
      const r = await this.get<{ movie_results: { id: number }[]; tv_results: { id: number }[]; tv_episode_results: { show_id: number; season_number: number; episode_number: number }[] }>(
        `/find/${imdbId}?external_source=imdb_id`,
      );
      if (r.movie_results[0]) return { kind: 'movie', tmdb: String(r.movie_results[0].id) };
      if (r.tv_results[0]) return { kind: 'tv', tmdb: String(r.tv_results[0].id) };
      const e = r.tv_episode_results[0];
      if (e) return { kind: 'episode', showTmdb: String(e.show_id), season: e.season_number, episode: e.episode_number };
      return null;
    });
  }

  /** Keyword name → TMDb keyword ID (exact match, ignoring case, else the first result). Cached for 30 days. */
  keywordId(name: string): Promise<string | null> {
    return cached(this.db, `kwsearch:${name.toLowerCase()}`, 30, async () => {
      const r = await this.get<{ results: { id: number; name: string }[] }>(`/search/keyword?query=${encodeURIComponent(name)}`);
      const hit = r.results.find((k) => k.name.toLowerCase() === name.toLowerCase()) ?? r.results[0];
      return hit ? String(hit.id) : null;
    });
  }

  /** Discover titles with any of these keywords, most popular first (Kometa's tmdb_keyword). */
  async discoverByKeywords(media: 'movie' | 'tv', keywordIds: string[], maxItems = 500): Promise<TmdbTitle[]> {
    const out: TmdbTitle[] = [];
    for (let page = 1; page <= 50 && out.length < maxItems; page++) {
      const r = await this.get<Paged>(`/discover/${media}?with_keywords=${keywordIds.join('|')}&sort_by=popularity.desc&include_adult=false&page=${page}`);
      out.push(...r.results.map((x) => title(x, media)));
      if (page >= r.total_pages) break;
    }
    return out.slice(0, maxItems);
  }

  /** Items on a public TMDb list (v3), in list order. */
  async list(id: string, maxItems = 1000): Promise<TmdbTitle[]> {
    const out: TmdbTitle[] = [];
    for (let page = 1; page <= 50 && out.length < maxItems; page++) {
      const r = await this.get<{ items: PagedItem[]; total_pages?: number }>(`/list/${encodeURIComponent(id)}?page=${page}`);
      // Older lists omit media_type; a "name" without a "title" means a show.
      for (const x of r.items) {
        if (x.media_type && x.media_type !== 'movie' && x.media_type !== 'tv') continue;
        out.push(title(x, x.media_type === 'tv' || (!x.media_type && x.name && !x.title) ? 'tv' : 'movie'));
      }
      if (!r.total_pages || page >= r.total_pages) break;
    }
    return out.slice(0, maxItems);
  }

  /** A show's TVDB ID, which Sonarr adds by. Cached for 90 days. */
  tvdbForShow(tmdbTvId: string): Promise<string | null> {
    return cached(this.db, `tvdb:${tmdbTvId}`, 90, async () => {
      const r = await this.get<{ tvdb_id?: number | null }>(`/tv/${encodeURIComponent(tmdbTvId)}/external_ids`);
      return r.tvdb_id ? String(r.tvdb_id) : null;
    });
  }

  /** Films in a TMDb collection (e.g. Halloween's 10 collections). Cached for 7 days. */
  async collectionParts(id: number | string): Promise<{ tmdb: string; title: string; year: number | undefined }[]> {
    return (await this.collectionDetails(id))?.parts ?? [];
  }

  /** A TMDb collection (a film series): its name, overview, poster and films. Null if TMDb has no such collection. */
  collectionDetails(id: number | string): Promise<CollectionDetails | null> {
    return cached(this.db, `collection-details:${id}`, 7, async () => {
      try {
        const r = await this.get<{ name: string; overview?: string; poster_path?: string | null; parts: { id: number; title: string; release_date?: string }[] }>(`/collection/${id}`);
        return {
          name: r.name, overview: r.overview || null, posterPath: r.poster_path ?? null,
          parts: r.parts.map((p) => ({ tmdb: String(p.id), title: p.title, year: p.release_date ? Number(p.release_date.slice(0, 4)) : undefined })),
        };
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) return null;
        throw e;
      }
    });
  }

  /**
   * The services a film or show streams on in one country: subscription, free and with-ads offers, not rentals or
   * purchases. TMDb's data comes from JustWatch. Not cached here: the run's refresh step stores it (ADR-036).
   */
  async watchProviders(kind: 'movie' | 'tv', id: string, region: string): Promise<number[]> {
    type Offer = { provider_id: number };
    try {
      const r = await this.get<{ results?: Record<string, { flatrate?: Offer[]; free?: Offer[]; ads?: Offer[] }> }>(`/${kind}/${encodeURIComponent(id)}/watch/providers`);
      const here = r.results?.[region];
      return [...new Set([...(here?.flatrate ?? []), ...(here?.free ?? []), ...(here?.ads ?? [])].map((p) => p.provider_id))];
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return [];
      throw e;
    }
  }

  /** The TMDb collection a film belongs to, for films Jellyfin hasn't recorded one for. Cached for 30 days. */
  movieCollection(id: number | string): Promise<string | null> {
    return cached(this.db, `movie-collection:${id}`, 30, async () => {
      try {
        const r = await this.get<{ belongs_to_collection?: { id: number } | null }>(`/movie/${id}`);
        return r.belongs_to_collection ? String(r.belongs_to_collection.id) : null;
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) return null;
        throw e;
      }
    });
  }
}
