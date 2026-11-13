// Holiday episodes end to end (ADR-017, ADR-018): owned-series IMDb search, /find fallback, title suggestions.
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, ne } from 'drizzle-orm';
import { openDb } from '../src/db/index.js';
import { createContext } from '../src/app-context.js';
import { readConfig } from '../src/config.js';
import { runPipeline } from '../src/pipeline/run.js';
import { decide } from '../src/pipeline/store.js';
import { action, definition } from '../src/db/schema.js';
import { FakeJellyfin, FAKE_URL } from './fakes/jellyfin.js';
import type { FetchLike } from '../src/clients/http.js';

const ET = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h + 5, min);

function world() {
  const fake = new FakeJellyfin();
  fake.add({ Id: 's-glee', Name: 'Glee', Type: 'Series', ParentId: 'lib-shows', ProviderIds: { Imdb: 'tt1327801', Tmdb: '34307' } });
  fake.add({ Id: 'e-glee', Name: 'A Very Glee Christmas', Type: 'Episode', SeriesId: 's-glee', ParentIndexNumber: 2, IndexNumber: 10, ProviderIds: { Imdb: 'tt1781000' } });
  fake.add({ Id: 'e-glee-2', Name: 'Pilot', Type: 'Episode', SeriesId: 's-glee', ParentIndexNumber: 1, IndexNumber: 1, ProviderIds: { Imdb: 'tt1327802' } });
  // A children's library: episodes without any IDs (common there, per docs/VERIFIED.md).
  fake.add({ Id: 's-bluey', Name: 'Bluey', Type: 'Series', ParentId: 'lib-shows', ProviderIds: { Imdb: 'tt7678620', Tmdb: '82728' } });
  fake.add({ Id: 'e-bluey-santa', Name: 'Verandah Santa', Type: 'Episode', SeriesId: 's-bluey', ParentIndexNumber: 2, IndexNumber: 49, ProviderIds: {} });
  fake.add({ Id: 'e-bluey-swim', Name: 'Christmas Swim', Type: 'Episode', SeriesId: 's-bluey', ParentIndexNumber: 3, IndexNumber: 20, ProviderIds: {} });
  const searches: { series: string[]; types: string[]; keywords: string[] }[] = [];
  const net: FetchLike = async (url, init) => {
    if (url.includes('IMDb-Hash')) return new Response('h');
    if (url.includes('Default-Images')) return new Response(new Uint8Array([0xff, 0xd8, 1]), { headers: { 'content-type': 'image/jpeg' } });
    if (url.startsWith('https://api.graphql.imdb.com')) {
      const v = JSON.parse(String(init?.body)).variables;
      searches.push({ series: v.episodicConstraint?.anySeriesIds ?? [], types: v.titleTypeConstraint?.anyTitleTypeIds ?? [], keywords: v.keywordConstraint?.anyKeywords ?? [] });
      const ep = (id: string, series: string) => ({ node: { title: { id, titleType: { id: 'tvEpisode' }, series: { series: { id: series } } } } });
      const edges = v.keywordConstraint?.anyKeywords?.includes('christmas') && v.episodicConstraint
        ? [ep('tt1781000', 'tt1327801'), ep('tt9999001', 'tt7678620'), ep('tt0000404', 'tt1327801')]
        : [];
      return new Response(JSON.stringify({ data: { advancedTitleSearch: { total: edges.length, pageInfo: { hasNextPage: false }, edges } } }));
    }
    if (url.startsWith('https://api.themoviedb.org/3/find/tt9999001')) {
      return new Response(JSON.stringify({ movie_results: [], tv_results: [], tv_episode_results: [{ show_id: 82728, season_number: 2, episode_number: 49 }] }));
    }
    if (url.startsWith('https://api.themoviedb.org/3/find/')) return new Response(JSON.stringify({ movie_results: [], tv_results: [], tv_episode_results: [] }));
    return new Response('not found', { status: 404 });
  };
  const config = { ...readConfig({}), configDir: mkdtempSync(join(tmpdir(), 'mc-')), timezone: 'America/New_York', seeds: {} };
  const app = createContext(config, { db: openDb(':memory:'), fetch: net, jellyfinFetch: fake.fetch() });
  app.updateSettings({ connections: { jellyfinUrl: FAKE_URL, plexUrl: '', radarrUrl: '', sonarrUrl: '' }, dryRun: false, firstRunDone: true });
  app.secrets.set('jellyfin.apiKey', fake.apiKey);
  app.secrets.set('tmdb.apiKey', 'k');
  app.db.update(definition).set({ enabled: false }).where(ne(definition.slug, 'episodes-christmas')).run();
  return { fake, app, searches };
}

describe('Christmas Episodes (ADR-017)', () => {
  it('finds owned holiday episodes three ways, and waits for review before creating the box set', async () => {
    const { fake, app, searches } = world();
    await runPipeline(app, { job: 'nightly-refresh', trigger: 'manual', index: true, now: ET(2026, 12, 2, 2, 30) });
    // The IMDb search is scoped to owned series and to episodes.
    const scoped = searches.find((s) => s.keywords.includes('christmas'))!;
    expect(scoped.series.sort()).toEqual(['tt1327801', 'tt7678620']);
    expect(scoped.types).toEqual(['tvEpisode']);

    const defId = app.db.select().from(definition).where(eq(definition.slug, 'episodes-christmas')).get()!.id;
    const acts = app.db.select().from(action).where(eq(action.definitionId, defId)).all();
    const adds = acts.filter((a) => a.type === 'collection.add_items');
    const byName = Object.fromEntries(adds.map((a) => [a.item!.name, a]));
    expect(Object.keys(byName).sort()).toEqual(['Bluey · S02E49 · Verandah Santa', 'Bluey · S03E20 · Christmas Swim', 'Glee · S02E10 · A Very Glee Christmas']);
    expect(byName['Glee · S02E10 · A Very Glee Christmas']!.item!.provenance.match).toBe('IMDb tt1781000');
    expect(byName['Bluey · S02E49 · Verandah Santa']!.item!.provenance.match).toBe('series TMDb 82728 S02E49'); // via TMDb /find
    expect((byName['Bluey · S03E20 · Christmas Swim']!.payload as { suggested: boolean }).suggested).toBe(true);
    // Every addition waits for review; so the box set isn't created yet.
    expect(adds.every((a) => a.status === 'proposed')).toBe(true);
    expect(fake.boxSets()).toHaveLength(0);

    decide(app.db, adds.map((a) => a.id), 'approve', 'admin');
    await runPipeline(app, { job: 'nightly-refresh', trigger: 'schedule', index: false, now: ET(2026, 12, 2, 3, 0) });
    const box = fake.boxSets().find((b) => b.Name === 'Christmas Episodes')!;
    expect(box.children!.sort()).toEqual(['e-bluey-santa', 'e-bluey-swim', 'e-glee']);
    expect(box.ForcedSortName).toBe('!00_Christmas Episodes');

    // An accepted suggestion stays: the next run neither proposes removing it nor suggests it again (it used to flip-flop).
    await runPipeline(app, { job: 'nightly-refresh', trigger: 'schedule', index: false, now: ET(2026, 12, 3, 2, 30) });
    const later = app.db.select().from(action).where(eq(action.definitionId, defId)).all().filter((a) => a.status === 'proposed');
    expect(later.filter((a) => a.type === 'collection.remove_items')).toEqual([]);
    expect(later.filter((a) => a.type === 'collection.add_items')).toEqual([]);
    expect(fake.boxSets().find((b) => b.Name === 'Christmas Episodes')!.children).toContain('e-bluey-swim');
  });
});
