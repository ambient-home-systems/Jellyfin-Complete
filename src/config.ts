// Process configuration from the environment. Everything install-specific lives in Settings (ADR-031);
// the environment only says where /config is, which port to bind, and optional dev seeds for connections.
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The app's version, from package.json (also stamped on the Docker image and its release tag). */
export const APP_VERSION: string = (() => {
  try {
    return (JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as { version?: string }).version ?? 'dev';
  } catch {
    return 'dev';
  }
})();

/** Load KEY=VALUE pairs from a .env file in the working directory, without overriding real env vars. */
export function loadDotEnv(path = join(process.cwd(), '.env')): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] && !(m[1] in process.env)) process.env[m[1]] = (m[2] ?? '').replace(/^["']|["']$/g, '');
  }
}

export type AppConfig = {
  port: number;
  configDir: string;
  timezone: string;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** Connection seeds from the environment (dev convenience; production uses Settings). */
  seeds: Partial<Record<SeedKey, string>>;
  /** Believe X-Forwarded-For/-Proto from a reverse proxy in front of the app (TRUST_PROXY=1). */
  trustProxy: boolean;
  /** First-run setup code to require instead of a random one (SETUP_CODE), for scripted installs. */
  setupCode: string | null;
};

export const SEED_KEYS = [
  'JELLYFIN_URL', 'JELLYFIN_API_KEY', 'TMDB_API_KEY', 'MDBLIST_API_KEY',
  'PLEX_URL', 'PLEX_TOKEN', 'RADARR_URL', 'RADARR_API_KEY', 'SONARR_URL', 'SONARR_API_KEY',
] as const;
export type SeedKey = (typeof SEED_KEYS)[number];

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const seeds: AppConfig['seeds'] = {};
  for (const k of SEED_KEYS) if (env[k]) seeds[k] = env[k];
  const level = (env.LOG_LEVEL ?? 'info').toLowerCase();
  return {
    port: Number(env.PORT ?? 8097),
    configDir: resolve(env.CONFIG_DIR ?? join(process.cwd(), 'config')),
    timezone: env.TZ && env.TZ !== ':/etc/localtime' ? env.TZ : Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    logLevel: (['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info') as AppConfig['logLevel'],
    seeds,
    trustProxy: /^(1|true|yes)$/i.test(env.TRUST_PROXY ?? ''),
    setupCode: env.SETUP_CODE?.trim() || null,
  };
}
