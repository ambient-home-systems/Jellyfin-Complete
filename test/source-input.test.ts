import { describe, it, expect } from 'vitest';
import { parseSourceInput } from '../src/domain/source-input.js';
import { resolveSource, type SourceContext } from '../src/sources/index.js';
import { TmdbClient } from '../src/clients/tmdb.js';
import { openDb } from '../src/db/index.js';
import type { FetchLike } from '../src/clients/http.js';

describe('source input from the editor', () => {
  it('accepts IDs or the URL from the browser', () => {
    expect(parseSourceInput('imdb_list', 'https://www.imdb.com/list/ls066838460/?ref_=x', 'movies')).toEqual({ type: 'imdb_list', config: { listId: 'ls066838460' } });
    expect(parseSourceInput('imdb_list', 'ls032692441, ls000094398', 'movies')).toEqual({ type: 'imdb_search', config: { search: { 'list.any': ['ls032692441', 'ls000094398'], limit: 500 } } });
    expect(parseSourceInput('tmdb_collection', 'https://www.themoviedb.org/collection/1575-halloween-collection, 8091', 'movies')).toEqual({ type: 'tmdb_collection', config: { ids: ['1575', '8091'] } });
    expect(parseSourceInput('tmdb_list', 'https://www.themoviedb.org/list/8136-christmas', 'movies')).toEqual({ type: 'tmdb_list', config: { listId: '8136' } });
    expect(parseSourceInput('letterboxd_list', 'https://letterboxd.com/mardarrius/list/black-is-beautiful', 'movies')).toEqual({ type: 'letterboxd_list', config: { url: 'https://letterboxd.com/mardarrius/list/black-is-beautiful/' } });
    expect(parseSourceInput('mdblist_list', 'https://mdblist.com/lists/k0meta/christmas-extravaganza/', 'movies')).toEqual({ type: 'mdblist_list', config: { url: 'https://mdblist.com/lists/k0meta/christmas-extravaganza' } });
  });

  it('shapes keyword searches like Kometa, typed by what the collection contains', () => {
    expect(parseSourceInput('imdb_keyword', 'Santa Claus, christmas', 'movies')).toEqual({ type: 'imdb_search', config: { search: { 'keyword.any': ['santa-claus', 'christmas'], type: ['movie'], limit: 500 } } });
    expect(parseSourceInput('imdb_keyword', 'heist', 'shows')).toMatchObject({ config: { search: { type: ['tv_series', 'tv_mini_series'] } } });
    expect(parseSourceInput('tmdb_keyword', 'christmas, 207317', 'shows')).toEqual({ type: 'tmdb_keyword', config: { keywords: ['christmas', '207317'], media: 'tv' } });
    expect(parseSourceInput('jellyfin_tags', 'xmas', 'shows')).toEqual({ type: 'jellyfin_query', config: { tags: ['xmas'], kind: 'series' } });
  });

  it('explains what it expected', () => {
    expect(parseSourceInput('imdb_list', 'https://www.imdb.com/title/tt0099785/', 'movies')).toMatch(/IMDb list ID/);
    expect(parseSourceInput('mdblist_list', 'https://example.com/list', 'movies')).toMatch(/MDBList list URL/);
    expect(parseSourceInput('tmdb_list', '1, 2', 'movies')).toMatch(/one TMDb list/);
    expect(parseSourceInput('nope', 'x', 'movies')).toMatch(/Choose a source type/);
    expect(parseSourceInput('tmdb_movie', '  ', 'movies')).toMatch(/Enter a value/);
  });
});

describe('TMDb keyword and list sources', () => {
  function ctx(routes: Record<string, unknown>): { ctx: SourceContext; calls: string[] } {
    const calls: string[] = [];
    const f: FetchLike = async (url) => {
      const path = url.replace('https://api.themoviedb.org/3', '').replace(/[?&]api_key=[^&]+/, '');
      calls.push(path);
      const hit = Object.entries(routes).find(([p]) => path.startsWith(p));
      return hit ? new Response(JSON.stringify(hit[1])) : new Response('{}', { status: 404 });
    };
    const db = openDb(':memory:');
    return { ctx: { db, fetch: f, tmdb: new TmdbClient(db, 'k', f), mdblistKey: null, imdbRoute: 'direct' }, calls };
  }

  it('resolves keyword names, then discovers titles page by page', async () => {
    const { ctx: c, calls } = ctx({
      '/search/keyword?query=christmas': { results: [{ id: 999, name: 'christmas party' }, { id: 207317, name: 'Christmas' }] },
      '/discover/movie?with_keywords=207317|1234&sort_by=popularity.desc&include_adult=false&page=1': { total_pages: 2, results: [{ id: 771, title: 'Home Alone', release_date: '1990-11-16' }] },
      '/discover/movie?with_keywords=207317|1234&sort_by=popularity.desc&include_adult=false&page=2': { total_pages: 2, results: [{ id: 10719, title: 'Elf', release_date: '2003-10-09' }] },
    });
    const r = await resolveSource(c, { type: 'tmdb_keyword', config: { keywords: ['christmas', '1234'], media: 'movie' } });
    expect(r.status).toBe('ok');
    expect(r.items).toEqual([
      { tmdb: '771', kind: 'movie', rank: 1, title: 'Home Alone', year: 1990 },
      { tmdb: '10719', kind: 'movie', rank: 2, title: 'Elf', year: 2003 },
    ]);
    expect(calls.filter((p) => p.startsWith('/discover'))).toHaveLength(2);
  });

  it('fails clearly for an unknown keyword, and without a TMDb key', async () => {
    const { ctx: c } = ctx({ '/search/keyword': { results: [] } });
    const r = await resolveSource(c, { type: 'tmdb_keyword', config: { keywords: ['zzzz'] } });
    expect(r).toMatchObject({ status: 'failed', error: expect.stringMatching(/no keyword "zzzz"/) });
    const r2 = await resolveSource({ ...c, tmdb: null }, { type: 'tmdb_list', config: { listId: '1' } });
    expect(r2.error).toMatch(/TMDb key not set/);
  });

  it('reads a list in order, films and shows, skipping people', async () => {
    const { ctx: c } = ctx({
      '/list/8136?page=1': { total_pages: 1, items: [
        { id: 771, media_type: 'movie', title: 'Home Alone', release_date: '1990-11-16' },
        { id: 1399, media_type: 'tv', name: 'Game of Thrones', first_air_date: '2011-04-17' },
        { id: 31, media_type: 'person', name: 'Tom Hanks' },
        { id: 1100, name: 'How I Met Your Mother' },
      ] },
    });
    const r = await resolveSource(c, { type: 'tmdb_list', config: { listId: '8136' } });
    expect(r.items.map((i) => [i.tmdb, i.kind, i.rank])).toEqual([['771', 'movie', 1], ['1399', 'show', 2], ['1100', 'show', 3]]);
  });
});
