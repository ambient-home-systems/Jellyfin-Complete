// Persist a routed plan as actions, reconciling with what's already queued (ADR-006).
// Same fingerprint → same action row (your approvals survive re-planning); gone from the plan → superseded.
import { and, eq, inArray } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { action, decision } from '../db/schema.js';
import type { RoutedAction } from './router.js';

export function loadDecisions(db: DB): Map<string, { kind: 'dismiss' | 'snooze'; until: number | null }> {
  return new Map(db.select().from(decision).all().map((d) => [d.fingerprint, { kind: d.kind, until: d.until }]));
}

/** Actions queued by hand (e.g. "Send to Review" on the Missing page) aren't the planner's to supersede. */
const isManual = (a: { payload: unknown }) => Boolean((a.payload as { manual?: boolean } | null)?.manual);

export function persistPlan(db: DB, runId: number | null, routed: RoutedAction[], now = Date.now()): { inserted: number; updated: number; superseded: number } {
  const stats = { inserted: 0, updated: 0, superseded: 0 };
  db.transaction((tx) => {
    const open = tx.select().from(action).where(inArray(action.status, ['proposed', 'approved'])).all();
    const byFp = new Map(open.map((a) => [a.fingerprint, a]));
    const seen = new Set<string>();
    for (const r of routed) {
      seen.add(r.fingerprint);
      const existing = byFp.get(r.fingerprint);
      if (existing && isManual(existing)) continue; // you queued it yourself (Missing page); the plan doesn't own it
      const fields = { definitionId: r.definitionId, item: r.item ?? null, payload: { ...(r.payload ?? {}), suggested: Boolean(r.suggested) }, reason: r.reason, applyAt: r.applyAt, updatedAt: now };
      if (existing) {
        // Keep the human's decision. An auto action can become review (e.g. dry run turned on): un-approve it then.
        const status = existing.status === 'approved' && existing.decidedBy === 'auto' && r.mode === 'review' ? 'proposed' : existing.status;
        tx.update(action).set({ ...fields, mode: r.mode, status, decidedBy: status === 'proposed' ? null : existing.decidedBy }).where(eq(action.id, existing.id)).run();
        stats.updated++;
      } else {
        tx.insert(action).values({
          runId, type: r.type, fingerprint: r.fingerprint, mode: r.mode, status: r.mode === 'auto' ? 'approved' : 'proposed',
          decidedBy: r.mode === 'auto' ? 'auto' : null, decidedAt: r.mode === 'auto' ? now : null, createdAt: now, ...fields,
        }).run();
        stats.inserted++;
      }
    }
    for (const a of open) {
      if (seen.has(a.fingerprint) || isManual(a)) continue;
      tx.update(action).set({ status: 'superseded', updatedAt: now }).where(eq(action.id, a.id)).run();
      stats.superseded++;
    }
  });
  return stats;
}

/** Review decisions (UI). Dismissals and snoozes are remembered by fingerprint so they don't come back. */
export function decide(db: DB, ids: number[], verdict: 'approve' | 'dismiss' | 'snooze', by: string, opts: { until?: number | null } = {}, now = Date.now()): number {
  if (!ids.length) return 0;
  const rows = db.select().from(action).where(and(inArray(action.id, ids), inArray(action.status, ['proposed', 'approved']))).all();
  db.transaction((tx) => {
    for (const a of rows) {
      if (verdict === 'approve') {
        tx.update(action).set({ status: 'approved', decidedBy: by, decidedAt: now, updatedAt: now }).where(eq(action.id, a.id)).run();
        continue;
      }
      const kind = verdict === 'dismiss' ? 'dismiss' : 'snooze';
      const until = kind === 'snooze' ? (opts.until ?? null) : null;
      tx.insert(decision).values({ fingerprint: a.fingerprint, kind, until, decidedBy: by, createdAt: now })
        .onConflictDoUpdate({ target: decision.fingerprint, set: { kind, until, decidedBy: by, createdAt: now } }).run();
      tx.update(action).set({ status: kind === 'dismiss' ? 'dismissed' : 'snoozed', decidedBy: by, decidedAt: now, updatedAt: now }).where(eq(action.id, a.id)).run();
    }
  });
  return rows.length;
}

/** Undo a dismissal or snooze: forget the decision; the next run proposes the action again. */
export function forgetDecision(db: DB, fingerprintValue: string): void {
  db.delete(decision).where(eq(decision.fingerprint, fingerprintValue)).run();
  db.update(action).set({ status: 'superseded', updatedAt: Date.now() })
    .where(and(eq(action.fingerprint, fingerprintValue), inArray(action.status, ['dismissed', 'snoozed']))).run();
}
