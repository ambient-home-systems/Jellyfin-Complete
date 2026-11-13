// One pipeline run: index → resolve → match → plan → route → persist → apply (ARCHITECTURE §3).
// One run at a time; progress is kept in memory for the UI and the run log is stored with the run.
import { and, eq, inArray } from 'drizzle-orm';
import type { AppContext } from '../app-context.js';
import { action, run, libraryItem, library, managedCollection, membership, definitionMode, definitionArr, type ActionType } from '../db/schema.js';
import { indexLibrary } from '../library/indexer.js';
import { needsSeeding, rememberFirstAdded } from '../library/first-added.js';
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
import { refreshWatchProviders, type ProviderKind } from '../sources/watch-providers.js';
import { overlayCount, syncOverlays } from '../overlays/sync.js';
import { checkIntegrity, identityCtx } from './boxset-identity.js';
import { checkLibraryHealth } from '../library/health.js';
import { postersDir } from '../domain/posters.js';
import { adoptionCandidates } from './adoption.js';
import { versionSupport } from '../clients/jellyfin/compat.js';
import { missingTitles } from '../domain/missing.js';
import { getCached } from '../cache.js';

export type RunOptions = {
  job: string; trigger: 'schedule' | 'startup' | 'manual'; index: boolean; forceSources?: boolean; now?: number;
  /** Change poster overlays even while dry run is on (Settings → Poster overlays → Apply now): the approval. */
  applyOverlays?: boolean;
};
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
      // When each title first arrived, so a replaced file doesn't count as newly added (ADR-038).
      let radarrAdded: Map<string, number> | undefined;
      const radarr = app.radarr();
      if (radarr && needsSeeding(app.db)) radarrAdded = await radarr.addedDates().catch((e: Error) => { log.warn(`Radarr's added dates unavailable: ${e.message}`); return undefined; });
      rememberFirstAdded(app.db, now, radarrAdded);
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

    // Streaming collections (ADR-036): ask TMDb which services carry the titles you own, a few hundred a run, weekly.
    const providerKinds = new Set<ProviderKind>(defs.filter((d) => d.enabled).flatMap((d) => d.sources.filter((s) => s.type === 'tmdb_watch_provider').map((s): ProviderKind => (s.config.kind === 'show' ? 'tv' : 'movie'))));
    if (providerKinds.size) {
      step('Checking which streaming services carry your titles');
      const p = await refreshWatchProviders(app.db, app.tmdb(), { region: settings.streaming.region, kinds: providerKinds, now });
      Object.assign(stats, { streamingLookups: p.lookedUp, streamingWaiting: p.waiting });
      if (p.problem) log.warn(p.problem);
      if (p.waiting) log.info(`${p.waiting} titles still to check for streaming services; the next runs will get to them`);
    }

    const ctx: SourceContext = { db: app.db, fetch: app.fetch, tmdb: app.tmdb(), plex: app.plex(), mdblistKey: app.secrets.get('mdblist.apiKey'), imdbRoute: settings.imdbRoute, now: () => now,
      imdbSnapshot: settings.snapshotUrl ? { url: settings.snapshotUrl, token: app.secrets.get('imdb.snapshotToken') } : undefined, streamingRegion: settings.streaming.region };
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

    // Box set integrity (ADR-040): provider IDs, lock and images are the app's own; differences are repaired now.
    step('Checking managed box sets’ artwork and TMDb links');
    try {
      const ig = await checkIntegrity(identityCtx(app), defs, now);
      Object.assign(stats, { boxSetsChecked: ig.checked, boxSetsRepaired: ig.repaired, boxSetRepairsFailed: ig.failed });
    } catch (e) {
      log.error(`Box set integrity check failed: ${(e as Error).message}`);
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

    // The box set's titles as Jellyfin has them now (adopted sets, or edits made in Jellyfin), so counts stay true.
    for (const [defId, l] of live) {
      const known = new Set(app.db.select({ jfId: membership.jfId }).from(membership).where(eq(membership.definitionId, defId)).all().map((r) => r.jfId));
      for (const jfId of l.children) if (!known.has(jfId)) app.db.insert(membership).values({ definitionId: defId, jfId, provenance: { sources: [], match: 'in the box set' }, since: Date.now(), actionId: null }).onConflictDoNothing().run();
      for (const jfId of known) if (!l.children.has(jfId)) app.db.delete(membership).where(and(eq(membership.definitionId, defId), eq(membership.jfId, jfId))).run();
    }

    // Existing box sets that match a collection without one: hold its create until it's adopted (or deleted).
    let adoptable = new Set<number>();
    try {
      adoptable = new Set((await adoptionCandidates(app)).filter((c) => c.suggestion === 'adopt' && c.definitionId !== null && !live.has(c.definitionId)).map((c) => c.definitionId!));
      stats.waitingForAdoption = adoptable.size;
    } catch (e) {
      log.warn(`Couldn’t check for existing box sets: ${(e as Error).message}`);
    }

    step('Planning');
    const { actions, plans } = plan({ now, tz: settings.timezone, leadDays: settings.leadDays, definitions: defs, index, movieLibraryIds, showLibraryIds, resolved, live, saved, found, adoptable });
    savePlanSummary(app.db, {
      at: now,
      defs: Object.fromEntries(plans.map((p) => [String(p.definitionId), { members: p.members.size, blocked: p.blocked, open: p.open, opensAt: p.opensAt, waitingForAdoption: p.waitingForAdoption, sources: p.sourceStatus }])),
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
    const exec: ExecStats = await executeDue(app.db, jf, app.fetch, now, undefined, postersDir(app.config.configDir));
    const arrExec = await executeArrDue(app, now);
    Object.assign(stats, { applied: exec.applied + arrExec.applied, failed: exec.failed + arrExec.failed.length, waiting: exec.waiting, arrSkipped: arrExec.skipped.length });

    // Poster overlays (ADR-039): changed by runs while dry run is off, or when asked to (Apply now). Never fails the run.
    if (settings.overlays.status || settings.overlays.imdbTop250 || overlayCount(app)) {
      const apply = !settings.dryRun || Boolean(opts.applyOverlays);
      step(apply ? 'Updating poster overlays' : 'Checking poster overlays');
      try {
        const o = await syncOverlays(app, { now, apply, ctx, step });
        Object.assign(stats, { overlaysAdded: o.added, overlaysUpdated: o.updated + o.replaced, overlaysRemoved: o.removed, overlaysFailed: o.failed, overlaysWaiting: o.waiting, postersWithOverlays: o.withOverlays });
        if (!apply && o.toChange) log.info(`Poster overlays: ${o.toChange} posters would change. Dry run is on, so use Settings → Poster overlays → Apply now.`);
        if (o.waiting) log.info(`Poster overlays: ${o.waiting} more posters to change on the next run`);
      } catch (e) {
        log.warn(`Poster overlays not updated: ${(e as Error).message}`);
      }
    }

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

    // Library health (ADR-041): files whose length or title tags don't match the title. Read-only; never fails the run.
    if (settings.health.enabled) {
      step('Checking files against their titles');
      try {
        const h = await checkLibraryHealth(app, { now, step });
        Object.assign(stats, { healthFilesChecked: h.probed, healthOpen: h.open, healthFound: h.found, healthCompared: h.compared });
        if (h.found) log.warn(`Library health: ${h.found} new ${h.found === 1 ? 'file' : 'files'} may not be what ${h.found === 1 ? 'it says' : 'they say'} (Library health page)`);
      } catch (e) {
        log.warn(`Library health not checked: ${(e as Error).message}`);
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
  // A collection's approved changes go together: approving its "Create box set" also brings titles approved earlier
  // (say by Auto), so the box set isn't left waiting for them until the next run.
  const now = Date.now();
  const defIds = [...new Set(app.db.select({ d: action.definitionId }).from(action).where(inArray(action.id, ids)).all().map((r) => r.d).filter((d): d is number => d !== null))];
  const companions = defIds.length
    ? app.db.select({ id: action.id, applyAt: action.applyAt }).from(action).where(and(inArray(action.definitionId, defIds), eq(action.status, 'approved'))).all().filter((a) => a.applyAt === null || a.applyAt <= now).map((a) => a.id)
    : [];
  const all = [...new Set([...ids, ...companions])];
  const exec = await executeDue(app.db, jf, app.fetch, now, all, postersDir(app.config.configDir));
  const arr = await executeArrDue(app, now, ids);
  // An approval can create or delete a box set; bring the home-screen rows along straight away.
  if (app.settings().homeRows.enabled && exec.applied) {
    await syncHomeRows(app).catch((e: Error) => log.warn(`Home-screen rows not updated: ${e.message}`));
  }
  return { ...exec, applied: exec.applied + arr.applied, failed: exec.failed + arr.failed.length };
}
