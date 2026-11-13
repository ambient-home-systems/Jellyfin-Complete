// Poster overlays from the Settings page and Claude (ADR-039): what's planned, previews, and starting a run that changes
// posters even in dry run (the approval).
import { inArray } from 'drizzle-orm';
import type { AppContext } from '../app-context.js';
import { library, libraryItem } from '../db/schema.js';
import { kidsLibraries, overlaySkipped } from '../overlays/badges.js';
import { isRunning, runPipeline } from '../pipeline/run.js';
import { planOverlays, originalsDir, readOriginal } from '../overlays/sync.js';
import { BADGE_LABEL, renderOverlay, type Badge } from '../overlays/render.js';
import { log } from '../log.js';
import type { OverlaysModel } from './pages/overlays.js';

const label = (b: Badge[]) => b.map((x) => BADGE_LABEL[x]).join(' · ');

/** The libraries collections draw from, each with whether it gets overlays. */
export function overlayLibraries(app: AppContext): Pick<OverlaysModel, 'libraries' | 'libraryDefault'> {
  const s = app.settings();
  const kids = kidsLibraries(app);
  const skip = overlaySkipped(app);
  const libs = app.db.select().from(library).all().filter((l) => (l.collectionType === 'movies' && (s.movieLibraryIds ?? [l.id]).includes(l.id)) || (l.collectionType === 'tvshows' && (s.showLibraryIds ?? [l.id]).includes(l.id)));
  return {
    libraries: libs.sort((a, b) => a.name.localeCompare(b.name)).map((l) => ({ id: l.id, name: l.name, kids: kids.has(l.id), on: !skip.has(l.id) })),
    libraryDefault: !s.overlays.skipLibraryIds,
  };
}

export async function overlaysModel(app: AppContext): Promise<OverlaysModel> {
  const s = app.settings();
  const plan = await planOverlays(app, { now: Date.now(), network: false });
  // Previews: one title for each different set of badges, up to four.
  const seen = new Set<string>();
  const picks: { id: string; badges: Badge[] }[] = [];
  for (const id of plan.ids) {
    const b = plan.target(id);
    if (!b.length || seen.has(b.join())) continue;
    seen.add(b.join());
    picks.push({ id, badges: b });
    if (picks.length === 4) break;
  }
  const names = new Map(picks.length ? app.db.select({ id: libraryItem.jfId, name: libraryItem.name }).from(libraryItem).where(inArray(libraryItem.jfId, picks.map((p) => p.id))).all().map((r) => [r.id, r.name]) : []);
  return {
    status: s.overlays.status, imdbTop250: s.overlays.imdbTop250, dryRun: s.dryRun,
    withOverlays: plan.records.size, toChange: plan.changes.length, running: isRunning(),
    samples: picks.map((p) => ({ id: p.id, name: names.get(p.id) ?? p.id, badges: label(p.badges) })),
    ...overlayLibraries(app),
  };
}

/** The poster as it would look, drawn on its original (the saved one if it already has overlays). Null if it gets no badges or has no poster. */
export async function overlayPreview(app: AppContext, jfId: string): Promise<Uint8Array | null> {
  const plan = await planOverlays(app, { now: Date.now(), network: false });
  const badges = plan.target(jfId);
  if (!badges.length) return null;
  const rec = plan.records.get(jfId);
  let original: Uint8Array | null = rec ? readOriginal(rec, originalsDir(app)) : null;
  if (!original) {
    const jf = app.jellyfin();
    if (!jf) throw new Error('Jellyfin is not connected');
    original = (await jf.downloadPrimaryImage(jfId))?.bytes ?? null;
  }
  return original ? renderOverlay(original, badges) : null;
}

/** Start a run that changes poster overlays now, even in dry run. "remove" turns every overlay off first, putting the originals back. */
export function startOverlayRun(app: AppContext, what: 'apply' | 'remove'): { ok: true } | { ok: false; error: string } {
  if (isRunning()) return { ok: false, error: 'A run is in progress. Try again when it has finished.' };
  if (!app.jellyfin()) return { ok: false, error: 'Jellyfin is not connected yet (Settings → Connections).' };
  if (what === 'remove') app.updateSettings({ overlays: { status: false, imdbTop250: false } });
  runPipeline(app, { job: what === 'remove' ? 'remove-overlays' : 'apply-overlays', trigger: 'manual', index: true, applyOverlays: true })
    .catch((e: Error) => log.error(`Poster overlay run failed: ${e.message}`));
  return { ok: true };
}
