// The 17 universe presets, ported from Kometa v2.5.3 defaults/both/universe.yml (ADR-014, NOTICE.md).
// One list each (IMDb, MDBList or TMDb). test/presets.test.ts checks every entry against the YAML.
import { DEFAULT_IMAGES, KOMETA_VERSION } from './seasonal.js';
import type { SourceSpec } from '../sources/index.js';

export type Universe = { key: string; name: string; source: SourceSpec; movieOnly: boolean; deleteCollectionsNamed: string[] };

const imdb = (listId: string): SourceSpec => ({ type: 'imdb_list', config: { listId } });
const mdblist = (url: string): SourceSpec => ({ type: 'mdblist_list', config: { url } });
const tmdbList = (listId: string): SourceSpec => ({ type: 'tmdb_list', config: { listId } });

export const UNIVERSES: Universe[] = [
  { key: 'avp', name: 'Alien / Predator', source: imdb('ls543971628'), movieOnly: true, deleteCollectionsNamed: [] },
  { key: 'arrow', name: 'Arrowverse', source: imdb('ls566667558'), movieOnly: false, deleteCollectionsNamed: [] },
  { key: 'askew', name: 'View Askewniverse', source: mdblist('https://mdblist.com/lists/k0meta/external/15362'), movieOnly: false, deleteCollectionsNamed: [] },
  { key: 'conjuring', name: 'Conjuring Universe', source: imdb('ls068768438'), movieOnly: true, deleteCollectionsNamed: ['The Conjuring Universe'] },
  { key: 'dca', name: 'DC Animated Universe', source: mdblist('https://mdblist.com/lists/johnfawkes/dca'), movieOnly: false, deleteCollectionsNamed: [] },
  { key: 'dceu', name: 'DC Extended Universe', source: mdblist('https://mdblist.com/lists/fa11en82/dc-extended-universe'), movieOnly: false, deleteCollectionsNamed: [] },
  { key: 'dcu', name: 'DC Universe', source: tmdbList('8642250'), movieOnly: false, deleteCollectionsNamed: [] },
  { key: 'fast', name: 'Fast & Furious', source: imdb('ls4102351575'), movieOnly: true, deleteCollectionsNamed: [] },
  { key: 'marvel', name: 'In Association With Marvel', source: mdblist('https://mdblist.com/lists/k0meta/external/15110'), movieOnly: false, deleteCollectionsNamed: [] },
  { key: 'mcu', name: 'Marvel Cinematic Universe', source: imdb('ls539646485'), movieOnly: false, deleteCollectionsNamed: [] },
  { key: 'middle', name: 'Middle Earth', source: mdblist('https://mdblist.com/lists/k0meta/external/46550'), movieOnly: false, deleteCollectionsNamed: [] },
  { key: 'rocky', name: 'Rocky / Creed', source: mdblist('https://mdblist.com/lists/k0meta/external/9248'), movieOnly: true, deleteCollectionsNamed: [] },
  { key: 'trek', name: 'Star Trek', source: imdb('ls547463722'), movieOnly: false, deleteCollectionsNamed: [] },
  { key: 'star', name: 'Star Wars Universe', source: imdb('ls501373412'), movieOnly: false, deleteCollectionsNamed: [] },
  { key: 'mummy', name: 'Mummy Universe', source: mdblist('https://mdblist.com/lists/k0meta/external/9249'), movieOnly: true, deleteCollectionsNamed: ['The Mummy Universe'] },
  { key: 'wizard', name: 'Wizarding World', source: mdblist('https://mdblist.com/lists/k0meta/external/23683'), movieOnly: true, deleteCollectionsNamed: [] },
  { key: 'xmen', name: 'X-Men Universe', source: imdb('ls567618635'), movieOnly: false, deleteCollectionsNamed: [] },
];

/** Kometa's universe + custom templates: section 040, minimum 2, Default-Images universe poster. */
export function universeDefinition(u: Universe) {
  return {
    slug: `universe-${u.key}`,
    name: u.name,
    target: (u.movieOnly ? 'movies' : 'both') as 'movies' | 'both',
    presetKey: `universe:${u.key}`,
    presetRev: KOMETA_VERSION,
    window: null,
    minItems: 2,
    syncMode: 'sync' as const,
    sortBy: 'release',
    sortTitle: `!040_${u.name}`,
    overview: null,
    poster: { kind: 'url' as const, url: `${DEFAULT_IMAGES}/universe/${u.key}.jpg` },
    visibility: 'delete' as const,
    sources: [u.source],
  };
}
