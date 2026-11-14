// Collection posters (ADR-042): an image address, an image uploaded to /config/posters, one of the presets' own that
// ship in the image (ADR-045), or none. The app reads the
// poster and uploads it to the box set itself (ADR-040), so whatever's chosen here is the only poster a managed box set
// carries. Uploads and addresses are checked: JPEG, PNG or WebP, at most 10 MB, and an image that actually decodes.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppContext } from '../app-context.js';
import type { Poster } from '../db/schema.js';
import { type FetchLike, request } from '../clients/http.js';
import { getCached } from '../cache.js';
import type { CollectionDetails } from '../clients/tmdb.js';
import { PRESETS } from '../presets/index.js';
import { SERIES_PREFIX } from '../presets/film-series.js';
import { loadSharp } from '../overlays/render.js';
import { bundledPosterBytes } from '../posters/bundled.js';

export const POSTER_MAX_BYTES = 10 * 1024 * 1024;
const TYPES: Record<string, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export class PosterError extends Error {}

export const postersDir = (configDir: string) => join(configDir, 'posters');

/** A poster's bytes: fetched from its address, read from /config/posters, or the app's own. Null for none. */
export async function readPoster(p: Poster, x: { fetch: FetchLike; postersDir: string }): Promise<{ bytes: Uint8Array; type: string } | null> {
  if (p.kind === 'none') return null;
  if (p.kind === 'bundled') {
    try {
      return { bytes: await bundledPosterBytes(p.key), type: 'image/jpeg' };
    } catch (e) {
      throw new PosterError((e as Error).message);
    }
  }
  if (p.kind === 'file') {
    const path = join(x.postersDir, p.file);
    if (!existsSync(path)) throw new PosterError(`the uploaded poster (${p.file}) is missing from /config/posters`);
    const bytes = new Uint8Array(readFileSync(path));
    return { bytes, type: await checkImage(bytes) };
  }
  const res = await request(x.fetch, p.url, { retries: 1 });
  if (!res.ok) throw new PosterError(`the poster address answered HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const type = res.headers.get('content-type')?.split(';')[0];
  return { bytes, type: type?.startsWith('image/') ? type : await checkImage(bytes) };
}

/** Check bytes are a usable poster and return their content type. */
export async function checkImage(bytes: Uint8Array): Promise<string> {
  if (bytes.length > POSTER_MAX_BYTES) throw new PosterError('That image is over 10 MB.');
  let meta: { format?: string; width?: number; height?: number };
  try {
    meta = await (await loadSharp())(bytes).metadata();
  } catch {
    throw new PosterError('That isn’t an image the app can read. Use a JPEG, PNG or WebP.');
  }
  const type = meta.format ? TYPES[meta.format] : undefined;
  if (!type) throw new PosterError(`That’s a ${meta.format ?? 'file of unknown type'}, not a JPEG, PNG or WebP.`);
  if (!meta.width || meta.width < 100 || !meta.height || meta.height < 100) throw new PosterError('That image is too small for a poster (at least 100 × 100).');
  return type;
}

/** Check an address serves a usable image. */
export async function checkPosterUrl(f: FetchLike, url: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new PosterError('Enter the image’s full address, starting with https://');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new PosterError('The address must start with https:// or http://');
  let res: Response;
  try {
    res = await request(f, url, { retries: 1 });
  } catch (e) {
    throw new PosterError(`Couldn’t fetch that address: ${(e as Error).message}`);
  }
  if (!res.ok) throw new PosterError(`That address answered HTTP ${res.status}.`);
  await checkImage(new Uint8Array(await res.arrayBuffer()));
}

/** Store an uploaded poster for a collection, after checking it. Returns the new poster. */
export async function savePosterFile(configDir: string, defId: number, bytes: Uint8Array): Promise<Poster> {
  const type = await checkImage(bytes);
  const ext = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
  const file = `${defId}-${createHash('sha256').update(bytes).digest('hex').slice(0, 12)}.${ext}`;
  mkdirSync(postersDir(configDir), { recursive: true });
  writeFileSync(join(postersDir(configDir), file), bytes);
  return { kind: 'file', file };
}

/** Delete an uploaded poster's file (when it's replaced, or its collection deleted). */
export function removePosterFile(configDir: string, p: Poster): void {
  if (p.kind === 'file') rmSync(join(postersDir(configDir), p.file), { force: true });
}

/**
 * The poster a preset comes with: the app's own (ADR-045), Kometa's for universes and show franchises, or TMDb's for a
 * film series; null for a collection of your own.
 */
export function defaultPoster(app: AppContext, presetKey: string | null): Poster | null {
  if (!presetKey) return null;
  if (presetKey.startsWith(SERIES_PREFIX)) {
    const hit = getCached<CollectionDetails | null>(app.db, `collection-details:${presetKey.slice(SERIES_PREFIX.length)}`);
    const path = hit.hit ? hit.value?.posterPath : null;
    return path ? { kind: 'url', url: `https://image.tmdb.org/t/p/original${path}` } : null;
  }
  return PRESETS.find((p) => p.definition.presetKey === presetKey)?.definition.poster ?? null;
}
