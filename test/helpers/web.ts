// Shared by the web and MCP tests: an app on an in-memory database, a fake Jellyfin and stubbed list sources.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { openDb } from '../../src/db/index.js';
import { createContext } from '../../src/app-context.js';
import { readConfig } from '../../src/config.js';
import { createWeb } from '../../src/web/app.js';
import type { FetchLike } from '../../src/clients/http.js';
import { FakeJellyfin, FAKE_URL } from '../fakes/jellyfin.js';
import { fakePlex } from '../fakes/plex.js';

export function setup() {
  const fake = new FakeJellyfin();
  fake.users.push({ Id: 'viewer-1', Name: 'kid', Password: 'pw2', Policy: { IsAdministrator: false, BlockedTags: [] } });
  fake.add({ Id: 'm-ptna', Name: 'Planes, Trains and Automobiles', Type: 'Movie', ParentId: 'lib-movies', ProductionYear: 1987, ProviderIds: { Imdb: 'tt0093748' } });
  const jfFetch = fake.fetch();
  const net: FetchLike = async (url, init) => {
    if (url.startsWith(FAKE_URL)) return jfFetch(url, init);
    if (url.includes('IMDb-Hash')) return new Response('h');
    if (url.startsWith('https://api.graphql.imdb.com')) {
      const body = JSON.parse(String(init?.body));
      const ids = (body.variables.keywordConstraint?.anyKeywords ?? []).includes('thanksgiving') ? ['tt0093748'] : [];
      const pageInfo = { hasNextPage: false };
      if (body.operationName === 'TitleListMainPage') return new Response(JSON.stringify({ data: { list: { titleListItemSearch: { total: 0, pageInfo, edges: [] } } } }));
      return new Response(JSON.stringify({ data: { advancedTitleSearch: { total: ids.length, pageInfo, edges: ids.map((id: string) => ({ node: { title: { id, titleType: { id: 'movie' } } } })) } } }));
    }
    if (url.includes('mdblist.com')) return new Response('[]');
    if (url.startsWith('http://plex.test:32400')) return fakePlex(url, init);
    if (url.includes('Default-Images')) return new Response(new Uint8Array([0xff, 0xd8, 1]), { headers: { 'content-type': 'image/jpeg' } });
    return new Response('nope', { status: 404 });
  };
  const config = { ...readConfig({}), configDir: mkdtempSync(join(tmpdir(), 'mc-')), timezone: 'America/New_York', seeds: {} };
  const app = createContext(config, { db: openDb(':memory:'), fetch: net });
  return { fake, app, web: createWeb(app) };
}

export const flash = (res: Response) => { const u = new URL(res.headers.get('location') ?? '/', 'http://x'); return `${u.searchParams.get('ok') ?? ''}${u.searchParams.get('err') ?? ''}`; };
export const form = (data: Record<string, string>) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data).toString() });

export async function signIn(web: Hono, username = 'admin', password = 'pw') {
  const res = await web.request('/login', form({ username, password }));
  const cookie = res.headers.get('set-cookie')?.split(';')[0] ?? '';
  return { res, cookie };
}

export async function csrfOf(web: Hono, cookie: string, path = '/') {
  const html = await (await web.request(path, { headers: { cookie } })).text();
  return html.match(/name="_csrf" value="([0-9a-f]+)"/)?.[1] ?? '';
}
