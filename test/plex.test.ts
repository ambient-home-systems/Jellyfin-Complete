// Plex, read-only (ADR-024): client, plex_collection source, and the parity report.
import { describe, it, expect } from 'vitest';
import { PlexClient } from '../src/clients/plex.js';
import { parity } from '../src/domain/parity.js';
import { LibraryIndex, type LibRow } from '../src/domain/matching.js';
import { resolveSource } from '../src/sources/index.js';
import { openDb } from '../src/db/index.js';
import { fakePlex, PLEX } from './fakes/plex.js';

const row = (jfId: string, name: string, imdb: string, year: number): LibRow => ({ jfId, kind: 'movie', libraryId: 'lib-movies', name, year, imdb, tmdb: null, tvdb: null, seriesJfId: null, season: null, episode: null, officialRating: null, genres: [] });

describe('Plex (read-only)', () => {
  const plex = new PlexClient(`${PLEX}/`, 'plex-token', fakePlex);

  it('lists collections in movie and show libraries, with items and their IDs', async () => {
    expect(await plex.version()).toBe('1.43.5');
    const colls = await plex.collections();
    expect(colls).toEqual([{ ratingKey: '901', title: 'Thanksgiving Movies', titleSort: '!00_Thanksgiving Movies', section: 'Movies', sectionType: 'movie', childCount: 3 }]);
    const items = await plex.items('901');
    expect(items[0]).toEqual({ title: 'Planes, Trains and Automobiles', year: 1987, type: 'movie', imdb: 'tt0093748', tmdb: '2609', tvdb: undefined });
  });

  it('reads a Plex collection as a source, and reports one that doesn’t exist as empty', async () => {
    const ctx = { db: openDb(':memory:'), fetch: fakePlex, tmdb: null, plex, mdblistKey: null, imdbRoute: 'direct' as const };
    const r = await resolveSource(ctx, { type: 'plex_collection', config: { name: 'Thanksgiving Movies' } });
    expect(r).toMatchObject({ status: 'ok', label: 'Plex collection Thanksgiving Movies', meta: { found: true, libraries: ['Movies'] } });
    expect(r.items.map((i) => i.imdb)).toEqual(['tt0093748', 'tt0106220', 'tt1621039']);
    const none = await resolveSource(ctx, { type: 'plex_collection', config: { name: 'Christmas Movies' } });
    expect(none).toMatchObject({ status: 'ok', items: [], meta: { found: false } });
    const off = await resolveSource({ ...ctx, plex: null }, { type: 'plex_collection', config: { name: 'X' } });
    expect(off.error).toMatch(/Plex isn’t connected/);
  });

  it('compares Plex with the plan and explains each difference', async () => {
    const index = new LibraryIndex([
      row('m-ptna', 'Planes, Trains and Automobiles', 'tt0093748', 1987),
      row('m-afv', 'Addams Family Values', 'tt0106220', 1993),
      row('m-mickey', 'Mickey’s Thanksgiving', 'tt9000001', 1940),
    ]);
    const items = (await plex.items('901')).map((i, n) => ({ ...i, kind: 'movie' as const, rank: n + 1 }));
    const p = parity(items, new Set(['m-ptna', 'm-mickey']), index, 'movie');
    expect(p).toMatchObject({ plexCount: 3, plannedCount: 2, both: 1 });
    expect(p.plexOnlyNotInLibrary.map((x) => x.title)).toEqual(['Free Birds']);
    expect(p.plexOnlyNotPlanned.map((x) => x.title)).toEqual(['Addams Family Values']);
    expect(p.hereOnly.map((x) => x.title)).toEqual(['Mickey’s Thanksgiving']);
  });
});
