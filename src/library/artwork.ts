// Artwork checks (ADR-043): find wrong, missing or out-of-place artwork on films, shows and box sets, and put it right
// from TMDb, by a TMDb ID the app has confirmed, never by a name search. The incident behind it (ADR-040): box sets
// showing another collection's artwork, a kids' film showing a video still, Donald Duck shorts with French posters.
//
// Jellyfin doesn't record where an image came from or what language it's in, so:
// - A poster's language: its fingerprint (a difference hash) is matched against the title's own TMDb posters, which
//   carry their language. TMDb's thumbnails are tiny, and each one's fingerprint is kept for good.
// - A poster from the video: a wide (16:9) "poster" on a film or show is a frame. One that matches none of TMDb's
//   posters and is the same shape as the picture embedded in the file (or the file has a picture attached) came from
//   the file. Comparing against frames of the video itself would need the file (a later, optional media mount).
// - The TMDb ID is confirmed when TMDb's record for it carries the same IMDb ID (shows: or TVDB ID) Jellyfin has.
//   When they disagree, the IMDb ID's own TMDb title is looked up (not a name search), and the file's folder name
//   ("Title (Year)") decides. When nothing confirms either, the finding is shown and nothing is offered to fix it.
//
// Fixes replace the poster (optionally backdrop, logo and thumb) with TMDb's best-rated image in the library's language,
// keep the old images in /config/artwork/backups so they can be put back, and re-read the item to record the result.
// Box sets the app doesn't manage are only reported; the app changes box sets it created or adopted (ADR-040).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import type { AppContext } from '../app-context.js';
import { ARTWORK_KINDS, artworkCheck, artworkFix, healthFinding, imageHash, integrityEvent, library, libraryItem, managedCollection, mediaCheck, overlay, type ArtworkKind, type ArtworkProposal } from '../db/schema.js';
import { byRating, type TmdbArtwork, type TmdbClient, type TmdbImage } from '../clients/tmdb.js';
import type { JellyfinClient } from '../clients/jellyfin/index.js';
import { getCached } from '../cache.js';
import { loadSharp } from '../overlays/render.js';
import { originalsDir, readOriginal } from '../overlays/sync.js';
import { SERIES_OF } from '../presets/film-series.js';
import { lang2, languageName, sameLanguage } from './languages.js';
import { log } from '../log.js';

export const ARTWORK_LIMITS = { titlesPerRun: 300, thumbsPerTitle: 40, boxSetsPerRun: 100, autoFixesPerRun: 50, recheckDays: 30 };
/** Fingerprints this close (bits of 64) are the same picture at a different size or compression. */
export const MATCH_DISTANCE = 10;
const IMG = 'https://image.tmdb.org/t/p';
const DAY = 86_400_000;

type Row = typeof libraryItem.$inferSelect;
type Found = { kind: ArtworkKind; detail: string; proposal: ArtworkProposal | null };

// ---------------------------------------------------------------------------------------------------------------
// Fingerprints

/** A picture's 64-bit difference hash (as 16 hex digits) and size. Robust to scaling and recompression. */
export async function fingerprint(bytes: Uint8Array): Promise<{ hash: string; w: number; h: number }> {
  const sharp = await loadSharp();
  const meta = await sharp(bytes).metadata();
  const px = await sharp(bytes).greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x]! < px[y * 9 + x + 1]! ? '1' : '0';
  const hash = BigInt(`0b${bits}`).toString(16).padStart(16, '0');
  return { hash, w: meta.width ?? 0, h: meta.height ?? 0 };
}

/** How many of the 64 bits differ. */
export function distance(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

/** A TMDb image's fingerprint, from its smallest size (kept for good: a TMDb file path never changes). */
async function tmdbFingerprint(app: AppContext, path: string): Promise<string | null> {
  const hit = app.db.select().from(imageHash).where(eq(imageHash.path, path)).get();
  if (hit) return hit.hash;
  try {
    const res = await app.fetch(`${IMG}/w92${path}`);
    if (!res.ok) return null;
    const { hash } = await fingerprint(new Uint8Array(await res.arrayBuffer()));
    app.db.insert(imageHash).values({ path, hash }).onConflictDoNothing().run();
    return hash;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Which TMDb ID to trust

export type Verified = { tmdb: string; by: 'imdb' | 'tvdb' | 'path'; art: TmdbArtwork };
export type Verification = { verified: Verified | null; mismatch: { jellyfin: TmdbArtwork; other: TmdbArtwork | null } | null; note: string | null };

/** True when a file or folder name says this title and year ("Inside Out (2015)"). */
export function pathNames(path: string | null, art: Pick<TmdbArtwork, 'title' | 'originalTitle' | 'year'>): boolean {
  if (!path || !art.year) return false;
  const parts = path.split(/[\\/]+/).filter(Boolean).slice(-2).map((p) => p.replace(/\.[a-z0-9]{2,4}$/i, ''));
  return parts.some((p) => {
    // "Title (Year)", "Title.Year.1080p": the last year in the name, and the title before it (which may be all digits: 9-1-1).
    const m = [...p.matchAll(/(?<!\d)((?:19|20)\d{2})(?!\d)/g)].filter((x) => x.index! > 0).pop();
    if (!m) return false;
    const title = p.slice(0, m.index).replace(/[._]+/g, ' ').replace(/[\s([{\-–:,]+$/, '').trim();
    return Boolean(title) && Math.abs(Number(m[1]) - art.year!) <= 1 && [art.title, art.originalTitle].some((t) => t && sameName(title, t));
  });
}

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'la', 'le', 'les', 'el', 'der', 'die', 'das']);
const nameWords = (s: string) => new Set(s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w && !STOP.has(w)));
/**
 * Strictly the same name: at least 80% of the words in either are in both (stop words aside). Stricter than the title
 * tag check (health.ts), because this confirms an ID: "Inside Out" isn't "Inside Man".
 */
export function sameName(a: string, b: string): boolean {
  const x = nameWords(a), y = nameWords(b);
  if (!x.size || !y.size) return false;
  const both = [...x].filter((w) => y.has(w)).length;
  return both / (x.size + y.size - both) >= 0.8;
}

const describe = (a: TmdbArtwork) => `TMDb ${a.id} (“${a.title}”${a.year ? `, ${a.year}` : ''})`;

/**
 * Confirm a film's or show's TMDb ID: TMDb's record for Jellyfin's ID carries the same IMDb ID (shows: or TVDB ID).
 * When they disagree, the IMDb (or TVDB) ID's own TMDb title is found by ID, and the folder name decides between them.
 * Never searches by name.
 */
export async function verifyTmdb(tmdb: TmdbClient, r: Pick<Row, 'kind' | 'tmdb' | 'imdb' | 'tvdb' | 'path'>): Promise<Verification> {
  const media = r.kind === 'movie' ? 'movie' : 'tv';
  if (!r.tmdb) return { verified: null, mismatch: null, note: 'Jellyfin has no TMDb ID for it.' };
  const j = await tmdb.artwork(media, r.tmdb);
  if (!j) return { verified: null, mismatch: null, note: `TMDb has no ${media === 'movie' ? 'film' : 'show'} ${r.tmdb}.` };
  if (r.imdb && j.imdb === r.imdb) return { verified: { tmdb: r.tmdb, by: 'imdb', art: j }, mismatch: null, note: null };
  if (media === 'tv' && r.tvdb && j.tvdb === r.tvdb) return { verified: { tmdb: r.tmdb, by: 'tvdb', art: j }, mismatch: null, note: null };
  const named = pathNames(r.path, j);
  if (!r.imdb && !(media === 'tv' && r.tvdb)) {
    return named ? { verified: { tmdb: r.tmdb, by: 'path', art: j }, mismatch: null, note: null }
      : { verified: null, mismatch: null, note: 'Its TMDb ID couldn’t be confirmed: Jellyfin has no IMDb or TVDB ID for it, and its folder name doesn’t say.' };
  }
  // They disagree: find the other title by its ID.
  let otherId: string | null = null;
  if (r.imdb) {
    const f = await tmdb.find(r.imdb);
    otherId = f && f.kind === (media === 'movie' ? 'movie' : 'tv') ? f.tmdb : null;
  }
  if (!otherId && media === 'tv' && r.tvdb) otherId = await tmdb.findTvdb(r.tvdb);
  const other = otherId && otherId !== r.tmdb ? await tmdb.artwork(media, otherId) : null;
  if (!other) {
    // The external ID points nowhere else: trust Jellyfin's only if the folder agrees.
    return named ? { verified: { tmdb: r.tmdb, by: 'path', art: j }, mismatch: null, note: null } : { verified: null, mismatch: { jellyfin: j, other: null }, note: null };
  }
  const otherNamed = pathNames(r.path, other);
  if (otherNamed && !named) return { verified: { tmdb: other.id, by: 'path', art: other }, mismatch: { jellyfin: j, other }, note: null };
  if (named && !otherNamed) return { verified: { tmdb: r.tmdb, by: 'path', art: j }, mismatch: null, note: `Its IMDb ID points to ${describe(other)}, but its TMDb ID and folder name agree on ${describe(j)}.` };
  return { verified: null, mismatch: { jellyfin: j, other }, note: null };
}

// ---------------------------------------------------------------------------------------------------------------
// Choosing TMDb images

const textless = (i: TmdbImage) => !i.lang;
const best = (xs: TmdbImage[]) => [...xs].sort(byRating)[0] ?? null;

/** TMDb's best-rated image in the language; else (unless `only`) textless, then the title's original language, then any. */
export function pickImage(list: TmdbImage[], want: string | null, opts: { only?: boolean; original?: string | null; preferTextless?: boolean } = {}): TmdbImage | null {
  const inLang = best(list.filter((i) => sameLanguage(i.lang, want)));
  if (opts.only) return inLang;
  const none = best(list.filter(textless));
  const first = opts.preferTextless ? none ?? inLang : inLang ?? none;
  return first ?? best(list.filter((i) => sameLanguage(i.lang, opts.original))) ?? best(list);
}

const proposalOf = (art: TmdbArtwork, i: TmdbImage | null): ArtworkProposal | null => (i ? { tmdb: art.id, media: art.media, path: i.path, lang: i.lang, w: i.w, h: i.h } : null);

// ---------------------------------------------------------------------------------------------------------------
// Checking

/** What the artwork was checked with: its poster tag and IDs. A change means checking it again. */
export const artworkSig = (r: Pick<Row, 'primaryTag' | 'tmdb' | 'imdb' | 'tvdb'>) => `${r.primaryTag ?? '-'}|${r.tmdb ?? ''}|${r.imdb ?? ''}|${r.tvdb ?? ''}`;

/** The current poster to look at: the saved original when it carries the app's overlays (ADR-039), else Jellyfin's. */
async function currentPoster(app: AppContext, jf: JellyfinClient, r: Row): Promise<Uint8Array | null> {
  const rec = app.db.select().from(overlay).where(eq(overlay.jfId, r.jfId)).get();
  if (rec && rec.appliedTag && rec.appliedTag === r.primaryTag) {
    try { return readOriginal(rec, originalsDir(app)); } catch { /* fall through to Jellyfin's */ }
  }
  return (await jf.primaryThumb(r.jfId, 300))?.bytes ?? null;
}

/** Which TMDb poster this is, trying the likeliest first (the library's language, textless, the original language). */
async function matchPoster(app: AppContext, art: TmdbArtwork, hash: string, want: string | null): Promise<TmdbImage | null> {
  const order: TmdbImage[] = [];
  const seen = new Set<string>();
  const push = (xs: TmdbImage[]) => { for (const x of xs) if (!seen.has(x.path)) { seen.add(x.path); order.push(x); } };
  const top = (f: (i: TmdbImage) => boolean) => art.posters.filter(f).slice(0, 10);
  push(top((i) => sameLanguage(i.lang, want)));
  push(top(textless));
  push(top((i) => sameLanguage(i.lang, art.originalLanguage)));
  push(top((i) => sameLanguage(i.lang, 'en')));
  push(art.posters);
  for (const p of order.slice(0, ARTWORK_LIMITS.thumbsPerTitle)) {
    const h = await tmdbFingerprint(app, p.path);
    if (h && distance(h, hash) <= MATCH_DISTANCE) return p;
  }
  return null;
}

type CheckResult = { found: Found[]; check: Omit<typeof artworkCheck.$inferInsert, 'jfId'> };

/** Check one film's or show's artwork. */
export async function checkTitle(app: AppContext, jf: JellyfinClient, tmdb: TmdbClient | null, r: Row, want: string | null, now: number): Promise<CheckResult> {
  const found: Found[] = [];
  const check: CheckResult['check'] = { sig: artworkSig(r), checkedAt: now, verifiedTmdb: null, verifiedBy: null, poster: null, note: null };
  const v: Verification = tmdb ? await verifyTmdb(tmdb, r) : { verified: null, mismatch: null, note: 'TMDb isn’t connected, so languages and TMDb IDs aren’t checked.' };
  const art = v.verified?.art ?? null;
  check.verifiedTmdb = v.verified?.tmdb ?? null;
  check.verifiedBy = v.verified?.by ?? null;
  check.note = v.note;
  const posterFor = (opts: { only?: boolean } = {}) => (art ? proposalOf(art, pickImage(art.posters, want, { ...opts, original: art.originalLanguage })) : null);

  if (v.mismatch) {
    const { jellyfin: j, other } = v.mismatch;
    found.push({
      kind: 'other_title',
      detail: other
        ? `Jellyfin links it to ${describe(j)}, but its IMDb ID is ${describe(other)}. ${v.verified ? `Its folder name says ${describe(v.verified.art)}, so that’s the one to take artwork from.` : 'Nothing says which is right, so the app won’t replace its artwork: fix the link in Jellyfin (Identify, by ID).'}`
        : `Jellyfin links it to ${describe(j)}, whose IMDb ID isn’t the one Jellyfin has (${r.imdb}). Nothing confirms which is right, so the app won’t replace its artwork.`,
      proposal: v.verified ? posterFor() : null,
    });
  }

  if (!r.primaryTag) {
    check.poster = { source: 'none' };
    found.push({ kind: 'no_poster', detail: 'It has no poster.', proposal: posterFor() });
    return { found, check };
  }
  const bytes = await currentPoster(app, jf, r).catch(() => null);
  if (!bytes) return { found, check };
  const fp = await fingerprint(bytes).catch(() => null);
  if (!fp || !fp.w || !fp.h) return { found, check };
  const aspect = fp.w / fp.h;
  if (aspect >= 1.2) {
    check.poster = { source: 'frame', aspect };
    found.push({ kind: 'video_poster', detail: `The poster is a wide picture (${aspect >= 1.7 ? '16:9' : `${fp.w}×${fp.h}`}), like a frame from the video.`, proposal: posterFor() });
    return { found, check };
  }
  if (!art) { check.poster = { source: 'unknown', aspect }; return { found, check }; }
  const match = await matchPoster(app, art, fp.hash, want);
  if (match) {
    check.poster = { source: 'tmdb', lang: match.lang, path: match.path, aspect };
    if (match.lang && want && !sameLanguage(match.lang, want)) {
      const pref = pickImage(art.posters, want, { only: true });
      if (pref) found.push({ kind: 'language', detail: `The poster is TMDb’s ${languageName(match.lang)} one; TMDb has ${languageName(want)} posters too.`, proposal: proposalOf(art, pref) });
      else check.note = `TMDb has no ${languageName(want)} poster for it, so its ${languageName(match.lang)} one is kept.`;
    }
    return { found, check };
  }
  check.poster = { source: 'unknown', aspect };
  // Not one of TMDb's: from the file? (Films only: a show has no single file.)
  const emb = r.kind === 'movie' ? app.db.select({ e: mediaCheck.embeddedImage }).from(mediaCheck).where(eq(mediaCheck.jfId, r.jfId)).get()?.e ?? null : null;
  if (emb?.via === 'stream' && emb.w && emb.h && Math.abs(emb.w / emb.h - aspect) < 0.02) {
    found.push({ kind: 'video_poster', detail: `The poster isn’t one of TMDb’s for this title, and it’s the same shape as the picture embedded in the file (${emb.w}×${emb.h}).`, proposal: posterFor() });
  } else if (emb?.via === 'attachment') {
    found.push({ kind: 'video_poster', detail: 'The poster isn’t one of TMDb’s for this title, and the file has a picture attached: it may have come from the file.', proposal: posterFor() });
  }
  return { found, check };
}

export type ArtworkStats = { checked: number; found: number; boxSetsChecked: number; autoFixed: number; failed: number };

/** Each library's language: its own, else the server's (read by the health check each run). */
export function libraryLanguages(app: AppContext): (libraryId: string | null | undefined) => string | null {
  const server = (() => { const h = getCached<string | null>(app.db, 'jf-server-language'); return h.hit ? h.value : null; })();
  const libs = new Map(app.db.select({ id: library.id, lang: library.preferredLanguage }).from(library).all().map((l) => [l.id, l.lang]));
  return (id) => (id ? libs.get(id) ?? null : null) ?? server ?? 'en';
}

/** Save what a check found for one item: new findings, updated ones, and ones that no longer hold. */
function saveFindings(app: AppContext, jfId: string, sig: string, found: Found[], now: number, subject?: { name: string; kind: 'boxset' }): number {
  let added = 0;
  const existing = new Map(app.db.select().from(healthFinding).where(and(eq(healthFinding.jfId, jfId), inArray(healthFinding.kind, [...ARTWORK_KINDS]))).all().map((f) => [f.kind, f]));
  for (const f of found) {
    const prev = existing.get(f.kind);
    existing.delete(f.kind);
    if (!prev) {
      app.db.insert(healthFinding).values({ jfId, kind: f.kind, detail: f.detail, sig, firstSeen: now, proposal: f.proposal, subject: subject ?? null }).run();
      added++;
    } else {
      const changed = prev.sig !== sig;
      app.db.update(healthFinding).set({ detail: f.detail, sig, proposal: f.proposal, ...(changed ? { dismissedAt: null, dismissedBy: null, firstSeen: now } : {}) })
        .where(and(eq(healthFinding.jfId, jfId), eq(healthFinding.kind, f.kind))).run();
    }
  }
  for (const gone of existing.values()) app.db.delete(healthFinding).where(and(eq(healthFinding.jfId, jfId), eq(healthFinding.kind, gone.kind))).run();
  return added;
}

/** Box sets the app doesn't manage, linked to a TMDb collection their films don't belong to. Reported only. */
async function checkBoxSets(app: AppContext, jf: JellyfinClient, now: number, out: ArtworkStats): Promise<void> {
  const managed = new Set(app.db.select({ id: managedCollection.jfBoxsetId }).from(managedCollection).all().map((m) => m.id).filter(Boolean));
  const sets = await jf.allItems({ IncludeItemTypes: 'BoxSet', Recursive: true, Fields: 'ProviderIds' });
  const checks = new Map(app.db.select().from(artworkCheck).all().map((c) => [c.jfId, c]));
  const unmanaged = sets.filter((b) => b.Id && !managed.has(b.Id));
  // Box sets that went or became managed take their findings with them.
  const keep = new Set(unmanaged.map((b) => b.Id!));
  for (const f of app.db.select().from(healthFinding).all().filter((f) => f.subject?.kind === 'boxset' && !keep.has(f.jfId))) {
    app.db.delete(healthFinding).where(and(eq(healthFinding.jfId, f.jfId), eq(healthFinding.kind, f.kind))).run();
  }
  let n = 0;
  for (const b of unmanaged) {
    const link = Object.entries(b.ProviderIds ?? {}).find(([k]) => k.toLowerCase() === 'tmdb')?.[1] || null;
    const sig = `boxset|${link ?? ''}|${b.ChildCount ?? 0}`;
    const prev = checks.get(b.Id!);
    if (prev && prev.sig === sig && now - prev.checkedAt < ARTWORK_LIMITS.recheckDays * DAY) continue;
    if (n++ >= ARTWORK_LIMITS.boxSetsPerRun) break;
    const found: Found[] = [];
    if (link) {
      const kids = (await jf.collectionChildren(b.Id!)).map((c) => c.Id).filter((x): x is string => Boolean(x));
      const own = kids.length ? app.db.select({ c: libraryItem.tmdbCollection }).from(libraryItem).where(inArray(libraryItem.jfId, kids)).all().map((r) => r.c).filter((c): c is string => Boolean(c)) : [];
      const norm = (c: string) => SERIES_OF[c] ?? c;
      if (own.length && !own.some((c) => c === link || norm(c) === norm(link))) {
        const counts = new Map<string, number>();
        for (const c of own) counts.set(c, (counts.get(c) ?? 0) + 1);
        const top = [...counts].sort((a, x) => x[1] - a[1])[0]![0];
        found.push({ kind: 'other_title', detail: `Linked to TMDb collection ${link}, but its films belong to TMDb collection ${top}: its artwork and overview may be another collection’s. The app doesn’t change box sets it doesn’t manage: adopt it (Collections → Existing box sets) to have it rebuilt cleanly, or fix it in Jellyfin.`, proposal: null });
      }
    }
    out.found += saveFindings(app, b.Id!, sig, found, now, { name: b.Name ?? 'Box set', kind: 'boxset' });
    const values = { sig, checkedAt: now, verifiedTmdb: null, verifiedBy: null, poster: null, note: null };
    app.db.insert(artworkCheck).values({ jfId: b.Id!, ...values }).onConflictDoUpdate({ target: artworkCheck.jfId, set: values }).run();
    out.boxSetsChecked++;
  }
}

/**
 * Check films' and shows' artwork (new or changed first, then any not checked for a month), and box sets the app
 * doesn't manage. With `apply`, fix "No poster" and "Poster from the video or file" by themselves in the libraries
 * chosen for it. Never fails the run.
 */
export async function checkArtwork(app: AppContext, opts: { now: number; apply: boolean; step?: (s: string) => void }): Promise<ArtworkStats> {
  const out: ArtworkStats = { checked: 0, found: 0, boxSetsChecked: 0, autoFixed: 0, failed: 0 };
  const jf = app.jellyfin();
  if (!jf) return out;
  const tmdb = app.tmdb();
  const langOf = libraryLanguages(app);
  const rows = app.db.select().from(libraryItem).where(inArray(libraryItem.kind, ['movie', 'series'])).all();
  const ids = new Set(rows.map((r) => r.jfId));
  const checks = new Map(app.db.select().from(artworkCheck).all().map((c) => [c.jfId, c]));
  // Titles that left the library take their findings with them.
  for (const f of app.db.select().from(healthFinding).where(inArray(healthFinding.kind, [...ARTWORK_KINDS])).all()) {
    if (!f.subject && !ids.has(f.jfId)) app.db.delete(healthFinding).where(and(eq(healthFinding.jfId, f.jfId), eq(healthFinding.kind, f.kind))).run();
  }
  const due = (r: Row) => { const c = checks.get(r.jfId); return !c ? 3 : c.sig !== artworkSig(r) ? 2 : opts.now - c.checkedAt > ARTWORK_LIMITS.recheckDays * DAY ? 1 : 0; };
  const todo = rows.filter((r) => due(r) > 0).sort((a, b) => due(b) - due(a)).slice(0, ARTWORK_LIMITS.titlesPerRun);
  if (todo.length) opts.step?.(`Checking ${todo.length} posters`);
  for (const r of todo) {
    try {
      const res = await checkTitle(app, jf, tmdb, r, langOf(r.libraryId), opts.now);
      out.found += saveFindings(app, r.jfId, res.check.sig, res.found, opts.now);
      app.db.insert(artworkCheck).values({ jfId: r.jfId, ...res.check }).onConflictDoUpdate({ target: artworkCheck.jfId, set: res.check }).run();
      out.checked++;
    } catch (e) {
      out.failed++;
      log.warn(`Artwork check for ${r.name} failed: ${(e as Error).message}`);
      if (out.failed >= 10) { log.warn('Artwork checks stopped for this run after 10 failures'); break; }
    }
  }
  try {
    await checkBoxSets(app, jf, opts.now, out);
  } catch (e) {
    log.warn(`Box set artwork check failed: ${(e as Error).message}`);
  }
  // Fix what may be fixed without asking, in the libraries chosen for it, while dry run is off.
  const auto = new Set(app.settings().health.autoFixLibraryIds ?? []);
  if (opts.apply && auto.size) {
    const libOf = new Map(rows.map((r) => [r.jfId, r.libraryId]));
    const fixable = app.db.select().from(healthFinding).all().filter((f) => !f.dismissedAt && f.proposal && (f.kind === 'no_poster' || f.kind === 'video_poster') && auto.has(libOf.get(f.jfId) ?? ''));
    for (const f of fixable.slice(0, ARTWORK_LIMITS.autoFixesPerRun)) {
      const r = await resetArtwork(app, f.jfId, { by: 'automatic' });
      if (r.ok) out.autoFixed++; else log.warn(`Automatic artwork fix skipped: ${r.message}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Fixing and undoing

export const IMAGE_TYPES = ['Primary', 'Backdrop', 'Logo', 'Thumb'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];
export const backupsDir = (app: AppContext) => join(app.config.configDir, 'artwork', 'backups');

const imageType = (ct: string) => (ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg');

/** Download a TMDb image at full size and make sure it's a picture. */
async function tmdbImage(app: AppContext, path: string): Promise<{ bytes: Uint8Array; type: string }> {
  const res = await app.fetch(`${IMG}/original${path}`);
  if (!res.ok) throw new Error(`TMDb’s image server answered ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const sharp = await loadSharp();
  const meta = await sharp(bytes).metadata().catch(() => null);
  if (!meta?.width || !meta.height || !['jpeg', 'png', 'webp'].includes(meta.format ?? '')) throw new Error('TMDb’s image isn’t a picture');
  return { bytes, type: meta.format === 'png' ? 'image/png' : meta.format === 'webp' ? 'image/webp' : 'image/jpeg' };
}

export type ResetResult = { ok: boolean; message: string; fixId?: number };

/**
 * Reset an item's artwork from TMDb (ADR-043), by its confirmed TMDb ID only. Re-reads the item and confirms the ID
 * again first; stops (leaving the finding) if anything changed. Backs up what it replaces, uploads TMDb's images,
 * re-reads the item and records the result. `types`: the poster always; backdrop, logo and thumb if asked.
 */
export async function resetArtwork(app: AppContext, jfId: string, opts: { by: string; types?: ImageType[] }): Promise<ResetResult> {
  const jf = app.jellyfin();
  const tmdb = app.tmdb();
  if (!jf) return { ok: false, message: 'Jellyfin isn’t connected.' };
  if (!tmdb) return { ok: false, message: 'TMDb isn’t connected (Settings → Connections).' };
  const r = app.db.select().from(libraryItem).where(eq(libraryItem.jfId, jfId)).get();
  const findings = app.db.select().from(healthFinding).where(and(eq(healthFinding.jfId, jfId), inArray(healthFinding.kind, [...ARTWORK_KINDS]))).all();
  if (!r || r.kind === 'episode') return { ok: false, message: findings[0]?.subject ? 'The app doesn’t change box sets it doesn’t manage: adopt it instead.' : 'That title isn’t in the library index.' };
  const check = app.db.select().from(artworkCheck).where(eq(artworkCheck.jfId, jfId)).get();
  if (!check?.verifiedTmdb) return { ok: false, message: `${r.name}: its TMDb ID isn’t confirmed, so the app won’t take artwork for it from TMDb.` };

  // 1. The item as it is now: same poster and IDs as when it was checked?
  const item = await jf.getItem(jfId);
  if (!item) return { ok: false, message: `${r.name} is gone from Jellyfin.` };
  const pid = (k: string) => Object.entries(item.ProviderIds ?? {}).find(([x]) => x.toLowerCase() === k)?.[1] || null;
  const nowRow = { ...r, primaryTag: item.ImageTags?.Primary ?? null, tmdb: pid('tmdb'), imdb: pid('imdb'), tvdb: pid('tvdb') };
  if (artworkSig(nowRow) !== check.sig) return { ok: false, message: `${r.name}: its poster or IDs changed in Jellyfin since it was checked. It’s checked again on the next run.` };
  // 2. The TMDb ID, confirmed again.
  const v = await verifyTmdb(tmdb, nowRow);
  if (v.verified?.tmdb !== check.verifiedTmdb) return { ok: false, message: `${r.name}: its TMDb ID no longer checks out, so nothing was changed. It stays on the list.` };
  const art = v.verified.art;
  const want = libraryLanguages(app)(r.libraryId);
  const kind = (['language', 'other_title', 'video_poster', 'no_poster'] as const).find((k) => findings.some((f) => f.kind === k)) ?? 'no_poster';

  // 3. Which images.
  const types = [...new Set<ImageType>(['Primary', ...(opts.types ?? [])])];
  const picks: Partial<Record<ImageType, TmdbImage>> = {};
  picks.Primary = (kind === 'language' ? pickImage(art.posters, want, { only: true }) : null) ?? pickImage(art.posters, want, { original: art.originalLanguage }) ?? undefined;
  if (!picks.Primary) return { ok: false, message: `${r.name}: TMDb has no poster for ${describe(art)}.` };
  if (types.includes('Backdrop')) picks.Backdrop = pickImage(art.backdrops, want, { preferTextless: true, original: art.originalLanguage }) ?? undefined;
  if (types.includes('Logo')) picks.Logo = pickImage(art.logos, want, { original: art.originalLanguage }) ?? undefined;
  if (types.includes('Thumb')) picks.Thumb = pickImage(art.backdrops.filter((b) => b.lang), want, { only: true }) ?? undefined; // a backdrop with the title on it

  // 4. Download first, so nothing is changed if TMDb can't be read.
  const got: Partial<Record<ImageType, { bytes: Uint8Array; type: string }>> = {};
  for (const [t, img] of Object.entries(picks) as [ImageType, TmdbImage][]) got[t] = await tmdbImage(app, img.path);

  // 5. Back up what's there now.
  const at = Date.now();
  const dir = join(backupsDir(app), `${jfId}-${at}`);
  mkdirSync(dir, { recursive: true });
  const backups: Record<string, string[]> = {};
  // A poster carrying the app's overlays is backed up as its saved original (ADR-039), so an undo puts back a clean
  // poster, which the overlays then go back on.
  const rec = app.db.select().from(overlay).where(eq(overlay.jfId, jfId)).get();
  const overlaid = rec && rec.appliedTag && rec.appliedTag === item.ImageTags?.Primary ? (() => { try { return readOriginal(rec, originalsDir(app)); } catch { return null; } })() : null;
  for (const t of Object.keys(got) as ImageType[]) {
    backups[t] = [];
    const count = t === 'Backdrop' ? item.BackdropImageTags?.length ?? 0 : item.ImageTags?.[t] ? 1 : 0;
    for (let i = 0; i < count; i++) {
      const img = t === 'Primary' && overlaid ? { bytes: overlaid, contentType: rec!.contentType } : await jf.downloadImage(jfId, t, t === 'Backdrop' ? i : undefined);
      if (!img) continue;
      const file = join(`${jfId}-${at}`, `${t.toLowerCase()}${t === 'Backdrop' ? `-${i}` : ''}.${imageType(img.contentType)}`);
      writeFileSync(join(backupsDir(app), file), img.bytes);
      backups[t]!.push(file);
    }
  }

  // 6. Replace.
  for (const [t, img] of Object.entries(got) as [ImageType, { bytes: Uint8Array; type: string }][]) {
    if (t === 'Backdrop') for (let i = (item.BackdropImageTags?.length ?? 0) - 1; i >= 0; i--) await jf.deleteImage(jfId, 'Backdrop', i);
    await jf.uploadImage(jfId, t, img.bytes, img.type);
  }

  // 7. Re-read, record and report.
  const after = await jf.getItem(jfId);
  const tag = after?.ImageTags?.Primary ?? null;
  app.db.update(libraryItem).set({ primaryTag: tag }).where(eq(libraryItem.jfId, jfId)).run();
  const p = picks.Primary;
  const values = { sig: artworkSig({ ...nowRow, primaryTag: tag }), checkedAt: at, verifiedTmdb: art.id, verifiedBy: v.verified.by, poster: { source: 'tmdb' as const, lang: p.lang, path: p.path, aspect: p.w && p.h ? p.w / p.h : null }, note: null };
  app.db.update(artworkCheck).set(values).where(eq(artworkCheck.jfId, jfId)).run();
  app.db.delete(healthFinding).where(and(eq(healthFinding.jfId, jfId), inArray(healthFinding.kind, [...ARTWORK_KINDS]))).run();
  const lang = (i: TmdbImage) => (i.lang ? `${languageName(i.lang)} ` : 'textless ');
  const what = (Object.entries(picks) as [ImageType, TmdbImage][]).map(([t, i]) => `${t === 'Primary' ? 'poster' : t.toLowerCase()}: TMDb’s ${lang(i)}${t === 'Primary' ? 'poster' : 'image'} (${i.w}×${i.h})`).join('; ');
  const title = `${r.name}${r.year ? ` (${r.year})` : ''}`;
  const fix = app.db.insert(artworkFix).values({ at, jfId, title, kind, by: opts.by, tmdb: art.id, what, backups }).returning({ id: artworkFix.id }).get();
  log.info(`Artwork reset from ${describe(art)} for ${title} by ${opts.by}: ${what}`);
  return { ok: true, message: `${title}: ${what}.${tag ? '' : ' Jellyfin hasn’t shown the new poster yet; it’s checked again on the next run.'}`, fixId: fix.id };
}

/** Put back the images a fix replaced, from its backups (an image there wasn't is removed again). */
export async function undoArtworkFix(app: AppContext, id: number, by: string): Promise<ResetResult> {
  const jf = app.jellyfin();
  if (!jf) return { ok: false, message: 'Jellyfin isn’t connected.' };
  const fix = app.db.select().from(artworkFix).where(eq(artworkFix.id, id)).get();
  if (!fix) return { ok: false, message: 'No such fix.' };
  if (fix.undoneAt) return { ok: false, message: `${fix.title}: already put back.` };
  const item = await jf.getItem(fix.jfId);
  if (!item) return { ok: false, message: `${fix.title} is gone from Jellyfin.` };
  for (const [t, files] of Object.entries(fix.backups)) {
    const missing = files.filter((f) => !existsSync(join(backupsDir(app), f)));
    if (missing.length) return { ok: false, message: `${fix.title}: a backup is missing (${missing[0]}), so nothing was changed.` };
    if (t === 'Backdrop') for (let i = (item.BackdropImageTags?.length ?? 0) - 1; i >= 0; i--) await jf.deleteImage(fix.jfId, 'Backdrop', i);
    else if (!files.length && item.ImageTags?.[t]) await jf.deleteImage(fix.jfId, t);
    for (const f of files) {
      const bytes = new Uint8Array(readFileSync(join(backupsDir(app), f)));
      await jf.uploadImage(fix.jfId, t, bytes, f.endsWith('.png') ? 'image/png' : f.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
    }
  }
  const after = await jf.getItem(fix.jfId);
  app.db.update(libraryItem).set({ primaryTag: after?.ImageTags?.Primary ?? null }).where(eq(libraryItem.jfId, fix.jfId)).run();
  app.db.update(artworkFix).set({ undoneAt: Date.now(), undoneBy: by }).where(eq(artworkFix.id, id)).run();
  log.info(`Artwork fix for ${fix.title} undone by ${by}`);
  return { ok: true, message: `${fix.title}: the old artwork is back. It’s checked again on the next run.` };
}

/** Recent fixes, newest first, for the Library health page and Claude. */
export const recentFixes = (app: AppContext, days = 30) =>
  app.db.select().from(artworkFix).all().filter((f) => f.at > Date.now() - days * DAY).sort((a, b) => b.at - a.at);

/** The first backed-up poster of a fix (for the page's "before" thumbnail), or null. */
export function backupPoster(app: AppContext, id: number): { bytes: Uint8Array; type: string } | null {
  const fix = app.db.select().from(artworkFix).where(eq(artworkFix.id, id)).get();
  const f = fix?.backups.Primary?.[0];
  if (!f || !existsSync(join(backupsDir(app), f))) return null;
  return { bytes: new Uint8Array(readFileSync(join(backupsDir(app), f))), type: f.endsWith('.png') ? 'image/png' : f.endsWith('.webp') ? 'image/webp' : 'image/jpeg' };
}


export type ArtworkSummary = {
  /** Films and shows, and how many have had their artwork checked as it is now. */
  titles: number; checked: number;
  /** Fixes in the last 30 days, newest first. */
  fixes: (typeof artworkFix.$inferSelect)[];
  /** Repairs to the app's own box sets in the last 30 days (ADR-040's nightly check). */
  collectionRepairs: { at: number; name: string; what: string; ok: boolean }[];
  /** Libraries where "No poster" and "Poster from the video or file" are fixed without asking. */
  autoFix: string[];
};

/** The artwork side of the Library health page. */
export function artworkSummary(app: AppContext): ArtworkSummary {
  const rows = app.db.select().from(libraryItem).where(inArray(libraryItem.kind, ['movie', 'series'])).all();
  const checks = new Map(app.db.select({ id: artworkCheck.jfId, sig: artworkCheck.sig }).from(artworkCheck).all().map((c) => [c.id, c.sig]));
  const since = Date.now() - 30 * DAY;
  const events = app.db.select().from(integrityEvent).all().filter((e) => e.at > since).sort((a, b) => b.at - a.at);
  const libs = new Map(app.db.select({ id: library.id, name: library.name }).from(library).all().map((l) => [l.id, l.name]));
  return {
    titles: rows.length, checked: rows.filter((r) => checks.get(r.jfId) === artworkSig(r)).length,
    fixes: recentFixes(app),
    collectionRepairs: events.map((e) => ({ at: e.at, name: e.name, what: e.what, ok: e.ok })),
    autoFix: (app.settings().health.autoFixLibraryIds ?? []).map((id) => libs.get(id) ?? id),
  };
}
