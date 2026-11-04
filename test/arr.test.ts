// Radarr and Sonarr (ADR-007, ADR-027): client rules, missing titles, guardrails, the planner and the Missing page.
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, ne } from 'drizzle-orm';
import { ArrClient } from '../src/clients/arr.js';
import { openDb } from '../src/db/index.js';
import { createContext } from '../src/app-context.js';
import { readConfig } from '../src/config.js';
import { runPipeline } from '../src/pipeline/run.js';
import { decide } from '../src/pipeline/store.js';
import { forgetArrState } from '../src/pipeline/arr.js';
import { action, definition, definitionArr, definitionMode, definitionSource } from '../src/db/schema.js';
import { createWeb } from '../src/web/app.js';
import { FakeJellyfin, FAKE_URL } from './fakes/jellyfin.js';
import { FakeArr, RADARR_CATALOGUE, SONARR_CATALOGUE } from './fakes/arr.js';
import type { FetchLike } from '../src/clients/http.js';

const RADARR = 'http://radarr.test:7878';
const SONARR = 'http://sonarr.test:8989';

describe('Radarr/Sonarr client (ADR-027)', () => {
  it('looks up by term, works out "released", and adds with monitored set explicitly', async () => {
    const fake = new FakeArr('radarr', RADARR, 'rk', RADARR_CATALOGUE);
    fake.excluded.add(11442);
    const c = new ArrClient('radarr', RADARR, 'rk', fake.fetch());
    const now = Date.UTC(2026, 10, 3);
    expect(await c.lookup('tmdb:10676', now)).toMatchObject({ title: 'Halloween III: Season of the Witch', inLibrary: false, excluded: false, released: true });
    expect(await c.lookup('tmdb:11442', now)).toMatchObject({ excluded: true });
    expect(await c.lookup('tmdb:999001', now)).toMatchObject({ released: false, status: 'announced' });
    expect(await c.lookup('imdb:tt3228088', now)).toMatchObject({ released: true }); // in cinemas, but digital release is past
    expect(await c.exclusions()).toEqual(new Set(['tmdb:11442']));
    const t = (await c.lookup('tmdb:10676', now))!;
    await expect(c.add(t, {})).rejects.toThrow(/quality profile and root folder/);
    const id = await c.add(t, { qualityProfileId: 4, rootFolderPath: '/movies', monitored: false, searchOnAdd: false, tags: [3] });
    const post = fake.calls.find((x) => x.method === 'POST' && x.path === '/movie')!.body;
    expect(post).toMatchObject({ tmdbId: 10676, qualityProfileId: 4, rootFolderPath: '/movies', monitored: false, tags: [3], minimumAvailability: 'released', addOptions: { searchForMovie: false, monitor: 'none' } });
    expect((await c.lookup('tmdb:10676', now))!.inLibrary).toBe(true);
    expect((await c.library()).ids.has('tmdb:10676')).toBe(true);
    expect(id).toBeGreaterThan(0);
    await c.monitorCollections([7], { qualityProfileId: 4, rootFolderPath: '/movies' });
    expect(fake.collections[0]!.monitored).toBe(true);
    expect(fake.calls.at(-1)).toMatchObject({ method: 'POST', path: '/command', body: { name: 'RefreshCollections' } });
  });

  it('treats an upcoming Sonarr series as unreleased, and adds by TVDB with Sonarr options', async () => {
    const fake = new FakeArr('sonarr', SONARR, 'sk', SONARR_CATALOGUE);
    const c = new ArrClient('sonarr', SONARR, 'sk', fake.fetch());
    expect(await c.lookup('tvdb:999999')).toMatchObject({ released: false });
    const t = (await c.lookup('tvdb:367138'))!;
    expect(t.released).toBe(true);
    await c.add(t, { qualityProfileId: 1, rootFolderPath: '/tv', seriesType: 'standard', seasonFolder: true, monitor: 'firstSeason' });
    expect(fake.calls.find((x) => x.method === 'POST')!.body).toMatchObject({ tvdbId: 367138, monitored: true, seasonFolder: true, addOptions: { monitor: 'firstSeason', searchForMissingEpisodes: true } });
  });
});

function world() {
  forgetArrState();
  const jf = new FakeJellyfin();
  jf.add({ Id: 'm-h2018', Name: 'Halloween', Type: 'Movie', ParentId: 'lib-movies', ProductionYear: 2018, ProviderIds: { Imdb: 'tt1502407', Tmdb: '424139' } });
  const radarr = new FakeArr('radarr', RADARR, 'rk', RADARR_CATALOGUE);
  radarr.excluded.add(11442);
  radarr.library.push({ ...RADARR_CATALOGUE[2]!, id: 1, monitored: true, hasFile: false }); // Halloween Kills: monitored, no file
  const rf = radarr.fetch();
  const jff = jf.fetch();
  const net: FetchLike = async (url, init) => (url.startsWith(RADARR) ? rf(url, init) : url.startsWith(FAKE_URL) ? jff(url, init) : new Response('nope', { status: 404 }));
  const config = { ...readConfig({}), configDir: mkdtempSync(join(tmpdir(), 'mc-')), timezone: 'America/New_York', seeds: {} };
  const app = createContext(config, { db: openDb(':memory:'), fetch: net });
  app.updateSettings({ connections: { jellyfinUrl: FAKE_URL, plexUrl: '', radarrUrl: RADARR, sonarrUrl: '' }, dryRun: false, firstRunDone: true });
  app.updateSettings({ arr: { ...app.settings().arr, radarr: { ...app.settings().arr.radarr, qualityProfileId: 4, rootFolderPath: '/movies' } } });
  app.secrets.set('jellyfin.apiKey', jf.apiKey);
  app.secrets.set('radarr.apiKey', 'rk');
  // One always-on collection listing six films: one owned, one excluded, one in Radarr, one unreleased, two sendable.
  app.db.update(definition).set({ enabled: false }).run();
  const now = Date.now();
  const def = app.db.insert(definition).values({
    slug: 'custom-halloween', name: 'Halloween Films', target: 'movies', enabled: true, window: null, filters: {}, minItems: 1, syncMode: 'sync',
    sortBy: 'title.asc', poster: { kind: 'none' }, visibility: 'delete', createdAt: now, updatedAt: now,
  }).returning({ id: definition.id }).get();
  app.db.insert(definitionSource).values({ definitionId: def.id, type: 'tmdb_movie', config: { ids: ['424139', '10676', '11442', '610253', '999001', '23202'] }, role: 'add', position: 0 }).run();
  return { app, radarr, defId: def.id };
}

describe('sending missing films to Radarr (ADR-007)', () => {
  it('proposes only released films Radarr doesn’t have or exclude, for collections that opt in', async () => {
    const { app, radarr, defId } = world();
    await runPipeline(app, { job: 'manual', trigger: 'manual', index: true });
    expect(app.db.select().from(action).where(eq(action.type, 'radarr.add_movie')).all()).toHaveLength(0); // not opted in
    app.db.insert(definitionArr).values({ definitionId: defId, addMissing: true, options: {} }).run();
    await runPipeline(app, { job: 'manual', trigger: 'manual', index: false });
    const adds = app.db.select().from(action).where(eq(action.type, 'radarr.add_movie')).all();
    expect(adds.map((a) => [a.item?.name, a.status]).sort()).toEqual([['Halloween III: Season of the Witch', 'proposed'], ['Trick ’r Treat', 'proposed']]);
    expect(radarr.calls.some((c) => c.method === 'POST')).toBe(false); // Review by default
    decide(app.db, adds.map((a) => a.id), 'approve', 'admin');
    await runPipeline(app, { job: 'manual', trigger: 'manual', index: false });
    expect(radarr.calls.filter((c) => c.method === 'POST' && c.path === '/movie').map((c) => c.body.tmdbId).sort()).toEqual([10676, 23202]);
    expect(app.db.select().from(action).where(eq(action.type, 'radarr.add_movie')).all().every((a) => a.status === 'applied')).toBe(true);
  });

  it('caps automatic adds per run and sends the rest to Review', async () => {
    const { app, radarr, defId } = world();
    app.db.insert(definitionArr).values({ definitionId: defId, addMissing: true, options: {} }).run();
    app.db.insert(definitionMode).values({ definitionId: defId, actionType: 'radarr.add_movie', mode: 'auto' }).run();
    app.updateSettings({ guardrails: { arrCapPerRun: 1, releasedOnly: true } });
    await runPipeline(app, { job: 'manual', trigger: 'manual', index: true });
    const adds = app.db.select().from(action).where(eq(action.type, 'radarr.add_movie')).all();
    expect(adds.map((a) => a.status).sort()).toEqual(['applied', 'proposed']);
    expect(adds.find((a) => a.status === 'proposed')!.reason).toMatch(/over the cap of 1/);
    expect(radarr.calls.filter((c) => c.method === 'POST' && c.path === '/movie')).toHaveLength(1);
  });

  it('Missing page: shows each film’s Radarr status, sends within the cap, and re-checks before adding', async () => {
    const { app, radarr, defId } = world();
    await runPipeline(app, { job: 'manual', trigger: 'manual', index: true });
    const web = createWeb(app);
    const login = await web.request('/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'username=admin&password=pw' });
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const html = await (await web.request(`/missing?tab=movies&def=${defId}`, { headers: { cookie } })).text();
    expect(html).toContain('Halloween Films: 5 missing');
    expect(html).toMatch(/Monitored, no file/);
    expect(html).toMatch(/Excluded/);
    expect(html).toContain('HD-1080p');
    const csrf = html.match(/name="_csrf" value="([0-9a-f]+)"/)![1]!;
    const send = (ids: string[], extra: Record<string, string> = {}) => {
      const body = new URLSearchParams({ _csrf: csrf, def: String(defId), tab: 'movies', mode: 'send', qualityProfileId: '4', rootFolderPath: '/movies', minimumAvailability: 'released', monitored: '1', searchOnAdd: '1', ...extra });
      for (const id of ids) body.append('ids', id);
      return web.request('/missing/send', { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    };
    const flash = (r: Response) => { const u = new URL(r.headers.get('location')!, 'http://x'); return `${u.searchParams.get('ok') ?? ''}${u.searchParams.get('err') ?? ''}`; };
    app.updateSettings({ guardrails: { arrCapPerRun: 2, releasedOnly: true } });
    expect(flash(await send(['tmdb:10676', 'tmdb:23202', 'tmdb:999001']))).toMatch(/Select up to 2/);
    // An unreleased film is re-checked and skipped, not added.
    expect(flash(await send(['tmdb:10676', 'tmdb:999001']))).toMatch(/Sent 1 to Radarr\. Skipped Halloween Forever \(not released yet \(announced\)\)/);
    expect(radarr.calls.filter((c) => c.method === 'POST' && c.path === '/movie').map((c) => c.body.tmdbId)).toEqual([10676]);
    // "Send to Review instead" queues it; the next run keeps it.
    expect(flash(await send(['tmdb:23202'], { mode: 'review' }))).toMatch(/1 queued in Review/);
    await runPipeline(app, { job: 'manual', trigger: 'manual', index: false });
    expect(app.db.select().from(action).where(eq(action.status, 'proposed')).all().filter((a) => a.type === 'radarr.add_movie').map((a) => a.item?.name)).toEqual(['Trick ’r Treat']);
    // Monitoring a TMDb collection in Radarr.
    const mon = await web.request('/missing/monitor', { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf, def: String(defId), radarrCollectionId: '7', title: 'Halloween Collection' }).toString() });
    expect(flash(mon)).toMatch(/Radarr now monitors Halloween Collection/);
    expect(radarr.collections[0]!.monitored).toBe(true);
    void ne;
  });
});
