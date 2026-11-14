// Typed settings with defaults (ADR-007, ADR-011, ADR-021, ADR-031). Stored as one JSON row per top-level key.
import { eq } from 'drizzle-orm';
import { setting } from './db/schema.js';
import type { ActionType, ArrOptions } from './db/schema.js';
import type { DB } from './db/index.js';

export type Mode = 'off' | 'review' | 'auto';
export type ImdbRoute = 'direct' | 'kometa_service' | 'snapshot' | 'tmdb';

export type Settings = {
  connections: { jellyfinUrl: string; plexUrl: string; radarrUrl: string; sonarrUrl: string };
  timezone: string;
  dryRun: boolean;
  modes: Record<ActionType, Mode>;
  guardrails: { arrCapPerRun: number; releasedOnly: boolean };
  leadDays: number;
  imdbRoute: ImdbRoute;
  snapshotUrl: string;
  /** Library IDs that seasonal movie presets draw from; null = every movies library. */
  movieLibraryIds: string[] | null;
  /** Library IDs for show/episode presets; null = every TV library. */
  showLibraryIds: string[] | null;
  /** Other tools' schedules, shown beside ours in Settings (e.g. Kometa, Jellyfin-Auto-Collections). */
  neighbours: { name: string; time: string }[];
  defaultSnooze: 'window' | '7d' | '30d';
  firstRunDone: boolean;
  /** Defaults for titles sent to Radarr and Sonarr (ADR-027); a collection can override them. */
  arr: { radarr: ArrOptions; sonarr: ArrOptions };
  /** Home-screen rows (Phase 3, ADR-025): off until you turn them on. */
  homeRows: { enabled: boolean; orderIndex: number; viewMode: 'Portrait' | 'Landscape' | 'Square' | 'Small' };
  /** The first-run guide (Phase 4): steps you've confirmed, and whether it's finished or skipped. */
  onboarding: { done: OnboardingStep[]; finished: boolean };
  /** Film series (ADR-035): a collection for each TMDb film series you own at least `minimum` films of. Off until turned on. */
  filmSeries: { enabled: boolean; minimum: number };
  /** Streaming-service collections (ADR-036): the country whose services count, as a two-letter code. */
  streaming: { region: string };
  /** Poster overlays (ADR-039): Kometa's status badges on shows, and its IMDb Top 250 ribbon. Off until turned on. */
  /** The optional read-only media mount (ADR-044): off by default. `map` is found by the app (Jellyfin's path → the mount). */
  media: { enabled: boolean; dir: string; map: { from: string; to: string } | null };
  overlays: {
    status: boolean; imdbTop250: boolean;
    /** Libraries whose titles get no overlays. Null: the default, every kids' library (overlays/badges.ts kidsLibraries). */
    skipLibraryIds?: string[] | null;
  };
  /** Library health (ADR-041): flag files whose length or title tags don't match the title. Read-only; on by default. */
  health: {
    enabled: boolean;
    /** Libraries where "No poster" and "Poster from the video or file" are fixed from TMDb without asking (ADR-043). */
    autoFixLibraryIds?: string[];
  };
  /** The Jellyfin version seen at the last run (Phase 4 compatibility). */
  server: { version: string | null; seenAt: number | null };
};

export type OnboardingStep = 'libraries' | 'timezone' | 'families';

export const DEFAULT_MODES: Record<ActionType, Mode> = {
  'collection.create': 'auto',
  'collection.delete': 'auto',
  'collection.add_items': 'auto',
  'collection.remove_items': 'review',
  'collection.update_metadata': 'auto',
  // Hiding and showing follow the delete and create modes (router); these entries only complete the record.
  'collection.hide': 'auto',
  'collection.show': 'auto',
  'radarr.add_movie': 'review',
  'radarr.monitor_collection': 'review',
  'sonarr.add_series': 'review',
};

export function defaultSettings(timezone: string): Settings {
  return {
    connections: { jellyfinUrl: '', plexUrl: '', radarrUrl: '', sonarrUrl: '' },
    timezone,
    dryRun: true,
    modes: { ...DEFAULT_MODES },
    guardrails: { arrCapPerRun: 10, releasedOnly: true },
    leadDays: 14,
    imdbRoute: 'direct',
    snapshotUrl: '',
    movieLibraryIds: null,
    showLibraryIds: null,
    neighbours: [],
    defaultSnooze: 'window',
    firstRunDone: false,
    arr: {
      radarr: { monitored: true, searchOnAdd: true, minimumAvailability: 'released', tags: [] },
      sonarr: { monitored: true, searchOnAdd: true, seriesType: 'standard', seasonFolder: true, monitor: 'all', tags: [] },
    },
    homeRows: { enabled: false, orderIndex: 2, viewMode: 'Portrait' },
    onboarding: { done: [], finished: false },
    filmSeries: { enabled: false, minimum: 2 },
    streaming: { region: 'US' },
    media: { enabled: false, dir: '/media', map: null },
    overlays: { status: false, imdbTop250: false, skipLibraryIds: null },
    health: { enabled: true, autoFixLibraryIds: [] },
    server: { version: null, seenAt: null },
  };
}

export function getSettings(db: DB, timezone: string): Settings {
  const base = defaultSettings(timezone) as Record<string, unknown>;
  for (const row of db.select().from(setting).all()) {
    if (!(row.key in base)) continue;
    const def = base[row.key];
    base[row.key] = def && typeof def === 'object' && !Array.isArray(def) && row.value && typeof row.value === 'object'
      ? { ...(def as object), ...(row.value as object) }
      : row.value;
  }
  return base as Settings;
}

export function updateSettings(db: DB, patch: Partial<Settings>): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    // null means "back to the default" (e.g. every library); the column can't hold null, so drop the row.
    if (value === null) {
      db.delete(setting).where(eq(setting.key, key)).run();
      continue;
    }
    db.insert(setting).values({ key, value }).onConflictDoUpdate({ target: setting.key, set: { value } }).run();
  }
}
