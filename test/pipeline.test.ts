// End-to-end: the ARCHITECTURE §7 walkthrough against the Jellyfin 12.4 fake, with IMDb/MDBList/posters faked.
import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb } from '../src/db/index.js';
import { createContext, type AppContext } from '../src/app-context.js';
import { readConfig } from '../src/config.js';
import { runPipeline } from '../src/pipeline/run.js';
import { decide } from '../src/pipeline/store.js';
import { undoAction } from '../src/pipeline/undo.js';
import { MANAGED_TAG, GATE_TAG } from '../src/pipeline/planner.js';
import { action, definition, definitionMode, managedCollection } from '../src/db/schema.js';
import { FakeJellyfin, FAKE_URL } from './fakes/jellyfin.js';
import type { FetchLike } from '../src/clients/http.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ET = (y: number, m: number, d: number, h = 0, min = 0) => Date.UTC(y, m - 1, d, h + 5, min); // EST (UTC-5), fine for Nov/Dec

type World = { fake: FakeJellyfin; app: AppContext; mdblistDown: boolean; posterHits: number };

function world(): World {
  const fake = new FakeJellyfin();
  fake.add({ Id: 'm-home', Name: 'Home Alone', Type: 'Movie', ParentId: 'lib-movies', ProductionYear: 1990, ProviderIds: { Imdb: 'tt0099785', Tmdb: '771' } });
  fake.add({ Id: 'm-elf', Name: 'Elf', Type: 'Movie', ParentId: 'lib-movies', ProductionYear: 2003, ProviderIds: { Imdb: 'tt0319343', Tmdb: '10719' } });
  fake.add({ Id: 'm-mickey', Name: "Mickey's Christmas Carol", Type: 'Movie', ParentId: 'lib-animated', ProductionYear: 1983, ProviderIds: { Imdb: 'tt0086106', Tmdb: '13154' } });
  fake.add({ Id: 'm-ptna', Name: 'Planes, Trains and Automobiles', Type: 'Movie', ParentId: 'lib-movies', ProductionYear: 1987, ProviderIds: { Imdb: 'tt0093748', Tmdb: '2609' } });
  fake.add({ Id: 'm-diehard', Name: 'Die Hard', Type: 'Movie', ParentId: 'lib-movies', ProductionYear: 1988, ProviderIds: { Imdb: 'tt0095016', Tmdb: '562' } });
  const w = { fake, mdblistDown: false, posterHits: 0 } as World;
  const net: FetchLike = async (url, init) => {
    if (url.includes('IMDb-Hash')) return new Response('hash-v1');
    if (url.includes('Default-Images')) { w.posterHits++; return new Response(new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]), { headers: { 'content-type': 'image/jpeg' } }); }
    if (url.includes('mdblist.com/lists/k0meta/christmas-extravaganza')) {
      if (w.mdblistDown) return new Response('down', { status: 503 });
      return new Response(JSON.stringify([
        { id: 771, imdb_id: 'tt0099785', mediatype: 'movie', rank: 1 },
        { id: 10719, imdb_id: 'tt0319343', mediatype: 'movie', rank: 2 },
        { id: 13154, imdb_id: 'tt0086106', mediatype: 'movie', rank: 3 },
      ]));
    }
    if (url.includes('mdblist.com')) return new Response('[]');
    if (url.startsWith('https://api.graphql.imdb.com')) {
      const body = JSON.parse(String(init?.body));
      const kw: string[] = body.variables.keywordConstraint?.anyKeywords ?? [];
      const ids = kw.includes('thanksgiving') ? ['tt0093748'] : [];
      const pageInfo = { hasNextPage: false, endCursor: null };
      if (body.operationName === 'TitleListMainPage') return new Response(JSON.stringify({ data: { list: { titleListItemSearch: { total: 0, pageInfo, edges: [] } } } }));
      return new Response(JSON.stringify({ data: { advancedTitleSearch: { total: ids.length, pageInfo, edges: ids.map((id) => ({ node: { title: { id, titleType: { id: 'movie' } } } })) } } }));
    }
    if (url.includes('letterboxd.com')) return new Response('<p>none</p>');
    return new Response('not found', { status: 404 });
  };
  const config = { ...readConfig({}), configDir: mkdtempSync(join(tmpdir(), 'mc-')), timezone: 'America/New_York', seeds: {} };
  const app = createContext(config, { db: openDb(':memory:'), fetch: net, jellyfinFetch: fake.fetch() });
  app.updateSettings({ connections: { jellyfinUrl: FAKE_URL, plexUrl: '', radarrUrl: '', sonarrUrl: '' }, dryRun: false, firstRunDone: true });
  app.secrets.set('jellyfin.apiKey', fake.apiKey);
  w.app = app;
  return w;
}

const defId = (app: AppContext, slug: string) => app.db.select().from(definition).where(eq(definition.slug, slug)).get()!.id;
const actionsFor = (app: AppContext, slug: string) => app.db.select().from(action).where(eq(action.definitionId, defId(app, slug))).all();
const boxSet = (fake: FakeJellyfin, name: string) => fake.boxSets().find((b) => b.Name === name);

describe('Christmas Movies walkthrough (ARCHITECTURE §7)', () => {
  let w: World;
  beforeEach(() => {
    w = world();
    // Christmas adds wait for review, per the example override.
    w.app.db.insert(definitionMode).values({ definitionId: defId(w.app, 'seasonal-christmas'), actionType: 'collection.add_items', mode: 'review' }).run();
  });

  it('plans 14 days ahead, applies at the midnight flip, and closes Thanksgiving', async () => {
    // 17 Nov: Thanksgiving is open (auto: created now); Christmas opens in 14 days (planned, nothing applied).
    const r1 = await runPipeline(w.app, { job: 'nightly-refresh', trigger: 'manual', index: true, now: ET(2026, 11, 17, 2, 30) });
    expect(r1.status).toBe('ok');
    const tg = boxSet(w.fake, 'Thanksgiving Movies');
    expect(tg?.children).toEqual(['m-ptna']);
    expect(tg?.SortName).toBe('!0000000000_thanksgiving movies');
    expect(tg?.Tags).toContain('managed:maverick-collections');
    expect(tg?.LockedFields).toEqual(['Name', 'Overview', 'Tags']);
    expect(tg?.images?.Primary).toBeGreaterThan(0);
    expect(w.fake.items.get('m-ptna')?.LockData).toBe(false);

    expect(boxSet(w.fake, 'Christmas Movies')).toBeUndefined();
    const xmas = actionsFor(w.app, 'seasonal-christmas');
    const adds = xmas.filter((a) => a.type === 'collection.add_items');
    expect(adds.map((a) => a.item?.name).sort()).toEqual(['Elf', 'Home Alone', "Mickey's Christmas Carol"]); // the second movie library included
    expect(adds.every((a) => a.status === 'proposed')).toBe(true);
    expect(xmas.find((a) => a.type === 'collection.create')?.status).toBe('approved');
    expect(xmas[0]?.applyAt).toBe(ET(2026, 12, 1));

    // Weekly session: approve two, dismiss one.
    const elf = adds.find((a) => a.item?.name === 'Elf')!;
    const home = adds.find((a) => a.item?.name === 'Home Alone')!;
    const mickey = adds.find((a) => a.item?.name === "Mickey's Christmas Carol")!;
    decide(w.app.db, [elf.id, home.id], 'approve', 'admin');
    decide(w.app.db, [mickey.id], 'dismiss', 'admin');

    // A re-plan before the flip keeps the approvals and doesn't bring the dismissal back.
    await runPipeline(w.app, { job: 'nightly-refresh', trigger: 'schedule', index: false, now: ET(2026, 11, 28, 2, 30) });
    const again = actionsFor(w.app, 'seasonal-christmas').filter((a) => a.type === 'collection.add_items' && ['proposed', 'approved'].includes(a.status));
    expect(again.map((a) => [a.item?.name, a.status])).toEqual(expect.arrayContaining([['Elf', 'approved'], ['Home Alone', 'approved']]));
    expect(again.some((a) => a.item?.name === "Mickey's Christmas Carol")).toBe(false);
    expect(boxSet(w.fake, 'Christmas Movies')).toBeUndefined();

    // 1 Dec 00:00: the window check flips both windows.
    const r3 = await runPipeline(w.app, { job: 'window-check', trigger: 'schedule', index: false, now: ET(2026, 12, 1, 0, 0) });
    expect(r3.status).toBe('ok');
    const box = boxSet(w.fake, 'Christmas Movies');
    expect(box?.children?.sort()).toEqual(['m-elf', 'm-home']);
    expect(box?.ForcedSortName).toBe('!00_Christmas Movies');
    expect(box?.Overview).toBe('A collection of Christmas movies that may relate to the season.');
    expect(boxSet(w.fake, 'Thanksgiving Movies')).toBeUndefined();
    expect(w.fake.items.has('m-ptna')).toBe(true); // the film stays
    const tgManaged = w.app.db.select().from(managedCollection).where(eq(managedCollection.definitionId, defId(w.app, 'seasonal-thanksgiving'))).get();
    expect(tgManaged?.state).toBe('absent');
    expect(tgManaged?.savedMeta?.sortTitle).toBe('!00_Thanksgiving Movies');
  });

  it('never creates an empty box set when every add is still waiting for review', async () => {
    await runPipeline(w.app, { job: 'window-check', trigger: 'manual', index: true, now: ET(2026, 12, 1, 0, 5) });
    expect(boxSet(w.fake, 'Christmas Movies')).toBeUndefined();
    const create = actionsFor(w.app, 'seasonal-christmas').find((a) => a.type === 'collection.create');
    expect(create?.status).toBe('approved'); // waiting for members
  });
});

describe('dry run and failure policy', () => {
  it('dry run sends everything to Review, even Auto actions', async () => {
    const w = world();
    w.app.updateSettings({ dryRun: true });
    await runPipeline(w.app, { job: 'nightly-refresh', trigger: 'manual', index: true, now: ET(2026, 11, 17, 2, 30) });
    expect(w.fake.boxSets()).toHaveLength(0);
    const tg = actionsFor(w.app, 'seasonal-thanksgiving');
    expect(tg.length).toBeGreaterThan(0);
    expect(tg.every((a) => a.status === 'proposed' && a.mode === 'review')).toBe(true);
  });

  it('a failing source keeps its last good result and never causes removals (ADR-008)', async () => {
    const w = world();
    await runPipeline(w.app, { job: 'nightly-refresh', trigger: 'manual', index: true, now: ET(2026, 12, 2, 2, 30) });
    expect(boxSet(w.fake, 'Christmas Movies')?.children?.length).toBe(3);
    w.mdblistDown = true;
    const r = await runPipeline(w.app, { job: 'nightly-refresh', trigger: 'schedule', index: true, now: ET(2026, 12, 4, 2, 30) });
    expect(r.stats.sourcesStale).toBeGreaterThanOrEqual(1);
    expect(boxSet(w.fake, 'Christmas Movies')?.children?.length).toBe(3);
    expect(actionsFor(w.app, 'seasonal-christmas').some((a) => a.type === 'collection.remove_items')).toBe(false);
  });

  it('proposes removals for items that left a healthy source (remove = Review by default)', async () => {
    const w = world();
    await runPipeline(w.app, { job: 'nightly-refresh', trigger: 'manual', index: true, now: ET(2026, 12, 2, 2, 30) });
    // Die Hard added to the box set by hand in Jellyfin: not on any source.
    const box = boxSet(w.fake, 'Christmas Movies')!;
    box.children!.push('m-diehard');
    await runPipeline(w.app, { job: 'nightly-refresh', trigger: 'schedule', index: false, now: ET(2026, 12, 3, 2, 30) });
    const rm = actionsFor(w.app, 'seasonal-christmas').filter((a) => a.type === 'collection.remove_items');
    expect(rm.map((a) => [a.item?.name, a.status])).toEqual([['Die Hard', 'proposed']]);
    expect(box.children).toContain('m-diehard');
  });
});

describe('turning a collection off', () => {
  it('proposes deleting its box set, routed by the delete mode', async () => {
    const w = world();
    await runPipeline(w.app, { job: 'nightly-refresh', trigger: 'manual', index: true, now: ET(2026, 12, 2, 2, 30) });
    expect(boxSet(w.fake, 'Christmas Movies')).toBeDefined();
    w.app.db.update(definition).set({ enabled: false, updatedAt: ET(2026, 12, 2, 9) }).where(eq(definition.slug, 'seasonal-christmas')).run();
    await runPipeline(w.app, { job: 'nightly-refresh', trigger: 'schedule', index: false, now: ET(2026, 12, 3, 2, 30) });
    const del = actionsFor(w.app, 'seasonal-christmas').filter((a) => a.type === 'collection.delete');
    expect(del.map((a) => [a.reason, a.status])).toEqual([['Collection turned off', 'applied']]);
    expect(boxSet(w.fake, 'Christmas Movies')).toBeUndefined();
    expect(w.fake.items.get('m-elf')).toBeDefined(); // films stay
  });
});

describe('undo (Activity)', () => {
  const applied = (w: World, type: string) => actionsFor(w.app, 'seasonal-christmas').filter((a) => a.type === type && a.status === 'applied' && !a.undoOf);

  it('recreates a deleted box set with its members, metadata and ownership tag, and keeps it', async () => {
    const w = world();
    await runPipeline(w.app, { job: 'nightly-refresh', trigger: 'manual', index: true, now: ET(2026, 12, 2, 2, 30) });
    await runPipeline(w.app, { job: 'window-check', trigger: 'schedule', index: false, now: ET(2027, 1, 1, 0, 1) });
    expect(boxSet(w.fake, 'Christmas Movies')).toBeUndefined();
    const [del] = applied(w, 'collection.delete');
    expect((del!.before as { members: string[] }).members.sort()).toEqual(['m-elf', 'm-home', 'm-mickey']);
    expect(await undoAction(w.app, del!.id, 'admin')).toMatch(/Recreated Christmas Movies with 3 titles/);
    const box = boxSet(w.fake, 'Christmas Movies')!;
    expect(box.children!.sort()).toEqual(['m-elf', 'm-home', 'm-mickey']);
    expect(box.ForcedSortName).toBe('!00_Christmas Movies');
    expect(box.Tags).toContain(MANAGED_TAG);
    expect(box.images?.Primary).toBeGreaterThan(10_000); // its own poster (ADR-045), put back too
    // The next run doesn't delete it again (the window-closed delete is dismissed), and it can't be undone twice.
    await runPipeline(w.app, { job: 'window-check', trigger: 'schedule', index: false, now: ET(2027, 1, 2, 0, 1) });
    expect(boxSet(w.fake, 'Christmas Movies')).toBeDefined();
    await expect(undoAction(w.app, del!.id, 'admin')).rejects.toThrow(/Already undone/);
  });

  it('deletes a box set it created, and doesn’t recreate it this season', async () => {
    const w = world();
    await runPipeline(w.app, { job: 'nightly-refresh', trigger: 'manual', index: true, now: ET(2026, 12, 2, 2, 30) });
    const [create] = applied(w, 'collection.create');
    await undoAction(w.app, create!.id, 'admin');
    expect(boxSet(w.fake, 'Christmas Movies')).toBeUndefined();
    expect(w.fake.items.get('m-elf')).toBeDefined();
    await runPipeline(w.app, { job: 'nightly-refresh', trigger: 'schedule', index: false, now: ET(2026, 12, 3, 2, 30) });
    expect(boxSet(w.fake, 'Christmas Movies')).toBeUndefined();
  });

  it('restores earlier metadata, keeps the ownership tag, and holds off the drift fix', async () => {
    const w = world();
    await runPipeline(w.app, { job: 'nightly-refresh', trigger: 'manual', index: true, now: ET(2026, 12, 2, 2, 30) });
    const [meta] = applied(w, 'collection.update_metadata');
    await undoAction(w.app, meta!.id, 'admin');
    const box = boxSet(w.fake, 'Christmas Movies')!;
    expect(box.ForcedSortName ?? null).toBeNull();
    expect(box.Tags).toContain(MANAGED_TAG);
    await runPipeline(w.app, { job: 'nightly-refresh', trigger: 'schedule', index: false, now: ET(2026, 12, 3, 2, 30) });
    expect(boxSet(w.fake, 'Christmas Movies')!.ForcedSortName ?? null).toBeNull();
  });
});

describe('tag-gate visibility (ADR-010)', () => {
  it('hides the box set at the close, keeps it between seasons, and shows the same one next year', async () => {
    const w = world();
    w.app.db.update(definition).set({ visibility: 'tag_gate' }).where(eq(definition.slug, 'seasonal-christmas')).run();
    await runPipeline(w.app, { job: 'nightly-refresh', trigger: 'manual', index: true, now: ET(2026, 12, 2, 2, 30) });
    const id = boxSet(w.fake, 'Christmas Movies')!.Id;
    // 1 Jan: hidden, not deleted. Every user blocks the tag; the admin's policy is otherwise intact.
    await runPipeline(w.app, { job: 'window-check', trigger: 'schedule', index: false, now: ET(2027, 1, 1, 0, 1) });
    const box = boxSet(w.fake, 'Christmas Movies')!;
    expect(box.Id).toBe(id);
    expect(box.Tags).toEqual(expect.arrayContaining([GATE_TAG, MANAGED_TAG]));
    expect(box.children).toHaveLength(3);
    expect(w.fake.users[0]!.Policy).toEqual({ IsAdministrator: true, BlockedTags: [GATE_TAG] });
    expect(w.app.db.select().from(managedCollection).all().find((m) => m.jfBoxsetId === id)?.state).toBe('hidden');
    expect(actionsFor(w.app, 'seasonal-christmas').some((a) => a.type === 'collection.delete')).toBe(false);
    // A user added later gets the tag blocked on the next run.
    w.fake.users.push({ Id: 'kid-1', Name: 'kid', Password: 'x', Policy: { IsAdministrator: false, BlockedTags: ['other'] } });
    await runPipeline(w.app, { job: 'nightly-refresh', trigger: 'schedule', index: false, now: ET(2027, 1, 2, 2, 30) });
    expect(w.fake.users[1]!.Policy.BlockedTags).toEqual(['other', GATE_TAG]);
    // Next season: shown again at the 1 Dec flip, same box set, still with its films.
    await runPipeline(w.app, { job: 'nightly-refresh', trigger: 'schedule', index: false, now: ET(2027, 11, 20, 2, 30) });
    const show = actionsFor(w.app, 'seasonal-christmas').find((a) => a.type === 'collection.show');
    expect(show?.status).toBe('approved');
    expect(boxSet(w.fake, 'Christmas Movies')!.Tags).toContain(GATE_TAG);
    await runPipeline(w.app, { job: 'window-check', trigger: 'schedule', index: false, now: ET(2027, 12, 1, 0, 1) });
    const back = boxSet(w.fake, 'Christmas Movies')!;
    expect(back.Id).toBe(id);
    expect(back.Tags).not.toContain(GATE_TAG);
    expect(back.children).toHaveLength(3);
    expect(w.fake.boxSets().filter((b) => b.Name === 'Christmas Movies')).toHaveLength(1);
  });
});

