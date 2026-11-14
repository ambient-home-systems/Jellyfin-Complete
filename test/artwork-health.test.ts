// Artwork checks (ADR-043): no poster, a poster from the video or the file, a poster in another language, artwork from
// another title. Fixes take TMDb's images by a confirmed TMDb ID, never a name search, back up what they replace, and
// can be undone. The ambiguous titles from the artwork incident (Inside Out, 9-1-1, Twister, Night at the Museum,
// Home Alone, Narnia, TMNT) must always get their own artwork, never a lookalike's.
import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { and, eq } from 'drizzle-orm';
import { openDb } from '../src/db/index.js';
import { createContext } from '../src/app-context.js';
import { readConfig } from '../src/config.js';
import { runPipeline } from '../src/pipeline/run.js';
import { artworkCheck, artworkFix, definition, healthFinding, overlay } from '../src/db/schema.js';
import { originalsDir } from '../src/overlays/sync.js';
import { artworkSummary, distance, fingerprint, pathNames, resetArtwork, undoArtworkFix } from '../src/library/artwork.js';
import { audioVerdict, healthRows, openFindingCount } from '../src/library/health.js';
import { lang2, sameLanguage } from '../src/library/languages.js';
import { dashboardModel } from '../src/web/model.js';
import { Dashboard } from '../src/web/pages/dashboard.js';
import { createWeb } from '../src/web/app.js';
import { FakeJellyfin, FAKE_URL } from './fakes/jellyfin.js';
import type { FetchLike } from '../src/clients/http.js';
import { signIn, csrfOf, flash } from './helpers/web.js';

const NOW = Date.UTC(2026, 10, 20, 15);
const DAY = 86_400_000;

/** A picture with its own pattern (so its fingerprint is its own), at any size. */
async function picture(seed: number, w = 400, h = 600): Promise<Uint8Array> {
  const cols = 8, rows = 12;
  const raw = Buffer.alloc(cols * rows * 3);
  let x = (seed * 2654435761) >>> 0;
  for (let i = 0; i < raw.length; i++) { x = (Math.imul(x, 1103515245) + 12345) >>> 0; raw[i] = x >>> 24; }
  return new Uint8Array(await sharp(raw, { raw: { width: cols, height: rows, channels: 3 } }).resize(w, h, { kernel: 'nearest' }).jpeg({ quality: 92 }).toBuffer());
}

/** A copy of a picture with a few patches changed, so its fingerprint is between `lo` and `hi` bits from the original's. */
async function nearCopy(bytes: Uint8Array, lo: number, hi: number): Promise<Uint8Array> {
  const base = await fingerprint(bytes);
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  for (let k = 1; k < 40; k++) {
    const d = Buffer.from(data);
    for (let i = 0; i < k; i++) {
      const x0 = ((i * 37) % 8) * 50, y0 = ((i * 53) % 12) * 50; // a 50-pixel patch, in a fixed order
      for (let y = y0; y < y0 + 50; y++) for (let x = x0; x < x0 + 50; x++) { const p = (y * info.width + x) * info.channels; for (let c = 0; c < 3; c++) d[p + c] = 255 - d[p + c]!; }
    }
    const out = new Uint8Array(await sharp(d, { raw: { width: info.width, height: info.height, channels: info.channels } }).jpeg({ quality: 92 }).toBuffer());
    const n = distance(base.hash, (await fingerprint(out)).hash);
    if (n >= lo && n <= hi) return out;
  }
  throw new Error('no near copy in range');
}

type Title = { media: 'movie' | 'tv'; id: string; title: string; year: number; lang?: string; imdb?: string; tvdb?: string; posters: [string, string | null, number][]; backdrops?: [string, string | null, number][]; logos?: [string, string | null, number][] };
// TMDb, with a lookalike for each ambiguous title that a name search would find first.
const CATALOGUE: Title[] = [
  { media: 'movie', id: '953', title: 'Madagascar', year: 2005, imdb: 'tt0351283', posters: [['/mad-en.jpg', 'en', 7.0], ['/mad-fr.jpg', 'fr', 7.4], ['/mad-xx.jpg', null, 5.5]], backdrops: [['/mad-bd.jpg', null, 6], ['/mad-bd-en.jpg', 'en', 5]], logos: [['/mad-logo.png', 'en', 5]] },
  { media: 'movie', id: '9001', title: 'Clown of the Jungle', year: 1947, imdb: 'tt0039264', posters: [['/donald-en.jpg', 'en', 6.5], ['/donald-fr.jpg', 'fr', 6.0]] },
  { media: 'movie', id: '9002', title: 'Le Petit Prince', year: 1974, lang: 'fr', imdb: 'tt0071986', posters: [['/prince-fr.jpg', 'fr', 6.0], ['/prince-fr2.jpg', 'fr', 5.0]] },
  { media: 'movie', id: '150540', title: 'Inside Out', year: 2015, imdb: 'tt2096673', posters: [['/inside-en.jpg', 'en', 8.0]] },
  { media: 'movie', id: '999001', title: 'Inside Out', year: 1991, imdb: 'tt0101547', posters: [['/inside-lookalike.jpg', 'en', 4.0]] },
  { media: 'movie', id: '771', title: 'Home Alone', year: 1990, imdb: 'tt0099785', posters: [['/home-en.jpg', 'fr', 8.0], ['/home-en.jpg', 'en', 7.5]] },
  { media: 'movie', id: '1593', title: 'Night at the Museum', year: 2006, imdb: 'tt0477347', posters: [['/museum-en.jpg', 'en', 7.0]] },
  { media: 'movie', id: '411', title: 'The Chronicles of Narnia: The Lion, the Witch and the Wardrobe', year: 2005, imdb: 'tt0363771', posters: [['/narnia-en.jpg', 'en', 7.0]] },
  { media: 'movie', id: '1498', title: 'Teenage Mutant Ninja Turtles', year: 1990, imdb: 'tt0100758', posters: [['/tmnt-en.jpg', 'en', 7.0]] },
  { media: 'movie', id: '664', title: 'Twister', year: 1996, imdb: 'tt0117998', posters: [['/twister-en.jpg', 'en', 7.0]] },
  { media: 'tv', id: '75219', title: '9-1-1', year: 2018, imdb: 'tt7235466', tvdb: '339848', posters: [['/911-en.jpg', 'en', 7.0]] },
  // The same picture under two language tags (the false alarms from 0.17): Brave's French tag is a slightly different
  // upload of the English poster; Gru's English copy sits 12th in English, below a higher-rated French tag; Home Alone's
  // file is listed under both languages (above).
  { media: 'movie', id: '62177', title: 'Brave', year: 2012, imdb: 'tt1217209', posters: [['/brave-fr.jpg', 'fr', 8.0], ['/brave-en.jpg', 'en', 7.5]] },
  { media: 'movie', id: '438148', title: 'Minions: The Rise of Gru', year: 2022, imdb: 'tt5113044', posters: [['/gru-fr.jpg', 'fr', 9.0], ...Array.from({ length: 11 }, (_, i): [string, string, number] => [`/gru-en-${i + 1}.jpg`, 'en', 7.9 - i * 0.1]), ['/gru-en-12.jpg', 'en', 6.0]] },
];
const LOOKALIKES: Record<string, string> = { 'inside out': '999001', 'home alone': '999002', twister: '999003', '9-1-1': '999004' };

async function world(opts: { autoFix?: string[]; dryRun?: boolean } = {}) {
  const images = new Map<string, Uint8Array>();
  let seed = 1;
  for (const t of CATALOGUE) for (const [path] of [...t.posters, ...(t.backdrops ?? []), ...(t.logos ?? [])]) images.set(path, await picture(seed++));
  // Brave's English upload: the French picture, a little different (a fingerprint 11–16 bits away).
  images.set('/brave-en.jpg', await nearCopy(images.get('/brave-fr.jpg')!, 11, 16));
  images.set('/gru-en-12.jpg', images.get('/gru-fr.jpg')!);
  const calls: string[] = [];
  const net: FetchLike = async (url, init) => {
    if (url.startsWith(FAKE_URL)) return jf(url, init);
    const u = new URL(url);
    if (u.host === 'image.tmdb.org') {
      const b = images.get(`/${u.pathname.split('/').pop()}`);
      calls.push(`img ${u.pathname}`);
      return b ? new Response(Buffer.from(b), { headers: { 'content-type': u.pathname.endsWith('.png') ? 'image/png' : 'image/jpeg' } }) : new Response('nope', { status: 404 });
    }
    if (u.host !== 'api.themoviedb.org') return new Response('[]');
    calls.push(`tmdb ${u.pathname}`);
    const json = (o: unknown) => new Response(JSON.stringify(o));
    if (u.pathname.startsWith('/3/search/')) {
      const id = LOOKALIKES[(u.searchParams.get('query') ?? '').toLowerCase()];
      return json({ results: id ? [{ id: Number(id), title: 'A lookalike' }] : [] });
    }
    const find = u.pathname.match(/^\/3\/find\/(.+)$/);
    if (find) {
      const src = u.searchParams.get('external_source');
      const t = CATALOGUE.find((x) => (src === 'imdb_id' ? x.imdb : x.tvdb) === decodeURIComponent(find[1]!));
      return json({ movie_results: t?.media === 'movie' ? [{ id: Number(t.id) }] : [], tv_results: t?.media === 'tv' ? [{ id: Number(t.id) }] : [], tv_episode_results: [] });
    }
    const m = u.pathname.match(/^\/3\/(movie|tv)\/(\d+)(\/images)?$/);
    const t = m && CATALOGUE.find((x) => x.media === m[1] && x.id === m[2]);
    if (!m || !t) return new Response('{"status_code":34}', { status: 404 });
    const img = (xs: [string, string | null, number][] = [], w = 1000, h = 1500) => xs.map(([file_path, iso_639_1, vote_average]) => ({ file_path, iso_639_1, vote_average, vote_count: 10, width: w, height: h }));
    if (m[3]) return json({ posters: img(t.posters), backdrops: img(t.backdrops, 1920, 1080), logos: img(t.logos, 800, 300) });
    return json(t.media === 'movie'
      ? { id: Number(t.id), title: t.title, original_title: t.title, release_date: `${t.year}-06-01`, original_language: t.lang ?? 'en', imdb_id: t.imdb, runtime: 90 }
      : { id: Number(t.id), name: t.title, original_name: t.title, first_air_date: `${t.year}-01-03`, original_language: 'en', external_ids: { imdb_id: t.imdb, tvdb_id: Number(t.tvdb) } });
  };

  const fake = new FakeJellyfin();
  const jf = fake.fetch();
  fake.libraries[0] = { ...fake.libraries[0]!, LibraryOptions: { TypeOptions: [{ Type: 'Movie', ImageFetchers: ['TheMovieDb', 'Screen Grabber'] }] } } as never;
  fake.users[0]!.Configuration = { AudioLanguagePreference: 'eng', PlayDefaultAudioTrack: false };
  fake.users.push({ Id: 'kid-1', Name: 'Kid', Password: 'pw2', Policy: { IsAdministrator: false, BlockedTags: [] } });
  const film = (Id: string, Name: string, year: number, ids: Record<string, string>, extra: object = {}) =>
    fake.add({ Id, Name, Type: 'Movie', ParentId: 'lib-movies', ProductionYear: year, DateCreated: '2026-11-01T00:00:00Z', ProviderIds: ids, Path: `/movies/${Name} (${year})/${Name} (${year}).mkv`, ...extra } as never);
  film('m-mad', 'Madagascar', 2005, { Tmdb: '953', Imdb: 'tt0351283' });
  fake.setImage('m-mad', await picture(500, 640, 360)); // a frame of the video
  film('m-donald', 'Clown of the Jungle', 1947, { Tmdb: '9001', Imdb: 'tt0039264' });
  fake.setImage('m-donald', images.get('/donald-fr.jpg')!);
  film('m-prince', 'Le Petit Prince', 1974, { Tmdb: '9002', Imdb: 'tt0071986' });
  fake.setImage('m-prince', images.get('/prince-fr.jpg')!);
  // Jellyfin linked Inside Out to a lookalike; its IMDb ID and folder name say otherwise.
  film('m-inside', 'Inside Out', 2015, { Tmdb: '999001', Imdb: 'tt2096673', TmdbCollection: '1084247' });
  fake.setImage('m-inside', images.get('/inside-lookalike.jpg')!);
  film('m-home', 'Home Alone', 1990, { Tmdb: '771', Imdb: 'tt0099785' }); // no poster
  film('m-brave', 'Brave', 2012, { Tmdb: '62177', Imdb: 'tt1217209' });
  fake.setImage('m-brave', images.get('/brave-fr.jpg')!);
  film('m-gru', 'Minions - The Rise of Gru', 2022, { Tmdb: '438148', Imdb: 'tt5113044' });
  fake.setImage('m-gru', images.get('/gru-fr.jpg')!);
  for (const [id, name, year, tmdb, imdb, poster] of [
    ['m-museum', 'Night at the Museum', 2006, '1593', 'tt0477347', '/museum-en.jpg'],
    ['m-narnia', 'The Chronicles of Narnia - The Lion, the Witch and the Wardrobe', 2005, '411', 'tt0363771', '/narnia-en.jpg'],
    ['m-tmnt', 'Teenage Mutant Ninja Turtles', 1990, '1498', 'tt0100758', '/tmnt-en.jpg'],
    ['m-twister', 'Twister', 1996, '664', 'tt0117998', '/twister-en.jpg'],
  ] as const) {
    film(id, name, year, { Tmdb: tmdb, Imdb: imdb });
    fake.setImage(id, images.get(poster)!);
  }
  fake.add({ Id: 's-911', Name: '9-1-1', Type: 'Series', ParentId: 'lib-shows', ProductionYear: 2018, ProviderIds: { Tmdb: '75219', Tvdb: '339848' }, Path: '/tv/9-1-1 (2018)' } as never);
  fake.setImage('s-911', await picture(501, 640, 360));
  // A kids' film whose default track is a French dub, with English too.
  film('m-minions', 'Minions', 2015, {}, { MediaSources: [{ RunTimeTicks: 91 * 600_000_000, Path: '/movies/Minions (2015)/Minions (2015).mkv', MediaStreams: [{ Type: 'Video' }, { Type: 'Audio', Language: 'fre', IsDefault: true }, { Type: 'Audio', Language: 'eng' }] }] });
  fake.setImage('m-minions', await picture(502));
  // A box set the app doesn't manage, linked to a TMDb collection its film isn't in.
  fake.add({ Id: 'b-inside', Name: 'Inside Out Collection', Type: 'BoxSet', ParentId: 'lib-collections', ProviderIds: { Tmdb: '777777' }, children: ['m-inside'] } as never);

  const config = { ...readConfig({}), configDir: mkdtempSync(join(tmpdir(), 'mc-')), timezone: 'America/New_York', seeds: {} };
  const app = createContext(config, { db: openDb(':memory:'), fetch: net, jellyfinFetch: jf });
  app.updateSettings({ connections: { jellyfinUrl: FAKE_URL, plexUrl: '', radarrUrl: '', sonarrUrl: '' }, firstRunDone: true, dryRun: opts.dryRun ?? true, health: { enabled: true, autoFixLibraryIds: opts.autoFix ?? [] } });
  app.secrets.set('jellyfin.apiKey', fake.apiKey);
  app.secrets.set('tmdb.apiKey', 'k');
  app.db.update(definition).set({ enabled: false }).run();
  const poster = (id: string) => fake.imageData.get(`${id}/Primary`)?.bytes;
  return { app, fake, images, calls, poster };
}
const run = (app: Awaited<ReturnType<typeof world>>['app'], now = NOW) => runPipeline(app, { job: 'manual', trigger: 'manual', index: true, now });
const ART = new Set(['no_poster', 'video_poster', 'language', 'other_title']);
const artwork = (app: Awaited<ReturnType<typeof world>>['app']) => Object.fromEntries(app.db.select().from(healthFinding).all().filter((f) => ART.has(f.kind)).map((f) => [`${f.jfId} ${f.kind}`, f.proposal?.path ?? null]));
const same = (a?: Uint8Array, b?: Uint8Array) => Boolean(a && b && Buffer.from(a).equals(Buffer.from(b)));

describe('the pieces', () => {
  it('fingerprints a picture the same at any size, and a different picture differently', async () => {
    const a = await fingerprint(await picture(7, 1000, 1500));
    const small = await fingerprint(await picture(7, 92, 138));
    const other = await fingerprint(await picture(8, 1000, 1500));
    expect(distance(a.hash, small.hash)).toBeLessThanOrEqual(10);
    expect(distance(a.hash, other.hash)).toBeGreaterThan(10);
  });

  it('reads a title and year from a folder or file name, to tell Inside Out (2015) from Inside Out (1991)', () => {
    expect(pathNames('/movies/Inside Out (2015)/Inside Out (2015).mkv', { title: 'Inside Out', originalTitle: null, year: 2015 })).toBe(true);
    expect(pathNames('/movies/Inside Out (2015)/Inside Out (2015).mkv', { title: 'Inside Out', originalTitle: null, year: 1991 })).toBe(false);
    expect(pathNames('/tv/9-1-1 (2018)', { title: '9-1-1', originalTitle: null, year: 2018 })).toBe(true);
    expect(pathNames('/movies/Blade.Runner.2049.2017.2160p.mkv', { title: 'Blade Runner 2049', originalTitle: null, year: 2017 })).toBe(true);
    expect(pathNames('/movies/Inside Out (2015)/Inside Out (2015).mkv', { title: 'Inside Man', originalTitle: null, year: 2015 })).toBe(false);
  });

  it('knows "fre", "fra" and "fr" are French, and that "und" and "xx" are no language', () => {
    expect(sameLanguage('fre', 'fr')).toBe(true);
    expect(sameLanguage('fra', 'fre')).toBe(true);
    expect(sameLanguage('eng', 'en-US')).toBe(true);
    expect(lang2('und')).toBeNull();
    expect(lang2('xx')).toBeNull();
    expect(audioVerdict([{ lang: 'fre', isDefault: true }, { lang: 'eng', isDefault: false }], 'en')).toBe('It plays in French by default; it has an English track too.');
    expect(audioVerdict([{ lang: 'spa', isDefault: false }, { lang: 'eng', isDefault: false }], 'en')).toMatch(/^It plays in Spanish/); // no default flag: the first plays
    expect(audioVerdict([{ lang: 'eng', isDefault: true }, { lang: 'fre', isDefault: false }], 'en')).toBeNull();
    expect(audioVerdict([{ lang: 'fre', isDefault: true }, { lang: 'ger', isDefault: false }], 'en')).toBeNull(); // no English to play instead
  });
});

describe('Artwork checks', () => {
  it('finds a video still, a poster in another language, a missing poster and another title’s artwork, and nothing on the rest', async () => {
    const { app, calls } = await world();
    const r = await run(app);
    expect(r.stats).toMatchObject({ artworkChecked: 13, artworkBoxSetsChecked: 1 }); // 12 films and a show
    expect(artwork(app)).toEqual({
      'm-mad video_poster': '/mad-en.jpg', // TMDb's best English poster, though the French one is rated higher
      'm-donald language': '/donald-en.jpg',
      'm-inside other_title': '/inside-en.jpg', // from the confirmed ID (150540), not Jellyfin's lookalike
      'm-home no_poster': '/home-en.jpg',
      's-911 video_poster': '/911-en.jpg',
      'b-inside other_title': null, // a box set the app doesn't manage: reported, not fixed
    });
    const details = Object.fromEntries(healthRows(app).filter((x) => ART.has(x.kind)).map((x) => [x.jfId, x.detail]));
    expect(details['m-mad']).toBe('The poster is a wide picture (16:9), like a frame from the video.');
    expect(details['m-donald']).toBe('The poster is TMDb’s French one; TMDb has English posters too.');
    expect(details['m-inside']).toMatch(/^Jellyfin links it to TMDb 999001 \(“Inside Out”, 1991\), but its IMDb ID is TMDb 150540 \(“Inside Out”, 2015\)\. Its folder name says TMDb 150540/);
    expect(details['b-inside']).toMatch(/Linked to TMDb collection 777777, but its movies belong to TMDb collection 1084247/);
    expect(app.db.select().from(artworkCheck).where(eq(artworkCheck.jfId, 'm-inside')).get()).toMatchObject({ verifiedTmdb: '150540', verifiedBy: 'path' });
    expect(calls.filter((c) => c.includes('/search/'))).toEqual([]); // never a name search
  });

  it('doesn’t flag a poster tagged French on TMDb that is the same image as the English one (Brave, Home Alone, Gru)', async () => {
    const { app, fake, images } = await world();
    fake.setImage('m-home', images.get('/home-en.jpg')!); // the file TMDb lists as both French and English
    await run(app);
    for (const id of ['m-brave', 'm-gru', 'm-home']) expect(artwork(app)[`${id} language`], id).toBeUndefined();
    // Brave: noted for information, not counted.
    expect(app.db.select().from(artworkCheck).where(eq(artworkCheck.jfId, 'm-brave')).get()).toMatchObject({ note: 'The poster has a French tag on TMDb but is the same image as its English one.', poster: { lang: 'fr', sameAs: '/brave-en.jpg' } });
    expect(artworkSummary(app).sameImage).toEqual([{ jfId: 'm-brave', title: 'Brave (2012)', note: 'The poster has a French tag on TMDb but is the same image as its English one.' }]);
    // Gru: recognised as TMDb's English copy, further down the list.
    expect(app.db.select().from(artworkCheck).where(eq(artworkCheck.jfId, 'm-gru')).get()!.poster).toMatchObject({ lang: 'en', path: '/gru-en-12.jpg' });
    // A different French poster is still flagged (Clown of the Jungle).
    expect(artwork(app)['m-donald language']).toBe('/donald-en.jpg');
  });

  it('keeps a French poster when TMDb has no English one, says so, and doesn’t check again every night', async () => {
    const { app, calls } = await world();
    await run(app);
    expect(artwork(app)['m-prince language']).toBeUndefined();
    expect(app.db.select().from(artworkCheck).where(eq(artworkCheck.jfId, 'm-prince')).get()!.note).toBe('TMDb has no English poster for it, so its French one is kept.');
    const before = calls.length;
    await run(app, NOW + DAY);
    expect(calls.slice(before).filter((c) => c.includes('9002') || c.includes('prince'))).toEqual([]);
    // A month on, it's looked at again (TMDb may have an English poster by then).
    await run(app, NOW + 31 * DAY);
    expect(calls.slice(before).some((c) => c.includes('9002'))).toBe(false); // TMDb's answer is cached for 30 days…
    expect(app.db.select().from(artworkCheck).where(eq(artworkCheck.jfId, 'm-prince')).get()!.checkedAt).toBe(NOW + 31 * DAY); // …but it was checked
  });

  it('resets by the confirmed TMDb ID, never a lookalike’s, keeps the old artwork, and can put it back', async () => {
    const { app, fake, images, calls, poster } = await world();
    await run(app);
    const old = poster('m-inside');
    const r = await resetArtwork(app, 'm-inside', { by: 'admin' });
    expect(r).toMatchObject({ ok: true, message: 'Inside Out (2015): poster: TMDb’s English poster (1000×1500).' });
    expect(same(poster('m-inside'), images.get('/inside-en.jpg'))).toBe(true);
    expect(artwork(app)['m-inside other_title']).toBeUndefined();
    expect(app.db.select().from(artworkFix).all()).toMatchObject([{ jfId: 'm-inside', title: 'Inside Out (2015)', kind: 'other_title', by: 'admin', tmdb: '150540' }]);
    // Undo puts the old poster back, byte for byte.
    const fixId = r.fixId!;
    expect((await undoArtworkFix(app, fixId, 'admin')).ok).toBe(true);
    expect(same(poster('m-inside'), old)).toBe(true);
    expect((await undoArtworkFix(app, fixId, 'admin')).message).toMatch(/already put back/);
    // The ambiguous titles: each given a video still, each reset to its own poster.
    for (const id of ['m-museum', 'm-narnia', 'm-tmnt', 'm-twister']) fake.setImage(id, await picture(600 + id.length, 640, 360));
    await run(app, NOW + DAY);
    const want: Record<string, string> = { 'm-museum': '/museum-en.jpg', 'm-narnia': '/narnia-en.jpg', 'm-tmnt': '/tmnt-en.jpg', 'm-twister': '/twister-en.jpg', 'm-home': '/home-en.jpg', 's-911': '/911-en.jpg' };
    for (const [id, file] of Object.entries(want)) {
      expect((await resetArtwork(app, id, { by: 'admin' })).ok, id).toBe(true);
      expect(same(poster(id), images.get(file)), id).toBe(true);
    }
    expect(calls.filter((c) => c.includes('/search/'))).toEqual([]);
  });

  it('flags a screen grab and replaces it from TMDb by ID, with the backdrop and logo when asked', async () => {
    const { app, fake, images, poster } = await world();
    await run(app);
    const r = await resetArtwork(app, 'm-mad', { by: 'admin', types: ['Backdrop', 'Logo'] });
    expect(r.ok).toBe(true);
    expect(r.message).toBe('Madagascar (2005): poster: TMDb’s English poster (1000×1500); backdrop: TMDb’s textless image (1920×1080); logo: TMDb’s English image (800×300).');
    expect(same(poster('m-mad'), images.get('/mad-en.jpg'))).toBe(true);
    expect(fake.backdrops.get('m-mad')!.map((b) => same(b, images.get('/mad-bd.jpg')))).toEqual([true]);
    expect(same(fake.imageData.get('m-mad/Logo')?.bytes, images.get('/mad-logo.png'))).toBe(true);
    // The next run finds nothing more to say about it.
    await run(app, NOW + DAY);
    expect(Object.keys(artwork(app)).filter((k) => k.startsWith('m-mad'))).toEqual([]);
  });

  it('looks at the saved original of a poster carrying the app’s overlays, and backs that up, not the badged copy', async () => {
    const { app, fake, images, poster } = await world();
    // Clown of the Jungle carries overlays: Jellyfin has the badged copy; the original (TMDb's French poster) is saved.
    const badged = await picture(900);
    fake.setImage('m-donald', badged);
    mkdirSync(originalsDir(app), { recursive: true });
    writeFileSync(join(originalsDir(app), 'm-donald.jpg'), images.get('/donald-fr.jpg')!);
    const tag = (await app.jellyfin()!.getItem('m-donald'))!.ImageTags!.Primary!;
    app.db.insert(overlay).values({ jfId: 'm-donald', badges: ['ribbon:imdb_top_250'], file: 'm-donald.jpg', contentType: 'image/jpeg', originalTag: 'x', appliedTag: tag, appliedHash: 'h', updatedAt: NOW }).run();
    await run(app);
    expect(artwork(app)['m-donald language']).toBe('/donald-en.jpg'); // judged by the original, not the badges
    const r = await resetArtwork(app, 'm-donald', { by: 'admin' });
    expect(r.ok).toBe(true);
    expect(same(poster('m-donald'), images.get('/donald-en.jpg'))).toBe(true);
    await undoArtworkFix(app, r.fixId!, 'admin');
    expect(same(poster('m-donald'), images.get('/donald-fr.jpg'))).toBe(true); // the clean original, for the badges to go back on
    expect(same(poster('m-donald'), badged)).toBe(false);
  });

  it('stops, leaving the finding, if the poster changed since it was checked', async () => {
    const { app, fake, images, poster } = await world();
    await run(app);
    fake.setImage('m-donald', images.get('/donald-en.jpg')!); // someone picked another poster in Jellyfin
    const r = await resetArtwork(app, 'm-donald', { by: 'admin' });
    expect(r).toMatchObject({ ok: false });
    expect(r.message).toMatch(/changed in Jellyfin since it was checked/);
    expect(same(poster('m-donald'), images.get('/donald-en.jpg'))).toBe(true);
    expect(app.db.select().from(healthFinding).where(and(eq(healthFinding.jfId, 'm-donald'), eq(healthFinding.kind, 'language'))).get()).toBeTruthy();
  });

  it('never changes a box set it doesn’t manage, and won’t reset without a confirmed TMDb ID', async () => {
    const { app } = await world();
    await run(app);
    expect((await resetArtwork(app, 'b-inside', { by: 'admin' })).message).toMatch(/doesn’t change collections it doesn’t look after: take it over/);
    expect((await resetArtwork(app, 'm-minions', { by: 'admin' })).message).toMatch(/TMDb ID isn’t confirmed/);
  });

  it('fixes missing and video-frame posters by itself only in the libraries chosen, and only while dry run is off', async () => {
    const dry = await world({ autoFix: ['lib-movies'], dryRun: true });
    await run(dry.app);
    expect(dry.poster('m-home')).toBeUndefined();
    const live = await world({ autoFix: ['lib-movies'], dryRun: false });
    const r = await run(live.app);
    expect(r.stats.artworkAutoFixed).toBe(2); // Home Alone (no poster) and Madagascar (a frame); not 9-1-1 (Shows isn't chosen)
    expect(same(live.poster('m-home'), live.images.get('/home-en.jpg'))).toBe(true);
    expect(same(live.poster('m-mad'), live.images.get('/mad-en.jpg'))).toBe(true);
    expect(live.app.db.select().from(artworkFix).all().map((f) => f.by)).toEqual(['automatic', 'automatic']);
    expect(artwork(live.app)['s-911 video_poster']).toBe('/911-en.jpg');
    expect(artwork(live.app)['m-donald language']).toBe('/donald-en.jpg'); // a language finding always waits for you
  });
});

describe('Default audio and the Dashboard', () => {
  it('flags a French dub that plays by default; it’s only information once every user’s settings pick English', async () => {
    const { app, fake } = await world();
    await run(app);
    const row = () => healthRows(app).find((x) => x.jfId === 'm-minions' && x.kind === 'audio')!;
    expect(row()).toMatchObject({ detail: 'It plays in French by default; it has an English track too.', info: false });
    const m = dashboardModel(app, NOW);
    expect(m.audioPrefRisks).toEqual([{ user: 'Kid', why: 'no preferred audio language and “Play default audio track” on' }]);
    const before = openFindingCount(app);
    fake.users[1]!.Configuration = { AudioLanguagePreference: 'eng', PlayDefaultAudioTrack: false };
    await run(app, NOW + DAY);
    expect(row().info).toBe(true);
    expect(openFindingCount(app)).toBe(before - 1);
    expect(dashboardModel(app, NOW + DAY).audioPrefRisks).toEqual([]);
  });

  it('warns when a film or TV library takes posters from the video or the file', async () => {
    const { app } = await world();
    await run(app);
    const m = dashboardModel(app, NOW);
    expect(m.imageFetcherRisks).toEqual([{ library: 'Movies', fetchers: ['Screen Grabber'] }]);
    expect(String(Dashboard({ m, csrf: 'x' }))).toContain('Jellyfin can take posters from the video itself in Movies');
  });
});

describe('Library health page', () => {
  it('shows each poster beside TMDb’s, resets one or the ones ticked (never the whole library), and undoes', async () => {
    const { app, images, poster } = await world();
    await run(app);
    const web = createWeb(app);
    const { cookie } = await signIn(web);
    const csrf = await csrfOf(web, cookie, '/health');
    const page = await (await web.request('/health', { headers: { cookie } })).text();
    expect(page).toContain('src="/health/img/tmdb/mad-en.jpg"');
    expect(page).toMatch(/src="\/health\/img\/jf\/m-mad\?tag=[0-9a-f]+"/);
    expect(page).toContain('formaction="/health/artwork/reset" name="one" value="m-mad"');
    expect(page).toContain('Reset artwork for selected');
    expect(page).not.toMatch(/Reset all|whole library/i);
    expect(page).toContain('href="/adoption">Take it over'); // the collection Jellyfin made itself
    // The thumbnails come through the app.
    const thumb = await web.request('/health/img/tmdb/mad-en.jpg', { headers: { cookie } });
    expect(thumb.headers.get('content-type')).toBe('image/jpeg');
    expect((await web.request('/health/img/tmdb/..%2Fsecret.jpg', { headers: { cookie } })).status).toBe(404);
    const post = (body: [string, string][]) => web.request('/health/artwork/reset', { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams([['_csrf', csrf], ...body]).toString() });
    expect(flash(await post([['what', 'selected']]))).toContain('Tick the findings');
    // Two ticked: only those two change.
    const res = await post([['what', 'selected'], ['sel', 'm-mad|video_poster'], ['sel', 'm-home|no_poster']]);
    expect(flash(res)).toBe('2 reset from TMDb.');
    expect(same(poster('m-mad'), images.get('/mad-en.jpg'))).toBe(true);
    expect(same(poster('m-home'), images.get('/home-en.jpg'))).toBe(true);
    expect(same(poster('m-donald'), images.get('/donald-fr.jpg'))).toBe(true); // not ticked
    const after = await (await web.request('/health', { headers: { cookie } })).text();
    expect(after).toContain('Artwork fixed');
    const fix = app.db.select().from(artworkFix).all().find((f) => f.jfId === 'm-mad')!;
    expect(after).toContain(`/health/img/backup/${fix.id}`);
    const undo = await web.request(`/health/artwork/undo/${fix.id}`, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf }).toString() });
    expect(flash(undo)).toContain('the old artwork is back');
  });
});
