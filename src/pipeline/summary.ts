// The last plan's per-collection summary (members, blocked, source health), for the Dashboard and Collections list.
import { eq } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { setting } from '../db/schema.js';

export type PlanSummary = {
  at: number;
  defs: Record<string, { members: number; blocked: boolean; open: boolean; opensAt: number | null; waitingForAdoption?: boolean; sources: { key: string; label: string; status: string; error: string | null; listed: number; matched: number }[] }>;
};

const KEY = 'lastPlan';

export function savePlanSummary(db: DB, s: PlanSummary): void {
  db.insert(setting).values({ key: KEY, value: s }).onConflictDoUpdate({ target: setting.key, set: { value: s } }).run();
}

export function getPlanSummary(db: DB): PlanSummary | null {
  return (db.select().from(setting).where(eq(setting.key, KEY)).get()?.value as PlanSummary | undefined) ?? null;
}
