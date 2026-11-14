// Claude access (ADR-032): tokens made in Settings, the /mcp endpoint's auth, and its tools driven by a real MCP client.
import { describe, it, expect, beforeEach } from 'vitest';
import type { Hono } from 'hono';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { runPipeline } from '../src/pipeline/run.js';
import { FAKE_URL } from './fakes/jellyfin.js';
import { setup, flash, form, signIn, csrfOf } from './helpers/web.js';

const MCP = 'http://localhost:8097/mcp';

async function connect(web: Hono, token: string): Promise<Client> {
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(MCP), {
    fetch: async (url, init) => web.request(String(url), init),
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

const text = (r: unknown) => ((r as { content: { type: string; text: string }[] }).content[0]?.text ?? '');
const json = (r: unknown) => JSON.parse(text(r));

/** Signed-in admin who creates a token in Settings; returns the token as the page shows it once. */
async function makeToken(t: ReturnType<typeof setup>, name: string, scope: 'read' | 'review' | 'full') {
  const { cookie } = await signIn(t.web);
  const csrf = await csrfOf(t.web, cookie, '/settings/advanced');
  const res = await t.web.request('/settings/claude', { ...form({ _csrf: csrf, name, scope }), headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' } });
  expect(flash(res)).toContain(`Token “${name}” created`);
  const page = await (await t.web.request('/settings/advanced', { headers: { cookie } })).text();
  const token = page.match(/>(mjc_[A-Za-z0-9_-]{43})</)?.[1] ?? '';
  return { token, cookie, csrf, page };
}

describe('Claude access (MCP)', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(async () => {
    t = setup();
    await t.web.request('/setup', form({ url: FAKE_URL, apiKey: t.fake.apiKey, setupCode: t.app.setupCode ?? '' }));
  });

  it('shows a new token once, stores only its hash, and connection commands use it', async () => {
    const { token, cookie, page } = await makeToken(t, 'Laptop', 'review');
    expect(token).toMatch(/^mjc_/);
    expect(page).toContain('claude mcp add --transport http maverick http://localhost/mcp --header &quot;Authorization: Bearer ' + token);
    expect(page).toContain('mcp-remote');
    const again = await (await t.web.request('/settings/advanced', { headers: { cookie } })).text();
    expect(again).not.toContain(token);
    expect(again).toContain('Laptop');
    expect(again).toContain(`mjc_…${token.slice(-4)}`);
    const stored = t.app.db.$client.prepare('select * from api_token').all() as { hash: string }[];
    expect(stored).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it('refuses requests without a valid token, from other sites, or after too many wrong tokens', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    const none = await t.web.request(MCP, { method: 'POST', headers, body });
    expect(none.status).toBe(401);
    expect(none.headers.get('www-authenticate')).toContain('Bearer');
    const { token } = await makeToken(t, 'Laptop', 'read');
    const crossSite = await t.web.request(MCP, { method: 'POST', headers: { ...headers, authorization: `Bearer ${token}`, origin: 'https://evil.example' }, body });
    expect(crossSite.status).toBe(403);
    expect((await t.web.request(MCP, { headers: { authorization: `Bearer ${token}` } })).status).toBe(405);
    // The tokenless request above was the first failure; nine more reach the limit of ten.
    for (let i = 0; i < 9; i++) expect((await t.web.request(MCP, { method: 'POST', headers: { ...headers, authorization: 'Bearer mjc_wrong' }, body })).status).toBe(401);
    expect((await t.web.request(MCP, { method: 'POST', headers: { ...headers, authorization: `Bearer ${token}` }, body })).status).toBe(429);
  });

  it('gives a read-only token the reading tools only', async () => {
    const { token } = await makeToken(t, 'Reader', 'read');
    const client = await connect(t.web, token);
    const names = (await client.listTools()).tools.map((x) => x.name).sort();
    expect(names).toEqual(['compare_with_plex', 'explain_collection', 'get_collection', 'get_radarr_sonarr_options', 'get_run', 'get_settings', 'get_status', 'list_activity', 'list_collections', 'list_existing_box_sets', 'list_library_health', 'list_missing', 'list_review']);
    expect(json(await client.callTool({ name: 'list_library_health', arguments: {} }))).toEqual({ checking: true, findings: [], markedFineCount: 0, artworkFixedLast30Days: [] });
    const status = json(await client.callTool({ name: 'get_status', arguments: {} }));
    expect(status.app.dryRun).toBe(true);
    expect(status.app.timezone).toBe('America/New_York');
    expect(status.jellyfin.connected).toBe(true);
    await client.close();
  });

  it('lets a review token read the queue, approve (which applies), dismiss, and start a run; revoking cuts it off', async () => {
    const { token, cookie, csrf } = await makeToken(t, 'Laptop', 'review');
    await runPipeline(t.app, { job: 'manual', trigger: 'manual', index: true, now: Date.UTC(2026, 10, 17, 15) });
    const client = await connect(t.web, token);
    const reviewTools = (await client.listTools()).tools.map((x) => x.name);
    expect(reviewTools).toContain('approve_proposals');
    expect(reviewTools).not.toContain('update_settings');
    expect(reviewTools).not.toContain('apply_poster_overlays');
    expect(reviewTools).toContain('mark_library_health_fine');

    const queue = json(await client.callTool({ name: 'list_review', arguments: {} }));
    expect(queue.total).toBe(3);
    expect(queue.proposals.map((p: { change: string }) => p.change).sort()).toEqual(['Add items', 'Create box set', 'Update metadata']);
    expect(queue.proposals.find((p: { change: string }) => p.change === 'Add items').title).toBe('Planes, Trains and Automobiles (1987)');

    const tg = json(await client.callTool({ name: 'list_collections', arguments: { only: 'on' } })).find((c: { name: string }) => c.name === 'Thanksgiving Movies');
    const detail = json(await client.callTool({ name: 'get_collection', arguments: { id: tg.id } }));
    expect(detail.titles.list).toEqual([{ id: 'm-ptna', name: 'Planes, Trains and Automobiles', year: 1987, pinned: false }]);
    expect(detail.waitingInReview).toHaveLength(3);

    // Approving applies straight away, even in dry run, exactly as the Review page does.
    const approved = await client.callTool({ name: 'approve_proposals', arguments: { ids: queue.proposals.map((p: { id: number }) => p.id) } });
    expect(text(approved)).toContain('Applied 3');
    expect(t.fake.boxSets().find((b) => b.Name === 'Thanksgiving Movies')?.children).toEqual(['m-ptna']);
    const activity = json(await client.callTool({ name: 'list_activity', arguments: {} }));
    expect(activity.changes[0].decidedBy).toBe('Claude (Laptop)');

    const empty = await client.callTool({ name: 'approve_proposals', arguments: { ids: [999999] } });
    expect(text(empty)).toContain('Nothing to approve');
    const bad = await client.callTool({ name: 'get_collection', arguments: { id: 999999 } });
    expect(bad.isError).toBe(true);

    const started = json(await client.callTool({ name: 'start_run', arguments: {} }));
    expect(started.started).toBe(true);
    await client.close();

    // Revoke it in Settings: the endpoint refuses it from then on.
    const id = (t.app.db.$client.prepare('select id from api_token').get() as { id: number }).id;
    const res = await t.web.request(`/settings/claude/${id}/revoke`, { ...form({ _csrf: csrf }), headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' } });
    expect(flash(res)).toContain('Revoked “Laptop”');
    await expect(connect(t.web, token)).rejects.toThrow();
  });

  it('lets a full-control token change settings, schedules and collections, but never connections or keys', async () => {
    const { token } = await makeToken(t, 'Desk', 'full');
    const client = await connect(t.web, token);
    const tools = (await client.listTools()).tools.map((x) => x.name);
    expect(tools).toEqual(expect.arrayContaining(['update_settings', 'set_schedule', 'set_collection_enabled', 'set_family_enabled', 'approve_proposals', 'mark_library_health_fine']));

    const before = json(await client.callTool({ name: 'get_settings', arguments: {} }));
    expect(before.dryRun).toBe(true);
    expect(before.connections.jellyfin.keySaved).toBe(true);
    expect(JSON.stringify(before)).not.toContain(t.fake.apiKey);
    expect(before.libraries.films.map((l: { name: string }) => l.name)).toContain('Animated Classics');

    // Several settings at once; libraries by name; the result says what changed.
    const saved = await client.callTool({ name: 'update_settings', arguments: { dryRun: false, timezone: 'Europe/London', planAheadDays: 7, actionModes: { 'collection.remove_items': 'auto' }, filmLibraries: ['Movies'] } });
    expect(saved.isError).toBeFalsy();
    expect(text(saved)).toContain('dryRun: true → false');
    const s = t.app.settings();
    expect(s).toMatchObject({ dryRun: false, timezone: 'Europe/London', leadDays: 7, movieLibraryIds: ['lib-movies'] });
    expect(s.modes['collection.remove_items']).toBe('auto');

    // Checked exactly as the Settings page checks, and nothing is saved when any part is wrong.
    const bad = await client.callTool({ name: 'update_settings', arguments: { planAheadDays: 3, timezone: 'Mars/Olympus' } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toContain('Unknown timezone');
    expect(t.app.settings().leadDays).toBe(7);
    expect((await client.callTool({ name: 'update_settings', arguments: { filmLibraries: ['Nope'] } })).isError).toBe(true);
    // Poster overlays (ADR-039): chosen through update_settings, applied or removed with their own tools.
    expect(text(await client.callTool({ name: 'update_settings', arguments: { posterOverlays: { status: true } } }))).toContain('"status":true');
    expect(json(await client.callTool({ name: 'get_settings', arguments: {} })).posterOverlays).toMatchObject({ status: true, imdbTop250Ribbon: false, postersWithOverlays: 0 });
    expect(tools).toEqual(expect.arrayContaining(['apply_poster_overlays', 'remove_poster_overlays']));
    // The streaming country (ADR-036).
    expect(text(await client.callTool({ name: 'update_settings', arguments: { streamingCountry: 'ca' } }))).toContain('"region":"CA"');
    expect(json(await client.callTool({ name: 'get_settings', arguments: {} })).streamingCountry).toBe('CA');
    expect((await client.callTool({ name: 'update_settings', arguments: { streamingCountry: 'Canada' } })).isError).toBe(true);

    expect(text(await client.callTool({ name: 'set_schedule', arguments: { job: 'nightly-refresh', cron: '15 4 * * *' } }))).toContain('15 4 * * *, on');
    expect((await client.callTool({ name: 'set_schedule', arguments: { job: 'nightly-refresh', cron: 'whenever' } })).isError).toBe(true);

    const universe = json(await client.callTool({ name: 'list_collections', arguments: {} })).find((c: { kind: string; on: boolean }) => c.kind === 'Universes' && !c.on);
    expect(text(await client.callTool({ name: 'set_collection_enabled', arguments: { id: universe.id, on: true } }))).toContain('is on');
    expect(json(await client.callTool({ name: 'get_collection', arguments: { id: universe.id } })).on).toBe(true);
    // A whole family at once, with the All on rules: the streaming country (set to Canada above) picks the services.
    expect(text(await client.callTool({ name: 'set_family_enabled', arguments: { family: 'streaming', on: true } }))).toMatch(/^Streaming services: \d+ turned on\./);
    const on = json(await client.callTool({ name: 'list_collections', arguments: { only: 'on' } })).map((c: { name: string }) => c.name);
    expect(on).toContain('Crave Shows');
    expect(on).not.toContain('Channel 4 Shows');
    expect(text(await client.callTool({ name: 'set_family_enabled', arguments: { family: 'film_series', on: true } }))).toContain('Movie series');
    expect(t.app.settings().filmSeries.enabled).toBe(true);
    expect((await client.callTool({ name: 'set_family_enabled', arguments: { family: 'nope', on: true } })).isError).toBe(true);
    // Library health in the overview.
    expect(json(await client.callTool({ name: 'get_status', arguments: {} })).libraryHealth).toMatchObject({ checking: true, openFindings: 0, openByKind: { runtime: 0, title: 0 } });
    // Marking findings fine takes several at once, or a whole show.
    expect(text(await client.callTool({ name: 'mark_library_health_fine', arguments: {} }))).toContain('Give id');
    expect(text(await client.callTool({ name: 'mark_library_health_fine', arguments: { ids: ['nope-1', 'nope-2'] } }))).toContain('No open findings matched');
    await client.close();
  });

  it('lets full control do what the pages do: collections, sources, filters, titles, undo and Radarr/Sonarr defaults', async () => {
    const { token } = await makeToken(t, 'Desk', 'full');
    await runPipeline(t.app, { job: 'manual', trigger: 'manual', index: true, now: Date.UTC(2026, 10, 17, 15) });
    const client = await connect(t.web, token);
    const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });

    // A collection of your own, then its dates, filters and sources.
    const created = text(await call('create_collection', { name: 'Feel-good', contains: 'movies', sourceType: 'imdb_list', sourceValue: 'ls000000001' }));
    const id = Number(created.match(/id (\d+)/)![1]);
    expect(text(await call('update_collection', { id, dates: { from: '12/01', to: '12/24' }, minimumTitles: 2, filters: { yearFrom: 1980, genresExclude: ['Horror'] } }))).toContain('Saved');
    expect((await call('update_collection', { id, dates: { from: '13/01', to: '12/24' } })).isError).toBe(true);
    expect((await call('update_collection', { id, filters: { maxRating: 'X' } })).isError).toBe(true);
    expect(text(await call('add_collection_source', { id, sourceType: 'imdb_keyword', sourceValue: 'feel-good' }))).toContain('Added');
    const detail = json(await call('get_collection', { id }));
    expect(detail).toMatchObject({ dates: '12/01 to 12/24', minimumTitles: 2, filters: { yearFrom: 1980, genresExclude: ['Horror'] } });
    expect(detail.sources).toHaveLength(2);
    expect(text(await call('remove_collection_source', { id, sourceId: detail.sources[1].sourceId }))).toContain('Removed');
    expect(text(await call('delete_collection', { id }))).toContain('Deleted Feel-good');

    // Why titles are in or out, and excluding one.
    const tg = json(await call('list_collections')).find((c: { name: string }) => c.name === 'Thanksgiving Movies');
    const why = json(await call('explain_collection', { id: tg.id, search: 'planes' }));
    expect(why.sources[0].counts).toEqual({ member: 1 });
    expect(why.sources[0].titles[0]).toMatchObject({ title: 'Planes, Trains and Automobiles', verdict: 'member' });
    expect(text(await call('pin_or_exclude_title', { id: tg.id, title: 'Planes, Trains and Automobiles', rule: 'exclude' }))).toContain('Left out');
    expect(json(await call('explain_collection', { id: tg.id })).sources[0].counts).toEqual({ excluded: 1 });
    expect(text(await call('pin_or_exclude_title', { id: tg.id, title: 'Planes, Trains and Automobiles', rule: 'clear' }))).toContain('Back to following the sources');
    expect((await call('delete_collection', { id: tg.id })).isError).toBe(true); // presets can only be turned off

    // Approve, then undo the addition.
    const queue = json(await call('list_review', { collectionId: tg.id }));
    await call('approve_proposals', { ids: queue.proposals.map((x: { id: number }) => x.id) });
    const added = json(await call('list_activity')).changes.find((c: { change: string }) => c.change === 'Add items');
    expect(text(await call('undo_change', { activityId: added.id }))).toBeTruthy();
    expect(t.fake.boxSets().find((b) => b.Name === 'Thanksgiving Movies')?.children ?? []).toEqual([]);

    expect(json(await call('list_existing_box_sets'))).toEqual([]);
    expect(json(await call('get_radarr_sonarr_options'))).toEqual({ radarr: 'not connected', sonarr: 'not connected' });
    expect(text(await call('update_radarr_sonarr_defaults', { app: 'radarr', minimumAvailability: 'announced' }))).toContain('"minimumAvailability":"announced"');
    expect(t.app.settings().arr.radarr.minimumAvailability).toBe('announced');
    expect((await call('sync_home_rows')).isError).toBe(true); // rows are off
    await client.close();
  });
});
