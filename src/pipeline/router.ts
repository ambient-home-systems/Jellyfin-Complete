// Router: modes (global + per collection), dry run, remembered dismissals and snoozes (ARCHITECTURE §3 step 6, ADR-007).
import type { ActionType } from '../db/schema.js';
import type { Mode } from '../settings.js';
import type { PlannedAction } from './planner.js';

export type RoutedAction = PlannedAction & { mode: 'auto' | 'review' };

export type RouteInput = {
  now: number;
  dryRun: boolean;
  globalModes: Record<ActionType, Mode>;
  overrides: Map<number, Partial<Record<ActionType, Mode>>>;
  decisions: Map<string, { kind: 'dismiss' | 'snooze'; until: number | null }>;
};

export type RouteResult = { routed: RoutedAction[]; dropped: { action: PlannedAction; why: 'off' | 'dismissed' | 'snoozed' }[] };

/** Hiding a box set is the tag-gate form of deleting it, and showing it the form of creating it (ADR-010). */
export function modeKey(type: ActionType): ActionType {
  return type === 'collection.hide' ? 'collection.delete' : type === 'collection.show' ? 'collection.create' : type;
}

export function route(planned: PlannedAction[], input: RouteInput): RouteResult {
  const routed: RoutedAction[] = [];
  const dropped: RouteResult['dropped'] = [];
  for (const a of planned) {
    const key = modeKey(a.type);
    const mode = input.overrides.get(a.definitionId)?.[key] ?? input.globalModes[key] ?? 'review';
    if (mode === 'off') {
      dropped.push({ action: a, why: 'off' });
      continue;
    }
    const d = input.decisions.get(a.fingerprint);
    if (d?.kind === 'dismiss') {
      dropped.push({ action: a, why: 'dismissed' });
      continue;
    }
    if (d?.kind === 'snooze' && (d.until === null || d.until > input.now)) {
      dropped.push({ action: a, why: 'snoozed' });
      continue;
    }
    // Suggestions are never applied automatically; dry run forces everything to Review.
    const final: 'auto' | 'review' = a.suggested || input.dryRun ? 'review' : mode;
    routed.push({ ...a, mode: final });
  }
  return { routed, dropped };
}
