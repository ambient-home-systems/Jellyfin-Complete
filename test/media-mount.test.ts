// The optional read-only media mount and frames from the middle (ADR-044).
import { describe, it, expect } from 'vitest';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { openDb } from '../src/db/index.js';
import { createContext } from '../src/app-context.js';
import { readConfig } from '../src/config.js';
import { runPipeline } from '../src/pipeline/run.js';
import { definition, healthFinding, mediaCheck } from '../src/db/schema.js';
import { detectMapping, ffmpegPath, mapPath, mediaStatus, middleFrame } from '../src/library/media.js';
import { healthDashboard, healthRows } from '../src/library/health.js';
import { artworkSummary } from '../src/library/artwork.js';
import { HealthPage } from '../src/web/pages/health.js';
import { applySettings } from '../src/web/settings-actions.js';
import { FakeJellyfin, FAKE_URL } from './fakes/jellyfin.js';

const NOW = Date.UTC(2026, 10, 20, 15);
const DAY = 86_400_000;

// A Matroska file whose own title is `title` (EBML header, Segment, Info → Title).
const ebml = (id: number[], ...d: Buffer[]) => { const b = Buffer.concat(d); return Buffer.concat([Buffer.from(id), Buffer.from([0x40 | (b.length >> 8), b.length & 0xff]), b]); };
const mkv = (title: string) => Buffer.concat([ebml([0x1a, 0x45, 0xdf, 0xa3], ebml([0x42, 0x82], Buffer.from('matroska'))), Buffer.from([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]), ebml([0x15, 0x49, 0xa9, 0x66], ebml([0x7b, 0xa9], Buffer.from(title))), Buffer.alloc(64)]);

function mount() {
  const dir = mkdtempSync(join(tmpdir(), 'mc-media-'));
  const put = (rel: string, bytes: Buffer) => { mkdirSync(join(dir, rel, '..'), { recursive: true }); writeFileSync(join(dir, rel), bytes); };
  return { dir, put };
}

describe('where Jellyfin’s files are under the mount', () => {
  it('finds the mapping from a few known files, whatever the folders are called', () => {
    const { dir, put } = mount();
    put('movies/Heat (1995)/Heat.mkv', mkv('Heat'));
    put('movies/Up (2009)/Up.mkv', mkv('Up'));
    expect(detectMapping(dir, ['/data/media/movies/Heat (1995)/Heat.mkv', '/data/media/movies/Up (2009)/Up.mkv', '/data/media/movies/Gone (2001)/Gone.mkv'])).toEqual({ from: '/data/media', to: dir });
    expect(detectMapping(dir, ['D:\\Media\\movies\\Heat (1995)\\Heat.mkv'])).toEqual({ from: 'D:/Media', to: dir });
    expect(detectMapping(dir, ['/elsewhere/Nope.mkv'])).toBeNull();
  });

  it('maps a path under the mount, and never outside it', () => {
    const map = { from: '/data', to: '/media' };
    expect(mapPath('/data/movies/Heat.mkv', '/media', map)).toBe('/media/movies/Heat.mkv');
    expect(mapPath('/data/../../etc/passwd', '/media', map)).toBeNull();
    expect(mapPath('/database/x.mkv', '/media', map)).toBeNull(); // not under /data
    expect(mapPath('/data/x.mkv', '/media', null)).toBeNull();
  });

  it('finds an ffmpeg the app may run: FFMPEG_PATH, else on the PATH', () => {
    const d = mkdtempSync(join(tmpdir(), 'mc-bin-'));
    writeFileSync(join(d, 'ffmpeg'), '#!/bin/sh\n');
    expect(ffmpegPath({ PATH: d })).toBeNull(); // not executable
    chmodSync(join(d, 'ffmpeg'), 0o755);
    expect(ffmpegPath({ PATH: `/nonexistent:${d}` })).toBe(join(d, 'ffmpeg'));
    expect(ffmpegPath({ FFMPEG_PATH: join(d, 'ffmpeg'), PATH: '' })).toBe(join(d, 'ffmpeg'));
    expect(ffmpegPath({ FFMPEG_PATH: '/nope/ffmpeg', PATH: d })).toBeNull(); // a wrong FFMPEG_PATH isn't second-guessed
  });
});

function world(opts: { media?: boolean } = {}) {
  const m = mount();
  const fake = new FakeJellyfin();
  const film = (Id: string, Name: string, year: number, path: string, extra: object = {}) => fake.add({ Id, Name, Type: 'Movie', ParentId: 'lib-movies', ProductionYear: year, DateCreated: '2026-11-01T00:00:00Z', ProviderIds: {},
    MediaSources: [{ Id: `src-${Id}`, RunTimeTicks: 90 * 600_000_000, Path: path, MediaStreams: [{ Type: 'Video' }, { Type: 'Audio', Title: 'English' }] }], ...extra } as never);
  // Wakanda Forever's streams say nothing; only the file's own title gives Bewitched away.
  film('m-wakanda', 'Black Panther: Wakanda Forever', 2022, '/data/movies/Black Panther Wakanda Forever (2022)/Wakanda.mkv');
  m.put('movies/Black Panther Wakanda Forever (2022)/Wakanda.mkv', mkv('Bewitched (2005) 2160p'));
  film('m-heat', 'Heat', 1995, '/data/movies/Heat (1995)/Heat.mkv');
  m.put('movies/Heat (1995)/Heat.mkv', mkv('Heat (1995)'));
  film('m-gone', 'Gone Missing', 2001, '/data/movies/Gone Missing (2001)/Gone.mkv'); // not under the mount
  const config = { ...readConfig({}), configDir: mkdtempSync(join(tmpdir(), 'mc-')), timezone: 'America/New_York', seeds: {} };
  const app = createContext(config, { db: openDb(':memory:'), fetch: async () => new Response('[]'), jellyfinFetch: fake.fetch() });
  app.updateSettings({ connections: { jellyfinUrl: FAKE_URL, plexUrl: '', radarrUrl: '', sonarrUrl: '' }, firstRunDone: true, media: { enabled: opts.media ?? true, dir: m.dir, map: null } });
  app.secrets.set('jellyfin.apiKey', fake.apiKey);
  app.db.update(definition).set({ enabled: false }).run();
  return { app, fake, m };
}
const run = (app: ReturnType<typeof world>['app'], now = NOW) => runPipeline(app, { job: 'manual', trigger: 'manual', index: true, now });
const titleFindings = (app: ReturnType<typeof world>['app']) => Object.fromEntries(app.db.select().from(healthFinding).all().filter((f) => f.kind === 'title').map((f) => [f.jfId, f.detail]));

describe('a file’s own title, from the mount', () => {
  it('reads each new file’s own title once, and flags one naming another film', async () => {
    const { app, m } = world();
    await run(app);
    expect(app.settings().media.map).toEqual({ from: '/data', to: m.dir });
    expect(titleFindings(app)).toEqual({ 'm-wakanda': 'The file’s own title names “Bewitched (2005)”: “Bewitched (2005) 2160p”.' });
    expect(app.db.select().from(mediaCheck).where(eq(mediaCheck.jfId, 'm-heat')).get()).toMatchObject({ containerTitle: 'Heat (1995)', containerRead: 1 });
    expect(app.db.select().from(mediaCheck).where(eq(mediaCheck.jfId, 'm-gone')).get()).toMatchObject({ containerRead: 2 });
    expect(mediaStatus(app)).toMatchObject({ enabled: true, mounted: true, read: 2, unreadable: 1, note: '1 file couldn’t be read from ' + m.dir + ' (not there, or not readable by the app’s user).' });
    // Not read again while the file is the same; read again when it changes.
    m.put('movies/Heat (1995)/Heat.mkv', mkv('Something Else (1999)'));
    await run(app, NOW + DAY);
    expect(titleFindings(app)['m-heat']).toBeUndefined();
  });

  it('drops a finding when its file is gone from the mount, even while Jellyfin still lists it', async () => {
    const { app, m } = world();
    await run(app);
    expect(titleFindings(app)['m-wakanda']).toBeDefined();
    rmSync(join(m.dir, 'movies/Black Panther Wakanda Forever (2022)/Wakanda.mkv'));
    await runPipeline(app, { job: 'window-check', trigger: 'schedule', index: false, now: NOW + DAY });
    expect(titleFindings(app)['m-wakanda']).toBeUndefined();
  });

  it('reads nothing while it’s off (the default)', async () => {
    const { app } = world({ media: false });
    await run(app);
    expect(app.db.select().from(mediaCheck).all().every((c) => c.containerRead === 0)).toBe(true);
    expect(titleFindings(app)).toEqual({});
  });

  it('says so when none of Jellyfin’s files are under the mount', async () => {
    const { app } = world();
    const empty = mkdtempSync(join(tmpdir(), 'mc-empty-'));
    app.updateSettings({ media: { enabled: true, dir: empty, map: null } });
    await run(app);
    expect(mediaStatus(app).note).toMatch(/^None of Jellyfin’s files were found under/);
  });

  it('checks the folder setting: absolute, not / or /config, and a new folder means finding the files again', () => {
    const { app } = world();
    expect(() => applySettings(app, { mediaDir: '/' })).toThrow(/can’t be \//);
    expect(() => applySettings(app, { mediaDir: '/config' })).toThrow();
    expect(() => applySettings(app, { mediaDir: 'media' })).toThrow(/absolute path/);
    expect(() => applySettings(app, { mediaDir: '/media/../etc' })).toThrow(/absolute path/);
    app.updateSettings({ media: { enabled: true, dir: '/media', map: { from: '/data', to: '/media' } } });
    applySettings(app, { mediaDir: '/mnt/media' });
    expect(app.settings().media).toEqual({ enabled: true, dir: '/mnt/media', map: null });
  });
});

describe('a frame from the middle', () => {
  it('crops it from Jellyfin’s trickplay previews, and shows it (hidden until opened) on a finding', async () => {
    const { app, fake } = world();
    // 3×3 tiles of 320×180, one every 10 minutes; the film runs 90 minutes, so its middle (45) is thumbnail 4: the centre one.
    const item = fake.items.get('m-wakanda')!;
    (item as never as { Trickplay: unknown }).Trickplay = { 'src-m-wakanda': { 320: { Width: 320, Height: 180, TileWidth: 3, TileHeight: 3, ThumbnailCount: 9, Interval: 600_000 } } };
    const cells = [];
    for (let i = 0; i < 9; i++) cells.push({ input: { create: { width: 320, height: 180, channels: 3 as const, background: i === 4 ? '#e00000' : '#202020' } }, left: (i % 3) * 320, top: Math.floor(i / 3) * 180 });
    fake.trickplayTiles.set('m-wakanda/320/0', new Uint8Array(await sharp({ create: { width: 960, height: 540, channels: 3, background: '#000' } }).composite(cells).jpeg().toBuffer()));
    await run(app);
    const frame = await middleFrame(app, 'm-wakanda');
    expect(frame?.type).toBe('image/jpeg');
    const { data, info } = await sharp(frame!.bytes).raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([320, 180]);
    const mid = ((90 * 320) + 160) * info.channels;
    expect(data[mid]!).toBeGreaterThan(180); // the red centre thumbnail
    expect(data[mid + 1]!).toBeLessThan(60);
    const row = healthRows(app).find((r) => r.jfId === 'm-wakanda' && r.kind === 'title')!;
    expect(row.frame).toBe(true);
    const page = String(HealthPage({ m: healthDashboard(app), a: artworkSummary(app), tz: 'America/New_York', csrf: 'x' }));
    expect(page).toMatch(/<details class="frame"><summary>Show a frame from the middle<\/summary><img src="\/health\/img\/frame\/m-wakanda"[^>]*loading="lazy"/);
    // Heat has no previews, and its file isn't a real video: no frame.
    expect(await middleFrame(app, 'm-heat')).toBeNull();
  });

  it.skipIf(!ffmpegPath())('takes it with ffmpeg from the mounted file when Jellyfin has no previews', async () => {
    const { app, fake, m } = world();
    const { execFileSync } = await import('node:child_process');
    mkdirSync(join(m.dir, 'movies/Red (2010)'), { recursive: true });
    execFileSync(ffmpegPath()!, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:d=4:r=10', '-c:v', 'mpeg4', '-y', join(m.dir, 'movies/Red (2010)/Red.mkv')]);
    fake.add({ Id: 'm-red', Name: 'Red', Type: 'Movie', ParentId: 'lib-movies', ProductionYear: 2010, DateCreated: '2026-11-01T00:00:00Z', MediaSources: [{ Id: 'src-red', RunTimeTicks: 4 * 10_000_000, Path: '/data/movies/Red (2010)/Red.mkv', MediaStreams: [{ Type: 'Video' }] }] } as never);
    await run(app);
    const frame = await middleFrame(app, 'm-red');
    const { data, info } = await sharp(frame!.bytes).raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(480);
    expect(data[0]!).toBeGreaterThan(180);
    expect(data[1]!).toBeLessThan(80);
  });
});
