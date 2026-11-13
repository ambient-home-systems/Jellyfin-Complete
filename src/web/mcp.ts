// MCP endpoint (ADR-032): lets Claude Code or Claude Desktop read this app and, with a "review" token, decide
// proposals in Review and start a run. Streamable HTTP, stateless: every request carries its access token and gets a
// fresh server, so nothing is kept between requests. Settings, keys and collection edits are not exposed.
import type { Context } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { AppContext } from '../app-context.js';
import { APP_VERSION } from '../config.js';
import { action, definitionArr, jobSchedule, libraryItem, managedCollection, membership, run } from '../db/schema.js';
import type { WindowDef } from '../db/schema.js';
import { loadDefinition, loadDefinitions, type LoadedDefinition } from '../domain/definitions.js';
import { LibraryIndex, type LibRow } from '../domain/matching.js';
import { FAMILY_LABEL, familyOf } from '../presets/index.js';
import { currentRun, isRunning, runPipeline } from '../pipeline/run.js';
import { log } from '../log.js';
import { activityModel, collectionsModel, dashboardModel, librariesModel, reviewModel, shellModel } from './model.js';
import { cachedPlan } from './plan-cache.js';
import { missingFor } from './missing-model.js';
import { TYPE_LABEL } from './pages/review.js';
import { reviewVerdict, type SnoozeFor } from './review-actions.js';
import { verifyToken, type ApiToken } from './api-tokens.js';
import { AttemptLimiter, clientIp } from './security.js';
import { applySettings, setCollectionEnabled, setSchedule, SettingsError, MODE_KEYS } from './settings-actions.js';
import { createCollection, updateCollection, addSource, removeSource, setSourceRole, setPin, deleteCollection, sendMissing, monitorInRadarr, saveArrDefaults } from './collection-actions.js';
import { explainCollection } from './explain.js';
import { adoptionCandidates, adopt, adoptSuggested, deleteUnmanaged } from '../pipeline/adoption.js';
import { setFilmSeries } from '../pipeline/film-series.js';
import { undoAction } from '../pipeline/undo.js';
import { arrOptions } from '../pipeline/arr.js';
import { syncHomeRows } from '../homescreen/index.js';
import { getPlanSummary } from '../pipeline/summary.js';
import { parity } from '../domain/parity.js';
import { resolveSource, sourceKey, sourceLabel } from '../sources/index.js';
import { SOURCE_INPUTS } from '../domain/source-input.js';
import { startOverlayRun } from './overlay-actions.js';
import { overlayCount } from '../overlays/sync.js';
import { dismissFinding, healthRows } from '../library/health.js';
import { CONNECTIONS } from './pages/settings.js';
import { JOBS, type JobName } from '../jobs/schedules.js';
import { nextRuns } from '../jobs/scheduler.js';
import type { Settings } from '../settings.js';

const INSTRUCTIONS = `Maverick Jellyfin Complete builds collections (box sets) in the user's Jellyfin media server: seasonal ones that appear and disappear on their dates, holiday episodes, new and recent (newly released, new episodes, recently added), film series, film universes, TV franchises, IMDb charts, streaming services (the titles the user owns that stream on Netflix and so on) and the user's own. It also flags files that may not be what they say (list_library_health).
Each run plans changes. Changes set to Review, and every change while dry run is on, wait in Review until someone approves, snoozes or dismisses them.
Approving applies the change to Jellyfin straight away (or when the collection's dates open), even while dry run is on: dry run only stops changes from applying without approval.
Before approving, show the user exactly what will change (collection, action, titles) and get their go-ahead, especially for deletions and removals. Never approve on your own initiative.
With a full-control token you can do everything the app's pages can, except connections, keys and access tokens: change settings and schedules; create, edit, delete and turn collections on or off, with their dates, filters and sources; adopt or delete existing box sets; undo changes; send missing titles to Radarr/Sonarr. Ask the user before turning dry run off, setting a mode to auto, turning a collection off, deleting anything, undoing a change, or applying or removing poster overlays: those change Jellyfin without a further approval.
Times are local to the app's timezone, given by get_status.`;

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
const ok = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });
const fail = (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true });

function windowText(w: WindowDef | null): string {
  if (!w) return 'all year';
  if (w.type === 'range') return `${w.from} to ${w.to}`;
  if (w.type === 'easter') return `Easter, ${w.before} days before to ${w.after} after`;
  return `relative to a weekday in month ${w.month}`;
}

/** The MCP server for one request, with the tools this token may use. */
export function buildServer(app: AppContext, token: ApiToken, opts: { restartScheduler?: () => void } = {}): McpServer {
  const server = new McpServer({ name: 'maverick-jellyfin-complete', version: APP_VERSION }, { instructions: INSTRUCTIONS });
  const tz = () => app.settings().timezone;
  const at = (ms: number | null | undefined) => (ms ? new Intl.DateTimeFormat('sv-SE', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(ms) : null);
  const day = (ms: number | null | undefined) => (ms ? new Intl.DateTimeFormat('sv-SE', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms) : null);
  const kindOf = (d: LoadedDefinition) => FAMILY_LABEL[familyOf(d.presetKey)];
  const by = `Claude (${token.name})`;
  const read = { readOnlyHint: true, openWorldHint: false } as const;

  server.registerTool('get_status', {
    title: 'Status',
    description: 'Overview: dry run on or off, the last and current run, how many proposals wait in Review, live collections, the next openings and closings, and any failing sources.',
    annotations: read,
  }, async () => {
    const d = dashboardModel(app);
    const defs = new Map(loadDefinitions(app.db).map((x) => [x.id, x]));
    const p = d.progress;
    return ok({
      app: { version: APP_VERSION, timezone: d.tz, dryRun: d.dryRun },
      jellyfin: { connected: d.configured, version: d.server?.version ?? null },
      lastRun: d.lastRun ? { id: d.lastRun.id, status: d.lastRun.status, trigger: d.lastRun.trigger, started: at(d.lastRun.startedAt), finished: at(d.lastRun.finishedAt) } : null,
      runInProgress: p && p.status === 'running' ? { id: p.runId, step: p.step, started: at(p.startedAt) } : null,
      waitingInReview: shellModel(app).pending,
      waitingForAdoption: d.waitingForAdoption ? `${d.waitingForAdoption} collection(s) have an existing box set to adopt first (list_existing_box_sets); nothing is created for them until then.` : 0,
      liveCollections: [...d.liveIds].map((id) => defs.get(id)?.name).filter(Boolean),
      upcoming: d.timetable.slice(0, 12).map((c) => ({ date: day(c.at), change: c.kind, collection: c.def.name, collectionId: c.def.id, notes: c.remarks })),
      sources: { ok: d.healthyCount, stale: d.stale.length, failing: d.failing.map((f) => ({ source: f.label, error: f.error })) },
      imdbProblem: d.hashError,
    });
  });

  server.registerTool('list_collections', {
    title: 'Collections',
    description: 'Every collection with its id, kind, whether it is on, status (Live, Scheduled, Below minimum, Off…), number of titles, dates, next change and proposals waiting in Review.',
    inputSchema: { only: z.enum(['all', 'on', 'live']).optional().describe('Filter: all (default), only collections that are on, or only live ones.') },
    annotations: read,
  }, async ({ only }) => {
    const rows = collectionsModel(app).filter((r) => only === 'on' ? r.def.enabled : only === 'live' ? r.status.kind === 'live' : true);
    return ok(rows.map((r) => ({
      id: r.def.id, name: r.def.name, kind: kindOf(r.def), on: r.def.enabled, status: r.status.label, titles: r.items,
      dates: windowText(r.def.window as WindowDef | null), next: r.next ? `${r.next.kind} ${day(r.next.at)}` : null, waitingInReview: r.pending,
    })));
  });

  server.registerTool('get_collection', {
    title: 'Collection details',
    description: 'One collection: its settings (dates, minimum, filters, modes, what happens when it closes), its sources with their ids, roles and health, the titles it would contain now (from the last run\'s cached lists, with title ids), its box set, and its proposals in Review. Use explain_collection to see why titles are left out.',
    inputSchema: { id: z.number().int().positive().describe('Collection id, from list_collections.'), maxTitles: z.number().int().min(1).max(1000).optional().describe('Most titles to list (default 200).') },
    annotations: read,
  }, async ({ id, maxTitles }) => {
    const def = loadDefinition(app.db, id);
    if (!def) return fail(`No collection with id ${id}.`);
    const row = collectionsModel(app).find((r) => r.def.id === id);
    const sum = getPlanSummary(app.db)?.defs[String(id)];
    const plan = cachedPlan(app, def);
    const limit = maxTitles ?? 200;
    const planned = plan ? [...plan.members.entries()].map(([jfId, prov]) => { const r = plan.index.get(jfId)!; return { id: jfId, name: plan.index.displayName(r), year: r.kind === 'episode' ? null : r.year, pinned: Boolean(prov.pinned) }; }).sort((a, b) => a.name.localeCompare(b.name)) : null;
    const box = app.db.select().from(managedCollection).where(eq(managedCollection.definitionId, id)).get();
    const boxCount = app.db.select({ n: sql<number>`count(*)` }).from(membership).where(eq(membership.definitionId, id)).get()?.n ?? 0;
    const proposals = app.db.select().from(action).where(and(eq(action.definitionId, id), inArray(action.status, ['proposed', 'approved']))).all();
    const lastRun = new Map((sum?.sources ?? []).map((x) => [x.key, x]));
    const arr = app.db.select().from(definitionArr).where(eq(definitionArr.definitionId, id)).get();
    return ok({
      id: def.id, name: def.name, kind: kindOf(def), preset: Boolean(def.presetKey), on: def.enabled, status: row?.status.label ?? null, contains: def.target,
      dates: windowText(def.window as WindowDef | null), datesEditable: !def.window || def.window.type === 'range', next: row?.next ? `${row.next.kind} ${day(row.next.at)}` : null,
      minimumTitles: def.minItems, filters: def.filters ?? {}, syncMode: def.syncMode, sortTitle: def.sortTitle, overview: def.overview,
      whenClosed: def.visibility === 'tag_gate' ? 'hide' : 'delete', homeRow: def.homeRow, sendMissingToRadarrSonarr: arr?.addMissing ?? false,
      actionModes: Object.keys(def.modes).length ? def.modes : 'as in Settings',
      sources: def.sources.map((src) => {
        const key = sourceKey({ type: src.type, config: src.config });
        const r = lastRun.get(key);
        return { sourceId: src.id, source: r?.label ?? sourceLabel({ type: src.type, config: src.config }), type: src.type, config: src.config, role: src.role === 'suggest' ? 'suggests (waits in Review)' : 'adds', status: r?.status ?? 'not fetched yet', error: r?.error ?? null, listed: r?.listed ?? null, matchedLastRun: r?.matched ?? null };
      }),
      lastRun: sum ? { plannedTitles: sum.members, blocked: sum.blocked } : 'not planned yet',
      boxSet: box ? { state: box.state, titlesInIt: boxCount } : null,
      pinned: [...def.pins], excluded: [...def.excludes],
      titles: planned ? { count: planned.length, list: planned.slice(0, limit), truncated: planned.length > limit } : 'No library index yet: run once first.',
      waitingInReview: proposals.map((a) => ({ id: a.id, change: TYPE_LABEL[a.type] ?? a.type, title: a.item?.name ?? null, status: a.status })),
    });
  });

  server.registerTool('explain_collection', {
    title: 'Why titles are in or out',
    description: 'For every title a collection\'s sources list: whether it\'s a member, and if not, why (not in your library, wrong kind, outside the chosen libraries, filtered out, excluded, or only suggested). Counts per source, plus the titles for one reason or matching a search.',
    inputSchema: {
      id: z.number().int().positive(),
      reason: z.enum(['member', 'suggested', 'excluded', 'filtered out', 'outside the chosen libraries', 'wrong kind', 'not in your library']).optional().describe('List the titles with this verdict.'),
      search: z.string().optional().describe('List titles whose name contains this text, whatever their verdict.'),
      limit: z.number().int().min(1).max(500).optional().describe('Most titles to list per source (default 50).'),
    },
    annotations: read,
  }, async ({ id, reason, search, limit }) => {
    const def = loadDefinition(app.db, id);
    if (!def) return fail(`No collection with id ${id}.`);
    const e = explainCollection(app, def);
    if (!e) return fail('No library index yet: run once first.');
    const n = limit ?? 50;
    const q = search?.trim().toLowerCase();
    return ok({
      collection: def.name, titlesNow: e.members, minimum: e.minimum,
      sources: e.sources.map((x) => {
        const pick = x.items.filter((i) => (reason ? i.verdict === reason : true) && (q ? i.title.toLowerCase().includes(q) : true));
        return { sourceId: x.sourceId, source: x.source, role: x.role, status: x.status, error: x.error, listed: x.listed, counts: x.counts, ...(reason || q ? { titles: pick.slice(0, n), truncated: pick.length > n } : {}) };
      }),
    });
  });

  server.registerTool('list_review', {
    title: 'Review queue',
    description: 'Proposals waiting in Review, newest first: id, change, collection, title and reason. Approved ones that wait for their dates are included with when they apply.',
    inputSchema: { collectionId: z.number().int().positive().optional().describe('Only this collection.'), limit: z.number().int().min(1).max(500).optional().describe('Most proposals to list (default 100).') },
    annotations: read,
  }, async ({ collectionId, limit }) => {
    const m = reviewModel(app, 'pending', collectionId);
    const rows = m.groups.flatMap((g) => [...g.byType.values()].flat().map((a) => ({
      id: a.id, change: TYPE_LABEL[a.type] ?? a.type, collection: g.def?.name ?? null, collectionId: a.definitionId,
      title: a.item?.name ? `${a.item.name}${a.item.year ? ` (${a.item.year})` : ''}` : null,
      reason: a.reason, suggestedOnly: Boolean((a.payload as { suggested?: boolean } | null)?.suggested),
      status: a.status === 'approved' ? `approved, applies ${at(a.applyAt)}` : 'waiting for a decision',
    })));
    const n = limit ?? 100;
    return ok({ total: rows.length, dryRun: app.settings().dryRun, proposals: rows.slice(0, n), truncated: rows.length > n });
  });

  server.registerTool('list_missing', {
    title: 'Missing titles',
    description: 'Titles a collection\'s sources list that are not in the library, best-ranked first, with IMDb/TMDb/TVDB ids. Without a collection id, gives counts per collection.',
    inputSchema: { collectionId: z.number().int().positive().optional(), limit: z.number().int().min(1).max(500).optional().describe('Most titles to list (default 50).') },
    annotations: read,
  }, async ({ collectionId, limit }) => {
    const rows = app.db.select().from(libraryItem).all() as LibRow[];
    if (!rows.length) return fail('No library index yet: run once first.');
    const index = new LibraryIndex(rows);
    const tabs = (d: LoadedDefinition) => (d.target === 'both' ? (['movies', 'shows'] as const) : d.target === 'shows' ? (['shows'] as const) : (['movies'] as const));
    const missingOf = (d: LoadedDefinition) => tabs(d).flatMap((t) => missingFor(app, d, t, index));
    if (collectionId === undefined) {
      return ok(loadDefinitions(app.db).filter((d) => d.enabled).map((d) => ({ id: d.id, name: d.name, missing: missingOf(d).length })).filter((x) => x.missing));
    }
    const def = loadDefinition(app.db, collectionId);
    if (!def) return fail(`No collection with id ${collectionId}.`);
    const list = missingOf(def);
    const n = limit ?? 50;
    return ok({ collection: def.name, total: list.length, titles: list.slice(0, n).map((m) => ({ key: m.keys[0], sendsTo: m.app, title: m.title, year: m.year, imdb: m.imdb ?? null, tmdb: m.tmdb ?? null, tvdb: m.tvdb ?? null, sources: m.sources.map((s) => `${s.label} #${s.rank}`) })), truncated: list.length > n });
  });

  server.registerTool('list_library_health', {
    title: 'Library health',
    description: 'Films and episodes whose file may not be what it says (Library health page): the file runs much longer or shorter than TMDb\'s runtime, or a title tag inside it names another title. Each with its library, rating and file path. The app never moves or deletes files; tell the user which to check by playing them.',
    inputSchema: { includeMarkedFine: z.boolean().optional().describe('Also list findings someone marked as fine.') },
    annotations: read,
  }, async (a) => ok({
    checking: app.settings().health.enabled,
    findings: healthRows(app).map((r) => ({ id: r.jfId, kind: r.kind, title: r.title, library: r.library, rating: r.rating, whatDoesntMatch: r.detail, file: r.path, found: at(r.firstSeen) })),
    ...(a.includeMarkedFine ? { markedFine: healthRows(app, { dismissed: true }).map((r) => ({ id: r.jfId, kind: r.kind, title: r.title, whatDoesntMatch: r.detail, markedFine: at(r.dismissedAt) })) } : { markedFineCount: healthRows(app, { dismissed: true }).length }),
  }));

  server.registerTool('list_activity', {
    title: 'Activity',
    description: 'Recent runs and the changes applied to Jellyfin (or that failed), newest first, with who decided them.',
    inputSchema: { limit: z.number().int().min(1).max(150).optional().describe('Most changes to list (default 40).') },
    annotations: read,
  }, async ({ limit }) => {
    const m = activityModel(app);
    return ok({
      runs: m.runs.slice(0, 10).map((r) => ({ id: r.id, status: r.status, trigger: r.trigger, started: at(r.startedAt), finished: at(r.finishedAt) })),
      changes: m.applied.slice(0, limit ?? 40).map((a) => ({
        id: a.id, when: at(a.appliedAt ?? a.updatedAt), change: TYPE_LABEL[a.type] ?? a.type, collection: a.definitionId ? m.defs.get(a.definitionId) ?? null : null,
        title: a.item?.name ?? null, status: a.status, decidedBy: a.decidedBy, error: a.error, undone: m.undone.has(a.id),
      })),
    });
  });

  server.registerTool('get_run', {
    title: 'Run details',
    description: 'The run in progress, or a finished run (the latest, or by id): status, step, counts and the end of its log.',
    inputSchema: { id: z.number().int().positive().optional().describe('Run id; default the latest.') },
    annotations: read,
  }, async ({ id }) => {
    const p = currentRun();
    if (!id && p?.status === 'running') return ok({ id: p.runId, status: 'running', step: p.step, started: at(p.startedAt) });
    const r = id ? app.db.select().from(run).where(eq(run.id, id)).get() : app.db.select().from(run).orderBy(desc(run.startedAt)).limit(1).get();
    if (!r) return fail(id ? `No run with id ${id}.` : 'No runs yet.');
    return ok({ id: r.id, status: r.status, job: r.job, trigger: r.trigger, started: at(r.startedAt), finished: at(r.finishedAt), counts: r.stats, logTail: r.log.split('\n').slice(-40).join('\n') });
  });

  server.registerTool('get_settings', {
    title: 'Settings',
    description: 'Every setting on the Settings page: dry run, timezone, plan-ahead days, action modes, Radarr/Sonarr guardrails and defaults, IMDb route, which libraries collections draw from, home-screen rows, film series, the streaming country, poster overlays, job schedules, and which connections are set up (never the keys themselves).',
    annotations: read,
  }, async () => {
    const s = app.settings();
    const libs = librariesModel(app);
    const libList = (type: string, chosen: string[] | null) => libs.filter((l) => l.collectionType === type).map((l) => ({ id: l.id, name: l.name, used: chosen === null || chosen.includes(l.id) }));
    const runs = nextRuns(app);
    return ok({
      dryRun: s.dryRun, timezone: s.timezone, planAheadDays: s.leadDays, defaultSnooze: s.defaultSnooze,
      actionModes: Object.fromEntries(MODE_KEYS.map((k) => [k, s.modes[k]])),
      radarrSonarr: { capPerRun: s.guardrails.arrCapPerRun, releasedOnly: s.guardrails.releasedOnly, radarrDefaults: s.arr.radarr, sonarrDefaults: s.arr.sonarr },
      imdb: { route: s.imdbRoute, snapshotUrl: s.snapshotUrl || null },
      libraries: { films: libList('movies', s.movieLibraryIds), tv: libList('tvshows', s.showLibraryIds) },
      homeRows: { enabled: s.homeRows.enabled, position: s.homeRows.orderIndex, view: s.homeRows.viewMode },
      filmSeries: s.filmSeries,
      streamingCountry: s.streaming.region,
      posterOverlays: { status: s.overlays.status, imdbTop250Ribbon: s.overlays.imdbTop250, postersWithOverlays: overlayCount(app) },
      schedules: app.db.select().from(jobSchedule).all().map((j) => ({ job: j.job, what: JOBS[j.job as JobName]?.detail ?? null, cron: j.cron, on: j.enabled, next: at(runs.find((r) => r.job === j.job)?.next?.getTime()) })),
      otherToolsSchedules: s.neighbours,
      connections: Object.fromEntries(CONNECTIONS.map((x) => [x.key, { address: x.urlField ? s.connections[x.urlField] || null : undefined, keySaved: x.secret ? app.secrets.masked(x.secret).set : undefined }])),
      whatThisTokenCanChange: token.scope === 'full' ? 'Everything except connections, keys and access tokens, which stay on the Settings page.' : 'Nothing: this token can read settings only.',
    });
  });

  server.registerTool('list_existing_box_sets', {
    title: 'Existing box sets',
    description: 'Box sets already in Jellyfin that this app doesn\'t manage but that match a collection that\'s on, by name or an older name: each with a suggestion (adopt, delete or leave) and why, and for film series whether Jellyfin\'s TMDb link checks out. Adopting replaces the box set with a fresh locked one holding the same titles, with the app\'s own artwork.',
    annotations: { ...read, openWorldHint: true },
  }, async () => {
    try {
      return ok((await adoptionCandidates(app, { verify: true })).map((b) => ({ boxSetId: b.boxsetId, name: b.name, titles: b.childCount, fromJellyfinAutoCollections: b.jac, collectionId: b.definitionId, collection: b.definitionName, suggestion: b.suggestion, why: b.why, tmdbLink: b.tmdbLink, tmdbLinkVerified: b.verified })));
    } catch (e) {
      return fail(`Couldn’t read box sets from Jellyfin: ${(e as Error).message}`);
    }
  });

  server.registerTool('compare_with_plex', {
    title: 'Compare with Plex',
    description: 'Compare a collection with the same-named collection in Plex (read-only): how many titles each has, how many are in both, and which are only in one, including Plex titles that aren\'t in your Jellyfin library.',
    inputSchema: { id: z.number().int().positive() },
    annotations: { ...read, openWorldHint: true },
  }, async ({ id }) => {
    const def = loadDefinition(app.db, id);
    if (!def) return fail(`No collection with id ${id}.`);
    const plex = app.plex();
    if (!plex) return fail('Plex isn\'t connected (Settings → Connections).');
    const plan = cachedPlan(app, def);
    if (!plan) return fail('No library index yet: run once first.');
    const s = app.settings();
    const r = await resolveSource({ db: app.db, fetch: app.fetch, tmdb: app.tmdb(), plex, mdblistKey: null, imdbRoute: s.imdbRoute }, { type: 'plex_collection', config: { name: def.name } }, { maxAgeMs: 10 * 60_000 });
    if (r.status === 'failed') return fail(`Couldn’t read Plex: ${r.error}`);
    if (!(r.meta as { found?: boolean } | null)?.found) return ok(`Plex has no collection called “${def.name}” right now.`);
    const want = def.target === 'movies' ? 'movie' : def.target === 'shows' ? 'series' : def.target === 'episodes' ? 'episode' : 'any';
    return ok(parity(r.items, new Set(plan.members.keys()), plan.index, want));
  });

  server.registerTool('get_radarr_sonarr_options', {
    title: 'Radarr and Sonarr options',
    description: 'The defaults used when titles are sent to Radarr or Sonarr, and the choices each app offers now (quality profiles, root folders, tags).',
    annotations: { ...read, openWorldHint: true },
  }, async () => {
    const out: Record<string, unknown> = {};
    for (const which of ['radarr', 'sonarr'] as const) {
      const cl = which === 'radarr' ? app.radarr() : app.sonarr();
      if (!cl) { out[which] = 'not connected'; continue; }
      try {
        const [profiles, rootFolders, tags] = await Promise.all([cl.qualityProfiles(), cl.rootFolders(), cl.tags()]);
        out[which] = { defaults: app.settings().arr[which], profiles, rootFolders, tags };
      } catch (e) {
        out[which] = `couldn’t read its options: ${(e as Error).message}`;
      }
    }
    return ok(out);
  });

  if (token.scope === 'read') return server;

  const ids = z.array(z.number().int().positive()).min(1).max(500).describe('Proposal ids, from list_review.');
  const decision = async (list: number[], verdict: 'approve' | 'dismiss' | 'snooze', snooze?: SnoozeFor) => {
    const r = await reviewVerdict(app, list, verdict, by, { snooze });
    log.info(`Claude access: ${verdict} ${list.length} proposal(s) via token “${token.name}”: ${r.message}`);
    return r.ok ? ok(r.message) : fail(r.message);
  };

  server.registerTool('approve_proposals', {
    title: 'Approve proposals',
    description: 'Approve proposals in Review. This changes Jellyfin straight away (box sets created, deleted or changed, titles added or removed, or titles sent to Radarr/Sonarr), even while dry run is on; ones whose dates haven\'t opened apply when they open. Only call this after the user has seen exactly what will change and said yes.',
    inputSchema: { ids },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ ids: list }) => decision(list, 'approve'));

  server.registerTool('dismiss_proposals', {
    title: 'Dismiss proposals',
    description: 'Dismiss proposals in Review: they are not proposed again until someone undoes it on the Review page. Nothing changes in Jellyfin.',
    inputSchema: { ids },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ ids: list }) => decision(list, 'dismiss'));

  server.registerTool('mark_library_health_fine', {
    title: 'Mark a library health finding as fine',
    description: 'After the user has checked a file from list_library_health and says it is what it claims, hide that finding. It comes back if the file changes. Nothing changes in Jellyfin.',
    inputSchema: { id: z.string(), kind: z.enum(['runtime', 'title']) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (a) => (dismissFinding(app, a.id, a.kind, `Claude (${token.name})`) ? ok('Marked as fine. It comes back if the file changes.') : fail('No such finding.')));

  server.registerTool('snooze_proposals', {
    title: 'Snooze proposals',
    description: 'Snooze proposals in Review: hide them for 7 or 30 days, or until their collection next opens. Nothing changes in Jellyfin.',
    inputSchema: { ids, for: z.enum(['7d', '30d', 'window']).optional().describe('7d, 30d, or window (until the collection next opens). Default: the app\'s setting.') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ ids: list, for: snooze }) => decision(list, 'snooze', snooze));

  server.registerTool('start_run', {
    title: 'Start a run',
    description: 'Start a run now, as the dashboard\'s Run button does: read the library and sources and plan changes. With dry run off, changes set to Auto apply on their own; everything else waits in Review. Use get_run to follow it.',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async () => {
    if (isRunning()) return ok({ started: false, message: 'A run is already in progress.', run: currentRun() });
    log.info(`Claude access: run started via token “${token.name}”`);
    runPipeline(app, { job: 'manual', trigger: 'manual', index: true }).catch((e) => log.error(`Run started by Claude failed: ${(e as Error).message}`));
    await new Promise((r) => setTimeout(r, 50)); // let it register, so the reply can name the run
    const p = currentRun();
    return ok({ started: true, run: p ? { id: p.runId, step: p.step } : null, dryRun: app.settings().dryRun });
  });

  if (token.scope !== 'full') return server;

  const mode = z.enum(['off', 'review', 'auto']);
  const changeResult = (before: Settings, changed: (keyof Settings)[]) => {
    const after = app.settings();
    return changed.map((k) => `${k}: ${JSON.stringify(before[k])} → ${JSON.stringify(after[k])}`).join('\n') || 'Nothing changed.';
  };
  const libraryIds = (wanted: 'all' | string[] | undefined, type: 'movies' | 'tvshows'): string[] | null | undefined => {
    if (wanted === undefined || wanted === 'all') return wanted === 'all' ? null : undefined;
    const libs = librariesModel(app).filter((l) => l.collectionType === type);
    return wanted.map((w) => libs.find((l) => l.id === w || l.name.toLowerCase() === w.trim().toLowerCase())?.id ?? w);
  };

  server.registerTool('update_settings', {
    title: 'Change settings',
    description: 'Change settings, as the Settings page does. Give only what should change. Connections and keys can\'t be changed here (they stay on the Settings page). Turning dry run off lets changes whose mode is auto apply on their own; setting a mode to auto does the same once dry run is off. Confirm those with the user first.',
    inputSchema: {
      dryRun: z.boolean().optional().describe('On: every change waits in Review. Off: changes whose mode is auto apply on their own.'),
      timezone: z.string().optional().describe('IANA timezone, such as America/New_York. Collections open and close at midnight here.'),
      planAheadDays: z.number().int().min(0).max(60).optional().describe('Days before a collection opens that its changes are proposed (0–60).'),
      defaultSnooze: z.enum(['window', '7d', '30d']).optional().describe('Default snooze in Review: until the collection next opens, 7 days or 30 days.'),
      actionModes: z.object({
        'collection.create': mode.optional().describe('Create and delete box sets.'),
        'collection.add_items': mode.optional(),
        'collection.remove_items': mode.optional(),
        'collection.update_metadata': mode.optional(),
        'radarr.add_movie': mode.optional(),
        'sonarr.add_series': mode.optional(),
        'radarr.monitor_collection': mode.optional(),
      }).optional().describe('Per kind of change: off, review (waits for approval) or auto (applies on its own when dry run is off).'),
      radarrSonarrCapPerRun: z.number().int().min(0).max(200).optional().describe('Most titles sent to Radarr/Sonarr per run.'),
      releasedOnly: z.boolean().optional().describe('Only send titles that are already released.'),
      imdbRoute: z.enum(['direct', 'kometa_service', 'snapshot']).optional(),
      snapshotUrl: z.string().optional().describe('For the snapshot IMDb route.'),
      filmLibraries: z.union([z.literal('all'), z.array(z.string()).min(1)]).optional().describe('Film libraries that film collections draw from: "all", or names or ids from get_settings.'),
      tvLibraries: z.union([z.literal('all'), z.array(z.string()).min(1)]).optional().describe('TV libraries that show and episode collections draw from: "all", or names or ids.'),
      homeRows: z.object({ enabled: z.boolean().optional(), position: z.number().int().min(0).max(99).optional(), view: z.enum(['Portrait', 'Landscape', 'Square', 'Small']).optional() }).optional(),
      otherToolsSchedules: z.array(z.object({ name: z.string(), time: z.string() })).optional().describe('Replaces the list of other tools\' run times shown beside this app\'s jobs, e.g. [{"name":"Kometa (Plex)","time":"05:00"}].'),
      filmSeries: z.object({ enabled: z.boolean(), minimum: z.number().int().min(2).max(20).optional() }).optional().describe('Film series: one collection for each TMDb film series with at least `minimum` (default 2) owned films. Turning it on or off also turns every film series collection on or off; the next run adds new series.'),
      streamingCountry: z.string().optional().describe('Two-letter country code (US, GB, CA…) whose streaming services the streaming collections (Netflix Movies and so on) count.'),
      posterOverlays: z.object({ status: z.boolean().optional(), imdbTop250Ribbon: z.boolean().optional() }).optional().describe('Poster overlays: Kometa\'s status badge on shows (AIRING, RETURNING, CANCELED, ENDED) and its IMDb Top 250 ribbon. Runs change posters only while dry run is off; apply_poster_overlays does it now.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async (a) => {
    const before = app.settings();
    try {
      const r = applySettings(app, {
        dryRun: a.dryRun, timezone: a.timezone, leadDays: a.planAheadDays, defaultSnooze: a.defaultSnooze,
        modes: a.actionModes, arrCapPerRun: a.radarrSonarrCapPerRun, releasedOnly: a.releasedOnly,
        imdbRoute: a.imdbRoute, snapshotUrl: a.snapshotUrl,
        movieLibraryIds: libraryIds(a.filmLibraries, 'movies'), showLibraryIds: libraryIds(a.tvLibraries, 'tvshows'),
        homeRows: a.homeRows ? { enabled: a.homeRows.enabled, orderIndex: a.homeRows.position, viewMode: a.homeRows.view } : undefined,
        neighbours: a.otherToolsSchedules, streamingRegion: a.streamingCountry,
        overlays: a.posterOverlays ? { status: a.posterOverlays.status, imdbTop250: a.posterOverlays.imdbTop250Ribbon } : undefined,
      });
      if (a.filmSeries) setFilmSeries(app, a.filmSeries.enabled, a.filmSeries.minimum);
      if (r.timezoneChanged) opts.restartScheduler?.();
      log.info(`Claude access: settings changed via token “${token.name}”: ${r.changed.join(', ') || 'nothing'}`);
      return ok(`Saved.\n${changeResult(before, a.filmSeries ? [...r.changed, 'filmSeries'] : r.changed)}`);
    } catch (e) {
      if (e instanceof SettingsError) return fail(e.message);
      throw e;
    }
  });

  server.registerTool('set_schedule', {
    title: 'Change a job\'s schedule',
    description: 'Change when a job runs (a cron expression in the app\'s timezone) or turn it on or off. Jobs: window-check (opens and closes collections at midnight), nightly-refresh (library, sources and full plan), cache-cleanup.',
    inputSchema: { job: z.enum(Object.keys(JOBS) as [JobName, ...JobName[]]), cron: z.string().optional().describe('For example "30 2 * * *" for 02:30 every day.'), on: z.boolean().optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ job, cron, on }) => {
    try {
      setSchedule(app, job, { cron, enabled: on });
      opts.restartScheduler?.();
      log.info(`Claude access: schedule for ${job} changed via token “${token.name}”`);
      const row = app.db.select().from(jobSchedule).where(eq(jobSchedule.job, job)).get()!;
      return ok(`Saved. ${job}: ${row.cron}, ${row.enabled ? 'on' : 'off'}.`);
    } catch (e) {
      if (e instanceof SettingsError) return fail(e.message);
      throw e;
    }
  });

  server.registerTool('set_collection_enabled', {
    title: 'Turn a collection on or off',
    description: 'Turn a collection on or off, as its switch on the Collections page does. Turning one off means the next run removes its box set from Jellyfin (through Review unless deleting is set to auto and dry run is off). Confirm turning collections off with the user first.',
    inputSchema: { id: z.number().int().positive().describe('Collection id, from list_collections.'), on: z.boolean() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async ({ id, on }) => {
    try {
      const msg = setCollectionEnabled(app, id, on);
      log.info(`Claude access: collection ${id} turned ${on ? 'on' : 'off'} via token “${token.name}”`);
      return ok(msg);
    } catch (e) {
      if (e instanceof SettingsError) return fail(e.message);
      throw e;
    }
  });

  const attempt = async (what: string, f: () => string | Promise<string>) => {
    try {
      const msg = await f();
      log.info(`Claude access: ${what} via token “${token.name}”`);
      return ok(msg);
    } catch (e) {
      if (e instanceof SettingsError) return fail(e.message);
      if (e instanceof Error && /not connected|Only applied changes/i.test(e.message)) return fail(e.message);
      throw e;
    }
  };
  const target = z.enum(['movies', 'shows', 'episodes']);
  const dates = z.union([z.object({ from: z.string().describe('MM/DD, e.g. 12/01'), to: z.string().describe('MM/DD, e.g. 12/31') }), z.literal('all year')]);
  const sourceType = z.enum(SOURCE_INPUTS.map((x) => x.key) as [string, ...string[]]).describe(`Source type: ${SOURCE_INPUTS.map((x) => `${x.key} (${x.placeholder})`).join('; ')}.`);
  const filters = z.object({
    yearFrom: z.number().int().optional(), yearTo: z.number().int().optional(),
    genresInclude: z.array(z.string()).optional().describe('Only titles with at least one of these genres.'),
    genresExclude: z.array(z.string()).optional().describe('No titles with any of these genres.'),
    maxRating: z.string().optional().describe('Highest content rating, e.g. PG-13 or TV-PG.'),
  });
  const modeOrDefault = z.enum(['off', 'review', 'auto', 'default']);
  const findTitle = (q: string): string | null => {
    const rows = app.db.select().from(libraryItem).all() as LibRow[];
    if (rows.some((r) => r.jfId === q)) return q;
    const hit = rows.filter((r) => r.name.toLowerCase() === q.trim().toLowerCase() && r.kind !== 'episode');
    return hit.length === 1 ? hit[0]!.jfId : null;
  };

  server.registerTool('create_collection', {
    title: 'Create a collection',
    description: 'Create one of your own collections with a first source, as Collections → New collection does. It\'s on straight away; the next run fetches its source and plans it.',
    inputSchema: { name: z.string(), contains: target, dates: dates.optional().describe('When it shows: {"from":"MM/DD","to":"MM/DD"}, or "all year" (default).'), sourceType, sourceValue: z.string().describe('The list URL, IDs or keywords, as the source type expects.') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (a) => attempt(`collection “${a.name}” created`, () => {
    const id = createCollection(app, { name: a.name, target: a.contains, dates: !a.dates || a.dates === 'all year' ? null : a.dates, sourceType: a.sourceType, sourceValue: a.sourceValue });
    return `Created “${a.name}” (id ${id}). Start a run to fetch its source and plan it.`;
  }));

  server.registerTool('update_collection', {
    title: 'Change a collection',
    description: 'Change a collection, as its editor does: name, dates, minimum titles, filters, overview, sort title, sync or append, what happens when it closes, its home-screen row, sending missing titles to Radarr/Sonarr, and per-collection modes. Give only what should change. Sources have their own tools. The next run plans with the new settings.',
    inputSchema: {
      id: z.number().int().positive(), name: z.string().optional(), on: z.boolean().optional(),
      dates: dates.optional().describe('{"from":"MM/DD","to":"MM/DD"} or "all year". Not for collections whose dates follow a rule, such as Easter.'),
      minimumTitles: z.number().int().min(1).max(1000).optional(),
      filters: filters.optional().describe('Replaces the collection\'s filters; {} clears them.'),
      overview: z.string().optional(), sortTitle: z.string().optional(),
      syncMode: z.enum(['sync', 'append']).optional().describe('sync: remove titles no source lists any more. append: only ever add.'),
      whenClosed: z.enum(['delete', 'hide']).optional().describe('delete the box set when its dates end, or hide it and keep it for next time.'),
      homeRow: z.boolean().optional(), sendMissingToRadarrSonarr: z.boolean().optional(),
      actionModes: z.object({
        'collection.create': modeOrDefault.optional(), 'collection.add_items': modeOrDefault.optional(), 'collection.remove_items': modeOrDefault.optional(),
        'collection.update_metadata': modeOrDefault.optional(), 'radarr.add_movie': modeOrDefault.optional(), 'sonarr.add_series': modeOrDefault.optional(), 'radarr.monitor_collection': modeOrDefault.optional(),
      }).optional().describe('This collection\'s own modes; "default" follows Settings.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async (a) => attempt(`collection ${a.id} changed`, () => {
    updateCollection(app, a.id, {
      name: a.name, enabled: a.on, dates: a.dates === undefined ? undefined : a.dates === 'all year' ? null : a.dates, minItems: a.minimumTitles,
      filters: a.filters, overview: a.overview, sortTitle: a.sortTitle, syncMode: a.syncMode,
      visibility: a.whenClosed === undefined ? undefined : a.whenClosed === 'hide' ? 'tag_gate' : 'delete',
      homeRow: a.homeRow, addMissing: a.sendMissingToRadarrSonarr, modes: a.actionModes,
    });
    return 'Saved. The next run plans with these settings.';
  }));

  server.registerTool('add_collection_source', {
    title: 'Add a source',
    description: 'Add a source to a collection. With suggestOnly, its titles wait in Review as suggestions instead of joining directly.',
    inputSchema: { id: z.number().int().positive(), sourceType, sourceValue: z.string(), suggestOnly: z.boolean().optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (a) => attempt(`source added to collection ${a.id}`, () => addSource(app, a.id, { type: a.sourceType, value: a.sourceValue, suggestOnly: a.suggestOnly })));

  server.registerTool('remove_collection_source', {
    title: 'Remove a source',
    description: 'Remove a source from a collection (source ids are in get_collection). Titles only it supplied are proposed for removal on the next run.',
    inputSchema: { id: z.number().int().positive(), sourceId: z.number().int().positive() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  }, async (a) => attempt(`source ${a.sourceId} removed from collection ${a.id}`, () => removeSource(app, a.id, a.sourceId)));

  server.registerTool('set_source_role', {
    title: 'Source adds or suggests',
    description: 'Make a source add its titles directly, or only suggest them (they wait in Review).',
    inputSchema: { id: z.number().int().positive(), sourceId: z.number().int().positive(), role: z.enum(['add', 'suggest']) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (a) => attempt(`source ${a.sourceId} set to ${a.role}`, () => setSourceRole(app, a.id, a.sourceId, a.role)));

  server.registerTool('pin_or_exclude_title', {
    title: 'Always include or never include a title',
    description: 'Pin a title (always in this collection), exclude it (never in it), or clear either. Give the title id from get_collection or explain_collection, or its exact name.',
    inputSchema: { id: z.number().int().positive(), title: z.string().describe('Title id, or exact name.'), rule: z.enum(['pin', 'exclude', 'clear']) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (a) => attempt(`title ${a.rule} on collection ${a.id}`, () => {
    const jfId = findTitle(a.title);
    if (!jfId) throw new SettingsError(`No single title in your library matches “${a.title}”. Use its id from get_collection or explain_collection.`);
    return setPin(app, a.id, jfId, a.rule);
  }));

  server.registerTool('delete_collection', {
    title: 'Delete a collection',
    description: 'Delete one of your own collections (presets can only be turned off). Its box set must be gone first: turn it off and run once.',
    inputSchema: { id: z.number().int().positive() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async (a) => attempt(`collection ${a.id} deleted`, () => deleteCollection(app, a.id)));

  server.registerTool('adopt_box_set', {
    title: 'Adopt an existing box set',
    description: 'Take over a box set already in Jellyfin (from list_existing_box_sets) for a collection. It is replaced by a fresh locked box set with the same titles and the app\'s own name, overview, TMDb link and artwork (nothing Jellyfin attached to it is kept), and the old one is deleted; its titles stay in the library. Its titles then sync through Review.',
    inputSchema: { boxSetId: z.string(), collectionId: z.number().int().positive() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, async (a) => attempt(`box set ${a.boxSetId} adopted for collection ${a.collectionId}`, async () => {
    const id = await adopt(app, a.collectionId, a.boxSetId, by);
    return `Adopted: replaced by a fresh locked box set (${id}) with the same titles and the app's artwork. The next run syncs its titles through Review.`;
  }));

  server.registerTool('adopt_suggested_box_sets', {
    title: 'Adopt every suggested box set',
    description: 'Adopt every box set list_existing_box_sets suggests adopting, in one go (for example Jellyfin\'s own film series collections once Film series is on).',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async () => {
    const r = await adoptSuggested(app, by);
    log.info(`Claude access: ${r.adopted} box set(s) adopted via token “${token.name}”`);
    return r.failed.length ? fail(`Adopted ${r.adopted}. Failed: ${r.failed.join('; ')}`) : ok(`Adopted ${r.adopted}. The next run syncs their titles through Review.`);
  });

  server.registerTool('delete_box_set', {
    title: 'Delete an existing box set',
    description: 'Delete a box set the app doesn\'t manage (from list_existing_box_sets), such as a leftover from another tool. The films and shows stay in your library. Confirm with the user first.',
    inputSchema: { boxSetId: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, async (a) => attempt(`box set ${a.boxSetId} deleted`, async () => {
    if (!(await adoptionCandidates(app)).some((b) => b.boxsetId === a.boxSetId)) throw new SettingsError('Only box sets listed by list_existing_box_sets can be deleted here.');
    await deleteUnmanaged(app, a.boxSetId, by);
    return 'Box set deleted. Its films and shows are still in your library.';
  }));

  server.registerTool('undo_change', {
    title: 'Undo a change',
    description: 'Undo a change that was applied to Jellyfin (ids from list_activity), as Activity\'s Undo does. Each change can be undone once.',
    inputSchema: { activityId: z.number().int().positive() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, async (a) => attempt(`change ${a.activityId} undone`, () => undoAction(app, a.activityId, by)));

  server.registerTool('send_missing_titles', {
    title: 'Send missing titles to Radarr or Sonarr',
    description: 'Send titles a collection is missing (keys from list_missing) to Radarr (films) or Sonarr (shows), with the defaults from get_radarr_sonarr_options and this collection\'s own options. Up to the per-run cap. With sendNow false they wait in Review instead.',
    inputSchema: { collectionId: z.number().int().positive(), keys: z.array(z.string()).min(1).max(200), sendNow: z.boolean().optional().describe('Default true.') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (a) => {
    try {
      const def = loadDefinition(app.db, a.collectionId);
      if (!def) return fail(`No collection with id ${a.collectionId}.`);
      const tab = def.target === 'movies' ? 'movies' : 'shows';
      const r = await sendMissing(app, { defId: def.id, tab, keys: a.keys, sendNow: a.sendNow ?? true, options: arrOptions(app, tab === 'movies' ? 'radarr' : 'sonarr', def.id), by });
      log.info(`Claude access: ${a.keys.length} missing title(s) of ${def.name} sent via token “${token.name}”`);
      return r.ok ? ok(r.message) : fail(r.message);
    } catch (e) {
      if (e instanceof SettingsError) return fail(e.message);
      throw e;
    }
  });

  server.registerTool('monitor_in_radarr', {
    title: 'Monitor a TMDb collection in Radarr',
    description: 'Have Radarr monitor one of a collection\'s TMDb collections (its tmdb_collection source IDs), so Radarr adds that series\' missing films itself as they\'re released.',
    inputSchema: { collectionId: z.number().int().positive(), tmdbCollectionId: z.string() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (a) => {
    const cl = app.radarr();
    if (!cl) return fail('Radarr isn\'t connected (Settings → Connections).');
    const found = (await cl.collections()).find((c) => String(c.tmdbId) === a.tmdbCollectionId);
    if (!found) return fail(`Radarr has no collection with TMDb id ${a.tmdbCollectionId}. Radarr only knows a TMDb collection once it has one of its films.`);
    try {
      const r = await monitorInRadarr(app, { defId: a.collectionId, radarrCollectionId: found.id, title: found.title, by });
      log.info(`Claude access: Radarr collection ${found.title} monitored via token “${token.name}”`);
      return r.ok ? ok(r.message) : fail(r.message);
    } catch (e) {
      if (e instanceof SettingsError) return fail(e.message);
      throw e;
    }
  });

  server.registerTool('update_radarr_sonarr_defaults', {
    title: 'Radarr/Sonarr defaults',
    description: 'Change the defaults used when titles are sent to Radarr or Sonarr. Give only what should change; choices are in get_radarr_sonarr_options.',
    inputSchema: {
      app: z.enum(['radarr', 'sonarr']), qualityProfileId: z.number().int().optional(), rootFolderPath: z.string().optional(), tags: z.array(z.number().int()).optional(),
      monitored: z.boolean().optional(), searchOnAdd: z.boolean().optional(),
      minimumAvailability: z.enum(['announced', 'inCinemas', 'released']).optional().describe('Radarr only.'),
      seriesType: z.enum(['standard', 'anime', 'daily']).optional().describe('Sonarr only.'), seasonFolder: z.boolean().optional().describe('Sonarr only.'), monitor: z.string().optional().describe('Sonarr only: which episodes to monitor, e.g. all, future, missing.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async ({ app: which, ...change }) => attempt(`${which} defaults changed`, async () => {
    const cl = which === 'radarr' ? app.radarr() : app.sonarr();
    if (cl && (change.qualityProfileId !== undefined || change.rootFolderPath !== undefined)) {
      const [profiles, roots] = await Promise.all([cl.qualityProfiles(), cl.rootFolders()]);
      if (change.qualityProfileId !== undefined && !profiles.some((p) => p.id === change.qualityProfileId)) throw new SettingsError(`No quality profile ${change.qualityProfileId}. Choices: ${profiles.map((p) => `${p.id} ${p.name}`).join(', ')}.`);
      if (change.rootFolderPath !== undefined && !roots.some((r) => r.path === change.rootFolderPath)) throw new SettingsError(`No root folder ${change.rootFolderPath}. Choices: ${roots.map((r) => r.path).join(', ')}.`);
    }
    const next = { ...app.settings().arr[which], ...Object.fromEntries(Object.entries(change).filter(([, v]) => v !== undefined)) };
    saveArrDefaults(app, which, next);
    return `Saved ${which === 'radarr' ? 'Radarr' : 'Sonarr'} defaults: ${JSON.stringify(next)}`;
  }));

  server.registerTool('apply_poster_overlays', {
    title: 'Apply poster overlays now',
    description: 'Start a run that puts the chosen poster overlays (update_settings posterOverlays) on posters in Jellyfin now, even while dry run is on, as Settings → Poster overlays → Apply now does. It changes posters in Jellyfin (originals are kept and can be put back with remove_poster_overlays); confirm with the user first. Follow it with get_status.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, async () => {
    const s = app.settings();
    if (!s.overlays.status && !s.overlays.imdbTop250 && !overlayCount(app)) return fail('No overlays are chosen. Choose some with update_settings posterOverlays first.');
    const r = startOverlayRun(app, 'apply');
    if (!r.ok) return fail(r.error);
    log.info(`Claude access: poster overlays applied via token “${token.name}”`);
    return ok('Run started: it updates poster overlays as it finishes. Follow it with get_status.');
  });

  server.registerTool('remove_poster_overlays', {
    title: 'Remove all poster overlays',
    description: 'Turn every poster overlay off and start a run that puts each original poster back in Jellyfin, as Settings → Poster overlays → Remove all overlays does. Confirm with the user first.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, async () => {
    const r = startOverlayRun(app, 'remove');
    if (!r.ok) return fail(r.error);
    log.info(`Claude access: poster overlays removed via token “${token.name}”`);
    return ok('Overlays turned off. Run started: it puts the original posters back. Follow it with get_status.');
  });

  server.registerTool('sync_home_rows', {
    title: 'Update home-screen rows now',
    description: 'Update the home-screen rows in Jellyfin now, as Settings → Home-screen rows → "Update rows in Jellyfin now" does. Home-screen rows must be on (update_settings homeRows.enabled).',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async () => {
    if (!app.settings().homeRows.enabled) return fail('Home-screen rows are off. Turn them on with update_settings first.');
    try {
      const r = await syncHomeRows(app, { dryRun: false });
      if (r.problem) return fail(r.problem);
      log.info(`Claude access: home-screen rows updated via token “${token.name}”`);
      return ok(r.changed ? `Rows updated. Showing: ${r.showing.join(', ') || 'none right now'}.` : 'Rows were already up to date.');
    } catch (e) {
      return fail(`Couldn’t update the rows: ${(e as Error).message}`);
    }
  });

  return server;
}

/** The /mcp route: bearer-token auth, then one stateless MCP exchange. */
export function mcpHandler(app: AppContext, opts: { restartScheduler?: () => void } = {}) {
  const limiter = new AttemptLimiter(10);
  return async (c: Context): Promise<Response> => {
    // A browser page on another site must not be able to talk to this endpoint (DNS rebinding); MCP clients send no Origin.
    const origin = c.req.header('origin');
    if (origin) {
      let sameHost = false;
      try { sameHost = new URL(origin).host === (c.req.header('host') ?? ''); } catch { /* not a URL */ }
      if (!sameHost) return c.json({ error: 'Requests from web pages on other sites are not allowed.' }, 403);
    }
    // Stateless and request/response only: no server-initiated stream (GET) and no session to end (DELETE).
    if (c.req.method !== 'POST') {
      c.header('Allow', 'POST');
      return c.json({ error: 'Use POST.' }, 405);
    }
    const keys = [`ip:${clientIp(c, app.config.trustProxy)}`];
    const wait = limiter.retryAfter(keys);
    if (wait) {
      c.header('Retry-After', String(wait));
      return c.json({ error: 'Too many requests with a wrong token. Try again later.' }, 429);
    }
    const presented = /^Bearer\s+(\S+)\s*$/i.exec(c.req.header('authorization') ?? '')?.[1];
    const token = presented ? verifyToken(app.db, presented) : null;
    if (!token) {
      limiter.fail(keys);
      c.header('WWW-Authenticate', 'Bearer realm="Maverick Jellyfin Complete"');
      return c.json({ error: 'An access token is required. Create one in Settings → Claude access.' }, 401);
    }
    limiter.succeed(keys);
    const server = buildServer(app, token, opts);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      await server.close();
    }
  };
}
