// New and recent collections (ADR-037): Kometa's chart/basic.yml (Newly Released, New Episodes) plus Recently Added,
// built from the library's own dates and kept up to date every run.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { eq } from 'drizzle-orm';
import { openDb } from '../src/db/index.js';
import { createContext } from '../src/app-context.js';
import { readConfig } from '../src/config.js';
import { runPipeline } from '../src/pipeline/run.js';
import { action, definition, definitionMode, libraryItem, sourceResult } from '../src/db/schema.js';
import { PRESETS } from '../src/presets/index.js';
import { parseSourceInput } from '../src/domain/source-input.js';
import { FakeJellyfin, FAKE_URL } from './fakes/jellyfin.js';
import type { FetchLike } from '../src/clients/http.js';
import { setup, signIn } from './helpers/web.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 20, 15); // 20 Nov 2026, 15:00 UTC
const daysAgo = (n: number) => new Date(Date.UTC(2026, 10, 20 - n)).toISOString();

describe('basic presets vs Kometa v2.5.3 defaults/chart/basic.yml', () => {
  const yml = parse(readFileSync(join(__dirname, 'fixtures/kometa-v2.5.3/basic-chart.yml'), 'utf8'));
  const basic = PRESETS.filter((p) => p.family === 'basic').map((p) => p.definition);

  it('has Kometa’s two collections with its day counts, and Recently Added', () => {
    expect(Object.keys(yml.collections)).toEqual(['Newly Released', 'New Episodes']);
    const released = yml.collections['Newly Released'].template[0];
    const episodes = yml.collections['New Episodes'].template[0];
    expect(basic.map((d) => d.name)).toEqual(['Newly Released Movies', 'Newly Released Shows', 'New Episodes', 'Recently Added Movies', 'Recently Added Shows']);
    expect(basic.find((d) => d.name === 'Newly Released Movies')!.sources).toEqual([{ type: 'jellyfin_recent', config: { field: 'premiere', days: released.in_the_last_released, kind: 'movie' } }]);
    expect(basic.find((d) => d.name === 'New Episodes')).toMatchObject({
      target: 'episodes', sortTitle: '!010_New Episodes', overview: 'A collection of newly-released episodes.',
      sources: [{ type: 'jellyfin_recent', config: { field: 'premiere', days: episodes.in_the_last_episodes, kind: 'episode' } }],
      poster: { kind: 'url', url: 'https://raw.githubusercontent.com/Kometa-Team/Default-Images/master/chart/color/New%20Episodes.jpg' },
    });
    expect(yml.collections['New Episodes'].template[1].allowed_libraries).toBe('show');
    expect(basic.find((d) => d.name === 'Recently Added Shows')).toMatchObject({ target: 'shows', overview: 'A collection of recently-added shows.', sources: [{ config: { field: 'added', days: 30, kind: 'series' } }] });
    // Titles age out daily, so taking them out doesn't wait for review; everything starts off.
    expect(basic.every((d) => d.modes?.['collection.remove_items'] === 'auto' && d.minItems === 1 && d.syncMode === 'sync')).toBe(true);
    expect(PRESETS.filter((p) => p.family === 'basic').every((p) => !p.enabledByDefault)).toBe(true);
  });
});

function world() {
  const fake = new FakeJellyfin();
  const film = (Id: string, Name: string, released: number | null, added: number) => fake.add({ Id, Name, Type: 'Movie', ParentId: 'lib-movies', ProductionYear: 2026, ...(released === null ? {} : { PremiereDate: daysAgo(released) }), DateCreated: daysAgo(added) });
  film('m-new', 'Fresh Film', 10, 5); // released 10 days ago, added 5 days ago
  film('m-edge', 'Edge Film', 89, 29); // just inside 90 and 30 days
  film('m-old', 'Old Film', 400, 100);
  film('m-future', 'Future Film', -20, 1); // a release date to come doesn't count
  film('m-undated', 'Undated Film', null, 200);
  fake.add({ Id: 's-new', Name: 'New Show', Type: 'Series', ParentId: 'lib-shows', PremiereDate: daysAgo(30), DateCreated: daysAgo(3) });
  fake.add({ Id: 's-old', Name: 'Old Show', Type: 'Series', ParentId: 'lib-shows', PremiereDate: daysAgo(3000), DateCreated: daysAgo(900) });
  const ep = (Id: string, n: number, aired: number) => fake.add({ Id, Name: `Episode ${n}`, Type: 'Episode', SeriesId: 's-old', ParentIndexNumber: 9, IndexNumber: n, PremiereDate: daysAgo(aired), DateCreated: daysAgo(aired) });
  ep('e-today', 3, 0);
  ep('e-week', 2, 6); // the 7th day back, today counted
  ep('e-older', 1, 7);
  const net: FetchLike = async (url) => (url.includes('Default-Images') ? new Response(new Uint8Array([0xff, 0xd8, 1]), { headers: { 'content-type': 'image/jpeg' } }) : new Response('[]'));
  const config = { ...readConfig({}), configDir: mkdtempSync(join(tmpdir(), 'mc-')), timezone: 'America/New_York', seeds: {} };
  const app = createContext(config, { db: openDb(':memory:'), fetch: net, jellyfinFetch: fake.fetch() });
  app.updateSettings({ connections: { jellyfinUrl: FAKE_URL, plexUrl: '', radarrUrl: '', sonarrUrl: '' }, firstRunDone: true });
  app.secrets.set('jellyfin.apiKey', fake.apiKey);
  app.db.update(definition).set({ enabled: false }).run();
  for (const p of PRESETS.filter((x) => x.family === 'basic')) app.db.update(definition).set({ enabled: true }).where(eq(definition.slug, p.definition.slug)).run();
  const def = (name: string) => app.db.select().from(definition).where(eq(definition.name, name)).get()!;
  const proposed = (name: string) => app.db.select().from(action).where(eq(action.definitionId, def(name).id)).all()
    .filter((a) => a.type === 'collection.add_items' && a.status === 'proposed').map((a) => a.item!.name).sort();
  const box = (name: string) => fake.boxSets().find((b) => b.Name === name);
  return { fake, app, def, proposed, box };
}

describe('New and recent collections', () => {
  it('stores each title’s release or air date in the library index', async () => {
    const { app } = world();
    await runPipeline(app, { job: 'manual', trigger: 'manual', index: true, now: NOW });
    const row = app.db.select().from(libraryItem).where(eq(libraryItem.jfId, 'e-week')).get()!;
    expect(row.premiereDate).toBe(Date.parse(daysAgo(6)));
    expect(app.db.select().from(libraryItem).where(eq(libraryItem.jfId, 'm-undated')).get()!.premiereDate).toBeNull();
  });

  it('holds the titles in each date window, newest first, today included and the future left out', async () => {
    const { app, proposed } = world();
    const r = await runPipeline(app, { job: 'manual', trigger: 'manual', index: true, now: NOW });
    expect(r.status).toBe('ok');
    expect(proposed('Newly Released Movies')).toEqual(['Edge Film', 'Fresh Film']);
    expect(proposed('Newly Released Shows')).toEqual(['New Show']);
    expect(proposed('New Episodes')).toEqual(['Old Show · S09E02 · Episode 2', 'Old Show · S09E03 · Episode 3']);
    // Newest first, as Kometa sorts them.
    const added = app.db.select().from(sourceResult).all().find((r) => r.label === 'Added in the last 30 days' && r.items?.some((i) => i.kind === 'movie'))!;
    expect(added.items!.map((i) => i.title)).toEqual(['Future Film', 'Fresh Film', 'Edge Film']);
    expect(proposed('Recently Added Movies')).toEqual(['Edge Film', 'Fresh Film', 'Future Film']);
    expect(proposed('Recently Added Shows')).toEqual(['New Show']);
  });

  it('keeps up day by day: titles that age out are taken out without waiting for review', async () => {
    const { app, box } = world();
    app.updateSettings({ dryRun: false });
    await runPipeline(app, { job: 'manual', trigger: 'manual', index: true, now: NOW });
    expect(box('Newly Released Movies')?.children?.sort()).toEqual(['m-edge', 'm-new']);
    expect(box('New Episodes')?.children?.sort()).toEqual(['e-today', 'e-week']);
    // Two days later, without re-indexing (the midnight run): Edge Film is past 90 days, the older episode past 7.
    await runPipeline(app, { job: 'window-check', trigger: 'schedule', index: false, now: NOW + 2 * DAY });
    expect(box('Newly Released Movies')?.children).toEqual(['m-new']);
    expect(box('New Episodes')?.children).toEqual(['e-today']);
    // Eight days later nothing aired in the last week: below the minimum of 1, so the box set goes.
    await runPipeline(app, { job: 'window-check', trigger: 'schedule', index: false, now: NOW + 8 * DAY });
    expect(box('New Episodes')).toBeUndefined();
  });

  it('a collection can still send removals to Review by its own mode', async () => {
    const { app, def } = world();
    const id = def('Newly Released Movies').id;
    expect(app.db.select().from(definitionMode).where(eq(definitionMode.definitionId, id)).all().map((m) => [m.actionType, m.mode])).toEqual([['collection.remove_items', 'auto']]);
  });
});

describe('New and recent in the editor and Getting started', () => {
  it('parses a number of days for films, shows or episodes', () => {
    expect(parseSourceInput('recent_released', '14', 'episodes')).toEqual({ type: 'jellyfin_recent', config: { field: 'premiere', days: 14, kind: 'episode' } });
    expect(parseSourceInput('recent_added', '60', 'movies')).toEqual({ type: 'jellyfin_recent', config: { field: 'added', days: 60, kind: 'movie' } });
    expect(parseSourceInput('recent_added', '7', 'shows')).toEqual({ type: 'jellyfin_recent', config: { field: 'added', days: 7, kind: 'series' } });
    expect(parseSourceInput('recent_added', 'a week', 'movies')).toMatch(/number of days/);
    expect(parseSourceInput('recent_released', '30', 'both')).toMatch(/films, shows or episodes/);
  });

  it('offers the family in Getting started', async () => {
    const { app, web, fake } = setup();
    await web.request('/setup', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ url: FAKE_URL, apiKey: fake.apiKey, setupCode: app.setupCode ?? '' }).toString() });
    const { cookie } = await signIn(web);
    const page = await (await web.request('/start', { headers: { cookie } })).text();
    expect(page).toContain('New and recent');
    expect(page).toContain('5 collections that follow your library: Newly Released Movies and Shows');
  });
});
