// Collection posters (ADR-042): an image address, an upload kept in /config/posters, the preset's own, or none. Saving
// puts it on the box set straight away; the integrity check (ADR-040) then treats it as the app's own, not a repair.
import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { openDb } from '../src/db/index.js';
import { createContext } from '../src/app-context.js';
import { readConfig } from '../src/config.js';
import { runPipeline } from '../src/pipeline/run.js';
import { definition, integrityEvent, managedCollection } from '../src/db/schema.js';
import { createCollection, deleteCollection, setPoster, updateCollection } from '../src/web/collection-actions.js';
import { checkImage, postersDir } from '../src/domain/posters.js';
import { sha256 } from '../src/overlays/render.js';
import { SettingsError } from '../src/web/settings-actions.js';
import { FakeJellyfin, FAKE_URL } from './fakes/jellyfin.js';
import type { FetchLike } from '../src/clients/http.js';
import { setup, signIn, csrfOf, flash } from './helpers/web.js';

const NOW = Date.UTC(2026, 10, 20, 15);
const DAY = 86_400_000;
const jpeg = (rgb: [number, number, number], w = 300, h = 450) => sharp({ create: { width: w, height: h, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).jpeg().toBuffer().then((b) => new Uint8Array(b));

describe('checking poster images', () => {
  it('takes JPEG, PNG or WebP of a sensible size, and says what’s wrong otherwise', async () => {
    expect(await checkImage(await jpeg([1, 2, 3]))).toBe('image/jpeg');
    expect(await checkImage(new Uint8Array(await sharp({ create: { width: 200, height: 300, channels: 4, background: '#0000' } }).png().toBuffer()))).toBe('image/png');
    await expect(checkImage(new TextEncoder().encode('<html>not an image</html>'))).rejects.toThrow(/isn’t an image/);
    await expect(checkImage(await jpeg([1, 2, 3], 50, 75))).rejects.toThrow(/too small/);
    await expect(checkImage(new Uint8Array(11 * 1024 * 1024))).rejects.toThrow(/over 10 MB/);
  });
});

async function world() {
  const fake = new FakeJellyfin();
  fake.add({ Id: 'm1', Name: 'Elf', Type: 'Movie', ParentId: 'lib-movies', ProductionYear: 2003, Tags: ['family-night'] });
  fake.add({ Id: 'm2', Name: 'Home Alone', Type: 'Movie', ParentId: 'lib-movies', ProductionYear: 1990, Tags: ['family-night'] });
  const remote = await jpeg([200, 30, 30]);
  const net: FetchLike = async (url) => {
    if (url === 'https://example.test/poster.jpg') return new Response(remote, { headers: { 'content-type': 'image/jpeg' } });
    if (url === 'https://example.test/page.html') return new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
    if (url.includes('Default-Images')) return new Response(await jpeg([0, 0, 0]), { headers: { 'content-type': 'image/jpeg' } });
    return new Response('[]');
  };
  const config = { ...readConfig({}), configDir: mkdtempSync(join(tmpdir(), 'mc-')), timezone: 'America/New_York', seeds: {} };
  const app = createContext(config, { db: openDb(':memory:'), fetch: net, jellyfinFetch: fake.fetch() });
  app.updateSettings({ connections: { jellyfinUrl: FAKE_URL, plexUrl: '', radarrUrl: '', sonarrUrl: '' }, firstRunDone: true, dryRun: false });
  app.secrets.set('jellyfin.apiKey', fake.apiKey);
  app.db.update(definition).set({ enabled: false }).run();
  const id = createCollection(app, { name: 'Family Night', target: 'movies', dates: null, sourceType: 'jellyfin_tags', sourceValue: 'family-night' });
  updateCollection(app, id, { enabled: true });
  await runPipeline(app, { job: 'manual', trigger: 'manual', index: true, now: NOW });
  const boxId = () => app.db.select().from(managedCollection).where(eq(managedCollection.definitionId, id)).get()!.jfBoxsetId!;
  const poster = () => fake.imageData.get(`${boxId()}/Primary`)?.bytes;
  return { fake, app, id, remote, boxId, poster };
}

describe('collection posters', () => {
  it('a custom collection starts without a poster, and an upload goes on its box set straight away', async () => {
    const { app, id, poster } = await world();
    expect(poster()).toBeUndefined();
    const upload = await jpeg([20, 120, 220]);
    expect(await setPoster(app, id, { kind: 'upload', bytes: upload })).toBe('Poster saved and put on its box set in Jellyfin.');
    expect(sha256(poster()!)).toBe(sha256(upload));
    const files = readdirSync(postersDir(app.config.configDir));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(new RegExp(`^${id}-[0-9a-f]{12}\\.jpg$`));
    // The next run sees the app's own poster: nothing to repair, nothing to change.
    const r = await runPipeline(app, { job: 'manual', trigger: 'manual', index: true, now: NOW + DAY });
    expect(r.stats).toMatchObject({ boxSetsRepaired: 0, planned: 0 });
    expect(app.db.select().from(integrityEvent).all()).toEqual([]);
  });

  it('takes an image address, refuses one that isn’t an image, and removes the old upload when replaced', async () => {
    const { app, id, remote, poster } = await world();
    await setPoster(app, id, { kind: 'upload', bytes: await jpeg([1, 1, 1]) });
    await expect(setPoster(app, id, { kind: 'url', url: 'https://example.test/page.html' })).rejects.toThrow(SettingsError);
    await expect(setPoster(app, id, { kind: 'url', url: 'ftp://example.test/x.jpg' })).rejects.toThrow(/https:\/\//);
    await setPoster(app, id, { kind: 'url', url: 'https://example.test/poster.jpg' });
    expect(sha256(poster()!)).toBe(sha256(remote));
    expect(readdirSync(postersDir(app.config.configDir))).toEqual([]); // the replaced upload is gone
    expect(app.db.select().from(definition).where(eq(definition.id, id)).get()!.poster).toEqual({ kind: 'url', url: 'https://example.test/poster.jpg' });
  });

  it('“No poster” takes it off the box set, and the next run leaves it off', async () => {
    const { app, id, poster } = await world();
    await setPoster(app, id, { kind: 'upload', bytes: await jpeg([9, 9, 9]) });
    expect(await setPoster(app, id, { kind: 'none' })).toBe('Poster removed, from its box set in Jellyfin too.');
    expect(poster()).toBeUndefined();
    expect((await runPipeline(app, { job: 'manual', trigger: 'manual', index: true, now: NOW + DAY })).stats.boxSetsRepaired).toBe(0);
    expect(poster()).toBeUndefined();
  });

  it('a preset can go back to its own poster; a custom collection has none to go back to', async () => {
    const { app, id } = await world();
    await expect(setPoster(app, id, { kind: 'default' })).rejects.toThrow(/no poster of its own/);
    const christmas = app.db.select().from(definition).where(eq(definition.slug, 'seasonal-christmas')).get()!;
    await setPoster(app, christmas.id, { kind: 'url', url: 'https://example.test/poster.jpg' });
    await setPoster(app, christmas.id, { kind: 'default' });
    expect(app.db.select().from(definition).where(eq(definition.id, christmas.id)).get()!.poster).toEqual({ kind: 'url', url: 'https://raw.githubusercontent.com/Kometa-Team/Default-Images/master/seasonal/christmas.jpg' });
  });

  it('deleting a collection deletes its uploaded poster', async () => {
    const { app, id } = await world();
    await setPoster(app, id, { kind: 'upload', bytes: await jpeg([3, 3, 3]) });
    const file = readdirSync(postersDir(app.config.configDir))[0]!;
    updateCollection(app, id, { enabled: false });
    await runPipeline(app, { job: 'manual', trigger: 'manual', index: true, now: NOW + DAY }); // removes its box set
    deleteCollection(app, id);
    expect(existsSync(join(postersDir(app.config.configDir), file))).toBe(false);
  });
});

describe('the Poster section in the editor', () => {
  it('uploads an image and shows it', async () => {
    const t = setup();
    await t.web.request('/setup', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ url: FAKE_URL, apiKey: t.fake.apiKey, setupCode: t.app.setupCode ?? '' }).toString() });
    const id = createCollection(t.app, { name: 'Mine', target: 'movies', dates: null, sourceType: 'jellyfin_tags', sourceValue: 'x' });
    const { cookie } = await signIn(t.web);
    const csrf = await csrfOf(t.web, cookie, `/collections/${id}`);
    const page = await (await t.web.request(`/collections/${id}`, { headers: { cookie } })).text();
    expect(page).toContain('Upload an image');
    expect(page).not.toContain('The preset’s own poster');
    const body = new FormData();
    body.set('_csrf', csrf);
    body.set('poster', 'upload');
    const img = await jpeg([0, 90, 0]);
    body.set('posterFile', new File([img], 'mine.jpg', { type: 'image/jpeg' }));
    const res = await t.web.request(`/collections/${id}/poster`, { method: 'POST', headers: { cookie }, body });
    expect(flash(res)).toContain('Poster saved');
    const shown = await t.web.request(`/collections/${id}/poster`, { headers: { cookie } });
    expect(shown.headers.get('content-type')).toBe('image/jpeg');
    expect(sha256(new Uint8Array(await shown.arrayBuffer()))).toBe(sha256(img));
    // A file that isn't an image is refused with a reason.
    const bad = new FormData();
    bad.set('_csrf', csrf);
    bad.set('poster', 'upload');
    bad.set('posterFile', new File([new TextEncoder().encode('nope')], 'x.jpg', { type: 'image/jpeg' }));
    expect(flash(await t.web.request(`/collections/${id}/poster`, { method: 'POST', headers: { cookie }, body: bad }))).toMatch(/isn’t an image/);
  });
});
