// The presets' own posters (ADR-045): artwork made for this app (assets/posters/art), with the collection's title set
// over the quiet bottom third in Archivo, as part of the image build. The art carries no lettering; the title is set
// here so it's always spelled right and matches across the set. Streaming services share one picture, tinted in each
// service's colour.
import { join } from 'node:path';
import { APP_ROOT } from '../config.js';
import { loadSharp } from '../overlays/render.js';

export const POSTER_W = 1000, POSTER_H = 1500;
const FONTS = join(APP_ROOT, 'assets', 'posters', 'fonts');
// Pango reads a font description as "family, style size": the comma keeps "ExtraCondensed" in the family name instead
// of being taken as a width (which picks another face).
const TITLE_FONT = { name: 'Archivo ExtraCondensed, Black', file: join(FONTS, 'Archivo-ExtraCondensedBlack.ttf') };
const SMALL_FONT = { name: 'Archivo, SemiBold', file: join(FONTS, 'Archivo-SemiBold.ttf') };
const CREAM = '#F4EBD9', GOLD = '#F2C14E', INK = '#14161C';

/** A poster's lettering: an optional small line above, the title, and an optional small line below ("MOVIES"). */
export type PosterTitle = { kicker?: string; main: string; sub?: string };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Capitals, with typographic apostrophes, and IMDb as it writes itself.
const caps = (s: string) => s.toUpperCase().replace(/'/g, '’').replace(/\bIMDB\b/g, 'IMDb');
/** The condensed face's word space is narrow at poster sizes: this much more, in ems. */
const WORD_SPACE = 0.14;

type Sharp = Awaited<ReturnType<typeof loadSharp>>;
async function text(sharp: Sharp, s: string, font: { name: string; file: string }, size: number, opts: { color?: string; tracking?: number; align?: 'centre' | 'left'; spacing?: number; wordSpace?: number } = {}) {
  const body = opts.wordSpace ? s.split(' ').map(esc).join(`<span letter_spacing="${Math.round(opts.wordSpace * size * 1024)}"> </span>`) : esc(s);
  const markup = `<span foreground="${opts.color ?? CREAM}"${opts.tracking ? ` letter_spacing="${Math.round(opts.tracking * size * 1024)}"` : ''}>${body}</span>`;
  const buf = await sharp({ text: { text: markup, font: `${font.name} ${size.toFixed(2)}`, fontfile: font.file, dpi: 72, rgba: true, align: opts.align ?? 'centre', ...(opts.spacing !== undefined ? { spacing: opts.spacing } : {}) } }).png().toBuffer();
  const m = await sharp(buf).metadata();
  return { buf, w: m.width!, h: m.height! };
}

/**
 * Lay the title out in one, two or three lines at the largest size that fits the width and height: the split with the
 * most even lines wins, so "ASIAN AMERICAN & PACIFIC ISLANDER" breaks where it reads well.
 */
async function layout(sharp: Sharp, main: string, box: { w: number; h: number; max: number; min: number }): Promise<{ lines: string[]; size: number }> {
  const words = caps(main).split(/\s+/).filter(Boolean);
  const at = 100;
  const widths = await Promise.all(words.map(async (w) => (await text(sharp, w, TITLE_FONT, at)).w));
  const space = (await text(sharp, 'I I', TITLE_FONT, at, { wordSpace: WORD_SPACE })).w - (await text(sharp, 'II', TITLE_FONT, at)).w;
  let best: { lines: string[]; size: number } | null = null;
  const tryParts = (cuts: number[]) => {
    const groups: number[][] = [];
    let start = 0;
    for (const c of [...cuts, words.length]) { groups.push(Array.from({ length: c - start }, (_, i) => start + i)); start = c; }
    const lineW = groups.map((g) => g.reduce((t, i) => t + widths[i]!, 0) + space * (g.length - 1));
    const n = groups.length;
    const size = Math.min(box.max, (at * box.w) / Math.max(...lineW), box.h / (n * 0.86 + 0.14));
    // A single line wins ties; more lines only for a clearly bigger title.
    if (!best || size > best.size * (n > best.lines.length ? 1.12 : 1)) best = { lines: groups.map((g) => g.map((i) => words[i]).join(' ')), size };
  };
  tryParts([]);
  for (let a = 1; a < words.length; a++) tryParts([a]);
  for (let a = 1; a < words.length; a++) for (let b = a + 1; b < words.length; b++) tryParts([a, b]);
  const chosen = best!;
  return { lines: chosen.lines, size: Math.max(box.min, Math.floor(chosen.size)) };
}

/** Hex colour to RGB. */
const rgb = (hex: string) => ({ r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) });

/** The finished poster: the art at 1000 × 1500, the title over its bottom third, as JPEG. */
export async function composePoster(art: Uint8Array, title: PosterTitle, opts: { tint?: string } = {}): Promise<Uint8Array> {
  const sharp = await loadSharp();
  let base = sharp(art).resize(POSTER_W, POSTER_H, { fit: 'cover' });
  // Tint the picture on its own, one step at a time: within one pipeline sharp colours after compositing (the lettering
  // too) and makes greyscale last (undoing the tint).
  if (opts.tint) {
    const grey = await base.greyscale().png().toBuffer();
    base = sharp(await sharp(grey).tint(rgb(opts.tint)).png().toBuffer());
  }
  const layers: { input: Buffer; left: number; top: number }[] = [];
  // The art is already dark at the bottom; deepen it a little, so the title reads on any of them.
  layers.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${POSTER_W}" height="${POSTER_H}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0.55" stop-color="${INK}" stop-opacity="0"/><stop offset="1" stop-color="${INK}" stop-opacity="0.78"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`), left: 0, top: 0 });

  const margin = 70, bottom = POSTER_H - 96;
  let y = bottom;
  if (title.sub) {
    const sub = await text(sharp, caps(title.sub), SMALL_FONT, 50, { color: GOLD, tracking: 0.3 });
    y -= sub.h;
    layers.push({ input: sub.buf, left: Math.round((POSTER_W - sub.w) / 2), top: y });
    y -= 26;
  }
  const hasKicker = Boolean(title.kicker);
  const { lines, size } = await layout(sharp, title.main, { w: POSTER_W - 2 * margin, h: hasKicker ? 290 : 340, max: 210, min: 72 });
  const main = await text(sharp, lines.join('\n'), TITLE_FONT, size, { spacing: Math.round(-size * 0.14), wordSpace: WORD_SPACE });
  y -= main.h;
  layers.push({ input: main.buf, left: Math.round((POSTER_W - main.w) / 2), top: y });
  if (title.kicker) {
    const k = await text(sharp, caps(title.kicker), SMALL_FONT, title.kicker.length > 18 ? 34 : 46, { tracking: 0.2 });
    y -= k.h + 14;
    layers.push({ input: k.buf, left: Math.round((POSTER_W - k.w) / 2), top: y });
  }
  return new Uint8Array(await base.composite(layers).jpeg({ quality: 88, mozjpeg: true }).toBuffer());
}
