// Every preset the app ships, in one registry. Seasonal films and holiday episodes start on; show franchises and universes start off
// (Kometa's defaults are opt-in, and Jellyfin already builds TMDb franchise collections). ADR-014.
import { SEASONAL_PRESETS, presetDefinition } from './seasonal.js';
import { SHOW_FRANCHISES, showFranchiseDefinition } from './franchise.js';
import { UNIVERSES, universeDefinition } from './universe.js';
import { HOLIDAY_EPISODES, holidayEpisodesDefinition } from './episodes.js';
import type { ActionType, WindowDef, Poster } from '../db/schema.js';
import type { SourceSpec } from '../sources/index.js';
import type { Mode } from '../settings.js';

export type PresetFamily = 'seasonal' | 'holiday_episodes' | 'film_series' | 'show_franchise' | 'universe';

export const FAMILY_LABEL: Record<PresetFamily | 'custom', string> = {
  seasonal: 'Seasonal',
  holiday_episodes: 'Holiday episodes',
  custom: 'Your collections',
  universe: 'Universes',
  show_franchise: 'Show franchises',
  film_series: 'Film series',
};

export type PresetDefinition = {
  slug: string; name: string; target: 'movies' | 'shows' | 'both' | 'episodes'; presetKey: string; presetRev: string;
  window: WindowDef | null; minItems: number; syncMode: 'sync' | 'append'; sortBy: string; sortTitle: string | null;
  overview: string | null; poster: Poster; visibility: 'delete' | 'tag_gate';
  sources: (SourceSpec & { role?: 'add' | 'suggest' })[];
  /** Per-collection mode overrides seeded with the preset. */
  modes?: Partial<Record<ActionType, Mode>>;
};

export type Preset = {
  family: PresetFamily;
  definition: PresetDefinition;
  /** Older or alternative names for the same collection, offered on the adoption screen. */
  deleteCollectionsNamed: string[];
  enabledByDefault: boolean;
};

export const PRESETS: Preset[] = [
  ...SEASONAL_PRESETS.map((p): Preset => ({ family: 'seasonal', definition: presetDefinition(p), deleteCollectionsNamed: p.deleteCollectionsNamed, enabledByDefault: true })),
  ...HOLIDAY_EPISODES.map((h): Preset => ({ family: 'holiday_episodes', definition: holidayEpisodesDefinition(h), deleteCollectionsNamed: [], enabledByDefault: true })),
  ...UNIVERSES.map((u): Preset => ({ family: 'universe', definition: universeDefinition(u), deleteCollectionsNamed: u.deleteCollectionsNamed, enabledByDefault: false })),
  ...SHOW_FRANCHISES.map((f): Preset => ({ family: 'show_franchise', definition: showFranchiseDefinition(f), deleteCollectionsNamed: [], enabledByDefault: false })),
];

/** "seasonal:christmas" → "seasonal"; custom collections have no preset key. */
export function familyOf(presetKey: string | null): PresetFamily | 'custom' {
  const f = presetKey?.split(':')[0];
  return f === 'seasonal' || f === 'holiday_episodes' || f === 'film_series' || f === 'show_franchise' || f === 'universe' ? f : 'custom';
}
