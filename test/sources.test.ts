import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db/index.js';
import { resolveSource, sourceKey, type SourceContext } from '../src/sources/index.js';
import { indexLibrary } from '../src/library/indexer.js';
import { JellyfinClient } from '../src/clients/jellyfin/index.js';
import { LibraryIndex, type LibRow } from '../src/domain/matching.js';
import { libraryItem } from '../src/db/schema.js';
import { FakeJellyfin, FAKE_URL } from './fakes/jellyfin.js';
import type { FetchLike } from '../src/clients/http.js';

function ctxWith(f: FetchLike, extra: Partial<SourceContext> = {}): SourceContext {
  return { db: openDb(':memory:'), fetch: f, tmdb: null, mdblistKey: null, imdbRoute: 'direct', politeDelayMs: 0, ...extra };
}

const mdblistJson = JSON.stringify([
  { id: 771, imdb_id: 'tt0099785', mediatype: 'movie', title: 'Home Alone', release_year: 1990, rank: 1 },
  { id: 10719, imdb_id: 'tt0319343', mediatype: 'movie', title: 'Elf', release_year: 2003, rank: 2 },
]);

describe('source cache (ADR-008)', () => {
  const spec = { type: 'mdblist_list', config: { url: 'https://mdblist.com/lists/k0meta/christmas-extravaganza' } };

  it('fetches, caches for a day, and reuses the cached result', async () => {
    let calls = 0;
    const ctx = ctxWith(async () => { calls++; return new Response(mdblistJson); });
    const a = await resolveSource(ctx, spec);
    const b = await resolveSource(ctx, spec);
    expect(a.status).toBe('ok');
    expect(a.items.map((i) => i.imdb)).toEqual(['tt0099785', 'tt0319343']);
    expect(b.items).toHaveLength(2);
    expect(calls).toBe(1);
  });

  it('serves the last good result, marked stale, when the source fails', async () => {
    let fail = false;
    const ctx = ctxWith(async () => (fail ? new Response('rate limited', { status: 429 }) : new Response(mdblistJson)));
    await resolveSource(ctx, spec);
    fail = true;
    const r = await resolveSource(ctx, spec, { force: true });
    expect(r.status).toBe('stale');
    expect(r.items).toHaveLength(2);
    expect(r.error).toMatch(/429/);
  });

  it('is failed (no items) when it has never succeeded', async () => {
    const ctx = ctxWith(async () => new Response('nope', { status: 500 }));
    const r = await resolveSource(ctx, spec);
    expect(r.status).toBe('failed');
    expect(r.items).toEqual([]);
  });
});

describe('Letterboxd adapter (ADR-023)', () => {
  it('reads list pages, then resolves each film page once and caches the IDs', async () => {
    let filmFetches = 0;
    const ctx = ctxWith(async (url) => {
      if (url.endsWith('/list/black-is-beautiful/')) return new Response('<li data-film-slug="selma"></li><li data-target-link="/film/moonlight/"></li>');
      if (url.includes('/page/')) return new Response('<p>no more</p>');
      filmFetches++;
      if (url.includes('/film/selma/')) return new Response('<a href="http://www.imdb.com/title/tt1020072/maindetails">IMDb</a><a href="https://www.themoviedb.org/movie/273895/">TMDb</a>');
      return new Response('<a href="http://www.imdb.com/title/tt4975722/">IMDb</a>');
    });
    const spec = { type: 'letterboxd_list', config: { url: 'https://letterboxd.com/mardarrius/list/black-is-beautiful/' } };
    const r = await resolveSource(ctx, spec);
    expect(r.items.map((i) => i.imdb)).toEqual(['tt1020072', 'tt4975722']);
    await resolveSource(ctx, spec, { force: true });
    expect(filmFetches).toBe(2);
  });

  it('reports a Cloudflare challenge as a failure', async () => {
    const ctx = ctxWith(async () => new Response('<title>Just a moment...</title>', { status: 403, headers: { 'cf-mitigated': 'challenge' } }));
    const r = await resolveSource(ctx, { type: 'letterboxd_list', config: { url: 'https://letterboxd.com/a/list/b' } });
    expect(r.status).toBe('failed');
    expect(r.error).toMatch(/Cloudflare/);
  });
});

describe('library indexer + matching', () => {
  it('indexes movies, series and episodes with provider IDs and matches by ID only', async () => {
    const fake = new FakeJellyfin();
    fake.add({ Id: 'm1', Name: 'Home Alone', Type: 'Movie', ParentId: 'lib-movies', ProviderIds: { Imdb: 'tt0099785', Tmdb: '771' } });
    fake.add({ Id: 'm2', Name: 'Mickey', Type: 'Movie', ParentId: 'lib-animated', ProviderIds: { Tmdb: '555' } });
    fake.add({ Id: 's1', Name: 'Friends', Type: 'Series', ParentId: 'lib-shows', ProviderIds: { Imdb: 'tt0108778', Tmdb: '1668', Tvdb: '79168' } });
    fake.add({ Id: 'e1', Name: 'The One with the Holiday Armadillo', Type: 'Episode', SeriesId: 's1', ParentIndexNumber: 7, IndexNumber: 10, ProviderIds: {} });
    const db = openDb(':memory:');
    const stats = await indexLibrary(db, new JellyfinClient({ baseUrl: FAKE_URL, apiKey: fake.apiKey, fetch: fake.fetch() }));
    expect(stats).toMatchObject({ libraries: 3, movies: 2, series: 1, episodes: 1 });

    const idx = new LibraryIndex(db.select().from(libraryItem).all() as LibRow[]);
    expect(idx.matchDirect({ imdb: 'tt0099785', kind: 'movie', rank: 3 }, 'movie')).toMatchObject({ jfId: 'm1', method: 'IMDb tt0099785' });
    expect(idx.matchDirect({ tmdb: '555', kind: 'movie', rank: 1 }, 'movie')).toMatchObject({ jfId: 'm2', method: 'TMDb 555' });
    expect(idx.matchDirect({ title: 'Home Alone', kind: 'movie', rank: 1 }, 'movie')).toBeNull();
    expect(idx.matchFound({ imdb: 'tt0583599', kind: 'episode', rank: 1 }, { kind: 'episode', showTmdb: '1668', season: 7, episode: 10 }, 'episode'))
      .toMatchObject({ jfId: 'e1', method: 'series TMDb 1668 S07E10' });

    // A film removed from Jellyfin disappears from the index on the next complete pass.
    fake.items.delete('m2');
    const again = await indexLibrary(db, new JellyfinClient({ baseUrl: FAKE_URL, apiKey: fake.apiKey, fetch: fake.fetch() }));
    expect(again.removed).toBe(1);
  });
});

describe('source keys', () => {
  it('differ when nested search settings differ, and ignore key order', () => {
    const a = sourceKey({ type: 'imdb_search', config: { search: { 'keyword.any': 'thanksgiving', limit: 500 } } });
    const b = sourceKey({ type: 'imdb_search', config: { search: { 'list.any': ['ls1'], limit: 500 } } });
    const c = sourceKey({ type: 'imdb_search', config: { search: { limit: 500, 'keyword.any': 'thanksgiving' } } });
    expect(a).not.toBe(b);
    expect(a).toBe(c);
  });
});

describe('Letterboxd lookup cap', () => {
  it('resolves at most N new films per run and marks the result partial', async () => {
    const page = Array.from({ length: 5 }, (_, i) => `<li data-film-slug="film-${i}"></li>`).join('');
    const ctx = ctxWith(async (url) => {
      if (url.endsWith('/list/x/')) return new Response(page);
      if (url.includes('/page/')) return new Response('');
      const n = url.match(/film-(\d)/)?.[1];
      return new Response(`<a href="https://www.imdb.com/title/tt000000${n}/">IMDb</a>`);
    }, { letterboxdLookupsPerRun: 2 });
    const spec = { type: 'letterboxd_list', config: { url: 'https://letterboxd.com/a/list/x/' } };
    const first = await resolveSource(ctx, spec);
    expect(first.items).toHaveLength(2);
    expect(first.meta).toMatchObject({ partial: true, unresolved: 3 });
    const second = await resolveSource(ctx, spec, { force: true });
    expect(second.items).toHaveLength(4);
    const third = await resolveSource(ctx, spec, { force: true });
    expect(third.items).toHaveLength(5);
    expect(third.meta).toMatchObject({ partial: false });
  });
});
