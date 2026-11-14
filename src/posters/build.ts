// Build step (npm run build, so the image build too): set every preset's own poster into dist/posters, beside the
// compiled module that serves them (ADR-045). Fails the build if any can't be made.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundledPosters, renderBundled, RENDERED_DIR } from './bundled.js';

const started = Date.now();
mkdirSync(RENDERED_DIR, { recursive: true });
const all = bundledPosters();
let bytes = 0;
// A few at a time: each one is a handful of libvips and Pango jobs.
for (let i = 0; i < all.length; i += 4) {
  await Promise.all(all.slice(i, i + 4).map(async (b) => {
    const jpg = await renderBundled(b);
    writeFileSync(join(RENDERED_DIR, `${b.key}.jpg`), jpg);
    bytes += jpg.length;
  }));
}
console.log(`posters: ${all.length} set in ${((Date.now() - started) / 1000).toFixed(1)} s (${(bytes / 1048576).toFixed(1)} MB)`);
