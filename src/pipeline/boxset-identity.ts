// Box set identity and artwork (ADR-040). Jellyfin identifies an unlocked box set by a TMDb name search and attaches
// what it finds: a provider ID, poster, backdrop, logo, thumb and overview, sometimes from the wrong collection
// ("Inside Out" matched an adult collection; "9-1-1" matched "9½ Weeks"). So for every box set it manages, the app owns:
// - its provider IDs: the TMDb collection for a film series, none for anything else
// - its images: the app's poster (or none) and nothing else: no backdrop, logo, thumb, banner or art
// - its lock: created locked, and never unlocked. LockData isn't changed on an existing box set, because Jellyfin copies a
//   lock change to every title in it; a managed box set found unlocked is replaced by a fresh locked one instead.
// Each run checks every managed box set against what the app last wrote, and repairs any difference straight away.
import { eq } from 'drizzle-orm';
import type { AppContext } from '../app-context.js';
import type { DB } from '../db/index.js';
import type { BaseItemDto, JellyfinClient } from '../clients/jellyfin/index.js';
import type { FetchLike } from '../clients/http.js';
import { integrityEvent, managedCollection, posterKey, type ArtworkState } from '../db/schema.js';
import { postersDir, readPoster } from '../domain/posters.js';
import type { LoadedDefinition } from '../domain/definitions.js';
import { SERIES_PREFIX } from '../presets/film-series.js';
import { desiredMeta, GATE_TAG, LOCKED_FIELDS, MANAGED_TAG } from './planner.js';
import { log } from '../log.js';

/** How long to wait after creating box sets before checking Jellyfin didn't attach anything (it does so within ~2 s). */
export const IDENTITY_TIMING = { recheckMs: 4000 };

/** What these functions need: the database, the Jellyfin client and fetch (for posters). */
export type IdentityCtx = { db: DB; jf: JellyfinClient; fetch: FetchLike; /** Where uploaded posters are kept (ADR-042). */ postersDir: string };
export function identityCtx(app: AppContext): IdentityCtx {
  const jf = app.jellyfin();
  if (!jf) throw new Error('Jellyfin is not connected');
  return { db: app.db, jf, fetch: app.fetch, postersDir: postersDir(app.config.configDir) };
}

type Def = Pick<LoadedDefinition, 'id' | 'name' | 'presetKey' | 'poster' | 'sortTitle' | 'overview' | 'sortBy'>;

/** The provider IDs a managed box set should carry: a film series its TMDb collection, everything else none. */
export function expectedProviderIds(def: Pick<Def, 'presetKey'>): Record<string, string> {
  return def.presetKey?.startsWith(SERIES_PREFIX) ? { Tmdb: def.presetKey.slice(SERIES_PREFIX.length) } : {};
}

/** A drift that isn't a repair: the poster was changed in the app (editor or Claude), and goes on the box set now. */
export const POSTER_SETTING = 'its poster was changed in the app';
const cleanIds = (ids: Record<string, string | null | undefined> | null | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(ids ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => [k.toLowerCase(), String(v)]));
const sameIds = (a: Record<string, string | null | undefined> | null | undefined, b: Record<string, string>) => {
  const x = cleanIds(a), y = cleanIds(b);
  return Object.keys(x).length === Object.keys(y).length && Object.entries(y).every(([k, v]) => x[k] === v);
};
const describeIds = (ids: Record<string, string | null | undefined> | null | undefined) => {
  const c = cleanIds(ids);
  return Object.keys(c).length ? Object.entries(c).map(([k, v]) => `${k === 'tmdb' ? 'TMDb' : k} ${v}`).join(', ') : 'none';
};

/** What's wrong with a managed box set's identity and artwork, in words; empty if nothing. */
export function identityDrift(item: BaseItemDto, def: Def, state: ArtworkState | null): string[] {
  const out: string[] = [];
  const want = expectedProviderIds(def);
  if (!sameIds(item.ProviderIds, want)) out.push(`linked to ${describeIds(item.ProviderIds)} instead of ${describeIds(want)}`);
  if (!item.LockData) out.push('not locked');
  if (state?.name !== undefined && state.name !== null && item.Name !== state.name) out.push(`renamed “${item.Name ?? ''}”`);
  if (state?.overview !== undefined && (item.Overview ?? '') !== (state.overview ?? '')) out.push('its overview changed');
  const backdrops = item.BackdropImageTags?.length ?? 0;
  if (backdrops) out.push(`${backdrops === 1 ? 'a backdrop' : `${backdrops} backdrops`} the app didn’t add`);
  const extras = Object.keys(item.ImageTags ?? {}).filter((t) => t !== 'Primary');
  if (extras.length) out.push(`${extras.join(', ')} ${extras.length === 1 ? 'image' : 'images'} the app didn’t add`);
  const primary = item.ImageTags?.Primary ?? null;
  const key = posterKey(def.poster);
  const ours = Boolean(primary && state && state.primaryTag === primary);
  if (key) {
    if (!primary) out.push('no poster');
    else if (!ours) out.push('a poster the app didn’t upload');
    else if (state!.posterUrl !== key) out.push(POSTER_SETTING);
  } else if (primary) {
    out.push(ours && state!.posterUrl ? POSTER_SETTING : 'a poster the app doesn’t supply');
  }
  return out;
}

const stateOf = (db: DB, defId: number) => db.select({ artwork: managedCollection.artwork }).from(managedCollection).where(eq(managedCollection.definitionId, defId)).get()?.artwork ?? null;

/**
 * Make a box set's provider IDs and images exactly what the app supplies: its provider IDs, its poster (or none), and
 * no other image. Records what it wrote. Doesn't touch LockData. Returns what it changed, in words.
 */
export async function secureArtwork(x: IdentityCtx, def: Def, boxsetId: string, opts: { restoreText?: boolean } = {}): Promise<string[]> {
  const { jf } = x;
  const item = await jf.getItem(boxsetId);
  if (!item) throw new Error('the box set is gone');
  const done: string[] = [];
  const want = expectedProviderIds(def);
  // The name and overview the app last wrote come back too, unless the caller has just written new ones.
  const prior = opts.restoreText === false ? null : stateOf(x.db, def.id);
  const name = prior?.name !== undefined && prior.name !== null && item.Name !== prior.name ? prior.name : undefined;
  const overview = prior?.overview !== undefined && (item.Overview ?? '') !== (prior.overview ?? '') ? prior.overview ?? '' : undefined;
  if (!sameIds(item.ProviderIds, want) || name !== undefined || overview !== undefined) {
    await jf.updateItem(boxsetId, (dto) => ({ ...dto, ProviderIds: want, ...(name !== undefined ? { Name: name } : {}), ...(overview !== undefined ? { Overview: overview } : {}) }));
    if (!sameIds(item.ProviderIds, want)) done.push(`TMDb link set to ${describeIds(want)} (was ${describeIds(item.ProviderIds)})`);
    if (name !== undefined) done.push(`name restored to “${name}”`);
    if (overview !== undefined) done.push('overview restored');
  }
  const backdrops = item.BackdropImageTags?.length ?? 0;
  for (let i = backdrops - 1; i >= 0; i--) await jf.deleteImage(boxsetId, 'Backdrop', i);
  if (backdrops) done.push(`removed ${backdrops === 1 ? 'a backdrop' : `${backdrops} backdrops`}`);
  const extras = Object.keys(item.ImageTags ?? {}).filter((t) => t !== 'Primary');
  for (const t of extras) await jf.deleteImage(boxsetId, t);
  if (extras.length) done.push(`removed ${extras.join(', ')}`);

  const state = stateOf(x.db, def.id);
  const key = posterKey(def.poster);
  const primary = item.ImageTags?.Primary ?? null;
  const ours = Boolean(primary && state && state.primaryTag === primary);
  let posterUrl: string | null = ours && state!.posterUrl === key ? key : null;
  if (key && !posterUrl) {
    try {
      const img = (await readPoster(def.poster, x))!;
      await jf.uploadPrimaryImage(boxsetId, img.bytes, img.type);
      posterUrl = key;
      done.push(!primary ? 'uploaded its poster' : ours ? 'put on its new poster' : 'replaced a poster the app didn’t upload');
    } catch (e) {
      // The app's poster can't be read now: don't keep one it can't vouch for. The next run tries again.
      if (primary && !ours) { await jf.deleteImage(boxsetId, 'Primary'); done.push(`removed a poster the app didn’t upload (its own couldn’t be read: ${(e as Error).message})`); }
      else if (primary) { posterUrl = state!.posterUrl; done.push(`kept its current poster (the new one couldn’t be read: ${(e as Error).message})`); }
    }
  } else if (!key && primary) {
    await jf.deleteImage(boxsetId, 'Primary');
    done.push(ours ? 'removed its poster' : 'removed a poster the app doesn’t supply');
  }
  const after = await jf.getItem(boxsetId);
  const artwork: ArtworkState = { providerIds: want, posterUrl, primaryTag: after?.ImageTags?.Primary ?? null, at: Date.now(), name: after?.Name ?? null, overview: after?.Overview ?? '' };
  x.db.update(managedCollection).set({ artwork }).where(eq(managedCollection.definitionId, def.id)).run();
  return done;
}

/** The app's metadata on a box set: name, sort title, overview (cleared when the collection has none), tags, locked fields, order. */
export async function writeMetadata(x: IdentityCtx, def: Def, boxsetId: string, opts: { hidden?: boolean; saved?: { sortTitle?: string | null; overview?: string | null } | null } = {}) {
  const want = desiredMeta(def as never);
  return x.jf.updateItem(boxsetId, (dto) => ({
    ...dto,
    Name: want.name,
    ForcedSortName: want.forcedSortName ?? opts.saved?.sortTitle ?? dto.ForcedSortName,
    Overview: want.overview ?? opts.saved?.overview ?? '',
    Tags: [...new Set([...(dto.Tags ?? []).filter((t) => t !== GATE_TAG), MANAGED_TAG, ...(opts.hidden ? [GATE_TAG] : [])])],
    LockedFields: [...new Set([...(dto.LockedFields ?? []), ...(LOCKED_FIELDS as never[])])],
    DisplayOrder: def.sortBy === 'title.asc' ? 'SortName' : 'PremiereDate',
  }));
}

/**
 * Replace a box set with a fresh locked one holding the same titles, the app's metadata and artwork, then delete the old
 * one. Used to adopt an existing box set (nothing Jellyfin attached to it carries over) and to repair one found unlocked
 * (locking it in place would lock every title in it). If anything fails before the old one is deleted, the new one goes.
 */
export async function rebuildBoxSet(x: IdentityCtx, def: Def, oldId: string, opts: { hidden?: boolean } = {}): Promise<string> {
  const { jf } = x;
  const members = (await jf.collectionChildren(oldId)).map((c) => c.Id).filter((id): id is string => Boolean(id));
  const saved = x.db.select({ savedMeta: managedCollection.savedMeta }).from(managedCollection).where(eq(managedCollection.definitionId, def.id)).get()?.savedMeta ?? null;
  const newId = await jf.createCollection(def.name);
  try {
    if (members.length) await jf.addToCollection(newId, members);
    await writeMetadata(x, def, newId, { hidden: opts.hidden, saved });
    x.db.update(managedCollection).set({ jfBoxsetId: newId, artwork: null, updatedAt: Date.now() }).where(eq(managedCollection.definitionId, def.id)).run();
    await secureArtwork(x, def, newId);
  } catch (e) {
    await jf.deleteItem(newId).catch(() => {});
    throw e;
  }
  await jf.deleteItem(oldId);
  return newId;
}

/** Log a repair (or a failed one) for the Dashboard and the run log. */
export function recordIntegrity(db: DB, def: Pick<Def, 'id' | 'name'>, what: string, ok: boolean, at = Date.now()): void {
  db.insert(integrityEvent).values({ at, definitionId: def.id, name: def.name, what, ok }).run();
  (ok ? log.warn : log.error)(`Box set integrity, ${def.name}: ${what}`);
}

/** Wait, then check box sets just created: Jellyfin attaches what it finds asynchronously. Repairs any difference. */
export async function recheckCreated(x: IdentityCtx, created: { def: Def; boxsetId: string }[]): Promise<void> {
  if (!created.length) return;
  await new Promise((r) => setTimeout(r, IDENTITY_TIMING.recheckMs));
  for (const { def, boxsetId } of created) {
    try {
      const item = await x.jf.getItem(boxsetId);
      if (!item) continue;
      const drift = identityDrift(item, def, stateOf(x.db, def.id)).filter((d) => d !== 'not locked');
      if (!drift.length) continue;
      const done = await secureArtwork(x, def, boxsetId);
      recordIntegrity(x.db, def, `Just after it was created: ${drift.join('; ')}. Fixed: ${done.join('; ') || 'nothing needed'}.`, true);
    } catch (e) {
      recordIntegrity(x.db, def, `Check after creating failed: ${(e as Error).message}`, false);
    }
  }
}

const POSTER_DRIFT = new Set(['no poster', 'a poster the app didn’t upload', 'a poster the app doesn’t supply']);

/**
 * Check every managed box set's provider IDs, lock and images against what the app last wrote, and repair any
 * difference straight away, dry run or not: it only puts back what the app already applied, and removes what
 * Jellyfin attached. A box set found unlocked is replaced by a fresh locked one (locking it would lock its titles).
 * The first check of a box set (nothing recorded yet) replaces its poster with the app's own without reporting it.
 */
export async function checkIntegrity(x: IdentityCtx, defs: Def[], now = Date.now()): Promise<{ checked: number; repaired: number; failed: number; baselined: number }> {
  const out = { checked: 0, repaired: 0, failed: 0, baselined: 0 };
  const rebuilt: { def: Def; boxsetId: string }[] = [];
  for (const m of x.db.select().from(managedCollection).all()) {
    if (!m.jfBoxsetId || (m.state !== 'live' && m.state !== 'hidden')) continue;
    const def = defs.find((d) => d.id === m.definitionId);
    if (!def) continue;
    out.checked++;
    try {
      const item = await x.jf.getItem(m.jfBoxsetId);
      if (!item) continue; // gone: the run forgets it and plans it again
      const drift = identityDrift(item, def, m.artwork);
      if (!drift.length) continue;
      const notable = (m.artwork ? drift : drift.filter((d) => !POSTER_DRIFT.has(d))).filter((d) => d !== POSTER_SETTING);
      let done: string[];
      if (!item.LockData) {
        const newId = await rebuildBoxSet(x, def, m.jfBoxsetId, { hidden: m.state === 'hidden' });
        rebuilt.push({ def, boxsetId: newId });
        done = [`replaced it with a fresh locked box set (${newId}) with the same titles`];
      } else {
        done = await secureArtwork(x, def, m.jfBoxsetId);
      }
      if (!notable.length) { out.baselined++; log.info(`Box set ${def.name}: first check; ${done.join('; ') || 'nothing to change'}`); continue; }
      recordIntegrity(x.db, def, `${m.artwork ? '' : 'First check: '}${notable.join('; ')}. Fixed: ${done.join('; ') || 'nothing needed'}.`, true, now);
      out.repaired++;
    } catch (e) {
      recordIntegrity(x.db, def, `Couldn’t check or repair it: ${(e as Error).message}`, false, now);
      out.failed++;
    }
  }
  await recheckCreated(x, rebuilt);
  return out;
}
