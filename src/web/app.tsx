/** @jsxImportSource hono/jsx */
// Routes. Server-rendered HTML with HTMX for run progress, connection tests and the live preview (ADR-002).
import { Hono, type Context } from 'hono';
import type { Child } from 'hono/jsx';
import { serveStatic } from '@hono/node-server/serve-static';
import { relative, join } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { Cron } from 'croner';
import type { AppContext } from '../app-context.js';
import { APP_ROOT, APP_VERSION } from '../config.js';
import { action, definition, definitionSource, jobSchedule, sourceResult, libraryItem, managedCollection } from '../db/schema.js';
import type { Target } from '../domain/source-input.js';
import { queriesFor } from '../imdb/queries.js';
import { JellyfinClient } from '../clients/jellyfin/index.js';
import { TmdbClient } from '../clients/tmdb.js';
import { requestJson } from '../clients/http.js';
import { createSession, endSession, requireAuth, userOf } from './auth.js';
import { Layout, Csrf, type NavKey } from './ui.js';
import { AttemptLimiter, clientIp, isHttps, minutes, sameCode } from './security.js';
import { shellModel, dashboardModel, collectionsModel, reviewModel, activityModel, librariesModel, inboxCounts, nextRunAt, type ReviewTab } from './model.js';
import { familyNote, whenNext } from './terms.js';
import { Dashboard, AutomaticOffer } from './pages/dashboard.js';
import { RunProgress } from './pages/run-progress.js';
import { CollectionsList, CollectionEditor, CollectionRow, FamilyCount, ToggleStatus, NewCollection, Preview, ParityPanel, EDITOR_TABS, type EditorTab, type PreviewItem } from './pages/collections.js';
import { parity } from '../domain/parity.js';
import { cachedPlan } from './plan-cache.js';
import { Missing, ArrOptionsFields, parseArrOptions } from './pages/missing.js';
import { missingModel } from './missing-model.js';
import { fingerprint } from '../pipeline/planner.js';
import { definitionArr, run, posterKey } from '../db/schema.js';
import { homeStatus, syncHomeRows } from '../homescreen/index.js';
import { HomeRowsPanel } from './pages/home-rows.js';
import { Start, START_STEPS, stepsDone } from './pages/start.js';
import { versionSupport } from '../clients/jellyfin/compat.js';
import { familyOf, plexCounterpart, PRESET_FAMILIES } from '../presets/index.js';
import { availableIn, serviceOfPreset } from '../presets/streaming.js';
import type { OnboardingStep } from '../settings.js';
import { Review } from './pages/review.js';
import { Activity } from './pages/activity.js';
import { SettingsConnections, SettingsLibraries, SettingsApprovals, SettingsSchedule, SettingsExtras, SettingsAdvanced, CONNECTIONS } from './pages/settings.js';
import { Login, Setup } from './pages/auth.js';
import { Adoption } from './pages/adoption.js';
import { runPipeline, currentRun, isRunning } from '../pipeline/run.js';
import { forgetDecision } from '../pipeline/store.js';
import { reviewVerdict, type SnoozeFor } from './review-actions.js';
import { createToken, listTokens, revokeToken, SCOPE_LABEL, type TokenScope } from './api-tokens.js';
import type { Reveal } from './pages/claude-access.js';
import { mcpHandler } from './mcp.js';
import { setFilmSeries } from '../pipeline/film-series.js';
import { applySettings, setSchedule, setCollectionEnabled, setFamilyEnabled, SettingsError, MODE_KEYS, type ModeKey, type SettingsPatch } from './settings-actions.js';
import { createCollection, updateCollection, addSource, removeSource, setSourceRole, setPin, deleteCollection, sendMissing, monitorInRadarr, saveArrDefaults, setPoster, type CollectionPatch, type PosterChoice } from './collection-actions.js';
import { defaultPoster, postersDir, readPoster } from '../domain/posters.js';
import { undoAction } from '../pipeline/undo.js';
import { adoptionCandidates, adopt, adoptSuggested, deleteUnmanaged } from '../pipeline/adoption.js';
import { loadDefinition, loadDefinitions } from '../domain/definitions.js';
import { members as computeMembers } from '../pipeline/planner.js';
import { syncLibraries } from '../library/indexer.js';
import { sourceKey, sourceLabel, resolveSource, type ResolvedSource } from '../sources/index.js';
import type { LoadedDefinition } from '../domain/definitions.js';
import { getPlanSummary } from '../pipeline/summary.js';
import { startScheduler, nextRuns, lastHeartbeat } from '../jobs/scheduler.js';
import { log } from '../log.js';
import type { Mode, Settings } from '../settings.js';
import { overlayLibraries, overlaysModel, overlayPreview, startOverlayRun } from './overlay-actions.js';
import { kidsLibraries } from '../overlays/badges.js';
import { OverlaysPanel } from './pages/overlays.js';
import { HealthPage } from './pages/health.js';
import { dismissFinding, dismissFindings, healthDashboard, reopenFinding } from '../library/health.js';
import { artworkSummary, backupPoster, IMAGE_TYPES, resetArtwork, undoArtworkFix, type ImageType } from '../library/artwork.js';
import { mediaStatus, middleFrame } from '../library/media.js';
import type { HealthKind } from '../db/schema.js';

const HEALTH_KINDS: HealthKind[] = ['runtime', 'title', 'audio', 'no_poster', 'video_poster', 'language', 'other_title'];
const ARTWORK_RESETS_PER_REQUEST = 50;

const MODES = new Set(['off', 'review', 'auto']);

export function createWeb(app: AppContext, opts: { scheduler?: boolean } = {}): Hono {
  const web = new Hono();
  /** Schedules and the timezone drive the scheduler; restart it after either changes (when this process runs one). */
  const restartScheduler = () => { if (opts.scheduler) startScheduler(app); };

  web.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'same-origin');
    c.header('X-Frame-Options', 'DENY');
    c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    c.header('Cross-Origin-Opener-Policy', 'same-origin');
    c.header('Cross-Origin-Resource-Policy', 'same-origin');
    if (isHttps(c, app.config.trustProxy)) c.header('Strict-Transport-Security', 'max-age=15552000');
    c.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  });

  const root = relative(process.cwd(), join(APP_ROOT, 'public')) || '.';
  web.use('/static/*', serveStatic({ root, rewriteRequestPath: (p) => p.replace(/^\/static/, '') }));

  web.get('/healthz', (c) => {
    try {
      app.db.$client.prepare('select 1').get();
    } catch {
      return c.text('database unavailable', 503);
    }
    if (opts.scheduler && Date.now() - lastHeartbeat > 120_000) return c.text('scheduler stalled', 503);
    c.header('X-App-Version', APP_VERSION);
    return c.text('ok');
  });

  // ── first run and sign-in ──
  /** Read library names from Jellyfin; returns an error message instead of throwing. */
  const refreshLibraries = async (): Promise<string | null> => {
    const jf = app.jellyfin();
    if (!jf) return 'Jellyfin isn’t connected';
    try {
      await syncLibraries(app.db, jf);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };

  // Failed sign-ins and setup attempts, per client address and per username (Phase 4 hardening).
  const signInLimiter = new AttemptLimiter();
  const setupLimiter = new AttemptLimiter(10);

  web.get('/setup', (c) => (app.jellyfin() ? c.redirect('/login') : c.html(<Setup needsCode={Boolean(app.setupCode)} />)));
  web.post('/setup', async (c) => {
    if (app.jellyfin()) return c.redirect('/login');
    const body = await c.req.parseBody();
    const url = String(body.url ?? '').trim().replace(/\/$/, '');
    const apiKey = String(body.apiKey ?? '').trim();
    const ipKey = [`ip:${clientIp(c, app.config.trustProxy)}`];
    const wait = setupLimiter.retryAfter(ipKey);
    if (wait) return c.html(<Setup url={url} needsCode={Boolean(app.setupCode)} error={`Too many attempts. Try again in ${minutes(wait)} minute(s).`} />, 429);
    if (app.setupCode && !sameCode(String(body.setupCode ?? ''), app.setupCode)) {
      setupLimiter.fail(ipKey);
      return c.html(<Setup url={url} needsCode error="That setup code isn’t right. It’s printed in the app’s log when it starts (docker logs maverick-jellyfin-complete)." />, 403);
    }
    if (!/^https?:\/\/[^\s]+$/.test(url) || !apiKey) return c.html(<Setup url={url} needsCode={Boolean(app.setupCode)} error="Enter the Jellyfin address (http://…) and an API key." />, 400);
    try {
      const jf = new JellyfinClient({ baseUrl: url, apiKey, fetch: app.fetch });
      const info = await jf.systemInfo();
      const v = versionSupport(info.Version ?? undefined);
      if (v.level === 'unsupported') return c.html(<Setup url={url} needsCode={Boolean(app.setupCode)} error={v.note} />, 400);
      await jf.userId();
    } catch (e) {
      setupLimiter.fail(ipKey);
      return c.html(<Setup url={url} needsCode={Boolean(app.setupCode)} error={`Couldn’t reach Jellyfin with that key: ${(e as Error).message}`} />, 400);
    }
    app.updateSettings({ connections: { ...app.settings().connections, jellyfinUrl: url }, firstRunDone: true });
    app.secrets.set('jellyfin.apiKey', apiKey);
    app.setupCode = null; // used up
    setupLimiter.succeed(ipKey);
    await refreshLibraries();
    return c.redirect('/login');
  });
  web.get('/login', (c) => (app.jellyfin() ? c.html(<Login server={app.settings().connections.jellyfinUrl} />) : c.redirect('/setup')));
  web.post('/login', async (c) => {
    const body = await c.req.parseBody();
    const username = String(body.username ?? '');
    const password = String(body.password ?? '');
    const url = app.settings().connections.jellyfinUrl;
    if (!url) return c.redirect('/setup');
    const keys = [`ip:${clientIp(c, app.config.trustProxy)}`, `user:${username.trim().toLowerCase()}`];
    const wait = signInLimiter.retryAfter(keys);
    if (wait) return c.html(<Login server={url} error={`Too many failed sign-ins. Try again in ${minutes(wait)} minute(s).`} />, 429);
    try {
      const jf = new JellyfinClient({ baseUrl: url, apiKey: '', fetch: app.fetch });
      const r = await jf.authenticateByName(username, password);
      if (!r.User?.Policy?.IsAdministrator || !r.User.Id) return c.html(<Login server={url} error="That account isn’t a Jellyfin administrator." />, 403);
      signInLimiter.succeed(keys);
      createSession(app, c, { id: r.User.Id, name: r.User.Name ?? username }, isHttps(c, app.config.trustProxy));
      return c.redirect(app.settings().onboarding.finished ? '/' : '/start');
    } catch {
      signInLimiter.fail(keys);
      return c.html(<Login server={url} error="Jellyfin didn’t accept that username and password." />, 401);
    }
  });

  // ── MCP for Claude (ADR-032): its own bearer-token auth, so it sits before the session check ──
  web.all('/mcp', mcpHandler(app, { restartScheduler }));

  // ── everything below needs an admin session ──
  web.use('*', requireAuth(app));

  web.post('/logout', (c) => {
    endSession(app, c);
    return c.redirect('/login');
  });

  const page = (c: Context, title: string, nav: NavKey, body: Child, banner?: Child) => {
    const u = userOf(c);
    const ok = c.req.query('ok');
    const err = c.req.query('err');
    return c.html(
      <Layout title={title} nav={nav} user={{ name: u.name, csrf: u.csrf }} {...shellModel(app)} flash={err ? { kind: 'err', text: err } : ok ? { kind: 'ok', text: ok } : null} banner={banner}>
        {body}
      </Layout>,
    );
  };
  const back = (c: Context, path: string, msg: { ok?: string; err?: string }) => {
    const u = new URL(path, 'http://x');
    if (msg.ok) u.searchParams.set('ok', msg.ok);
    if (msg.err) u.searchParams.set('err', msg.err);
    return c.redirect(u.pathname + u.search + u.hash);
  };

  /** A path inside the app to go back to, from a form's "next" field; anything else is ignored. */
  const localPath = (v: unknown, fallback: string) => { const p = String(v ?? ''); return /^\/(?!\/)[\w\-/?=&#.]*$/.test(p) ? p : fallback; };

  web.get('/', (c) => {
    const ob = app.settings().onboarding;
    const m = dashboardModel(app);
    const banner = !ob.finished ? <div class="banner"><span><b>Finish setting up.</b> A few choices, then a first run. Nothing changes in Jellyfin until you approve it.</span><a class="btn sm" href="/start">Getting started</a></div>
      : m.offerAutomatic ? <AutomaticOffer m={m} csrf={userOf(c).csrf} /> : undefined;
    return page(c, 'Home', 'home', <Dashboard m={m} csrf={userOf(c).csrf} />, banner);
  });
  // The one-time offer on Home (ADR-046): stop approving everything first, or keep asking. Either way it isn't shown again.
  web.post('/start/automatic', async (c) => {
    const yes = (await c.req.parseBody()).choice === 'yes';
    if (yes) applySettings(app, { dryRun: false });
    app.updateSettings({ onboarding: { ...app.settings().onboarding, automaticOffered: true } });
    return back(c, '/', { ok: yes ? 'Done. Changes set to Automatic now happen on their own; everything else still waits in your Inbox.' : 'Nothing changes: every change still waits for your approval. You can switch this in Settings → Approvals.' });
  });

  // ── first-run guide (Phase 4) ──
  const markDone = (step: OnboardingStep) => {
    const ob = app.settings().onboarding;
    if (!ob.done.includes(step)) app.updateSettings({ onboarding: { ...ob, done: [...ob.done, step] } });
  };
  web.get('/start', async (c) => {
    const s = app.settings();
    const defs = loadDefinitions(app.db);
    const families = PRESET_FAMILIES.map((family) => {
      const mine = defs.filter((d) => familyOf(d.presetKey) === family);
      // Movie series is one switch, on before any series exists; the others count their collections.
      const on = family === 'film_series' ? (s.filmSeries.enabled ? 1 : 0) : mine.filter((d) => d.enabled).length;
      return { family, on, total: mine.length, note: familyNote(family, mine.length, s) };
    });
    // Before the first run the library list can be empty; read it from Jellyfin so it can be chosen, and say why if it can't.
    const libError = librariesModel(app).length ? null : await refreshLibraries();
    const hasRun = Boolean(app.db.select({ id: run.id }).from(run).limit(1).get());
    const progress = currentRun();
    // Collections Jellyfin already has under one of the chosen names. Only looked up once the collections are chosen.
    const chosen = s.onboarding.done.includes('families');
    const existing = await (async () => {
      if (!chosen) return { count: 0, error: null };
      try {
        return { count: (await adoptionCandidates(app)).length, error: null };
      } catch (e) {
        return { count: 0, error: (e as Error).message };
      }
    })();
    const base = { s, tmdbSet: Boolean(app.secrets.get('tmdb.apiKey')), existing, hasRun, progress };
    const done = stepsDone(base);
    const asked = Number(c.req.query('step'));
    const firstOpen = done.findIndex((d) => !d);
    const step = Number.isInteger(asked) && asked >= 1 && asked <= START_STEPS ? asked : firstOpen === -1 ? START_STEPS : firstOpen + 1;
    return page(c, 'Getting started', 'start', <Start m={{ ...base, libraries: librariesModel(app), libError, families, pending: inboxCounts(app).changes, step, csrf: userOf(c).csrf }} />);
  });
  web.post('/start/timezone', async (c) => {
    const tz = String((await c.req.parseBody()).timezone ?? '').trim();
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
    } catch {
      return back(c, '/start?step=2', { err: `Unknown timezone “${tz}”.` });
    }
    const changed = tz !== app.settings().timezone;
    app.updateSettings({ timezone: tz });
    if (changed) restartScheduler();
    markDone('timezone');
    return c.redirect('/start?step=3');
  });
  web.post('/start/tmdb', async (c) => {
    const key = String((await c.req.parseBody()).key ?? '').trim();
    if (!key) {
      markDone('tmdb');
      return back(c, '/start?step=4', app.secrets.get('tmdb.apiKey') ? {} : { ok: 'Skipped for now. You can add a TMDb key later in Settings → Connections.' });
    }
    try {
      await new TmdbClient(app.db, key, app.fetch).ping();
    } catch (e) {
      return back(c, '/start?step=3', { err: `TMDb didn’t accept that key: ${(e as Error).message}` });
    }
    app.secrets.set('tmdb.apiKey', key);
    markDone('tmdb');
    return back(c, '/start?step=4', { ok: 'TMDb key saved.' });
  });
  web.post('/start/families', async (c) => {
    const b = await c.req.parseBody({ all: true });
    const on = new Set(([] as unknown[]).concat(b.families ?? []).map(String));
    if (on.has('film_series') !== app.settings().filmSeries.enabled) setFilmSeries(app, on.has('film_series'));
    for (const d of loadDefinitions(app.db)) {
      const f = familyOf(d.presetKey);
      if (f === 'custom' || f === 'film_series') continue;
      // Streaming: only the services offered in your country (Kometa's allowed_streaming).
      const service = f === 'streaming' ? serviceOfPreset(d.presetKey) : undefined;
      const want = on.has(f) && (!service || availableIn(service, app.settings().streaming.region));
      if (want !== d.enabled) app.db.update(definition).set({ enabled: want, updatedAt: Date.now() }).where(eq(definition.id, d.id)).run();
    }
    markDone('families');
    // The guide's Continue starts the first run here, so its results are ready by the last step.
    const first = b.run === '1' && !isRunning() && app.jellyfin() && !app.db.select({ id: run.id }).from(run).limit(1).get();
    if (first) runPipeline(app, { job: 'manual', trigger: 'manual', index: true }).catch((e) => log.error(`First run failed: ${(e as Error).message}`));
    return back(c, '/start?step=5', first ? { ok: 'Saved. The first run has started in the background.' } : {});
  });
  web.post('/start/existing', (c) => {
    markDone('existing');
    return c.redirect('/start?step=6');
  });
  web.post('/start/finish', async (c) => {
    app.updateSettings({ onboarding: { ...app.settings().onboarding, finished: true } });
    return c.redirect(localPath((await c.req.parseBody()).next, '/'));
  });

  web.post('/runs', async (c) => {
    if (!isRunning()) {
      runPipeline(app, { job: 'manual', trigger: 'manual', index: true }).catch((e) => log.error(`Manual run failed: ${(e as Error).message}`));
    }
    if (c.req.header('hx-request')) return c.html(<RunProgress p={currentRun()} csrf={userOf(c).csrf} />);
    return c.redirect(localPath((await c.req.parseBody()).next, '/'));
  });
  web.get('/runs/progress', (c) => c.html(<RunProgress p={currentRun()} csrf={userOf(c).csrf} />));

  // ── collections ──
  web.get('/collections', (c) => page(c, 'Collections', 'collections', <CollectionsList rows={collectionsModel(app)} tz={app.settings().timezone} csrf={userOf(c).csrf} s={app.settings()} />));

  // On/off from the list (one click): htmx swaps just the row and the family's count; without htmx it comes back to the row.
  web.post('/collections/:id/enabled', async (c) => {
    const id = Number(c.req.param('id'));
    const on = (await c.req.parseBody()).enabled === '1';
    let msg: string;
    const wasLive = ['live', 'hidden'].includes(app.db.select().from(managedCollection).where(eq(managedCollection.definitionId, id)).get()?.state ?? '');
    try {
      msg = setCollectionEnabled(app, id, on);
    } catch (e) {
      if (e instanceof SettingsError) return c.notFound();
      throw e;
    }
    if (c.req.header('hx-request')) {
      const rows = collectionsModel(app);
      const r = rows.find((x) => x.def.id === id)!;
      const fam = familyOf(r.def.presetKey);
      const group = rows.filter((x) => familyOf(x.def.presetKey) === fam);
      return c.html(<><CollectionRow r={r} tz={app.settings().timezone} csrf={userOf(c).csrf} note={{ text: on ? 'Turned on. The next run reads its lists.' : wasLive ? 'Turned off. It’s removed from Jellyfin on the next run.' : 'Turned off.' }} /><FamilyCount fam={fam} on={group.filter((x) => x.def.enabled).length} total={group.length} oob /><ToggleStatus text={msg} oob /></>);
    }
    return back(c, `/collections#c-${id}`, { ok: msg });
  });
  // All on / All off for a family. Streaming turns on only the services offered in your country.
  web.post('/collections/family/:fam/enabled', async (c) => {
    const on = (await c.req.parseBody()).enabled === '1';
    try {
      const r = setFamilyEnabled(app, c.req.param('fam'), on);
      return back(c, `/collections#fam-${r.family}`, { ok: r.message });
    } catch (e) {
      if (e instanceof SettingsError) return c.notFound();
      throw e;
    }
  });

  web.get('/collections/new', (c) => page(c, 'New collection', 'collections', <NewCollection csrf={userOf(c).csrf} />));

  web.post('/collections/new', async (c) => {
    const b = await c.req.parseBody();
    const values = Object.fromEntries(['name', 'target', 'schedule', 'from', 'to', 'type', 'value'].map((k) => [k, String(b[k] ?? '')]));
    const target: Target = values.target === 'shows' ? 'shows' : values.target === 'episodes' ? 'episodes' : 'movies';
    try {
      const id = createCollection(app, { name: values.name!, target, dates: b.schedule === 'always' ? null : { from: values.from!, to: values.to! }, sourceType: values.type!, sourceValue: values.value! });
      return back(c, `/collections/${id}?tab=sources`, { ok: 'Collection created. Its source is read on the next run: use Run now on Home to do it straight away.' });
    } catch (e) {
      if (!(e instanceof SettingsError)) throw e;
      return c.html(
        <Layout title="New collection" nav="collections" user={{ name: userOf(c).name, csrf: userOf(c).csrf }} {...shellModel(app)} flash={null}>
          <NewCollection csrf={userOf(c).csrf} error={e.message} values={values} />
        </Layout>, 400);
    }
  });

  web.get('/collections/:id', (c) => {
    const def = loadDefinition(app.db, Number(c.req.param('id')));
    if (!def) return c.notFound();
    const summary = getPlanSummary(app.db)?.defs[String(def.id)];
    const sources = def.sources.map((s) => {
      const key = sourceKey({ type: s.type, config: s.config });
      const row = app.db.select().from(sourceResult).where(eq(sourceResult.sourceKey, key)).get();
      const sum = summary?.sources.find((x) => x.key === key);
      return { id: s.id, label: sourceLabel({ type: s.type, config: s.config }), status: row?.status ?? 'unknown', error: row?.error ?? null, listed: row?.items?.length ?? 0, matched: sum?.matched ?? 0, role: s.role, fetchedAt: row?.fetchedAt ?? null };
    });
    const state = app.db.select().from(managedCollection).where(eq(managedCollection.definitionId, def.id)).get()?.state;
    const live = state === 'live' || state === 'hidden';
    const arr = { addMissing: app.db.select().from(definitionArr).where(eq(definitionArr.definitionId, def.id)).get()?.addMissing ?? false, radarr: Boolean(app.radarr()), sonarr: Boolean(app.sonarr()), cap: app.settings().guardrails.arrCapPerRun };
    const row = collectionsModel(app).find((r) => r.def.id === def.id)!;
    const asked = c.req.query('tab') as EditorTab;
    // A collection with nothing read yet opens on its sources; otherwise on what's in it.
    const tab = EDITOR_TABS.includes(asked) ? asked : 'titles';
    return page(c, def.name, 'collections', <CollectionEditor def={def} tz={app.settings().timezone} csrf={userOf(c).csrf} live={live} globalModes={app.settings().modes} dryRun={app.settings().dryRun} row={row} tab={tab} plex={Boolean(app.plex())} sources={sources} arr={arr} posterDefault={(() => { const d = defaultPoster(app, def.presetKey); return d ? posterKey(d) : null; })()} />);
  });

  web.post('/collections/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const def = loadDefinition(app.db, id);
    if (!def) return c.notFound();
    const b = await c.req.parseBody();
    const modes: CollectionPatch['modes'] = {};
    for (const [k, v] of Object.entries(b)) {
      if (k.startsWith('mode:') && (MODE_KEYS as readonly string[]).includes(k.slice(5))) modes[k.slice(5) as ModeKey] = MODES.has(String(v)) ? (String(v) as Mode) : 'default';
    }
    const here = `/collections/${id}?tab=${EDITOR_TABS.includes(b.tab as EditorTab) ? String(b.tab) : 'titles'}`;
    try {
      updateCollection(app, id, {
        name: String(b.name ?? ''), enabled: b.enabled === '1', overview: String(b.overview ?? ''), minItems: Number(b.minItems ?? def.minItems),
        // Dates that follow a rule (such as Easter) aren't editable here; fixed dates and "always" are.
        dates: !def.window || def.window.type === 'range' ? (b.schedule === 'always' ? null : { from: String(b.from ?? ''), to: String(b.to ?? '') }) : undefined,
        syncMode: b.syncMode === 'append' ? 'append' : 'sync', sortTitle: String(b.sortTitle ?? ''),
        visibility: b.visibility === 'tag_gate' ? 'tag_gate' : b.visibility === 'delete' ? 'delete' : undefined,
        homeRow: b.homeRowForm === '1' ? b.homeRow === '1' : undefined,
        addMissing: b.arrForm === '1' ? b.arrAddMissing === '1' : undefined,
        modes,
      });
      // The poster is part of the same Save (ADR-046). It's only set again when the choice, the address or the file changed.
      let posterMsg = '';
      if (b.posterForm === '1') {
        const file = b.posterFile instanceof File && b.posterFile.size ? new Uint8Array(await b.posterFile.arrayBuffer()) : null;
        const kind = file ? 'upload' : String(b.poster ?? '');
        const url = String(b.posterUrl ?? '').trim();
        const d = defaultPoster(app, def.presetKey);
        const isDefault = Boolean(d) && posterKey(def.poster) === posterKey(d!);
        const choice: PosterChoice | null =
          kind === 'upload' ? (file ? { kind: 'upload', bytes: file } : def.poster.kind === 'file' ? null : { kind: 'upload', bytes: new Uint8Array() })
          : kind === 'none' ? (def.poster.kind === 'none' ? null : { kind: 'none' })
          : kind === 'default' ? (isDefault ? null : { kind: 'default' })
          : kind === 'url' ? (def.poster.kind === 'url' && !isDefault && def.poster.url === url ? null : { kind: 'url', url })
          : null;
        if (choice) {
          try {
            posterMsg = ` ${await setPoster(app, id, choice)}`;
          } catch (e) {
            // Everything else is saved by now; say so, and why the poster wasn't.
            if (e instanceof SettingsError) return back(c, here, { err: `Saved, but the poster wasn’t changed: ${e.message}` });
            throw e;
          }
        }
      }
      return back(c, here, { ok: `Saved. The next run uses these settings.${posterMsg}` });
    } catch (e) {
      if (e instanceof SettingsError) return back(c, here, { err: e.message });
      throw e;
    }
  });

  // ── Posters (ADR-042): set from the editor; shown through the app so any address works under the page's CSP. ──
  web.post('/collections/:id/poster', async (c) => {
    const id = Number(c.req.param('id'));
    if (!loadDefinition(app.db, id)) return c.notFound();
    const b = await c.req.parseBody();
    const file = b.posterFile instanceof File && b.posterFile.size ? new Uint8Array(await b.posterFile.arrayBuffer()) : null;
    const kind = String(b.poster ?? (file ? 'upload' : 'url'));
    const choice: PosterChoice = kind === 'none' ? { kind: 'none' } : kind === 'default' ? { kind: 'default' } : kind === 'upload' ? { kind: 'upload', bytes: file ?? new Uint8Array() } : { kind: 'url', url: String(b.posterUrl ?? '') };
    try {
      return back(c, `/collections/${id}?tab=details`, { ok: await setPoster(app, id, choice) });
    } catch (e) {
      if (e instanceof SettingsError) return back(c, `/collections/${id}`, { err: e.message });
      throw e;
    }
  });
  web.get('/collections/:id/poster', async (c) => {
    const def = loadDefinition(app.db, Number(c.req.param('id')));
    if (!def) return c.notFound();
    try {
      const img = await readPoster(def.poster, { fetch: app.fetch, postersDir: postersDir(app.config.configDir) });
      if (!img) return c.text('No poster', 404);
      return c.body(Buffer.from(img.bytes), 200, { 'content-type': img.type, 'cache-control': 'private, max-age=300' });
    } catch (e) {
      return c.text(`Poster unavailable: ${(e as Error).message}`, 502);
    }
  });

  const cachedMembers = (def: LoadedDefinition) => cachedPlan(app, def);

  web.get('/collections/:id/preview', (c) => {
    const def = loadDefinition(app.db, Number(c.req.param('id')));
    if (!def) return c.notFound();
    const plan = cachedMembers(def);
    if (!plan) return c.html(<p class="muted">Your library hasn’t been read yet. Use Run now on Home, then come back.</p>);
    const { members, index } = plan;
    const inBox = new Set(['live', 'hidden'].includes(app.db.select().from(managedCollection).where(eq(managedCollection.definitionId, def.id)).get()?.state ?? '')
      ? app.db.$client.prepare('select jf_id from membership where definition_id = ?').all(def.id).map((r) => (r as { jf_id: string }).jf_id) : []);
    const items: PreviewItem[] = [...members.entries()].map(([jfId, provenance]) => {
      const r = index.get(jfId)!;
      return { jfId, name: index.displayName(r), year: r.kind === 'episode' ? null : r.year, provenance, inBoxSet: inBox.has(jfId) };
    }).sort((a, b) => a.name.localeCompare(b.name));
    const excluded = [...def.excludes].map((jfId) => { const r = index.get(jfId); return { jfId, name: r ? index.displayName(r) : jfId }; });
    return c.html(<Preview defId={def.id} items={items.slice(0, 100)} excluded={excluded} csrf={userOf(c).csrf} total={items.length} />);
  });

  // Plex parity (ADR-024): the same-named collection in Plex vs this plan.
  web.get('/collections/:id/parity', async (c) => {
    const def = loadDefinition(app.db, Number(c.req.param('id')));
    if (!def) return c.notFound();
    const plex = app.plex();
    if (!plex) return c.html(<p class="muted">Connect Plex in Settings → Connections to compare this collection with the one in Plex.</p>);
    const plan = cachedMembers(def);
    if (!plan) return c.html(<p class="muted">Your library hasn’t been read yet. Use Run now on Home, then come back.</p>);
    const s = app.settings();
    const ctx = { db: app.db, fetch: app.fetch, tmdb: app.tmdb(), plex, mdblistKey: null, imdbRoute: s.imdbRoute };
    const counterpart = plexCounterpart(def);
    const r = await resolveSource(ctx, { type: 'plex_collection', config: { name: counterpart.names[0], names: counterpart.names, ...(counterpart.section ? { section: counterpart.section } : {}) } }, { maxAgeMs: 10 * 60_000 });
    if (r.status === 'failed') return c.html(<p class="muted">Couldn’t read Plex: {r.error}</p>);
    const where = counterpart.section ? ` in a ${counterpart.section === 'movie' ? 'movie' : 'TV'} library` : '';
    if (!(r.meta as { found?: boolean } | null)?.found) return c.html(<p class="muted">Plex has no collection called {counterpart.names.map((n) => `“${n}”`).join(' or ')}{where} right now. Seasonal collections in Plex usually exist only during their dates, so compare while it’s there.</p>);
    const want = def.target === 'movies' ? 'movie' : def.target === 'shows' ? 'series' : def.target === 'episodes' ? 'episode' : 'any';
    return c.html(<ParityPanel p={parity(r.items, new Set(plan.members.keys()), plan.index, want)} fetchedAt={r.fetchedAt} />);
  });

  web.post('/collections/:id/pins', async (c) => {
    const id = Number(c.req.param('id'));
    const b = await c.req.parseBody();
    const kind = String(b.kind ?? '');
    try {
      return back(c, `/collections/${id}?tab=titles`, { ok: setPin(app, id, String(b.jfId ?? ''), kind === 'pin' || kind === 'exclude' ? kind : 'clear') });
    } catch (e) {
      if (e instanceof SettingsError) return back(c, `/collections/${id}`, { err: e.message });
      throw e;
    }
  });

  web.post('/collections/:id/sources', async (c) => {
    const id = Number(c.req.param('id'));
    if (!loadDefinition(app.db, id)) return c.notFound();
    const b = await c.req.parseBody();
    const op = String(b.op ?? '');
    const here = `/collections/${id}?tab=sources`;
    try {
      if (op === 'add') return back(c, here, { ok: addSource(app, id, { type: String(b.type ?? ''), value: String(b.value ?? ''), suggestOnly: b.role === 'suggest' }) });
      const m = op.match(/^(remove|role):(\d+)(?::(add|suggest))?$/);
      if (!m) return back(c, here, { err: 'That source no longer exists.' });
      if (m[1] === 'remove') return back(c, here, { ok: removeSource(app, id, Number(m[2])) });
      return back(c, here, { ok: setSourceRole(app, id, Number(m[2]), m[3] === 'suggest' ? 'suggest' : 'add') });
    } catch (e) {
      if (e instanceof SettingsError) return back(c, here, { err: e.message });
      throw e;
    }
  });

  web.post('/collections/:id/delete', async (c) => {
    const id = Number(c.req.param('id'));
    if (!loadDefinition(app.db, id)) return c.notFound();
    try {
      return back(c, '/collections', { ok: deleteCollection(app, id) });
    } catch (e) {
      if (e instanceof SettingsError) return back(c, `/collections/${id}`, { err: e.message });
      throw e;
    }
  });

  // ── missing (Phase 2): what collections list that you don't own; send to Radarr/Sonarr ──
  // ── Library health (ADR-041) ──
  web.get('/health', (c) => page(c, 'Library health', 'inbox', <HealthPage m={healthDashboard(app)} a={artworkSummary(app)} tz={app.settings().timezone} csrf={userOf(c).csrf} inbox={inboxCounts(app)} />));
  web.post('/health/dismiss', async (c) => {
    const b = await c.req.parseBody();
    const kind = HEALTH_KINDS.includes(String(b.kind) as HealthKind) ? (String(b.kind) as HealthKind) : 'runtime';
    const ok = dismissFinding(app, String(b.jfId ?? ''), kind, userOf(c).name);
    return back(c, '/health', ok ? { ok: 'Marked as fine. It comes back if the file changes.' } : { err: 'That finding is gone.' });
  });
  // Several at once: the ticked findings, or every open finding for one show's episodes.
  web.post('/health/dismiss-many', async (c) => {
    const b = await c.req.parseBody({ all: true });
    const list = ([] as unknown[]).concat(b.sel ?? []).map(String);
    const findings = list.map((v) => v.split('|')).filter((x) => x.length === 2 && HEALTH_KINDS.includes(x[1] as HealthKind)).map(([jfId, kind]) => ({ jfId: jfId!, kind: kind as HealthKind }));
    const seriesIds = b.what === 'series' && b.series ? [String(b.series)] : [];
    if (b.what !== 'series' && !findings.length) return back(c, '/health#needs-h', { err: 'Tick the findings to mark fine first.' });
    const n = dismissFindings(app, b.what === 'series' ? { seriesIds } : { findings }, userOf(c).name);
    return back(c, '/health#needs-h', n ? { ok: `${n} ${n === 1 ? 'finding' : 'findings'} marked as fine. Each comes back if its file changes.` } : { err: 'Those findings are gone.' });
  });
  // Reset artwork from TMDb (ADR-043): the one finding asked for, or the ones ticked. Never the whole library.
  web.post('/health/artwork/reset', async (c) => {
    const b = await c.req.parseBody({ all: true });
    const ids = b.one ? [String(b.one)] : [...new Set(([] as unknown[]).concat(b.sel ?? []).map((v) => String(v).split('|')[0]!).filter(Boolean))];
    if (!ids.length) return back(c, '/health#needs-h', { err: 'Tick the findings whose artwork to reset first.' });
    if (ids.length > ARTWORK_RESETS_PER_REQUEST) return back(c, '/health#needs-h', { err: `Up to ${ARTWORK_RESETS_PER_REQUEST} at a time, please.` });
    const types = ([] as unknown[]).concat(b.also ?? []).map(String).filter((t): t is ImageType => (IMAGE_TYPES as readonly string[]).includes(t) && t !== 'Primary');
    const results = [];
    for (const id of ids) {
      try {
        results.push(await resetArtwork(app, id, { by: userOf(c).name, types }));
      } catch (e) {
        results.push({ ok: false, message: `${id}: ${(e as Error).message}` });
      }
    }
    const done = results.filter((r) => r.ok), failed = results.filter((r) => !r.ok);
    const msg = [done.length === 1 ? done[0]!.message : done.length ? `${done.length} reset from TMDb.` : '', failed.map((r) => r.message).join(' ')].filter(Boolean).join(' ');
    return back(c, done.length ? '/health#fixed-h' : '/health#needs-h', done.length ? { ok: msg } : { err: msg });
  });
  web.post('/health/artwork/undo/:id', async (c) => {
    const r = await undoArtworkFix(app, Number(c.req.param('id')), userOf(c).name).catch((e: Error) => ({ ok: false, message: e.message }));
    return back(c, '/health#fixed-h', r.ok ? { ok: r.message } : { err: r.message });
  });
  // Thumbnails, through the app: the browser never needs Jellyfin's key or a request to another site.
  const imageReply = (img: { bytes: Uint8Array; contentType?: string; type?: string } | null) =>
    img ? new Response(Buffer.from(img.bytes), { headers: { 'content-type': img.contentType ?? img.type ?? 'image/jpeg', 'cache-control': 'private, max-age=86400' } }) : new Response('Not found', { status: 404 });
  web.get('/health/img/jf/:id', async (c) => {
    const jf = app.jellyfin();
    if (!jf) return c.notFound();
    return imageReply(await jf.primaryThumb(c.req.param('id'), 180).catch(() => null));
  });
  web.get('/health/img/tmdb/:file', async (c) => {
    const file = c.req.param('file');
    if (!/^[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$/.test(file)) return c.notFound();
    const res = await app.fetch(`https://image.tmdb.org/t/p/w154/${file}`).catch(() => null);
    if (!res?.ok) return c.notFound();
    return imageReply({ bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get('content-type') ?? 'image/jpeg' });
  });
  web.get('/health/img/backup/:id', (c) => imageReply(backupPoster(app, Number(c.req.param('id')))));
  web.get('/health/img/frame/:id', async (c) => imageReply(await middleFrame(app, c.req.param('id')).catch(() => null)));
  web.post('/health/reopen', async (c) => {
    const b = await c.req.parseBody();
    const ok = reopenFinding(app, String(b.jfId ?? ''), HEALTH_KINDS.includes(String(b.kind) as HealthKind) ? (String(b.kind) as HealthKind) : 'runtime');
    return back(c, '/health', ok ? { ok: 'Back in Needs review.' } : { err: 'That finding is gone.' });
  });

  web.get('/missing', async (c) => {
    const tab = c.req.query('tab') === 'shows' ? 'shows' : 'movies';
    const m = await missingModel(app, tab, Number(c.req.query('def')) || null, Number(c.req.query('page')) || 1);
    return page(c, 'Missing titles', 'inbox', <Missing m={m} csrf={userOf(c).csrf} inbox={inboxCounts(app)} />);
  });

  web.post('/missing/send', async (c) => {
    const b = await c.req.parseBody({ all: true });
    const tab = b.tab === 'shows' ? 'shows' : 'movies';
    const which = tab === 'movies' ? 'radarr' : 'sonarr';
    const def = loadDefinition(app.db, Number(b.def));
    const here = `/missing?tab=${tab}${def ? `&def=${def.id}` : ''}`;
    if (!def) return back(c, here, { err: 'Choose a collection first.' });
    try {
      const r = await sendMissing(app, { defId: def.id, tab, keys: ([] as unknown[]).concat(b.ids ?? []).map(String), sendNow: b.mode !== 'review', options: parseArrOptions(b, which), by: userOf(c).name });
      return back(c, here, r.ok ? { ok: r.message } : { err: r.message });
    } catch (e) {
      if (e instanceof SettingsError) return back(c, here, { err: e.message });
      throw e;
    }
  });

  web.post('/missing/monitor', async (c) => {
    const b = await c.req.parseBody();
    const def = loadDefinition(app.db, Number(b.def));
    const here = `/missing?tab=movies${def ? `&def=${def.id}` : ''}`;
    if (!def) return back(c, here, { err: 'That collection no longer exists.' });
    try {
      const r = await monitorInRadarr(app, { defId: def.id, radarrCollectionId: Number(b.radarrCollectionId), title: String(b.title ?? ''), by: userOf(c).name });
      return back(c, here, r.ok ? { ok: r.message } : { err: r.message });
    } catch (e) {
      if (e instanceof SettingsError) return back(c, here, { err: e.message });
      throw e;
    }
  });

  // ── review ──
  web.get('/review', (c) => {
    const tab = (['pending', 'snoozed', 'dismissed'].includes(c.req.query('tab') ?? '') ? c.req.query('tab') : 'pending') as ReviewTab;
    const def = Number(c.req.query('def')) || undefined;
    const s = app.settings();
    const m = reviewModel(app, tab, def);
    const filtered = def ? m.defs.find((d) => d.id === def) : undefined;
    const st = {
      dryRun: s.dryRun, running: isRunning(), hasRun: Boolean(app.db.select({ id: run.id }).from(run).limit(1).get()),
      nextRun: whenNext(nextRunAt(app), s.timezone), leadDays: s.leadDays, filter: filtered ? { id: filtered.id, name: filtered.name } : null,
    };
    return page(c, 'Inbox', 'inbox', <Review m={m} csrf={userOf(c).csrf} tz={s.timezone} inbox={inboxCounts(app)} st={st} />);
  });

  web.post('/review', async (c) => {
    const b = await c.req.parseBody({ all: true });
    const tab = String(b.tab ?? 'pending');
    let verdict = String(b.verdict ?? '');
    let ids = ([] as unknown[]).concat(b.ids ?? []).map(Number).filter(Number.isFinite);
    if (b.only) {
      const [v, id] = String(b.only).split(':');
      verdict = v ?? '';
      ids = [Number(id)];
    }
    // "Approve all" on a collection's heading: every change of its that's waiting.
    const group = String(b.group ?? '').match(/^approve:(\d+)$/);
    if (group) {
      verdict = 'approve';
      ids = app.db.select({ id: action.id }).from(action).where(and(eq(action.definitionId, Number(group[1])), eq(action.status, 'proposed'))).all().map((r) => r.id);
    }
    const here = `/review?tab=${tab}${Number(b.def) ? `&def=${Number(b.def)}` : ''}`;
    if (!ids.length) return back(c, here, { err: 'Tick at least one change first.' });
    const by = userOf(c).name;
    if (verdict === 'forget') {
      for (const a of app.db.select().from(action).where(inArray(action.id, ids)).all()) forgetDecision(app.db, a.fingerprint);
      return back(c, here, { ok: 'Brought back. The next run lists it again.' });
    }
    if (verdict === 'approve' || verdict === 'dismiss' || verdict === 'snooze') {
      const choice = String(b.snooze ?? app.settings().defaultSnooze);
      const r = await reviewVerdict(app, ids, verdict, by, { snooze: (['7d', '30d', 'window'].includes(choice) ? choice : 'window') as SnoozeFor });
      return back(c, here, r.ok ? { ok: r.message } : { err: r.message });
    }
    return back(c, here, { err: 'Unknown action.' });
  });

  // ── activity ──
  web.get('/activity', (c) => page(c, 'History', 'history', <Activity m={activityModel(app)} tz={app.settings().timezone} csrf={userOf(c).csrf} />));
  web.post('/activity/:id/undo', async (c) => {
    try {
      const msg = await undoAction(app, Number(c.req.param('id')), userOf(c).name);
      return back(c, '/activity', { ok: msg });
    } catch (e) {
      return back(c, '/activity', { err: (e as Error).message });
    }
  });

  // ── settings ──
  const maskedSecrets = () => ({ ...Object.fromEntries(CONNECTIONS.map((x) => [x.key, x.secret ? app.secrets.masked(x.secret) : { set: false, last4: null }])), imdbSnapshot: app.secrets.masked('imdb.snapshotToken') });
  web.get('/settings', (c) => page(c, 'Settings', 'settings', <SettingsConnections s={app.settings()} csrf={userOf(c).csrf} masked={maskedSecrets()} />));
  web.get('/settings/libraries', async (c) => {
    // Before the first run the library list is empty; read it from Jellyfin so it can be chosen.
    const hasLibs = librariesModel(app).some((l) => l.collectionType === 'movies');
    const libError = hasLibs ? null : await refreshLibraries();
    return page(c, 'Settings', 'settings', <SettingsLibraries s={app.settings()} csrf={userOf(c).csrf} libraries={librariesModel(app)} libError={libError} />);
  });
  web.get('/settings/approvals', (c) => page(c, 'Settings', 'settings', <SettingsApprovals s={app.settings()} csrf={userOf(c).csrf} />));
  web.get('/settings/schedule', (c) => {
    const runs = nextRuns(app);
    const schedules = app.db.select().from(jobSchedule).all().map((j) => ({ ...j, next: runs.find((r) => r.job === j.job)?.next ?? null }));
    return page(c, 'Settings', 'settings', <SettingsSchedule s={app.settings()} csrf={userOf(c).csrf} schedules={schedules} />);
  });
  web.get('/settings/extras', (c) => page(c, 'Settings', 'settings', <SettingsExtras s={app.settings()} csrf={userOf(c).csrf} libraries={librariesModel(app)} arr={{ radarr: Boolean(app.radarr()), sonarr: Boolean(app.sonarr()) }} />));
  web.get('/settings/advanced', (c) => {
    const sessionId = userOf(c).sessionId;
    const reveal = reveals.get(sessionId);
    reveals.delete(sessionId); // shown once
    const claude = { tokens: listTokens(app.db), reveal: reveal && reveal.expires > Date.now() ? reveal : null, endpoint: mcpEndpoint(c) };
    return page(c, 'Settings', 'settings', <SettingsAdvanced s={app.settings()} csrf={userOf(c).csrf} masked={maskedSecrets()} media={mediaStatus(app)} claude={claude} />);
  });

  // ── Claude access (ADR-032): MCP access tokens. A new token waits here for one page view, then only its hash remains. ──
  const reveals = new Map<string, Reveal & { expires: number }>();
  const mcpEndpoint = (c: Context) => `${isHttps(c, app.config.trustProxy) ? 'https' : 'http'}://${(app.config.trustProxy && c.req.header('x-forwarded-host')) || c.req.header('host') || new URL(c.req.url).host}/mcp`;
  web.post('/settings/claude', async (c) => {
    const b = await c.req.parseBody();
    const name = String(b.name ?? '').trim().slice(0, 60);
    const scope: TokenScope = b.scope === 'read' || b.scope === 'full' ? b.scope : 'review';
    if (!name) return back(c, '/settings/advanced#claude', { err: 'Give the token a name, such as where it’s used.' });
    const { token } = createToken(app.db, name, scope, userOf(c).name);
    reveals.set(userOf(c).sessionId, { name, token, scope, expires: Date.now() + 10 * 60_000 });
    log.info(`Claude access token “${name}” (${SCOPE_LABEL[scope]}) created by ${userOf(c).name}`);
    return back(c, '/settings/advanced#claude', { ok: `Token “${name}” created. Copy it below: it isn’t shown again.` });
  });
  web.post('/settings/claude/:id/revoke', (c) => {
    const id = Number(c.req.param('id'));
    const row = listTokens(app.db).find((t) => t.id === id);
    if (!row || !revokeToken(app.db, id)) return back(c, '/settings/advanced#claude', { err: 'That token no longer exists.' });
    log.info(`Claude access token “${row.name}” revoked by ${userOf(c).name}`);
    return back(c, '/settings/advanced#claude', { ok: `Revoked “${row.name}”. Claude can’t use it any more.` });
  });

  web.post('/settings/connections', async (c) => {
    const b = await c.req.parseBody();
    const conn = { ...app.settings().connections };
    for (const x of CONNECTIONS) {
      if (x.urlField) {
        const url = String(b[`url:${x.key}`] ?? '').trim().replace(/\/$/, '');
        if (url && !/^https?:\/\/\S+$/.test(url)) return back(c, '/settings', { err: `${x.name}: enter an address starting with http:// or https://` });
        conn[x.urlField] = url;
      }
      const secret = String(b[`secret:${x.key}`] ?? '').trim();
      if (secret && x.secret) app.secrets.set(x.secret, secret);
    }
    app.updateSettings({ connections: conn });
    await refreshLibraries();
    return back(c, '/settings', { ok: 'Connections saved.' });
  });

  web.post('/settings/test/:svc', async (c) => {
    const svc = c.req.param('svc');
    const b = await c.req.parseBody();
    const def = CONNECTIONS.find((x) => x.key === svc);
    if (!def) return c.html(<span class="faint">Unknown service</span>);
    const url = String(b[`url:${svc}`] ?? '').trim().replace(/\/$/, '') || (def.urlField ? app.settings().connections[def.urlField] : '');
    const key = String(b[`secret:${svc}`] ?? '').trim() || (def.secret ? app.secrets.get(def.secret) ?? '' : '');
    const ok = (text: string) => c.html(<><span class="dot ok"></span> <b>{text}</b></>);
    const bad = (text: string) => c.html(<span style="color:var(--red)"><span class="dot err"></span> {text}</span>);
    try {
      switch (svc) {
        case 'jellyfin': {
          if (!url || !key) return bad('Address and key needed');
          const jf = new JellyfinClient({ baseUrl: url, apiKey: key, fetch: app.fetch });
          const info = await jf.systemInfo();
          const libs = (await jf.virtualFolders()).filter((l) => l.CollectionType === 'movies' || l.CollectionType === 'tvshows');
          const v = versionSupport(info.Version ?? undefined);
          if (v.level === 'unsupported') return bad(v.note);
          return ok(`${info.Version} · ${libs.length} libraries in scope${v.level === 'verified' ? '' : ` · ${v.level === 'checked' ? 'API-checked version' : 'untested version'}`}`);
        }
        case 'tmdb':
          if (!key) return bad('Key needed');
          await new TmdbClient(app.db, key, app.fetch).ping();
          return ok('OK');
        case 'mdblist': {
          const rows = await requestJson<unknown[]>(app.fetch, 'https://mdblist.com/lists/k0meta/christmas-extravaganza/json');
          return ok(`Public lists OK (${rows.length} on Christmas)`);
        }
        case 'plex': {
          if (!url || !key) return bad('Address and token needed');
          const r = await requestJson<{ MediaContainer?: { version?: string } }>(app.fetch, `${url}/identity`, { headers: { accept: 'application/json', 'X-Plex-Token': key } });
          return ok(`Plex ${r.MediaContainer?.version ?? ''}`);
        }
        case 'radarr':
        case 'sonarr': {
          if (!url || !key) return bad('Address and key needed');
          const r = await requestJson<{ version?: string }>(app.fetch, `${url}/api/v3/system/status`, { headers: { 'X-Api-Key': key } });
          return ok(`${svc === 'radarr' ? 'Radarr' : 'Sonarr'} ${r.version ?? ''}`);
        }
      }
      return bad('Unknown service');
    } catch (e) {
      const m = (e as Error).message;
      return bad(/401|403/.test(m) ? `${m}: key rejected` : m);
    }
  });

  // Settings forms go through settings-actions.ts, which the MCP endpoint uses too (ADR-033).
  const save = (c: Context, anchor: string, patch: SettingsPatch, ok: string) => {
    try {
      const r = applySettings(app, patch);
      if (r.timezoneChanged) restartScheduler();
      return back(c, anchor, { ok });
    } catch (e) {
      if (e instanceof SettingsError) return back(c, anchor, { err: e.message });
      throw e;
    }
  };

  web.post('/settings/approvals', async (c) => {
    const b = await c.req.parseBody();
    const modes: Partial<Record<ModeKey, Mode>> = {};
    for (const [k, v] of Object.entries(b)) {
      if (k.startsWith('mode:') && (MODE_KEYS as readonly string[]).includes(k.slice(5)) && MODES.has(String(v))) modes[k.slice(5) as ModeKey] = String(v) as Mode;
    }
    const snooze = ['window', '7d', '30d'].includes(String(b.defaultSnooze)) ? (String(b.defaultSnooze) as Settings['defaultSnooze']) : undefined;
    return save(c, '/settings/approvals', {
      dryRun: b.dryRun === undefined ? undefined : b.dryRun === '1', modes,
      leadDays: b.leadDays === undefined ? undefined : Number(b.leadDays), arrCapPerRun: b.arrCapPerRun === undefined ? undefined : Number(b.arrCapPerRun),
      defaultSnooze: snooze, releasedOnly: b.arrCapPerRun === undefined ? undefined : b.releasedOnly === '1',
    }, 'Approvals saved.');
  });

  web.post('/settings/health', async (c) => {
    const b = await c.req.parseBody({ all: true });
    return save(c, '/settings/extras#health', { healthEnabled: b.healthEnabled === '1', healthAutoFixLibraryIds: ([] as unknown[]).concat(b.autoFixLib ?? []).map(String) }, 'Library health saved.');
  });

  // The IMDb queries your collections need, for the snapshot job (docs/IMDB-SNAPSHOT.md).
  web.get('/settings/imdb/queries.json', (c) => {
    const sources = app.db.select().from(definitionSource).all();
    const series = app.db.select({ imdb: libraryItem.imdb }).from(libraryItem).where(eq(libraryItem.kind, 'series')).all().map((r) => r.imdb).filter((x): x is string => Boolean(x));
    c.header('content-disposition', 'attachment; filename="queries.json"');
    return c.json(queriesFor(sources, series));
  });

  web.post('/settings/advanced', async (c) => {
    const b = await c.req.parseBody();
    const route = String(b.imdbRoute) as SettingsPatch['imdbRoute'];
    try {
      applySettings(app, { imdbRoute: route, snapshotUrl: String(b.snapshotUrl ?? ''), ...(b.mediaSent === '1' ? { mediaEnabled: b.mediaEnabled === '1', mediaDir: String(b.mediaDir ?? '') } : {}) });
    } catch (e) {
      if (e instanceof SettingsError) return back(c, '/settings/advanced', { err: e.message });
      throw e;
    }
    const token = String(b.snapshotToken ?? '').trim();
    if (token) app.secrets.set('imdb.snapshotToken', token);
    return back(c, '/settings/advanced', { ok: route === 'snapshot' ? 'Saved. The next run reads IMDb from the snapshot.' : 'Saved.' });
  });

  // Radarr/Sonarr defaults, read live from each app (lazy-loaded so Settings stays fast).
  web.get('/settings/arr', async (c) => {
    const s = app.settings();
    const parts = await Promise.all((['radarr', 'sonarr'] as const).map(async (which) => {
      const cl = which === 'radarr' ? app.radarr() : app.sonarr();
      const name = which === 'radarr' ? 'Radarr' : 'Sonarr';
      if (!cl) return <p class="muted">{name}: not connected. Add it under <a href="/settings">Connections</a> to choose how titles are sent to it.</p>;
      try {
        const [profiles, roots, tags] = await Promise.all([cl.qualityProfiles(), cl.rootFolders(), cl.tags()]);
        return (
          <form method="post" action="/settings/arr" class="form arr-defaults">
            <Csrf token={userOf(c).csrf} /><input type="hidden" name="which" value={which} />
            <h3>{name}</h3>
            <ArrOptionsFields which={which} values={s.arr[which]} choices={{ profiles, roots, tags }} idPrefix={`set-${which}`} />
            <div class="save-row"><button class="btn primary" type="submit">Save {name}</button></div>
          </form>
        );
      } catch (e) {
        return <p class="muted">{name}: couldn’t read its options ({(e as Error).message}).</p>;
      }
    }));
    return c.html(<>{parts}</>);
  });

  web.post('/settings/arr', async (c) => {
    const b = await c.req.parseBody({ all: true });
    const which = b.which === 'sonarr' ? 'sonarr' : 'radarr';
    saveArrDefaults(app, which, parseArrOptions(b, which));
    return back(c, '/settings/extras#arr', { ok: `${which === 'radarr' ? 'Radarr' : 'Sonarr'} saved.` });
  });

  // ── home-screen rows (Phase 3, ADR-025) ──
  // ── Poster overlays (ADR-039) ──
  web.get('/settings/overlays', async (c) => c.html(<OverlaysPanel m={await overlaysModel(app)} csrf={userOf(c).csrf} />));
  web.post('/settings/overlays', async (c) => {
    const b = await c.req.parseBody({ all: true });
    const overlays: { status: boolean; imdbTop250: boolean; skipLibraryIds?: string[] | null } = { status: b.status === '1', imdbTop250: b.imdbTop250 === '1' };
    if (b.libs === '1') {
      // Libraries left unticked get no overlays; the default (kids' libraries only) is kept while the choice matches it.
      const on = new Set(([] as unknown[]).concat(b.lib ?? []).map(String));
      const listed = overlayLibraries(app).libraries;
      const skip = listed.filter((l) => !on.has(l.id)).map((l) => l.id);
      const kids = kidsLibraries(app);
      const isDefault = listed.every((l) => kids.has(l.id) === skip.includes(l.id));
      overlays.skipLibraryIds = isDefault ? null : skip;
    }
    return save(c, '/settings/extras#overlays', { overlays }, 'Saved. Use Apply now to change posters straight away.');
  });
  web.post('/settings/overlays/apply', (c) => {
    const r = startOverlayRun(app, 'apply');
    return back(c, r.ok ? '/' : '/settings/extras#overlays', r.ok ? { ok: 'Updating poster overlays: follow the run here.' } : { err: r.error });
  });
  web.post('/settings/overlays/remove', (c) => {
    const r = startOverlayRun(app, 'remove');
    return back(c, r.ok ? '/' : '/settings/extras#overlays', r.ok ? { ok: 'Putting the original posters back: follow the run here.' } : { err: r.error });
  });
  web.get('/settings/overlays/preview/:id', async (c) => {
    try {
      const img = await overlayPreview(app, c.req.param('id'));
      if (!img) return c.text('No overlays for this title', 404);
      return c.body(Buffer.from(img), 200, { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=60' });
    } catch (e) {
      return c.text(`Preview failed: ${(e as Error).message}`, 502);
    }
  });

  web.get('/settings/home', async (c) => c.html(<HomeRowsPanel st={await homeStatus(app)} s={app.settings()} csrf={userOf(c).csrf} />));

  web.post('/settings/home', async (c) => {
    const b = await c.req.parseBody();
    const enabled = b.enabled === '1';
    const viewMode = (['Portrait', 'Landscape', 'Square', 'Small'] as const).find((v) => v === b.viewMode) ?? 'Portrait';
    return save(c, '/settings/extras#home', { homeRows: { enabled, orderIndex: Number(b.orderIndex ?? 2), viewMode } }, enabled ? 'Saved. Rows update on the next run, or press “Update rows in Jellyfin now”.' : 'Saved. Rows stay as they are in Jellyfin until you turn this back on.');
  });

  web.post('/settings/home/sync', async (c) => {
    if (!app.settings().homeRows.enabled) return back(c, '/settings/extras#home', { err: 'Turn home-screen rows on first.' });
    try {
      const r = await syncHomeRows(app, { dryRun: false }); // an explicit press, so dry run doesn't hold it back
      if (r.problem) return back(c, '/settings/extras#home', { err: r.problem });
      return back(c, '/settings/extras#home', { ok: r.changed ? `Rows updated. Showing: ${r.showing.join(', ') || 'none right now'}.` : 'Rows were already up to date.' });
    } catch (e) {
      return back(c, '/settings/extras#home', { err: `Couldn’t update the rows: ${(e as Error).message}` });
    }
  });

  web.post('/settings/libraries', async (c) => {
    const b = await c.req.parseBody({ all: true });
    const ids = (field: string) => ([] as unknown[]).concat(b[field] ?? []).map(String);
    const to = localPath(b.next, '').startsWith('/start') ? String(b.next) : '/settings/libraries'; // only ever back into the guide
    // Only a kind of library Jellyfin has can be chosen: with none to tick (or Jellyfin unreadable), that kind is left as it is.
    const has = (type: string) => librariesModel(app).some((l) => l.collectionType === type);
    try {
      const r = applySettings(app, {
        ...(has('movies') ? { movieLibraryIds: ids('movieLibraryIds') } : {}),
        ...(has('tvshows') ? { showLibraryIds: ids('showLibraryIds') } : {}),
        // The Settings page saves the region with the libraries; the guide sends the libraries alone.
        ...(b.regionForm === '1' ? { timezone: String(b.timezone ?? ''), streamingRegion: String(b.streamingRegion ?? '') } : {}),
      });
      if (r.timezoneChanged) restartScheduler();
    } catch (e) {
      // In the guide, an error stays on the libraries step rather than moving on.
      if (e instanceof SettingsError) return back(c, to.startsWith('/start') ? '/start?step=1' : to, { err: e.message });
      throw e;
    }
    markDone('libraries');
    return to.startsWith('/start') ? c.redirect(to) : back(c, to, { ok: 'Saved.' });
  });

  web.post('/settings/schedules', async (c) => {
    const b = await c.req.parseBody();
    const jobs = app.db.select().from(jobSchedule).all();
    for (const j of jobs) {
      const cron = String(b[`cron:${j.job}`] ?? j.cron).trim();
      try {
        new Cron(cron, { paused: true });
      } catch {
        return back(c, '/settings/schedule', { err: `“${cron}” isn’t a schedule the app can read (${j.job}). Nothing was saved.` }); // nothing saved
      }
    }
    for (const j of jobs) setSchedule(app, j.job, { cron: String(b[`cron:${j.job}`] ?? j.cron), enabled: b[`on:${j.job}`] === '1' });
    if (b.neighboursForm === '1') {
      const neighbours = String(b.neighbours ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
        const m = l.match(/^(.*?)\s+(\d{1,2}:\d{2})$/);
        return m ? { name: m[1]!.trim(), time: m[2]! } : { name: l, time: '' };
      });
      applySettings(app, { neighbours });
    }
    restartScheduler();
    return back(c, '/settings/schedule', { ok: 'Schedule saved.' });
  });

  // ── adoption ──
  web.get('/adoption', async (c) => {
    try {
      return page(c, 'Already in Jellyfin', 'collections', <Adoption items={await adoptionCandidates(app, { verify: true })} csrf={userOf(c).csrf} />);
    } catch (e) {
      return page(c, 'Already in Jellyfin', 'collections', <Adoption items={[]} csrf={userOf(c).csrf} error={`Couldn’t read Jellyfin’s collections: ${(e as Error).message}`} />);
    }
  });
  web.post('/adoption/adopt', async (c) => {
    const b = await c.req.parseBody();
    try {
      await adopt(app, Number(b.definitionId), String(b.boxsetId), userOf(c).name);
      return back(c, '/adoption', { ok: 'Taken over. The next run works out what to change in it, and asks you first.' });
    } catch (e) {
      return back(c, '/adoption', { err: (e as Error).message });
    }
  });
  web.post('/adoption/adopt-all', async (c) => {
    try {
      const r = await adoptSuggested(app, userOf(c).name);
      return back(c, '/adoption', r.failed.length ? { err: `Took over ${r.adopted}. Failed: ${r.failed.join('; ')}` } : { ok: `Took over ${r.adopted}. The next run works out what to change in them, and asks you first.` });
    } catch (e) {
      return back(c, '/adoption', { err: (e as Error).message });
    }
  });
  web.post('/adoption/delete', async (c) => {
    const b = await c.req.parseBody();
    try {
      await deleteUnmanaged(app, String(b.boxsetId), userOf(c).name);
      return back(c, '/adoption', { ok: 'Deleted from Jellyfin. Its titles are still in your library.' });
    } catch (e) {
      return back(c, '/adoption', { err: (e as Error).message });
    }
  });

  web.notFound((c) => c.text('Not found', 404));
  web.onError((e, c) => {
    log.error(`Request failed: ${e.message}`);
    return c.text('Something went wrong. The details are in the server log.', 500);
  });
  return web;
}
