// Streaming-service collections (ADR-036), ported from Kometa v2.5.3 defaults/both/streaming.yml (NOTICE.md):
// "Netflix Movies", "Disney+ Shows"… holding the titles you own that stream on that service in your region.
// Kometa asks TMDb's discover for each service's whole catalogue; this app asks TMDb, once a week per title you own,
// which services carry it. test/streaming.test.ts checks every entry below against the YAML.
import { DEFAULT_IMAGES, KOMETA_VERSION } from './seasonal.js';
import { pyQuote } from './franchise.js';
import type { PresetDefinition } from './index.js';

export type StreamingService = {
  key: string;
  name: string;
  /** TMDb watch-provider IDs (Kometa's tmdb_key). */
  providers: number[];
  /** Kometa's allowed_libraries: show. */
  showsOnly?: boolean;
  /** The service's earlier names; "<old> Movies" and "<old> Shows" are offered on the adoption screen. */
  oldNames?: string[];
};

export const STREAMING_SERVICES: StreamingService[] = [
  { key: 'channel4', name: 'Channel 4', providers: [103], oldNames: ['All 4'] },
  { key: 'appletv', name: 'Apple TV', providers: [350], oldNames: ['Apple TV+'] },
  { key: 'bet', name: 'BET+', providers: [1759] },
  { key: 'crave', name: 'Crave', providers: [230] },
  { key: 'crunchyroll', name: 'Crunchyroll', providers: [283], showsOnly: true },
  { key: 'discovery', name: 'discovery+', providers: [510], showsOnly: true },
  { key: 'disney', name: 'Disney+', providers: [337] },
  { key: 'itvx', name: 'ITVX', providers: [41, 2300], oldNames: ['BritBox'] },
  { key: 'hbomax', name: 'HBO Max', providers: [1899], oldNames: ['Max'] },
  { key: 'hayu', name: 'hayu', providers: [223], showsOnly: true },
  { key: 'hulu', name: 'Hulu', providers: [15] },
  { key: 'movistar', name: 'Movistar Plus+', providers: [149, 339, 2241] },
  { key: 'atresplayer', name: 'Atres Player', providers: [62, 2162] },
  { key: 'netflix', name: 'Netflix', providers: [8] },
  { key: 'now', name: 'NOW', providers: [39] },
  { key: 'paramount', name: 'Paramount+', providers: [531, 1770], oldNames: ['Showtime'] },
  { key: 'peacock', name: 'Peacock', providers: [387] },
  { key: 'amazon', name: 'Prime Video', providers: [9] },
  { key: 'amc', name: 'AMC+', providers: [528, 1854] },
  { key: 'filmin', name: 'Filmin', providers: [63] },
  { key: 'youtube', name: 'YouTube', providers: [188] },
  { key: 'tubi', name: 'tubi', providers: [73] },
];

export const serviceByKey = (key: unknown): StreamingService | undefined => STREAMING_SERVICES.find((s) => s.key === key);

/** Prime Video is provider 9 in Austria, Germany, the UK, Japan and the US, and 119 everywhere else (Kometa's final_tmdb_key). */
const AMAZON_9 = ['AT', 'DE', 'GB', 'JP', 'US'];

/** The service's TMDb provider IDs in this country. */
export function providerIdsIn(s: StreamingService, region: string): number[] {
  if (s.key === 'amazon' && !AMAZON_9.includes(region)) return [119];
  return s.providers;
}

/** Kometa's allowed_streaming: services only offered in one country, and two not offered in Canada. */
export function availableIn(s: StreamingService, region: string): boolean {
  if (['channel4', 'itvx', 'now'].includes(s.key)) return region === 'GB';
  if (['movistar', 'atresplayer', 'filmin'].includes(s.key)) return region === 'ES';
  if (s.key === 'crave') return region === 'CA';
  if (s.key === 'hbomax') return region !== 'CA';
  return true;
}

/** "streaming:netflix:movies" → the service. */
export const serviceOfPreset = (presetKey: string | null): StreamingService | undefined => serviceByKey(presetKey?.split(':')[1]);

/**
 * Kometa's streaming template: "<name> Movies" / "<name> Shows" (title_format), section 030, sync, minimum 1, the
 * Default-Images colour poster. Kometa sorts newest first; Jellyfin box sets can only show oldest first, so release order.
 */
export function streamingDefinition(s: StreamingService, kind: 'movies' | 'shows'): PresetDefinition {
  const noun = kind === 'movies' ? 'Movies' : 'Shows';
  const name = `${s.name} ${noun}`;
  return {
    slug: `streaming-${s.key}-${kind}`,
    name,
    target: kind,
    presetKey: `streaming:${s.key}:${kind}`,
    presetRev: KOMETA_VERSION,
    window: null,
    minItems: 1,
    syncMode: 'sync',
    sortBy: 'release',
    sortTitle: `!030_${name}`,
    overview: `${noun} streaming on ${s.name}.`,
    poster: { kind: 'url', url: `${DEFAULT_IMAGES}/streaming/color/${pyQuote(s.name)}.jpg` },
    visibility: 'delete',
    sources: [{ type: 'tmdb_watch_provider', config: { service: s.key, kind: kind === 'movies' ? 'movie' : 'show' } }],
  };
}

/** Every streaming preset: films and shows for each service, shows only where Kometa says so. */
export function streamingPresets(): { service: StreamingService; definition: PresetDefinition; oldNames: string[] }[] {
  return STREAMING_SERVICES.flatMap((s) => (s.showsOnly ? (['shows'] as const) : (['movies', 'shows'] as const)).map((kind) => ({
    service: s,
    definition: streamingDefinition(s, kind),
    oldNames: (s.oldNames ?? []).map((o) => `${o} ${kind === 'movies' ? 'Movies' : 'Shows'}`),
  })));
}
