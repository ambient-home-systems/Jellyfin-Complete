// Undo an applied change (ARCHITECTURE §3 step 7). The inverse runs through Jellyfin immediately, is recorded as its
// own applied action, and the original proposal is remembered as dismissed so the next run doesn't simply redo it.
// Dismissals are per fingerprint, so a seasonal create or delete comes back next season as usual.
import { and, eq } from 'drizzle-orm';
import type { AppContext } from '../app-context.js';
import { action, decision, definition, managedCollection, membership, type ActionType, type SavedMeta } from '../db/schema.js';
import { request } from '../clients/http.js';
import { MANAGED_TAG, GATE_TAG, driftFingerprint } from './planner.js';
import { log } from '../log.js';

type ActionRow = typeof action.$inferSelect;

export const UNDOABLE: ActionType[] = ['collection.add_items', 'collection.remove_items', 'collection.create', 'collection.delete', 'collection.update_metadata', 'collection.hide', 'collection.show'];

export async function undoAction(app: AppContext, actionId: number, by: string): Promise<string> {
  const a = app.db.select().from(action).where(eq(action.id, actionId)).get();
  if (!a || a.status !== 'applied') throw new Error('Only applied changes can be undone');
  if (a.undoOf) throw new Error('An undo can’t itself be undone; make the change again instead');
  if (!UNDOABLE.includes(a.type)) throw new Error('This kind of change can’t be undone');
  if (app.db.select().from(action).where(eq(action.undoOf, a.id)).get()) throw new Error('Already undone');
  if (a.definitionId === null) throw new Error('This change isn’t tied to a collection');
  const jf = app.jellyfin();
  if (!jf) throw new Error('Jellyfin is not connected');
  const defId = a.definitionId;
  const def = app.db.select().from(definition).where(eq(definition.id, defId)).get();
  const m = app.db.select().from(managedCollection).where(eq(managedCollection.definitionId, defId)).get();
  const liveId = m?.state === 'live' || m?.state === 'hidden' ? m.jfBoxsetId : null;
  const now = Date.now();

  const record = (type: ActionType, extra: Partial<ActionRow>) => {
    app.db.insert(action).values({
      type, fingerprint: `undo:${a.id}`, definitionId: defId, item: a.item, mode: 'review', status: 'applied', reason: `Undo of #${a.id}`,
      undoOf: a.id, decidedBy: by, decidedAt: now, appliedAt: now, createdAt: now, updatedAt: now, ...extra,
    }).run();
    app.db.insert(decision).values({ fingerprint: a.fingerprint, kind: 'dismiss', until: null, decidedBy: by, createdAt: now })
      .onConflictDoUpdate({ target: decision.fingerprint, set: { kind: 'dismiss', until: null, decidedBy: by, createdAt: now } }).run();
  };

  switch (a.type) {
    case 'collection.add_items':
    case 'collection.remove_items': {
      const jfId = a.item?.jfId;
      if (!jfId || !liveId) throw new Error('The box set isn’t live any more, so there is nothing to undo');
      if (a.type === 'collection.add_items') {
        await jf.removeFromCollection(liveId, [jfId]);
        app.db.delete(membership).where(and(eq(membership.definitionId, defId), eq(membership.jfId, jfId))).run();
      } else {
        await jf.addToCollection(liveId, [jfId]);
        app.db.insert(membership).values({ definitionId: defId, jfId, provenance: a.item?.provenance ?? { sources: [], match: 'restored' }, since: now, actionId: a.id }).onConflictDoNothing().run();
      }
      record(a.type === 'collection.add_items' ? 'collection.remove_items' : 'collection.add_items', { before: a.after, after: a.before });
      return a.type === 'collection.add_items' ? `Removed ${a.item?.name} again` : `Put ${a.item?.name} back`;
    }

    case 'collection.create': {
      const created = (a.after as { id?: string } | null)?.id;
      if (!liveId || liveId !== created) throw new Error('That box set is no longer the live one, so there is nothing to undo');
      const before = await jf.getItem(liveId);
      const saved: SavedMeta = { name: before?.Name ?? def?.name ?? '', sortTitle: before?.ForcedSortName ?? def?.sortTitle ?? null, overview: before?.Overview ?? def?.overview ?? null, posterUrl: def?.poster.kind === 'url' ? def.poster.url : null };
      await jf.deleteItem(liveId);
      app.db.update(managedCollection).set({ state: 'absent', jfBoxsetId: null, savedMeta: saved, updatedAt: now }).where(eq(managedCollection.definitionId, defId)).run();
      app.db.delete(membership).where(eq(membership.definitionId, defId)).run();
      record('collection.delete', { before: { id: liveId, name: before?.Name }, after: { deleted: true, saved } });
      return `Deleted the ${before?.Name ?? def?.name ?? ''} box set again. It isn’t recreated until the next season.`;
    }

    case 'collection.delete': {
      if (liveId) throw new Error('The collection already has a live box set');
      const was = (a.before ?? {}) as { name?: string; members?: string[]; lockedFields?: string[]; displayOrder?: string | null };
      const saved = (a.after as { saved?: SavedMeta } | null)?.saved ?? m?.savedMeta ?? null;
      if (!was.members) throw new Error('This delete happened before member lists were recorded, so it can’t be undone');
      const members = was.members.filter((id) => app.db.$client.prepare('select 1 from library_item where jf_id = ?').get(id));
      const name = saved?.name ?? was.name ?? def?.name ?? 'Collection';
      const id = await jf.createCollection(name);
      if (members.length) await jf.addToCollection(id, members); // batches of 100, like the executor
      await jf.updateItem(id, (dto) => ({
        ...dto,
        Name: name,
        ForcedSortName: saved?.sortTitle ?? dto.ForcedSortName,
        Overview: saved?.overview ?? dto.Overview,
        Tags: [...new Set([...(dto.Tags ?? []), MANAGED_TAG])],
        LockedFields: [...new Set([...(dto.LockedFields ?? []), ...((was.lockedFields ?? []) as never[])])],
        DisplayOrder: was.displayOrder ?? dto.DisplayOrder,
      }));
      if (saved?.posterUrl) {
        try {
          const res = await request(app.fetch, saved.posterUrl, { retries: 1 });
          if (res.ok) await jf.uploadPrimaryImage(id, new Uint8Array(await res.arrayBuffer()), res.headers.get('content-type')?.startsWith('image/') ? res.headers.get('content-type')! : 'image/jpeg');
        } catch (e) {
          log.warn(`Poster upload while restoring ${name} failed: ${(e as Error).message}`);
        }
      }
      const values = { jfBoxsetId: id, origin: 'created' as const, state: 'live' as const, updatedAt: now };
      app.db.insert(managedCollection).values({ definitionId: defId, ...values }).onConflictDoUpdate({ target: managedCollection.definitionId, set: values }).run();
      for (const jfId of members) app.db.insert(membership).values({ definitionId: defId, jfId, provenance: { sources: [], match: 'restored' }, since: now, actionId: a.id }).onConflictDoNothing().run();
      record('collection.create', { before: null, after: { id, name, members: members.length } });
      const lost = was.members.length - members.length;
      return `Recreated ${name} with ${members.length} ${members.length === 1 ? 'title' : 'titles'}${lost ? ` (${lost} no longer in your library)` : ''}.`;
    }

    case 'collection.hide':
    case 'collection.show': {
      if (!liveId) throw new Error('The box set no longer exists, so there is nothing to undo');
      const hide = a.type === 'collection.show'; // undoing a show hides it again, and vice versa
      if (hide) await jf.blockTagForAllUsers(GATE_TAG);
      await jf.updateItem(liveId, (dto) => ({ ...dto, Tags: hide ? [...new Set([...(dto.Tags ?? []), GATE_TAG])] : (dto.Tags ?? []).filter((t) => t !== GATE_TAG) }));
      app.db.update(managedCollection).set({ state: hide ? 'hidden' : 'live', updatedAt: now }).where(eq(managedCollection.definitionId, defId)).run();
      record(hide ? 'collection.hide' : 'collection.show', { before: a.after, after: a.before });
      return hide ? `Hid ${def?.name ?? 'the box set'} again.` : `${def?.name ?? 'The box set'} is visible again until the next season’s change.`;
    }

    case 'collection.update_metadata': {
      if (!liveId) throw new Error('The box set isn’t live any more, so there is nothing to undo');
      const was = (a.before ?? {}) as { Name?: string | null; ForcedSortName?: string | null; Overview?: string | null; Tags?: string[] | null; LockedFields?: string[] | null };
      const { after } = await jf.updateItem(liveId, (dto) => ({
        ...dto,
        Name: was.Name ?? dto.Name,
        ForcedSortName: was.ForcedSortName ?? null,
        Overview: was.Overview ?? null,
        // The ownership tag stays: the box set is still this app's (ADR-009).
        Tags: [...new Set([...(was.Tags ?? []), MANAGED_TAG])],
        LockedFields: (was.LockedFields ?? []) as never[],
      }));
      record('collection.update_metadata', { before: a.after, after: { Name: after.Name, ForcedSortName: after.ForcedSortName, Overview: after.Overview, Tags: after.Tags, LockedFields: after.LockedFields } });
      // Also hold off the planner's drift fix, until the collection's own name, sort title or overview is edited.
      if (def) {
        const fp = driftFingerprint(def);
        app.db.insert(decision).values({ fingerprint: fp, kind: 'dismiss', until: null, decidedBy: by, createdAt: now })
          .onConflictDoUpdate({ target: decision.fingerprint, set: { kind: 'dismiss', until: null, decidedBy: by, createdAt: now } }).run();
      }
      return `Restored the earlier name, sort title and overview of ${after.Name ?? def?.name}. They stay until you edit this collection’s metadata. The poster stays as it is.`;
    }
  }
  throw new Error('This kind of change can’t be undone');
}
