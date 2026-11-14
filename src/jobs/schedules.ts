// Default job schedules (ADR-021). Crons live in the database and are editable in Settings.
import type { DB } from '../db/index.js';
import { jobSchedule } from '../db/schema.js';

export const JOBS = {
  'window-check': { cron: '0 0 * * *', label: 'Midnight date check', detail: 'Collections appear and go away on their dates; also runs at startup' },
  'nightly-refresh': { cron: '30 2 * * *', label: 'Nightly refresh', detail: 'Reads your library and every list, and plans what to change' },
  'cache-cleanup': { cron: '10 3 * * 0', label: 'Clean-up', detail: 'Clears out saved TMDb and list results that have expired' },
} as const;
export type JobName = keyof typeof JOBS;

export function seedSchedules(db: DB): void {
  for (const [job, def] of Object.entries(JOBS)) {
    db.insert(jobSchedule).values({ job, cron: def.cron, enabled: true }).onConflictDoNothing().run();
  }
}
