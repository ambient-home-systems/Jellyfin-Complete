// Change settings, schedules and which collections are on. Shared by the Settings and Collections pages and the MCP
// endpoint (ADR-033), so both check input the same way. Connections and keys are not here: they stay page-only.
import { eq } from 'drizzle-orm';
import { Cron } from 'croner';
import type { AppContext } from '../app-context.js';
import { definition, jobSchedule, type ActionType } from '../db/schema.js';
import { loadDefinition } from '../domain/definitions.js';
import type { Mode, Settings } from '../settings.js';
import { librariesModel } from './model.js';

export class SettingsError extends Error {}

/** The action modes the Settings page offers. Deleting a box set follows creating one; hiding and showing follow those. */
export const MODE_KEYS = ['collection.create', 'collection.add_items', 'collection.remove_items', 'collection.update_metadata', 'radarr.add_movie', 'sonarr.add_series', 'radarr.monitor_collection'] as const;
export type ModeKey = (typeof MODE_KEYS)[number];

export type SettingsPatch = {
  dryRun?: boolean;
  timezone?: string;
  leadDays?: number;
  defaultSnooze?: Settings['defaultSnooze'];
  neighbours?: Settings['neighbours'];
  arrCapPerRun?: number;
  releasedOnly?: boolean;
  modes?: Partial<Record<ModeKey, Mode>>;
  imdbRoute?: 'direct' | 'kometa_service' | 'snapshot';
  snapshotUrl?: string;
  /** Library IDs; null means every library of that kind, including ones added later. */
  movieLibraryIds?: string[] | null;
  showLibraryIds?: string[] | null;
  homeRows?: Partial<Settings['homeRows']>;
};

/** Check the whole patch, then save it. Throws SettingsError with a message for people. */
export function applySettings(app: AppContext, patch: SettingsPatch): { changed: (keyof Settings)[]; timezoneChanged: boolean } {
  const s = app.settings();
  const next: Partial<Settings> = {};
  if (patch.timezone !== undefined) {
    const tz = patch.timezone.trim();
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
    } catch {
      throw new SettingsError(`Unknown timezone “${tz}”.`);
    }
    next.timezone = tz;
  }
  if (patch.leadDays !== undefined) {
    if (!Number.isInteger(patch.leadDays) || patch.leadDays < 0 || patch.leadDays > 60) throw new SettingsError('Plan-ahead days must be 0–60.');
    next.leadDays = patch.leadDays;
  }
  if (patch.arrCapPerRun !== undefined || patch.releasedOnly !== undefined) {
    const cap = patch.arrCapPerRun ?? s.guardrails.arrCapPerRun;
    if (!Number.isInteger(cap) || cap < 0 || cap > 200) throw new SettingsError('The add cap must be 0–200.');
    next.guardrails = { arrCapPerRun: cap, releasedOnly: patch.releasedOnly ?? s.guardrails.releasedOnly };
  }
  if (patch.dryRun !== undefined) next.dryRun = patch.dryRun;
  if (patch.defaultSnooze !== undefined) {
    if (!['window', '7d', '30d'].includes(patch.defaultSnooze)) throw new SettingsError('Default snooze must be window, 7d or 30d.');
    next.defaultSnooze = patch.defaultSnooze;
  }
  if (patch.neighbours !== undefined) next.neighbours = patch.neighbours.map((n) => ({ name: n.name.trim(), time: n.time.trim() })).filter((n) => n.name);
  if (patch.modes) {
    const modes = { ...s.modes };
    for (const [k, v] of Object.entries(patch.modes)) {
      if (!(MODE_KEYS as readonly string[]).includes(k)) throw new SettingsError(`“${k}” has no mode of its own.`);
      if (v !== 'off' && v !== 'review' && v !== 'auto') throw new SettingsError(`Mode must be off, review or auto, not “${v}”.`);
      modes[k as ActionType] = v;
    }
    modes['collection.delete'] = modes['collection.create'];
    next.modes = modes;
  }
  if (patch.imdbRoute !== undefined || patch.snapshotUrl !== undefined) {
    const route = patch.imdbRoute ?? (s.imdbRoute === 'tmdb' ? 'direct' : s.imdbRoute);
    if (route !== 'direct' && route !== 'kometa_service' && route !== 'snapshot') throw new SettingsError('That IMDb route isn’t available.');
    const url = (patch.snapshotUrl ?? s.snapshotUrl).trim();
    if (url && !/^https?:\/\/\S+$/.test(url)) throw new SettingsError('The snapshot URL must start with http:// or https://');
    if (route === 'snapshot' && !url) throw new SettingsError('The snapshot route needs a snapshot URL.');
    next.imdbRoute = route;
    next.snapshotUrl = url;
  }
  const libs = librariesModel(app);
  const pick = (ids: string[] | null, type: 'movies' | 'tvshows', what: string): string[] | null => {
    if (ids === null) return null;
    const all = libs.filter((l) => l.collectionType === type).map((l) => l.id);
    const unknown = ids.filter((id) => !all.includes(id));
    if (unknown.length) throw new SettingsError(`Not a ${what} library: ${unknown.join(', ')}.`);
    if (!ids.length) throw new SettingsError(`Choose at least one ${what} library.`);
    return ids.length === all.length ? null : ids; // all of them = every library, including ones added later
  };
  if (patch.movieLibraryIds !== undefined) next.movieLibraryIds = pick(patch.movieLibraryIds, 'movies', 'film');
  if (patch.showLibraryIds !== undefined) next.showLibraryIds = pick(patch.showLibraryIds, 'tvshows', 'TV');
  if (patch.homeRows) {
    const h = { ...s.homeRows, ...patch.homeRows };
    if (!Number.isInteger(h.orderIndex) || h.orderIndex < 0 || h.orderIndex > 99) throw new SettingsError('Position must be a whole number from 0 to 99.');
    if (!['Portrait', 'Landscape', 'Square', 'Small'].includes(h.viewMode)) throw new SettingsError('View must be Portrait, Landscape, Square or Small.');
    next.homeRows = h;
  }
  app.updateSettings(next);
  return { changed: Object.keys(next) as (keyof Settings)[], timezoneChanged: next.timezone !== undefined && next.timezone !== s.timezone };
}

/** Change one job's schedule. Throws SettingsError for an unknown job or a bad cron expression. */
export function setSchedule(app: AppContext, job: string, change: { cron?: string; enabled?: boolean }): void {
  const row = app.db.select().from(jobSchedule).where(eq(jobSchedule.job, job)).get();
  if (!row) throw new SettingsError(`No job called “${job}”.`);
  const cron = (change.cron ?? row.cron).trim();
  try {
    new Cron(cron, { paused: true });
  } catch {
    throw new SettingsError(`“${cron}” isn’t a valid cron expression for ${job}.`);
  }
  app.db.update(jobSchedule).set({ cron, enabled: change.enabled ?? row.enabled }).where(eq(jobSchedule.job, job)).run();
}

/** Turn a collection on or off; returns a message for people. Throws SettingsError if there's no such collection. */
export function setCollectionEnabled(app: AppContext, id: number, on: boolean): string {
  const def = loadDefinition(app.db, id);
  if (!def) throw new SettingsError(`No collection with id ${id}.`);
  app.db.update(definition).set({ enabled: on, updatedAt: Date.now() }).where(eq(definition.id, id)).run();
  return on ? `${def.name} is on. The next run fetches its sources and plans it.` : `${def.name} is off. The next run removes its box set, if it has one.`;
}
