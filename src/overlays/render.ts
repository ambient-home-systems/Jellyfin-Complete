// Draws overlay badges on a copy of a poster (ADR-039), the way Kometa's overlay defaults do on their 1000 × 1500
// canvas, scaled to the poster's own width so the original's size and quality are kept:
// - status (defaults/overlays/status.yml): white Inter Medium 50 px text in a 305 × 105 box, #00000099, radius 30,
//   15 px from the top left
// - IMDb Top 250 ribbon (defaults/overlays/ribbon.yml): Kometa's yellow ribbon image in the bottom-right corner
// sharp is loaded only when needed, so the rest of the app runs even where its native library can't load.
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { APP_ROOT } from '../config.js';

export type Badge = 'status:airing' | 'status:returning' | 'status:canceled' | 'status:ended' | 'ribbon:imdb_top_250';

export const BADGE_LABEL: Record<Badge, string> = {
  'status:airing': 'AIRING',
  'status:returning': 'RETURNING',
  'status:canceled': 'CANCELED',
  'status:ended': 'ENDED',
  'ribbon:imdb_top_250': 'IMDb Top 250',
};

const ASSETS = join(APP_ROOT, 'assets', 'overlays');
export const FONT_FILE = join(ASSETS, 'Inter-Medium.ttf');
const RIBBON_FILE = join(ASSETS, 'ribbon-imdb-top-250.png');
/** Written into each overlaid poster's EXIF, so a poster this app made is never taken for an original. */
export const MARKER = 'Maverick Jellyfin Complete overlays';

type Sharp = (typeof import('sharp'))['default'];
let loaded: Promise<Sharp> | null = null;
export function loadSharp(): Promise<Sharp> {
  // Text is drawn with the bundled font; point fontconfig at it so no system fonts or config are needed (slim images).
  process.env.FONTCONFIG_FILE ??= join(ASSETS, 'fonts.conf');
  loaded ??= import('sharp').then((m) => m.default).catch((e: Error) => {
    loaded = null;
    throw new Error(`Couldn’t load the image library (sharp): ${e.message}`);
  });
  return loaded;
}

export const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** Escape text for Pango markup. */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The poster with its badges, as JPEG, at the original's size. Badges are drawn in a fixed order, so equal input gives equal output. */
export async function renderOverlay(original: Uint8Array, badges: Badge[]): Promise<Uint8Array> {
  const sharp = await loadSharp();
  const base = sharp(original, { failOn: 'error' }).rotate();
  const meta = await base.metadata();
  const width = meta.autoOrient?.width ?? meta.width;
  const height = meta.autoOrient?.height ?? meta.height;
  if (!width || !height) throw new Error('The poster has no size');
  const k = width / 1000; // Kometa's canvas is 1000 px wide
  const px = (n: number) => Math.max(1, Math.round(n * k));
  const layers: { input: Buffer; left: number; top: number }[] = [];

  const status = badges.find((b) => b.startsWith('status:'));
  if (status) {
    const w = px(305), h = px(105), r = px(30), left = px(15), top = px(15);
    layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" ry="${r}" fill="#000000" fill-opacity="0.6"/></svg>`), left, top });
    const text = await sharp({ text: { text: `<span foreground="#FFFFFF">${esc(BADGE_LABEL[status as Badge])}</span>`, font: `Inter Medium ${(50 * k).toFixed(2)}`, fontfile: FONT_FILE, dpi: 72, rgba: true } }).png().toBuffer();
    const t = await sharp(text).metadata();
    // Kometa centres the text in its box; very narrow posters get the text shrunk to fit.
    const fit = t.width! > w - px(10) ? await sharp(text).resize({ width: w - px(10) }).png().toBuffer() : text;
    const f = fit === text ? t : await sharp(fit).metadata();
    layers.push({ input: fit, left: left + Math.round((w - f.width!) / 2), top: top + Math.round((h - f.height!) / 2) });
  }

  if (badges.includes('ribbon:imdb_top_250')) {
    const size = Math.min(px(351), width, height);
    layers.push({ input: await sharp(RIBBON_FILE).resize(size, size).png().toBuffer(), left: width - size, top: height - size });
  }

  return new Uint8Array(await base.composite(layers).jpeg({ quality: 92, mozjpeg: true }).withExif({ IFD0: { Software: MARKER } }).toBuffer());
}

/** True if this image carries the app's overlay marker. */
export async function hasMarker(bytes: Uint8Array): Promise<boolean> {
  try {
    const sharp = await loadSharp();
    const exif = (await sharp(bytes).metadata()).exif;
    return Boolean(exif && exif.includes(MARKER));
  } catch {
    return false;
  }
}
