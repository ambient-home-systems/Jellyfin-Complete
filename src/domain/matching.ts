// Match source items to library items by provider IDs only — never by title (ADR-018).
import type { SourceItem, Provenance } from '../db/schema.js';
import type { FindResult } from '../clients/tmdb.js';

export type LibRow = {
  jfId: string;
  kind: 'movie' | 'series' | 'episode';
  libraryId: string;
  name: string;
  year: number | null;
  imdb: string | null;
  tmdb: string | null;
  tvdb: string | null;
  tmdbCollection?: string | null;
  seriesJfId: string | null;
  season: number | null;
  episode: number | null;
  officialRating: string | null;
  genres: string[];
};

export type Match = { jfId: string; method: string; rank: number };

export class LibraryIndex {
  private byImdb = new Map<string, LibRow>();
  private byTmdbMovie = new Map<string, LibRow>();
  private byTmdbShow = new Map<string, LibRow>();
  private byTvdbShow = new Map<string, LibRow>();
  private episodesBySeries = new Map<string, Map<string, LibRow>>();
  private byJf = new Map<string, LibRow>();
  readonly rows: LibRow[];

  constructor(rows: LibRow[]) {
    this.rows = rows;
    for (const r of rows) {
      this.byJf.set(r.jfId, r);
      if (r.imdb) this.byImdb.set(r.imdb, r);
      if (r.kind === 'movie' && r.tmdb) this.byTmdbMovie.set(r.tmdb, r);
      if (r.kind === 'series' && r.tmdb) this.byTmdbShow.set(r.tmdb, r);
      if (r.kind === 'series' && r.tvdb) this.byTvdbShow.set(r.tvdb, r);
      if (r.kind === 'episode' && r.seriesJfId && r.season !== null && r.episode !== null) {
        const m = this.episodesBySeries.get(r.seriesJfId) ?? new Map();
        m.set(`${r.season}x${r.episode}`, r);
        this.episodesBySeries.set(r.seriesJfId, m);
      }
    }
  }

  get(jfId: string): LibRow | undefined {
    return this.byJf.get(jfId);
  }

  /** "Series · S02E10 · Episode" for episodes, the plain name otherwise. */
  displayName(r: LibRow): string {
    if (r.kind !== 'episode') return r.name;
    const series = r.seriesJfId ? this.byJf.get(r.seriesJfId)?.name : undefined;
    const se = r.season !== null && r.episode !== null ? `S${pad(r.season)}E${pad(r.episode)}` : null;
    return [series, se, r.name].filter(Boolean).join(' · ');
  }

  /** Synchronous match: Jellyfin ID (library-based sources), IMDb, then TMDb, then TVDB. */
  matchDirect(item: SourceItem, want: 'movie' | 'series' | 'episode' | 'any'): Match | null {
    const ok = (r: LibRow | undefined) => r && (want === 'any' || r.kind === want) ? r : undefined;
    if (item.jf) {
      const own = ok(this.byJf.get(item.jf));
      if (own) return { jfId: own.jfId, method: item.kind === 'episode' && !item.imdb ? 'episode title' : 'Jellyfin', rank: item.rank };
    }
    let r = item.imdb ? ok(this.byImdb.get(item.imdb)) : undefined;
    if (r) return { jfId: r.jfId, method: `IMDb ${item.imdb}`, rank: item.rank };
    if (item.tmdb) {
      r = item.kind === 'show' ? ok(this.byTmdbShow.get(item.tmdb)) : ok(this.byTmdbMovie.get(item.tmdb)) ?? (item.kind === 'other' ? ok(this.byTmdbShow.get(item.tmdb)) : undefined);
      if (r) return { jfId: r.jfId, method: `TMDb ${item.tmdb}`, rank: item.rank };
    }
    if (item.tvdb) {
      r = ok(this.byTvdbShow.get(item.tvdb));
      if (r) return { jfId: r.jfId, method: `TVDB ${item.tvdb}`, rank: item.rank };
    }
    return null;
  }

  /** Fallback via TMDb /find for IMDb IDs that didn't match directly (films without an IMDb ID, episodes without IDs). */
  matchFound(item: SourceItem, found: FindResult, want: 'movie' | 'series' | 'episode' | 'any'): Match | null {
    if (!found) return null;
    if (found.kind === 'movie' && (want === 'movie' || want === 'any')) {
      const r = this.byTmdbMovie.get(found.tmdb);
      if (r) return { jfId: r.jfId, method: `TMDb ${found.tmdb} via /find`, rank: item.rank };
    }
    if (found.kind === 'tv' && (want === 'series' || want === 'any')) {
      const r = this.byTmdbShow.get(found.tmdb);
      if (r) return { jfId: r.jfId, method: `TMDb ${found.tmdb} via /find`, rank: item.rank };
    }
    if (found.kind === 'episode' && (want === 'episode' || want === 'any')) {
      const show = this.byTmdbShow.get(found.showTmdb);
      const ep = show ? this.episodesBySeries.get(show.jfId)?.get(`${found.season}x${found.episode}`) : undefined;
      if (ep) return { jfId: ep.jfId, method: `series TMDb ${found.showTmdb} S${pad(found.season)}E${pad(found.episode)}`, rank: item.rank };
    }
    return null;
  }

  /** Which kinds of unmatched IMDb IDs /find could still place: films with only a TMDb ID, episodes without an IMDb ID. */
  findWorthwhile(): { movies: boolean; episodes: boolean } {
    return {
      movies: this.rows.some((r) => r.kind === 'movie' && !r.imdb && r.tmdb),
      episodes: this.rows.some((r) => r.kind === 'episode' && !r.imdb && r.seriesJfId),
    };
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Merge matches from several sources into members with provenance. */
export function mergeProvenance(perSource: { key: string; label: string; matches: Match[] }[]): Map<string, Provenance> {
  const out = new Map<string, Provenance>();
  for (const s of perSource) {
    for (const m of s.matches) {
      const p = out.get(m.jfId) ?? { sources: [], match: m.method };
      if (!p.sources.some((x) => x.key === s.key)) p.sources.push({ key: s.key, label: s.label, rank: m.rank });
      out.set(m.jfId, p);
    }
  }
  return out;
}
