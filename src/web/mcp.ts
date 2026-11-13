// MCP endpoint (ADR-032): lets Claude Code or Claude Desktop read this app and, with a "review" token, decide
// proposals in Review and start a run. Streamable HTTP, stateless: every request carries its access token and gets a
// fresh server, so nothing is kept between requests. Settings, keys and collection edits are not exposed.
import type { Context } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { AppContext } from '../app-context.js';
import { APP_VERSION } from '../config.js';
import { action, jobSchedule, libraryItem, managedCollection, run } from '../db/schema.js';
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
import { CONNECTIONS } from './pages/settings.js';
import { JOBS, type JobName } from '../jobs/schedules.js';
import { nextRuns } from '../jobs/scheduler.js';
import type { Settings } from '../settings.js';

const INSTRUCTIONS = `Maverick Jellyfin Complete builds collections (box sets) in the user's Jellyfin media server: seasonal ones that appear and disappear on their dates, holiday episodes, film universes, TV franchises and the user's own.
Each run plans changes. Changes set to Review, and every change while dry run is on, wait in Review until someone approves, snoozes or dismisses them.
Approving applies the change to Jellyfin straight away (or when the collection's dates open), even while dry run is on: dry run only stops changes from applying without approval.
Before approving, show the user exactly what will change (collection, action, titles) and get their go-ahead, especially for deletions and removals. Never approve on your own initiative.
With a full-control token you can also change settings, job schedules and which collections are on. Ask the user before turning dry run off, setting a mode to auto, or turning a collection off: each of those can change Jellyfin without a further approval.
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
    description: 'One collection: settings, sources and their health, the titles it would contain now (from the last run\'s cached lists), what is in its box set, and its proposals in Review.',
    inputSchema: { id: z.number().int().positive().describe('Collection id, from list_collections.'), maxTitles: z.number().int().min(1).max(1000).optional().describe('Most titles to list (default 200).') },
    annotations: read,
  }, async ({ id, maxTitles }) => {
    const def = loadDefinition(app.db, id);
    if (!def) return fail(`No collection with id ${id}.`);
    const row = collectionsModel(app).find((r) => r.def.id === id);
    const plan = cachedPlan(app, def);
    const limit = maxTitles ?? 200;
    const planned = plan ? [...plan.members.keys()].map((jfId) => { const r = plan.index.get(jfId)!; return { name: plan.index.displayName(r), year: r.kind === 'episode' ? null : r.year }; }).sort((a, b) => a.name.localeCompare(b.name)) : null;
    const box = app.db.select().from(managedCollection).where(eq(managedCollection.definitionId, id)).get();
    const proposals = app.db.select().from(action).where(and(eq(action.definitionId, id), inArray(action.status, ['proposed', 'approved']))).all();
    return ok({
      id: def.id, name: def.name, kind: kindOf(def), on: def.enabled, status: row?.status.label ?? null, contains: def.target,
      dates: windowText(def.window as WindowDef | null), next: row?.next ? `${row.next.kind} ${day(row.next.at)}` : null,
      minimumTitles: def.minItems, whenClosed: def.visibility === 'tag_gate' ? 'box set hidden' : 'box set deleted',
      sources: (row?.sources ?? []).map((s) => ({ source: s.label, status: s.status, error: s.error, listed: s.listed, inYourLibrary: s.matched })),
      boxSet: box ? { state: box.state } : null,
      titles: planned ? { count: planned.length, list: planned.slice(0, limit), truncated: planned.length > limit } : 'No library index yet: run once first.',
      waitingInReview: proposals.map((a) => ({ id: a.id, change: TYPE_LABEL[a.type] ?? a.type, title: a.item?.name ?? null, status: a.status })),
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
    return ok({ collection: def.name, total: list.length, titles: list.slice(0, n).map((m) => ({ title: m.title, year: m.year, imdb: m.imdb ?? null, tmdb: m.tmdb ?? null, tvdb: m.tvdb ?? null, sources: m.sources.map((s) => `${s.label} #${s.rank}`) })), truncated: list.length > n });
  });

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
    description: 'Every setting on the Settings page: dry run, timezone, plan-ahead days, action modes, Radarr/Sonarr guardrails and defaults, IMDb route, which libraries collections draw from, home-screen rows, job schedules, and which connections are set up (never the keys themselves).',
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
      schedules: app.db.select().from(jobSchedule).all().map((j) => ({ job: j.job, what: JOBS[j.job as JobName]?.detail ?? null, cron: j.cron, on: j.enabled, next: at(runs.find((r) => r.job === j.job)?.next?.getTime()) })),
      otherToolsSchedules: s.neighbours,
      connections: Object.fromEntries(CONNECTIONS.map((x) => [x.key, { address: x.urlField ? s.connections[x.urlField] || null : undefined, keySaved: x.secret ? app.secrets.masked(x.secret).set : undefined }])),
      whatThisTokenCanChange: token.scope === 'full' ? 'Everything here except connections and keys, which stay on the Settings page.' : 'Nothing: this token can read settings only.',
    });
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
        neighbours: a.otherToolsSchedules,
      });
      if (r.timezoneChanged) opts.restartScheduler?.();
      log.info(`Claude access: settings changed via token “${token.name}”: ${r.changed.join(', ') || 'nothing'}`);
      return ok(`Saved.\n${changeResult(before, r.changed)}`);
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
