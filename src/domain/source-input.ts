// Turns what someone types in the collection editor into a source spec, with a plain-language error
// when it can't. One text field per source; IDs or the URL you'd copy from the browser both work.
import type { SourceSpec } from '../sources/index.js';
import { IMDB_CHARTS, isImdbChart } from '../imdb/index.js';
import { STREAMING_SERVICES } from '../presets/streaming.js';

export type Target = 'movies' | 'shows' | 'both' | 'episodes';

export type SourceInput = {
  key: string;
  label: string;
  placeholder: string;
  parse: (value: string, target: Target) => SourceSpec | string;
};

const parts = (v: string) => v.split(',').map((s) => s.trim()).filter(Boolean);

/** Numeric IDs from "1575, 8091" or from TMDb URLs such as https://www.themoviedb.org/collection/1575-halloween-collection. */
function tmdbIds(v: string, path: string): string[] | null {
  const ids: string[] = [];
  for (const p of parts(v)) {
    const m = p.match(new RegExp(`themoviedb\\.org/${path}/(\\d+)`)) ?? p.match(/^(\d+)$/);
    if (!m) return null;
    ids.push(m[1]!);
  }
  return ids.length ? ids : null;
}

export const SOURCE_INPUTS: SourceInput[] = [
  {
    key: 'imdb_list', label: 'IMDb list', placeholder: 'ls066838460 or the list’s URL',
    parse: (v) => {
      const ids = parts(v).map((p) => p.match(/\b(ls\d{5,})\b/)?.[1]);
      if (!ids.length || ids.some((x) => !x)) return 'Enter an IMDb list ID (ls…) or its URL.';
      return ids.length === 1 ? { type: 'imdb_list', config: { listId: ids[0] } } : { type: 'imdb_search', config: { search: { 'list.any': ids, limit: 500 } } };
    },
  },
  {
    key: 'imdb_keyword', label: 'IMDb keywords', placeholder: 'christmas, santa claus',
    parse: (v, target) => {
      const kws = parts(v).map((k) => k.toLowerCase().replace(/\s+/g, '-'));
      if (!kws.length) return 'Enter one or more IMDb keywords, separated by commas.';
      const type = target === 'shows' ? ['tv_series', 'tv_mini_series'] : target === 'movies' ? ['movie'] : undefined;
      return { type: 'imdb_search', config: { search: { 'keyword.any': kws, ...(type ? { type } : {}), limit: 500 } } };
    },
  },
  {
    key: 'imdb_chart', label: 'IMDb chart', placeholder: 'top (Top 250), popular or lowest',
    parse: (v, target) => {
      const w = v.trim().toLowerCase().replace(/[\s-]+/g, '_');
      const shows = target === 'shows';
      const chart = isImdbChart(w) ? w
        : /^top(_250)?$/.test(w) ? (shows ? 'top_shows' : 'top_movies')
        : /^(most_)?popular$/.test(w) ? (shows ? 'popular_shows' : 'popular_movies')
        : /^lowest(_rated)?$/.test(w) && !shows ? 'lowest_rated' : null;
      return chart ? { type: 'imdb_chart', config: { chart } } : `Enter one IMDb chart: ${Object.keys(IMDB_CHARTS).join(', ')} (or top, popular, lowest).`;
    },
  },
  {
    key: 'streaming_service', label: 'Streaming service', placeholder: 'Netflix, Disney+, Prime Video…',
    parse: (v, target) => {
      const w = v.trim().toLowerCase();
      const service = STREAMING_SERVICES.find((s) => s.key === w || s.name.toLowerCase() === w);
      if (!service) return `Enter one streaming service: ${STREAMING_SERVICES.map((s) => s.name).join(', ')}.`;
      if (target !== 'movies' && target !== 'shows') return 'A streaming-service source needs a collection of films or of shows.';
      return { type: 'tmdb_watch_provider', config: { service: service.key, kind: target === 'shows' ? 'show' : 'movie' } };
    },
  },
  ...([['recent_released', 'Released in the last … days', 'premiere'], ['recent_added', 'Added in the last … days', 'added']] as const).map(([key, label, field]): SourceInput => ({
    key, label, placeholder: field === 'premiere' ? '90 (for episodes: aired)' : '30',
    parse: (v, target) => {
      const days = Number(v.trim());
      if (!Number.isInteger(days) || days < 1 || days > 3650) return 'Enter a number of days from 1 to 3650.';
      if (target === 'both') return 'This source needs a collection of films, shows or episodes.';
      return { type: 'jellyfin_recent', config: { field, days, kind: target === 'movies' ? 'movie' : target === 'shows' ? 'series' : 'episode' } };
    },
  })),
  {
    key: 'mdblist_list', label: 'MDBList list', placeholder: 'https://mdblist.com/lists/user/list-name',
    // Also external lists MDBList imports from elsewhere: https://mdblist.com/lists/user/external/15110
    parse: (v) => (/^https:\/\/mdblist\.com\/lists\/[^/\s]+\/[^/\s]+(\/[^/\s]+)?\/?$/.test(v.trim()) ? { type: 'mdblist_list', config: { url: v.trim().replace(/\/$/, '') } } : 'Enter an MDBList list URL, like https://mdblist.com/lists/user/list-name.'),
  },
  {
    key: 'letterboxd_list', label: 'Letterboxd list', placeholder: 'https://letterboxd.com/user/list/list-name/',
    parse: (v) => {
      const m = v.trim().match(/^https:\/\/letterboxd\.com\/([^/\s]+)\/list\/([^/\s]+)\/?$/);
      return m ? { type: 'letterboxd_list', config: { url: `https://letterboxd.com/${m[1]}/list/${m[2]}/` } } : 'Enter a Letterboxd list URL, like https://letterboxd.com/user/list/list-name/.';
    },
  },
  {
    key: 'tmdb_collection', label: 'TMDb collections', placeholder: '1575, 8091 or collection URLs',
    parse: (v) => { const ids = tmdbIds(v, 'collection'); return ids ? { type: 'tmdb_collection', config: { ids } } : 'Enter TMDb collection IDs or URLs, separated by commas.'; },
  },
  {
    key: 'tmdb_keyword', label: 'TMDb keywords', placeholder: 'christmas or keyword IDs',
    parse: (v, target) => {
      const kws = parts(v);
      if (!kws.length) return 'Enter one or more TMDb keywords or keyword IDs, separated by commas.';
      return { type: 'tmdb_keyword', config: { keywords: kws, media: target === 'shows' ? 'tv' : 'movie' } };
    },
  },
  {
    key: 'tmdb_list', label: 'TMDb list', placeholder: '8136 or the list’s URL',
    parse: (v) => { const ids = tmdbIds(v, 'list'); return ids?.length === 1 ? { type: 'tmdb_list', config: { listId: ids[0] } } : 'Enter one TMDb list ID or URL.'; },
  },
  {
    key: 'tmdb_movie', label: 'TMDb films', placeholder: '603, 604 or film URLs',
    parse: (v) => { const ids = tmdbIds(v, 'movie'); return ids ? { type: 'tmdb_movie', config: { ids } } : 'Enter TMDb film IDs or URLs, separated by commas.'; },
  },
  {
    key: 'tmdb_show', label: 'TMDb shows', placeholder: '1399 or show URLs',
    parse: (v) => { const ids = tmdbIds(v, 'tv'); return ids ? { type: 'tmdb_show', config: { ids } } : 'Enter TMDb show IDs or URLs, separated by commas.'; },
  },
  {
    key: 'imdb_episodes', label: 'IMDb episode keywords', placeholder: 'christmas (episodes of shows you own)',
    parse: (v) => {
      const kws = parts(v);
      return kws.length ? { type: 'imdb_episodes', config: { keywords: kws } } : 'Enter one or more IMDb keywords, separated by commas.';
    },
  },
  {
    key: 'episode_titles', label: 'Episode titles (suggestions only)', placeholder: 'christmas, xmas',
    parse: (v) => {
      const words = parts(v);
      return words.length ? { type: 'jellyfin_episode_title', config: { words } } : 'Enter one or more words to look for in episode titles.';
    },
  },
  {
    key: 'plex_collection', label: 'Plex collection', placeholder: 'Netflix Movies (the exact name in Plex)',
    parse: (v) => (v.trim() ? { type: 'plex_collection', config: { name: v.trim() } } : 'Enter the collection’s exact name in Plex.'),
  },
  ...(['tags', 'genres', 'studios'] as const).map((field): SourceInput => ({
    key: `jellyfin_${field}`, label: `Jellyfin ${field.slice(0, -1).replace(/ie$/, 'y')}`, placeholder: field === 'tags' ? 'christmas' : field === 'genres' ? 'Horror' : 'Pixar',
    parse: (v, target) => {
      const vals = parts(v);
      if (!vals.length) return `Enter one or more Jellyfin ${field}, separated by commas.`;
      return { type: 'jellyfin_query', config: { [field]: vals, kind: target === 'shows' ? 'series' : 'movie' } };
    },
  })),
];

export function parseSourceInput(key: string, value: string, target: Target): SourceSpec | string {
  const input = SOURCE_INPUTS.find((s) => s.key === key);
  if (!input) return 'Choose a source type.';
  if (!value.trim()) return `Enter a value for ${input.label}.`;
  return input.parse(value, target);
}
