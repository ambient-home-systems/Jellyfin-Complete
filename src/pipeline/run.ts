// One pipeline run: index → resolve → match → plan → route → persist → apply (ARCHITECTURE §3).
// One run at a time; progress is kept in memory for the UI and the run log is stored with the run.
import { eq, inArray } from 'drizzle-orm';
import type { AppContext } from '../app-context.js';
import { run, libraryItem, library, managedCollection, definitionMode, definitionArr, type ActionType } from '../db/schema.js';
import { indexLibrary } from '../library/indexer.js';
import { loadDefinitions } from '../domain/definitions.js';
import { LibraryIndex, type LibRow } from '../domain/matching.js';
import { resolveSource, type ResolvedSource, type SourceContext } from '../sources/index.js';
import type { FindResult } from '../clients/tmdb.js';
import { plan, GATE_TAG, type LiveCollection } from './planner.js';
import { route } from './router.js';
import { persistPlan, loadDecisions } from './store.js';
import { executeDue, type ExecStats } from './executor.js';
import { addSink, log } from '../log.js';
import { savePlanSummary } from './summary.js';
import { isOpen, localDay, opensWithin } from '../domain/windows.js';
import type { Mode } from '../settings.js';
import { proposeArrAdds, executeArrDue } from './arr.js';
import { syncHomeRows } from '../homescreen/index.js';
import { syncFilmSeries } from './film-series.js';
import { versionSupport } from '../clients/jellyfin/compat.js';
import { missingTitles } from '../domain/missing.js';
import { getCached } from '../cache.js';

export type RunOptions = { job: string; trigger: 'schedule' | 'startup' | 'manual'; index: boolean; forceSources?: boolean; now?: number };
export type Progress = { runId: number; job: string; step: string; startedAt: number; finishedAt?: number; status: 'running' | 'ok' | 'failed'; error?: string };
export type RunSummary = { runId: number; status: 'ok' | 'failed'; stats: Record<string, number>; error?: string };

let current: Progress | null = null;
export const currentRun = (): Progress | null => current;
export const isRunning = (): boolean => current?.status === 'running';

export class AlreadyRunning extends Error {}

const FIND_CAP = 300;

export async function runPipeline(app: AppContext, opts: RunOptions): Promise<RunSummary> {
  if (isRunning()) throw new AlreadyRunning('A run is already in progress');
  const startedAt = Date.now();
  const now = opts.now ?? startedAt;
  const runRow = app.db.insert(run).values({ job: opts.job, trigger: opts.trigger, startedAt, status: 'running', stats: {}, log: '' }).returning({ id: run.id }).get();
  current = { runId: runRow.id, job: opts.job, step: 'Starting', startedAt, status: 'running' };
  const lines: string[] = [];
  const stopCapture = addSink((l) => lines.push(l));
  const step = (s: string) => {
    if (current) current.step = s;
    log.info(s);
  };
  const stats: Record<string, number> = {};
  try {
    const settings = app.settings();
    const jf = app.jellyfin();
    if (!jf) throw new Error('Jellyfin is not connected yet (Settings → Connections)');
    // Version check (Phase 4): never plan against a server older than the oldest supported version.
    const info = await jf.systemInfo();
    app.updateSettings({ server: { version: info.Version ?? null, seenAt: Date.now() } });
    const support = versionSupport(info.Version ?? undefined);
    if (support.level === 'unsupported') throw new Error(support.note);
    if (support.level !== 'verified') log.info(support.note);

    const haveIndex = app.db.select({ id: libraryItem.jfId }).from(libraryItem).limit(1).get();
    if (opts.index || !haveIndex) {
      step('Indexing the Jellyfin library');
      const s = await indexLibrary(app.db, jf, step);
      Object.assign(stats, { indexedMovies: s.movies, indexedSeries: s.series, indexedEpisodes: s.episodes });
    }

    // Film series (ADR-035): one collection per TMDb film series you own enough of; new series appear as films arrive.
    if (settings.filmSeries.enabled) {
      step('Finding film series');
      try {
        const fs = await syncFilmSeries(app, { step });
        Object.assign(stats, { filmSeries: fs.series, filmSeriesAdded: fs.created, filmSeriesLookups: fs.lookedUp });
        if (fs.problem) log.warn(fs.problem);
      } catch (e) {
        log.warn(`Film series not updated: ${(e as Error).message}`);
      }
    }

    const defs = loadDefinitions(app.db); // disabled ones too, so their box sets can be removed
    const ctx: SourceContext = { db: app.db, fetch: app.fetch, tmdb: app.tmdb(), plex: app.plex(), mdblistKey: app.secrets.get('mdblist.apiKey'), imdbRoute: settings.imdbRoute, now: () => now,
      imdbSnapshot: settings.snapshotUrl ? { url: settings.snapshotUrl, token: app.secrets.get('imdb.snapshotToken') } : undefined };
    const resolved = new Map<number, ResolvedSource[]>();
    const memo = new Map<string, Promise<ResolvedSource>>();
    const today = localDay(now, settings.timezone);
    const liveDefs = new Set(app.db.select().from(managedCollection).all().filter((m) => m.state === 'live').map((m) => m.definitionId));
    for (const d of defs.filter((x) => x.enabled)) {
      // Kometa's cache_builders: 1 for collections that matter now; out-of-season ones refresh weekly.
      const active = liveDefs.has(d.id) || isOpen(d.window, today) || opensWithin(d.window, today, settings.leadDays + 2) !== null;
      step(`Resolving sources for ${d.name}`);
      const results: ResolvedSource[] = [];
      for (const s of d.sources) {
        const spec = { type: s.type, config: s.config };
        const k = `${s.type}:${JSON.stringify(s.config)}`;
        if (!memo.has(k)) memo.set(k, resolveSource(ctx, spec, { force: Boolean(opts.forceSources) && active, maxAgeMs: active ? 86_400_000 : 7 * 86_400_000 }));
        results.push(await memo.get(k)!);
      }
      resolved.set(d.id, results);
    }
    const all = [...memo.values()];
    const settled = await Promise.all(all);
    stats.sourcesOk = settled.filter((r) => r.status === 'ok').length;
    stats.sourcesStale = settled.filter((r) => r.status === 'stale').length;
    stats.sourcesFailed = settled.filter((r) => r.status === 'failed').length;

    const rows = app.db.select().from(libraryItem).all() as LibRow[];
    const index = new LibraryIndex(rows);
    const libs = app.db.select().from(library).all();
    const movieLibraryIds = settings.movieLibraryIds ?? libs.filter((l) => l.collectionType === 'movies').map((l) => l.id);
    const showLibraryIds = settings.showLibraryIds ?? libs.filter((l) => l.collectionType === 'tvshows').map((l) => l.id);

    // TMDb /find only where it can help: titles in your library without an IMDb ID (ADR-018).
    const found = new Map<string, FindResult>();
    const tmdb = app.tmdb();
    const worth = index.findWorthwhile();
    if (tmdb && (worth.movies || worth.episodes)) {
      step('Resolving IMDb IDs through TMDb');
      const pending = new Set<string>();
      for (const list of resolved.values()) for (const r of list) for (const it of r.items) {
        // Only where /find can help: episodes when some lack IMDb IDs, films when some have only a TMDb ID.
        const useful = it.kind === 'episode' ? worth.episodes : it.kind === 'show' ? false : worth.movies;
        if (useful && it.imdb && !index.matchDirect(it, 'any')) pending.add(it.imdb);
      }
      for (const id of [...pending].slice(0, FIND_CAP)) {
        try { found.set(id, await tmdb.find(id)); } catch (e) { log.warn(`TMDb /find ${id} failed: ${(e as Error).message}`); break; }
      }
      stats.tmdbFind = found.size;
    }

    step('Reading managed collections from Jellyfin');
    const live = new Map<number, LiveCollection>();
    const saved = new Map<number, ReturnType<typeof getSaved>>();
    const getSaved = (row: typeof managedCollection.$inferSelect) => row.savedMeta ?? null;
    for (const m of app.db.select().from(managedCollection).all()) {
      saved.set(m.definitionId, getSaved(m));
      if ((m.state !== 'live' && m.state !== 'hidden') || !m.jfBoxsetId) continue;
      const item = await jf.getItem(m.jfBoxsetId);
      if (!item) {
        app.db.update(managedCollection).set({ state: 'absent', jfBoxsetId: null, updatedAt: Date.now() }).where(eq(managedCollection.definitionId, m.definitionId)).run();
        continue;
      }
      const children = new Set((await jf.collectionChildren(m.jfBoxsetId)).map((c) => c.Id).filter(Boolean) as string[]);
      live.set(m.definitionId, {
        jfBoxsetId: m.jfBoxsetId,
        hidden: m.state === 'hidden',
        children,
        meta: {
          name: item.Name ?? '', forcedSortName: item.ForcedSortName ?? null, overview: item.Overview ?? null, tags: item.Tags ?? [],
          lockedFields: (item.LockedFields ?? []) as string[], displayOrder: item.DisplayOrder ?? null, hasPoster: Boolean(item.ImageTags?.Primary),
        },
      });
    }

    step('Planning');
    const { actions, plans } = plan({ now, tz: settings.timezone, leadDays: settings.leadDays, definitions: defs, index, movieLibraryIds, showLibraryIds, resolved, live, saved, found });
    savePlanSummary(app.db, {
      at: now,
      defs: Object.fromEntries(plans.map((p) => [String(p.definitionId), { members: p.members.size, blocked: p.blocked, open: p.open, opensAt: p.opensAt, sources: p.sourceStatus }])),
    });
    const overrides = new Map<number, Partial<Record<ActionType, Mode>>>();
    for (const m of app.db.select().from(definitionMode).where(inArray(definitionMode.definitionId, defs.map((d) => d.id).concat(-1))).all()) {
      overrides.set(m.definitionId, { ...(overrides.get(m.definitionId) ?? {}), [m.actionType]: m.mode });
    }
    // Radarr/Sonarr (Phase 2): only for collections set to send missing titles, while their window is open or about to open.
    const arrDefs = new Set(app.db.select().from(definitionArr).all().filter((d) => d.addMissing).map((d) => d.definitionId));
    if (arrDefs.size && (app.radarr() || app.sonarr())) {
      step('Checking missing titles against Radarr and Sonarr');
      const findOf = (imdb: string): FindResult | undefined => {
        if (found.has(imdb)) return found.get(imdb);
        const hit = getCached<FindResult>(app.db, `find:${imdb}`);
        return hit.hit ? hit.value : undefined;
      };
      const wanted = defs.filter((d) => d.enabled && arrDefs.has(d.id) && (isOpen(d.window, today) || opensWithin(d.window, today, settings.leadDays) !== null))
        .map((def) => ({ def, missing: missingTitles(def, resolved.get(def.id) ?? [], index, findOf) }));
      try {
        actions.push(...(await proposeArrAdds(app, wanted, step)));
      } catch (e) {
        log.warn(`Radarr/Sonarr check failed, no adds proposed this run: ${(e as Error).message}`);
      }
    }
    const { routed, dropped } = route(actions, { now, dryRun: settings.dryRun, globalModes: settings.modes, overrides, decisions: loadDecisions(app.db) });
    // Guardrail (ADR-007): at most N automatic Radarr/Sonarr adds per run; the rest wait in Review.
    let autoAdds = 0;
    for (const r of routed) {
      if ((r.type === 'radarr.add_movie' || r.type === 'sonarr.add_series') && r.mode === 'auto' && ++autoAdds > settings.guardrails.arrCapPerRun) {
        r.mode = 'review';
        r.reason += ` (over the cap of ${settings.guardrails.arrCapPerRun} adds per run)`;
      }
    }
    const persisted = persistPlan(app.db, runRow.id, routed, now);
    Object.assign(stats, { planned: actions.length, dropped: dropped.length, newProposals: persisted.inserted, superseded: persisted.superseded });

    step('Applying approved actions');
    const exec: ExecStats = await executeDue(app.db, jf, app.fetch, now);
    const arrExec = await executeArrDue(app, now);
    Object.assign(stats, { applied: exec.applied + arrExec.applied, failed: exec.failed + arrExec.failed.length, waiting: exec.waiting, arrSkipped: arrExec.skipped.length });

    // Tag-gate upkeep (ADR-010): a user added since the last hide would otherwise see every hidden box set.
    if (app.db.select().from(managedCollection).all().some((m) => m.state === 'hidden')) {
      const exposed = await jf.usersNotBlocking(GATE_TAG);
      if (exposed.length && !settings.dryRun) {
        step(`Blocking the hidden-collections tag for ${exposed.join(', ')}`);
        await jf.blockTagForAllUsers(GATE_TAG);
      } else if (exposed.length) {
        log.warn(`Hidden box sets are visible to ${exposed.join(', ')}; dry run is on, so their policies weren't changed`);
      }
      stats.gateExposedUsers = settings.dryRun ? exposed.length : 0;
    }

    // Home-screen rows (Phase 3): show the rows of live collections, hide the rest. Never fails the run.
    if (settings.homeRows.enabled) {
      step('Updating home-screen rows');
      try {
        const h = await syncHomeRows(app, { dryRun: settings.dryRun });
        if (h.problem) log.warn(`Home-screen rows: ${h.problem}`);
        stats.homeRowsShowing = h.showing.length;
      } catch (e) {
        log.warn(`Home-screen rows not updated: ${(e as Error).message}`);
      }
    }

    step('Done');
    finish(app, runRow.id, 'ok', stats, lines);
    return { runId: runRow.id, status: 'ok', stats };
  } catch (e) {
    const message = (e as Error).message;
    log.error(`Run failed: ${message}`);
    finish(app, runRow.id, 'failed', stats, lines, message);
    return { runId: runRow.id, status: 'failed', stats, error: message };
  } finally {
    stopCapture();
  }
}

function finish(app: AppContext, runId: number, status: 'ok' | 'failed', stats: Record<string, number>, lines: string[], error?: string): void {
  const finishedAt = Date.now();
  app.db.update(run).set({ status, finishedAt, stats, log: lines.slice(-2000).join('\n') }).where(eq(run.id, runId)).run();
  if (current) Object.assign(current, { status, finishedAt, error, step: status === 'ok' ? 'Done' : 'Failed' });
}

/** Apply specific approved actions now (Review → Approve), with the same executors and drift checks. */
export async function applyNow(app: AppContext, ids: number[]): Promise<ExecStats> {
  const jf = app.jellyfin();
  if (!jf) throw new Error('Jellyfin is not connected yet');
  const exec = await executeDue(app.db, jf, app.fetch, Date.now(), ids);
  const arr = await executeArrDue(app, Date.now(), ids);
  // An approval can create or delete a box set; bring the home-screen rows along straight away.
  if (app.settings().homeRows.enabled && exec.applied) {
    await syncHomeRows(app).catch((e: Error) => log.warn(`Home-screen rows not updated: ${e.message}`));
  }
  return { ...exec, applied: exec.applied + arr.applied, failed: exec.failed + arr.failed.length };
}
