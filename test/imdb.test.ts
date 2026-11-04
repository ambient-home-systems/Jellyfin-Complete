import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { searchConstraints, searchSort, searchLimit, imdbList, imdbSearch, ImdbError, type Fetch } from '../src/imdb/index.js';

describe('IMDb resolver portability', () => {
  it('src/imdb uses no node: imports, so it runs in a Worker or Action (ADR-028)', () => {
    const dir = join(__dirname, '..', 'src', 'imdb');
    for (const f of readdirSync(dir)) expect(readFileSync(join(dir, f), 'utf8')).not.toMatch(/from ['"]node:|require\(['"]node:/);
  });
});

describe('Kometa → AdvancedTitleSearch mapping', () => {
  it('list.any becomes listConstraint.inAnyList with an empty type filter (Kometa seasonal)', () => {
    expect(searchConstraints({ 'list.any': ['ls546214737', 'ls023118929'], limit: 500 })).toEqual({
      titleTypeConstraint: { anyTitleTypeIds: [] },
      listConstraint: { inAnyList: ['ls546214737', 'ls023118929'] },
    });
  });

  it('keyword.any splits on commas and hyphenates spaces, like Kometa', () => {
    expect(searchConstraints({ type: 'movie', 'keyword.any': "women in film, women's rights" })).toEqual({
      titleTypeConstraint: { anyTitleTypeIds: ['movie'] },
      keywordConstraint: { anyKeywords: ['women-in-film', "women's-rights"] },
    });
  });

  it('maps tv_episode and series scoping for holiday episodes', () => {
    expect(searchConstraints({ type: 'tv_episode', 'keyword.any': 'christmas', 'series.any': ['tt0108778'] })).toEqual({
      titleTypeConstraint: { anyTitleTypeIds: ['tvEpisode'] },
      keywordConstraint: { anyKeywords: ['christmas'] },
      episodicConstraint: { anySeriesIds: ['tt0108778'] },
    });
  });

  it('sorts by popularity ascending and limits to 100 unless told otherwise', () => {
    expect(searchSort({})).toEqual({ sortBy: 'POPULARITY', sortOrder: 'ASC' });
    expect(searchSort({ sort_by: 'rating.desc' })).toEqual({ sortBy: 'USER_RATING', sortOrder: 'DESC' });
    expect(searchLimit({})).toBe(100);
    expect(searchLimit({ limit: 500 })).toBe(500);
  });

  it('rejects unknown title types', () => {
    expect(() => searchConstraints({ type: 'opera' })).toThrow(ImdbError);
  });
});

/** A tiny GraphQL stand-in that pages through fixed results. */
function fakeImdb(ids: string[], total = ids.length, failWith?: string): Fetch {
  return async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (failWith) return new Response(JSON.stringify({ errors: [{ message: failWith, extensions: { code: failWith } }] }));
    const v = body.variables;
    const start = v.after ? Number(v.after) : 0;
    const page = ids.slice(start, start + v.first);
    const next = start + page.length;
    const pageInfo = { hasNextPage: next < ids.length, endCursor: String(next) };
    if (body.operationName === 'TitleListMainPage') {
      return new Response(JSON.stringify({ data: { list: { titleListItemSearch: { total, pageInfo, edges: page.map((id) => ({ listItem: { id } })) } } } }));
    }
    return new Response(JSON.stringify({ data: { advancedTitleSearch: { total, pageInfo, edges: page.map((id) => ({ node: { title: { id, titleType: { id: 'movie' } } } })) } } }));
  };
}

describe('paging', () => {
  const ids = Array.from({ length: 640 }, (_, i) => `tt${String(i).padStart(7, '0')}`);

  it('fetches every page of a list (100 per page)', async () => {
    const r = await imdbList(fakeImdb(ids.slice(0, 234)), 'h', 'ls1');
    expect(r.ids).toHaveLength(234);
  });

  it('stops a search at Kometa’s limit (Valentine’s: 634 → 500)', async () => {
    const r = await imdbSearch(fakeImdb(ids, 634), 'h', { 'list.any': ['ls1'], limit: 500 });
    expect(r.titles).toHaveLength(500);
    expect(r.total).toBe(634);
  });

  it('surfaces PERSISTED_QUERY_NOT_FOUND as a coded error for the hash alert (ADR-013)', async () => {
    await expect(imdbSearch(fakeImdb([], 0, 'PERSISTED_QUERY_NOT_FOUND'), 'old', { 'keyword.any': 'x' })).rejects.toMatchObject({ code: 'PERSISTED_QUERY_NOT_FOUND' });
  });
});
