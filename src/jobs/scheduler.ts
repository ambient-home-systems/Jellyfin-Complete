// In-process scheduler (ADR-003): croner with the install's timezone; crons from the job_schedule table.
// At startup the window check runs if it hasn't run since the last local midnight (catch-up).
import { Cron } from 'croner';
import { eq, lt } from 'drizzle-orm';
import type { AppContext } from '../app-context.js';
import { jobSchedule, tmdbCache, run } from '../db/schema.js';
import { runPipeline, isRunning, AlreadyRunning } from '../pipeline/run.js';
import { localDay, localMidnight } from '../domain/windows.js';
import { log } from '../log.js';
import type { JobName } from './schedules.js';

let crons: Cron[] = [];
export let lastHeartbeat = Date.now();

export async function runJob(app: AppContext, job: JobName, trigger: 'schedule' | 'startup' | 'manual'): Promise<void> {
  app.db.update(jobSchedule).set({ lastRunAt: Date.now() }).where(eq(jobSchedule.job, job)).run();
  if (job === 'cache-cleanup') {
    const cutoff = Date.now() - 400 * 86_400_000;
    app.db.delete(tmdbCache).where(lt(tmdbCache.fetchedAt, cutoff)).run();
    app.db.delete(run).where(lt(run.startedAt, Date.now() - 180 * 86_400_000)).run();
    return;
  }
  try {
    await runPipeline(app, { job, trigger, index: job === 'nightly-refresh' || trigger === 'manual' });
  } catch (e) {
    if (e instanceof AlreadyRunning) log.warn(`${job} skipped: another run is in progress`);
    else throw e;
  }
}

export function startScheduler(app: AppContext): void {
  stopScheduler();
  const tz = app.settings().timezone;
  for (const s of app.db.select().from(jobSchedule).all()) {
    if (!s.enabled) continue;
    crons.push(new Cron(s.cron, { timezone: tz, protect: true, name: s.job }, () => {
      runJob(app, s.job as JobName, 'schedule').catch((e) => log.error(`${s.job} failed: ${(e as Error).message}`));
    }));
  }
  crons.push(new Cron('* * * * *', { timezone: tz }, () => { lastHeartbeat = Date.now(); }));
  lastHeartbeat = Date.now();
  // Catch-up: a container that was down at midnight flips windows as soon as it starts.
  const wc = app.db.select().from(jobSchedule).where(eq(jobSchedule.job, 'window-check')).get();
  const midnight = localMidnight(localDay(Date.now(), tz), tz);
  if (app.settings().firstRunDone && (!wc?.lastRunAt || wc.lastRunAt < midnight) && !isRunning()) {
    setTimeout(() => runJob(app, 'window-check', 'startup').catch((e) => log.error(`startup window check failed: ${(e as Error).message}`)), 2_000);
  }
}

export function stopScheduler(): void {
  for (const c of crons) c.stop();
  crons = [];
}

export function nextRuns(app: AppContext): { job: string; next: Date | null }[] {
  const tz = app.settings().timezone;
  return app.db.select().from(jobSchedule).all().map((s) => ({ job: s.job, next: s.enabled ? new Cron(s.cron, { timezone: tz, paused: true }).nextRun() : null }));
}
