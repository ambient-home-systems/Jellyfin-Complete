// New and recent collections (ADR-037): Kometa v2.5.3 defaults/chart/basic.yml (NOTICE.md), Newly Released (released in
// the last 90 days) and New Episodes (aired in the last 7 days), plus Recently Added (added in the last 30 days), which
// Kometa's basic file no longer has but its poster still exists for. Built from your Jellyfin library's own dates.
import { DEFAULT_IMAGES, KOMETA_VERSION } from './seasonal.js';
import { pyQuote } from './franchise.js';
import type { PresetDefinition } from './index.js';

export type BasicPreset = {
  key: string;
  /** Kometa's collection name, which is also its poster's file name. */
  keyName: 'Newly Released' | 'New Episodes' | 'Recently Added';
  kind: 'movie' | 'series' | 'episode';
  field: 'premiere' | 'added';
  days: number;
};

export const BASIC_PRESETS: BasicPreset[] = [
  { key: 'released_movies', keyName: 'Newly Released', kind: 'movie', field: 'premiere', days: 90 },
  { key: 'released_shows', keyName: 'Newly Released', kind: 'series', field: 'premiere', days: 90 },
  { key: 'episodes', keyName: 'New Episodes', kind: 'episode', field: 'premiere', days: 7 },
  { key: 'added_movies', keyName: 'Recently Added', kind: 'movie', field: 'added', days: 30 },
  { key: 'added_shows', keyName: 'Recently Added', kind: 'series', field: 'added', days: 30 },
];

const NOUN = { movie: 'movies', series: 'shows', episode: 'episodes' } as const;

/**
 * Kometa's basic chart template: section 010, sync, minimum 1, the Default-Images colour chart poster, Kometa's summary.
 * Titles age out every day, so taking them out applies without review (while dry run is off), like adding them.
 */
export function basicDefinition(b: BasicPreset): PresetDefinition {
  const noun = NOUN[b.kind];
  const name = b.kind === 'episode' ? b.keyName : `${b.keyName} ${noun[0]!.toUpperCase()}${noun.slice(1)}`;
  return {
    slug: `basic-${b.key.replace(/_/g, '-')}`,
    name,
    target: b.kind === 'movie' ? 'movies' : b.kind === 'series' ? 'shows' : 'episodes',
    presetKey: `basic:${b.key}`,
    presetRev: KOMETA_VERSION,
    window: null,
    minItems: 1,
    syncMode: 'sync',
    sortBy: 'release',
    sortTitle: `!010_${name}`,
    overview: b.field === 'added' ? `A collection of recently-added ${noun}.` : `A collection of newly-released ${noun}.`,
    poster: { kind: 'url', url: `${DEFAULT_IMAGES}/chart/color/${pyQuote(b.keyName)}.jpg` },
    visibility: 'delete',
    sources: [{ type: 'jellyfin_recent', config: { field: b.field, days: b.days, kind: b.kind } }],
    modes: { 'collection.remove_items': 'auto' },
  };
}
