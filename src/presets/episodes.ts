// Holiday episode presets (ADR-017): one box set per holiday, spanning every TV library, open on the same dates as the
// matching seasonal film preset. Not a Kometa default; Kometa can't build episode collections in Plex this way.
import { DEFAULT_IMAGES, KOMETA_VERSION, SEASONAL_PRESETS } from './seasonal.js';
import type { SourceSpec } from '../sources/index.js';
import type { ActionType } from '../db/schema.js';
import type { Mode } from '../settings.js';

export type HolidayEpisodes = { key: string; keyName: string; imdbKeywords: string[]; titleWords: string[] };

/** Measured on 2 Nov on the development server (about 50 owned series): Christmas 30 owned + 12 title suggestions, Halloween 20 + 2, Thanksgiving 6 + 3. */
export const HOLIDAY_EPISODES: HolidayEpisodes[] = [
  { key: 'christmas', keyName: 'Christmas', imdbKeywords: ['christmas'], titleWords: ['christmas', 'xmas', 'x-mas'] },
  { key: 'halloween', keyName: 'Halloween', imdbKeywords: ['halloween'], titleWords: ['halloween'] },
  { key: 'thanksgiving', keyName: 'Thanksgiving', imdbKeywords: ['thanksgiving'], titleWords: ['thanksgiving'] },
];

export function holidayEpisodesDefinition(h: HolidayEpisodes) {
  const seasonal = SEASONAL_PRESETS.find((p) => p.key === h.key);
  if (!seasonal) throw new Error(`No seasonal preset "${h.key}" to take the window from`);
  const name = `${h.keyName} Episodes`;
  const sources: (SourceSpec & { role?: 'add' | 'suggest' })[] = [
    { type: 'imdb_episodes', config: { keywords: h.imdbKeywords } },
    // Title matches are only ever suggestions (ADR-018: never match by title).
    { type: 'jellyfin_episode_title', config: { words: h.titleWords }, role: 'suggest' },
  ];
  // IMDb's episode keywords are loose (sitcom episodes tagged "christmas" that aren't holiday episodes), so additions wait for review.
  const modes: Partial<Record<ActionType, Mode>> = { 'collection.add_items': 'review' };
  return {
    slug: `episodes-${h.key}`,
    name,
    target: 'episodes' as const,
    presetKey: `holiday_episodes:${h.key}`,
    presetRev: KOMETA_VERSION,
    window: seasonal.window,
    minItems: 1,
    syncMode: 'sync' as const,
    sortBy: 'release',
    sortTitle: `!00_${name}`,
    overview: `${h.keyName} episodes from the shows in your library.`,
    poster: { kind: 'url' as const, url: `${DEFAULT_IMAGES}/seasonal/${h.key}.jpg` },
    visibility: 'delete' as const,
    sources,
    modes,
  };
}
