import { describe, it, expect, beforeEach } from 'vitest';
import type { AppContext } from '../src/app-context.js';
import { runPipeline } from '../src/pipeline/run.js';
import { dashboardModel } from '../src/web/model.js';
import { FAKE_URL } from './fakes/jellyfin.js';
import { setup, flash, form, signIn, csrfOf } from './helpers/web.js';

describe('hardening for public installs (Phase 4)', () => {
  it('needs the setup code from the log before connecting Jellyfin', async () => {
    const t = setup();
    expect(t.app.setupCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(await (await t.web.request('/setup')).text()).toContain('Setup code');
    const wrong = await t.web.request('/setup', form({ url: FAKE_URL, apiKey: t.fake.apiKey, setupCode: 'AAAA-AAAA' }));
    expect(wrong.status).toBe(403);
    expect(t.app.secrets.get('jellyfin.apiKey')).toBeNull();
    const ok = await t.web.request('/setup', form({ url: FAKE_URL, apiKey: t.fake.apiKey, setupCode: t.app.setupCode!.toLowerCase().replace('-', ' ') }));
    expect(ok.headers.get('location')).toBe('/login');
    expect(t.app.setupCode).toBeNull();
  });

  it('locks sign-in after 5 failures for that address and that username', async () => {
    const t = setup();
    await t.web.request('/setup', form({ url: FAKE_URL, apiKey: t.fake.apiKey, setupCode: t.app.setupCode ?? '' }));
    for (let i = 0; i < 5; i++) expect((await signIn(t.web, 'admin', 'nope')).res.status).toBe(401);
    const locked = await signIn(t.web, 'admin', 'pw'); // even the right password waits
    expect(locked.res.status).toBe(429);
    expect(await locked.res.text()).toMatch(/Too many failed sign-ins/);
  });

  it('marks cookies Secure and sends HSTS only behind a trusted HTTPS proxy', async () => {
    const t = setup();
    await t.web.request('/setup', form({ url: FAKE_URL, apiKey: t.fake.apiKey, setupCode: t.app.setupCode ?? '' }));
    const viaProxy = { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-proto': 'https', 'x-forwarded-for': '203.0.113.7' };
    const plain = await t.web.request('/login', { method: 'POST', headers: viaProxy, body: 'username=admin&password=pw' });
    expect(plain.headers.get('set-cookie')).not.toMatch(/Secure/i); // TRUST_PROXY off: the header is ignored
    expect(plain.headers.get('strict-transport-security')).toBeNull();
    t.app.config.trustProxy = true;
    const trusted = await t.web.request('/login', { method: 'POST', headers: viaProxy, body: 'username=admin&password=pw' });
    expect(trusted.headers.get('set-cookie')).toMatch(/Secure/i);
    expect(trusted.headers.get('strict-transport-security')).toMatch(/max-age=/);
    expect(trusted.headers.get('permissions-policy')).toContain('camera=()');
  });
});

describe('first-run guide (Phase 4)', () => {
  it('walks a new install through its choices, then gets out of the way', async () => {
    const t = setup();
    await t.web.request('/setup', form({ url: FAKE_URL, apiKey: t.fake.apiKey, setupCode: t.app.setupCode ?? '' }));
    const { cookie } = await signIn(t.web);
    const csrf = await csrfOf(t.web, cookie, '/start');
    const post = (path: string, data: Record<string, string | string[]>) => {
      const body = new URLSearchParams({ _csrf: csrf });
      for (const [k, v] of Object.entries(data)) for (const x of ([] as string[]).concat(v)) body.append(k, x);
      return t.web.request(path, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    };
    const page = await (await t.web.request('/start', { headers: { cookie } })).text();
    expect(page).toContain('Getting started');
    expect(page).toContain('Animated Classics');
    // Each family says what its count means (collections it can make, not titles found) and its minimum.
    expect(page).toContain('27 TV franchises (Star Trek, NCIS, One Chicago…), one collection each');
    expect(page).toContain('at least 2 of its shows');
    expect(page).not.toContain('Kometa');
    expect(await (await t.web.request('/', { headers: { cookie } })).text()).toContain('Finish setting up');
    // Libraries step returns to the guide; timezone is validated.
    const libRes = await post('/settings/libraries', { movieLibraryIds: ['lib-movies'], showLibraryIds: ['lib-shows'], next: '/start#st-2' });
    expect(libRes.headers.get('location')).toMatch(/^\/start/);
    expect(t.app.settings().movieLibraryIds).toEqual(['lib-movies']);
    expect(t.app.settings().showLibraryIds).toBeNull(); // every TV library ticked = all, including ones added later
    await post('/settings/libraries', { movieLibraryIds: ['lib-movies', 'lib-animated'], showLibraryIds: ['lib-shows'], next: '/start#st-2' });
    expect(t.app.settings().movieLibraryIds).toBeNull();
    expect(flash(await post('/start/timezone', { timezone: 'Mars/Olympus' }))).toMatch(/Unknown timezone/);
    await post('/start/timezone', { timezone: 'Europe/London' });
    expect(t.app.settings().timezone).toBe('Europe/London');
    // Families: universes on, holiday episodes off.
    await post('/start/families', { families: ['seasonal', 'universe'] });
    const enabled = (prefix: string) => (t.app.db.$client.prepare(`select count(*) n from definition where preset_key like '${prefix}:%' and enabled = 1`).get() as { n: number }).n;
    expect([enabled('seasonal'), enabled('holiday_episodes'), enabled('universe'), enabled('show_franchise')]).toEqual([19, 0, 17, 0]);
    expect(t.app.settings().filmSeries.enabled).toBe(false);
    expect(page).toContain('One collection for each film series');
    await post('/start/families', { families: ['seasonal', 'universe', 'film_series'] });
    expect(t.app.settings().filmSeries.enabled).toBe(true); // one switch; the next run adds the series
    expect(t.app.settings().onboarding.done.sort()).toEqual(['families', 'libraries', 'timezone']);
    // Finish: the banner goes, and the next sign-in lands on the Dashboard.
    expect((await post('/start/finish', {})).headers.get('location')).toBe('/');
    expect(await (await t.web.request('/', { headers: { cookie } })).text()).not.toContain('Finish setting up');
    expect((await signIn(t.web)).res.headers.get('location')).toBe('/');
  });
});

describe('web', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => { t = setup(); });

  it('asks for Jellyfin first, then for an admin sign-in', async () => {
    expect((await t.web.request('/')).headers.get('location')).toBe('/login');
    expect((await t.web.request('/login')).headers.get('location')).toBe('/setup');
    const bad = await t.web.request('/setup', form({ url: FAKE_URL, apiKey: 'wrong-key', setupCode: t.app.setupCode ?? '' }));
    expect(bad.status).toBe(400);
    const ok = await t.web.request('/setup', form({ url: FAKE_URL, apiKey: t.fake.apiKey, setupCode: t.app.setupCode ?? '' }));
    expect(ok.headers.get('location')).toBe('/login');
    expect(t.app.secrets.get('jellyfin.apiKey')).toBe(t.fake.apiKey);
    // Libraries are read at setup, so Settings can offer them before the first run.
    expect(t.app.db.$client.prepare("select name from library where collection_type = 'movies'").all()).not.toHaveLength(0);
    expect((await signIn(t.web, 'kid', 'pw2')).res.status).toBe(403);
    expect((await signIn(t.web, 'admin', 'nope')).res.status).toBe(401);
    const { res, cookie } = await signIn(t.web);
    expect(res.headers.get('location')).toBe('/start'); // a new install starts with the first-run guide
    expect(cookie).toMatch(/^mc_session=/);
    expect(res.headers.get('set-cookie')).toMatch(/HttpOnly/i);
    const dash = await t.web.request('/', { headers: { cookie } });
    expect(dash.status).toBe(200);
    expect(await dash.text()).toContain('Needs you');
  });

  it('rejects state changes without the CSRF token', async () => {
    await t.web.request('/setup', form({ url: FAKE_URL, apiKey: t.fake.apiKey, setupCode: t.app.setupCode ?? '' }));
    const { cookie } = await signIn(t.web);
    const r = await t.web.request('/settings/general', { ...form({ dryRun: '0', leadDays: '14', timezone: 'America/New_York', arrCapPerRun: '10' }), headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' } });
    expect(r.status).toBe(403);
    expect(t.app.settings().dryRun).toBe(true);
  });

  it('renders every page, runs, and approves from Review', async () => {
    await t.web.request('/setup', form({ url: FAKE_URL, apiKey: t.fake.apiKey, setupCode: t.app.setupCode ?? '' }));
    const { cookie } = await signIn(t.web);
    const csrf = await csrfOf(t.web, cookie);
    expect(csrf).toHaveLength(32);
    for (const p of ['/', '/collections', '/review', '/review?tab=dismissed', '/activity', '/settings', '/adoption']) {
      const r = await t.web.request(p, { headers: { cookie } });
      expect(r.status, p).toBe(200);
      expect(r.headers.get('content-security-policy')).toContain("default-src 'self'");
    }
    // A run in dry run proposes Thanksgiving (window open on 17 Nov) without touching Jellyfin.
    await runPipeline(t.app, { job: 'manual', trigger: 'manual', index: true, now: Date.UTC(2026, 10, 17, 15) });
    expect(t.fake.boxSets()).toHaveLength(0);
    // The timetable lists closings only for collections that are or will be live.
    const dash = dashboardModel(t.app, Date.UTC(2026, 10, 17, 15));
    const closes = dash.timetable.filter((c) => c.kind === 'closes').map((c) => c.def.slug);
    expect(closes).toEqual(['seasonal-thanksgiving']);
    expect(dash.timetable.some((c) => c.kind === 'opens' && c.def.slug === 'seasonal-christmas')).toBe(true);
    const review = await (await t.web.request('/review', { headers: { cookie } })).text();
    expect(review).toContain('Thanksgiving Movies');
    expect(review).toContain('Dry run is on');
    const ids = [...review.matchAll(/name="ids" value="(\d+)"/g)].map((m) => m[1]!);
    expect(ids.length).toBe(3); // create, metadata, add Planes, Trains and Automobiles
    const body = new URLSearchParams({ _csrf: csrf, tab: 'pending', verdict: 'approve' });
    for (const id of ids) body.append('ids', id);
    const res = await t.web.request('/review', { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    expect(res.status).toBe(302);
    expect(flash(res)).toContain('Applied 3');
    const box = t.fake.boxSets().find((b) => b.Name === 'Thanksgiving Movies');
    expect(box?.children).toEqual(['m-ptna']);
    expect(box?.ForcedSortName).toBe('!00_Thanksgiving Movies');
    // Activity shows it, and the addition can be undone.
    const activity = await (await t.web.request('/activity', { headers: { cookie } })).text();
    expect(activity).toContain('Planes, Trains and Automobiles');
    const tgId = (t.app.db.$client.prepare("select id from definition where slug = 'seasonal-thanksgiving'").get() as { id: number }).id;
    const preview = await (await t.web.request(`/collections/${tgId}/preview`, { headers: { cookie } })).text();
    expect(preview).toContain('Planes, Trains and Automobiles');
    expect(preview).toContain('in box set');
    const editor = await t.web.request(`/collections/${tgId}`, { headers: { cookie } });
    expect(editor.status).toBe(200);
    // Plex parity: not connected, then connected (Plex has 3 Thanksgiving films; 1 of them is owned here).
    expect(await (await t.web.request(`/collections/${tgId}/parity`, { headers: { cookie } })).text()).toContain('Connect Plex');
    t.app.updateSettings({ connections: { ...t.app.settings().connections, plexUrl: 'http://plex.test:32400' } });
    t.app.secrets.set('plex.token', 'plex-token');
    const par = await (await t.web.request(`/collections/${tgId}/parity`, { headers: { cookie } })).text();
    expect(par).toMatch(/<b class="num">3<\/b> in Plex · <b class="num">1<\/b> planned here · <b class="num">1<\/b> in both/);
    expect(par).toContain('In Plex, not in your Jellyfin library (2)');
  });

  it('reads libraries for Settings when none are known yet', async () => {
    await t.web.request('/setup', form({ url: FAKE_URL, apiKey: t.fake.apiKey, setupCode: t.app.setupCode ?? '' }));
    const { cookie } = await signIn(t.web);
    t.app.db.$client.prepare('delete from library').run();
    const html = await (await t.web.request('/settings', { headers: { cookie } })).text();
    const names = t.fake.libraries.filter((l) => l.CollectionType === 'movies').map((l) => l.Name!);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(html).toContain(`value="${t.fake.libraries.find((l) => l.Name === n)!.ItemId}"`);
    expect(html).not.toContain('Couldn’t read your libraries');
  });

  it('creates a custom collection, edits its sources, and deletes it', async () => {
    await t.web.request('/setup', form({ url: FAKE_URL, apiKey: t.fake.apiKey, setupCode: t.app.setupCode ?? '' }));
    const { cookie } = await signIn(t.web);
    const csrf = await csrfOf(t.web, cookie, '/collections/new');
    const post = (path: string, data: Record<string, string>) => t.web.request(path, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf, ...data }).toString() });
    const bad = await post('/collections/new', { name: 'Heists', target: 'movies', schedule: 'always', type: 'imdb_list', value: 'not a list' });
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain('Enter an IMDb list ID');
    const res = await post('/collections/new', { name: 'Heist Movies', target: 'movies', schedule: 'range', from: '12/26', to: '01/04', type: 'imdb_list', value: 'https://www.imdb.com/list/ls066838460/' });
    expect(res.status).toBe(302);
    const id = Number(res.headers.get('location')!.match(/\/collections\/(\d+)/)![1]);
    const row = t.app.db.$client.prepare('select slug, window, preset_key from definition where id = ?').get(id) as { slug: string; window: string; preset_key: string | null };
    expect(row).toMatchObject({ slug: 'custom-heist-movies', preset_key: null });
    expect(JSON.parse(row.window)).toEqual({ type: 'range', from: '12/26', to: '01/04' });
    const editor = await (await t.web.request(`/collections/${id}`, { headers: { cookie } })).text();
    expect(editor).toContain('IMDb list ls066838460');
    expect(editor).toContain('Delete collection');
    // Add a second source, make it a suggestion, then remove the first.
    expect(flash(await post(`/collections/${id}/sources`, { op: 'add', type: 'tmdb_keyword', value: 'heist', role: 'add' }))).toContain('Added TMDb keyword heist');
    expect(flash(await post(`/collections/${id}/sources`, { op: 'add', type: 'tmdb_keyword', value: 'heist', role: 'add' }))).toContain('already on this collection');
    const srcs = () => t.app.db.$client.prepare('select id, type, role from definition_source where definition_id = ? order by position').all(id) as { id: number; type: string; role: string }[];
    expect(srcs().map((x) => x.type)).toEqual(['imdb_list', 'tmdb_keyword']);
    await post(`/collections/${id}/sources`, { op: `role:${srcs()[1]!.id}:suggest` });
    expect(srcs()[1]!.role).toBe('suggest');
    await post(`/collections/${id}/sources`, { op: `remove:${srcs()[0]!.id}` });
    expect(srcs().map((x) => x.type)).toEqual(['tmdb_keyword']);
    // Always on, then delete.
    await post(`/collections/${id}`, { name: 'Heist Movies', enabled: '1', minItems: '1', syncMode: 'sync', schedule: 'always' });
    expect((t.app.db.$client.prepare('select window from definition where id = ?').get(id) as { window: string | null }).window).toBeNull();
    expect(flash(await post(`/collections/${id}/delete`, {}))).toContain('Deleted Heist Movies');
    expect(t.app.db.$client.prepare('select count(*) n from definition_source where definition_id = ?').get(id)).toEqual({ n: 0 });
    // Presets can't be deleted.
    const tg = (t.app.db.$client.prepare("select id from definition where slug = 'seasonal-thanksgiving'").get() as { id: number }).id;
    expect(flash(await post(`/collections/${tg}/delete`, {}))).toContain('can’t be deleted');
  });

  it('saves settings with validation', async () => {
    await t.web.request('/setup', form({ url: FAKE_URL, apiKey: t.fake.apiKey, setupCode: t.app.setupCode ?? '' }));
    const { cookie } = await signIn(t.web);
    const csrf = await csrfOf(t.web, cookie, '/settings');
    const post = (data: Record<string, string>) => t.web.request('/settings/general', { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf, ...data }).toString() });
    const bad = await post({ leadDays: '14', timezone: 'Mars/Olympus', arrCapPerRun: '10' });
    expect(flash(bad)).toContain('Unknown timezone');
    await post({ leadDays: '10', timezone: 'America/Chicago', arrCapPerRun: '5', neighbours: 'Kometa (Plex) 05:00\nJellyfin-Auto-Collections 04:00' });
    const s = t.app.settings();
    expect(s).toMatchObject({ dryRun: false, leadDays: 10, timezone: 'America/Chicago' });
    expect(s.neighbours).toEqual([{ name: 'Kometa (Plex)', time: '05:00' }, { name: 'Jellyfin-Auto-Collections', time: '04:00' }]);
  });
});

export type { AppContext };
