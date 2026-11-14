// Library health (ADR-041): files that may not be what they say. The four from the 13 Nov 2026 audit must be found:
// a kids' TMNT episode holding an adult drama, "Wakanda Forever" holding Bewitched, "The Spy Who Loved Me" holding
// The Lucky One, and "The Search for General Tso" holding a Trans-Siberian Orchestra concert. Lookalikes must not be.
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { openDb } from '../src/db/index.js';
import { createContext } from '../src/app-context.js';
import { readConfig } from '../src/config.js';
import { runPipeline } from '../src/pipeline/run.js';
import { definition, healthFinding, mediaCheck } from '../src/db/schema.js';
import { claimedTitle, dismissFinding, healthRows, HEALTH_LIMITS, lengthVerdicts, runtimeVerdict, titleVerdict } from '../src/library/health.js';
import { dashboardModel } from '../src/web/model.js';
import { Dashboard } from '../src/web/pages/dashboard.js';
import { FakeJellyfin, FAKE_URL } from './fakes/jellyfin.js';
import type { FetchLike } from '../src/clients/http.js';
import { setup, signIn, csrfOf, form, flash } from './helpers/web.js';

const NOW = Date.UTC(2026, 10, 20, 15);
const portrait = () => sharp({ create: { width: 200, height: 300, channels: 3, background: { r: 90, g: 60, b: 30 } } }).jpeg().toBuffer().then((b) => new Uint8Array(b));
const DAY = 86_400_000;
const TICKS_PER_MIN = 600_000_000;

describe('the rules', () => {
  it('flags a length more than 12 minutes or 15% off TMDb’s, whichever is larger', () => {
    expect(runtimeVerdict(102, 161)).toBe('The file runs 1 h 42 min; TMDb says 2 h 41 min.');
    expect(runtimeVerdict(95, 22)).toBe('The file runs 1 h 35 min; TMDb says 22 min.');
    expect(runtimeVerdict(135, 120)).toBeNull(); // 15 min over on a 2-hour film: within 18 (15%)
    expect(runtimeVerdict(32, 22)).toBeNull(); // 10 min over on an episode: within 12
    expect(runtimeVerdict(35, 22)).toMatch(/35 min; TMDb says 22 min/);
  });

  it('reads a title and year from release-style tags, and ignores tags that aren’t titles', () => {
    expect(claimedTitle('Bewitched (2005) 2160p')).toEqual({ title: 'Bewitched', year: 2005 });
    expect(claimedTitle('The.Lucky.One.2012.1080p.BluRay.x264')).toEqual({ title: 'The Lucky One', year: 2012 });
    expect(claimedTitle('2001.A.Space.Odyssey.1968.REMASTERED.1080p')).toEqual({ title: '2001 A Space Odyssey', year: 1968 });
    expect(claimedTitle('Blade.Runner.2049.2017.2160p')).toEqual({ title: 'Blade Runner 2049', year: 2017 });
    expect(claimedTitle('English (SDH)')).toBeNull();
    expect(claimedTitle('Commentary with the director (2019)')).toBeNull();
    expect(claimedTitle('Surround 5.1')).toBeNull();
    // Encoding notes aren't titles, and their numbers aren't years.
    for (const note of ['x265 10bit CRF 20 - 1920x1080 - 2020 kbps', 'HDR10 BT.2020 PQ', 'BT2020 HLG 2019', 'Main video 23.976 fps 2018', 'Video 8.5 Mb/s 2021', 'REMUX 2019', 'COMPRESSED 2021',
      'Encoded with HandBrake 1.6.1 2023', 'DTS-HD MA 5.1 2018', 'DTS 2016']) expect(claimedTitle(note), note).toBeNull();
    expect(claimedTitle('Stereo 2000 kbps')).toBeNull();
    // The eight false alarms from 0.17.0, as they were tagged.
    for (const note of [
      '1080p COMPRESSED (from 23.2Mb/s VC-1 BluRay REMUX - 2009 Warner Bros. Home Entertainment)', // the Christmas specials, She's the Man
      'DTS-HD MA 5.1 / 1968 kbps / original', // Dennis the Menace
      'x265 / 12098 kbps / 1080p / Main 10 / 4:2:0 / BT.2020', // Wonder
      'HEVC Main 10 2019', 'TrueHD Atmos 7.1 2017', 'x264 2012', 'REMUX - 2009 release', '8 bits 2015',
    ]) expect(claimedTitle(note), note).toBeNull();
    // A release name with the title first is still read, whatever follows the year.
    expect(claimedTitle('Bewitched.2005.2160p.REMUX.HEVC.DTS-HD.MA.5.1')).toEqual({ title: 'Bewitched', year: 2005 });
    // Release names are still read, x264 included.
    expect(claimedTitle('The.Lucky.One.2012.1080p.BluRay.x264')).toEqual({ title: 'The Lucky One', year: 2012 });
  });

  it('flags a tag naming another title, unless it’s the same title or the same year (a translated title)', () => {
    expect(titleVerdict(['Bewitched (2005) 2160p'], { names: ['Black Panther: Wakanda Forever'], year: 2022 })).toMatch(/names “Bewitched \(2005\)”/);
    expect(titleVerdict(['The.Lucky.One.2012.1080p.BluRay.x264'], { names: ['The Spy Who Loved Me'], year: 1977 })).toMatch(/“The Lucky One \(2012\)”/);
    expect(titleVerdict(['Blade.Runner.2049.2017.2160p'], { names: ['Blade Runner 2049'], year: 2017 })).toBeNull();
    expect(titleVerdict(["Le Fabuleux Destin d'Amélie Poulain (2001)"], { names: ['Amélie'], year: 2001 })).toBeNull();
    expect(titleVerdict(['Das Boot (1981)'], { names: ['The Boat'], year: 1981 })).toBeNull(); // same year: likely a translation
    expect(titleVerdict(['English', 'Stereo', 'Commentary (2019)'], { names: ['Heat'], year: 1995 })).toBeNull();
    // Episodes are checked against the show's name too.
    expect(titleVerdict(['Teenage.Mutant.Ninja.Turtles.1987.S02E01'], { names: ['Return of the Shredder', 'Teenage Mutant Ninja Turtles'], year: null })).toBeNull();
  });
});

describe('episode lengths: the season’s median when TMDb lists the TV slot', () => {
  // One season: episode files and TMDb runtimes in minutes, by episode number.
  const season = (show: string, s: number, files: Record<number, number>, tmdb: number | Record<number, number> | null, ends: Record<number, number> = {}) => {
    const rows = Object.keys(files).map((n) => ({ jfId: `${show}-${s}-${n}`, kind: 'episode', seriesJfId: show, season: s, episode: Number(n), episodeEnd: ends[Number(n)] ?? null }));
    const durations = new Map(rows.map((r) => [r.jfId, files[r.episode]!]));
    const tm = new Map<string, number>();
    if (tmdb !== null) for (const r of rows) tm.set(r.jfId, typeof tmdb === 'number' ? tmdb : tmdb[r.episode]!);
    return { rows, durations, tm };
  };
  const flagged = (x: ReturnType<typeof season>) => Object.fromEntries([...lengthVerdicts(x.rows, x.durations, x.tm)].filter(([, v]) => v).map(([k, v]) => [k, v]));
  const eight = (len: number, odd: Record<number, number> = {}) => Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((n) => [n, odd[n] ?? len]));

  it('doesn’t flag a whole season TMDb lists at the slot length (Dirty Jobs 42 vs 60, Scorpion 41 vs 59)', () => {
    expect(flagged(season('dirty-jobs', 1, eight(42), 60))).toEqual({});
    expect(flagged(season('scorpion', 2, eight(41), 59))).toEqual({});
  });

  it('still catches an episode with the ads left in (9-1-1 S3E3: 57 against 43), whether TMDb is right or lists 60', () => {
    expect(flagged(season('911', 3, eight(43, { 3: 57 }), 60))).toEqual({ '911-3-3': 'The file runs 57 min; this season’s episodes typically run 43 min.' });
    expect(flagged(season('911', 3, eight(43, { 3: 57 }), 43))).toEqual({ '911-3-3': 'The file runs 57 min; TMDb says 43 min.' });
  });

  it('catches two episodes in one file (Last Man Standing S7E13: 43 against 21), and says whether the next has its own file', () => {
    expect(flagged(season('lms', 7, { 11: 21, 12: 21, 13: 43, 14: 21, 15: 21 }, 30))).toEqual({
      'lms-7-13': 'The file runs 43 min; this season’s episodes typically run 21 min. It may contain two episodes; E14 also has its own file, so the second half may be something else.',
    });
    expect(flagged(season('lms', 7, { 11: 21, 12: 21, 13: 43, 15: 21 }, 30))['lms-7-13']).toMatch(/It may contain two episodes \(E14 has no file of its own\)\.$/);
    // A file Jellyfin knows holds E13–E14 is expected to be twice as long.
    expect(flagged(season('lms', 7, { 11: 21, 12: 21, 13: 43, 15: 21 }, 30, { 13: 14 }))).toEqual({});
  });

  it('catches a combined crossover (FBI S2E18: 84 minutes)', () => {
    expect(flagged(season('fbi', 2, eight(43, { 8: 84 }), 60))['fbi-2-8']).toMatch(/^The file runs 1 h 24 min; this season’s episodes typically run 43 min\./);
  });

  it('uses the median when TMDb has no runtimes, and the show’s median for a season with too few files', () => {
    expect(flagged(season('nordic', 1, eight(52, { 5: 95 }), null))['nordic-1-5']).toMatch(/typically run 52 min/);
    const a = season('mini', 1, eight(42), 60);
    const b = season('mini', 2, { 1: 42, 2: 70 }, 60);
    const both = { rows: [...a.rows, ...b.rows], durations: new Map([...a.durations, ...b.durations]), tm: new Map([...a.tm, ...b.tm]) };
    expect(flagged(both)).toEqual({ 'mini-2-2': 'The file runs 1 h 10 min; this show’s episodes typically run 42 min.' });
  });
});

type File = { minutes: number; tags?: string[] };
function world(opts: { health?: boolean } = {}) {
  const fake = new FakeJellyfin();
  const film = (Id: string, Name: string, year: number, tmdb: string, file: File, added = '2026-11-01T00:00:00Z') => fake.add({
    Id, Name, Type: 'Movie', ParentId: 'lib-movies', ProductionYear: year, DateCreated: added, ProviderIds: { Tmdb: tmdb }, OfficialRating: 'PG-13',
    MediaSources: [{ RunTimeTicks: file.minutes * TICKS_PER_MIN, Path: `/movies/${Name}.mkv`, MediaStreams: [{ Type: 'Video', Title: file.tags?.[0] }, { Type: 'Audio', Title: 'English' }, ...(file.tags ?? []).slice(1).map((Title) => ({ Type: 'Audio', Title }))] }],
  } as never);
  // The four from the audit.
  film('m-wakanda', 'Black Panther: Wakanda Forever', 2022, '505642', { minutes: 102, tags: ['Bewitched (2005) 2160p'] });
  film('m-spy', 'The Spy Who Loved Me', 1977, '691', { minutes: 101, tags: ['The.Lucky.One.2012.1080p.BluRay.x264'] });
  film('m-tso', 'The Search for General Tso', 2014, '293767', { minutes: 46, tags: ['Trans-Siberian Orchestra - The Ghosts of Christmas Eve (1999)'] });
  fake.add({ Id: 's-tmnt', Name: 'Teenage Mutant Ninja Turtles', Type: 'Series', ParentId: 'lib-shows', ProductionYear: 1987, ProviderIds: { Tmdb: '1992' }, OfficialRating: 'TV-Y7' } as never);
  fake.add({ Id: 'e-shredder', Name: 'Return of the Shredder', Type: 'Episode', SeriesId: 's-tmnt', ParentIndexNumber: 2, IndexNumber: 1, DateCreated: '2026-11-01T00:00:00Z', MediaSources: [{ RunTimeTicks: 95 * TICKS_PER_MIN, Path: '/kids/TMNT/S02E01.mkv', MediaStreams: [{ Type: 'Video' }] }] } as never);
  fake.add({ Id: 'e-fine', Name: 'The Fifth Turtle', Type: 'Episode', SeriesId: 's-tmnt', ParentIndexNumber: 2, IndexNumber: 2, DateCreated: '2026-11-01T00:00:00Z', MediaSources: [{ RunTimeTicks: 21.5 * TICKS_PER_MIN, Path: '/kids/TMNT/S02E02.mkv', MediaStreams: [{ Type: 'Video', Title: 'Teenage.Mutant.Ninja.Turtles.1987.S02E02' }] }] } as never);
  // Lookalikes that are fine.
  film('m-br', 'Blade Runner 2049', 2017, '335984', { minutes: 164, tags: ['Blade.Runner.2049.2017.2160p'] });
  film('m-amelie', 'Amélie', 2001, '194', { minutes: 122, tags: ["Le Fabuleux Destin d'Amélie Poulain (2001)"] });
  film('m-cut', 'A Longer Cut', 2010, '1000', { minutes: 135, tags: ['Commentary with the director (2019)'] });

  const RUNTIME: Record<string, number> = { '505642': 162, '691': 125, '293767': 71, '335984': 164, '194': 122, '1000': 120 };
  const calls: string[] = [];
  const net: FetchLike = async (url) => {
    const movie = url.match(/api\.themoviedb\.org\/3\/movie\/(\d+)\?/);
    if (movie) { calls.push(`movie ${movie[1]}`); return new Response(JSON.stringify({ id: Number(movie[1]), runtime: RUNTIME[movie[1]!] ?? 0 })); }
    const season = url.match(/api\.themoviedb\.org\/3\/tv\/(\d+)\/season\/(\d+)\?/);
    if (season) { calls.push(`season ${season[1]}/${season[2]}`); return new Response(JSON.stringify({ episodes: [{ episode_number: 1, runtime: 22 }, { episode_number: 2, runtime: 22 }] })); }
    return new Response('[]');
  };
  const config = { ...readConfig({}), configDir: mkdtempSync(join(tmpdir(), 'mc-')), timezone: 'America/New_York', seeds: {} };
  const app = createContext(config, { db: openDb(':memory:'), fetch: net, jellyfinFetch: fake.fetch() });
  app.updateSettings({ connections: { jellyfinUrl: FAKE_URL, plexUrl: '', radarrUrl: '', sonarrUrl: '' }, firstRunDone: true, ...(opts.health === false ? { health: { enabled: false } } : {}) });
  app.secrets.set('jellyfin.apiKey', fake.apiKey);
  app.secrets.set('tmdb.apiKey', 'k');
  app.db.update(definition).set({ enabled: false }).run();
  return { fake, app, calls };
}
const run = (app: ReturnType<typeof world>['app'], now = NOW) => runPipeline(app, { job: 'manual', trigger: 'manual', index: true, now });
// The file findings (ADR-041); artwork findings have their own tests (artwork-health.test.ts).
const fileKinds = (k: string) => k === 'runtime' || k === 'title' || k === 'audio';
const findings = (app: ReturnType<typeof world>['app']) => Object.fromEntries(app.db.select().from(healthFinding).all().filter((f) => fileKinds(f.kind)).map((f) => [`${f.jfId} ${f.kind}`, f.detail]));

describe('Library health', () => {
  it('finds the four files from the audit, and none of the lookalikes', async () => {
    const { app } = world();
    const r = await run(app);
    expect(r.stats).toMatchObject({ healthFound: 7, healthOpen: 7 });
    expect(findings(app)).toEqual({
      'm-wakanda runtime': 'The file runs 1 h 42 min; TMDb says 2 h 42 min.',
      'm-wakanda title': 'A title tag in the file names “Bewitched (2005)”: “Bewitched (2005) 2160p”.',
      'm-spy runtime': 'The file runs 1 h 41 min; TMDb says 2 h 05 min.',
      'm-spy title': 'A title tag in the file names “The Lucky One (2012)”: “The.Lucky.One.2012.1080p.BluRay.x264”.',
      'm-tso runtime': 'The file runs 46 min; TMDb says 1 h 11 min.',
      'm-tso title': 'A title tag in the file names “Trans-Siberian Orchestra - The Ghosts of Christmas Eve (1999)”: “Trans-Siberian Orchestra - The Ghosts of Christmas Eve (1999)”.',
      'e-shredder runtime': 'The file runs 1 h 35 min; TMDb says 22 min.',
    });
    const rows = healthRows(app);
    expect(rows.find((x) => x.jfId === 'e-shredder')).toMatchObject({ title: 'Teenage Mutant Ninja Turtles S02E01 · Return of the Shredder', library: 'Shows', rating: 'TV-Y7', path: '/kids/TMNT/S02E01.mkv' });
    expect(String(Dashboard({ m: dashboardModel(app, NOW), csrf: 'x' }))).toMatch(/\d+ things to check in Library health/);
  });

  it('checks each file once, and again when it changes; a finding marked fine stays hidden until then', async () => {
    const { app, fake, calls } = world();
    await run(app);
    expect(calls.filter((c) => c.startsWith('season'))).toEqual(['season 1992/2']); // one lookup a season
    calls.length = 0;
    expect(dismissFinding(app, 'm-tso', 'runtime', 'admin')).toBe(true);
    await run(app, NOW + DAY);
    expect(calls).toEqual([]); // runtimes cached
    expect(healthRows(app).some((r) => r.jfId === 'm-tso' && r.kind === 'runtime')).toBe(false);
    expect(healthRows(app, { dismissed: true }).map((r) => `${r.jfId} ${r.kind}`)).toEqual(['m-tso runtime']);
    // Replaced with the right film: re-checked, and its findings go.
    const tso = fake.items.get('m-tso')! as unknown as { DateCreated: string; MediaSources: { RunTimeTicks: number; MediaStreams: unknown[] }[] };
    tso.DateCreated = '2026-11-21T00:00:00Z';
    tso.MediaSources = [{ RunTimeTicks: 71 * TICKS_PER_MIN, MediaStreams: [] }];
    await run(app, NOW + 2 * DAY);
    expect(Object.keys(findings(app)).filter((k) => k.startsWith('m-tso'))).toEqual([]);
    // Replaced with another wrong file: found again, not hidden.
    tso.DateCreated = '2026-11-22T00:00:00Z';
    tso.MediaSources = [{ RunTimeTicks: 20 * TICKS_PER_MIN, MediaStreams: [] }];
    await run(app, NOW + 3 * DAY);
    expect(healthRows(app).some((r) => r.jfId === 'm-tso' && r.kind === 'runtime')).toBe(true);
  });

  it('drops a finding as soon as its file is deleted or replaced, without waiting for the nightly index', async () => {
    const { app, fake } = world();
    await run(app);
    expect(findings(app)['e-shredder runtime']).toBeDefined();
    fake.items.delete('e-shredder'); // deleted (or replaced: Jellyfin gives the new file a new item)
    await runPipeline(app, { job: 'window-check', trigger: 'schedule', index: false, now: NOW + DAY });
    expect(findings(app)['e-shredder runtime']).toBeUndefined();
    expect(findings(app)['m-wakanda title']).toBeDefined(); // the rest stay
  });

  it('probes a few thousand files a run, so a big library is checked over a few nights', async () => {
    const { app } = world();
    const saved = HEALTH_LIMITS.probesPerRun;
    HEALTH_LIMITS.probesPerRun = 3;
    try {
      expect((await run(app)).stats.healthFilesChecked).toBe(3);
      expect((await run(app, NOW + DAY)).stats.healthFilesChecked).toBe(3);
      expect((await run(app, NOW + 2 * DAY)).stats.healthFilesChecked).toBe(2); // 8 files in all
      expect((await run(app, NOW + 3 * DAY)).stats.healthFilesChecked).toBe(0);
    } finally {
      HEALTH_LIMITS.probesPerRun = saved;
    }
  });

  it('can be turned off', async () => {
    const { app } = world({ health: false });
    await run(app);
    expect(app.db.select().from(healthFinding).all()).toEqual([]);
    expect(app.db.select().from(mediaCheck).all()).toEqual([]); // no file was even probed
  });
});

describe('marking several findings fine', () => {
  it('marks ticked findings, or every open finding for a show’s episodes, from the page', async () => {
    const t = setup();
    await t.web.request('/setup', form({ url: FAKE_URL, apiKey: t.fake.apiKey, setupCode: t.app.setupCode ?? '' }));
    t.fake.add({ Id: 's-long', Name: 'Long Show', Type: 'Series', ParentId: 'lib-shows', ProviderIds: {} } as never);
    // TMDb isn't connected, so the season's median is the reference: E4–E6 are twice as long as E1–E3.
    for (const [n, min] of [[1, 22], [2, 22], [3, 22], [4, 60], [5, 60], [6, 61], [7, 22]] as const) {
      t.fake.add({ Id: `e-long-${n}`, Name: `Episode ${n}`, Type: 'Episode', SeriesId: 's-long', ParentIndexNumber: 1, IndexNumber: n, DateCreated: '2026-11-01T00:00:00Z', MediaSources: [{ RunTimeTicks: min * TICKS_PER_MIN, Path: `/tv/long/S01E0${n}.mkv`, MediaStreams: [{ Type: 'Video' }] }] } as never);
    }
    t.fake.add({ Id: 'm-odd', Name: 'Odd Film', Type: 'Movie', ParentId: 'lib-movies', ProductionYear: 2020, DateCreated: '2026-11-01T00:00:00Z', MediaSources: [{ RunTimeTicks: 90 * TICKS_PER_MIN, Path: '/movies/odd.mkv', MediaStreams: [{ Type: 'Video', Title: 'Something Else (1999)' }] }] } as never);
    await runPipeline(t.app, { job: 'manual', trigger: 'manual', index: true });
    expect(healthRows(t.app).filter((r) => fileKinds(r.kind)).map((r) => `${r.jfId} ${r.kind}`).sort()).toEqual(['e-long-4 runtime', 'e-long-5 runtime', 'e-long-6 runtime', 'm-odd title']);
    const { cookie } = await signIn(t.web);
    const csrf = await csrfOf(t.web, cookie, '/health');
    const page = await (await t.web.request('/health', { headers: { cookie } })).text();
    expect(page).toContain('Mark selected fine');
    expect(page).toMatch(/<option value="s-long">Long Show \(3\)<\/option>/);
    expect(page).toContain('form="bulk" name="sel" value="e-long-4|runtime"');
    const post = (body: Record<string, string | string[]>) => {
      const b = new URLSearchParams({ _csrf: csrf });
      for (const [k, v] of Object.entries(body)) for (const x of ([] as string[]).concat(v)) b.append(k, x);
      return t.web.request('/health/dismiss-many', { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: b.toString() });
    };
    expect(flash(await post({ what: 'selected' }))).toContain('Tick the findings');
    expect(flash(await post({ what: 'selected', sel: ['e-long-4|runtime', 'm-odd|title'] }))).toContain('2 findings marked as fine');
    expect(flash(await post({ what: 'series', series: 's-long' }))).toContain('3 findings marked as fine'); // E5, E6 and the show's missing poster
    expect(healthRows(t.app).filter((r) => fileKinds(r.kind))).toEqual([]);
    expect(healthRows(t.app, { dismissed: true }).every((r) => r.dismissedBy === 'admin')).toBe(true);
  });
});

describe('Library health page and Claude', () => {
  it('lists findings and marks one fine', async () => {
    const t = setup();
    await t.web.request('/setup', form({ url: FAKE_URL, apiKey: t.fake.apiKey, setupCode: t.app.setupCode ?? '' }));
    t.fake.add({ Id: 'm-odd', Name: 'Odd Film', Type: 'Movie', ParentId: 'lib-movies', ProductionYear: 2020, DateCreated: '2026-11-01T00:00:00Z', MediaSources: [{ RunTimeTicks: 90 * TICKS_PER_MIN, Path: '/movies/odd.mkv', MediaStreams: [{ Type: 'Video', Title: 'Something Else (1999)' }] }] } as never);
    // Posters for every film and show, so the artwork check has nothing to say here (artwork-health.test.ts covers it).
    for (const it of t.fake.items.values()) if (it.Type === 'Movie' || it.Type === 'Series') t.fake.setImage(it.Id, await portrait());
    await runPipeline(t.app, { job: 'manual', trigger: 'manual', index: true });
    const { cookie } = await signIn(t.web);
    const csrf = await csrfOf(t.web, cookie, '/health');
    const page = await (await t.web.request('/health', { headers: { cookie } })).text();
    expect(page).toContain('Odd Film (2020)');
    expect(page).toContain('names “Something Else (1999)”');
    expect(page).toContain('/movies/odd.mkv');
    const res = await t.web.request('/health/dismiss', { ...form({ _csrf: csrf, jfId: 'm-odd', kind: 'title' }), headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' } });
    expect(flash(res)).toContain('Marked as fine');
    expect(t.app.db.select().from(healthFinding).where(eq(healthFinding.jfId, 'm-odd')).get()!.dismissedBy).toBe('admin');
    // The dashboard: nothing left to review, one reviewed (by whom), and how much of the library is checked.
    const after = await (await t.web.request('/health', { headers: { cookie } })).text();
    expect(after).toMatch(/<b class="num big">0<\/b> findings/);
    expect(after).toMatch(/<b class="num big">1<\/b> marked fine/);
    expect(after).toContain('100%</b> of 2 files');
    expect(after).toMatch(/Odd Film \(2020\)[\s\S]*admin[\s\S]*Review again/);
    expect(after).toContain('aria-current="page"'); // its own menu item, current
    expect(after).toMatch(/href="\/health"[^>]*aria-current="page"/);
    // Review again puts it back.
    const again = await t.web.request('/health/reopen', { ...form({ _csrf: csrf, jfId: 'm-odd', kind: 'title' }), headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' } });
    expect(flash(again)).toContain('Back in Needs review');
    expect(await (await t.web.request('/health', { headers: { cookie } })).text()).toMatch(/<b class="num big bad">1<\/b> finding/);
    // The menu item counts what needs review, on every page.
    expect(await (await t.web.request('/', { headers: { cookie } })).text()).toMatch(/href="\/health"[\s\S]{0,600}aria-label="1 to review"/);
  });
});
