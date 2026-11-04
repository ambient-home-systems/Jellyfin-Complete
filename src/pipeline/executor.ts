// Executors: apply approved, due actions in a fixed order with a drift check, recording before/after
// (ARCHITECTURE §3 step 7). Only box sets this app manages are ever touched (ADR-009).
import { and, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { action, managedCollection, membership, definition } from '../db/schema.js';
import type { JellyfinClient } from '../clients/jellyfin/index.js';
import { HttpError, type FetchLike, request } from '../clients/http.js';
import { MANAGED_TAG, GATE_TAG } from './planner.js';
import { log } from '../log.js';

type ActionRow = typeof action.$inferSelect;
const ORDER = ['collection.delete', 'collection.hide', 'collection.create', 'collection.show', 'collection.update_metadata', 'collection.add_items', 'collection.remove_items'] as const;

export type ExecStats = { applied: number; failed: number; waiting: number; superseded: number };

export async function executeDue(db: DB, jf: JellyfinClient, f: FetchLike, now = Date.now(), onlyIds?: number[]): Promise<ExecStats> {
  const stats: ExecStats = { applied: 0, failed: 0, waiting: 0, superseded: 0 };
  const due = db.select().from(action)
    .where(and(eq(action.status, 'approved'), or(isNull(action.applyAt), lte(action.applyAt, now)), onlyIds?.length ? inArray(action.id, onlyIds) : undefined))
    .all()
    .filter((a) => (ORDER as readonly string[]).includes(a.type));
  const byDef = new Map<number, ActionRow[]>();
  for (const a of due) if (a.definitionId !== null) byDef.set(a.definitionId, [...(byDef.get(a.definitionId) ?? []), a]);

  for (const [defId, actions] of byDef) {
    const def = db.select().from(definition).where(eq(definition.id, defId)).get();
    if (!def) continue;
    const of = (t: string) => actions.filter((a) => a.type === t);
    const mark = (a: ActionRow, status: 'applied' | 'failed' | 'superseded', extra: Partial<ActionRow> = {}) => {
      db.update(action).set({ status, updatedAt: Date.now(), ...(status === 'applied' ? { appliedAt: Date.now() } : {}), ...extra }).where(eq(action.id, a.id)).run();
      stats[status === 'applied' ? 'applied' : status === 'failed' ? 'failed' : 'superseded']++;
    };
    const managed = () => db.select().from(managedCollection).where(eq(managedCollection.definitionId, defId)).get();
    const liveId = async (): Promise<string | null> => {
      const m = managed();
      if (!m?.jfBoxsetId || (m.state !== 'live' && m.state !== 'hidden')) return null;
      if (await jf.getItem(m.jfBoxsetId)) return m.jfBoxsetId;
      // Box set vanished outside the app: forget it so the next plan recreates it.
      db.update(managedCollection).set({ state: 'absent', jfBoxsetId: null, updatedAt: Date.now() }).where(eq(managedCollection.definitionId, defId)).run();
      return null;
    };

    try {
      // 1. Delete (window closed or below minimum): save metadata first so the next season restores it.
      for (const a of of('collection.delete')) {
        const id = await liveId();
        if (!id) { mark(a, 'superseded'); continue; }
        const before = await jf.getItem(id);
        const members = (await jf.collectionChildren(id)).map((c) => c.Id).filter(Boolean) as string[];
        const saved = { name: before?.Name ?? def.name, sortTitle: before?.ForcedSortName ?? def.sortTitle, overview: before?.Overview ?? def.overview, posterUrl: def.poster.kind === 'url' ? def.poster.url : null };
        await jf.deleteItem(id);
        db.update(managedCollection).set({ state: 'absent', jfBoxsetId: null, savedMeta: saved, updatedAt: Date.now() }).where(eq(managedCollection.definitionId, defId)).run();
        db.delete(membership).where(eq(membership.definitionId, defId)).run();
        // The member list lets Activity undo the delete.
        mark(a, 'applied', { before: { id, name: before?.Name, children: members.length, members, lockedFields: before?.LockedFields ?? [], displayOrder: before?.DisplayOrder ?? null }, after: { deleted: true, saved } });
      }

      // 1b. Hide (tag-gate, ADR-010): every user must block the gate tag first, or hiding would do nothing.
      for (const a of of('collection.hide')) {
        const id = await liveId();
        if (!id) { mark(a, 'superseded'); continue; }
        const gated = await jf.blockTagForAllUsers(GATE_TAG);
        await jf.updateItem(id, (dto) => ({ ...dto, Tags: [...new Set([...(dto.Tags ?? []), MANAGED_TAG, GATE_TAG])] }));
        db.update(managedCollection).set({ state: 'hidden', updatedAt: Date.now() }).where(eq(managedCollection.definitionId, defId)).run();
        mark(a, 'applied', { before: { id, hidden: false }, after: { id, hidden: true, policiesUpdated: gated } });
      }

      // 2. Create, only together with at least min_items approved adds (never an empty box set).
      const adds = of('collection.add_items');
      for (const a of of('collection.create')) {
        if (await liveId()) { mark(a, 'superseded'); continue; }
        if (adds.length < def.minItems) { stats.waiting++; continue; }
        const id = await jf.createCollection(def.name);
        const values = { jfBoxsetId: id, origin: 'created' as const, state: 'live' as const, updatedAt: Date.now() };
        db.insert(managedCollection).values({ definitionId: defId, ...values }).onConflictDoUpdate({ target: managedCollection.definitionId, set: values }).run();
        mark(a, 'applied', { before: null, after: { id, name: def.name } });
      }

      // 2b. Show a hidden box set again: drop the gate tag.
      for (const a of of('collection.show')) {
        const id = await liveId();
        if (!id) { mark(a, 'superseded'); continue; }
        await jf.updateItem(id, (dto) => ({ ...dto, Tags: (dto.Tags ?? []).filter((t) => t !== GATE_TAG) }));
        db.update(managedCollection).set({ state: 'live', updatedAt: Date.now() }).where(eq(managedCollection.definitionId, defId)).run();
        mark(a, 'applied', { before: { id, hidden: true }, after: { id, hidden: false } });
      }

      // 3. Metadata: full-DTO update (LockData echoed by the client), managed tag, locked fields, poster.
      for (const a of of('collection.update_metadata')) {
        const id = await liveId();
        if (!id) { stats.waiting++; continue; }
        const p = (a.payload ?? {}) as { name?: string; forcedSortName?: string | null; overview?: string | null; posterUrl?: string | null; lockedFields?: string[]; displayOrder?: string; uploadPoster?: boolean };
        const saved = managed()?.savedMeta;
        const { before, after } = await jf.updateItem(id, (dto) => ({
          ...dto,
          Name: p.name ?? dto.Name,
          ForcedSortName: p.forcedSortName ?? saved?.sortTitle ?? dto.ForcedSortName,
          Overview: p.overview ?? saved?.overview ?? dto.Overview,
          Tags: [...new Set([...(dto.Tags ?? []), MANAGED_TAG])],
          LockedFields: [...new Set([...(dto.LockedFields ?? []), ...((p.lockedFields ?? []) as never[])])],
          DisplayOrder: p.displayOrder ?? dto.DisplayOrder,
        }));
        let poster: string | null = null;
        const posterUrl = p.posterUrl ?? saved?.posterUrl ?? null;
        if (p.uploadPoster && posterUrl) {
          try {
            const res = await request(f, posterUrl, { retries: 1 });
            if (!res.ok) throw new HttpError(res.status, posterUrl, '');
            await jf.uploadPrimaryImage(id, new Uint8Array(await res.arrayBuffer()), res.headers.get('content-type')?.startsWith('image/') ? res.headers.get('content-type')! : 'image/jpeg');
            poster = posterUrl;
          } catch (e) {
            log.warn(`Poster upload for ${def.name} failed: ${(e as Error).message}`);
          }
        }
        mark(a, 'applied', {
          before: { Name: before.Name, ForcedSortName: before.ForcedSortName, Overview: before.Overview, Tags: before.Tags, LockedFields: before.LockedFields },
          after: { Name: after.Name, ForcedSortName: after.ForcedSortName, SortName: after.SortName, Overview: after.Overview, Tags: after.Tags, LockedFields: after.LockedFields, poster },
        });
      }

      // 4. Add items (batched); 5. remove items. Drift check against current children.
      const id = await liveId();
      if (!id) {
        stats.waiting += adds.length + of('collection.remove_items').length;
        continue;
      }
      const children = new Set((await jf.collectionChildren(id)).map((c) => c.Id).filter(Boolean) as string[]);
      const toAdd = adds.filter((a) => a.item?.jfId && !children.has(a.item.jfId));
      for (const a of adds) if (a.item?.jfId && children.has(a.item.jfId)) mark(a, 'superseded');
      if (toAdd.length) {
        await jf.addToCollection(id, toAdd.map((a) => a.item!.jfId!));
        for (const a of toAdd) {
          db.insert(membership).values({ definitionId: defId, jfId: a.item!.jfId!, provenance: a.item!.provenance ?? { sources: [], match: 'unknown' }, since: Date.now(), actionId: a.id })
            .onConflictDoNothing().run();
          mark(a, 'applied', { before: { member: false }, after: { member: true, collection: id } });
        }
      }
      const removes = of('collection.remove_items');
      const toRemove = removes.filter((a) => a.item?.jfId && children.has(a.item.jfId));
      for (const a of removes) if (!a.item?.jfId || !children.has(a.item.jfId)) mark(a, 'superseded');
      if (toRemove.length) {
        await jf.removeFromCollection(id, toRemove.map((a) => a.item!.jfId!));
        for (const a of toRemove) {
          db.delete(membership).where(and(eq(membership.definitionId, defId), eq(membership.jfId, a.item!.jfId!))).run();
          mark(a, 'applied', { before: { member: true, collection: id }, after: { member: false } });
        }
      }
    } catch (e) {
      const message = (e as Error).message;
      log.error(`Applying actions for ${def.name} failed: ${message}`);
      for (const a of actions) {
        const current = db.select({ status: action.status }).from(action).where(eq(action.id, a.id)).get();
        if (current?.status === 'approved') {
          db.update(action).set({ status: 'failed', error: message, updatedAt: Date.now() }).where(eq(action.id, a.id)).run();
          stats.failed++;
        }
      }
    }
  }
  return stats;
}
