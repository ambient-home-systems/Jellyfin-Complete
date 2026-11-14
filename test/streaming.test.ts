// Streaming services and IMDb charts (ADR-036): Kometa's both/streaming.yml and chart/imdb.yml defaults, built from a
// weekly per-title TMDb watch-provider lookup and IMDb's chart GraphQL query.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { eq, like } from 'drizzle-orm';
import { openDb } from '../src/db/index.js';
import { createContext } from '../src/app-context.js';
import { readConfig } from '../src/config.js';
import { runPipeline } from '../src/pipeline/run.js';
import { getPlanSummary } from '../src/pipeline/summary.js';
import { action, definition, tmdbCache } from '../src/db/schema.js';
import { PRESETS, LEGACY_POSTER } from '../src/presets/index.js';
import { STREAMING_SERVICES, availableIn, providerIdsIn, serviceByKey } from '../src/presets/streaming.js';
import { CHART_PRESETS } from '../src/presets/charts.js';
import { resolveSource, type SourceContext } from '../src/sources/index.js';
import { buildSnapshot, chartKey } from '../src/imdb/snapshot.js';
import { queriesFor } from '../src/imdb/queries.js';
import { parseSourceInput } from '../src/domain/source-input.js';
import { applySettings, SettingsError } from '../src/web/settings-actions.js';
import { FakeJellyfin, FAKE_URL } from './fakes/jellyfin.js';
import type { FetchLike } from '../src/clients/http.js';
import { setup, signIn, csrfOf, form } from './helpers/web.js';

const fixture = (f: string) => parse(readFileSync(join(__dirname, 'fixtures/kometa-v2.5.3', f), 'utf8'));
const NOW = Date.UTC(2026, 10, 20, 15);
const DAY = 86_400_000;

describe('streaming presets vs Kometa v2.5.3 defaults/both/streaming.yml', () => {
  const dyn = fixture('streaming.yml').dynamic_collections.Streaming;
  const tv = dyn.template_variables;

  it('has every service in Kometa order, with the same names, provider IDs and shows-only services', () => {
    expect(STREAMING_SERVICES.map((s) => s.key)).toEqual(Object.keys(dyn.data));
    for (const s of STREAMING_SERVICES) {
      expect(s.name).toBe(dyn.data[s.key]);
      expect(s.providers.join('|')).toBe(String(tv.tmdb_key[s.key]));
      expect(Boolean(s.showsOnly), s.key).toBe(tv.allowed_libraries[s.key] === 'show');
    }
  });

  it('names each "<service> Movies" or "<service> Shows" with the app’s own poster, and offers the old names for adoption', () => {
    const streaming = PRESETS.filter((p) => p.family === 'streaming');
    expect(streaming).toHaveLength(22 * 2 - 3);
    const netflix = streaming.find((p) => p.definition.slug === 'streaming-netflix-movies')!;
    expect(netflix.definition).toMatchObject({
      name: 'Netflix Movies', target: 'movies', minItems: 1, syncMode: 'sync', sortTitle: '!030_Netflix Movies', overview: 'Movies streaming on Netflix.',
      poster: { kind: 'bundled', key: 'streaming-netflix-movies' },
      sources: [{ type: 'tmdb_watch_provider', config: { service: 'netflix', kind: 'movie' } }],
    });
    expect(streaming.every((p) => p.definition.poster.kind === 'bundled')).toBe(true);
    expect(LEGACY_POSTER.get('streaming:netflix:movies')).toBe('https://raw.githubusercontent.com/Kometa-Team/Default-Images/master/streaming/color/Netflix.jpg');
    expect(LEGACY_POSTER.get('streaming:disney:shows')).toMatch(/streaming\/color\/Disney%2B\.jpg$/);
    expect(streaming.some((p) => p.definition.name === 'hayu Movies')).toBe(false);
    for (const [key, names] of Object.entries(tv.delete_collections_named as Record<string, string[]>)) {
      const old = streaming.filter((p) => p.definition.presetKey.startsWith(`streaming:${key}:`)).flatMap((p) => p.deleteCollectionsNamed);
      expect(old.sort(), key).toEqual([...names].sort());
    }
    expect(streaming.every((p) => !p.enabledByDefault)).toBe(true);
  });

  it('follows Kometa’s country rules: Prime Video’s ID outside five countries, and single-country services', () => {
    const amazon = serviceByKey('amazon')!;
    expect(providerIdsIn(amazon, 'US')).toEqual([9]);
    expect(providerIdsIn(amazon, 'GB')).toEqual([9]);
    expect(providerIdsIn(amazon, 'FR')).toEqual([119]);
    const on = (region: string) => STREAMING_SERVICES.filter((s) => availableIn(s, region)).map((s) => s.key);
    expect(on('US')).not.toEqual(expect.arrayContaining(['channel4']));
    expect(on('GB')).toEqual(expect.arrayContaining(['channel4', 'itvx', 'now', 'hbomax']));
    expect(on('ES')).toEqual(expect.arrayContaining(['movistar', 'atresplayer', 'filmin']));
    expect(on('CA')).toContain('crave');
    expect(on('CA')).not.toContain('hbomax');
    expect(on('US')).toEqual(expect.arrayContaining(['netflix', 'hbomax', 'hulu', 'amazon']));
    expect(on('US')).not.toContain('crave');
  });
});

describe('IMDb chart presets vs Kometa v2.5.3 defaults/chart/imdb.yml', () => {
  const yml = fixture('imdb-chart.yml');

  it('has Kometa’s three charts, films and shows apart, Lowest Rated for films only', () => {
    expect([...new Set(CHART_PRESETS.map((c) => c.keyName))]).toEqual(Object.keys(yml.collections));
    expect(yml.collections['IMDb Lowest Rated'].template[0].allowed_libraries).toBe('movie');
    const charts = PRESETS.filter((p) => p.family === 'imdb_chart').map((p) => p.definition);
    expect(charts.map((d) => d.name)).toEqual(['IMDb Popular Movies', 'IMDb Popular Shows', 'IMDb Top 250 Movies', 'IMDb Top 250 Shows', 'IMDb Lowest Rated Movies']);
    expect(charts.find((d) => d.name === 'IMDb Top 250 Shows')).toMatchObject({
      target: 'shows', sortTitle: '!020_IMDb Top 250 Shows', overview: 'List of IMDb Top 250 Shows.',
      poster: { kind: 'bundled', key: 'chart-top-shows' },
      sources: [{ type: 'imdb_chart', config: { chart: 'top_shows' } }],
    });
    expect(LEGACY_POSTER.get('imdb_chart:top_shows')).toBe('https://raw.githubusercontent.com/Kometa-Team/Default-Images/master/chart/color/IMDb%20Top%20250.jpg');
  });
});

// ── IMDb charts as a source ──
const CHART_IDS: Record<string, string[]> = { TOP_RATED_MOVIES: ['tt0111161', 'tt0068646', 'tt0468569'], MOST_POPULAR_TV_SHOWS: ['tt0903747', 'tt0944947'] };
function fakeImdb(opts: { refuseFields?: boolean } = {}) {
  const bodies: string[] = [];
  const f: FetchLike = async (url, init) => {
    if (url === 'https://api.graphql.imdb.com/') {
      const body = JSON.parse(String(init?.body)) as { query?: string; extensions?: unknown };
      expect(body.extensions).toBeUndefined(); // a plain query: charts need no persisted-query hash
      bodies.push(body.query!);
      if (opts.refuseFields && body.query!.includes('titleText')) return new Response(JSON.stringify({ errors: [{ message: 'Cannot query field', extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }] }));
      const type = body.query!.match(/chartType: (\w+)/)![1]!;
      const edges = (CHART_IDS[type] ?? []).map((id, i) => ({ node: { id, ...(body.query!.includes('titleText') ? { titleText: { text: `Title ${i + 1}` }, releaseYear: { year: 1990 + i } } : {}) } }));
      return new Response(JSON.stringify({ data: { chartTitles: { edges, total: edges.length } } }));
    }
    if (url === 'https://utilities.kometa.wiki/imdb-service/chart/top_movies') return new Response(JSON.stringify({ results: CHART_IDS.TOP_RATED_MOVIES!.map((tconst) => ({ tconst })) }));
    throw new Error(`unexpected ${url}`);
  };
  return { f, bodies };
}
const chartCtx = (f: FetchLike, route: SourceContext['imdbRoute'], extra: Partial<SourceContext> = {}): SourceContext => ({ db: openDb(':memory:'), fetch: f, tmdb: null, mdblistKey: null, imdbRoute: route, now: () => NOW, ...extra });

describe('IMDb chart source', () => {
  it('reads a chart in rank order with Kometa’s chartTitles query, with titles and years', async () => {
    const { f, bodies } = fakeImdb();
    const r = await resolveSource(chartCtx(f, 'direct'), { type: 'imdb_chart', config: { chart: 'top_movies' } });
    expect(r).toMatchObject({ status: 'ok', label: 'IMDb chart: Top 250 Movies' });
    expect(r.items).toEqual([
      { imdb: 'tt0111161', kind: 'movie', rank: 1, title: 'Title 1', year: 1990 },
      { imdb: 'tt0068646', kind: 'movie', rank: 2, title: 'Title 2', year: 1991 },
      { imdb: 'tt0468569', kind: 'movie', rank: 3, title: 'Title 3', year: 1992 },
    ]);
    expect(bodies[0]).toMatch(/chartTitles\(chart: \{ chartType: TOP_RATED_MOVIES \}, first: 250\)/);
    const shows = await resolveSource(chartCtx(f, 'direct'), { type: 'imdb_chart', config: { chart: 'popular_shows' } });
    expect(shows.items.map((i) => [i.imdb, i.kind])).toEqual([['tt0903747', 'show'], ['tt0944947', 'show']]);
    expect(bodies[1]).toMatch(/MOST_POPULAR_TV_SHOWS \}, first: 100/);
  });

  it('falls back to Kometa’s exact query (IDs only) if IMDb refuses the extra fields', async () => {
    const { f, bodies } = fakeImdb({ refuseFields: true });
    const r = await resolveSource(chartCtx(f, 'direct'), { type: 'imdb_chart', config: { chart: 'top_movies' } });
    expect(r.items.map((i) => i.imdb)).toEqual(CHART_IDS.TOP_RATED_MOVIES);
    expect(bodies[1]).toBe('{ chartTitles(chart: { chartType: TOP_RATED_MOVIES }, first: 250) { edges { node { id } } total } }');
  });

  it('uses Kometa’s service on that route, and the snapshot on the snapshot route', async () => {
    const { f } = fakeImdb();
    const k = await resolveSource(chartCtx(f, 'kometa_service'), { type: 'imdb_chart', config: { chart: 'top_movies' } });
    expect(k.items.map((i) => i.imdb)).toEqual(CHART_IDS.TOP_RATED_MOVIES);

    expect(queriesFor(PRESETS.flatMap((p) => p.definition.sources)).charts?.sort()).toEqual(['lowest_rated', 'popular_movies', 'popular_shows', 'top_movies', 'top_shows']);
    const snap = await buildSnapshot(async (url, init) => (url.includes('IMDb-Hash') ? new Response('h') : f(url, init)), { searches: [], lists: [], charts: ['top_movies', 'nonsense'] }, new Date(NOW));
    expect(snap.charts?.[chartKey('top_movies')]?.titles.map((t) => t.id)).toEqual(CHART_IDS.TOP_RATED_MOVIES);
    expect(Object.keys(snap.errors)).toEqual([chartKey('nonsense')]);
    const served: FetchLike = async (url) => (url === 'https://example.test/snap.json' ? new Response(JSON.stringify(snap)) : new Response('no', { status: 500 }));
    const ctx = chartCtx(served, 'snapshot', { imdbSnapshot: { url: 'https://example.test/snap.json', token: null } });
    expect((await resolveSource(ctx, { type: 'imdb_chart', config: { chart: 'top_movies' } })).items).toHaveLength(3);
    expect(await resolveSource(ctx, { type: 'imdb_chart', config: { chart: 'top_shows' } })).toMatchObject({ status: 'failed', error: expect.stringMatching(/Not in the IMDb snapshot/) });
  });

  it('treats an empty chart as a failure, so the last good one is kept', async () => {
    const { f } = fakeImdb();
    const r = await resolveSource(chartCtx(f, 'direct'), { type: 'imdb_chart', config: { chart: 'lowest_rated' } });
    expect(r).toMatchObject({ status: 'failed', error: expect.stringMatching(/empty Lowest Rated Movies chart/) });
  });
});

// ── streaming collections end to end ──
// What TMDb (JustWatch) says each title streams on, by country: subscription, free and with-ads offers count; rentals don't.
const PROVIDERS: Record<string, Record<string, { flatrate?: number[]; free?: number[]; ads?: number[]; rent?: number[]; buy?: number[] }>> = {
  'movie/603': { US: { flatrate: [8], rent: [2] }, GB: { flatrate: [9] } }, // The Matrix
  'movie/862': { US: { flatrate: [337] }, GB: { flatrate: [337] } }, // Toy Story
  'movie/949': { US: { ads: [73], buy: [3] } }, // Heat
  'movie/550': { US: { rent: [2], buy: [3] } }, // Fight Club: rent or buy only
  'tv/1399': { US: { flatrate: [1899] } }, // Game of Thrones
  'tv/66732': { US: { flatrate: [8] }, FR: { flatrate: [8] } }, // Stranger Things
};

function world() {
  const fake = new FakeJellyfin();
  const film = (Id: string, Name: string, tmdb?: string) => fake.add({ Id, Name, Type: 'Movie', ParentId: 'lib-movies', ProductionYear: 1999, ProviderIds: tmdb ? { Tmdb: tmdb } : {} });
  film('m-matrix', 'The Matrix', '603');
  film('m-toy', 'Toy Story', '862');
  film('m-heat', 'Heat', '949');
  film('m-fight', 'Fight Club', '550');
  film('m-noid', 'Home Video'); // no TMDb ID: can't be looked up
  fake.add({ Id: 's-got', Name: 'Game of Thrones', Type: 'Series', ParentId: 'lib-shows', ProviderIds: { Tmdb: '1399' } });
  fake.add({ Id: 's-st', Name: 'Stranger Things', Type: 'Series', ParentId: 'lib-shows', ProviderIds: { Tmdb: '66732' } });
  const lookups: string[] = [];
  const net: FetchLike = async (url) => {
    if (url.startsWith('https://image.tmdb.org') || url.includes('Default-Images')) return new Response(new Uint8Array([0xff, 0xd8, 1]), { headers: { 'content-type': 'image/jpeg' } });
    const m = url.match(/api\.themoviedb\.org\/3\/(movie|tv)\/(\d+)\/watch\/providers/);
    if (m) {
      lookups.push(`${m[1]}/${m[2]}`);
      const offers = PROVIDERS[`${m[1]}/${m[2]}`] ?? {};
      const as = (ids?: number[]) => ids?.map((provider_id) => ({ provider_id, provider_name: `p${provider_id}` }));
      return new Response(JSON.stringify({ id: Number(m[2]), results: Object.fromEntries(Object.entries(offers).map(([c, o]) => [c, { link: 'x', flatrate: as(o.flatrate), free: as(o.free), ads: as(o.ads), rent: as(o.rent), buy: as(o.buy) }])) }));
    }
    return new Response('[]');
  };
  const config = { ...readConfig({}), configDir: mkdtempSync(join(tmpdir(), 'mc-')), timezone: 'America/New_York', seeds: {} };
  const app = createContext(config, { db: openDb(':memory:'), fetch: net, jellyfinFetch: fake.fetch() });
  app.updateSettings({ connections: { jellyfinUrl: FAKE_URL, plexUrl: '', radarrUrl: '', sonarrUrl: '' }, firstRunDone: true });
  app.secrets.set('jellyfin.apiKey', fake.apiKey);
  app.secrets.set('tmdb.apiKey', 'k');
  app.db.update(definition).set({ enabled: false }).run();
  const enable = (...slugs: string[]) => { for (const slug of slugs) app.db.update(definition).set({ enabled: true }).where(eq(definition.slug, slug)).run(); };
  const defId = (slug: string) => app.db.select().from(definition).where(eq(definition.slug, slug)).get()!.id;
  const proposedTitles = (slug: string) => app.db.select().from(action).where(eq(action.definitionId, defId(slug))).all()
    .filter((a) => a.type === 'collection.add_items' && (a.status === 'proposed' || a.status === 'approved')).map((a) => a.item!.name).sort();
  return { fake, app, lookups, enable, defId, proposedTitles };
}

describe('Streaming collections', () => {
  it('asks TMDb once per title you own, then holds the titles on each service in your country', async () => {
    const { app, lookups, enable, proposedTitles, defId } = world();
    enable('streaming-netflix-movies', 'streaming-netflix-shows', 'streaming-disney-movies', 'streaming-tubi-movies', 'streaming-hbomax-shows', 'streaming-amazon-movies');
    const r = await runPipeline(app, { job: 'manual', trigger: 'manual', index: true, now: NOW });
    expect(r.status).toBe('ok');
    expect(lookups.sort()).toEqual(['movie/550', 'movie/603', 'movie/862', 'movie/949', 'tv/1399', 'tv/66732']); // not the film with no TMDb ID
    expect(r.stats).toMatchObject({ streamingLookups: 6, streamingWaiting: 0 });
    expect(proposedTitles('streaming-netflix-movies')).toEqual(['The Matrix']);
    expect(proposedTitles('streaming-netflix-shows')).toEqual(['Stranger Things']);
    expect(proposedTitles('streaming-disney-movies')).toEqual(['Toy Story']);
    expect(proposedTitles('streaming-tubi-movies')).toEqual(['Heat']); // free with ads counts
    expect(proposedTitles('streaming-hbomax-shows')).toEqual(['Game of Thrones']);
    // Prime Video has none in the US here: below its minimum of 1, so no box set is proposed.
    expect(app.db.select().from(action).where(eq(action.definitionId, defId('streaming-amazon-movies'))).all()).toEqual([]);

    // Within the week: no new lookups. After it: each title again.
    lookups.length = 0;
    await runPipeline(app, { job: 'manual', trigger: 'manual', index: true, now: NOW + DAY });
    expect(lookups).toEqual([]);
    await runPipeline(app, { job: 'manual', trigger: 'manual', index: true, now: NOW + 8 * DAY });
    expect(lookups).toHaveLength(6);
  });

  it('follows the country setting, with lookups kept per country', async () => {
    const { app, lookups, enable, proposedTitles } = world();
    enable('streaming-amazon-movies', 'streaming-netflix-shows');
    applySettings(app, { streamingRegion: 'gb' });
    expect(app.settings().streaming.region).toBe('GB');
    await runPipeline(app, { job: 'manual', trigger: 'manual', index: true, now: NOW });
    expect(proposedTitles('streaming-amazon-movies')).toEqual(['The Matrix']);
    expect(proposedTitles('streaming-netflix-shows')).toEqual([]);
    lookups.length = 0;
    applySettings(app, { streamingRegion: 'FR' });
    await runPipeline(app, { job: 'manual', trigger: 'manual', index: true, now: NOW + DAY });
    expect(lookups).toHaveLength(6); // FR asked for afresh; GB's answers are kept for GB
    expect(proposedTitles('streaming-netflix-shows')).toEqual(['Stranger Things']);
    expect(app.db.select().from(tmdbCache).where(like(tmdbCache.key, 'providers:GB:%')).all()).toHaveLength(6);
    expect(() => applySettings(app, { streamingRegion: 'USA' })).toThrow(SettingsError);
  });

  it('fills a big library over several runs, removing nothing until every title has been checked', async () => {
    const { app, lookups, enable, defId } = world();
    enable('streaming-netflix-movies');
    const { refreshWatchProviders } = await import('../src/sources/watch-providers.js');
    const { indexLibrary } = await import('../src/library/indexer.js');
    await indexLibrary(app.db, app.jellyfin()!, () => {});
    const first = await refreshWatchProviders(app.db, app.tmdb(), { region: 'US', kinds: new Set(['movie']), now: NOW, cap: 2 });
    expect(first).toEqual({ lookedUp: 2, waiting: 2, problem: null });
    await runPipeline(app, { job: 'manual', trigger: 'manual', index: false, now: NOW }); // the run checks 600 more: all done
    expect(lookups).toHaveLength(4);
    const sum = getPlanSummary(app.db)!.defs[String(defId('streaming-netflix-movies'))]!;
    expect(sum.blocked).toBe(false);
    expect(sum.sources[0]).toMatchObject({ status: 'ok', label: 'Streaming on Netflix', matched: 1 });
  });

  it('says it needs a TMDb key rather than failing the run', async () => {
    const { app, enable } = world();
    app.secrets.clear('tmdb.apiKey');
    enable('streaming-netflix-movies');
    const r = await runPipeline(app, { job: 'manual', trigger: 'manual', index: true, now: NOW });
    expect(r.status).toBe('ok');
    expect(r.stats.streamingWaiting).toBe(4);
    expect(getPlanSummary(app.db)!.defs[String(app.db.select().from(definition).where(eq(definition.slug, 'streaming-netflix-movies')).get()!.id)]!.blocked).toBe(true);
  });
});

describe('Streaming and chart sources in the editor and Getting started', () => {
  it('parses an IMDb chart or a streaming service for a custom collection', () => {
    expect(parseSourceInput('imdb_chart', 'top', 'shows')).toEqual({ type: 'imdb_chart', config: { chart: 'top_shows' } });
    expect(parseSourceInput('imdb_chart', 'Popular', 'movies')).toEqual({ type: 'imdb_chart', config: { chart: 'popular_movies' } });
    expect(parseSourceInput('imdb_chart', 'lowest_rated', 'movies')).toEqual({ type: 'imdb_chart', config: { chart: 'lowest_rated' } });
    expect(parseSourceInput('imdb_chart', 'lowest', 'shows')).toMatch(/Enter one IMDb chart/);
    expect(parseSourceInput('streaming_service', 'disney+', 'shows')).toEqual({ type: 'tmdb_watch_provider', config: { service: 'disney', kind: 'show' } });
    expect(parseSourceInput('streaming_service', 'Netflix', 'both')).toMatch(/movies or of shows/);
    expect(parseSourceInput('streaming_service', 'Blockbuster', 'movies')).toMatch(/Enter one streaming service/);
  });

  it('turns on only the services offered in your country, and the charts', async () => {
    const { app, web, fake } = setup();
    await web.request('/setup', form({ url: FAKE_URL, apiKey: fake.apiKey, setupCode: app.setupCode ?? '' }));
    const { cookie } = await signIn(web);
    const csrf = await csrfOf(web, cookie, '/start');
    const page = await (await web.request('/start?step=4', { headers: { cookie } })).text();
    expect(page).toContain('Streaming services');
    expect(page).toContain('5 collections of the titles you own from IMDb’s charts');
    expect(page).toContain('41 collections of the titles you own that stream on a service in your country (US');
    const body = new URLSearchParams({ _csrf: csrf });
    for (const f of ['seasonal', 'streaming', 'imdb_chart']) body.append('families', f);
    const res = await web.request('/start/families', { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    expect(res.status).toBe(302);
    const on = app.db.select().from(definition).all().filter((d) => d.enabled).map((d) => d.slug);
    expect(on).toContain('streaming-netflix-movies');
    expect(on).toContain('streaming-hbomax-shows');
    expect(on).not.toContain('streaming-channel4-movies'); // UK only
    expect(on).not.toContain('streaming-crave-shows'); // Canada only
    expect(on).toContain('chart-top-movies');
    expect(on).toContain('chart-lowest-rated');
    expect(on.filter((s) => s.startsWith('universe-'))).toEqual([]);

    // The country is set in Settings → Libraries and region.
    const settingsPage = await (await web.request('/settings/libraries', { headers: { cookie } })).text();
    expect(settingsPage).toMatch(/name="streamingRegion"[^>]*value="US"/);
    expect(settingsPage).toContain('Streaming data from JustWatch, through TMDb.');
  });
});
