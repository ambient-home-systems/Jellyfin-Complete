// Which presets have a poster of the app's own (ADR-045), from which artwork, with what lettering. Seasonal films,
// holiday episodes, New and recent, IMDb charts and streaming services. Universes, show franchises and film series
// keep the posters they had: they show franchises' own characters and worlds, which the app doesn't draw.
import type { PosterTitle } from './compose.js';

/**
 * The set's revision. Raise it whenever the artwork, the lettering or the layout changes: it's part of each poster's
 * key, so every box set wearing an older version gets the new one on the next run.
 */
export const BUNDLED_POSTERS_REV = 1;

export type BundledPoster = {
  /** The preset's slug: the poster's name in the image (dist/posters/<key>.jpg). */
  key: string;
  /** The artwork it's made from (assets/posters/art/<art>.webp). */
  art: string;
  title: PosterTitle;
  /** Streaming: the service's colour, the shared picture is tinted in. */
  tint?: string;
};

/** Seasonal titles that read better split ("Asian American & Pacific Islander" over "Heritage Month"). */
const SEASONAL: Record<string, Partial<PosterTitle>> = {
  aapi: { kicker: 'Asian American & Pacific Islander', main: 'Heritage Month' },
  disabilities: { kicker: 'International Day of', main: 'Persons with Disabilities' },
  lgbtq: { kicker: 'LGBTQ+', main: 'Pride Month' },
};

/** Each streaming service's colour (no logos: the name is set in the app's type). */
export const SERVICE_TINT: Record<string, string> = {
  channel4: '#3CB043', appletv: '#8E9AAF', bet: '#8B3DFF', crave: '#2D7FF9', crunchyroll: '#F47521', discovery: '#2175D9',
  disney: '#113CCF', itvx: '#C5D32F', hbomax: '#5A2AE6', hayu: '#E5007E', hulu: '#1CE783', movistar: '#019DF4',
  atresplayer: '#FF6E00', netflix: '#E50914', now: '#00B3A6', paramount: '#1F6BFF', peacock: '#009E8E', amazon: '#00A8E1',
  amc: '#E0A100', filmin: '#D9006C', tubi: '#FFD60A', youtube: '#FF0000',
};

const KINDS: Record<string, string> = { movies: 'Movies', shows: 'Shows', movie: 'Movies', series: 'Shows' };
/** "Christmas Movies" → { main: "Christmas", sub: "Movies" }. */
const split = (name: string): PosterTitle => {
  const m = name.match(/^(.*?)\s+(Movies|Shows|Episodes)$/);
  return m ? { main: m[1]!, sub: m[2]! } : { main: name };
};

/** The app's own poster for a preset, or null if it keeps the one it had. */
export function bundledPosterFor(def: { slug: string; name: string; presetKey: string | null }): BundledPoster | null {
  const [family, key, kind] = (def.presetKey ?? '').split(':');
  const base = { key: def.slug };
  switch (family) {
    case 'seasonal':
      return { ...base, art: `seasonal-${key}`, title: { ...split(def.name), ...SEASONAL[key!] } };
    case 'holiday_episodes':
      return { ...base, art: `episodes-${key}`, title: split(def.name) };
    case 'basic': {
      const art = key!.startsWith('released') ? 'basic-new-releases' : key === 'episodes' ? 'basic-new-episodes' : 'basic-recently-added';
      return { ...base, art, title: key === 'episodes' ? { main: 'New Episodes' } : split(def.name) };
    }
    case 'imdb_chart': {
      const art = key!.startsWith('top') ? 'chart-top-250' : key!.startsWith('popular') ? 'chart-popular' : 'chart-lowest-rated';
      const t = split(def.name.replace(/^IMDb\s+/, ''));
      return { ...base, art, title: { kicker: 'IMDb', ...t } };
    }
    case 'streaming':
      return SERVICE_TINT[key!] ? { ...base, art: 'streaming', title: { main: split(def.name).main, sub: KINDS[kind!] ?? split(def.name).sub }, tint: SERVICE_TINT[key!] } : null;
    default:
      return null;
  }
}
