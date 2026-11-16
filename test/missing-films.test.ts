// Missing lists films and series only: IMDb's shorts, TV specials, games and music videos are left out.
import { describe, expect, it } from 'vitest';
import { missingTitles } from '../src/domain/missing.js';
import { LibraryIndex } from '../src/domain/matching.js';
import type { LoadedDefinition } from '../src/domain/definitions.js';
import type { ResolvedSource } from '../src/sources/index.js';
import type { SourceItem } from '../src/db/schema.js';
import { openDb } from '../src/db/index.js';
import { TmdbClient } from '../src/clients/tmdb.js';

const def = (target: 'movies' | 'shows') => ({ id: 1, name: 'Christmas', target, sources: [{ type: 'imdb_search', role: 'add', config: {} }] }) as unknown as LoadedDefinition;
const source = (items: SourceItem[]): ResolvedSource[] => [{ key: 'k', label: 'IMDb keyword christmas', status: 'ok', items, error: null, fetchedAt: 1, meta: null }];
const item = (n: number, imdbType: string | undefined, kind: SourceItem['kind']): SourceItem => ({ imdb: `tt${n}`, kind, rank: n, title: `Title ${n}`, imdbType });

describe('missing titles', () => {
  const index = new LibraryIndex([]);
  it('keeps films and leaves out shorts, specials, games and music videos', () => {
    const items = [item(1, 'movie', 'movie'), item(2, 'short', 'other'), item(3, 'tvMovie', 'movie'), item(4, 'tvSpecial', 'other'), item(5, 'videoGame', 'other'),
      item(6, 'musicVideo', 'other'), item(7, 'video', 'movie'), item(8, 'tvShort', 'other'), item(9, undefined, 'other')];
    const got = missingTitles(def('movies'), source(items), index, () => undefined).map((m) => m.imdb);
    expect(got).toEqual(['tt1', 'tt3', 'tt7', 'tt9']); // tt9: a source that gives no type is still listed
  });
  it('leaves them out of show collections too', () => {
    const got = missingTitles(def('shows'), source([item(1, 'tvSeries', 'show'), item(2, 'tvSpecial', 'other'), item(3, 'tvMiniSeries', 'show')]), index, () => undefined).map((m) => m.imdb);
    expect(got).toEqual(['tt1', 'tt3']);
  });
});

describe('TMDb posters', () => {
  it('keeps the poster that comes with an IMDb lookup, so it is asked for once', async () => {
    const calls: string[] = [];
    const f = async (url: string | URL | Request) => {
      calls.push(String(url).replace(/\?.*$/, '').replace('https://api.themoviedb.org/3', ''));
      return new Response(JSON.stringify(String(url).includes('/find/')
        ? { movie_results: [{ id: 603, poster_path: '/matrix.jpg' }], tv_results: [], tv_episode_results: [] }
        : { poster_path: '/other.jpg' }), { headers: { 'content-type': 'application/json' } });
    };
    const tmdb = new TmdbClient(openDb(':memory:'), 'k', f as typeof fetch);
    const found = await tmdb.find('tt0133093');
    expect(found).toEqual({ kind: 'movie', tmdb: '603' });
    expect(await tmdb.poster('movie', '603')).toBe('/matrix.jpg');
    expect(await tmdb.poster('movie', '604')).toBe('/other.jpg');
    expect(await tmdb.poster('movie', '604')).toBe('/other.jpg');
    expect(calls).toEqual(['/find/tt0133093', '/movie/604']);
  });
});
