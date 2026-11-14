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
    const get = async (path: string) => (await t.web.request(path, { headers: { cookie } })).text();
    // One step is open at a time, starting with the first that isn't done, and the guide has its own place in the menu.
    const first = await get('/start');
    expect(first).toContain('Getting started');
    expect(first).toContain('Animated Classics');
    expect(first).toMatch(/<a href="\/start" aria-current="page"/);
    expect(first.match(/class="step-body"/g)).toHaveLength(1);
    expect(first).not.toContain('27 TV franchises');
    // Each family says what its count means (collections it can make, not titles found) and its minimum.
    const page = await get('/start?step=4');
    expect(page).toContain('27 TV franchises (Star Trek, NCIS, One Chicago…), one collection each');
    expect(page).toContain('at least 2 of its shows');
    expect(page).not.toContain('Kometa');
    expect(await get('/')).toContain('Finish setting up');
    // Libraries step goes on to the next step; timezone is chosen from a list and validated.
    const libRes = await post('/settings/libraries', { movieLibraryIds: ['lib-movies'], showLibraryIds: ['lib-shows'], next: '/start?step=2' });
    expect(libRes.headers.get('location')).toBe('/start?step=2');
    expect(await get('/start?step=2')).toMatch(/<select id="st-tz" name="timezone">[\s\S]*<option value="Europe\/London"/);
    expect(t.app.settings().movieLibraryIds).toEqual(['lib-movies']);
    expect(t.app.settings().showLibraryIds).toBeNull(); // every TV library ticked = all, including ones added later
    await post('/settings/libraries', { movieLibraryIds: ['lib-movies', 'lib-animated'], showLibraryIds: ['lib-shows'], next: '/start?step=2' });
    expect(t.app.settings().movieLibraryIds).toBeNull();
    expect(flash(await post('/start/timezone', { timezone: 'Mars/Olympus' }))).toMatch(/Unknown timezone/);
    expect((await post('/start/timezone', { timezone: 'Europe/London' })).headers.get('location')).toBe('/start?step=3');
    expect(t.app.settings().timezone).toBe('Europe/London');
    // The TMDb key can be skipped; the step still counts as done.
    expect((await post('/start/tmdb', { key: '' })).headers.get('location')).toMatch(/^\/start\?step=4/);
    // Families: universes on, holiday episodes off.
    await post('/start/families', { families: ['seasonal', 'universe'] });
    const enabled = (prefix: string) => (t.app.db.$client.prepare(`select count(*) n from definition where preset_key like '${prefix}:%' and enabled = 1`).get() as { n: number }).n;
    expect([enabled('seasonal'), enabled('holiday_episodes'), enabled('universe'), enabled('show_franchise')]).toEqual([19, 0, 17, 0]);
    expect(t.app.settings().filmSeries.enabled).toBe(false);
    expect(page).toContain('One collection for each movie series');
    await post('/start/families', { families: ['seasonal', 'universe', 'film_series'] });
    expect(t.app.settings().filmSeries.enabled).toBe(true); // one switch; the next run adds the series
    expect(t.app.settings().onboarding.done.sort()).toEqual(['families', 'libraries', 'timezone', 'tmdb']);
    // Jellyfin has nothing under these names, so "Collections already in Jellyfin" finishes itself and the last step opens.
    const last = await get('/start');
    expect(last).toMatch(/aria-current="step"[^>]*>[\s\S]*Your first changes/);
    expect(last).toContain('Nothing to do');
    // Finish: the banner and the menu item go, and the next sign-in lands on Home. "next" only goes to a page of the app.
    expect((await post('/start/finish', { next: 'https://example.com/' })).headers.get('location')).toBe('/');
    expect((await post('/start/finish', { next: '/review' })).headers.get('location')).toBe('/review');
    expect(await get('/')).not.toContain('href="/start"');
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
    const r = await t.web.request('/settings/approvals', { ...form({ dryRun: '0', leadDays: '14', arrCapPerRun: '10' }), headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' } });
    expect(r.status).toBe(403);
    expect(t.app.settings().dryRun).toBe(true);
  });

  it('renders every page, runs, and approves from the Inbox', async () => {
    await t.web.request('/setup', form({ url: FAKE_URL, apiKey: t.fake.apiKey, setupCode: t.app.setupCode ?? '' }));
    const { cookie } = await signIn(t.web);
    const csrf = await csrfOf(t.web, cookie);
    expect(csrf).toHaveLength(32);
    for (const p of ['/', '/collections', '/review', '/review?tab=dismissed', '/health', '/missing', '/activity', '/adoption', '/settings', '/settings/libraries', '/settings/approvals', '/settings/schedule', '/settings/extras', '/settings/advanced']) {
      const r = await t.web.request(p, { headers: { cookie } });
      expect(r.status, p).toBe(200);
      expect(r.headers.get('content-security-policy')).toContain("default-src 'self'");
    }
    // Before any run, Home and the Inbox say so and offer the run, rather than an empty plan.
    const before = await (await t.web.request('/', { headers: { cookie } })).text();
    expect(before).toContain('Start your first run');
    expect(before).not.toContain('goes away'); // nothing is in Jellyfin yet, so nothing can go away
    expect(await (await t.web.request('/review', { headers: { cookie } })).text()).toContain('Nothing to approve yet');
    // A run while approving everything first proposes Thanksgiving (window open on 17 Nov) without touching Jellyfin.
    await runPipeline(t.app, { job: 'manual', trigger: 'manual', index: true, now: Date.UTC(2026, 10, 17, 15) });
    expect(t.fake.boxSets()).toHaveLength(0);
    // The timetable lists closings only for collections that are or will be live.
    const dash = dashboardModel(t.app, Date.UTC(2026, 10, 17, 15));
    const closes = dash.timetable.filter((c) => c.kind === 'closes').map((c) => c.def.slug);
    expect(closes).toEqual(['seasonal-thanksgiving']);
    expect(dash.timetable.some((c) => c.kind === 'opens' && c.def.slug === 'seasonal-christmas')).toBe(true);
    const review = await (await t.web.request('/review', { headers: { cookie } })).text();
    expect(review).toContain('Thanksgiving Movies');
    expect(review).toContain('You’re approving everything first');
    expect(review).toMatch(/name="group" value="approve:\d+"[^>]*>.*Approve all 3/);
    expect(review).toMatch(/<span class="n num">3<\/span>/); // the Inbox's Collection changes tab
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
    expect(preview).toContain('in Jellyfin');
    const editor = await t.web.request(`/collections/${tgId}`, { headers: { cookie } });
    expect(editor.status).toBe(200);
    // The collection opens on what it is and what's in it; the rest is behind tabs, all under one Save.
    const edHtml = await editor.text();
    expect(edHtml).toContain('In Jellyfin now, with 1 title.');
    expect(edHtml).toMatch(/data-tab="titles" aria-current="page"/);
    expect(edHtml).toMatch(/<div data-panel="advanced" hidden/);
    expect(edHtml.match(/>Save changes</g)).toHaveLength(1);
    expect(await (await t.web.request(`/collections/${tgId}?tab=advanced`, { headers: { cookie } })).text()).toMatch(/<div data-panel="titles" hidden/);
    // Home, once something has been approved, offers once to stop asking about routine changes.
    t.app.updateSettings({ onboarding: { ...t.app.settings().onboarding, finished: true } });
    expect(await (await t.web.request('/', { headers: { cookie } })).text()).toContain('Let routine changes happen by themselves?');
    const keep = await t.web.request('/start/automatic', { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf, choice: 'no' }).toString() });
    expect(flash(keep)).toContain('Nothing changes');
    expect(t.app.settings().dryRun).toBe(true);
    expect(await (await t.web.request('/', { headers: { cookie } })).text()).not.toContain('Let routine changes happen by themselves?');
    // Plex parity: not connected, then connected (Plex has 3 Thanksgiving films; 1 of them is owned here).
    expect(await (await t.web.request(`/collections/${tgId}/parity`, { headers: { cookie } })).text()).toContain('Connect Plex');
    t.app.updateSettings({ connections: { ...t.app.settings().connections, plexUrl: 'http://plex.test:32400' } });
    t.app.secrets.set('plex.token', 'plex-token');
    const par = await (await t.web.request(`/collections/${tgId}/parity`, { headers: { cookie } })).text();
    expect(par).toMatch(/<b class="num">3<\/b> in Plex · <b class="num">1<\/b> planned here · <b class="num">1<\/b> in both/);
    expect(par).toContain('In Plex, not in your Jellyfin library (2)');
  });

  it('reads libraries for Settings and the guide when none are known yet', async () => {
    await t.web.request('/setup', form({ url: FAKE_URL, apiKey: t.fake.apiKey, setupCode: t.app.setupCode ?? '' }));
    const { cookie } = await signIn(t.web);
    t.app.db.$client.prepare('delete from library').run();
    const html = await (await t.web.request('/settings/libraries', { headers: { cookie } })).text();
    const names = t.fake.libraries.filter((l) => l.CollectionType === 'movies').map((l) => l.Name!);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(html).toContain(`value="${t.fake.libraries.find((l) => l.Name === n)!.ItemId}"`);
    expect(html).not.toContain('Couldn’t read your libraries');
    // The guide does the same, and says why when Jellyfin can't be read instead of showing an empty step.
    t.app.db.$client.prepare('delete from library').run();
    expect(await (await t.web.request('/start?step=1', { headers: { cookie } })).text()).toContain('value="lib-movies"');
    t.app.db.$client.prepare('delete from library').run();
    t.app.secrets.set('jellyfin.apiKey', 'wrong-key');
    const broken = await (await t.web.request('/start?step=1', { headers: { cookie } })).text();
    expect(broken).toContain('Couldn’t read your libraries from Jellyfin');
    expect(broken).not.toContain('name="movieLibraryIds"');
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
    const saved = await post(`/collections/${id}`, { name: 'Heist Movies', enabled: '1', minItems: '1', syncMode: 'sync', schedule: 'always', tab: 'dates', posterForm: '1', poster: 'none' });
    expect(saved.headers.get('location')).toMatch(new RegExp(`^/collections/${id}\\?tab=dates&ok=Saved`)); // back on the tab it was saved from
    expect(flash(saved)).not.toContain('Poster'); // the poster wasn't changed, so it isn't set again
    expect((t.app.db.$client.prepare('select window from definition where id = ?').get(id) as { window: string | null }).window).toBeNull();
    // The poster is part of the same Save. One that can't be read doesn't lose the rest of what was saved.
    const withPoster = await post(`/collections/${id}`, { name: 'Heists', enabled: '1', minItems: '1', syncMode: 'sync', schedule: 'always', posterForm: '1', poster: 'url', posterUrl: 'https://example.com/Default-Images/heist.jpg' });
    expect(flash(withPoster)).toContain('Saved, but the poster wasn’t changed');
    expect((t.app.db.$client.prepare('select name from definition where id = ?').get(id) as { name: string }).name).toBe('Heists');
    await post(`/collections/${id}`, { name: 'Heist Movies', enabled: '1', minItems: '1', syncMode: 'sync', schedule: 'always' });
    expect(flash(await post(`/collections/${id}/delete`, {}))).toContain('Deleted Heist Movies');
    expect(t.app.db.$client.prepare('select count(*) n from definition_source where definition_id = ?').get(id)).toEqual({ n: 0 });
    // Presets can't be deleted.
    const tg = (t.app.db.$client.prepare("select id from definition where slug = 'seasonal-thanksgiving'").get() as { id: number }).id;
    expect(flash(await post(`/collections/${tg}/delete`, {}))).toContain('can’t be deleted');
  });

  it('saves each Settings page on its own, with validation', async () => {
    await t.web.request('/setup', form({ url: FAKE_URL, apiKey: t.fake.apiKey, setupCode: t.app.setupCode ?? '' }));
    const { cookie } = await signIn(t.web);
    const csrf = await csrfOf(t.web, cookie, '/settings');
    const post = (path: string, data: Record<string, string>) => t.web.request(path, { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ _csrf: csrf, ...data }).toString() });
    // Each page marks itself in the side menu, and has one Save.
    for (const [path, label] of [['/settings', 'Connections'], ['/settings/libraries', 'Libraries and region'], ['/settings/approvals', 'Approvals'], ['/settings/schedule', 'Schedule'], ['/settings/extras', 'Extras'], ['/settings/advanced', 'Advanced']] as const) {
      const html = await (await t.web.request(path, { headers: { cookie } })).text();
      expect(html, path).toContain(`<a href="${path}" aria-current="page">${label}</a>`);
    }
    // Libraries and region: the timezone is checked, and a bad one saves nothing.
    const bad = await post('/settings/libraries', { regionForm: '1', movieLibraryIds: 'lib-movies', timezone: 'Mars/Olympus', streamingRegion: 'GB' });
    expect(flash(bad)).toContain('Unknown timezone');
    expect(t.app.settings().streaming.region).toBe('US');
    await post('/settings/libraries', { regionForm: '1', movieLibraryIds: 'lib-movies', showLibraryIds: 'lib-shows', timezone: 'America/Chicago', streamingRegion: 'gb' });
    expect(t.app.settings()).toMatchObject({ timezone: 'America/Chicago', movieLibraryIds: ['lib-movies'], streaming: { region: 'GB' } });
    // Approvals: "Approve everything first" off, one kind of change set to Never, and the limits.
    const approvals = await (await t.web.request('/settings/approvals', { headers: { cookie } })).text();
    expect(approvals).toContain('Approve everything first');
    expect(approvals).toMatch(/>Never<\/label>[\s\S]*>Ask me<\/label>[\s\S]*>Automatic<\/label>/);
    expect(flash(await post('/settings/approvals', { dryRun: '0', 'mode:collection.remove_items': 'off', leadDays: '10', arrCapPerRun: '5', defaultSnooze: '7d' }))).toContain('Approvals saved');
    const s = t.app.settings();
    expect(s).toMatchObject({ dryRun: false, leadDays: 10, defaultSnooze: '7d', guardrails: { arrCapPerRun: 5, releasedOnly: false } });
    expect(s.modes['collection.remove_items']).toBe('off');
    expect(s.modes['collection.add_items']).toBe('auto'); // left as it was
    expect(flash(await post('/settings/approvals', { dryRun: '1', leadDays: '99', arrCapPerRun: '5' }))).toContain('Plan ahead must be 0–60 days');
    expect(t.app.settings().dryRun).toBe(false);
    // Schedule: each job says when it runs in words; other tools' times are kept beside them.
    const schedule = await (await t.web.request('/settings/schedule', { headers: { cookie } })).text();
    expect(schedule).toContain('Every day at 02:30');
    expect(schedule).toContain('Every Sunday at 03:10');
    await post('/settings/schedules', { 'cron:nightly-refresh': '15 4 * * *', 'on:nightly-refresh': '1', 'on:window-check': '1', neighboursForm: '1', neighbours: 'Kometa (Plex) 05:00\nJellyfin-Auto-Collections 04:00' });
    expect(t.app.settings().neighbours).toEqual([{ name: 'Kometa (Plex)', time: '05:00' }, { name: 'Jellyfin-Auto-Collections', time: '04:00' }]);
    expect(await (await t.web.request('/settings/schedule', { headers: { cookie } })).text()).toContain('Every day at 04:15');
    expect(flash(await post('/settings/schedules', { 'cron:nightly-refresh': 'whenever' }))).toContain('isn’t a schedule the app can read');
    // Extras: Library health off takes its tab out of the Inbox.
    expect(await (await t.web.request('/review', { headers: { cookie } })).text()).toContain('href="/health"');
    await post('/settings/health', {});
    expect(t.app.settings().health.enabled).toBe(false);
    expect(await (await t.web.request('/review', { headers: { cookie } })).text()).not.toContain('href="/health"');
    // Advanced: the snapshot needs its address.
    expect(flash(await post('/settings/advanced', { imdbRoute: 'snapshot', snapshotUrl: '' }))).toContain('needs a snapshot URL');
    await post('/settings/advanced', { imdbRoute: 'direct', snapshotUrl: '', mediaSent: '1', mediaEnabled: '1', mediaDir: '/media' });
    expect(t.app.settings().media.enabled).toBe(true);
  });
});

export type { AppContext };
