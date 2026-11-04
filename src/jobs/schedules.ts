// Default job schedules (ADR-021). Crons live in the database and are editable in Settings.
import type { DB } from '../db/index.js';
import { jobSchedule } from '../db/schema.js';

export const JOBS = {
  'window-check': { cron: '0 0 * * *', label: 'Window check', detail: 'Open and close windows; also runs at startup' },
  'nightly-refresh': { cron: '30 2 * * *', label: 'Nightly refresh', detail: 'Library index, sources, full plan' },
  'cache-cleanup': { cron: '10 3 * * 0', label: 'Cache cleanup', detail: 'Drop expired TMDb and source cache entries' },
} as const;
export type JobName = keyof typeof JOBS;

export function seedSchedules(db: DB): void {
  for (const [job, def] of Object.entries(JOBS)) {
    db.insert(jobSchedule).values({ job, cron: def.cron, enabled: true }).onConflictDoNothing().run();
  }
}
