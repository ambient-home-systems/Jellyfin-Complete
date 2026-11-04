// Ownership and adoption (ADR-009): list existing box sets that match a definition by name, flag the ones
// Jellyfin-Auto-Collections manages, and let the person adopt or delete each. Nothing happens automatically.
import { eq } from 'drizzle-orm';
import type { AppContext } from '../app-context.js';
import { action, managedCollection, definition } from '../db/schema.js';
import { PRESETS } from '../presets/index.js';
import { MANAGED_TAG } from './planner.js';

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
  const boxsets = await jf.allItems({ IncludeItemTypes: 'BoxSet', Fields: 'Tags,ChildCount' });
  const out: AdoptionCandidate[] = [];
  for (const b of boxsets) {
    if (!b.Id || managed.has(b.Id)) continue;
    const name = b.Name ?? '';
    const tags = b.Tags ?? [];
    const jac = tags.includes(JAC_TAG);
    const exact = defs.find((d) => d.name === name);
    const old = oldNames.get(name);
    const orphan = jac && /^\{.*\}$/.test(name);
    if (!exact && old === undefined && !orphan) continue;
    const def = exact ?? defs.find((d) => d.id === old) ?? null;
    let suggestion: AdoptionCandidate['suggestion'] = 'leave';
    let why = '';
    if (orphan) { suggestion = 'delete'; why = 'Left over from an older Jellyfin-Auto-Collections config; nothing updates it'; }
    else if (exact) { suggestion = 'adopt'; why = jac ? 'Same name as this preset; remove it from JAC’s config first (ADR-009)' : 'Same name as this preset'; }
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
  app.db.insert(action).values({
    type: 'collection.update_metadata', fingerprint: `adopt:${boxsetId}`, definitionId, mode: 'review', status: 'applied', reason: 'Adopted existing box set',
    before: { Tags: before.Tags }, after: { Tags: after.Tags, adopted: true }, decidedBy: by, decidedAt: now, appliedAt: now, createdAt: now, updatedAt: now,
  }).run();
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
