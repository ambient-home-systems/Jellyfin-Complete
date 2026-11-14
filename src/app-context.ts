// Everything a request handler or job needs: database, settings, secrets, and clients built from them.
import { join } from 'node:path';
import type { AppConfig } from './config.js';
import { openDb, type DB } from './db/index.js';
import { SecretStore, loadOrCreateKey, type SecretName } from './secrets.js';
import { getSettings, updateSettings, type Settings } from './settings.js';
import { JellyfinClient } from './clients/jellyfin/index.js';
import { TmdbClient } from './clients/tmdb.js';
import { PlexClient } from './clients/plex.js';
import { ArrClient } from './clients/arr.js';
import { newSetupCode } from './web/security.js';
import { run, setting } from './db/schema.js';
import { eq } from 'drizzle-orm';
import type { FetchLike } from './clients/http.js';
import { seedPresets, upgradePosters, upgradePresets } from './domain/definitions.js';
import { seedSchedules } from './jobs/schedules.js';

export type AppContext = {
  config: AppConfig;
  db: DB;
  secrets: SecretStore;
  fetch: FetchLike;
  settings: () => Settings;
  updateSettings: (patch: Partial<Settings>) => void;
  jellyfin: () => JellyfinClient | null;
  tmdb: () => TmdbClient | null;
  plex: () => PlexClient | null;
  radarr: () => ArrClient | null;
  sonarr: () => ArrClient | null;
  /** Required on the setup page until Jellyfin is connected; printed in the log at start (Phase 4 hardening). */
  setupCode: string | null;
};

export function createContext(config: AppConfig, opts: { db?: DB; fetch?: FetchLike; jellyfinFetch?: FetchLike } = {}): AppContext {
  const db = opts.db ?? openDb(join(config.configDir, 'maverick.db'));
  const secrets = new SecretStore(db, loadOrCreateKey(config.configDir));
  const f: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  const ctx: AppContext = {
    config,
    db,
    secrets,
    fetch: f,
    settings: () => getSettings(db, config.timezone),
    updateSettings: (patch) => updateSettings(db, patch),
    jellyfin: () => {
      const url = ctx.settings().connections.jellyfinUrl;
      const key = secrets.get('jellyfin.apiKey');
      return url && key ? new JellyfinClient({ baseUrl: url, apiKey: key, fetch: opts.jellyfinFetch ?? f }) : null;
    },
    tmdb: () => {
      const key = secrets.get('tmdb.apiKey');
      return key ? new TmdbClient(db, key, f) : null;
    },
    plex: () => {
      const url = ctx.settings().connections.plexUrl;
      const token = secrets.get('plex.token');
      return url && token ? new PlexClient(url, token, f) : null;
    },
    radarr: () => {
      const url = ctx.settings().connections.radarrUrl;
      const key = secrets.get('radarr.apiKey');
      return url && key ? new ArrClient('radarr', url, key, f) : null;
    },
    setupCode: null,
    sonarr: () => {
      const url = ctx.settings().connections.sonarrUrl;
      const key = secrets.get('sonarr.apiKey');
      return url && key ? new ArrClient('sonarr', url, key, f) : null;
    },
  };
  seedFromEnv(ctx);
  // Pin the timezone on first start, so a later TZ change can't silently move every window.
  if (!db.select().from(setting).where(eq(setting.key, 'timezone')).get()) ctx.updateSettings({ timezone: config.timezone });
  ctx.setupCode = ctx.jellyfin() ? null : config.setupCode ?? newSetupCode();
  // Installs that have already run don't need the first-run guide.
  if (!ctx.settings().onboarding.finished && db.select({ id: run.id }).from(run).limit(1).get()) {
    ctx.updateSettings({ onboarding: { ...ctx.settings().onboarding, finished: true } });
  }
  seedPresets(db);
  upgradePresets(db);
  upgradePosters(db);
  seedSchedules(db);
  return ctx;
}

/** Development convenience: connection values from .env fill empty settings once. Production uses Settings. */
function seedFromEnv(ctx: AppContext): void {
  const s = ctx.config.seeds;
  const conn = { ...ctx.settings().connections };
  let changed = false;
  for (const [k, field] of [['JELLYFIN_URL', 'jellyfinUrl'], ['PLEX_URL', 'plexUrl'], ['RADARR_URL', 'radarrUrl'], ['SONARR_URL', 'sonarrUrl']] as const) {
    if (s[k] && !conn[field]) { conn[field] = s[k]; changed = true; }
  }
  if (changed) ctx.updateSettings({ connections: conn });
  const secretSeeds: [keyof AppConfig['seeds'], SecretName][] = [
    ['JELLYFIN_API_KEY', 'jellyfin.apiKey'], ['TMDB_API_KEY', 'tmdb.apiKey'], ['MDBLIST_API_KEY', 'mdblist.apiKey'],
    ['PLEX_TOKEN', 'plex.token'], ['RADARR_API_KEY', 'radarr.apiKey'], ['SONARR_API_KEY', 'sonarr.apiKey'],
  ];
  for (const [env, name] of secretSeeds) {
    const v = s[env];
    if (v && !ctx.secrets.get(name)) ctx.secrets.set(name, v);
  }
}
