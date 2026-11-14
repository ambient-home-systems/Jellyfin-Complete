// Approve, dismiss or snooze proposals in Review. Shared by the Review page and the MCP endpoint (ADR-032), so a
// decision made by Claude does exactly what the same button does.
import { and, eq, inArray } from 'drizzle-orm';
import type { AppContext } from '../app-context.js';
import { action, decision } from '../db/schema.js';
import { decide } from '../pipeline/store.js';
import { applyNow } from '../pipeline/run.js';
import { loadDefinition } from '../domain/definitions.js';
import { undoAction } from '../pipeline/undo.js';
import { driftFingerprint } from '../pipeline/planner.js';
import { localDay, localMidnight, transitions } from '../domain/windows.js';

export type Verdict = 'approve' | 'dismiss' | 'snooze';
export type SnoozeFor = '7d' | '30d' | 'window';
/** `ids` are the changes the decision touched (an approved "create" brings its titles with it), for Undo. */
export type VerdictResult = { ok: boolean; message: string; decided: number; ids?: number[] };

export async function reviewVerdict(app: AppContext, ids: number[], verdict: Verdict, by: string, opts: { snooze?: SnoozeFor } = {}): Promise<VerdictResult> {
  if (!ids.length) return { ok: false, message: 'Tick at least one change first.', decided: 0 };
  if (verdict === 'approve') {
    // Approving "Create box set" also approves that collection's pending titles and metadata (not suggestions), so the
    // box set is created and filled in one step instead of waiting for each title.
    const creating = app.db.select().from(action).where(and(inArray(action.id, ids), eq(action.type, 'collection.create'), eq(action.status, 'proposed'))).all();
    const companions = creating.length
      ? app.db.select().from(action).where(and(inArray(action.definitionId, creating.map((a) => a.definitionId!).filter((x) => x !== null)), eq(action.status, 'proposed'), inArray(action.type, ['collection.add_items', 'collection.update_metadata']))).all()
        .filter((a) => !ids.includes(a.id) && !(a.payload as { suggested?: boolean } | null)?.suggested).map((a) => a.id)
      : [];
    const all = [...ids, ...companions];
    const decided = decide(app.db, all, 'approve', by);
    const also = companions.length ? ` (including ${companions.length} title and detail change${companions.length === 1 ? '' : 's'} for the new collection${creating.length === 1 ? '' : 's'})` : '';
    const due = app.db.select().from(action).where(inArray(action.id, all)).all().filter((a) => a.status === 'approved' && (a.applyAt === null || a.applyAt <= Date.now())).map((a) => a.id);
    if (due.length) {
      try {
        const r = await applyNow(app, due);
        return { ok: true, decided, ids: all, message: `Approved ${decided}${also}. Applied ${r.applied}${r.waiting ? `, ${r.waiting} waiting for other approvals (a collection is only created once it has titles)` : ''}${r.failed ? `, ${r.failed} failed (see History)` : ''}.` };
      } catch (e) {
        return { ok: false, decided, message: `Approved, but applying failed: ${(e as Error).message}` };
      }
    }
    return { ok: true, decided, ids: all, message: decided ? `Approved ${decided}${also}. They happen on the day the collection appears.` : 'Nothing to approve: those changes aren’t waiting any more.' };
  }
  if (verdict === 'dismiss') {
    const decided = decide(app.db, ids, 'dismiss', by);
    return { ok: true, decided, ids, message: `Dismissed ${decided}. They won’t be suggested again.` };
  }
  const choice = opts.snooze ?? app.settings().defaultSnooze;
  const s = app.settings();
  let decided = 0;
  for (const a of app.db.select().from(action).where(inArray(action.id, ids)).all()) {
    let until: number | null = Date.now() + (choice === '30d' ? 30 : 7) * 86_400_000;
    if (choice === 'window') {
      const def = a.definitionId ? loadDefinition(app.db, a.definitionId) : undefined;
      const today = localDay(Date.now(), s.timezone);
      const open = def?.window ? transitions(def.window, today, 4).find((t) => t.kind === 'opens') : undefined;
      until = open ? localMidnight(open.day, s.timezone) : Date.now() + 30 * 86_400_000;
    }
    decided += decide(app.db, [a.id], 'snooze', by, { until });
  }
  return { ok: true, decided, ids, message: `Snoozed ${decided}.` };
}

/**
 * Take back a decision just made in the Inbox (ADR-047). A dismissed, snoozed or approved-but-not-yet-applied change goes
 * straight back to waiting. A change that was applied is reversed in Jellyfin, as History's Undo does, but isn't
 * remembered as dismissed: the next run lists it in the Inbox again.
 */
export async function undoDecision(app: AppContext, ids: number[], by: string): Promise<{ ok: boolean; message: string }> {
  const rows = app.db.select().from(action).where(inArray(action.id, ids)).all();
  const now = Date.now();
  let waiting = 0;
  for (const a of rows.filter((r) => r.status === 'dismissed' || r.status === 'snoozed' || r.status === 'approved')) {
    if (a.status !== 'approved') app.db.delete(decision).where(eq(decision.fingerprint, a.fingerprint)).run();
    app.db.update(action).set({ status: 'proposed', decidedBy: null, decidedAt: null, updatedAt: now }).where(eq(action.id, a.id)).run();
    waiting++;
  }
  // Applied changes, newest first. Undoing a "create" removes the collection, which takes its titles and details with it.
  const applied = rows.filter((r) => r.status === 'applied' && !r.undoOf).sort((x, y) => y.id - x.id);
  const removed = new Set<number>();
  const order = [...applied.filter((r) => r.type === 'collection.create'), ...applied.filter((r) => r.type !== 'collection.create')];
  let reversed = 0;
  const failed: string[] = [];
  for (const a of order) {
    if (a.definitionId !== null && removed.has(a.definitionId)) { reversed++; continue; }
    try {
      await undoAction(app, a.id, by);
      reversed++;
      if (a.type === 'collection.create' && a.definitionId !== null) removed.add(a.definitionId);
      // Forget what Undo remembers, so the change is offered again instead of staying dismissed.
      app.db.delete(decision).where(eq(decision.fingerprint, a.fingerprint)).run();
      const def = a.type === 'collection.update_metadata' && a.definitionId !== null ? loadDefinition(app.db, a.definitionId) : undefined;
      if (def) app.db.delete(decision).where(eq(decision.fingerprint, driftFingerprint(def))).run();
    } catch (e) {
      failed.push((e as Error).message);
    }
  }
  // A removed collection's other changes were approved with it: forget those too, so they come back together.
  for (const a of applied.filter((r) => r.definitionId !== null && removed.has(r.definitionId))) app.db.delete(decision).where(eq(decision.fingerprint, a.fingerprint)).run();
  if (!waiting && !reversed) return { ok: false, message: failed[0] ?? 'There’s nothing left to undo.' };
  const parts = [reversed ? `${reversed} reversed in Jellyfin; the next run lists ${reversed === 1 ? 'it' : 'them'} here again` : '', waiting ? `${waiting} waiting again` : ''].filter(Boolean).join(', ');
  return { ok: !failed.length, message: `Undone: ${parts}.${failed.length ? ` ${failed.length} couldn’t be undone: ${failed[0]}` : ''}` };
}
