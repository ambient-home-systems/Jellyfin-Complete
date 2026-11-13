// IMDb chart collections (ADR-036), ported from Kometa v2.5.3 defaults/chart/imdb.yml (NOTICE.md): the titles you own
// from IMDb's Top 250, Most Popular and Lowest Rated charts. Kometa makes one "IMDb Top 250" per Plex library; Jellyfin
// shows every collection together, so the films and shows versions are named apart.
import { DEFAULT_IMAGES, KOMETA_VERSION } from './seasonal.js';
import { pyQuote } from './franchise.js';
import type { PresetDefinition } from './index.js';
import type { ImdbChart } from '../imdb/index.js';

export type ChartPreset = { chart: ImdbChart; keyName: 'IMDb Top 250' | 'IMDb Popular' | 'IMDb Lowest Rated'; kind: 'movies' | 'shows' };

export const CHART_PRESETS: ChartPreset[] = [
  { chart: 'popular_movies', keyName: 'IMDb Popular', kind: 'movies' },
  { chart: 'popular_shows', keyName: 'IMDb Popular', kind: 'shows' },
  { chart: 'top_movies', keyName: 'IMDb Top 250', kind: 'movies' },
  { chart: 'top_shows', keyName: 'IMDb Top 250', kind: 'shows' },
  { chart: 'lowest_rated', keyName: 'IMDb Lowest Rated', kind: 'movies' },
];

/** Kometa's chart template: section 020, sync, minimum 1, the Default-Images colour chart poster, Kometa's summary. */
export function chartDefinition(c: ChartPreset): PresetDefinition {
  const name = `${c.keyName} ${c.kind === 'movies' ? 'Movies' : 'Shows'}`;
  return {
    slug: `chart-${c.chart.replace(/_/g, '-')}`,
    name,
    target: c.kind,
    presetKey: `imdb_chart:${c.chart}`,
    presetRev: KOMETA_VERSION,
    window: null,
    minItems: 1,
    syncMode: 'sync',
    sortBy: 'release',
    sortTitle: `!020_${name}`,
    overview: `List of ${name}.`,
    poster: { kind: 'url', url: `${DEFAULT_IMAGES}/chart/color/${pyQuote(c.keyName)}.jpg` },
    visibility: 'delete',
    sources: [{ type: 'imdb_chart', config: { chart: c.chart } }],
  };
}
