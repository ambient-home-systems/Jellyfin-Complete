// Library health (ADR-041): flag films and episodes whose file may not be what it says, from a real incident where a
// kids' episode held an adult drama and three films held other films. Read-only: findings are shown, never acted on.
// - Length: the file's own duration (as Jellyfin probed it) against TMDb's runtime, beyond 12 minutes or 15%,
//   whichever is larger. For episodes, when a season's files as a whole are off from TMDb (some networks list the TV
//   slot, ads included: Dirty Jobs at 60 minutes for 42-minute files), or TMDb has no runtimes, the season's median
//   file length is the reference instead, so only the odd ones out are flagged (an episode with the ads left in, two
//   episodes in one file, a double-length crossover).
// - Title tags: a stream's title tag naming another title ("Bewitched (2005)" on Black Panther: Wakanda Forever).
//   Jellyfin doesn't expose a file's container-level title, only its streams', so those are what's read.
// Files are probed once (again when the file changes), a few thousand a run; TMDb runtimes are cached for months.
import { and, eq, inArray } from 'drizzle-orm';
import type { AppContext } from '../app-context.js';
import { healthFinding, library, libraryItem, mediaCheck, type ArtworkProposal, type HealthKind } from '../db/schema.js';
import { getCached, putCached } from '../cache.js';
import { lang2, languageName, sameLanguage } from './languages.js';
import { containerTitle } from './container.js';
import { detectMapping, frameAvailable, mapPath, setMediaNote } from './media.js';
import { existsSync } from 'node:fs';
import { log } from '../log.js';

export const HEALTH_LIMITS = { probesPerRun: 3000, movieLookupsPerRun: 400, seasonLookupsPerRun: 150 };
/** What a probe reads: 2 adds audio tracks and embedded pictures (ADR-043); 3, whether Jellyfin has trickplay previews (ADR-044). */
export const PROBE_V = 3;
/** Files whose own title is read from the media mount in a run (a few kilobytes each). */
export const CONTAINER_READS_PER_RUN = 3000;

/**
 * Read files' own (container) titles from the read-only media mount (ADR-044): files not read yet, new ones first.
 * Works out where Jellyfin's paths are under the mount when it doesn't know yet, or when files stop being found there.
 */
async function readContainerTitles(app: AppContext, rows: { jfId: string }[], checks: Map<string, typeof mediaCheck.$inferSelect>, opts: { now: number; step?: (s: string) => void }) {
  const m = app.settings().media;
  const todo = rows.map((r) => checks.get(r.jfId)).filter((c): c is typeof mediaCheck.$inferSelect => Boolean(c?.path && c.containerRead === 0)).sort((a, b) => b.checkedAt - a.checkedAt);
  if (!todo.length) return;
  let map = m.map;
  const findable = (mp: typeof map) => todo.slice(0, 5).some((c) => { const f = mapPath(c.path!, m.dir, mp); return Boolean(f && existsSync(f)); });
  if (!map || !findable(map)) {
    const samples = [...checks.values()].filter((c) => c.path).sort((a, b) => b.checkedAt - a.checkedAt).map((c) => c.path!);
    map = detectMapping(m.dir, samples);
    if (!map) {
      setMediaNote(app, `None of Jellyfin’s files were found under ${m.dir}. Check that the media folder is mounted there, read-only, and readable by the app’s user (uid 1000).`);
      log.warn(`Media mount: none of Jellyfin's files were found under ${m.dir}`);
      return;
    }
    app.updateSettings({ media: { ...m, map } });
    log.info(`Media mount: Jellyfin's ${map.from || '/'} is ${map.to} here`);
  }
  opts.step?.(`Reading ${Math.min(todo.length, CONTAINER_READS_PER_RUN)} files’ own titles`);
  let read = 0, unreadable = 0;
  for (const c of todo.slice(0, CONTAINER_READS_PER_RUN)) {
    const file = mapPath(c.path!, m.dir, map);
    let title: string | null = null, state = 2;
    if (file) {
      try { title = await containerTitle(file); state = 1; read++; } catch { unreadable++; }
    } else unreadable++;
    app.db.update(mediaCheck).set({ containerTitle: title, containerRead: state }).where(eq(mediaCheck.jfId, c.jfId)).run();
    checks.set(c.jfId, { ...c, containerTitle: title, containerRead: state });
  }
  setMediaNote(app, unreadable ? `${unreadable} ${unreadable === 1 ? 'file' : 'files'} couldn’t be read from ${m.dir} (not there, or not readable by the app’s user).` : null);
  if (read || unreadable) log.info(`Media mount: read ${read} files' own titles${unreadable ? `; ${unreadable} couldn't be read` : ''}`);
}
export const RUNTIME_TOLERANCE = { minutes: 12, fraction: 0.15 };

const fmtMin = (m: number) => {
  const r = Math.round(m);
  return r >= 60 ? `${Math.floor(r / 60)} h ${String(r % 60).padStart(2, '0')} min` : `${r} min`;
};

/** A length problem in words, or null: beyond 12 minutes or 15% of TMDb's runtime, whichever is larger. */
export function runtimeVerdict(fileMin: number, tmdbMin: number): string | null {
  if (!(fileMin > 0) || !(tmdbMin > 0)) return null;
  const tolerance = Math.max(RUNTIME_TOLERANCE.minutes, RUNTIME_TOLERANCE.fraction * tmdbMin);
  if (Math.abs(fileMin - tmdbMin) <= tolerance) return null;
  return `The file runs ${fmtMin(fileMin)}; TMDb says ${fmtMin(tmdbMin)}.`;
}

const NOISE = /\b(2160p|1080p|720p|576p|480p|4k|uhd|hdr10\+?|hdr|dv|dovi|sdr|remux|bluray|blu ray|bdrip|brrip|web ?dl|webrip|web|hdtv|dvdrip|x26[45]|h ?26[45]|hevc|avc|aac|ac3|eac3|ddp?|dts( hd)?|truehd|atmos|flac|10bit|proper|repack|extended|remastered|imax|unrated|uncut)\b/gi;
const NOT_A_TITLE = /\b(commentary|director'?s|sdh|forced|subtitles?|subs?|english|french|spanish|german|stereo|surround|mono|audio|track|signs|songs|chapters?|descriptive|narration|isolated|score|cc)\b/i;
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'in', 'on', 'to', 'la', 'le', 'les', 'el', 'der', 'die', 'das']);
const words = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w && !STOP.has(w));

/** The title and year a tag names, if it looks like a release name ("The.Lucky.One.2012.1080p", "Bewitched (2005)"). */
export function claimedTitle(tag: string): { title: string; year: number } | null {
  const t = tag.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  const years = [...t.matchAll(/(?<![\d])((?:19|20)\d{2})(?![\d])/g)];
  for (const m of years.reverse()) {
    const before = t.slice(0, m.index).replace(/[\s([{\-–:,]+$/, '').replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
    if (!/[a-z]{2,}/i.test(before) || NOT_A_TITLE.test(before)) continue;
    return { title: before, year: Number(m[1]) };
  }
  return null;
}

/** True when a claimed title is the same as any of these names (mostly the same words, or one inside the other). */
export function sameTitle(claimed: string, names: string[]): boolean {
  const c = words(claimed);
  if (!c.length) return true;
  return names.some((n) => {
    const w = words(n);
    if (!w.length) return false;
    const shared = c.filter((x) => w.includes(x)).length;
    const joined = (xs: string[]) => xs.join(' ');
    return shared / c.length >= 0.5 || joined(w).includes(joined(c)) || joined(c).includes(joined(w));
  });
}

/**
 * A title-tag problem in words, or null. A tag that names another title is flagged unless its year is within a year of
 * the title's (a translated or alternative title of the same film).
 */
export function titleVerdict(tags: string[], item: { names: string[]; year: number | null }, what = 'A title tag in the file'): string | null {
  for (const tag of tags) {
    const c = claimedTitle(tag);
    if (!c || sameTitle(c.title, item.names)) continue;
    if (item.year !== null && Math.abs(c.year - item.year) <= 1) continue;
    return `${what} names “${c.title} (${c.year})”: “${tag}”.`;
  }
  return null;
}

const median = (xs: number[]) => {
  const v = [...xs].sort((a, b) => a - b);
  const n = v.length;
  return n % 2 ? v[(n - 1) / 2]! : (v[n / 2 - 1]! + v[n / 2]!) / 2;
};
/** How many episodes a file holds: one, or several for a file Jellyfin knows spans them ("S07E13-E14"). */
const parts = (r: { episode: number | null; episodeEnd: number | null }) => (r.episode !== null && r.episodeEnd !== null && r.episodeEnd > r.episode ? r.episodeEnd - r.episode + 1 : 1);
/** When a season's typical file length is this far from TMDb's typical runtime, TMDb's runtimes aren't used for it. */
export const SEASON_OFF = { minutes: 4, fraction: 0.1 };
/** A group needs this many episode files before its median means anything. */
export const MEDIAN_MIN_EPISODES = 3;

type LenRow = { jfId: string; kind: string; seriesJfId: string | null; season: number | null; episode: number | null; episodeEnd: number | null };

/**
 * Each film's and episode's length problem in words (null if none), for the titles that have something to compare
 * with. Films: TMDb's runtime. Episodes: TMDb's, unless the season's files as a whole are off from TMDb's runtimes, or
 * TMDb has none; then the season's median file length (the show's, for a season with fewer than three files).
 */
export function lengthVerdicts(rows: LenRow[], durations: Map<string, number>, tmdbMin: Map<string, number>): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const eps = rows.filter((r) => r.kind === 'episode' && r.seriesJfId && durations.get(r.jfId));
  const groups = new Map<string, LenRow[]>();
  const add = (k: string, r: LenRow) => (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  for (const r of eps) { add(`season|${r.seriesJfId}|${r.season}`, r); add(`show|${r.seriesJfId}`, r); }
  const unit = (r: LenRow) => durations.get(r.jfId)! / parts(r);
  type Ref = { median: number; useMedian: boolean; scope: 'season' | 'show' };
  const refs = new Map<string, Ref>();
  const refOf = (key: string, scope: 'season' | 'show'): Ref | null => {
    if (refs.has(key)) return refs.get(key)!;
    const list = groups.get(key) ?? [];
    if (list.length < MEDIAN_MIN_EPISODES) return null;
    const m = median(list.map(unit));
    const listed = list.filter((r) => tmdbMin.has(r.jfId));
    // Off as a whole: the typical file length is more than 4 minutes or 10% from TMDb's typical runtime (a sitcom TMDb
    // lists at 30 minutes runs 21). A single file is held to the looser 12 minutes or 15%.
    const fm = median(listed.map(unit)), tm = median(listed.map((r) => tmdbMin.get(r.jfId)!));
    const useMedian = listed.length < MEDIAN_MIN_EPISODES || Math.abs(fm - tm) > Math.max(SEASON_OFF.minutes, SEASON_OFF.fraction * tm);
    const ref = { median: m, useMedian, scope };
    refs.set(key, ref);
    return ref;
  };
  const byNumber = new Map(eps.map((r) => [`${r.seriesJfId}|${r.season}|${r.episode}`, r]));
  for (const r of rows) {
    const file = durations.get(r.jfId);
    if (!file) continue;
    if (r.kind !== 'episode') {
      const t = tmdbMin.get(r.jfId);
      if (t) out.set(r.jfId, runtimeVerdict(file, t));
      continue;
    }
    if (!r.seriesJfId) continue;
    const ref = refOf(`season|${r.seriesJfId}|${r.season}`, 'season') ?? refOf(`show|${r.seriesJfId}`, 'show');
    const t = tmdbMin.get(r.jfId);
    let verdict: string | null;
    let typical: number;
    if (ref?.useMedian) {
      typical = ref.median;
      verdict = medianVerdict(file, ref.median * parts(r), ref.scope);
    } else if (t) {
      typical = t;
      verdict = runtimeVerdict(file, t * parts(r));
    } else continue;
    // About twice the usual length: say it may hold two episodes, and whether the next one has its own file.
    if (verdict && parts(r) === 1 && file / typical >= 1.7 && file / typical <= 2.4 && r.episode !== null) {
      const next = r.episode + 1;
      const own = byNumber.get(`${r.seriesJfId}|${r.season}|${next}`);
      verdict += own ? ` It may contain two episodes; E${String(next).padStart(2, '0')} also has its own file, so the second half may be something else.` : ` It may contain two episodes (E${String(next).padStart(2, '0')} has no file of its own).`;
    }
    out.set(r.jfId, verdict);
  }
  return out;
}

/** An episode's length against its season's (or show's) median file length, beyond 12 minutes or 15%. */
export function medianVerdict(fileMin: number, medianMin: number, scope: 'season' | 'show'): string | null {
  if (!(fileMin > 0) || !(medianMin > 0)) return null;
  const tolerance = Math.max(RUNTIME_TOLERANCE.minutes, RUNTIME_TOLERANCE.fraction * medianMin);
  if (Math.abs(fileMin - medianMin) <= tolerance) return null;
  return `The file runs ${fmtMin(fileMin)}; this ${scope}’s episodes typically run ${fmtMin(medianMin)}.`;
}

/** The findings worked out from the files themselves (the rest are artwork findings, ADR-043). */
export const FILE_KINDS = ['runtime', 'title', 'audio'] as const;
export type FileKind = (typeof FILE_KINDS)[number];
/** A Jellyfin user's audio settings, as last read (for the audio findings' severity and the Dashboard). */
export type AudioPref = { name: string; lang: string | null; playDefault: boolean };
export const AUDIO_PREFS_KEY = 'jf-audio-prefs';

/**
 * A default audio track that isn't in the library's language, when another track is (ADR-043): "plays in French by
 * default; it has an English track too". The default is the track flagged default, else the first. Null if fine,
 * or if the language isn't known.
 */
export function audioVerdict(tracks: { lang: string | null; isDefault: boolean }[], want: string | null): string | null {
  if (!want || tracks.length < 2) return null;
  const def = tracks.find((t) => t.isDefault) ?? tracks[0]!;
  if (!lang2(def.lang) || sameLanguage(def.lang, want)) return null;
  if (!tracks.some((t) => sameLanguage(t.lang, want))) return null;
  return `It plays in ${languageName(def.lang)} by default; it has a${/^[AEIOU]/.test(languageName(want)) ? 'n' : ''} ${languageName(want)} track too.`;
}

/**
 * Whether Jellyfin's users' own settings already pick the library's language over a file's default track: every
 * user prefers that language and doesn't play the default track. Null when the users haven't been read yet.
 */
export function audioHandled(prefs: AudioPref[] | null, want: string | null): boolean | null {
  if (!prefs) return null;
  return prefs.length > 0 && prefs.every((u) => !u.playDefault && sameLanguage(u.lang, want));
}

export type HealthStats = { probed: number; lookedUp: number; open: number; found: number; compared: number };

/** Probe files not yet checked, look up runtimes, and record what disagrees. Never fails the run. */
export async function checkLibraryHealth(app: AppContext, opts: { now: number; step?: (s: string) => void }): Promise<HealthStats> {
  const out: HealthStats = { probed: 0, lookedUp: 0, open: 0, found: 0, compared: 0 };
  const jf = app.jellyfin();
  if (!jf) return out;
  const rows = app.db.select().from(libraryItem).where(inArray(libraryItem.kind, ['movie', 'episode'])).all();
  const sigOf = (r: (typeof rows)[number]) => String(r.dateAdded ?? 0);
  const checks = new Map(app.db.select().from(mediaCheck).all().map((c) => [c.jfId, c]));

  // 1. Probe files Jellyfin hasn't been asked about, whose file changed, or probed before audio tracks and pictures
  //    were read too (probe 2, ADR-043): new and changed files first.
  const stale = (r: (typeof rows)[number]) => { const c = checks.get(r.jfId); return !c || c.sig !== sigOf(r) ? 2 : c.probeV < PROBE_V ? 1 : 0; };
  const todo = rows.filter((r) => stale(r) > 0).sort((a, b) => stale(b) - stale(a)).slice(0, HEALTH_LIMITS.probesPerRun);
  if (todo.length) {
    opts.step?.(`Checking ${todo.length} files’ length and title tags`);
    const details = await jf.mediaDetails(todo.map((r) => r.jfId));
    for (const r of todo) {
      const d = details.get(r.jfId);
      if (!d) continue;
      // The file's own title is read again only when the file changed (a probe of the same file keeps it).
      const prev = checks.get(r.jfId);
      const same = prev && prev.sig === sigOf(r);
      const values = {
        sig: sigOf(r), durationMin: d.durationTicks ? d.durationTicks / 600_000_000 : null, titles: d.titles, path: d.path, checkedAt: opts.now, probeV: PROBE_V,
        audio: d.audio, embeddedImage: d.embeddedImage, trickplay: d.trickplay,
        containerTitle: same ? prev.containerTitle : null, containerRead: same ? prev.containerRead : 0,
      };
      app.db.insert(mediaCheck).values({ jfId: r.jfId, ...values }).onConflictDoUpdate({ target: mediaCheck.jfId, set: values }).run();
      checks.set(r.jfId, { jfId: r.jfId, ...values });
      out.probed++;
    }
  }

  // 1b. The files' own titles, from the read-only media mount, when it's on (ADR-044).
  if (app.settings().media.enabled) await readContainerTitles(app, rows, checks, opts);

  // 2. TMDb runtimes: films by their TMDb ID, episodes a season at a time. Cached, capped per run.
  const tmdb = app.tmdb();
  const byId = new Map(rows.map((r) => [r.jfId, r]));
  const series = new Map(app.db.select().from(libraryItem).where(eq(libraryItem.kind, 'series')).all().map((s) => [s.jfId, s]));
  const runtimeOf = new Map<string, number>();
  let films = 0, seasons = 0;
  let tmdbOk = Boolean(tmdb);
  for (const r of rows) {
    const c = checks.get(r.jfId);
    if (!c?.durationMin) continue;
    try {
      if (r.kind === 'movie' && r.tmdb) {
        const hit = getCached<number | null>(app.db, `movie-runtime:${r.tmdb}`);
        const v = hit.hit ? hit.value : tmdbOk && films < HEALTH_LIMITS.movieLookupsPerRun ? (films++, await tmdb!.movieRuntime(r.tmdb)) : null;
        if (v) runtimeOf.set(r.jfId, v);
      } else if (r.kind === 'episode' && r.season !== null && r.episode !== null) {
        const show = series.get(r.seriesJfId ?? '');
        if (!show?.tmdb) continue;
        const key = `season-runtimes:${show.tmdb}:${r.season}`;
        const hit = getCached<Record<string, number | null>>(app.db, key);
        const season = hit.hit ? hit.value : tmdbOk && seasons < HEALTH_LIMITS.seasonLookupsPerRun ? (seasons++, await tmdb!.seasonRuntimes(show.tmdb, r.season)) : null;
        const v = season?.[String(r.episode)];
        if (v) runtimeOf.set(r.jfId, v);
      }
    } catch (e) {
      tmdbOk = false; // the rest wait for the next run
      log.warn(`TMDb runtime lookups stopped for this run: ${(e as Error).message}`);
    }
  }
  out.lookedUp = films + seasons;

  // The languages files should play in (ADR-043): each library's, else the server's; and users' audio settings, which
  // decide whether a default track in another language is just information or will really play.
  const serverLang = await jf.preferredLanguage().catch(() => null);
  putCached(app.db, 'jf-server-language', serverLang, 365, opts.now);
  try {
    const users = await jf.users();
    putCached(app.db, AUDIO_PREFS_KEY, users.filter((u) => !u.Policy?.IsDisabled).map((u): AudioPref => ({
      name: u.Name ?? '?', lang: u.Configuration?.AudioLanguagePreference?.trim() || null, playDefault: u.Configuration?.PlayDefaultAudioTrack !== false,
    })), 365, opts.now);
  } catch (e) {
    log.warn(`Couldn’t read Jellyfin users’ audio settings: ${(e as Error).message}`);
  }
  const libLang = new Map(app.db.select({ id: library.id, lang: library.preferredLanguage }).from(library).all().map((l) => [l.id, l.lang ?? serverLang]));
  const langOf = (r: (typeof rows)[number]) => libLang.get(r.kind === 'episode' ? series.get(r.seriesJfId ?? '')?.libraryId ?? '' : r.libraryId) ?? serverLang;

  // 3. Findings: what disagrees now. A dismissal lasts until the file changes; findings that no longer hold go.
  const durations = new Map([...checks].filter(([, c]) => c.durationMin).map(([id, c]) => [id, c.durationMin!]));
  const lengths = lengthVerdicts(rows, durations, runtimeOf);
  out.compared = lengths.size;
  const now = new Map<string, { kind: FileKind; detail: string; sig: string }>();
  for (const [jfId, c] of checks) {
    const r = byId.get(jfId);
    if (!r) continue;
    const rt = lengths.get(jfId) ?? null;
    if (rt) now.set(`${jfId}|runtime`, { kind: 'runtime', detail: rt, sig: c.sig });
    const show = r.kind === 'episode' ? series.get(r.seriesJfId ?? '') : undefined;
    const names = [r.name, ...(show ? [show.name] : [])];
    const own = c.containerTitle ? titleVerdict([c.containerTitle], { names, year: r.kind === 'episode' ? null : r.year }, 'The file’s own title') : null;
    const tv = own ?? titleVerdict(c.titles, { names, year: r.kind === 'episode' ? null : r.year });
    if (tv) now.set(`${jfId}|title`, { kind: 'title', detail: tv, sig: c.sig });
    const au = c.audio ? audioVerdict(c.audio, langOf(r)) : null;
    if (au) now.set(`${jfId}|audio`, { kind: 'audio', detail: au, sig: c.sig });
  }
  // Only the findings about files are worked out here; artwork findings are the artwork check's (artwork.ts).
  const existing = new Map(app.db.select().from(healthFinding).all().filter((f) => (FILE_KINDS as readonly string[]).includes(f.kind)).map((f) => [`${f.jfId}|${f.kind}`, f]));
  for (const [key, f] of existing) {
    // Gone from the library, or no longer true (and not just waiting on a lookup or a probe): forget it.
    const jfId = key.split('|')[0]!;
    const known = f.kind === 'title' || (f.kind === 'runtime' && lengths.has(jfId)) || (f.kind === 'audio' && Boolean(checks.get(jfId)?.audio));
    if (!byId.has(jfId) || (!now.has(key) && known)) {
      app.db.delete(healthFinding).where(and(eq(healthFinding.jfId, f.jfId), eq(healthFinding.kind, f.kind))).run();
    }
  }
  for (const [key, f] of now) {
    const jfId = key.split('|')[0]!;
    const prev = existing.get(key);
    if (!prev) {
      app.db.insert(healthFinding).values({ jfId, kind: f.kind, detail: f.detail, sig: f.sig, firstSeen: opts.now }).run();
      out.found++;
    } else {
      const fileChanged = prev.sig !== f.sig;
      app.db.update(healthFinding).set({ detail: f.detail, sig: f.sig, ...(fileChanged ? { dismissedAt: null, dismissedBy: null, firstSeen: opts.now } : {}) })
        .where(and(eq(healthFinding.jfId, jfId), eq(healthFinding.kind, f.kind))).run();
    }
  }
  out.open = app.db.select().from(healthFinding).all().filter((f) => !f.dismissedAt).length;
  return out;
}

export type HealthRow = {
  jfId: string; kind: HealthKind; detail: string; firstSeen: number; dismissedAt: number | null; dismissedBy: string | null;
  title: string; library: string | null; rating: string | null; path: string | null;
  /** Episodes: their show's Jellyfin ID and name. */
  seriesJfId: string | null; show: string | null;
  /** Artwork findings: the TMDb image the fix would put on (none without a verified TMDb ID). */
  proposal: ArtworkProposal | null;
  /** The current poster's tag (for its thumbnail), and whether this is a box set rather than a title. */
  primaryTag: string | null; boxSet: boolean;
  /** Audio findings Jellyfin's users' own settings already take care of: shown for information, not counted. */
  info: boolean;
  /** A frame from the middle of the file can be shown (Jellyfin's trickplay previews, or ffmpeg on the mount). */
  frame: boolean;
};

/** Each library's language (its own, else the server's), for the audio findings. */
function languages(app: AppContext): { of: (libraryId: string | null | undefined) => string | null; prefs: AudioPref[] | null } {
  const server = (() => { const h = getCached<string | null>(app.db, 'jf-server-language'); return h.hit ? h.value : null; })();
  const libs = new Map(app.db.select({ id: library.id, lang: library.preferredLanguage }).from(library).all().map((l) => [l.id, l.lang]));
  const prefs = (() => { const h = getCached<AudioPref[]>(app.db, AUDIO_PREFS_KEY); return h.hit ? h.value : null; })();
  return { of: (id) => (id ? libs.get(id) ?? null : null) ?? server, prefs };
}

/** Findings with what they're about, for the page, the Dashboard and Claude. */
export function healthRows(app: AppContext, opts: { dismissed?: boolean } = {}): HealthRow[] {
  const findings = app.db.select().from(healthFinding).all().filter((f) => Boolean(f.dismissedAt) === Boolean(opts.dismissed));
  if (!findings.length) return [];
  const ids = [...new Set(findings.map((f) => f.jfId))];
  const items = new Map(app.db.select().from(libraryItem).where(inArray(libraryItem.jfId, ids)).all().map((r) => [r.jfId, r]));
  const showIds = [...new Set([...items.values()].map((r) => r.seriesJfId).filter((x): x is string => Boolean(x)))];
  const shows = new Map(showIds.length ? app.db.select().from(libraryItem).where(inArray(libraryItem.jfId, showIds)).all().map((r) => [r.jfId, r]) : []);
  const libs = new Map(app.db.$client.prepare('select id, name from library').all().map((l) => [(l as { id: string }).id, (l as { name: string }).name]));
  const checks = new Map(app.db.select().from(mediaCheck).where(inArray(mediaCheck.jfId, ids)).all().map((c) => [c.jfId, c]));
  const lang = languages(app);
  return findings.map((f) => {
    const r = items.get(f.jfId);
    const show = r?.seriesJfId ? shows.get(r.seriesJfId) : undefined;
    const title = !r ? (f.subject ? `${f.subject.name} (box set)` : f.jfId) : r.kind === 'episode'
      ? `${show?.name ?? 'Unknown show'} S${String(r.season ?? 0).padStart(2, '0')}E${String(r.episode ?? 0).padStart(2, '0')} · ${r.name}`
      : `${r.name}${r.year ? ` (${r.year})` : ''}`;
    const libId = r?.kind === 'episode' ? show?.libraryId : r?.libraryId;
    return {
      jfId: f.jfId, kind: f.kind, detail: f.detail, firstSeen: f.firstSeen, dismissedAt: f.dismissedAt ?? null, dismissedBy: f.dismissedBy ?? null,
      title, library: libId ? libs.get(libId) ?? null : null, rating: r?.officialRating ?? show?.officialRating ?? null, path: checks.get(f.jfId)?.path ?? (r?.kind !== 'episode' ? r?.path ?? null : null),
      seriesJfId: r?.kind === 'episode' ? r.seriesJfId ?? null : null, show: show?.name ?? null,
      proposal: f.proposal ?? null, primaryTag: r?.primaryTag ?? null, boxSet: Boolean(f.subject),
      info: f.kind === 'audio' && audioHandled(lang.prefs, lang.of(libId)) === true,
      frame: (f.kind === 'runtime' || f.kind === 'title' || f.kind === 'audio') && frameAvailable(app, { trickplay: checks.get(f.jfId)?.trickplay ?? null, path: checks.get(f.jfId)?.path ?? null }),
    };
  }).sort((a, b) => (opts.dismissed ? (b.dismissedAt ?? 0) - (a.dismissedAt ?? 0) : b.firstSeen - a.firstSeen) || a.title.localeCompare(b.title));
}

/** Open findings that need someone to look (audio ones users' settings take care of don't), for the menu and Dashboard. */
export const openFindingCount = (app: AppContext): number => healthRows(app).filter((r) => !r.info).length;

/** Mark a finding as checked and fine. It comes back if the file changes. */
export function dismissFinding(app: AppContext, jfId: string, kind: HealthKind, by: string): boolean {
  const r = app.db.update(healthFinding).set({ dismissedAt: Date.now(), dismissedBy: by }).where(and(eq(healthFinding.jfId, jfId), eq(healthFinding.kind, kind))).run();
  return r.changes > 0;
}

/**
 * Mark several findings fine at once: given findings (an item and, optionally, one kind), every open finding for the
 * episodes of given shows, or both. Returns how many were marked.
 */
export function dismissFindings(app: AppContext, opts: { findings?: { jfId: string; kind?: HealthKind }[]; seriesIds?: string[] }, by: string): number {
  const open = app.db.select().from(healthFinding).all().filter((f) => !f.dismissedAt);
  const wanted = new Set<string>();
  for (const f of opts.findings ?? []) for (const o of open) if (o.jfId === f.jfId && (!f.kind || o.kind === f.kind)) wanted.add(`${o.jfId}|${o.kind}`);
  if (opts.seriesIds?.length) {
    const eps = new Set(app.db.select({ id: libraryItem.jfId }).from(libraryItem).where(inArray(libraryItem.seriesJfId, opts.seriesIds)).all().map((r) => r.id));
    for (const id of opts.seriesIds) eps.add(id);
    for (const o of open) if (eps.has(o.jfId)) wanted.add(`${o.jfId}|${o.kind}`);
  }
  const at = Date.now();
  app.db.transaction((tx) => {
    for (const k of wanted) {
      const [jfId, kind] = k.split('|') as [string, HealthKind];
      tx.update(healthFinding).set({ dismissedAt: at, dismissedBy: by }).where(and(eq(healthFinding.jfId, jfId), eq(healthFinding.kind, kind))).run();
    }
  });
  return wanted.size;
}

/** Put a finding marked fine back up for review. */
export function reopenFinding(app: AppContext, jfId: string, kind: HealthKind): boolean {
  const r = app.db.update(healthFinding).set({ dismissedAt: null, dismissedBy: null }).where(and(eq(healthFinding.jfId, jfId), eq(healthFinding.kind, kind))).run();
  return r.changes > 0;
}

export type HealthDashboard = {
  enabled: boolean;
  /** Films and episodes in the library, how many have been checked (as they are now), and how many wait. */
  files: number; checked: number; waiting: number;
  /** Checked files with a length to compare with (TMDb's runtime, or the season's typical length). */
  compared: number | null;
  /** Open findings someone should look at; audio ones users' settings take care of are counted apart (`info`). */
  needsReview: number; reviewed: number;
  byKind: Record<HealthKind, number>;
  byLibrary: { library: string; files: number; checked: number; needsReview: number; reviewed: number }[];
  lastChecked: number | null;
  open: HealthRow[]; done: HealthRow[];
  /** Audio findings Jellyfin's users' settings already take care of: for information. */
  info: HealthRow[];
};

/** Everything the Library health page shows about files and findings (artwork extras: artwork.ts artworkSummary). */
export function healthDashboard(app: AppContext): HealthDashboard {
  const rows = app.db.select().from(libraryItem).where(inArray(libraryItem.kind, ['movie', 'episode', 'series'])).all();
  const seriesLib = new Map(rows.filter((r) => r.kind === 'series').map((r) => [r.jfId, r.libraryId]));
  const files = rows.filter((r) => r.kind !== 'series');
  const libOf = (r: (typeof rows)[number]) => (r.kind === 'episode' ? seriesLib.get(r.seriesJfId ?? '') : r.libraryId) ?? null;
  const checks = new Map(app.db.select({ jfId: mediaCheck.jfId, sig: mediaCheck.sig, at: mediaCheck.checkedAt }).from(mediaCheck).all().map((c) => [c.jfId, c]));
  const isChecked = (r: (typeof rows)[number]) => checks.get(r.jfId)?.sig === String(r.dateAdded ?? 0);
  const libNames = new Map(app.db.$client.prepare('select id, name from library').all().map((l) => [(l as { id: string }).id, (l as { name: string }).name]));
  const per = new Map<string, { library: string; files: number; checked: number; needsReview: number; reviewed: number }>();
  const bucket = (lib: string | null) => {
    const name = (lib && libNames.get(lib)) ?? 'Other';
    if (!per.has(name)) per.set(name, { library: name, files: 0, checked: 0, needsReview: 0, reviewed: 0 });
    return per.get(name)!;
  };
  const byId = new Map(rows.map((r) => [r.jfId, r]));
  let checked = 0;
  for (const r of files) {
    const b = bucket(libOf(r));
    b.files++;
    if (isChecked(r)) { b.checked++; checked++; }
  }
  const all = healthRows(app);
  const open = all.filter((r) => !r.info);
  const info = all.filter((r) => r.info);
  const done = healthRows(app, { dismissed: true });
  for (const f of open) { const r = byId.get(f.jfId); bucket(r ? libOf(r) : null).needsReview++; }
  for (const f of done) { const r = byId.get(f.jfId); bucket(r ? libOf(r) : null).reviewed++; }
  // The latest run's count of files compared with a length.
  const runs = app.db.$client.prepare("select stats from run where status = 'ok' order by started_at desc limit 20").all() as { stats: string }[];
  const compared = runs.map((r) => (JSON.parse(r.stats) as { healthCompared?: number }).healthCompared).find((n) => n !== undefined) ?? null;
  const last = [...checks.values()].reduce((m, c) => Math.max(m, c.at), 0);
  const byKind = Object.fromEntries((['runtime', 'title', 'audio', 'no_poster', 'video_poster', 'language', 'other_title'] as HealthKind[]).map((k) => [k, open.filter((f) => f.kind === k).length])) as Record<HealthKind, number>;
  return {
    enabled: app.settings().health.enabled,
    files: files.length, checked, waiting: files.length - checked, compared,
    needsReview: open.length, reviewed: done.length, byKind,
    byLibrary: [...per.values()].filter((b) => b.files || b.needsReview || b.reviewed).sort((a, b) => b.needsReview - a.needsReview || a.library.localeCompare(b.library)),
    lastChecked: last || null,
    open, done, info,
  };
}
