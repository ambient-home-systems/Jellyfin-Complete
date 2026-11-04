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
import { action, definition, definitionMode, definitionSource, membership, pin, jobSchedule, sourceResult, libraryItem, managedCollection, type ActionType, type WindowDef } from '../db/schema.js';
import { parseSourceInput, type Target } from '../domain/source-input.js';
import { queriesFor } from '../imdb/queries.js';
import { JellyfinClient } from '../clients/jellyfin/index.js';
import { TmdbClient } from '../clients/tmdb.js';
import { requestJson } from '../clients/http.js';
import { createSession, endSession, requireAuth, userOf } from './auth.js';
import { Layout, Csrf, type NavKey } from './ui.js';
import { AttemptLimiter, clientIp, isHttps, minutes, sameCode } from './security.js';
import { shellModel, dashboardModel, collectionsModel, reviewModel, activityModel, librariesModel, type ReviewTab } from './model.js';
import { Dashboard } from './pages/dashboard.js';
import { RunProgress } from './pages/run-progress.js';
import { CollectionsList, CollectionEditor, NewCollection, Preview, ParityPanel, type PreviewItem } from './pages/collections.js';
import { parity } from '../domain/parity.js';
import { cachedPlan } from './plan-cache.js';
import { cached } from '../cache.js';
import { Missing, ArrOptionsFields, parseArrOptions } from './pages/missing.js';
import { missingModel, missingFor } from './missing-model.js';
import { executeArrDue, resolveTerm, forgetArrState } from '../pipeline/arr.js';
import { fingerprint } from '../pipeline/planner.js';
import { definitionArr, run } from '../db/schema.js';
import { homeStatus, syncHomeRows } from '../homescreen/index.js';
import { HomeRowsPanel } from './pages/home-rows.js';
import { Start } from './pages/start.js';
import { versionSupport } from '../clients/jellyfin/compat.js';
import { familyOf, type PresetFamily } from '../presets/index.js';
import type { OnboardingStep } from '../settings.js';
import { Review } from './pages/review.js';
import { Activity } from './pages/activity.js';
import { SettingsPage, CONNECTIONS } from './pages/settings.js';
import { Login, Setup } from './pages/auth.js';
import { Adoption } from './pages/adoption.js';
import { runPipeline, currentRun, isRunning, applyNow } from '../pipeline/run.js';
import { decide, forgetDecision } from '../pipeline/store.js';
import { undoAction } from '../pipeline/undo.js';
import { adoptionCandidates, adopt, deleteUnmanaged } from '../pipeline/adoption.js';
import { loadDefinition, loadDefinitions } from '../domain/definitions.js';
import { members as computeMembers } from '../pipeline/planner.js';
import { LibraryIndex, type LibRow } from '../domain/matching.js';
import { syncLibraries } from '../library/indexer.js';
import { sourceKey, sourceLabel, resolveSource, type ResolvedSource } from '../sources/index.js';
import type { LoadedDefinition } from '../domain/definitions.js';
import { getPlanSummary } from '../pipeline/summary.js';
import { localDay, localMidnight, opensWithin, transitions } from '../domain/windows.js';
import { startScheduler, nextRuns, lastHeartbeat } from '../jobs/scheduler.js';
import { log } from '../log.js';
import type { Mode, Settings } from '../settings.js';

const MODES = new Set(['off', 'review', 'auto']);
const MMDD = /^(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])$/;

/** Schedule fields → window. "Always on" is no window; otherwise both dates are required. */
function scheduleFrom(b: Record<string, unknown>): WindowDef | null | { error: string } {
  if (b.schedule === 'always') return null;
  const from = String(b.from ?? '').trim();
  const to = String(b.to ?? '').trim();
  if (!MMDD.test(from) || !MMDD.test(to)) return { error: 'Dates must be MM/DD, for example 12/01.' };
  return { type: 'range', from, to };
}

const slugify = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'collection';

export function createWeb(app: AppContext, opts: { scheduler?: boolean } = {}): Hono {
  const web = new Hono();

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

  web.get('/', (c) => {
    const ob = app.settings().onboarding;
    const banner = ob.finished ? undefined : <div class="banner"><b>Finish setting up.</b> A few choices on Getting started, then a first dry run.<a class="btn sm" href="/start">Getting started</a></div>;
    return page(c, 'Dashboard', 'dashboard', <Dashboard m={dashboardModel(app)} csrf={userOf(c).csrf} />, banner);
  });

  // ── first-run guide (Phase 4) ──
  const markDone = (step: OnboardingStep) => {
    const ob = app.settings().onboarding;
    if (!ob.done.includes(step)) app.updateSettings({ onboarding: { ...ob, done: [...ob.done, step] } });
  };
  web.get('/start', (c) => {
    const s = app.settings();
    const defs = loadDefinitions(app.db);
    const NOTES: Record<PresetFamily, string> = {
      seasonal: 'Kometa’s 19 holiday and awareness-month film collections. Each appears only during its dates.',
      holiday_episodes: 'Christmas, Halloween and Thanksgiving episodes from your shows, on the same dates.',
      universe: 'Kometa’s 17 film universes (Marvel, Star Wars, Middle Earth…), always on.',
      show_franchise: 'Kometa’s 27 TV franchises (Star Trek, NCIS, One Chicago…), always on.',
    };
    const families = (['seasonal', 'holiday_episodes', 'universe', 'show_franchise'] as const).map((family) => {
      const mine = defs.filter((d) => familyOf(d.presetKey) === family);
      return { family, on: mine.filter((d) => d.enabled).length, total: mine.length, note: NOTES[family] };
    });
    const hasRun = Boolean(app.db.select({ id: run.id }).from(run).limit(1).get());
    return page(c, 'Getting started', 'dashboard', <Start m={{ s, libraries: librariesModel(app), tmdbSet: Boolean(app.secrets.get('tmdb.apiKey')), families, hasRun, csrf: userOf(c).csrf }} />);
  });
  web.post('/start/timezone', async (c) => {
    const tz = String((await c.req.parseBody()).timezone ?? '').trim();
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
    } catch {
      return back(c, '/start#st-2', { err: `Unknown timezone “${tz}”.` });
    }
    app.updateSettings({ timezone: tz });
    markDone('timezone');
    return back(c, '/start#st-3', { ok: `Timezone set to ${tz}.` });
  });
  web.post('/start/tmdb', async (c) => {
    const key = String((await c.req.parseBody()).key ?? '').trim();
    if (!key) return back(c, '/start#st-4', { ok: app.secrets.get('tmdb.apiKey') ? 'TMDb key kept.' : 'Skipped. You can add it later in Settings → Connections.' });
    try {
      await new TmdbClient(app.db, key, app.fetch).ping();
    } catch (e) {
      return back(c, '/start#st-3', { err: `TMDb didn’t accept that key: ${(e as Error).message}` });
    }
    app.secrets.set('tmdb.apiKey', key);
    return back(c, '/start#st-4', { ok: 'TMDb key saved.' });
  });
  web.post('/start/families', async (c) => {
    const b = await c.req.parseBody({ all: true });
    const on = new Set(([] as unknown[]).concat(b.families ?? []).map(String));
    for (const d of loadDefinitions(app.db)) {
      const f = familyOf(d.presetKey);
      if (f === 'custom') continue;
      const want = on.has(f);
      if (want !== d.enabled) app.db.update(definition).set({ enabled: want, updatedAt: Date.now() }).where(eq(definition.id, d.id)).run();
    }
    markDone('families');
    return back(c, '/start#st-5', { ok: 'Saved.' });
  });
  web.post('/start/finish', (c) => {
    app.updateSettings({ onboarding: { ...app.settings().onboarding, finished: true } });
    return c.redirect('/');
  });

  web.post('/runs', (c) => {
    if (!isRunning()) {
      runPipeline(app, { job: 'manual', trigger: 'manual', index: true }).catch((e) => log.error(`Manual run failed: ${(e as Error).message}`));
    }
    if (c.req.header('hx-request')) return c.html(<RunProgress p={currentRun()} csrf={userOf(c).csrf} />);
    return c.redirect('/');
  });
  web.get('/runs/progress', (c) => c.html(<RunProgress p={currentRun()} csrf={userOf(c).csrf} />));

  // ── collections ──
  web.get('/collections', (c) => page(c, 'Collections', 'collections', <CollectionsList rows={collectionsModel(app)} tz={app.settings().timezone} csrf={userOf(c).csrf} />));

  web.post('/collections/:id/enabled', async (c) => {
    const id = Number(c.req.param('id'));
    const def = loadDefinition(app.db, id);
    if (!def) return c.notFound();
    const on = (await c.req.parseBody()).enabled === '1';
    app.db.update(definition).set({ enabled: on, updatedAt: Date.now() }).where(eq(definition.id, id)).run();
    return back(c, '/collections', { ok: on ? `${def.name} is on. The next run fetches its sources and plans it.` : `${def.name} is off. The next run removes its box set, if it has one.` });
  });

  web.get('/collections/new', (c) => page(c, 'New collection', 'collections', <NewCollection csrf={userOf(c).csrf} />));

  web.post('/collections/new', async (c) => {
    const b = await c.req.parseBody();
    const values = Object.fromEntries(['name', 'target', 'schedule', 'from', 'to', 'type', 'value'].map((k) => [k, String(b[k] ?? '')]));
    const again = (error: string) => c.html(
      <Layout title="New collection" nav="collections" user={{ name: userOf(c).name, csrf: userOf(c).csrf }} {...shellModel(app)} flash={null}>
        <NewCollection csrf={userOf(c).csrf} error={error} values={values} />
      </Layout>, 400);
    const name = values.name!.trim();
    if (!name || name.length > 200) return again('Name is required (up to 200 characters).');
    const target: Target = values.target === 'shows' ? 'shows' : values.target === 'episodes' ? 'episodes' : 'movies';
    const window = scheduleFrom(b);
    if (window && 'error' in window) return again(window.error);
    const spec = parseSourceInput(values.type!, values.value!, target);
    if (typeof spec === 'string') return again(spec);
    let slug = `custom-${slugify(name)}`;
    for (let n = 2; app.db.select({ id: definition.id }).from(definition).where(eq(definition.slug, slug)).get(); n++) slug = `custom-${slugify(name)}-${n}`;
    const now = Date.now();
    const row = app.db.insert(definition).values({
      slug, name, target, enabled: true, presetKey: null, presetRev: null, window, filters: {}, libraryIds: null, minItems: 1,
      syncMode: 'sync', sortBy: 'title.asc', sortTitle: null, overview: null, poster: { kind: 'none' }, visibility: 'delete', createdAt: now, updatedAt: now,
    }).returning({ id: definition.id }).get();
    // Title matches are only ever suggestions (ADR-018).
    app.db.insert(definitionSource).values({ definitionId: row.id, type: spec.type, config: spec.config, role: spec.type === 'jellyfin_episode_title' ? 'suggest' : 'add', position: 0 }).run();
    return back(c, `/collections/${row.id}`, { ok: 'Collection created. Run now from the Dashboard to fetch its sources and plan it.' });
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
    return page(c, def.name, 'collections', <CollectionEditor def={def} tz={app.settings().timezone} csrf={userOf(c).csrf} live={live} globalModes={app.settings().modes} sources={sources} arr={arr} />);
  });

  web.post('/collections/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const def = loadDefinition(app.db, id);
    if (!def) return c.notFound();
    const b = await c.req.parseBody();
    const name = String(b.name ?? '').trim();
    const minItems = Number(b.minItems ?? def.minItems);
    if (!name || name.length > 200) return back(c, `/collections/${id}`, { err: 'Name is required (up to 200 characters).' });
    if (!Number.isInteger(minItems) || minItems < 1 || minItems > 1000) return back(c, `/collections/${id}`, { err: 'Minimum items must be a whole number from 1 to 1000.' });
    let window = def.window;
    if (!def.window || def.window.type === 'range') {
      const w = scheduleFrom(b);
      if (w && 'error' in w) return back(c, `/collections/${id}`, { err: w.error });
      window = w;
    }
    app.db.update(definition).set({
      name, enabled: b.enabled === '1', overview: String(b.overview ?? '') || null, minItems, window,
      syncMode: b.syncMode === 'append' ? 'append' : 'sync', sortTitle: String(b.sortTitle ?? '') || null, updatedAt: Date.now(),
      visibility: b.visibility === 'tag_gate' ? 'tag_gate' : b.visibility === 'delete' ? 'delete' : def.visibility,
      homeRow: b.homeRowForm === '1' ? b.homeRow === '1' : def.homeRow,
    }).where(eq(definition.id, id)).run();
    if (b.arrForm === '1') {
      const addMissing = b.arrAddMissing === '1';
      app.db.insert(definitionArr).values({ definitionId: id, addMissing, options: {} })
        .onConflictDoUpdate({ target: definitionArr.definitionId, set: { addMissing } }).run();
    }
    for (const [k, v] of Object.entries(b)) {
      if (!k.startsWith('mode:')) continue;
      const actionType = k.slice(5) as ActionType;
      app.db.delete(definitionMode).where(and(eq(definitionMode.definitionId, id), eq(definitionMode.actionType, actionType))).run();
      if (MODES.has(String(v))) app.db.insert(definitionMode).values({ definitionId: id, actionType, mode: String(v) as Mode }).run();
      if (actionType === 'collection.create' && MODES.has(String(v))) {
        app.db.delete(definitionMode).where(and(eq(definitionMode.definitionId, id), eq(definitionMode.actionType, 'collection.delete'))).run();
        app.db.insert(definitionMode).values({ definitionId: id, actionType: 'collection.delete', mode: String(v) as Mode }).run();
      }
    }
    return back(c, `/collections/${id}`, { ok: 'Saved. The next run plans with these settings.' });
  });

  const cachedMembers = (def: LoadedDefinition) => cachedPlan(app, def);

  web.get('/collections/:id/preview', (c) => {
    const def = loadDefinition(app.db, Number(c.req.param('id')));
    if (!def) return c.notFound();
    const plan = cachedMembers(def);
    if (!plan) return c.html(<p class="muted">No library index yet. Run once from the Dashboard.</p>);
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
    if (!plex) return c.html(<p class="muted">Connect Plex in Settings → Connections to compare this collection with the one Kometa builds there.</p>);
    const plan = cachedMembers(def);
    if (!plan) return c.html(<p class="muted">No library index yet. Run once from the Dashboard.</p>);
    const s = app.settings();
    const ctx = { db: app.db, fetch: app.fetch, tmdb: app.tmdb(), plex, mdblistKey: null, imdbRoute: s.imdbRoute };
    const r = await resolveSource(ctx, { type: 'plex_collection', config: { name: def.name } }, { maxAgeMs: 10 * 60_000 });
    if (r.status === 'failed') return c.html(<p class="muted">Couldn’t read Plex: {r.error}</p>);
    if (!(r.meta as { found?: boolean } | null)?.found) return c.html(<p class="muted">Plex has no collection called “{def.name}” right now. Kometa deletes seasonal collections outside their window, so compare while it’s open.</p>);
    const want = def.target === 'movies' ? 'movie' : def.target === 'shows' ? 'series' : def.target === 'episodes' ? 'episode' : 'any';
    return c.html(<ParityPanel p={parity(r.items, new Set(plan.members.keys()), plan.index, want)} fetchedAt={r.fetchedAt} />);
  });

  web.post('/collections/:id/pins', async (c) => {
    const id = Number(c.req.param('id'));
    const b = await c.req.parseBody();
    const jfId = String(b.jfId ?? '');
    const kind = String(b.kind ?? '');
    if (!jfId) return back(c, `/collections/${id}`, { err: 'Nothing selected.' });
    app.db.delete(pin).where(and(eq(pin.definitionId, id), eq(pin.jfId, jfId))).run();
    if (kind === 'pin' || kind === 'exclude') app.db.insert(pin).values({ definitionId: id, jfId, kind }).run();
    return back(c, `/collections/${id}#pv-h`, { ok: kind === 'pin' ? 'Pinned. The next run adds it.' : kind === 'exclude' ? 'Excluded. The next run proposes removing it if it’s in the box set.' : 'Cleared.' });
  });

  web.post('/collections/:id/sources', async (c) => {
    const id = Number(c.req.param('id'));
    const def = loadDefinition(app.db, id);
    if (!def) return c.notFound();
    const b = await c.req.parseBody();
    const op = String(b.op ?? '');
    const here = `/collections/${id}#src-h`;
    const touch = () => app.db.update(definition).set({ updatedAt: Date.now() }).where(eq(definition.id, id)).run();
    if (op === 'add') {
      const spec = parseSourceInput(String(b.type ?? ''), String(b.value ?? ''), def.target);
      if (typeof spec === 'string') return back(c, here, { err: spec });
      const key = sourceKey(spec);
      if (def.sources.some((s) => sourceKey({ type: s.type, config: s.config }) === key)) return back(c, here, { err: 'That source is already on this collection.' });
      const position = Math.max(-1, ...def.sources.map((s) => s.position)) + 1;
      const role = b.role === 'suggest' || spec.type === 'jellyfin_episode_title' ? 'suggest' : 'add'; // title matches only suggest (ADR-018)
      app.db.insert(definitionSource).values({ definitionId: id, type: spec.type, config: spec.config, role, position }).run();
      touch();
      return back(c, here, { ok: `Added ${sourceLabel(spec)}. The next run fetches it.` });
    }
    const m = op.match(/^(remove|role):(\d+)(?::(add|suggest))?$/);
    const src = m ? def.sources.find((s) => s.id === Number(m[2])) : undefined;
    if (!m || !src) return back(c, here, { err: 'That source no longer exists.' });
    if (m[1] === 'remove') {
      if (def.presetKey && def.sources.length === 1) return back(c, here, { err: 'A preset needs at least one source. Turn the collection off instead.' });
      app.db.delete(definitionSource).where(eq(definitionSource.id, src.id)).run();
      touch();
      return back(c, here, { ok: `Removed ${sourceLabel({ type: src.type, config: src.config })}. Titles only it supplied are proposed for removal on the next run.` });
    }
    if (src.type === 'jellyfin_episode_title' && m[3] === 'add') return back(c, here, { err: 'Episode-title matches can only be suggestions; they’re matched by title, not by ID.' });
    app.db.update(definitionSource).set({ role: m[3] === 'suggest' ? 'suggest' : 'add' }).where(eq(definitionSource.id, src.id)).run();
    touch();
    return back(c, here, { ok: m[3] === 'suggest' ? 'Its titles now go to Review as suggestions.' : 'Its titles are now added directly.' });
  });

  web.post('/collections/:id/delete', async (c) => {
    const id = Number(c.req.param('id'));
    const def = loadDefinition(app.db, id);
    if (!def) return c.notFound();
    if (def.presetKey) return back(c, `/collections/${id}`, { err: 'Presets can’t be deleted; turn it off instead.' });
    const m = app.db.select().from(managedCollection).where(eq(managedCollection.definitionId, id)).get();
    if (m?.state === 'live' || m?.state === 'hidden') return back(c, `/collections/${id}`, { err: 'Turn it off and run once to remove its box set first.' });
    app.db.transaction((tx) => {
      tx.delete(definitionSource).where(eq(definitionSource.definitionId, id)).run();
      tx.delete(definitionMode).where(eq(definitionMode.definitionId, id)).run();
      tx.delete(pin).where(eq(pin.definitionId, id)).run();
      tx.delete(membership).where(eq(membership.definitionId, id)).run();
      tx.delete(managedCollection).where(eq(managedCollection.definitionId, id)).run();
      tx.update(action).set({ status: 'superseded', updatedAt: Date.now() }).where(and(eq(action.definitionId, id), inArray(action.status, ['proposed', 'approved', 'snoozed']))).run();
      tx.delete(definition).where(eq(definition.id, id)).run();
    });
    return back(c, '/collections', { ok: `Deleted ${def.name}.` });
  });

  // ── missing (Phase 2): what collections list that you don't own; send to Radarr/Sonarr ──
  web.get('/missing', async (c) => {
    const tab = c.req.query('tab') === 'shows' ? 'shows' : 'movies';
    const m = await missingModel(app, tab, Number(c.req.query('def')) || null, Number(c.req.query('page')) || 1);
    return page(c, 'Missing', 'missing', <Missing m={m} csrf={userOf(c).csrf} />);
  });

  web.post('/missing/send', async (c) => {
    const b = await c.req.parseBody({ all: true });
    const tab = b.tab === 'shows' ? 'shows' : 'movies';
    const which = tab === 'movies' ? 'radarr' : 'sonarr';
    const name = which === 'radarr' ? 'Radarr' : 'Sonarr';
    const def = loadDefinition(app.db, Number(b.def));
    const here = `/missing?tab=${tab}${def ? `&def=${def.id}` : ''}`;
    if (!def) return back(c, here, { err: 'Choose a collection first.' });
    const ids = new Set(([] as unknown[]).concat(b.ids ?? []).map(String));
    if (!ids.size) return back(c, here, { err: 'Select at least one title.' });
    const cap = app.settings().guardrails.arrCapPerRun;
    if (ids.size > cap) return back(c, here, { err: `Select up to ${cap} at a time. That’s the per-run cap in Settings.` });
    const chosen = missingFor(app, def, tab, new LibraryIndex(app.db.select().from(libraryItem).all() as LibRow[])).filter((m) => ids.has(m.keys[0]!));
    const options = parseArrOptions(b, which);
    const type = which === 'radarr' ? 'radarr.add_movie' as const : 'sonarr.add_series' as const;
    const now = Date.now();
    const by = userOf(c).name;
    const send = b.mode !== 'review';
    const created: number[] = [];
    const noId: string[] = [];
    for (const m of chosen) {
      const term = await resolveTerm(app, m).catch(() => null);
      if (!term) { noId.push(m.title ?? m.keys[0]!); continue; }
      const fp = fingerprint(type, term);
      // A title for Review and Activity when the source had none (e.g. TMDb ID lists); cached for a day.
      const cl = which === 'radarr' ? app.radarr() : app.sonarr();
      const info = !m.title && cl ? await cached(app.db, `${which}:lookup:${term}`, 1, () => cl.lookup(term)).catch(() => null) : null;
      app.db.update(action).set({ status: 'superseded', updatedAt: now }).where(and(eq(action.fingerprint, fp), inArray(action.status, ['proposed', 'approved']))).run();
      const row = app.db.insert(action).values({
        type, fingerprint: fp, definitionId: def.id, mode: 'review', status: send ? 'approved' : 'proposed', reason: `Chosen on the Missing page by ${by}`,
        item: { name: m.title ?? info?.title ?? term, year: m.year ?? info?.year ?? null, provenance: { sources: m.sources.map((x) => ({ key: x.label, label: x.label, rank: x.rank })), match: 'missing' } },
        payload: { app: which, term, options, manual: true }, decidedBy: send ? by : null, decidedAt: send ? now : null, createdAt: now, updatedAt: now,
      }).returning({ id: action.id }).get();
      created.push(row.id);
    }
    const noIdNote = noId.length ? ` ${noId.length} couldn’t be sent: no TVDB ID (add a TMDb key to look them up).` : '';
    if (!send) return back(c, here, { ok: `${created.length} queued in Review.${noIdNote}` });
    const r = await executeArrDue(app, now, created);
    const parts = [`Sent ${r.applied} to ${name}.`];
    if (r.skipped.length) parts.push(`Skipped ${r.skipped.map((x) => `${x.title} (${x.why})`).join(', ')}.`);
    if (r.failed.length) parts.push(`Failed: ${r.failed.map((x) => `${x.title}: ${x.why}`).join('; ')}.`);
    return back(c, here, r.failed.length && !r.applied ? { err: parts.join(' ') + noIdNote } : { ok: parts.join(' ') + noIdNote });
  });

  web.post('/missing/monitor', async (c) => {
    const b = await c.req.parseBody();
    const def = loadDefinition(app.db, Number(b.def));
    const id = Number(b.radarrCollectionId);
    const here = `/missing?tab=movies${def ? `&def=${def.id}` : ''}`;
    if (!def || !Number.isInteger(id)) return back(c, here, { err: 'That collection no longer exists.' });
    const now = Date.now();
    const row = app.db.insert(action).values({
      type: 'radarr.monitor_collection', fingerprint: fingerprint('radarr.monitor_collection', id), definitionId: def.id, mode: 'review', status: 'approved',
      reason: `Chosen on the Missing page by ${userOf(c).name}`, item: { name: String(b.title ?? `Radarr collection ${id}`), year: null },
      payload: { app: 'radarr', radarrCollectionIds: [id], collectionTitle: String(b.title ?? ''), manual: true }, decidedBy: userOf(c).name, decidedAt: now, createdAt: now, updatedAt: now,
    }).returning({ id: action.id }).get();
    const r = await executeArrDue(app, now, [row.id]);
    return back(c, here, r.applied ? { ok: `Radarr now monitors ${b.title}. It adds the missing films itself as they’re released.` } : { err: r.failed[0]?.why ?? 'Radarr didn’t accept that.' });
  });

  // ── review ──
  web.get('/review', (c) => {
    const tab = (['pending', 'snoozed', 'dismissed'].includes(c.req.query('tab') ?? '') ? c.req.query('tab') : 'pending') as ReviewTab;
    const def = Number(c.req.query('def')) || undefined;
    return page(c, 'Review', 'review', <Review m={reviewModel(app, tab, def)} csrf={userOf(c).csrf} tz={app.settings().timezone} dryRun={app.settings().dryRun} />);
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
    if (!ids.length) return back(c, `/review?tab=${tab}`, { err: 'Select at least one proposal first.' });
    const by = userOf(c).name;
    if (verdict === 'forget') {
      for (const a of app.db.select().from(action).where(inArray(action.id, ids)).all()) forgetDecision(app.db, a.fingerprint);
      return back(c, `/review?tab=${tab}`, { ok: 'Undone. The next run proposes it again.' });
    }
    if (verdict === 'approve') {
      decide(app.db, ids, 'approve', by);
      const due = app.db.select().from(action).where(inArray(action.id, ids)).all().filter((a) => a.applyAt === null || a.applyAt <= Date.now()).map((a) => a.id);
      if (due.length) {
        try {
          const r = await applyNow(app, due);
          return back(c, `/review?tab=${tab}`, { ok: `Approved ${ids.length}. Applied ${r.applied}${r.waiting ? `, ${r.waiting} waiting for other approvals (a box set is created only with members)` : ''}${r.failed ? `, ${r.failed} failed (see Activity)` : ''}.` });
        } catch (e) {
          return back(c, `/review?tab=${tab}`, { err: `Approved, but applying failed: ${(e as Error).message}` });
        }
      }
      return back(c, `/review?tab=${tab}`, { ok: `Approved ${ids.length}. They apply when the window opens.` });
    }
    if (verdict === 'dismiss') {
      decide(app.db, ids, 'dismiss', by);
      return back(c, `/review?tab=${tab}`, { ok: `Dismissed ${ids.length}. They won’t be proposed again unless you undo it.` });
    }
    if (verdict === 'snooze') {
      const choice = String(b.snooze ?? app.settings().defaultSnooze);
      const s = app.settings();
      for (const a of app.db.select().from(action).where(inArray(action.id, ids)).all()) {
        let until: number | null = Date.now() + (choice === '30d' ? 30 : 7) * 86_400_000;
        if (choice === 'window') {
          const def = a.definitionId ? loadDefinition(app.db, a.definitionId) : undefined;
          const today = localDay(Date.now(), s.timezone);
          const open = def?.window ? transitions(def.window, today, 4).find((t) => t.kind === 'opens') : undefined;
          until = open ? localMidnight(open.day, s.timezone) : Date.now() + 30 * 86_400_000;
          void opensWithin;
        }
        decide(app.db, [a.id], 'snooze', by, { until });
      }
      return back(c, `/review?tab=${tab}`, { ok: `Snoozed ${ids.length}.` });
    }
    return back(c, `/review?tab=${tab}`, { err: 'Unknown action.' });
  });

  // ── activity ──
  web.get('/activity', (c) => page(c, 'Activity', 'activity', <Activity m={activityModel(app)} tz={app.settings().timezone} csrf={userOf(c).csrf} />));
  web.post('/activity/:id/undo', async (c) => {
    try {
      const msg = await undoAction(app, Number(c.req.param('id')), userOf(c).name);
      return back(c, '/activity', { ok: msg });
    } catch (e) {
      return back(c, '/activity', { err: (e as Error).message });
    }
  });

  // ── settings ──
  web.get('/settings', async (c) => {
    // Before the first run the library list is empty; read it from Jellyfin so it can be chosen.
    const hasLibs = librariesModel(app).some((l) => l.collectionType === 'movies');
    const libError = hasLibs ? null : await refreshLibraries();
    const masked = { ...Object.fromEntries(CONNECTIONS.map((x) => [x.key, x.secret ? app.secrets.masked(x.secret) : { set: false, last4: null }])), imdbSnapshot: app.secrets.masked('imdb.snapshotToken') };
    const runs = nextRuns(app);
    const schedules = app.db.select().from(jobSchedule).all().map((j) => ({ ...j, next: runs.find((r) => r.job === j.job)?.next ?? null }));
    return page(c, 'Settings', 'settings', <SettingsPage s={app.settings()} csrf={userOf(c).csrf} masked={masked} libraries={librariesModel(app)} libError={libError} schedules={schedules} />);
  });

  web.post('/settings/connections', async (c) => {
    const b = await c.req.parseBody();
    const conn = { ...app.settings().connections };
    for (const x of CONNECTIONS) {
      if (x.urlField) {
        const url = String(b[`url:${x.key}`] ?? '').trim().replace(/\/$/, '');
        if (url && !/^https?:\/\/\S+$/.test(url)) return back(c, '/settings#conn', { err: `${x.name}: enter an address starting with http:// or https://` });
        conn[x.urlField] = url;
      }
      const secret = String(b[`secret:${x.key}`] ?? '').trim();
      if (secret && x.secret) app.secrets.set(x.secret, secret);
    }
    app.updateSettings({ connections: conn });
    await refreshLibraries();
    return back(c, '/settings#conn', { ok: 'Connections saved.' });
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

  web.post('/settings/general', async (c) => {
    const b = await c.req.parseBody();
    const lead = Number(b.leadDays);
    const cap = Number(b.arrCapPerRun);
    const tz = String(b.timezone ?? '').trim();
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
    } catch {
      return back(c, '/settings#run', { err: `Unknown timezone “${tz}”.` });
    }
    if (!Number.isInteger(lead) || lead < 0 || lead > 60) return back(c, '/settings#run', { err: 'Plan-ahead days must be 0–60.' });
    if (!Number.isInteger(cap) || cap < 0 || cap > 200) return back(c, '/settings#run', { err: 'The add cap must be 0–200.' });
    const neighbours = String(b.neighbours ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const m = l.match(/^(.*?)\s+(\d{1,2}:\d{2})$/);
      return m ? { name: m[1]!.trim(), time: m[2]! } : { name: l, time: '' };
    });
    const snooze = ['window', '7d', '30d'].includes(String(b.defaultSnooze)) ? (String(b.defaultSnooze) as Settings['defaultSnooze']) : 'window';
    const tzChanged = tz !== app.settings().timezone;
    app.updateSettings({ dryRun: b.dryRun === '1', leadDays: lead, timezone: tz, neighbours, defaultSnooze: snooze, guardrails: { arrCapPerRun: cap, releasedOnly: b.releasedOnly === '1' } });
    if (tzChanged && opts.scheduler) startScheduler(app);
    return back(c, '/settings#run', { ok: 'Saved.' });
  });

  web.post('/settings/modes', async (c) => {
    const b = await c.req.parseBody();
    const modes = { ...app.settings().modes };
    for (const [k, v] of Object.entries(b)) {
      if (k.startsWith('mode:') && MODES.has(String(v))) modes[k.slice(5) as ActionType] = String(v) as Mode;
    }
    modes['collection.delete'] = modes['collection.create'];
    app.updateSettings({ modes });
    return back(c, '/settings#modes', { ok: 'Modes saved.' });
  });

  // The IMDb queries your collections need, for the snapshot job (docs/IMDB-SNAPSHOT.md).
  web.get('/settings/imdb/queries.json', (c) => {
    const sources = app.db.select().from(definitionSource).all();
    const series = app.db.select({ imdb: libraryItem.imdb }).from(libraryItem).where(eq(libraryItem.kind, 'series')).all().map((r) => r.imdb).filter((x): x is string => Boolean(x));
    c.header('content-disposition', 'attachment; filename="queries.json"');
    return c.json(queriesFor(sources, series));
  });

  web.post('/settings/imdb', async (c) => {
    const b = await c.req.parseBody();
    const route = String(b.imdbRoute);
    if (route !== 'direct' && route !== 'kometa_service' && route !== 'snapshot') return back(c, '/settings#imdb', { err: 'That route isn’t available.' });
    const snapshotUrl = String(b.snapshotUrl ?? '').trim();
    if (snapshotUrl && !/^https?:\/\/\S+$/.test(snapshotUrl)) return back(c, '/settings#imdb', { err: 'The snapshot URL must start with http:// or https://' });
    if (route === 'snapshot' && !snapshotUrl) return back(c, '/settings#imdb', { err: 'The snapshot route needs a snapshot URL.' });
    const token = String(b.snapshotToken ?? '').trim();
    if (token) app.secrets.set('imdb.snapshotToken', token);
    app.updateSettings({ imdbRoute: route, snapshotUrl });
    return back(c, '/settings#imdb', { ok: route === 'snapshot' ? 'IMDb route saved. The next run reads the snapshot.' : 'IMDb route saved.' });
  });

  // Radarr/Sonarr defaults, read live from each app (lazy-loaded so Settings stays fast).
  web.get('/settings/arr', async (c) => {
    const s = app.settings();
    const parts = await Promise.all((['radarr', 'sonarr'] as const).map(async (which) => {
      const cl = which === 'radarr' ? app.radarr() : app.sonarr();
      const name = which === 'radarr' ? 'Radarr' : 'Sonarr';
      if (!cl) return <p class="muted">{name}: connect it under Connections to choose its defaults.</p>;
      try {
        const [profiles, roots, tags] = await Promise.all([cl.qualityProfiles(), cl.rootFolders(), cl.tags()]);
        return (
          <form method="post" action="/settings/arr" class="form arr-defaults">
            <Csrf token={userOf(c).csrf} /><input type="hidden" name="which" value={which} />
            <h3>{name}</h3>
            <ArrOptionsFields which={which} values={s.arr[which]} choices={{ profiles, roots, tags }} idPrefix={`set-${which}`} />
            <div><button class="btn primary" type="submit">Save {name} defaults</button></div>
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
    app.updateSettings({ arr: { ...app.settings().arr, [which]: parseArrOptions(b, which) } });
    forgetArrState();
    return back(c, '/settings#arr', { ok: `${which === 'radarr' ? 'Radarr' : 'Sonarr'} defaults saved.` });
  });

  // ── home-screen rows (Phase 3, ADR-025) ──
  web.get('/settings/home', async (c) => c.html(<HomeRowsPanel st={await homeStatus(app)} s={app.settings()} csrf={userOf(c).csrf} />));

  web.post('/settings/home', async (c) => {
    const b = await c.req.parseBody();
    const order = Number(b.orderIndex ?? 2);
    if (!Number.isInteger(order) || order < 0 || order > 99) return back(c, '/settings#home', { err: 'Position must be a whole number from 0 to 99.' });
    const viewMode = (['Portrait', 'Landscape', 'Square', 'Small'] as const).find((v) => v === b.viewMode) ?? 'Portrait';
    const enabled = b.enabled === '1';
    app.updateSettings({ homeRows: { enabled, orderIndex: order, viewMode } });
    return back(c, '/settings#home', { ok: enabled ? 'Saved. Rows update on the next run, or press “Update rows in Jellyfin now”.' : 'Saved. Rows stay as they are in Jellyfin until you turn this back on.' });
  });

  web.post('/settings/home/sync', async (c) => {
    if (!app.settings().homeRows.enabled) return back(c, '/settings#home', { err: 'Turn home-screen rows on first.' });
    try {
      const r = await syncHomeRows(app, { dryRun: false }); // an explicit press, so dry run doesn't hold it back
      if (r.problem) return back(c, '/settings#home', { err: r.problem });
      return back(c, '/settings#home', { ok: r.changed ? `Rows updated. Showing: ${r.showing.join(', ') || 'none right now'}.` : 'Rows were already up to date.' });
    } catch (e) {
      return back(c, '/settings#home', { err: `Couldn’t update the rows: ${(e as Error).message}` });
    }
  });

  web.post('/settings/libraries', async (c) => {
    const b = await c.req.parseBody({ all: true });
    const pick = (field: string, type: string) => {
      const ids = ([] as unknown[]).concat(b[field] ?? []).map(String);
      const all = librariesModel(app).filter((l) => l.collectionType === type).map((l) => l.id);
      return ids.length === all.length ? null : ids; // all ticked = every library, including ones added later
    };
    app.updateSettings({ movieLibraryIds: pick('movieLibraryIds', 'movies'), showLibraryIds: pick('showLibraryIds', 'tvshows') });
    markDone('libraries');
    const next = String(b.next ?? '');
    if (next.startsWith('/start')) return back(c, next, { ok: 'Libraries saved.' }); // only ever back into the guide
    return back(c, '/settings#libs', { ok: 'Libraries saved.' });
  });

  web.post('/settings/schedules', async (c) => {
    const b = await c.req.parseBody();
    for (const j of app.db.select().from(jobSchedule).all()) {
      const cron = String(b[`cron:${j.job}`] ?? j.cron).trim();
      try {
        new Cron(cron, { paused: true });
      } catch {
        return back(c, '/settings#sched', { err: `“${cron}” isn’t a valid cron expression for ${j.job}.` });
      }
      app.db.update(jobSchedule).set({ cron, enabled: b[`on:${j.job}`] === '1' }).where(eq(jobSchedule.job, j.job)).run();
    }
    if (opts.scheduler) startScheduler(app);
    return back(c, '/settings#sched', { ok: 'Schedules saved.' });
  });

  // ── adoption ──
  web.get('/adoption', async (c) => {
    try {
      return page(c, 'Existing box sets', 'collections', <Adoption items={await adoptionCandidates(app)} csrf={userOf(c).csrf} />);
    } catch (e) {
      return page(c, 'Existing box sets', 'collections', <Adoption items={[]} csrf={userOf(c).csrf} error={`Couldn’t read box sets from Jellyfin: ${(e as Error).message}`} />);
    }
  });
  web.post('/adoption/adopt', async (c) => {
    const b = await c.req.parseBody();
    try {
      await adopt(app, Number(b.definitionId), String(b.boxsetId), userOf(c).name);
      return back(c, '/adoption', { ok: 'Adopted. The next run syncs its members through Review.' });
    } catch (e) {
      return back(c, '/adoption', { err: (e as Error).message });
    }
  });
  web.post('/adoption/delete', async (c) => {
    const b = await c.req.parseBody();
    try {
      await deleteUnmanaged(app, String(b.boxsetId), userOf(c).name);
      return back(c, '/adoption', { ok: 'Box set deleted. Its films are still in your library.' });
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
