// Poster overlays (ADR-039): Kometa's status badges and IMDb Top 250 ribbon drawn on copies of posters, with the
// originals kept and put back. Real JPEGs throughout, so what Jellyfin ends up holding is checked byte for byte.
import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { overlayLibraries } from '../src/web/overlay-actions.js';
import { openDb } from '../src/db/index.js';
import { createContext } from '../src/app-context.js';
import { readConfig } from '../src/config.js';
import { isRunning, runPipeline } from '../src/pipeline/run.js';
import { definition, overlay } from '../src/db/schema.js';
import { hasMarker, renderOverlay, sha256 } from '../src/overlays/render.js';
import { originalsDir } from '../src/overlays/sync.js';
import { FakeJellyfin, FAKE_URL } from './fakes/jellyfin.js';
import type { FetchLike } from '../src/clients/http.js';
import { setup, signIn, csrfOf, form, flash } from './helpers/web.js';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 20, 15);
const daysAgo = (n: number) => new Date(Date.UTC(2026, 10, 20 - n)).toISOString();

/** A plain poster in one colour, as a JPEG, so each one is different. */
const poster = (rgb: [number, number, number], w = 680, h = 1000) => sharp({ create: { width: w, height: h, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).jpeg({ quality: 90 }).toBuffer().then((b) => new Uint8Array(b));
const pixel = async (img: Uint8Array, x: number, y: number) => {
  const { data, info } = await sharp(img).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i]!, data[i + 1]!, data[i + 2]!] as [number, number, number];
};

describe('Drawing overlays', () => {
  it('draws Kometa’s status box top left and the ribbon bottom right, at the poster’s own size, marked as the app’s', async () => {
    const original = await poster([40, 120, 200]);
    const out = await renderOverlay(original, ['status:returning', 'ribbon:imdb_top_250']);
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([680, 1000, 'jpeg']);
    expect(await hasMarker(out)).toBe(true);
    expect(await hasMarker(original)).toBe(false);
    const [r, g, b] = await pixel(out, 14, 40); // inside the status box, left of the text: darkened
    expect(r + g + b).toBeLessThan(40 + 120 + 200 - 120);
    const band = await pixel(out, 500, 990); // the ribbon's yellow band, across the bottom-right corner
    expect(band[0]).toBeGreaterThan(200);
    expect(band[2]).toBeLessThan(100);
    const middle = await pixel(out, 340, 500); // untouched
    expect(Math.abs(middle[2]! - 200)).toBeLessThan(8);
    // Same input, same output; a 4K poster scales with it.
    expect(sha256(await renderOverlay(original, ['status:returning', 'ribbon:imdb_top_250']))).toBe(sha256(out));
    const big = await renderOverlay(await poster([40, 120, 200], 2000, 3000), ['status:ended']);
    expect((await sharp(big).metadata()).width).toBe(2000);
  });
});

function world() {
  const fake = new FakeJellyfin();
  const tvStatus: Record<string, string> = { '100': 'Returning Series', '200': 'Canceled', '300': 'In Production', '400': 'Returning Series' };
  const chart: Record<string, string[]> = { TOP_RATED_MOVIES: ['tt0111161'], TOP_RATED_TV_SHOWS: ['tt0903747'] };
  let imdbDown = false;
  const calls: string[] = [];
  const net: FetchLike = async (url, init) => {
    const tv = url.match(/api\.themoviedb\.org\/3\/tv\/(\d+)\?/);
    if (tv) { calls.push(`tv ${tv[1]}`); return new Response(JSON.stringify({ id: Number(tv[1]), status: tvStatus[tv[1]!] })); }
    if (url === 'https://api.graphql.imdb.com/') {
      if (imdbDown) return new Response('down', { status: 503 });
      const type = String(JSON.parse(String(init?.body)).query).match(/chartType: (\w+)/)![1]!;
      return new Response(JSON.stringify({ data: { chartTitles: { edges: (chart[type] ?? []).map((id) => ({ node: { id } })), total: 1 } } }));
    }
    return new Response('[]');
  };
  const config = { ...readConfig({}), configDir: mkdtempSync(join(tmpdir(), 'mc-')), timezone: 'America/New_York', seeds: {} };
  const app = createContext(config, { db: openDb(':memory:'), fetch: net, jellyfinFetch: fake.fetch() });
  app.updateSettings({ connections: { jellyfinUrl: FAKE_URL, plexUrl: '', radarrUrl: '', sonarrUrl: '' }, firstRunDone: true });
  app.secrets.set('jellyfin.apiKey', fake.apiKey);
  app.secrets.set('tmdb.apiKey', 'k');
  app.db.update(definition).set({ enabled: false }).run();
  return { fake, app, tvStatus, chart, calls, setImdbDown: (v: boolean) => { imdbDown = v; } };
}

async function library(fake: FakeJellyfin) {
  const originals: Record<string, Uint8Array> = {};
  const add = async (item: Parameters<FakeJellyfin['add']>[0] & { Id: string }, rgb: [number, number, number]) => {
    fake.add(item);
    originals[item.Id] = await poster(rgb);
    fake.setImage(item.Id, originals[item.Id]!);
  };
  await add({ Id: 's-airing', Name: 'Airing Show', Type: 'Series', ParentId: 'lib-shows', ProviderIds: { Tmdb: '400' } }, [200, 30, 30]);
  fake.add({ Id: 'e-new', Name: 'Pilot', Type: 'Episode', SeriesId: 's-airing', ParentIndexNumber: 1, IndexNumber: 1, PremiereDate: daysAgo(3) });
  await add({ Id: 's-ret', Name: 'Returning Show', Type: 'Series', ParentId: 'lib-shows', ProviderIds: { Tmdb: '100', Imdb: 'tt0903747' } }, [30, 200, 30]);
  await add({ Id: 's-can', Name: 'Canceled Show', Type: 'Series', ParentId: 'lib-shows', ProviderIds: { Tmdb: '200' } }, [30, 30, 200]);
  await add({ Id: 's-prod', Name: 'In Production', Type: 'Series', ParentId: 'lib-shows', ProviderIds: { Tmdb: '300' }, Status: 'Continuing' } as never, [90, 90, 90]);
  await add({ Id: 's-jf', Name: 'Jellyfin Only', Type: 'Series', ParentId: 'lib-shows', Status: 'Ended' } as never, [120, 60, 0]);
  await add({ Id: 'm-top', Name: 'The Shawshank Redemption', Type: 'Movie', ParentId: 'lib-movies', ProviderIds: { Imdb: 'tt0111161' } }, [200, 200, 0]);
  await add({ Id: 'm-plain', Name: 'Plain Film', Type: 'Movie', ParentId: 'lib-movies', ProviderIds: { Imdb: 'tt0000001' } }, [0, 200, 200]);
  return originals;
}

const records = (app: ReturnType<typeof world>['app']) => Object.fromEntries(app.db.select().from(overlay).all().map((r) => [r.jfId, r.badges]));
const run = (app: ReturnType<typeof world>['app'], now: number, applyOverlays = false) => runPipeline(app, { job: 'manual', trigger: 'manual', index: true, now, applyOverlays });
const current = (fake: FakeJellyfin, id: string) => fake.imageData.get(`${id}/Primary`)!.bytes;

describe('Poster overlays', () => {
  it('stays off until turned on, and dry run only says what would change', async () => {
    const { app, fake } = world();
    await library(fake);
    await run(app, NOW);
    expect(fake.uploads).toEqual([]);
    app.updateSettings({ overlays: { status: true, imdbTop250: true } });
    const r = await run(app, NOW);
    expect(fake.uploads).toEqual([]); // dry run is on
    expect(r.stats.postersWithOverlays).toBe(0);
    expect(app.db.select().from(overlay).all()).toEqual([]);
  });

  it('puts Kometa’s badges on copies, keeps each original, and does nothing more while nothing changes', async () => {
    const { app, fake } = world();
    const originals = await library(fake);
    app.updateSettings({ overlays: { status: true, imdbTop250: true } });
    const r = await run(app, NOW, true); // Apply now, though dry run is on
    expect(r.stats).toMatchObject({ overlaysAdded: 5, overlaysFailed: 0, postersWithOverlays: 5 });
    expect(records(app)).toEqual({
      's-airing': ['status:airing'], // an episode aired 3 days ago beats TMDb's "Returning"
      's-ret': ['status:returning', 'ribbon:imdb_top_250'],
      's-can': ['status:canceled'],
      's-jf': ['status:ended'], // no TMDb ID: Jellyfin's status
      'm-top': ['ribbon:imdb_top_250'],
      // In Production on TMDb: no badge, even though Jellyfin says Continuing
      's-prod': undefined,
    } as never);
  });

  it('leaves kids’ libraries alone by default, found by name or by ratings, and does one you tick', async () => {
    const { app, fake } = world();
    await library(fake);
    // "Saturday Mornings": no telling name, but every show is rated TV-Y7. "Animated Classics": the name says so.
    fake.libraries.push({ Name: 'Saturday Mornings', CollectionType: 'tvshows', ItemId: 'lib-sat' });
    for (let i = 0; i < 5; i++) {
      fake.add({ Id: `s-kid${i}`, Name: `Kid Show ${i}`, Type: 'Series', ParentId: 'lib-sat', OfficialRating: 'TV-Y7', ProviderIds: { Tmdb: '200' } } as never);
      fake.setImage(`s-kid${i}`, await poster([40 * i, 90, 90]));
    }
    fake.add({ Id: 'm-cartoon', Name: 'Cartoon Classic', Type: 'Movie', ParentId: 'lib-animated', ProviderIds: { Imdb: 'tt0111161' } });
    fake.setImage('m-cartoon', await poster([250, 120, 0]));
    app.updateSettings({ overlays: { status: true, imdbTop250: true, skipLibraryIds: null } });
    await run(app, NOW, true);
    expect(records(app)['s-kid0']).toBeUndefined();
    expect(records(app)['m-cartoon']).toBeUndefined(); // on the Top 250, but in a kids' library
    expect(records(app)['s-can']).toEqual(['status:canceled']);
    expect(overlayLibraries(app).libraries.map((l) => `${l.name}${l.kids ? ' (kids)' : ''}: ${l.on ? 'on' : 'off'}`)).toEqual([
      'Animated Classics (kids): off', 'Movies: on', 'Saturday Mornings (kids): off', 'Shows: on',
    ]);
    // Ticking Saturday Mornings in Settings: its shows get their badges on the next update.
    app.updateSettings({ overlays: { status: true, imdbTop250: true, skipLibraryIds: ['lib-animated'] } });
    await run(app, NOW + 60_000, true);
    expect(records(app)['s-kid0']).toEqual(['status:canceled']);
    expect(records(app)['m-cartoon']).toBeUndefined();
  });

  it('keeps each original byte for byte, and uploads nothing more while nothing changes', async () => {
    const { app, fake } = world();
    const originals = await library(fake);
    app.updateSettings({ overlays: { status: true, imdbTop250: true } });
    await run(app, NOW, true);
    for (const r of app.db.select().from(overlay).all()) {
      expect(sha256(readFileSync(join(originalsDir(app), r.file)))).toBe(sha256(originals[r.jfId]!));
      expect(sha256(current(fake, r.jfId))).toBe(r.appliedHash);
      expect(await hasMarker(current(fake, r.jfId))).toBe(true);
    }
    expect(sha256(current(fake, 'm-plain'))).toBe(sha256(originals['m-plain']!)); // no badge: untouched
    const before = fake.uploads.length;
    await run(app, NOW + DAY, true);
    expect(fake.uploads.length).toBe(before);
  });

  it('redraws from the original when a badge changes, never on top of the old badges', async () => {
    const { app, fake, tvStatus } = world();
    const originals = await library(fake);
    app.updateSettings({ overlays: { status: true, imdbTop250: false } });
    await run(app, NOW, true);
    tvStatus['100'] = 'Ended'; // a week later TMDb says it ended (statuses are kept for 7 days)
    await run(app, NOW + 8 * DAY, true);
    expect(records(app)['s-ret']).toEqual(['status:ended']);
    expect(sha256(current(fake, 's-ret'))).toBe(sha256(await renderOverlay(originals['s-ret']!, ['status:ended'])));
    // The airing show's episode is now 11 days old: still AIRING (14 days). At 15 days it goes back to TMDb's status.
    expect(records(app)['s-airing']).toEqual(['status:airing']);
    await run(app, NOW + 12 * DAY, true);
    expect(records(app)['s-airing']).toEqual(['status:returning']);
  });

  it('takes a new poster chosen in Jellyfin as the new original, and puts the badges back on it', async () => {
    const { app, fake } = world();
    await library(fake);
    app.updateSettings({ overlays: { status: true, imdbTop250: false } });
    await run(app, NOW, true);
    const chosen = await poster([255, 255, 255]);
    fake.setImage('s-can', chosen); // say, a metadata refresh replaced it
    const r = await run(app, NOW + DAY, true);
    expect(r.stats.overlaysUpdated).toBe(1);
    const rec = app.db.select().from(overlay).where(eq(overlay.jfId, 's-can')).get()!;
    expect(sha256(readFileSync(join(originalsDir(app), rec.file)))).toBe(sha256(chosen));
    expect(sha256(current(fake, 's-can'))).toBe(sha256(await renderOverlay(chosen, ['status:canceled'])));
  });

  it('keeps ribbons as they are when the IMDb chart can’t be read', async () => {
    const { app, fake, setImdbDown } = world();
    await library(fake);
    app.updateSettings({ overlays: { status: false, imdbTop250: true } });
    await run(app, NOW, true);
    expect(records(app)).toEqual({ 's-ret': ['ribbon:imdb_top_250'], 'm-top': ['ribbon:imdb_top_250'] });
    setImdbDown(true);
    const before = fake.uploads.length;
    await runPipeline(app, { job: 'manual', trigger: 'manual', index: true, now: NOW + 2 * DAY, forceSources: true, applyOverlays: true });
    expect(fake.uploads.length).toBe(before);
    expect(records(app)).toEqual({ 's-ret': ['ribbon:imdb_top_250'], 'm-top': ['ribbon:imdb_top_250'] });
  });

  it('puts every original back, byte for byte, when overlays are turned off', async () => {
    const { app, fake } = world();
    const originals = await library(fake);
    app.updateSettings({ overlays: { status: true, imdbTop250: true } });
    await run(app, NOW, true);
    app.updateSettings({ overlays: { status: false, imdbTop250: false } });
    const r = await run(app, NOW + DAY, true);
    expect(r.stats).toMatchObject({ overlaysRemoved: 5, postersWithOverlays: 0 });
    for (const id of Object.keys(originals)) expect(sha256(current(fake, id))).toBe(sha256(originals[id]!));
    expect(app.db.select().from(overlay).all()).toEqual([]);
    expect(readdirSync(originalsDir(app))).toEqual([]);
  });

  it('recognises its own upload after a crash before the upload was recorded', async () => {
    const { app, fake } = world();
    await library(fake);
    app.updateSettings({ overlays: { status: true, imdbTop250: false } });
    await run(app, NOW, true);
    app.db.update(overlay).set({ appliedTag: null }).where(eq(overlay.jfId, 's-can')).run();
    const before = fake.uploads.length;
    await run(app, NOW + DAY, true);
    expect(fake.uploads.length).toBe(before); // nothing redrawn, nothing taken for an original
    expect(app.db.select().from(overlay).where(eq(overlay.jfId, 's-can')).get()!.appliedTag).not.toBeNull();
  });

  it('never draws on a poster that already carries its overlays when the original isn’t saved', async () => {
    const { app, fake } = world();
    const originals = await library(fake);
    // As if /config had been restored from a backup made before the overlays went on.
    const overlaid = await renderOverlay(originals['s-can']!, ['status:canceled']);
    fake.setImage('s-can', overlaid);
    app.updateSettings({ overlays: { status: true, imdbTop250: false } });
    await run(app, NOW, true);
    expect(fake.uploads.some((u) => u.id === 's-can')).toBe(false);
    expect(records(app)['s-can']).toBeUndefined();
  });

  it('forgets titles that are gone from Jellyfin', async () => {
    const { app, fake } = world();
    await library(fake);
    app.updateSettings({ overlays: { status: true, imdbTop250: false } });
    await run(app, NOW, true);
    const file = app.db.select().from(overlay).where(eq(overlay.jfId, 's-jf')).get()!.file;
    fake.items.delete('s-jf');
    await run(app, NOW + DAY, true);
    expect(records(app)['s-jf']).toBeUndefined();
    expect(existsSync(join(originalsDir(app), file))).toBe(false);
  });
});

async function untilIdle() {
  for (let i = 0; i < 250 && isRunning(); i++) await new Promise((r) => setTimeout(r, 20));
  expect(isRunning()).toBe(false);
}

describe('Poster overlays in Settings', () => {
  it('chooses badges, previews them without changing anything, applies them, and puts the originals back', async () => {
    const t = setup();
    await t.web.request('/setup', form({ url: FAKE_URL, apiKey: t.fake.apiKey, setupCode: t.app.setupCode ?? '' }));
    t.fake.add({ Id: 's-end', Name: 'Finished Show', Type: 'Series', ParentId: 'lib-shows', Status: 'Ended' } as never);
    const original = await poster([10, 90, 160]);
    t.fake.setImage('s-end', original);
    await runPipeline(t.app, { job: 'manual', trigger: 'manual', index: true });
    const { cookie } = await signIn(t.web);
    const csrf = await csrfOf(t.web, cookie, '/settings');
    const post = (path: string, data: Record<string, string> = {}) => t.web.request(path, { ...form({ _csrf: csrf, ...data }), headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' } });
    const panel = async () => (await t.web.request('/settings/overlays', { headers: { cookie } })).text();

    expect(await (await t.web.request('/settings', { headers: { cookie } })).text()).toContain('Poster overlays');
    expect(await panel()).toContain('0 posters have overlays.');
    expect(flash(await post('/settings/overlays', { status: '1' }))).toContain('Saved');
    expect(t.app.settings().overlays).toEqual({ status: true, imdbTop250: false, skipLibraryIds: null });
    const p = await panel();
    expect(p).toContain('1 would change on the next update.');
    expect(p).toContain('Dry run is on, so runs only check');
    expect(p).toContain('/settings/overlays/preview/s-end');

    const preview = await t.web.request('/settings/overlays/preview/s-end', { headers: { cookie } });
    expect(preview.headers.get('content-type')).toBe('image/jpeg');
    expect(sha256(new Uint8Array(await preview.arrayBuffer()))).toBe(sha256(await renderOverlay(original, ['status:ended'])));
    expect((await t.web.request('/settings/overlays/preview/m-ptna', { headers: { cookie } })).status).toBe(404); // no badges
    expect(t.fake.uploads).toEqual([]);

    expect((await post('/settings/overlays/apply')).headers.get('location')).toMatch(/^\/\?ok=/);
    await untilIdle();
    expect(t.fake.uploads.map((u) => u.id)).toEqual(['s-end']);
    expect(await panel()).toContain('1 poster has overlays.');

    await post('/settings/overlays/remove');
    await untilIdle();
    expect(t.app.settings().overlays).toEqual({ status: false, imdbTop250: false, skipLibraryIds: null });
    expect(sha256(current(t.fake, 's-end'))).toBe(sha256(original));
    expect(await panel()).toContain('0 posters have overlays.');
  });
});
