// Collections, Missing and Radarr/Sonarr defaults: create and edit collections, their sources and pinned or excluded
// titles, delete them, and send missing titles. Shared by the pages and the MCP endpoint (ADR-034), so both check input
// and record decisions the same way.
import type { Poster } from '../db/schema.js';
import { checkPosterUrl, defaultPoster, PosterError, removePosterFile, savePosterFile } from '../domain/posters.js';
import { identityCtx, secureArtwork } from '../pipeline/boxset-identity.js';
import { and, eq, inArray } from 'drizzle-orm';
import type { AppContext } from '../app-context.js';
import { action, definition, definitionArr, definitionMode, definitionSource, libraryItem, managedCollection, membership, pin, type ActionType, type ArrOptions, type Filters, type WindowDef } from '../db/schema.js';
import { loadDefinition } from '../domain/definitions.js';
import { LibraryIndex, type LibRow } from '../domain/matching.js';
import { parseSourceInput, type Target } from '../domain/source-input.js';
import { sourceKey, sourceLabel } from '../sources/index.js';
import { executeArrDue, forgetArrState, resolveTerm } from '../pipeline/arr.js';
import { fingerprint, RATING_ORDER } from '../pipeline/planner.js';
import { cached } from '../cache.js';
import type { Mode } from '../settings.js';
import { missingFor } from './missing-model.js';
import { SettingsError, MODE_KEYS, type ModeKey } from './settings-actions.js';

const MMDD = /^(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])$/;
const slugify = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'collection';

/** Dates as MM/DD to MM/DD, or null for all year. */
export function rangeWindow(dates: { from: string; to: string } | null): WindowDef | null {
  if (!dates) return null;
  const from = dates.from.trim();
  const to = dates.to.trim();
  if (!MMDD.test(from) || !MMDD.test(to)) throw new SettingsError('Dates must be MM/DD, for example 12/01.');
  return { type: 'range', from, to };
}

function mustLoad(app: AppContext, id: number) {
  const def = loadDefinition(app.db, id);
  if (!def) throw new SettingsError(`No collection with id ${id}.`);
  return def;
}

const checkName = (name: string) => {
  const n = name.trim();
  if (!n || n.length > 200) throw new SettingsError('Name is required (up to 200 characters).');
  return n;
};

export function createCollection(app: AppContext, input: { name: string; target: Target; dates: { from: string; to: string } | null; sourceType: string; sourceValue: string }): number {
  const name = checkName(input.name);
  const window = rangeWindow(input.dates);
  const spec = parseSourceInput(input.sourceType, input.sourceValue, input.target);
  if (typeof spec === 'string') throw new SettingsError(spec);
  let slug = `custom-${slugify(name)}`;
  for (let n = 2; app.db.select({ id: definition.id }).from(definition).where(eq(definition.slug, slug)).get(); n++) slug = `custom-${slugify(name)}-${n}`;
  const now = Date.now();
  const row = app.db.insert(definition).values({
    slug, name, target: input.target, enabled: true, presetKey: null, presetRev: null, window, filters: {}, libraryIds: null, minItems: 1,
    syncMode: 'sync', sortBy: 'title.asc', sortTitle: null, overview: null, poster: { kind: 'none' }, visibility: 'delete', createdAt: now, updatedAt: now,
  }).returning({ id: definition.id }).get();
  // Title matches are only ever suggestions (ADR-018).
  app.db.insert(definitionSource).values({ definitionId: row.id, type: spec.type, config: spec.config, role: spec.type === 'jellyfin_episode_title' ? 'suggest' : 'add', position: 0 }).run();
  return row.id;
}

export type CollectionPatch = {
  name?: string;
  enabled?: boolean;
  overview?: string | null;
  minItems?: number;
  /** MM/DD to MM/DD, or null for all year. Collections whose dates follow a rule (such as Easter) can't take fixed dates. */
  dates?: { from: string; to: string } | null;
  syncMode?: 'sync' | 'append';
  sortTitle?: string | null;
  visibility?: 'delete' | 'tag_gate';
  homeRow?: boolean;
  addMissing?: boolean;
  /** Per-collection modes; 'default' follows Settings. Creating also sets deleting. */
  modes?: Partial<Record<ModeKey, Mode | 'default'>>;
  /** Only titles that pass these join the collection. Replaces the whole set; {} clears them. */
  filters?: Filters;
};

function checkFilters(f: Filters): Filters {
  const out: Filters = {};
  const year = (v: number | null | undefined, what: string) => {
    if (v === null || v === undefined) return undefined;
    if (!Number.isInteger(v) || v < 1880 || v > 2100) throw new SettingsError(`${what} must be a year such as 1990.`);
    return v;
  };
  const yf = year(f.yearFrom, 'From year');
  const yt = year(f.yearTo, 'To year');
  if (yf !== undefined && yt !== undefined && yf > yt) throw new SettingsError('From year is after to year.');
  if (yf !== undefined) out.yearFrom = yf;
  if (yt !== undefined) out.yearTo = yt;
  const genres = (g: string[] | undefined) => (g ?? []).map((x) => x.trim()).filter(Boolean);
  if (genres(f.genresInclude).length) out.genresInclude = genres(f.genresInclude);
  if (genres(f.genresExclude).length) out.genresExclude = genres(f.genresExclude);
  if (f.maxRating) {
    if (!RATING_ORDER.includes(f.maxRating)) throw new SettingsError(`Maximum rating must be one of ${RATING_ORDER.join(', ')}.`);
    out.maxRating = f.maxRating;
  }
  return out;
}

export function updateCollection(app: AppContext, id: number, patch: CollectionPatch): void {
  const def = mustLoad(app, id);
  const set: Partial<typeof definition.$inferInsert> = {};
  if (patch.name !== undefined) set.name = checkName(patch.name);
  if (patch.minItems !== undefined) {
    if (!Number.isInteger(patch.minItems) || patch.minItems < 1 || patch.minItems > 1000) throw new SettingsError('Minimum items must be a whole number from 1 to 1000.');
    set.minItems = patch.minItems;
  }
  if (patch.dates !== undefined) {
    if (def.window && def.window.type !== 'range') throw new SettingsError(`${def.name}'s dates follow a rule (${def.window.type === 'easter' ? 'Easter' : 'a weekday in the month'}), so they can't be set to fixed dates.`);
    set.window = rangeWindow(patch.dates);
  }
  if (patch.modes) {
    for (const k of Object.keys(patch.modes)) if (!(MODE_KEYS as readonly string[]).includes(k)) throw new SettingsError(`“${k}” has no mode of its own.`);
    for (const v of Object.values(patch.modes)) if (!['off', 'review', 'auto', 'default'].includes(String(v))) throw new SettingsError(`Mode must be off, review, auto or default, not “${v}”.`);
  }
  if (patch.filters !== undefined) set.filters = checkFilters(patch.filters);
  if (patch.enabled !== undefined) set.enabled = patch.enabled;
  if (patch.overview !== undefined) set.overview = patch.overview?.trim() || null;
  if (patch.syncMode !== undefined) set.syncMode = patch.syncMode === 'append' ? 'append' : 'sync';
  if (patch.sortTitle !== undefined) set.sortTitle = patch.sortTitle?.trim() || null;
  if (patch.visibility !== undefined) set.visibility = patch.visibility === 'tag_gate' ? 'tag_gate' : 'delete';
  if (patch.homeRow !== undefined) set.homeRow = patch.homeRow;
  app.db.transaction((tx) => {
    tx.update(definition).set({ ...set, updatedAt: Date.now() }).where(eq(definition.id, id)).run();
    if (patch.addMissing !== undefined) {
      tx.insert(definitionArr).values({ definitionId: id, addMissing: patch.addMissing, options: {} })
        .onConflictDoUpdate({ target: definitionArr.definitionId, set: { addMissing: patch.addMissing } }).run();
    }
    for (const [k, v] of Object.entries(patch.modes ?? {})) {
      const types: ActionType[] = k === 'collection.create' ? ['collection.create', 'collection.delete'] : [k as ActionType];
      for (const actionType of types) {
        tx.delete(definitionMode).where(and(eq(definitionMode.definitionId, id), eq(definitionMode.actionType, actionType))).run();
        if (v !== 'default') tx.insert(definitionMode).values({ definitionId: id, actionType, mode: v as Mode }).run();
      }
    }
  });
}

export function addSource(app: AppContext, id: number, input: { type: string; value: string; suggestOnly?: boolean }): string {
  const def = mustLoad(app, id);
  const spec = parseSourceInput(input.type, input.value, def.target);
  if (typeof spec === 'string') throw new SettingsError(spec);
  const key = sourceKey(spec);
  if (def.sources.some((s) => sourceKey({ type: s.type, config: s.config }) === key)) throw new SettingsError('That source is already on this collection.');
  const position = Math.max(-1, ...def.sources.map((s) => s.position)) + 1;
  const role = input.suggestOnly || spec.type === 'jellyfin_episode_title' ? 'suggest' : 'add'; // title matches only suggest (ADR-018)
  app.db.insert(definitionSource).values({ definitionId: id, type: spec.type, config: spec.config, role, position }).run();
  app.db.update(definition).set({ updatedAt: Date.now() }).where(eq(definition.id, id)).run();
  return `Added ${sourceLabel(spec)}. The next run fetches it.`;
}

export function removeSource(app: AppContext, id: number, sourceId: number): string {
  const def = mustLoad(app, id);
  const src = def.sources.find((s) => s.id === sourceId);
  if (!src) throw new SettingsError('That source no longer exists.');
  if (def.presetKey && def.sources.length === 1) throw new SettingsError('A preset needs at least one source. Turn the collection off instead.');
  app.db.delete(definitionSource).where(eq(definitionSource.id, src.id)).run();
  app.db.update(definition).set({ updatedAt: Date.now() }).where(eq(definition.id, id)).run();
  return `Removed ${sourceLabel({ type: src.type, config: src.config })}. Titles only it supplied are proposed for removal on the next run.`;
}

export function setSourceRole(app: AppContext, id: number, sourceId: number, role: 'add' | 'suggest'): string {
  const def = mustLoad(app, id);
  const src = def.sources.find((s) => s.id === sourceId);
  if (!src) throw new SettingsError('That source no longer exists.');
  if (src.type === 'jellyfin_episode_title' && role === 'add') throw new SettingsError('Episode-title matches can only be suggestions; they’re matched by title, not by ID.');
  app.db.update(definitionSource).set({ role }).where(eq(definitionSource.id, src.id)).run();
  app.db.update(definition).set({ updatedAt: Date.now() }).where(eq(definition.id, id)).run();
  return role === 'suggest' ? 'Its titles now go to Review as suggestions.' : 'Its titles are now added directly.';
}

/** Always include a title (pin), never include it (exclude), or clear either. */
export function setPin(app: AppContext, id: number, jfId: string, kind: 'pin' | 'exclude' | 'clear'): string {
  mustLoad(app, id);
  if (!jfId) throw new SettingsError('Nothing selected.');
  app.db.delete(pin).where(and(eq(pin.definitionId, id), eq(pin.jfId, jfId))).run();
  if (kind === 'pin' || kind === 'exclude') app.db.insert(pin).values({ definitionId: id, jfId, kind }).run();
  return kind === 'pin' ? 'Pinned. The next run adds it.' : kind === 'exclude' ? 'Excluded. The next run proposes removing it if it’s in the box set.' : 'Cleared.';
}

/** Delete one of your own collections (not a preset), once its box set is gone. */
export type PosterChoice = { kind: 'default' } | { kind: 'none' } | { kind: 'url'; url: string } | { kind: 'upload'; bytes: Uint8Array };

/**
 * Set a collection's poster (ADR-042): an image address, an uploaded image, the preset's own, or none. Choosing it is
 * the approval, so a live box set gets it straight away; otherwise it goes on when the box set is created.
 */
export async function setPoster(app: AppContext, id: number, choice: PosterChoice): Promise<string> {
  const def = mustLoad(app, id);
  let poster: Poster;
  try {
    if (choice.kind === 'none') poster = { kind: 'none' };
    else if (choice.kind === 'default') {
      const d = defaultPoster(app, def.presetKey);
      if (!d) throw new SettingsError('This collection has no poster of its own to go back to.');
      poster = d;
    } else if (choice.kind === 'url') {
      const url = choice.url.trim();
      await checkPosterUrl(app.fetch, url);
      poster = { kind: 'url', url };
    } else {
      if (!choice.bytes.length) throw new SettingsError('Choose an image to upload.');
      poster = await savePosterFile(app.config.configDir, id, choice.bytes);
    }
  } catch (e) {
    if (e instanceof PosterError) throw new SettingsError(e.message);
    throw e;
  }
  const old = def.poster;
  app.db.update(definition).set({ poster, updatedAt: Date.now() }).where(eq(definition.id, id)).run();
  if (old.kind === 'file' && !(poster.kind === 'file' && poster.file === old.file)) removePosterFile(app.config.configDir, old);
  const m = app.db.select().from(managedCollection).where(eq(managedCollection.definitionId, id)).get();
  if (m?.jfBoxsetId && (m.state === 'live' || m.state === 'hidden') && app.jellyfin()) {
    try {
      await secureArtwork(identityCtx(app), { ...def, poster }, m.jfBoxsetId);
      return poster.kind === 'none' ? 'Poster removed, from its box set in Jellyfin too.' : 'Poster saved and put on its box set in Jellyfin.';
    } catch (e) {
      return `Poster saved. Putting it on the box set in Jellyfin failed (${(e as Error).message}); the next run tries again.`;
    }
  }
  return poster.kind === 'none' ? 'Poster removed.' : 'Poster saved. It goes on the box set when the collection is next created.';
}

export function deleteCollection(app: AppContext, id: number): string {
  const def = mustLoad(app, id);
  if (def.presetKey) throw new SettingsError('Presets can’t be deleted; turn it off instead.');
  const m = app.db.select().from(managedCollection).where(eq(managedCollection.definitionId, id)).get();
  if (m?.state === 'live' || m?.state === 'hidden') throw new SettingsError('Turn it off and run once to remove its box set first.');
  app.db.transaction((tx) => {
    tx.delete(definitionSource).where(eq(definitionSource.definitionId, id)).run();
    tx.delete(definitionMode).where(eq(definitionMode.definitionId, id)).run();
    tx.delete(pin).where(eq(pin.definitionId, id)).run();
    tx.delete(membership).where(eq(membership.definitionId, id)).run();
    tx.delete(managedCollection).where(eq(managedCollection.definitionId, id)).run();
    tx.update(action).set({ status: 'superseded', updatedAt: Date.now() }).where(and(eq(action.definitionId, id), inArray(action.status, ['proposed', 'approved', 'snoozed']))).run();
    tx.delete(definition).where(eq(definition.id, id)).run();
  });
  removePosterFile(app.config.configDir, def.poster);
  return `Deleted ${def.name}.`;
}

/**
 * Send missing titles of a collection to Radarr (films) or Sonarr (shows), now or as proposals in Review.
 * `keys` are the titles' first IDs as the Missing page lists them ("tmdb:603", "imdb:tt0133093", "tvdb:81189").
 */
export async function sendMissing(app: AppContext, input: { defId: number; tab: 'movies' | 'shows'; keys: string[]; sendNow: boolean; options: ArrOptions; by: string }): Promise<{ ok: boolean; message: string }> {
  const def = mustLoad(app, input.defId);
  const which = input.tab === 'movies' ? 'radarr' : 'sonarr';
  const name = which === 'radarr' ? 'Radarr' : 'Sonarr';
  const ids = new Set(input.keys);
  if (!ids.size) throw new SettingsError('Select at least one title.');
  const cap = app.settings().guardrails.arrCapPerRun;
  if (ids.size > cap) throw new SettingsError(`Select up to ${cap} at a time. That’s the per-run cap in Settings.`);
  const chosen = missingFor(app, def, input.tab, new LibraryIndex(app.db.select().from(libraryItem).all() as LibRow[])).filter((m) => ids.has(m.keys[0]!));
  if (!chosen.length) throw new SettingsError(`None of those are missing titles of ${def.name}. Use the keys list_missing gives.`);
  const type = which === 'radarr' ? 'radarr.add_movie' as const : 'sonarr.add_series' as const;
  const now = Date.now();
  const created: number[] = [];
  const noId: string[] = [];
  for (const m of chosen) {
    const term = await resolveTerm(app, m).catch(() => null);
    if (!term) { noId.push(m.title ?? m.keys[0]!); continue; }
    const fp = fingerprint(type, term);
    // A title for Review and Activity when the source had none (e.g. TMDb ID lists); cached for a day.
    const cl = which === 'radarr' ? app.radarr() : app.sonarr();
    const info = !m.title && cl ? await cached(app.db, `${which}:lookup:${term}`, 1, () => cl.lookup(term)).catch(() => null) : null;
    app.db.update(action).set({ status: 'superseded', updatedAt: now }).where(and(eq(action.fingerprint, fp), inArray(action.status, ['proposed', 'approved']))).run();
    const row = app.db.insert(action).values({
      type, fingerprint: fp, definitionId: def.id, mode: 'review', status: input.sendNow ? 'approved' : 'proposed', reason: `Chosen on the Missing page by ${input.by}`,
      item: { name: m.title ?? info?.title ?? term, year: m.year ?? info?.year ?? null, provenance: { sources: m.sources.map((x) => ({ key: x.label, label: x.label, rank: x.rank })), match: 'missing' } },
      payload: { app: which, term, options: input.options, manual: true }, decidedBy: input.sendNow ? input.by : null, decidedAt: input.sendNow ? now : null, createdAt: now, updatedAt: now,
    }).returning({ id: action.id }).get();
    created.push(row.id);
  }
  const noIdNote = noId.length ? ` ${noId.length} couldn’t be sent: no TVDB ID (add a TMDb key to look them up).` : '';
  if (!input.sendNow) return { ok: true, message: `${created.length} queued in Review.${noIdNote}` };
  const r = await executeArrDue(app, now, created);
  const parts = [`Sent ${r.applied} to ${name}.`];
  if (r.skipped.length) parts.push(`Skipped ${r.skipped.map((x) => `${x.title} (${x.why})`).join(', ')}.`);
  if (r.failed.length) parts.push(`Failed: ${r.failed.map((x) => `${x.title}: ${x.why}`).join('; ')}.`);
  return { ok: !(r.failed.length && !r.applied), message: parts.join(' ') + noIdNote };
}

/** Have Radarr monitor a TMDb collection, so it adds that collection's films itself. */
export async function monitorInRadarr(app: AppContext, input: { defId: number; radarrCollectionId: number; title: string; by: string }): Promise<{ ok: boolean; message: string }> {
  const def = mustLoad(app, input.defId);
  if (!Number.isInteger(input.radarrCollectionId)) throw new SettingsError('That collection no longer exists.');
  const now = Date.now();
  const id = input.radarrCollectionId;
  const row = app.db.insert(action).values({
    type: 'radarr.monitor_collection', fingerprint: fingerprint('radarr.monitor_collection', id), definitionId: def.id, mode: 'review', status: 'approved',
    reason: `Chosen on the Missing page by ${input.by}`, item: { name: input.title || `Radarr collection ${id}`, year: null },
    payload: { app: 'radarr', radarrCollectionIds: [id], collectionTitle: input.title, manual: true }, decidedBy: input.by, decidedAt: now, createdAt: now, updatedAt: now,
  }).returning({ id: action.id }).get();
  const r = await executeArrDue(app, now, [row.id]);
  return r.applied ? { ok: true, message: `Radarr now monitors ${input.title}. It adds the missing films itself as they’re released.` } : { ok: false, message: r.failed[0]?.why ?? 'Radarr didn’t accept that.' };
}

/** Save the defaults for titles sent to Radarr or Sonarr. */
export function saveArrDefaults(app: AppContext, which: 'radarr' | 'sonarr', options: ArrOptions): void {
  app.updateSettings({ arr: { ...app.settings().arr, [which]: options } });
  forgetArrState();
}
