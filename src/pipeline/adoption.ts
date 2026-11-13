// Ownership and adoption (ADR-009, ADR-040): list existing box sets that match a definition by name, flag the ones
// Jellyfin-Auto-Collections manages, and let the person adopt or delete each. Nothing happens automatically. Adopting
// replaces the box set with a fresh locked one; a film series set's TMDb link is checked and shown, never trusted.
import { and, eq, inArray } from 'drizzle-orm';
import type { AppContext } from '../app-context.js';
import { action, managedCollection, membership, definition, definitionSource, libraryItem } from '../db/schema.js';
import { PRESETS } from '../presets/index.js';
import { identityCtx, rebuildBoxSet, recheckCreated } from './boxset-identity.js';
import { SERIES_OF, SERIES_PREFIX } from '../presets/film-series.js';

export const JAC_TAG = 'Jellyfin-Auto-Collections';

export type AdoptionCandidate = {
  boxsetId: string;
  name: string;
  jac: boolean;
  childCount: number | null;
  definitionId: number | null;
  definitionName: string | null;
  suggestion: 'adopt' | 'delete' | 'leave';
  why: string;
  /** The TMDb collection Jellyfin linked the box set to, if any. */
  tmdbLink: string | null;
  /** Film series only, when checked: the link is the series' own and every title's TMDb collection agrees (ADR-040). */
  verified: boolean | null;
};

const REPLACES = 'Adopting replaces it with a fresh locked box set holding the same titles, with this app’s name, overview and artwork.';

/**
 * Box sets that match a turned-on collection. With `verify`, each film series set's TMDb link is checked against the
 * series and its titles' own TMDb collections (one request per set), and the result shown.
 */
export async function adoptionCandidates(app: AppContext, opts: { verify?: boolean } = {}): Promise<AdoptionCandidate[]> {
  const jf = app.jellyfin();
  if (!jf) return [];
  // Only collections that are turned on: a box set that matches a preset you haven't enabled is left alone.
  const defs = app.db.select().from(definition).all().filter((d) => d.enabled);
  const managed = new Set(app.db.select().from(managedCollection).all().map((m) => m.jfBoxsetId).filter(Boolean));
  const oldNames = new Map<string, number>();
  for (const p of PRESETS) {
    const d = defs.find((x) => x.presetKey === p.definition.presetKey);
    if (d) for (const n of p.deleteCollectionsNamed) oldNames.set(n, d.id);
  }
  // Film series (ADR-035): Jellyfin's own series box sets carry the TMDb collection ID, and are named "<series> Collection".
  const seriesByTmdb = new Map<string, number>();
  const seriesByName = new Map<string, number>();
  const seriesDefs = defs.filter((x) => x.presetKey?.startsWith(SERIES_PREFIX));
  const seriesIds = new Set(seriesDefs.map((d) => d.id));
  for (const src of app.db.select().from(definitionSource).all()) {
    if (src.type !== 'tmdb_collection' || !seriesIds.has(src.definitionId)) continue;
    for (const id of ((src.config.ids ?? []) as unknown[])) seriesByTmdb.set(String(id), src.definitionId);
  }
  for (const d of seriesDefs) seriesByName.set(`${d.name} collection`.toLowerCase(), d.id);
  const boxsets = await jf.allItems({ IncludeItemTypes: 'BoxSet', Fields: 'Tags,ChildCount,ProviderIds' });
  const out: AdoptionCandidate[] = [];
  for (const b of boxsets) {
    if (!b.Id || managed.has(b.Id)) continue;
    const name = b.Name ?? '';
    const tags = b.Tags ?? [];
    const jac = tags.includes(JAC_TAG);
    const exact = defs.find((d) => d.name === name);
    const old = oldNames.get(name);
    const orphan = jac && /^\{.*\}$/.test(name);
    const tmdbId = b.ProviderIds?.Tmdb ?? b.ProviderIds?.tmdb ?? null;
    const series = (tmdbId ? seriesByTmdb.get(String(tmdbId)) : undefined) ?? seriesByName.get(name.toLowerCase());
    if (!exact && old === undefined && !orphan && series === undefined) continue;
    const def = exact ?? defs.find((d) => d.id === (old ?? series)) ?? null;
    let suggestion: AdoptionCandidate['suggestion'] = 'leave';
    let why = '';
    let verified: boolean | null = null;
    const seriesId = def?.presetKey?.startsWith(SERIES_PREFIX) ? def.presetKey.slice(SERIES_PREFIX.length) : null;
    if (seriesId && opts.verify) verified = await verifySeriesLink(app, b.Id, tmdbId ? String(tmdbId) : null, seriesId);
    const link = !seriesId ? '' : verified === true ? ' Its TMDb link and titles match this series.'
      : verified === false ? ` Jellyfin linked it to ${tmdbId ? `TMDb collection ${tmdbId}` : 'no TMDb collection'}, not this series (${seriesId}), or its titles disagree: its artwork and overview can’t be trusted.` : '';
    if (orphan) { suggestion = 'delete'; why = 'Left over from an older Jellyfin-Auto-Collections config; nothing updates it'; }
    else if (exact) { suggestion = 'adopt'; why = `${jac ? 'Same name as this preset; remove it from JAC’s config first (ADR-009).' : 'Same name as this preset.'}${link} ${REPLACES}`; }
    else if (series !== undefined) { suggestion = 'adopt'; why = `Jellyfin’s own collection for this film series.${link} ${REPLACES}`; }
    else { suggestion = 'delete'; why = 'An older name for this collection'; }
    out.push({ boxsetId: b.Id, name, jac, childCount: b.ChildCount ?? null, definitionId: def?.id ?? null, definitionName: def?.name ?? null, suggestion, why, tmdbLink: tmdbId ? String(tmdbId) : null, verified });
  }
  return out;
}

/** True when a series box set's TMDb link is the series' own and every title that has a TMDb collection agrees. */
async function verifySeriesLink(app: AppContext, boxsetId: string, link: string | null, seriesId: string): Promise<boolean> {
  if (link !== seriesId) return false;
  const ids = (await app.jellyfin()!.collectionChildren(boxsetId)).map((c) => c.Id).filter((x): x is string => Boolean(x));
  if (!ids.length) return false;
  const own = app.db.select({ series: libraryItem.tmdbCollection }).from(libraryItem).where(inArray(libraryItem.jfId, ids)).all();
  return own.every((r) => !r.series || (SERIES_OF[r.series] ?? r.series) === seriesId);
}

/**
 * Take over an existing box set (ADR-040). Nothing Jellyfin attached to it is trusted: it is replaced by a fresh locked
 * box set with the same titles and the app's own name, overview, provider IDs and artwork, and the old one is deleted
 * (its titles stay). Locking the old one in place would lock every title in it, and its TMDb link, poster, backdrop and
 * overview may belong to another collection. Members then sync through Review.
 */
export async function adopt(app: AppContext, definitionId: number, boxsetId: string, by: string, opts: { recheck?: boolean } = {}): Promise<string> {
  const x = identityCtx(app);
  const def = app.db.select().from(definition).where(eq(definition.id, definitionId)).get();
  if (!def) throw new Error('No such collection');
  const old = await x.jf.getItem(boxsetId);
  if (!old) throw new Error('That box set is gone');
  const now = Date.now();
  const values = { jfBoxsetId: boxsetId, origin: 'adopted' as const, state: 'live' as const, artwork: null, updatedAt: now };
  app.db.insert(managedCollection).values({ definitionId, ...values }).onConflictDoUpdate({ target: managedCollection.definitionId, set: values }).run();
  let newId: string;
  try {
    newId = await rebuildBoxSet(x, def, boxsetId);
  } catch (e) {
    app.db.delete(managedCollection).where(eq(managedCollection.definitionId, definitionId)).run();
    throw e;
  }
  // Its titles as they are now, so counts are right straight away.
  const children = (await x.jf.collectionChildren(newId)).map((c) => c.Id).filter((id): id is string => Boolean(id));
  app.db.delete(membership).where(eq(membership.definitionId, definitionId)).run();
  for (const jfId of children) app.db.insert(membership).values({ definitionId, jfId, provenance: { sources: [], match: 'in the box set' }, since: now, actionId: null }).onConflictDoNothing().run();
  // Proposals made while it had no box set (create one, add its titles) are out of date now; the next run proposes
  // only what the adopted box set still needs.
  app.db.update(action).set({ status: 'superseded', updatedAt: now })
    .where(and(eq(action.definitionId, definitionId), inArray(action.status, ['proposed', 'approved']), inArray(action.type, ['collection.create', 'collection.update_metadata', 'collection.add_items', 'collection.show']))).run();
  const images = [...Object.keys(old.ImageTags ?? {}), ...(old.BackdropImageTags?.length ? [`${old.BackdropImageTags.length} backdrop(s)`] : [])];
  app.db.insert(action).values({
    type: 'collection.update_metadata', fingerprint: `adopt:${boxsetId}`, definitionId, mode: 'review', status: 'applied', reason: 'Adopted an existing box set: replaced by a fresh locked one with the same titles',
    before: { id: boxsetId, Name: old.Name, Overview: old.Overview, Tags: old.Tags, ProviderIds: old.ProviderIds, images }, after: { id: newId, adopted: true, replaced: true, titles: children.length },
    decidedBy: by, decidedAt: now, appliedAt: now, createdAt: now, updatedAt: now,
  }).run();
  // Jellyfin attaches what it finds asynchronously: look again in a moment (adoptSuggested does this once for all).
  if (opts.recheck !== false) await recheckCreated(x, [{ def, boxsetId: newId }]);
  return newId;
}

/** Adopt every box set the adoption screen suggests adopting (one press for, say, a hundred film series). */
export async function adoptSuggested(app: AppContext, by: string): Promise<{ adopted: number; failed: string[] }> {
  const out = { adopted: 0, failed: [] as string[] };
  const taken = new Set<number>();
  const fresh: { def: typeof definition.$inferSelect; boxsetId: string }[] = [];
  for (const c of await adoptionCandidates(app, { verify: true })) {
    if (c.suggestion !== 'adopt' || c.definitionId === null || taken.has(c.definitionId)) continue;
    try {
      const id = await adopt(app, c.definitionId, c.boxsetId, by, { recheck: false });
      fresh.push({ def: app.db.select().from(definition).where(eq(definition.id, c.definitionId)).get()!, boxsetId: id });
      taken.add(c.definitionId); // one box set per collection
      out.adopted++;
    } catch (e) {
      out.failed.push(`${c.name}: ${(e as Error).message}`);
    }
  }
  if (fresh.length) await recheckCreated(identityCtx(app), fresh);
  return out;
}

/** Delete a box set this app doesn't manage, on an explicit click on the adoption screen. Its films stay. */
export async function deleteUnmanaged(app: AppContext, boxsetId: string, by: string): Promise<void> {
  const jf = app.jellyfin();
  if (!jf) throw new Error('Jellyfin is not connected');
  if (app.db.select().from(managedCollection).where(eq(managedCollection.jfBoxsetId, boxsetId)).get()) throw new Error('That box set is managed; it is deleted through its window instead');
  const before = await jf.getItem(boxsetId);
  if (!before) return;
  await jf.deleteItem(boxsetId);
  const now = Date.now();
  app.db.insert(action).values({
    type: 'collection.delete', fingerprint: `adoption-delete:${boxsetId}`, definitionId: null, mode: 'review', status: 'applied', reason: 'Deleted from the adoption screen',
    before: { id: boxsetId, name: before.Name, tags: before.Tags, children: before.ChildCount ?? null }, after: { deleted: true }, decidedBy: by, decidedAt: now, appliedAt: now, createdAt: now, updatedAt: now,
  }).run();
}
