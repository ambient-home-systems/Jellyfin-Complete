// The presets' own posters (ADR-045): artwork made for the app, with the title set over it at build time. Which presets
// have one, how they look, the one-time switch from Kometa's posters, and box sets picking up the new poster.
import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { openDb } from '../src/db/index.js';
import { createContext } from '../src/app-context.js';
import { readConfig } from '../src/config.js';
import { runPipeline } from '../src/pipeline/run.js';
import { definition, managedCollection, posterKey, setting, type Poster } from '../src/db/schema.js';
import { seedPresets, upgradePosters } from '../src/domain/definitions.js';
import { readPoster } from '../src/domain/posters.js';
import { LEGACY_POSTER, PRESETS } from '../src/presets/index.js';
import { ART_DIR, bundledPoster, bundledPosterBytes, bundledPosters } from '../src/posters/bundled.js';
import { BUNDLED_POSTERS_REV } from '../src/posters/catalog.js';
import { createCollection, setPoster, updateCollection } from '../src/web/collection-actions.js';
import { sha256 } from '../src/overlays/render.js';
import { FakeJellyfin, FAKE_URL } from './fakes/jellyfin.js';
import type { FetchLike } from '../src/clients/http.js';

const NOW = Date.UTC(2026, 10, 20, 15);
const DAY = 86_400_000;
const OWN = ['seasonal', 'holiday_episodes', 'basic', 'imdb_chart', 'streaming'];

describe('which presets have a poster of the app’s own', () => {
  it('every seasonal, holiday-episode, New and recent, IMDb chart and streaming preset, from artwork that ships', () => {
    for (const p of PRESETS) {
      const d = p.definition;
      if (OWN.includes(p.family)) {
        expect(d.poster, d.slug).toEqual({ kind: 'bundled', key: d.slug });
        expect(LEGACY_POSTER.get(d.presetKey), d.slug).toMatch(/^https:\/\/raw\.githubusercontent\.com\/Kometa-Team\/Default-Images\//);
      } else {
        // Universes and show franchises keep Kometa's: they show those franchises' own worlds, which the app doesn't draw.
        expect(d.poster.kind, d.slug).toBe('url');
        expect(LEGACY_POSTER.has(d.presetKey)).toBe(false);
      }
    }
    const all = bundledPosters();
    expect(all).toHaveLength(73);
    expect(new Set(all.map((b) => b.key)).size).toBe(all.length);
    for (const b of all) expect(existsSync(join(ART_DIR, `${b.art}.webp`)), b.art).toBe(true);
    // No artwork ships that nothing uses.
    expect(readdirSync(ART_DIR).filter((f) => f.endsWith('.webp')).map((f) => f.replace('.webp', '')).sort()).toEqual([...new Set(all.map((b) => b.art))].sort());
  });

  it('sets titles from the collection’s name, with IMDb and the long seasonal names split over a small line', () => {
    expect(bundledPoster('seasonal-christmas')).toMatchObject({ art: 'seasonal-christmas', title: { main: 'Christmas', sub: 'Movies' } });
    expect(bundledPoster('episodes-halloween')).toMatchObject({ art: 'episodes-halloween', title: { main: 'Halloween', sub: 'Episodes' } });
    expect(bundledPoster('seasonal-aapi')!.title).toEqual({ kicker: 'Asian American & Pacific Islander', main: 'Heritage Month', sub: 'Movies' });
    expect(bundledPoster('chart-top-shows')).toMatchObject({ art: 'chart-top-250', title: { kicker: 'IMDb', main: 'Top 250', sub: 'Shows' } });
    expect(bundledPoster('basic-episodes')).toMatchObject({ art: 'basic-new-episodes', title: { main: 'New Episodes' } });
    expect(bundledPoster('basic-added-shows')).toMatchObject({ art: 'basic-recently-added', title: { main: 'Recently Added', sub: 'Shows' } });
    expect(bundledPoster('streaming-disney-shows')).toMatchObject({ art: 'streaming', title: { main: 'Disney+', sub: 'Shows' }, tint: expect.stringMatching(/^#[0-9A-F]{6}$/) });
    expect(bundledPoster('universe-mcu')).toBeNull();
    expect(bundledPoster('no-such-preset')).toBeNull();
  });

  it('names a poster by its preset and the set’s revision, so a new version reaches box sets', () => {
    expect(posterKey({ kind: 'bundled', key: 'seasonal-christmas' })).toBe(`bundled:seasonal-christmas@${BUNDLED_POSTERS_REV}`);
  });
});

describe('a poster of the app’s own', () => {
  it('is a 1000 × 1500 JPEG; a streaming one is tinted in the service’s colour, its lettering isn’t', async () => {
    const bytes = await bundledPosterBytes('streaming-netflix-shows');
    const meta = await sharp(bytes).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 1000, 1500]);
    const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => { const i = (y * info.width + x) * 3; return [data[i]!, data[i + 1]!, data[i + 2]!] as const; };
    // The picture: Netflix red.
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = 0; y < 700; y += 7) for (let x = 0; x < 1000; x += 7) { const [pr, pg, pb] = px(x, y); r += pr; g += pg; b += pb; n++; }
    expect(r / n).toBeGreaterThan(1.8 * (g / n));
    expect(r / n).toBeGreaterThan(1.8 * (b / n));
    // "SHOWS", in gold under the title: the tint didn't reach the lettering.
    let gold = 0;
    for (let y = 1300; y < 1420; y++) for (let x = 300; x < 700; x++) { const [pr, pg, pb] = px(x, y); if (pr > 200 && pg > 150 && pg < 215 && pb < 130) gold++; }
    expect(gold).toBeGreaterThan(200);
  });

  it('is read like any other poster, and an unknown one says so', async () => {
    const x = { fetch: (async () => new Response('', { status: 404 })) as FetchLike, postersDir: '/nonexistent' };
    const img = await readPoster({ kind: 'bundled', key: 'seasonal-christmas' }, x);
    expect(img!.type).toBe('image/jpeg');
    expect(sha256(img!.bytes)).toBe(sha256(await bundledPosterBytes('seasonal-christmas')));
    await expect(readPoster({ kind: 'bundled', key: 'universe-mcu' }, x)).rejects.toThrow(/no poster of the app’s own/);
    await expect(readPoster({ kind: 'bundled', key: '../../etc/passwd' }, x)).rejects.toThrow(/no poster of the app’s own/);
  });
});

describe('switching from Kometa’s posters, once', () => {
  const config = () => ({ ...readConfig({}), configDir: mkdtempSync(join(tmpdir(), 'mc-')), timezone: 'America/New_York', seeds: {} });
  const posterOf = (db: ReturnType<typeof openDb>, slug: string) => db.select().from(definition).where(eq(definition.slug, slug)).get()!.poster;
  const set = (db: ReturnType<typeof openDb>, slug: string, poster: Poster) => db.update(definition).set({ poster }).where(eq(definition.slug, slug)).run();

  it('gives a preset still on its Kometa poster the app’s own; your upload, address or “none” stay', () => {
    // An install from before: presets seeded with Kometa's posters, some changed by hand.
    const db = openDb(':memory:');
    seedPresets(db);
    for (const p of PRESETS) if (LEGACY_POSTER.has(p.definition.presetKey)) set(db, p.definition.slug, { kind: 'url', url: LEGACY_POSTER.get(p.definition.presetKey)! });
    set(db, 'seasonal-halloween', { kind: 'url', url: 'https://example.test/my-halloween.jpg' });
    set(db, 'seasonal-easter', { kind: 'file', file: '3-abc.jpg' });
    set(db, 'seasonal-valentine', { kind: 'none' });
    const mcuBefore = posterOf(db, 'universe-mcu');

    createContext(config(), { db, fetch: async () => new Response('[]'), jellyfinFetch: async () => new Response('[]') }); // starts the new version
    expect(posterOf(db, 'seasonal-christmas')).toEqual({ kind: 'bundled', key: 'seasonal-christmas' });
    expect(posterOf(db, 'streaming-netflix-movies')).toEqual({ kind: 'bundled', key: 'streaming-netflix-movies' });
    expect(posterOf(db, 'seasonal-halloween')).toEqual({ kind: 'url', url: 'https://example.test/my-halloween.jpg' });
    expect(posterOf(db, 'seasonal-easter')).toEqual({ kind: 'file', file: '3-abc.jpg' });
    expect(posterOf(db, 'seasonal-valentine')).toEqual({ kind: 'none' });
    expect(posterOf(db, 'universe-mcu')).toEqual(mcuBefore);
    expect(db.select().from(setting).where(eq(setting.key, 'bundledPostersSwitched')).get()!.value).toMatchObject({ changed: 73 - 3 });

    // Putting Kometa's poster back afterwards is your choice: later starts leave it.
    set(db, 'seasonal-christmas', { kind: 'url', url: LEGACY_POSTER.get('seasonal:christmas')! });
    expect(upgradePosters(db)).toBe(0);
    expect(posterOf(db, 'seasonal-christmas')).toEqual({ kind: 'url', url: LEGACY_POSTER.get('seasonal:christmas') });
  });

  it('a new install starts with the app’s own posters and has nothing to switch', () => {
    const db = openDb(':memory:');
    createContext(config(), { db, fetch: async () => new Response('[]'), jellyfinFetch: async () => new Response('[]') });
    expect(posterOf(db, 'seasonal-christmas')).toEqual({ kind: 'bundled', key: 'seasonal-christmas' });
    expect(db.select().from(setting).where(eq(setting.key, 'bundledPostersSwitched')).get()!.value).toMatchObject({ changed: 0 });
  });

  it('a box set wearing the old poster gets the new one on the next run, then is left alone', async () => {
    const fake = new FakeJellyfin();
    fake.add({ Id: 'm1', Name: 'Elf', Type: 'Movie', ParentId: 'lib-movies', ProductionYear: 2003, Tags: ['family-night'] });
    const old = new Uint8Array(await sharp({ create: { width: 300, height: 450, channels: 3, background: '#000' } }).jpeg().toBuffer());
    const net: FetchLike = async (url) => (url.includes('Default-Images') ? new Response(old, { headers: { 'content-type': 'image/jpeg' } }) : new Response('[]'));
    const app = createContext(config(), { db: openDb(':memory:'), fetch: net, jellyfinFetch: fake.fetch() });
    app.updateSettings({ connections: { jellyfinUrl: FAKE_URL, plexUrl: '', radarrUrl: '', sonarrUrl: '' }, firstRunDone: true, dryRun: false });
    app.secrets.set('jellyfin.apiKey', fake.apiKey);
    app.db.update(definition).set({ enabled: false }).run();
    const id = createCollection(app, { name: 'Family Night', target: 'movies', dates: null, sourceType: 'jellyfin_tags', sourceValue: 'family-night' });
    updateCollection(app, id, { enabled: true });
    await runPipeline(app, { job: 'manual', trigger: 'manual', index: true, now: NOW });
    await setPoster(app, id, { kind: 'url', url: LEGACY_POSTER.get('seasonal:christmas')! });
    const poster = () => fake.imageData.get(`${app.db.select().from(managedCollection).where(eq(managedCollection.definitionId, id)).get()!.jfBoxsetId!}/Primary`)?.bytes;
    expect(sha256(poster()!)).toBe(sha256(old));

    app.db.update(definition).set({ poster: { kind: 'bundled', key: 'seasonal-christmas' } }).where(eq(definition.id, id)).run();
    await runPipeline(app, { job: 'manual', trigger: 'manual', index: true, now: NOW + DAY });
    expect(sha256(poster()!)).toBe(sha256(await bundledPosterBytes('seasonal-christmas')));
    const again = await runPipeline(app, { job: 'manual', trigger: 'manual', index: true, now: NOW + 2 * DAY });
    expect(again.stats.boxSetsRepaired).toBe(0);
  });
});
