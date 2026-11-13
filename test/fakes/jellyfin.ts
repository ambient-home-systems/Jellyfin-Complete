// In-memory Jellyfin 12.4 stand-in for tests. It mimics the behaviours measured on the real server
// (docs/VERIFIED.md): POST /Items/{id} is a full overwrite, LockData on a box set propagates to its
// linked items, ForcedSortName is normalised, posters arrive as base64, deleting a box set keeps its items,
// and BlockedTags hide tagged items for that user.
import { createHash } from 'node:crypto';
import { Hono } from 'hono';
import type { FetchLike } from '../../src/clients/http.js';

export type FakeItem = {
  Id: string;
  Name: string;
  Type: 'Movie' | 'Series' | 'Episode' | 'BoxSet' | 'CollectionFolder';
  ProductionYear?: number;
  ProviderIds?: Record<string, string>;
  ParentId?: string; // library
  SeriesId?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  OfficialRating?: string;
  Genres?: string[];
  Tags?: string[];
  Studios?: { Name: string }[];
  Overview?: string | null;
  ForcedSortName?: string | null;
  SortName?: string;
  LockData?: boolean;
  LockedFields?: string[];
  DisplayOrder?: string | null;
  DateCreated?: string;
  PremiereDate?: string;
  /** The file as Jellyfin probed it (Fields=MediaSources). */
  MediaSources?: { RunTimeTicks?: number; Path?: string; MediaStreams?: { Type: string; Title?: string }[] }[];
  children?: string[]; // BoxSet linked children
  images?: Record<string, number>; // type -> byte length
};

export type FakeUser = { Id: string; Name: string; Password: string; Policy: { IsAdministrator: boolean; BlockedTags: string[] } };

/** Jellyfin 12.4 SortName normalisation, as observed: lowercase, strip , & - { } ', '.+%' → space, pad digits to 10. */
export function normaliseSortName(s: string): string {
  return s
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[,&\-{}']/g, '')
    .replace(/[.+%]/g, ' ')
    .replace(/\d+/g, (d) => d.padStart(10, '0'));
}

export class FakeJellyfin {
  items = new Map<string, FakeItem>();
  /** Installed plugins and their configurations (Phase 3: Home Screen Sections, Collection Sections). */
  plugins: { Id: string; Name: string; Version: string; Status: string }[] = [];
  pluginConfigs = new Map<string, Record<string, unknown>>();
  bustCacheCalls = 0;
  /** What /System/Info reports (the compatibility tests change it). */
  version = '12.4.0';
  users: FakeUser[] = [{ Id: 'admin-1', Name: 'admin', Password: 'pw', Policy: { IsAdministrator: true, BlockedTags: [] } }];
  libraries = [
    { Name: 'Movies', CollectionType: 'movies', ItemId: 'lib-movies' },
    { Name: 'Animated Classics', CollectionType: 'movies', ItemId: 'lib-animated' },
    { Name: 'Shows', CollectionType: 'tvshows', ItemId: 'lib-shows' },
    { Name: 'Collections', CollectionType: 'boxsets', ItemId: 'lib-collections' },
  ];
  apiKey = 'fake-api-key-123456';
  /** Image files by "<itemId>/<type>"; an item's image tag is derived from its bytes, as Jellyfin's changes with the image. */
  imageData = new Map<string, { bytes: Uint8Array; type: string }>();
  /** Every image upload, in order. */
  uploads: { id: string; type: string; bytes: Uint8Array }[] = [];
  /** Backdrops by item, in index order (a box set can have several). */
  backdrops = new Map<string, Uint8Array[]>();
  /**
   * Jellyfin's box set identification (ADR-040), as measured on a real server: within seconds of creating an unlocked
   * box set (or a full refresh with replaceAllMetadata), it searches TMDb collections by the set's name and attaches the
   * match: provider ID, poster, backdrop, logo, thumb and overview, and renames it "<name> Collection". Keyed by the
   * name searched (lower case, without " Collection").
   */
  tmdbNameSearch = new Map<string, { tmdb: string; name: string; overview: string }>();
  /** Delay before identification runs (it's asynchronous in Jellyfin). */
  identifyDelayMs = 5;
  /** Worst case: identify even locked box sets (to prove the app's own checks catch it). */
  identifyLocked = false;
  /** Every POST /Items/{id}/Refresh, which the app must never send. */
  refreshCalls: string[] = [];
  calls: { method: string; path: string }[] = [];
  private seq = 1;
  tokens = new Map<string, string>(); // token -> userId

  add(item: Omit<FakeItem, 'Id'> & { Id?: string }): FakeItem {
    const full: FakeItem = { Id: item.Id ?? `item-${this.seq++}`, LockData: false, LockedFields: [], Tags: [], Genres: [], ...item } as FakeItem;
    full.SortName = normaliseSortName(full.ForcedSortName || full.Name);
    this.items.set(full.Id, full);
    return full;
  }

  boxSets(): FakeItem[] {
    return [...this.items.values()].filter((i) => i.Type === 'BoxSet');
  }

  private userFor(token: string | undefined): FakeUser | null {
    if (!token) return null;
    if (token === this.apiKey) return this.users.find((u) => u.Policy.IsAdministrator) ?? null;
    const uid = this.tokens.get(token);
    return this.users.find((u) => u.Id === uid) ?? null;
  }

  private visible(item: FakeItem, user: FakeUser | null): boolean {
    if (!user) return true;
    return !(item.Tags ?? []).some((t) => user.Policy.BlockedTags.includes(t));
  }

  private dto(item: FakeItem) {
    const { children, images, ...rest } = item;
    const tag = (type: string) => {
      const d = this.imageData.get(`${item.Id}/${type}`);
      return d ? createHash('sha1').update(d.bytes).digest('hex').slice(0, 16) : 'tag';
    };
    const backdrops = (this.backdrops.get(item.Id) ?? []).map((b) => createHash('sha1').update(b).digest('hex').slice(0, 16));
    return { ...rest, ChildCount: children?.length, ImageTags: images ? Object.fromEntries(Object.keys(images).map((k) => [k, tag(k)])) : {}, BackdropImageTags: backdrops };
  }

  /** Attach what a TMDb name search finds, as Jellyfin does to an unlocked box set. */
  identify(id: string): void {
    const box = this.items.get(id);
    if (!box || box.Type !== 'BoxSet' || (box.LockData && !this.identifyLocked)) return;
    const key = (box.Name ?? '').toLowerCase().replace(/ collection$/, '');
    const hit = this.tmdbNameSearch.get(key);
    if (!hit) return;
    const bytes = (what: string) => new TextEncoder().encode(`tmdb-${hit.tmdb}-${what}`);
    box.ProviderIds = { ...(box.ProviderIds ?? {}), Tmdb: hit.tmdb };
    box.Overview = hit.overview;
    if (!/ collection$/i.test(box.Name ?? '')) box.Name = `${box.Name} Collection`;
    for (const type of ['Primary', 'Logo', 'Thumb']) this.setImage(id, bytes(type.toLowerCase()), type);
    this.backdrops.set(id, [bytes('backdrop-0'), bytes('backdrop-1')]);
  }

  /** The bytes of an item's image, or undefined. */
  image(id: string, type = 'Primary'): string | undefined {
    const d = this.imageData.get(`${id}/${type}`);
    return d ? new TextDecoder().decode(d.bytes) : undefined;
  }

  /** Give an item a poster (as if Jellyfin had fetched one). */
  setImage(id: string, bytes: Uint8Array, type = 'Primary', contentType = 'image/jpeg'): void {
    const item = this.items.get(id)!;
    item.images = { ...(item.images ?? {}), [type]: bytes.length };
    this.imageData.set(`${id}/${type}`, { bytes, type: contentType });
  }

  app(): Hono {
    const app = new Hono();
    app.use('*', async (c, next) => {
      this.calls.push({ method: c.req.method, path: new URL(c.req.url).pathname });
      if (c.req.path === '/Users/AuthenticateByName' || c.req.path === '/System/Info/Public') return next();
      const token = c.req.header('authorization')?.match(/Token="([^"]+)"/)?.[1];
      if (!this.userFor(token)) return c.text('Unauthorized', 401);
      // The API key is not a user: BlockedTags never hide anything from it (spike 06 on 12.4).
      c.set('user' as never, (token === this.apiKey ? null : this.userFor(token)) as never);
      return next();
    });
    const userOf = (c: { get: (k: never) => unknown }) => c.get('user' as never) as FakeUser;

    app.get('/System/Info', (c) => c.json({ Version: this.version, ServerName: 'fake', Id: 'fake-server' }));
    app.get('/Library/VirtualFolders', (c) => c.json(this.libraries));
    app.get('/Plugins', (c) => c.json(this.plugins));
    const plugin = (id: string) => this.plugins.find((p) => p.Id.replace(/-/g, '').toLowerCase() === id.replace(/-/g, '').toLowerCase());
    app.get('/Plugins/:id/Configuration', (c) => {
      const p = plugin(c.req.param('id'));
      return p ? c.json(this.pluginConfigs.get(p.Id) ?? {}) : c.text('Not found', 404);
    });
    // Like 12.4: the posted object replaces the whole configuration. Collection Sections' entries have required members.
    app.post('/Plugins/:id/Configuration', async (c) => {
      const p = plugin(c.req.param('id'));
      if (!p) return c.text('Not found', 404);
      const body = (await c.req.json()) as Record<string, unknown>;
      const sections = body.Sections as { UniqueId?: string; DisplayText?: string; CollectionName?: string }[] | undefined;
      if (sections?.some((x) => !x.UniqueId || !x.DisplayText || !x.CollectionName)) return c.text('JSON deserialization: missing required properties', 400);
      this.pluginConfigs.set(p.Id, body);
      return c.body(null, 204);
    });
    app.post('/HomeScreen/BustCache', (c) => {
      if (!this.plugins.some((p) => p.Name === 'Home Screen Sections')) return c.text('Not found', 404);
      this.bustCacheCalls++;
      return c.json({ newCounter: this.bustCacheCalls });
    });
    app.get('/Users', (c) => c.json(this.users.map(({ Password, ...u }) => u)));
    app.get('/Users/:id', (c) => {
      const u = this.users.find((x) => x.Id === c.req.param('id'));
      if (!u) return c.text('Not found', 404);
      const { Password, ...user } = u;
      return c.json(user);
    });
    // Like 12.4: the posted policy replaces the whole policy, so a partial body loses fields.
    app.post('/Users/:id/Policy', async (c) => {
      const u = this.users.find((x) => x.Id === c.req.param('id'));
      if (!u) return c.text('Not found', 404);
      const body = (await c.req.json()) as FakeUser['Policy'];
      if (typeof body.IsAdministrator !== 'boolean') return c.text('Policy is incomplete', 400);
      u.Policy = { ...body, BlockedTags: body.BlockedTags ?? [] };
      return c.body(null, 204);
    });
    app.post('/Users/AuthenticateByName', async (c) => {
      const body = (await c.req.json()) as { Username: string; Pw: string };
      const u = this.users.find((x) => x.Name === body.Username && x.Password === body.Pw);
      if (!u) return c.text('Error processing request.', 401);
      const token = `tok-${this.seq++}`;
      this.tokens.set(token, u.Id);
      const { Password, ...user } = u;
      return c.json({ User: user, AccessToken: token, ServerId: 'fake-server' });
    });

    app.get('/Items', (c) => {
      const q = new URL(c.req.url).searchParams;
      const user = userOf(c);
      let list: FakeItem[];
      const parent = q.get('ParentId') ?? q.get('parentId');
      if (parent && this.items.get(parent)?.Type === 'BoxSet') {
        list = (this.items.get(parent)?.children ?? []).map((id) => this.items.get(id)).filter((x): x is FakeItem => Boolean(x));
      } else {
        list = [...this.items.values()];
        const lib = this.libraries.find((l) => l.ItemId === parent);
        if (lib) list = list.filter((i) => i.ParentId === lib.ItemId || (i.Type === 'Episode' && this.items.get(i.SeriesId ?? '')?.ParentId === lib.ItemId));
      }
      const types = (q.get('IncludeItemTypes') ?? '').split(',').filter(Boolean);
      if (types.length) list = list.filter((i) => types.includes(i.Type));
      const ids = (q.get('Ids') ?? '').split(',').filter(Boolean);
      if (ids.length) list = list.filter((i) => ids.includes(i.Id));
      list = list.filter((i) => this.visible(i, user));
      const start = Number(q.get('StartIndex') ?? 0);
      const limit = Number(q.get('Limit') ?? 1000);
      return c.json({ Items: list.slice(start, start + limit).map((i) => this.dto(i)), TotalRecordCount: list.length });
    });

    app.get('/Items/:id', (c) => {
      const item = this.items.get(c.req.param('id'));
      if (!item || !this.visible(item, userOf(c))) return c.text('Not found', 404);
      return c.json(this.dto(item));
    });

    app.post('/Items/:id', async (c) => {
      const item = this.items.get(c.req.param('id'));
      if (!item) return c.text('Not found', 404);
      const body = (await c.req.json()) as Partial<FakeItem>;
      // Full overwrite of the editable fields, like ItemUpdateController in 12.4.
      item.Name = body.Name ?? item.Name;
      item.ForcedSortName = body.ForcedSortName ?? null;
      item.Overview = body.Overview ?? null;
      item.Tags = body.Tags ?? [];
      item.Genres = body.Genres ?? [];
      item.LockedFields = body.LockedFields ?? [];
      item.DisplayOrder = body.DisplayOrder ?? item.DisplayOrder ?? null;
      if (body.ProviderIds) item.ProviderIds = { ...body.ProviderIds }; // the metadata editor's External IDs
      const newLock = body.LockData ?? false;
      if (newLock !== item.LockData && item.Type === 'BoxSet') {
        for (const id of item.children ?? []) {
          const child = this.items.get(id);
          if (child) child.LockData = newLock; // propagation the app must avoid
        }
      }
      item.LockData = newLock;
      item.SortName = normaliseSortName(item.ForcedSortName || item.Name);
      return c.body(null, 204);
    });

    app.post('/Collections', (c) => {
      const q = new URL(c.req.url).searchParams;
      const name = q.get('name');
      if (!name) return c.text('name required', 400);
      // isLocked sets the new box set's lock without touching its titles (only a later lock change propagates).
      const box = this.add({ Name: name, Type: 'BoxSet', ParentId: 'lib-collections', children: [], LockData: q.get('isLocked') === 'true' });
      box.children = (q.get('ids') ?? '').split(',').filter((id) => this.items.has(id));
      setTimeout(() => this.identify(box.Id), this.identifyDelayMs);
      return c.json({ Id: box.Id });
    });
    app.post('/Items/:id/Refresh', (c) => {
      const q = new URL(c.req.url).searchParams;
      this.refreshCalls.push(`${c.req.param('id')}?${q}`);
      if (q.get('replaceAllMetadata') === 'true') this.identify(c.req.param('id'));
      return c.body(null, 204);
    });
    app.delete('/Items/:id/Images/:type', (c) => {
      const item = this.items.get(c.req.param('id'));
      if (!item) return c.text('Not found', 404);
      const type = c.req.param('type');
      if (type === 'Backdrop') {
        const list = this.backdrops.get(item.Id) ?? [];
        const index = Number(new URL(c.req.url).searchParams.get('imageIndex') ?? 0);
        if (!list[index]) return c.text('Not found', 404);
        list.splice(index, 1);
        return c.body(null, 204);
      }
      if (!item.images?.[type]) return c.text('Not found', 404);
      delete item.images[type];
      this.imageData.delete(`${item.Id}/${type}`);
      return c.body(null, 204);
    });
    app.post('/Collections/:id/Items', (c) => {
      const box = this.items.get(c.req.param('id'));
      if (!box || box.Type !== 'BoxSet') return c.text('Not found', 404);
      for (const id of (new URL(c.req.url).searchParams.get('ids') ?? '').split(',').filter(Boolean)) {
        if (this.items.has(id) && !box.children!.includes(id)) box.children!.push(id);
      }
      return c.body(null, 204);
    });
    app.delete('/Collections/:id/Items', (c) => {
      const box = this.items.get(c.req.param('id'));
      if (!box || box.Type !== 'BoxSet') return c.text('Not found', 404);
      const ids = (new URL(c.req.url).searchParams.get('ids') ?? '').split(',');
      box.children = box.children!.filter((x) => !ids.includes(x));
      return c.body(null, 204);
    });
    app.delete('/Items/:id', (c) => {
      const item = this.items.get(c.req.param('id'));
      if (!item) return c.text('Not found', 404);
      this.items.delete(item.Id); // linked children stay
      return c.body(null, 204);
    });
    app.post('/Items/:id/Images/:type', async (c) => {
      const item = this.items.get(c.req.param('id'));
      if (!item) return c.text('Not found', 404);
      if (!(c.req.header('content-type') ?? '').startsWith('image/')) return c.text('Unsupported content type', 400);
      const text = await c.req.text();
      const bytes = Buffer.from(text, 'base64');
      if (!bytes.length || bytes.toString('base64') !== text.replace(/\s/g, '')) return c.text('Body must be base64', 400);
      item.images = { ...(item.images ?? {}), [c.req.param('type')]: bytes.length };
      this.imageData.set(`${item.Id}/${c.req.param('type')}`, { bytes: new Uint8Array(bytes), type: c.req.header('content-type')! });
      this.uploads.push({ id: item.Id, type: c.req.param('type'), bytes: new Uint8Array(bytes) });
      return c.body(null, 204);
    });
    app.get('/Items/:id/Images/:type', (c) => {
      const d = this.imageData.get(`${c.req.param('id')}/${c.req.param('type')}`);
      if (!d) return c.text('Not found', 404);
      return c.body(Buffer.from(d.bytes), 200, { 'content-type': d.type });
    });
    return app;
  }

  fetch(): FetchLike {
    const app = this.app();
    return async (input, init) => app.fetch(new Request(input, init));
  }
}

export const FAKE_URL = 'http://jellyfin.test:8096';
