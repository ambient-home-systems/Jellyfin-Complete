// The optional read-only media mount, and frames from the middle of a file (ADR-044).
//
// Mount: off by default. With the media folder mounted read-only (e.g. /srv/media:/media:ro) and turned on in
// Settings, the app reads each new file's own container title (container.ts). Jellyfin's paths are mapped to the mount
// by finding a few known files under it, so the folders needn't be named the same. Files are only ever opened for
// reading, and never outside the mount.
//
// Frames: one frame from the middle of a file, for findings on the Library health page, hidden until asked for. Taken
// from Jellyfin's own trickplay previews when it has made them (no mount, no ffmpeg), else with ffmpeg from the
// mounted file when an ffmpeg binary is available (FFMPEG_PATH, or ffmpeg on the PATH; the image doesn't ship one).
// Kept in /config/frames.
import { accessSync, constants, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, join, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../app-context.js';
import { mediaCheck } from '../db/schema.js';
import { getCached, putCached } from '../cache.js';
import { loadSharp } from '../overlays/render.js';
import { log } from '../log.js';

export type MediaMap = { from: string; to: string };
const slashes = (p: string) => p.replace(/\\/g, '/');

/** A Jellyfin path's place under the mount, or null if it isn't under the mapped folder (never outside the mount). */
export function mapPath(jellyfinPath: string, dir: string, map: MediaMap | null): string | null {
  if (!map) return null;
  const p = slashes(jellyfinPath);
  const from = map.from.replace(/\/+$/, '');
  if (from && p !== from && !p.startsWith(`${from}/`)) return null;
  const full = resolve(map.to, p.slice(from.length).replace(/^\/+/, ''));
  const root = resolve(dir);
  return full === root || full.startsWith(root + sep) ? full : null;
}

const isFile = (p: string) => { try { return statSync(p).isFile(); } catch { return false; } };

/**
 * Work out where Jellyfin's files are under the mount: for each sample path, the shortest tail of it that exists
 * under the mount ("/data/movies/Heat (1995)/Heat.mkv" found as "/media/movies/Heat (1995)/Heat.mkv" maps "/data" to
 * "/media"). The answer most samples agree on wins.
 */
export function detectMapping(dir: string, samples: string[]): MediaMap | null {
  const votes = new Map<string, number>();
  for (const s of samples.slice(0, 25)) {
    const p = slashes(s);
    const segs = p.split('/').filter(Boolean);
    for (let k = 0; k < segs.length; k++) {
      const tail = segs.slice(k).join('/');
      if (!isFile(join(dir, tail))) continue;
      const from = p.slice(0, p.length - tail.length).replace(/\/+$/, '');
      votes.set(from, (votes.get(from) ?? 0) + 1);
      break;
    }
  }
  const best = [...votes].sort((a, b) => b[1] - a[1])[0];
  return best ? { from: best[0], to: resolve(dir) } : null;
}

/** An ffmpeg the app may run: FFMPEG_PATH, else ffmpeg on the PATH. Null if there's none. */
export function ffmpegPath(env: NodeJS.ProcessEnv = process.env): string | null {
  const exe = (p: string) => { try { accessSync(p, constants.X_OK); return statSync(p).isFile(); } catch { return false; } };
  if (env.FFMPEG_PATH) return exe(env.FFMPEG_PATH) ? env.FFMPEG_PATH : null;
  for (const d of (env.PATH ?? '').split(delimiter).filter(Boolean)) if (exe(join(d, 'ffmpeg'))) return join(d, 'ffmpeg');
  return null;
}

export type MediaStatus = {
  enabled: boolean; dir: string;
  /** The folder exists in the container and can be listed. */
  mounted: boolean;
  map: MediaMap | null;
  ffmpeg: string | null;
  /** Files whose own title has been read, and files that couldn't be read (moved, or not readable by the app's user). */
  read: number; unreadable: number;
  /** Anything to say about it, in words. */
  note: string | null;
};

export function mediaStatus(app: AppContext): MediaStatus {
  const m = app.settings().media;
  let mounted = false;
  try { mounted = statSync(m.dir).isDirectory() && (readdirSync(m.dir), true); } catch { mounted = false; }
  const counts = app.db.$client.prepare('select sum(container_read = 1) r, sum(container_read = 2) u from media_check').get() as { r: number | null; u: number | null };
  const note = (() => { const h = getCached<string | null>(app.db, 'media-note'); return h.hit ? h.value : null; })();
  return { enabled: m.enabled, dir: m.dir, mounted, map: m.map, ffmpeg: ffmpegPath(), read: counts.r ?? 0, unreadable: counts.u ?? 0, note };
}

/** Remember something to say about the mount on the Settings page (or clear it). */
export const setMediaNote = (app: AppContext, note: string | null) => putCached(app.db, 'media-note', note, 3650);

// ---------------------------------------------------------------------------------------------------------------
// Frames

export const framesDir = (app: AppContext) => join(app.config.configDir, 'frames');
const sigHash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 12);

/** Can a frame be had for this file: Jellyfin has trickplay previews of it, or ffmpeg can read it from the mount. */
export function frameAvailable(app: AppContext, row: { trickplay: boolean | null; path: string | null }): boolean {
  if (row.trickplay) return true;
  const m = app.settings().media;
  return Boolean(m.enabled && row.path && mapPath(row.path, m.dir, m.map) && ffmpegPath());
}

/** One frame from Jellyfin's trickplay previews, at the middle of the file. */
async function trickplayFrame(app: AppContext, jfId: string): Promise<Uint8Array | null> {
  const jf = app.jellyfin();
  if (!jf) return null;
  const tp = await jf.trickplay(jfId);
  if (!tp) return null;
  const { info, width, mediaSourceId, durationTicks } = tp;
  if (!info.Interval || !info.Width || !info.Height || !info.TileWidth || !info.TileHeight) return null;
  const count = info.ThumbnailCount ?? Infinity;
  const index = Math.max(0, Math.min(Math.floor(durationTicks / 10_000 / 2 / info.Interval), count - 1));
  const perTile = info.TileWidth * info.TileHeight;
  const tile = await jf.trickplayTile(jfId, width, Math.floor(index / perTile), mediaSourceId);
  if (!tile) return null;
  const at = index % perTile;
  const sharp = await loadSharp();
  const meta = await sharp(tile).metadata();
  const left = (at % info.TileWidth) * info.Width, top = Math.floor(at / info.TileWidth) * info.Height;
  if (!meta.width || !meta.height || left + info.Width > meta.width || top + info.Height > meta.height) return null;
  return new Uint8Array(await sharp(tile).extract({ left, top, width: info.Width, height: info.Height }).jpeg({ quality: 85 }).toBuffer());
}

/** One frame with ffmpeg, from the mounted file. Read-only; given up after 30 seconds. */
function ffmpegFrame(ffmpeg: string, file: string, atSeconds: number): Promise<Uint8Array | null> {
  return new Promise((done) => {
    execFile(ffmpeg, ['-nostdin', '-hide_banner', '-loglevel', 'error', '-ss', String(Math.max(0, Math.round(atSeconds))), '-i', file, '-frames:v', '1', '-vf', 'scale=480:-2', '-f', 'image2', '-c:v', 'mjpeg', 'pipe:1'],
      { timeout: 30_000, maxBuffer: 8 * 1024 * 1024, encoding: 'buffer' }, (err, stdout) => done(err || !stdout.length ? null : new Uint8Array(stdout)));
  });
}

/**
 * A frame from the middle of a film or episode, for the Library health page: from Jellyfin's trickplay previews if it
 * has them, else ffmpeg on the mounted file. Kept in /config/frames until the file changes. Null if neither is possible.
 */
export async function middleFrame(app: AppContext, jfId: string): Promise<{ bytes: Uint8Array; type: string } | null> {
  const c = app.db.select().from(mediaCheck).where(eq(mediaCheck.jfId, jfId)).get();
  if (!c) return null;
  const dir = framesDir(app);
  const file = join(dir, `${jfId.replace(/[^A-Za-z0-9_-]/g, '')}-${sigHash(c.sig)}.jpg`);
  if (existsSync(file)) return { bytes: new Uint8Array(readFileSync(file)), type: 'image/jpeg' };
  let bytes: Uint8Array | null = null;
  try {
    if (c.trickplay) bytes = await trickplayFrame(app, jfId);
    const m = app.settings().media;
    const ffmpeg = bytes ? null : ffmpegPath();
    const mapped = c.path && m.enabled ? mapPath(c.path, m.dir, m.map) : null;
    if (!bytes && ffmpeg && mapped && isFile(mapped)) bytes = await ffmpegFrame(ffmpeg, mapped, ((c.durationMin ?? 0) * 60) / 2);
  } catch (e) {
    log.warn(`Couldn’t get a frame of ${jfId}: ${(e as Error).message}`);
  }
  if (!bytes) return null;
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, bytes);
  return { bytes, type: 'image/jpeg' };
}
