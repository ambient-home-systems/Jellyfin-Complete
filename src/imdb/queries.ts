// The IMDb queries a set of sources needs, in the snapshot's request format. Shared by the snapshot script and
// Settings → IMDb → "Download the query list". Fetch-free and node:-free.
import type { KometaImdbSearch } from './index.js';
import type { SnapshotRequest } from './snapshot.js';

/** Owned series per IMDb episode search: IMDb accepts up to 50 series IDs in one episodic constraint (spike 05). */
export const SERIES_PER_SEARCH = 50;

/** Kometa's keyword format: lower case, spaces become hyphens. */
export const imdbKeyword = (k: string) => k.trim().toLowerCase().replace(/\s+/g, '-');

/**
 * The IMDb searches for "episodes with these keywords, from series you own" (ADR-017). Series are sorted so the
 * batches, and so the snapshot keys, are the same wherever they're computed.
 */
export function episodeSearches(keywords: string[], seriesImdbIds: string[]): KometaImdbSearch[] {
  const series = [...new Set(seriesImdbIds)].sort();
  const out: KometaImdbSearch[] = [];
  for (let i = 0; i < series.length; i += SERIES_PER_SEARCH) {
    out.push({ type: ['tv_episode'], 'keyword.any': keywords.map(imdbKeyword), 'series.any': series.slice(i, i + SERIES_PER_SEARCH), limit: 1000 });
  }
  return out;
}

/** Every IMDb query these sources need. Episode sources need the owned series' IMDb IDs. */
export function queriesFor(sources: { type: string; config: Record<string, unknown> }[], seriesImdbIds: string[] = []): SnapshotRequest {
  const req: SnapshotRequest = { searches: [], lists: [], charts: [] };
  for (const s of sources) {
    if (s.type === 'imdb_chart' && s.config.chart && !req.charts!.includes(String(s.config.chart))) req.charts!.push(String(s.config.chart));
    if (s.type === 'imdb_episodes') req.searches.push(...episodeSearches(((s.config.keywords ?? []) as string[]).map(String), seriesImdbIds));
    else if (s.type === 'imdb_search' && s.config.search) req.searches.push(s.config.search as KometaImdbSearch);
    else if (s.type === 'imdb_list' && s.config.listId) req.lists.push({ listId: String(s.config.listId), ...(s.config.limit ? { limit: Number(s.config.limit) } : {}) });
  }
  return req;
}
