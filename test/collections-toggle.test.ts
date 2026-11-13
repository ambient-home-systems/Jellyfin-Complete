import { describe, it, expect } from 'vitest';
import { definition } from '../src/db/schema.js';
import { insertDefinition } from '../src/domain/definitions.js';
import { filmSeriesDefinition } from '../src/presets/film-series.js';
import { FAKE_URL } from './fakes/jellyfin.js';
import { setup, form, signIn, csrfOf } from './helpers/web.js';

// The Collections page turns a collection on or off with one click, in place (no editor, no Save, no jump to the top).
async function signedIn() {
  const t = setup();
  await t.web.request('/setup', form({ url: FAKE_URL, apiKey: t.fake.apiKey, setupCode: t.app.setupCode ?? '' }));
  const { cookie } = await signIn(t.web);
  const csrf = await csrfOf(t.web, cookie, '/collections');
  const post = (path: string, data: Record<string, string>, headers: Record<string, string> = {}) =>
    t.web.request(path, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams({ _csrf: csrf, ...data }).toString() });
  const bySlug = (slug: string) => t.app.db.select().from(definition).all().find((d) => d.slug === slug)!;
  return { ...t, cookie, post, bySlug };
}

describe('Collections page: one-click on/off', () => {
  it('shows a switch on every row, and All on / All off for each ready-made family', async () => {
    const { web, cookie, bySlug } = await signedIn();
    const html = await (await web.request('/collections', { headers: { cookie } })).text();
    const d = bySlug('chart-top-movies');
    expect(html).toContain(`<tr id="c-${d.id}"`);
    expect(html).toMatch(new RegExp(`id="sw-${d.id}" class="switch" role="switch" aria-checked="false" aria-label="[^"]+"`));
    expect(html).toContain(`hx-post="/collections/${d.id}/enabled"`);
    expect(html).toContain('action="/collections/family/streaming/enabled"');
    expect(html).toContain('id="fam-imdb_chart-count"');
    expect(html).toContain('id="toggle-status"');
  });

  it('with htmx, flips the collection and sends back just its row, the family count and a status line', async () => {
    const { post, bySlug } = await signedIn();
    const d = bySlug('chart-top-movies');
    const res = await post(`/collections/${d.id}/enabled`, { enabled: '1' }, { 'hx-request': 'true' });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(bySlug('chart-top-movies').enabled).toBe(true);
    expect(html.startsWith(`<tr id="c-${d.id}"`)).toBe(true);
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('name="enabled" value="0"'); // the next click turns it off
    expect(html).toMatch(/<span id="fam-imdb_chart-count"[^>]*hx-swap-oob="true"[^>]*>1 of 5 on<\/span>/);
    expect(html).toMatch(/<div id="toggle-status"[^>]*hx-swap-oob="innerHTML"[^>]*>.*is on\. The next run fetches its sources and plans it\.<\/div>/);
    expect(html).not.toContain('<html');

    const off = await (await post(`/collections/${d.id}/enabled`, { enabled: '0' }, { 'hx-request': 'true' })).text();
    expect(bySlug('chart-top-movies').enabled).toBe(false);
    expect(off).toContain('aria-checked="false"');
    expect(off).toContain('>0 of 5 on</span>');
    expect(off).toContain('is off. The next run removes its box set, if it has one.');
  });

  it('without JavaScript, goes back to the same row rather than the top of the page', async () => {
    const { post, bySlug } = await signedIn();
    const d = bySlug('chart-top-movies');
    const res = await post(`/collections/${d.id}/enabled`, { enabled: '1' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toMatch(new RegExp(`^/collections\\?ok=.+#c-${d.id}$`));
    expect(bySlug('chart-top-movies').enabled).toBe(true);
  });

  it('All on turns on only the streaming services offered in your country; All off turns off the lot', async () => {
    const { app, post, bySlug } = await signedIn();
    expect(app.settings().streaming.region).toBe('US');
    const res = await post('/collections/family/streaming/enabled', { enabled: '1' });
    expect(res.headers.get('location')).toMatch(/^\/collections\?ok=.+#fam-streaming$/);
    expect(bySlug('streaming-netflix-movies').enabled).toBe(true);
    expect(bySlug('streaming-channel4-movies').enabled).toBe(false); // UK only
    expect(bySlug('chart-top-movies').enabled).toBe(false); // other families untouched

    await post('/collections/family/streaming/enabled', { enabled: '0' });
    const on = app.db.select().from(definition).all().filter((d) => d.enabled && d.presetKey?.startsWith('streaming:'));
    expect(on).toEqual([]);
  });

  it('All on leaves a service you turned on outside your country alone, and says when there was nothing to do', async () => {
    const { post, bySlug } = await signedIn();
    const ch4 = bySlug('streaming-channel4-movies');
    await post(`/collections/${ch4.id}/enabled`, { enabled: '1' });
    await post('/collections/family/streaming/enabled', { enabled: '1' });
    expect(bySlug('streaming-channel4-movies').enabled).toBe(true);
    const again = await post('/collections/family/streaming/enabled', { enabled: '1' });
    expect(new URL(again.headers.get('location') ?? '', 'http://x').searchParams.get('ok')).toBe('Streaming services: nothing to change.');
  });

  it('All on for film series also turns the film series setting on; an unknown family is not found', async () => {
    const { app, post, bySlug } = await signedIn();
    // Film series are found during a run (TMDb); add one as a run would.
    insertDefinition(app.db, filmSeriesDefinition('10194', { name: 'Toy Story Collection', overview: null, posterPath: null }, 2), { enabled: false, homeRow: false });
    expect(app.settings().filmSeries.enabled).toBe(false);
    await post('/collections/family/film_series/enabled', { enabled: '1' });
    expect(app.settings().filmSeries.enabled).toBe(true);
    expect(bySlug('film-series-10194').enabled).toBe(true);
    await post('/collections/family/film_series/enabled', { enabled: '0' });
    expect(app.settings().filmSeries.enabled).toBe(false);
    expect((await post('/collections/family/nope/enabled', { enabled: '1' })).status).toBe(404);
    expect((await post('/collections/99999/enabled', { enabled: '1' }, { 'hx-request': 'true' })).status).toBe(404);
  });
});
