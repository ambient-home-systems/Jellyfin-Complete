// Approve, dismiss or snooze proposals in Review. Shared by the Review page and the MCP endpoint (ADR-032), so a
// decision made by Claude does exactly what the same button does.
import { and, eq, inArray } from 'drizzle-orm';
import type { AppContext } from '../app-context.js';
import { action } from '../db/schema.js';
import { decide } from '../pipeline/store.js';
import { applyNow } from '../pipeline/run.js';
import { loadDefinition } from '../domain/definitions.js';
import { localDay, localMidnight, transitions } from '../domain/windows.js';

export type Verdict = 'approve' | 'dismiss' | 'snooze';
export type SnoozeFor = '7d' | '30d' | 'window';
export type VerdictResult = { ok: boolean; message: string; decided: number };

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
        return { ok: true, decided, message: `Approved ${decided}${also}. Applied ${r.applied}${r.waiting ? `, ${r.waiting} waiting for other approvals (a collection is only created once it has titles)` : ''}${r.failed ? `, ${r.failed} failed (see History)` : ''}.` };
      } catch (e) {
        return { ok: false, decided, message: `Approved, but applying failed: ${(e as Error).message}` };
      }
    }
    return { ok: true, decided, message: decided ? `Approved ${decided}${also}. They happen on the day the collection appears.` : 'Nothing to approve: those changes aren’t waiting any more.' };
  }
  if (verdict === 'dismiss') {
    const decided = decide(app.db, ids, 'dismiss', by);
    return { ok: true, decided, message: `Dismissed ${decided}. They won’t be suggested again unless you bring them back (Inbox → Dismissed).` };
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
  return { ok: true, decided, message: `Snoozed ${decided}.` };
}
