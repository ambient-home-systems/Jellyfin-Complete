// Box set artwork safety (ADR-040), from the 13 Nov 2026 incident: Jellyfin identified box sets by a TMDb name search
// and attached the wrong collection's provider ID, poster, backdrop and overview ("Inside Out" got an adult collection's
// nude artwork; "9-1-1" got "9½ Weeks"). The fake Jellyfin reproduces that search with the same wrong matches. After
// creating, adopting and every run, each managed box set's TMDb link and every image must be the intended collection's.
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { openDb } from '../src/db/index.js';
import { createContext } from '../src/app-context.js';
import { readConfig } from '../src/config.js';
import { runPipeline } from '../src/pipeline/run.js';
import { setFilmSeries } from '../src/pipeline/film-series.js';
import { adoptionCandidates, adoptSuggested } from '../src/pipeline/adoption.js';
import { definition, integrityEvent, managedCollection } from '../src/db/schema.js';
import { JELLYFIN_CALLS } from '../src/clients/jellyfin/compat.js';
import { dashboardModel } from '../src/web/model.js';
import { Dashboard } from '../src/web/pages/dashboard.js';
import { FakeJellyfin, FAKE_URL } from './fakes/jellyfin.js';
import type { FetchLike } from '../src/clients/http.js';

const NOW = Date.UTC(2026, 10, 20, 15);
const DAY = 86_400_000;

/** The seven from the incident: the series we mean, the films we own, and what Jellyfin's name search matched instead. */
const CASES = [
  { name: 'Inside Out', series: '1022790', films: [['150540', 'Inside Out'], ['1022789', 'Inside Out 2']], wrong: { tmdb: '981142', name: 'Inside Out (Playboy) Collection', overview: '' } },
  { name: 'Night at the Museum', series: '85943', films: [['1593', 'Night at the Museum'], ['18360', 'Night at the Museum: Battle of the Smithsonian']], wrong: { tmdb: '1369645', name: 'Night at the Creation Museum', overview: 'A creationist museum tour.' } },
  { name: 'Twister', series: '1062948', films: [['664', 'Twister'], ['718821', 'Twisters']], wrong: { tmdb: '1287171', name: 'Twister (Documentary)', overview: 'A documentary.' } },
  { name: 'Teenage Mutant Ninja Turtles', series: '1582', films: [['1498', 'Teenage Mutant Ninja Turtles'], ['1497', 'Teenage Mutant Ninja Turtles II']], wrong: { tmdb: '1195879', name: 'TMNT (Shorts)', overview: 'Nickelodeon shorts.' } },
  { name: 'The Chronicles of Narnia', series: '420', films: [['411', 'The Lion, the Witch and the Wardrobe'], ['2454', 'Prince Caspian']], wrong: { tmdb: '925022', name: 'Narnia BBC Collection', overview: 'The BBC series.' } },
  { name: 'Home Alone', series: '9888', films: [['771', 'Home Alone'], ['772', 'Home Alone 2']], wrong: { tmdb: '1586337', name: 'Home Alone (duplicate)', overview: 'A duplicate entry.' } },
] as const;
const right = (series: string) => `right-${series}`;

function world() {
  const fake = new FakeJellyfin();
  for (const c of CASES) {
    for (const [tmdb, title] of c.films) fake.add({ Id: `m-${tmdb}`, Name: title, Type: 'Movie', ParentId: 'lib-movies', ProductionYear: 2000, ProviderIds: { Tmdb: tmdb, TmdbCollection: c.series } });
    fake.tmdbNameSearch.set(c.name.toLowerCase(), c.wrong);
  }
  // 9-1-1 is a show franchise, not a film series: it should carry no TMDb collection link at all.
  fake.add({ Id: 's-911', Name: '9-1-1', Type: 'Series', ParentId: 'lib-shows', ProviderIds: { Tmdb: '75219' } });
  fake.add({ Id: 's-911ls', Name: '9-1-1: Lone Star', Type: 'Series', ParentId: 'lib-shows', ProviderIds: { Tmdb: '89393' } });
  fake.tmdbNameSearch.set('9-1-1', { tmdb: '121195', name: '9½ Weeks Collection', overview: 'An erotic drama.' });

  const net: FetchLike = async (url) => {
    const coll = url.match(/api\.themoviedb\.org\/3\/collection\/(\d+)/);
    if (coll) {
      const c = CASES.find((x) => x.series === coll[1]);
      if (!c) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify({ id: Number(c.series), name: `${c.name} Collection`, overview: `The ${c.name} films.`, poster_path: `/${right(c.series)}.jpg`, parts: c.films.map(([id, title]) => ({ id: Number(id), title, release_date: '2000-01-01' })) }));
    }
    const img = url.match(/image\.tmdb\.org\/t\/p\/original\/(.+)\.jpg$/);
    if (img) return new Response(new TextEncoder().encode(img[1]!), { headers: { 'content-type': 'image/jpeg' } });
    if (url.includes('Default-Images')) return new Response(new TextEncoder().encode(`kometa:${url.split('/master/')[1]}`), { headers: { 'content-type': 'image/jpeg' } });
    return new Response('[]');
  };
  const config = { ...readConfig({}), configDir: mkdtempSync(join(tmpdir(), 'mc-')), timezone: 'America/New_York', seeds: {} };
  const app = createContext(config, { db: openDb(':memory:'), fetch: net, jellyfinFetch: fake.fetch() });
  app.updateSettings({ connections: { jellyfinUrl: FAKE_URL, plexUrl: '', radarrUrl: '', sonarrUrl: '' }, firstRunDone: true, dryRun: false });
  app.secrets.set('jellyfin.apiKey', fake.apiKey);
  app.secrets.set('tmdb.apiKey', 'k');
  app.db.update(definition).set({ enabled: false }).run();
  app.db.update(definition).set({ enabled: true }).where(eq(definition.presetKey, 'show_franchise:75219')).run();
  setFilmSeries(app, true);
  return { fake, app };
}

const run = (app: ReturnType<typeof world>['app'], now: number) => runPipeline(app, { job: 'manual', trigger: 'manual', index: true, now });
const settle = () => new Promise((r) => setTimeout(r, 60)); // longer than the fake's identification delay

/** Every managed box set carries the intended TMDb link, the app's poster and no other image, is locked, and its films aren't. */
function expectClean(fake: FakeJellyfin, app: ReturnType<typeof world>['app']) {
  const managed = app.db.select().from(managedCollection).all();
  expect(managed).toHaveLength(CASES.length + 1);
  for (const m of managed) {
    const def = app.db.select().from(definition).where(eq(definition.id, m.definitionId)).get()!;
    const box = fake.items.get(m.jfBoxsetId!)!;
    const c = CASES.find((x) => def.presetKey === `film_series:${x.series}`);
    const label = def.name;
    expect(box.Name, label).toBe(c ? c.name : '9-1-1');
    expect(box.ProviderIds ?? {}, label).toEqual(c ? { Tmdb: c.series } : {});
    expect(fake.image(box.Id), label).toBe(c ? right(c.series) : 'kometa:franchise/9-1-1.jpg');
    expect(Object.keys(box.images ?? {}), label).toEqual(['Primary']);
    expect(fake.backdrops.get(box.Id) ?? [], label).toEqual([]);
    expect(box.Overview ?? '', label).toBe(c ? `The ${c.name} films.` : '');
    expect(box.LockData, label).toBe(true);
    for (const child of box.children ?? []) expect(fake.items.get(child)!.LockData, `${label}: ${child}`).toBe(false);
  }
  expect(fake.refreshCalls).toEqual([]);
}

describe('Box set artwork safety (ADR-040)', () => {
  it('never asks Jellyfin to refresh a box set’s metadata', () => {
    expect(JELLYFIN_CALLS.some((c) => /refresh/i.test(c.path))).toBe(false);
  });

  it('creates box sets locked, so Jellyfin’s name search never runs, and owns their TMDb link and images', async () => {
    const { fake, app } = world();
    const r = await run(app, NOW);
    expect(r.status).toBe('ok');
    await settle();
    expectClean(fake, app);
  });

  it('puts things right even if Jellyfin identifies a locked new box set anyway', async () => {
    const { fake, app } = world();
    fake.identifyLocked = true; // the worst case: Jellyfin ignores the lock
    await run(app, NOW); // the run's own re-check, a moment after creating, repairs what Jellyfin attached
    await settle();
    await run(app, NOW + DAY); // and so does the next run's integrity check
    expectClean(fake, app);
    expect(app.db.select().from(integrityEvent).all().length).toBeGreaterThan(0);
  });

  it('adopting never keeps what Jellyfin attached: wrong links are flagged, and each set is replaced by a fresh locked one', async () => {
    const { fake, app } = world();
    // Jellyfin's own "Automatically add to collection" made these, unlocked, and its name search linked them wrongly.
    for (const c of CASES) {
      fake.add({ Id: `bs-${c.series}`, Name: `${c.name} Collection`, Type: 'BoxSet', ParentId: 'lib-collections', children: c.films.map(([tmdb]) => `m-${tmdb}`) });
      fake.identify(`bs-${c.series}`);
      expect(fake.image(`bs-${c.series}`)).toBe(`tmdb-${c.wrong.tmdb}-primary`);
    }
    // One set Jellyfin linked correctly: it checks out, and is still replaced.
    fake.items.get(`bs-9888`)!.ProviderIds = { Tmdb: '9888' };
    fake.add({ Id: 'bs-911', Name: '9-1-1', Type: 'BoxSet', ParentId: 'lib-collections', children: ['s-911', 's-911ls'] });
    fake.identify('bs-911');
    fake.items.get('bs-911')!.Name = '9-1-1'; // renamed back, as the app's metadata update did, but the artwork stayed
    await run(app, NOW); // nothing is created while matching box sets wait to be adopted
    expect(fake.boxSets().filter((b) => !b.Id.startsWith('bs-'))).toEqual([]);

    const candidates = await adoptionCandidates(app, { verify: true });
    const inside = candidates.find((x) => x.boxsetId === 'bs-1022790')!;
    expect(inside).toMatchObject({ suggestion: 'adopt', tmdbLink: '981142', verified: false });
    expect(inside.why).toMatch(/linked it to TMDb collection 981142, not this series \(1022790\).*can’t be trusted/);
    expect(candidates.find((x) => x.boxsetId === 'bs-9888')).toMatchObject({ verified: true });

    expect(await adoptSuggested(app, 'admin')).toEqual({ adopted: CASES.length + 1, failed: [] });
    for (const c of CASES) expect(fake.items.has(`bs-${c.series}`)).toBe(false);
    expect(fake.items.has('bs-911')).toBe(false);
    await settle();
    expectClean(fake, app);
  });

  it('checks every managed box set each run, dry run or not, and repairs what changed', async () => {
    const { fake, app } = world();
    await run(app, NOW);
    await settle();
    app.updateSettings({ dryRun: true });
    const id = (name: string) => fake.boxSets().find((b) => b.Name === name)!.Id;
    const inside = id('Inside Out'), nine = id('9-1-1'), twister = id('Twister');
    // Something outside the app re-identifies Inside Out (say, "Replace all metadata" in Jellyfin)...
    fake.identifyLocked = true;
    fake.identify(inside);
    fake.identifyLocked = false;
    fake.items.get(inside)!.Name = 'Inside Out'; // name aside, its link and artwork are wrong now
    // ...adds a backdrop to 9-1-1, and unlocks Twister.
    fake.backdrops.set(nine, [new TextEncoder().encode('9½ weeks backdrop')]);
    fake.items.get(twister)!.LockData = false;
    fake.items.get(twister)!.Overview = 'A documentary.';

    const r = await run(app, NOW + DAY);
    expect(r.stats).toMatchObject({ boxSetsRepaired: 3, boxSetRepairsFailed: 0 });
    await settle();
    expectClean(fake, app);
    expect(fake.items.has(twister)).toBe(false); // unlocked: replaced by a fresh locked one, rather than locking its films
    const events = app.db.select().from(integrityEvent).all();
    expect(events.find((e) => e.name === 'Inside Out')!.what).toMatch(/linked to TMDb 981142 instead of TMDb 1022790/);
    expect(events.find((e) => e.name === '9-1-1')!.what).toMatch(/a backdrop the app didn’t add.*removed a backdrop/);
    expect(events.find((e) => e.name === 'Twister')!.what).toMatch(/not locked.*fresh locked box set/);
    expect(dashboardModel(app, NOW + DAY).integrity.filter((e) => e.ok)).toHaveLength(3);
    const page = String(Dashboard({ m: dashboardModel(app, NOW + DAY), csrf: 'x' }));
    expect(page).toContain('3 collections put right this week');
    expect(page).toContain('linked to TMDb 981142 instead of TMDb 1022790');

    // A quiet run afterwards: nothing to repair, and no metadata change proposed either.
    const quiet = await run(app, NOW + 2 * DAY);
    expect(quiet.stats).toMatchObject({ boxSetsRepaired: 0, planned: 0 });
  });

  it('warns on the Dashboard while Jellyfin’s “Automatically add to collection” is on', async () => {
    const { fake, app } = world();
    (fake.libraries[0] as { LibraryOptions?: { AutomaticallyAddToCollection: boolean } }).LibraryOptions = { AutomaticallyAddToCollection: true };
    await run(app, NOW);
    expect(dashboardModel(app, NOW).autoCollections).toEqual(['Movies']);
    expect(String(Dashboard({ m: dashboardModel(app, NOW), csrf: 'x' }))).toContain('Jellyfin makes its own collections in Movies');
  });
});
