import { describe, it, expect } from 'vitest';
import { buildSnapshot, readSnapshot, searchKey, listKey } from '../src/imdb/snapshot.js';
import { queriesFor } from '../src/imdb/queries.js';
import { resolveSource, type SourceContext } from '../src/sources/index.js';
import { PRESETS } from '../src/presets/index.js';
import { openDb } from '../src/db/index.js';
import type { FetchLike } from '../src/clients/http.js';

// A tiny IMDb: one list and a keyword search, answering the persisted GraphQL queries.
const imdb: FetchLike = async (url, init) => {
  if (url.includes('IMDb-Hash')) return new Response('h');
  const body = JSON.parse(String(init?.body));
  const pageInfo = { hasNextPage: false, endCursor: null };
  if (body.operationName === 'TitleListMainPage') {
    if (body.variables.lsConst !== 'ls066838460') return new Response(JSON.stringify({ errors: [{ message: 'list not found' }] }));
    return new Response(JSON.stringify({ data: { list: { titleListItemSearch: { total: 2, pageInfo, edges: [{ listItem: { id: 'tt0099785' } }, { listItem: { id: 'tt0319343' } }] } } } }));
  }
  return new Response(JSON.stringify({ data: { advancedTitleSearch: { total: 1, pageInfo, edges: [{ node: { title: { id: 'tt0093748', titleType: { id: 'movie' } } } }] } } }));
};

describe('IMDb snapshot route (ADR-011 route 4)', () => {
  const search = { 'keyword.any': 'thanksgiving', limit: 500 };

  it('collects every IMDb query the presets need', () => {
    const q = queriesFor(PRESETS.flatMap((p) => p.definition.sources));
    expect(q.searches.length).toBeGreaterThan(15);
    expect(q.lists.map((l) => l.listId)).toContain('ls543971628'); // Alien / Predator
  });

  it('builds a snapshot, recording a failed query without stopping the rest', async () => {
    const snap = await buildSnapshot(imdb, { searches: [search, search], lists: [{ listId: 'ls066838460' }, { listId: 'ls000000001' }] }, new Date('2026-11-20T06:00:00Z'));
    expect(snap.generatedAt).toBe('2026-11-20T06:00:00.000Z');
    expect(snap.searches[searchKey(search)]?.titles.map((t) => t.id)).toEqual(['tt0093748']);
    expect(snap.lists[listKey('ls066838460')]?.ids).toEqual(['tt0099785', 'tt0319343']);
    expect(Object.keys(snap.errors)).toEqual([listKey('ls000000001')]);
    // Key order in the config doesn't matter.
    expect(searchKey({ limit: 500, 'keyword.any': 'thanksgiving' })).toBe(searchKey(search));
  });

  it('serves sources from the snapshot, and says what is missing', async () => {
    const snap = await buildSnapshot(imdb, { searches: [search], lists: [{ listId: 'ls066838460' }] }, new Date('2026-11-20T06:00:00Z'));
    let reads = 0;
    const f: FetchLike = async (url, init) => {
      if (url === 'https://example.test/snap.json') {
        reads++;
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer t0k');
        return new Response(JSON.stringify(snap));
      }
      throw new Error(`IMDb must not be called on the snapshot route: ${url}`);
    };
    const ctx: SourceContext = { db: openDb(':memory:'), fetch: f, tmdb: null, mdblistKey: null, imdbRoute: 'snapshot', now: () => Date.parse('2026-11-21T02:30:00Z'), imdbSnapshot: { url: 'https://example.test/snap.json', token: 't0k' } };
    const s = await resolveSource(ctx, { type: 'imdb_search', config: { search } });
    expect(s).toMatchObject({ status: 'ok', items: [{ imdb: 'tt0093748', kind: 'movie', rank: 1 }] });
    const l = await resolveSource(ctx, { type: 'imdb_list', config: { listId: 'ls066838460' } });
    expect(l.items.map((i) => i.imdb)).toEqual(['tt0099785', 'tt0319343']);
    const missing = await resolveSource(ctx, { type: 'imdb_list', config: { listId: 'ls999999999' } });
    expect(missing).toMatchObject({ status: 'failed', error: expect.stringMatching(/Not in the IMDb snapshot/) });
    expect(reads).toBe(1); // read once per run
  });

  it('treats a snapshot older than 3 days as a failure, so the last good result is kept', async () => {
    const snap = await buildSnapshot(imdb, { searches: [search], lists: [] }, new Date('2026-11-20T06:00:00Z'));
    const db = openDb(':memory:');
    const base = { db, tmdb: null, mdblistKey: null, imdbRoute: 'snapshot' as const, imdbSnapshot: { url: 'https://example.test/s.json', token: null } };
    const fresh = await resolveSource({ ...base, fetch: async () => new Response(JSON.stringify(snap)), now: () => Date.parse('2026-11-21T00:00:00Z') }, { type: 'imdb_search', config: { search } });
    expect(fresh.status).toBe('ok');
    const old = await resolveSource({ ...base, fetch: async () => new Response(JSON.stringify(snap)), now: () => Date.parse('2026-11-25T00:00:00Z') }, { type: 'imdb_search', config: { search } }, { force: true });
    expect(old).toMatchObject({ status: 'stale', error: expect.stringMatching(/more than 3 days old/), items: [{ imdb: 'tt0093748' }] });
  });

  it('rejects something that isn’t a snapshot', async () => {
    await expect(readSnapshot(async () => new Response('{"hello":1}'), 'https://x.test/a.json')).rejects.toThrow(/Not an IMDb snapshot/);
    await expect(readSnapshot(async () => new Response('nope', { status: 404 }), 'https://x.test/a.json')).rejects.toThrow(/HTTP 404/);
  });
});
