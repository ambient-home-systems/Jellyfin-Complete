// The presets' own posters (ADR-045). The image build sets every one in advance (build.ts) and keeps them beside this
// module, in dist/posters; run from source (development, tests) they're set the first time they're asked for and kept
// in memory.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ROOT } from '../config.js';
import { PRESETS } from '../presets/index.js';
import { bundledPosterFor, type BundledPoster } from './catalog.js';
import { composePoster } from './compose.js';

/** Where the build leaves the finished posters: beside the compiled module (dist/posters), never in src. */
export const RENDERED_DIR = fileURLToPath(new URL('.', import.meta.url));
export const ART_DIR = join(APP_ROOT, 'assets', 'posters', 'art');

/** Every preset's own poster, one per preset that has one. */
export const bundledPosters = (): BundledPoster[] => PRESETS.map((p) => bundledPosterFor(p.definition)).filter((b): b is BundledPoster => b !== null);

/** The poster with this key (a preset's slug), or null if there's no such poster. */
export function bundledPoster(key: string): BundledPoster | null {
  const p = PRESETS.find((x) => x.definition.slug === key);
  return p ? bundledPosterFor(p.definition) : null;
}

/** Set a poster from its artwork: JPEG, 1000 × 1500. */
export async function renderBundled(b: BundledPoster): Promise<Uint8Array> {
  const art = join(ART_DIR, `${b.art}.webp`);
  if (!existsSync(art)) throw new Error(`the artwork for the ${b.key} poster (${b.art}) is missing`);
  return composePoster(new Uint8Array(readFileSync(art)), b.title, b.tint ? { tint: b.tint } : {});
}

const made = new Map<string, Promise<Uint8Array>>();

/** A bundled poster's JPEG: the one the build set, or set now (and kept) when running from source. */
export function bundledPosterBytes(key: string): Promise<Uint8Array> {
  if (!/^[a-z0-9_-]+$/.test(key)) return Promise.reject(new Error(`there’s no poster of the app’s own called “${key}”`));
  const file = join(RENDERED_DIR, `${key}.jpg`);
  if (existsSync(file)) return Promise.resolve(new Uint8Array(readFileSync(file)));
  let p = made.get(key);
  if (!p) {
    const b = bundledPoster(key);
    if (!b) return Promise.reject(new Error(`there’s no poster of the app’s own called “${key}”`));
    p = renderBundled(b);
    made.set(key, p);
    p.catch(() => made.delete(key));
  }
  return p;
}
