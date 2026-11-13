// Put overlays on posters, keep them up to date, and take them off again (ADR-039). The rules that keep originals safe:
// 1. A poster's original is saved to /config/overlays/originals before anything is uploaded, and a record is written
//    before the upload (with the new image's hash), so a crash mid-upload is recognised on the next run.
// 2. Overlays are always drawn on the saved original, never on an overlaid poster.
// 3. An image is never taken for an original if it's one of the app's own: same hash as the last upload, or carrying
//    the app's EXIF marker. A marked poster with no saved original is left alone and reported.
// 4. If Jellyfin's poster changed since the app's upload (a metadata refresh, or a new poster chosen), the new poster
//    becomes the original and the overlays are drawn on it again.
// 5. Taking overlays off uploads the saved original back, then deletes it.
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import type { AppContext } from '../app-context.js';
import { libraryItem, overlay } from '../db/schema.js';
import type { SourceContext } from '../sources/index.js';
import { log } from '../log.js';
import { desiredBadges } from './badges.js';
import { hasMarker, renderOverlay, sha256, type Badge } from './render.js';

export const OVERLAY_CHANGES_PER_RUN = 500;

export type OverlayStats = {
  /** Posters whose badges differ from what they should carry (before checking Jellyfin). */
  toChange: number;
  added: number;
  updated: number;
  removed: number;
  /** Posters changed in Jellyfin since the app's upload, redone on the new poster. */
  replaced: number;
  failed: number;
  skipped: number;
  /** Changes left for the next run (over the cap). */
  waiting: number;
  withOverlays: number;
};

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const ext = (type: string) => (type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg');

export const originalsDir = (app: AppContext) => join(app.config.configDir, 'overlays', 'originals');
export const overlayCount = (app: AppContext): number => app.db.select({ id: overlay.jfId }).from(overlay).all().length;

let busy = false;

export type OverlayPlan = {
  records: Map<string, typeof overlay.$inferSelect>;
  /** The badges a title should carry. */
  target: (jfId: string) => Badge[];
  /** Titles whose badges differ from what they carry now. */
  changes: string[];
  /** Every title that should carry badges or carries them now. */
  ids: string[];
};

/** What should change. With `network: false` nothing is fetched (for the Settings page and previews). */
export async function planOverlays(app: AppContext, opts: { now: number; network: boolean; ctx?: SourceContext }): Promise<OverlayPlan> {
  const records = new Map(app.db.select().from(overlay).all().map((r) => [r.jfId, r]));
  const s = app.settings();
  if (!s.overlays.status && !s.overlays.imdbTop250 && !records.size) return { records, target: () => [], changes: [], ids: [] };
  const want = await desiredBadges(app, { now: opts.now, network: opts.network, ctx: opts.ctx });
  const kindOf = new Map<string, 'movie' | 'series'>();
  if (want.ribbonUnknown.size && records.size) {
    for (const r of app.db.select({ id: libraryItem.jfId, kind: libraryItem.kind }).from(libraryItem).where(inArray(libraryItem.jfId, [...records.keys()])).all()) kindOf.set(r.id, r.kind as 'movie' | 'series');
  }
  const target = (jfId: string): Badge[] => {
    let b = want.desired.get(jfId) ?? [];
    // A chart that couldn't be read keeps the ribbons that are already there.
    const kind = kindOf.get(jfId);
    if (kind && want.ribbonUnknown.has(kind) && (records.get(jfId)?.badges ?? []).includes('ribbon:imdb_top_250') && !b.includes('ribbon:imdb_top_250')) b = [...b, 'ribbon:imdb_top_250'];
    return b;
  };
  const ids = [...new Set([...want.desired.keys(), ...records.keys()])];
  return { records, target, ids, changes: ids.filter((id) => !same(target(id), records.get(id)?.badges ?? [])) };
}

/**
 * Work out which posters need changing and, with `apply`, change them (at most `cap` a run). Without `apply` nothing in
 * Jellyfin or on disk changes: dry run, or a preview of what a run would do.
 */
export async function syncOverlays(app: AppContext, opts: { now: number; apply: boolean; ctx?: SourceContext; cap?: number; step?: (s: string) => void }): Promise<OverlayStats> {
  const stats: OverlayStats = { toChange: 0, added: 0, updated: 0, removed: 0, replaced: 0, failed: 0, skipped: 0, waiting: 0, withOverlays: 0 };
  const { records, target, changes } = await planOverlays(app, { now: opts.now, network: true, ctx: opts.ctx });
  stats.toChange = changes.length;
  stats.withOverlays = records.size;
  if (!opts.apply) return stats;
  if (busy) throw new Error('Poster overlays are already being updated');
  const jf = app.jellyfin();
  if (!jf) throw new Error('Jellyfin is not connected yet');
  busy = true;
  try {
    const dir = originalsDir(app);
    mkdirSync(dir, { recursive: true });
    // Every poster the app has touched is checked against Jellyfin, so replaced ones are redone even if their badges didn't change.
    const tags = await jf.posterTags([...new Set([...changes, ...records.keys()])]);
    const work = [...new Set([...changes, ...[...records.values()].filter((r) => tags.has(r.jfId) && tags.get(r.jfId) !== r.appliedTag).map((r) => r.jfId)])];
    const cap = opts.cap ?? OVERLAY_CHANGES_PER_RUN;
    stats.waiting = Math.max(0, work.length - cap);
    let done = 0;
    for (const jfId of work.slice(0, cap)) {
      if (++done % 50 === 0) opts.step?.(`Updating poster overlays (${done} of ${Math.min(work.length, cap)})`);
      try {
        const outcome = await syncOne(app, jfId, target(jfId), records.get(jfId), tags, dir);
        if (outcome) stats[outcome]++;
      } catch (e) {
        stats.failed++;
        log.warn(`Poster overlay for ${jfId} failed: ${(e as Error).message}`);
        if (stats.failed >= 10 && stats.failed > done / 2) {
          log.warn('Poster overlays stopped for this run after repeated failures');
          break;
        }
      }
    }
    stats.withOverlays = overlayCount(app);
    return stats;
  } finally {
    busy = false;
  }
}

type Outcome = 'added' | 'updated' | 'removed' | 'replaced' | 'skipped' | null;

async function syncOne(app: AppContext, jfId: string, badges: Badge[], rec: typeof overlay.$inferSelect | undefined, tags: Map<string, string | null>, dir: string): Promise<Outcome> {
  const jf = app.jellyfin()!;
  if (!tags.has(jfId)) {
    // Gone from Jellyfin: nothing to put back on. Forget it.
    if (rec) forget(app, rec, dir);
    return rec ? 'removed' : null;
  }
  const tag = tags.get(jfId) ?? null;
  if (!tag) {
    // No poster now (someone removed it): don't put one back.
    if (rec) forget(app, rec, dir);
    return rec ? 'removed' : 'skipped';
  }

  let replaced = false;
  if (rec && tag !== rec.appliedTag) {
    // Changed since the upload, or the upload's tag was never recorded. Is the image there the app's own?
    const now = await jf.downloadPrimaryImage(jfId);
    if (!now) return null;
    if (sha256(now.bytes) === rec.appliedHash || (await hasMarker(now.bytes))) {
      app.db.update(overlay).set({ appliedTag: tag }).where(eq(overlay.jfId, jfId)).run();
      rec = { ...rec, appliedTag: tag };
    } else {
      // A new poster: it becomes the original.
      writeFileSync(join(dir, rec.file), now.bytes);
      app.db.update(overlay).set({ contentType: now.contentType, originalTag: tag, appliedTag: tag, updatedAt: Date.now() }).where(eq(overlay.jfId, jfId)).run();
      rec = { ...rec, contentType: now.contentType, originalTag: tag, appliedTag: tag };
      replaced = true;
      if (!badges.length) { forget(app, rec, dir); return 'replaced'; }
    }
  }

  if (!badges.length) {
    if (!rec) return null;
    if (same(rec.badges, []) || replaced) return null;
    const original = readOriginal(rec, dir);
    await jf.uploadPrimaryImage(jfId, original, rec.contentType);
    forget(app, rec, dir);
    return 'removed';
  }

  if (rec && !replaced && same(rec.badges, badges)) return null; // only its tag needed recording

  let original: Uint8Array;
  let contentType: string;
  let file: string;
  if (rec) {
    original = readOriginal(rec, dir);
    contentType = rec.contentType;
    file = rec.file;
  } else {
    const img = await jf.downloadPrimaryImage(jfId);
    if (!img) return 'skipped';
    if (await hasMarker(img.bytes)) {
      log.warn(`Poster for ${jfId} already has this app's overlays but its original isn't saved (was /config restored from an older backup?). Left alone.`);
      return 'skipped';
    }
    original = img.bytes;
    contentType = img.contentType;
    file = `${jfId}.${ext(contentType)}`;
    writeFileSync(join(dir, file), original);
  }
  const composed = await renderOverlay(original, badges);
  const values = { badges, file, contentType, originalTag: rec?.originalTag ?? tag, appliedTag: null, appliedHash: sha256(composed), updatedAt: Date.now() };
  app.db.insert(overlay).values({ jfId, ...values }).onConflictDoUpdate({ target: overlay.jfId, set: values }).run();
  await jf.uploadPrimaryImage(jfId, composed, 'image/jpeg');
  const after = (await jf.posterTags([jfId])).get(jfId) ?? null;
  app.db.update(overlay).set({ appliedTag: after }).where(eq(overlay.jfId, jfId)).run();
  return replaced ? 'replaced' : rec ? 'updated' : 'added';
}

export function readOriginal(rec: typeof overlay.$inferSelect, dir: string): Uint8Array {
  const path = join(dir, rec.file);
  if (!existsSync(path)) throw new Error(`the saved original (${rec.file}) is missing`);
  return new Uint8Array(readFileSync(path));
}

function forget(app: AppContext, rec: typeof overlay.$inferSelect, dir: string): void {
  app.db.delete(overlay).where(eq(overlay.jfId, rec.jfId)).run();
  rmSync(join(dir, rec.file), { force: true });
}
