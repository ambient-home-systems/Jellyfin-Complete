// What a collection's sources list that your Jellyfin library doesn't have (Phase 2, ADR-027). Missing episodes stay
// Sonarr's own job; here "missing" means films (Radarr) and series (Sonarr).
import type { SourceItem } from '../db/schema.js';
import type { ResolvedSource } from '../sources/index.js';
import type { LoadedDefinition } from './definitions.js';
import type { LibraryIndex } from './matching.js';
import type { FindResult } from '../clients/tmdb.js';
import type { ArrApp } from '../clients/arr.js';

export type MissingTitle = {
  app: ArrApp;
  title: string | null;
  year: number | null;
  imdb?: string;
  tmdb?: string;
  tvdb?: string;
  /** Every ID form Radarr/Sonarr might know it by ("tmdb:603", "imdb:tt0133093", "tvdb:81189"). */
  keys: string[];
  /** The lookup term to add it by; Sonarr needs a TVDB ID, so a show without one can't be sent yet. */
  term: string | null;
  sources: { label: string; rank: number }[];
  bestRank: number;
};

export type ArrState = { library: Set<string>; monitoredNoFile: Set<string>; exclusions: Set<string> };
export type MissingStatus = 'not_in_arr' | 'in_arr' | 'monitored_no_file' | 'excluded' | 'needs_id';

function appFor(def: LoadedDefinition, item: SourceItem): ArrApp | null {
  if (def.target === 'episodes' || item.kind === 'episode') return null;
  if (def.target === 'movies') return item.kind === 'show' ? null : 'radarr';
  if (def.target === 'shows') return item.kind === 'movie' ? null : 'sonarr';
  return item.kind === 'movie' ? 'radarr' : item.kind === 'show' ? 'sonarr' : null; // "both": only when the kind is known
}

/**
 * Titles listed by the collection's "add" sources that aren't in the library, best-ranked first.
 * `found` gives cached TMDb /find results, so an IMDb-only title can still be matched or keyed by TMDb ID.
 */
export function missingTitles(def: LoadedDefinition, resolved: ResolvedSource[], index: LibraryIndex, found: (imdb: string) => FindResult | undefined): MissingTitle[] {
  const byKey = new Map<string, MissingTitle>();
  def.sources.forEach((src, i) => {
    const r = resolved[i];
    if (!r || src.role !== 'add') return;
    for (const item of r.items) {
      const app = appFor(def, item);
      if (!app) continue;
      const want = app === 'radarr' ? 'movie' : 'series';
      const f = item.imdb ? found(item.imdb) : undefined;
      if (index.matchDirect(item, want) || (item.imdb && f && index.matchFound(item, f, want))) continue; // owned
      const tmdb = item.tmdb ?? (f && (f.kind === 'movie' || f.kind === 'tv') ? f.tmdb : undefined);
      const keys = [item.imdb && `imdb:${item.imdb}`, tmdb && `tmdb:${tmdb}`, item.tvdb && `tvdb:${item.tvdb}`].filter(Boolean) as string[];
      if (!keys.length) continue;
      const existing = keys.map((k) => byKey.get(k)).find(Boolean);
      if (existing) {
        if (!existing.sources.some((s) => s.label === r.label)) existing.sources.push({ label: r.label, rank: item.rank });
        existing.bestRank = Math.min(existing.bestRank, item.rank);
        existing.title ??= item.title ?? null;
        existing.year ??= item.year ?? null;
        for (const k of keys) byKey.set(k, existing);
        continue;
      }
      const term = app === 'radarr' ? (tmdb ? `tmdb:${tmdb}` : item.imdb ? `imdb:${item.imdb}` : null) : item.tvdb ? `tvdb:${item.tvdb}` : null;
      const m: MissingTitle = {
        app, title: item.title ?? null, year: item.year ?? null, imdb: item.imdb, tmdb, tvdb: item.tvdb, keys, term,
        sources: [{ label: r.label, rank: item.rank }], bestRank: item.rank,
      };
      for (const k of keys) byKey.set(k, m);
    }
  });
  return [...new Set(byKey.values())].sort((a, b) => a.bestRank - b.bestRank || b.sources.length - a.sources.length || (a.title ?? '').localeCompare(b.title ?? ''));
}

export function statusOf(m: MissingTitle, state: ArrState | null): MissingStatus {
  if (state) {
    if (m.keys.some((k) => state.monitoredNoFile.has(k))) return 'monitored_no_file';
    if (m.keys.some((k) => state.library.has(k))) return 'in_arr';
    if (m.keys.some((k) => state.exclusions.has(k))) return 'excluded';
  }
  return m.term ? 'not_in_arr' : 'needs_id';
}
