// Home-screen rows (Phase 3, ADR-025): Collection Sections entries + Home Screen Sections on/off by live state.
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { openDb } from '../src/db/index.js';
import { createContext } from '../src/app-context.js';
import { readConfig } from '../src/config.js';
import { definition, managedCollection } from '../src/db/schema.js';
import { syncHomeRows, homeStatus, HSS_ID, CS_ID } from '../src/homescreen/index.js';
import { runPipeline } from '../src/pipeline/run.js';
import { FakeJellyfin, FAKE_URL } from './fakes/jellyfin.js';
import type { FetchLike } from '../src/clients/http.js';

const HSS = 'b8298e01-2697-407a-b44d-aa8dc795e850';
const CS = '043b2c48-b3e0-4610-b398-8217b146d1a4';

function world(install = true) {
  const fake = new FakeJellyfin();
  fake.add({ Id: 'm-ptna', Name: 'Planes, Trains and Automobiles', Type: 'Movie', ParentId: 'lib-movies', ProductionYear: 1987, ProviderIds: { Imdb: 'tt0093748' } });
  if (install) {
    // Jellyfin writes plugin Guids without dashes.
    fake.plugins.push({ Id: HSS_ID, Name: 'Home Screen Sections', Version: '3.1.0.0', Status: 'Active' }, { Id: CS_ID, Name: 'Collection Sections', Version: '2.0.0.0', Status: 'Active' });
    fake.pluginConfigs.set(HSS_ID, {
      Enabled: true, JellyseerrApiKey: 'secret-key', NumSectionsPerPage: 10,
      SectionSettings: [{ SectionId: 'ContinueWatching', Enabled: true, AllowUserOverride: true, LowerLimit: 1, UpperLimit: 1, OrderIndex: 0, ViewMode: 'Landscape', HideWatchedItems: false, PluginConfigurations: [] }],
    });
    fake.pluginConfigs.set(CS_ID, { Sections: [{ UniqueId: 'trending', DisplayText: 'Trending', CollectionName: 'Trending', SectionType: 'Collection' }] });
  }
  const jff = fake.fetch();
  const net: FetchLike = async (url, init) => {
    if (url.startsWith(FAKE_URL)) return jff(url, init);
    if (url.includes('IMDb-Hash')) return new Response('h');
    if (url.startsWith('https://api.graphql.imdb.com')) {
      const v = JSON.parse(String(init?.body)).variables;
      const ids = (v.keywordConstraint?.anyKeywords ?? []).includes('thanksgiving') && !v.episodicConstraint ? ['tt0093748'] : [];
      return new Response(JSON.stringify({ data: { advancedTitleSearch: { total: ids.length, pageInfo: { hasNextPage: false }, edges: ids.map((id) => ({ node: { title: { id, titleType: { id: 'movie' } } } })) }, list: { titleListItemSearch: { total: 0, pageInfo: { hasNextPage: false }, edges: [] } } } }));
    }
    if (url.includes('Default-Images')) return new Response(new Uint8Array([0xff, 0xd8, 1]), { headers: { 'content-type': 'image/jpeg' } });
    if (url.includes('mdblist.com')) return new Response('[]');
    return new Response('nope', { status: 404 });
  };
  const config = { ...readConfig({}), configDir: mkdtempSync(join(tmpdir(), 'mc-')), timezone: 'America/New_York', seeds: {} };
  const app = createContext(config, { db: openDb(':memory:'), fetch: net });
  app.updateSettings({ connections: { jellyfinUrl: FAKE_URL, plexUrl: '', radarrUrl: '', sonarrUrl: '' }, dryRun: false, firstRunDone: true, homeRows: { enabled: true, orderIndex: 3, viewMode: 'Portrait' } });
  app.secrets.set('jellyfin.apiKey', fake.apiKey);
  return { fake, app };
}

const defId = (app: ReturnType<typeof world>['app'], slug: string) => app.db.select().from(definition).where(eq(definition.slug, slug)).get()!.id;
const live = (app: ReturnType<typeof world>['app'], slug: string, state: 'live' | 'absent' | 'hidden' = 'live') =>
  app.db.insert(managedCollection).values({ definitionId: defId(app, slug), jfBoxsetId: `bs-${slug}`, origin: 'created', state, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: managedCollection.definitionId, set: { state } }).run();
const hssRows = (fake: FakeJellyfin) => (fake.pluginConfigs.get(HSS_ID)!.SectionSettings as { SectionId: string; Enabled: boolean; AllowUserOverride: boolean; OrderIndex: number; ViewMode: string }[]);
const csRows = (fake: FakeJellyfin) => (fake.pluginConfigs.get(CS_ID)!.Sections as { UniqueId: string; CollectionName: string }[]);

describe('home-screen rows (ADR-025)', () => {
  it('says what’s missing when the plugins aren’t installed, and changes nothing', async () => {
    const { app, fake } = world(false);
    expect((await homeStatus(app)).problem).toMatch(/Home Screen Sections isn’t installed/);
    expect((await syncHomeRows(app)).problem).toMatch(/isn’t installed/);
    expect(fake.calls.some((c) => c.method === 'POST' && c.path.startsWith('/Plugins'))).toBe(false);
  });

  it('registers a row per collection, shows only live ones, and leaves everything else alone', async () => {
    const { app, fake } = world();
    live(app, 'seasonal-christmas');
    live(app, 'seasonal-thanksgiving', 'absent');
    const r = await syncHomeRows(app);
    expect(r).toMatchObject({ changed: true, showing: ['Christmas Movies'], problem: null });
    // Collection Sections: theirs kept first, then one entry per seasonal film and holiday-episode collection.
    const cs = csRows(fake);
    expect(cs[0]).toEqual({ UniqueId: 'trending', DisplayText: 'Trending', CollectionName: 'Trending', SectionType: 'Collection' });
    expect(cs.filter((x) => x.UniqueId.startsWith('maverick-'))).toHaveLength(22);
    expect(cs.find((x) => x.UniqueId === 'maverick-seasonal-christmas')).toMatchObject({ CollectionName: 'Christmas Movies' });
    // Home Screen Sections: our rows switched by live state, users can't override, other settings untouched.
    const hss = hssRows(fake);
    expect(hss[0]).toMatchObject({ SectionId: 'ContinueWatching', Enabled: true, AllowUserOverride: true });
    expect(hss.find((x) => x.SectionId === 'maverick-seasonal-christmas')).toMatchObject({ Enabled: true, AllowUserOverride: false, ViewMode: 'Portrait' });
    expect(hss.find((x) => x.SectionId === 'maverick-seasonal-thanksgiving')).toMatchObject({ Enabled: false });
    expect(hss.filter((x) => x.SectionId.startsWith('maverick-') && x.Enabled)).toHaveLength(1);
    expect(fake.pluginConfigs.get(HSS_ID)).toMatchObject({ Enabled: true, JellyseerrApiKey: 'secret-key', NumSectionsPerPage: 10 });
    expect(fake.bustCacheCalls).toBe(1);
    // Nothing to do the second time.
    const posts = fake.calls.filter((c) => c.method === 'POST').length;
    expect((await syncHomeRows(app)).changed).toBe(false);
    expect(fake.calls.filter((c) => c.method === 'POST').length).toBe(posts);
  });

  it('hides a row when its collection closes or is hidden, and keeps a dropped row switched off', async () => {
    const { app, fake } = world();
    live(app, 'seasonal-christmas');
    await syncHomeRows(app);
    live(app, 'seasonal-christmas', 'hidden'); // tag-gate keeps the box set; the row still has to go
    await syncHomeRows(app);
    expect(hssRows(fake).find((x) => x.SectionId === 'maverick-seasonal-christmas')!.Enabled).toBe(false);
    live(app, 'seasonal-christmas');
    await syncHomeRows(app);
    app.db.update(definition).set({ homeRow: false }).where(eq(definition.slug, 'seasonal-christmas')).run();
    await syncHomeRows(app);
    expect(csRows(fake).some((x) => x.UniqueId === 'maverick-seasonal-christmas')).toBe(false);
    expect(hssRows(fake).find((x) => x.SectionId === 'maverick-seasonal-christmas')).toMatchObject({ Enabled: false });
  });

  it('respects dry run, except when you press the button', async () => {
    const { app, fake } = world();
    app.updateSettings({ dryRun: true });
    live(app, 'seasonal-christmas');
    const r = await syncHomeRows(app);
    expect(r).toMatchObject({ changed: true, dryRun: true });
    expect(fake.calls.some((c) => c.method === 'POST' && c.path.includes('/Configuration'))).toBe(false);
    await syncHomeRows(app, { dryRun: false });
    expect(hssRows(fake).find((x) => x.SectionId === 'maverick-seasonal-christmas')!.Enabled).toBe(true);
  });

  it('a run shows the row of a collection it creates', async () => {
    const { app, fake } = world();
    await runPipeline(app, { job: 'nightly-refresh', trigger: 'manual', index: true, now: Date.UTC(2026, 10, 17, 15) });
    expect(fake.boxSets().map((b) => b.Name)).toContain('Thanksgiving Movies');
    const row = hssRows(fake).find((x) => x.SectionId === 'maverick-seasonal-thanksgiving');
    expect(row).toMatchObject({ Enabled: true, OrderIndex: expect.any(Number) });
    void HSS; void CS;
  });
});
