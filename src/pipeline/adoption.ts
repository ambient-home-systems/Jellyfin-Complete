// Ownership and adoption (ADR-009): list existing box sets that match a definition by name, flag the ones
// Jellyfin-Auto-Collections manages, and let the person adopt or delete each. Nothing happens automatically.
import { and, eq, inArray } from 'drizzle-orm';
import type { AppContext } from '../app-context.js';
import { action, managedCollection, membership, definition, definitionSource } from '../db/schema.js';
import { PRESETS } from '../presets/index.js';
import { MANAGED_TAG } from './planner.js';
import { SERIES_PREFIX } from '../presets/film-series.js';

export const JAC_TAG = 'Jellyfin-Auto-Collections';
const JAC_PLUGIN_TAGS = new Set(['imdb_chart', 'imdb_list', 'letterboxd', 'mdblist', 'tmdb', 'trakt', 'jellyfin_api', 'tvdb', 'anilist', 'musicbrainz', 'imdb', 'jellyseerr']);

export type AdoptionCandidate = {
  boxsetId: string;
  name: string;
  jac: boolean;
  childCount: number | null;
  definitionId: number | null;
  definitionName: string | null;
  suggestion: 'adopt' | 'delete' | 'leave';
  why: string;
};

export async function adoptionCandidates(app: AppContext): Promise<AdoptionCandidate[]> {
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
    if (orphan) { suggestion = 'delete'; why = 'Left over from an older Jellyfin-Auto-Collections config; nothing updates it'; }
    else if (exact) { suggestion = 'adopt'; why = jac ? 'Same name as this preset; remove it from JAC’s config first (ADR-009)' : 'Same name as this preset'; }
    else if (series !== undefined) { suggestion = 'adopt'; why = 'Jellyfin’s own collection for this film series; adopting keeps it and its poster'; }
    else { suggestion = 'delete'; why = 'An older name for this collection'; }
    out.push({ boxsetId: b.Id, name, jac, childCount: b.ChildCount ?? null, definitionId: def?.id ?? null, definitionName: def?.name ?? null, suggestion, why });
  }
  return out;
}

/** Take ownership of an existing box set: drop JAC's tags, add ours, and track it. Members then sync through Review. */
export async function adopt(app: AppContext, definitionId: number, boxsetId: string, by: string): Promise<void> {
  const jf = app.jellyfin();
  if (!jf) throw new Error('Jellyfin is not connected');
  const { before, after } = await jf.updateItem(boxsetId, (dto) => ({
    ...dto,
    Tags: [...new Set((dto.Tags ?? []).filter((t) => t !== JAC_TAG && !JAC_PLUGIN_TAGS.has(t) && !/^["{\[]/.test(t)).concat(MANAGED_TAG))],
  }));
  const now = Date.now();
  const values = { jfBoxsetId: boxsetId, origin: 'adopted' as const, state: 'live' as const, updatedAt: now };
  app.db.insert(managedCollection).values({ definitionId, ...values }).onConflictDoUpdate({ target: managedCollection.definitionId, set: values }).run();
  // Its titles as they are now, so counts are right straight away.
  const children = (await jf.collectionChildren(boxsetId)).map((c) => c.Id).filter((x): x is string => Boolean(x));
  app.db.delete(membership).where(eq(membership.definitionId, definitionId)).run();
  for (const jfId of children) app.db.insert(membership).values({ definitionId, jfId, provenance: { sources: [], match: 'in the box set' }, since: now, actionId: null }).onConflictDoNothing().run();
  // Proposals made while it had no box set (create one, add its titles) are out of date now; the next run proposes
  // only what the adopted box set still needs.
  app.db.update(action).set({ status: 'superseded', updatedAt: now })
    .where(and(eq(action.definitionId, definitionId), inArray(action.status, ['proposed', 'approved']), inArray(action.type, ['collection.create', 'collection.update_metadata', 'collection.add_items', 'collection.show']))).run();
  app.db.insert(action).values({
    type: 'collection.update_metadata', fingerprint: `adopt:${boxsetId}`, definitionId, mode: 'review', status: 'applied', reason: 'Adopted existing box set',
    before: { Tags: before.Tags }, after: { Tags: after.Tags, adopted: true }, decidedBy: by, decidedAt: now, appliedAt: now, createdAt: now, updatedAt: now,
  }).run();
}

/** Adopt every box set the adoption screen suggests adopting (one press for, say, a hundred film series). */
export async function adoptSuggested(app: AppContext, by: string): Promise<{ adopted: number; failed: string[] }> {
  const out = { adopted: 0, failed: [] as string[] };
  const taken = new Set<number>();
  for (const c of await adoptionCandidates(app)) {
    if (c.suggestion !== 'adopt' || c.definitionId === null || taken.has(c.definitionId)) continue;
    try {
      await adopt(app, c.definitionId, c.boxsetId, by);
      taken.add(c.definitionId); // one box set per collection
      out.adopted++;
    } catch (e) {
      out.failed.push(`${c.name}: ${(e as Error).message}`);
    }
  }
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
