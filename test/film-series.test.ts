// Film series (ADR-035): a collection per TMDb film series owned at least twice, from Jellyfin's TmdbCollection IDs (or
// TMDb when Jellyfin has none), named and illustrated from TMDb, with Kometa's add-ons; and adopting Jellyfin's own sets.
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, like } from 'drizzle-orm';
import { openDb } from '../src/db/index.js';
import { createContext } from '../src/app-context.js';
import { readConfig } from '../src/config.js';
import { runPipeline } from '../src/pipeline/run.js';
import { setFilmSeries } from '../src/pipeline/film-series.js';
import { adoptionCandidates, adoptSuggested } from '../src/pipeline/adoption.js';
import { reviewVerdict } from '../src/web/review-actions.js';
import { getPlanSummary } from '../src/pipeline/summary.js';
import { action, definition, definitionSource } from '../src/db/schema.js';
import { FakeJellyfin, FAKE_URL } from './fakes/jellyfin.js';
import type { FetchLike } from '../src/clients/http.js';

const NOW = Date.UTC(2026, 10, 20, 15);
const COLLECTIONS: Record<string, { name: string; poster_path: string; parts: number[] }> = {
  '10194': { name: 'Toy Story Collection', poster_path: '/toy.jpg', parts: [862, 863, 10193, 301528] },
  '8091': { name: 'Alien Collection', poster_path: '/alien.jpg', parts: [348, 679] },
  '135416': { name: 'Prometheus Collection', poster_path: '/prom.jpg', parts: [70981, 126889] },
  '404609': { name: 'John Wick Collection', poster_path: '/jw.jpg', parts: [245891, 324552] },
};

function world(opts: { jellyfinKnowsSeries?: boolean } = {}) {
  const known = opts.jellyfinKnowsSeries ?? true;
  const fake = new FakeJellyfin();
  const film = (Id: string, Name: string, tmdb: number, series?: string) => fake.add({ Id, Name, Type: 'Movie', ParentId: 'lib-movies', ProductionYear: 2000, ProviderIds: { Tmdb: String(tmdb), ...(known && series ? { TmdbCollection: series } : {}) } });
  film('m-ts1', 'Toy Story', 862, '10194');
  film('m-ts2', 'Toy Story 2', 863, '10194');
  film('m-ts3', 'Toy Story 3', 10193, '10194');
  film('m-alien', 'Alien', 348, '8091');
  film('m-prom', 'Prometheus', 70981, '135416'); // an add-on series: counts toward Alien
  film('m-jw', 'John Wick', 245891, '404609'); // only one of its series: no collection
  film('m-solo', 'Heat', 949); // no series
  const tmdbCalls: string[] = [];
  const net: FetchLike = async (url) => {
    if (url.includes('IMDb-Hash')) return new Response('h');
    if (url.startsWith('https://image.tmdb.org')) return new Response(new Uint8Array([0xff, 0xd8, 1]), { headers: { 'content-type': 'image/jpeg' } });
    const coll = url.match(/api\.themoviedb\.org\/3\/collection\/(\d+)/);
    if (coll) {
      tmdbCalls.push(`collection ${coll[1]}`);
      const c = COLLECTIONS[coll[1]!];
      return c ? new Response(JSON.stringify({ ...c, overview: `All of ${c.name}`, parts: c.parts.map((id) => ({ id, title: `Film ${id}`, release_date: '2000-01-01' })) })) : new Response('{}', { status: 404 });
    }
    const movie = url.match(/api\.themoviedb\.org\/3\/movie\/(\d+)/);
    if (movie) {
      tmdbCalls.push(`movie ${movie[1]}`);
      const series = Object.entries(COLLECTIONS).find(([, c]) => c.parts.includes(Number(movie[1])))?.[0];
      return new Response(JSON.stringify({ id: Number(movie[1]), belongs_to_collection: series ? { id: Number(series) } : null }));
    }
    return new Response('[]');
  };
  const config = { ...readConfig({}), configDir: mkdtempSync(join(tmpdir(), 'mc-')), timezone: 'America/New_York', seeds: {} };
  const app = createContext(config, { db: openDb(':memory:'), fetch: net, jellyfinFetch: fake.fetch() });
  app.updateSettings({ connections: { jellyfinUrl: FAKE_URL, plexUrl: '', radarrUrl: '', sonarrUrl: '' }, firstRunDone: true });
  app.secrets.set('jellyfin.apiKey', fake.apiKey);
  app.secrets.set('tmdb.apiKey', 'k');
  app.db.update(definition).set({ enabled: false }).run(); // only film series in these tests
  return { fake, app, tmdbCalls };
}

const seriesDefs = (app: ReturnType<typeof world>['app']) => app.db.select().from(definition).where(like(definition.presetKey, 'film_series:%')).all();

describe('Film series', () => {
  it('stays off until turned on', async () => {
    const { app } = world();
    await runPipeline(app, { job: 'manual', trigger: 'manual', index: true, now: NOW });
    expect(seriesDefs(app)).toEqual([]);
  });

  it('makes a collection per series owned at least twice, Kometa-style, and fills it on approval', async () => {
    const { app, fake } = world();
    setFilmSeries(app, true);
    await runPipeline(app, { job: 'manual', trigger: 'manual', index: true, now: NOW });
    const defs = seriesDefs(app);
    expect(defs.map((d) => d.name).sort()).toEqual(['Alien', 'Toy Story']); // "Collection" dropped; John Wick has one film
    const toy = defs.find((d) => d.name === 'Toy Story')!;
    expect(toy).toMatchObject({ enabled: true, minItems: 2, sortBy: 'release', overview: 'All of Toy Story Collection', poster: { kind: 'url', url: 'https://image.tmdb.org/t/p/original/toy.jpg' } });
    const alien = defs.find((d) => d.name === 'Alien')!;
    expect(app.db.select().from(definitionSource).where(eq(definitionSource.definitionId, alien.id)).all().map((s) => s.config)).toEqual([{ ids: ['8091', '135416'] }]);
    const sum = getPlanSummary(app.db)!.defs;
    expect(sum[String(toy.id)]!.members).toBe(3);
    expect(sum[String(alien.id)]!.members).toBe(2); // Alien plus Prometheus

    // Dry run is on, so it waits in Review; approving the create builds it in release order with its titles.
    const create = app.db.select().from(action).where(eq(action.definitionId, toy.id)).all().find((a) => a.type === 'collection.create')!;
    await reviewVerdict(app, [create.id], 'approve', 'admin');
    const box = fake.boxSets().find((b) => b.Name === 'Toy Story')!;
    expect(box.children!.sort()).toEqual(['m-ts1', 'm-ts2', 'm-ts3']);
    expect(box.DisplayOrder).toBe('PremiereDate');

    // A second run adds nothing new and asks TMDb for nothing new (cached).
    await runPipeline(app, { job: 'manual', trigger: 'manual', index: true, now: NOW + 86_400_000 });
    expect(seriesDefs(app)).toHaveLength(2);
  });

  it('asks TMDb which series a film belongs to only when Jellyfin records none', async () => {
    const { app, tmdbCalls } = world({ jellyfinKnowsSeries: false });
    setFilmSeries(app, true);
    await runPipeline(app, { job: 'manual', trigger: 'manual', index: true, now: NOW });
    expect(seriesDefs(app).map((d) => d.name).sort()).toEqual(['Alien', 'Toy Story']);
    expect(tmdbCalls.filter((c) => c.startsWith('movie'))).toHaveLength(7);
    tmdbCalls.length = 0;
    await runPipeline(app, { job: 'manual', trigger: 'manual', index: true, now: NOW + 3_600_000 });
    expect(tmdbCalls.filter((c) => c.startsWith('movie'))).toEqual([]); // cached
  });

  it('offers Jellyfin\'s own series box sets for adoption, by TMDb ID or name, and adopts them all at once', async () => {
    const { app, fake } = world();
    fake.add({ Id: 'bs-toy', Name: 'Toy Story Collection', Type: 'BoxSet', ParentId: 'lib-collections', ProviderIds: { Tmdb: '10194' }, children: ['m-ts1', 'm-ts2'] });
    fake.add({ Id: 'bs-alien', Name: 'Alien Collection', Type: 'BoxSet', ParentId: 'lib-collections', children: ['m-alien'] });
    setFilmSeries(app, true);
    await runPipeline(app, { job: 'manual', trigger: 'manual', index: true, now: NOW });
    const c = await adoptionCandidates(app);
    expect(c.filter((x) => x.suggestion === 'adopt').map((x) => [x.name, x.definitionName]).sort()).toEqual([['Alien Collection', 'Alien'], ['Toy Story Collection', 'Toy Story']]);
    expect(await adoptSuggested(app, 'admin')).toEqual({ adopted: 2, failed: [] });
    expect(await adoptionCandidates(app)).toEqual([]);
  });

  it('turning it off turns every film series collection off', async () => {
    const { app } = world();
    setFilmSeries(app, true);
    await runPipeline(app, { job: 'manual', trigger: 'manual', index: true, now: NOW });
    setFilmSeries(app, false);
    expect(seriesDefs(app).every((d) => !d.enabled)).toBe(true);
    expect(app.settings().filmSeries.enabled).toBe(false);
  });
});
