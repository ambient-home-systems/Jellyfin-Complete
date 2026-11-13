// Jellyfin client. Types come from the 12.4.0 OpenAPI spec (spec/jellyfin-openapi.json, `npm run gen:jellyfin`).
// The write rules in ADR-019 are enforced here so no executor can skip them:
//  - item updates are GET → modify → POST of the full DTO, and LockData is always echoed back unchanged
//    (setting it on a box set propagates to every linked item);
//  - posters upload as base64 text with an image/* content type;
//  - indexing always passes CollapseBoxSetItems=false.
import type { components } from './schema.js';
import { type FetchLike, HttpError, request, requestJson, mapLimit } from '../http.js';

export type BaseItemDto = components['schemas']['BaseItemDto'];
export type UserDto = components['schemas']['UserDto'];
export type VirtualFolderInfo = components['schemas']['VirtualFolderInfo'];
export type SystemInfo = components['schemas']['SystemInfo'];
export type AuthenticationResult = components['schemas']['AuthenticationResult'];

export const CLIENT_NAME = 'Maverick Jellyfin Complete';
export const CLIENT_VERSION = '0.1.0';

export function authHeader(token?: string, deviceId = 'maverick-jellyfin-complete'): string {
  const parts = [`Client="${CLIENT_NAME}"`, 'Device="server"', `DeviceId="${deviceId}"`, `Version="${CLIENT_VERSION}"`];
  if (token) parts.push(`Token="${token}"`);
  return `MediaBrowser ${parts.join(', ')}`;
}

export type ItemsQuery = Record<string, string | number | boolean | undefined>;

export class JellyfinClient {
  private adminUserId: string | null = null;

  constructor(private opts: { baseUrl: string; apiKey: string; fetch?: FetchLike; userId?: string }) {
    this.adminUserId = opts.userId ?? null;
  }

  private get f(): FetchLike {
    return this.opts.fetch ?? fetch;
  }

  private url(path: string, query?: ItemsQuery): string {
    const u = new URL(this.opts.baseUrl.replace(/\/$/, '') + path);
    if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') u.searchParams.set(k, String(v));
    return u.toString();
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: authHeader(this.opts.apiKey), accept: 'application/json', ...extra };
  }

  private get<T>(path: string, query?: ItemsQuery): Promise<T> {
    return requestJson<T>(this.f, this.url(path, query), { headers: this.headers() });
  }

  private async send(method: string, path: string, query?: ItemsQuery, json?: unknown): Promise<Response> {
    const res = await request(this.f, this.url(path, query), { method, headers: this.headers(), json, retries: 1 });
    if (!res.ok) throw new HttpError(res.status, this.url(path), (await res.text()).slice(0, 500));
    return res;
  }

  systemInfo(): Promise<SystemInfo> {
    return this.get('/System/Info');
  }

  virtualFolders(): Promise<VirtualFolderInfo[]> {
    return this.get('/Library/VirtualFolders');
  }

  users(): Promise<UserDto[]> {
    return this.get('/Users');
  }

  /**
   * Make sure every user's policy blocks this tag (ADR-010 tag-gate). POST /Users/{id}/Policy replaces the whole policy,
   * so each one is read, changed and written back in full (the ADR-019 rule). Returns the names of users changed.
   */
  async blockTagForAllUsers(tag: string): Promise<string[]> {
    const changed: string[] = [];
    for (const u of await this.users()) {
      if (!u.Id || u.Policy?.BlockedTags?.includes(tag)) continue;
      const full = await this.get<UserDto>(`/Users/${u.Id}`);
      if (!full.Policy) throw new Error(`Jellyfin returned no policy for user ${u.Name ?? u.Id}`);
      await this.send('POST', `/Users/${u.Id}/Policy`, undefined, { ...full.Policy, BlockedTags: [...(full.Policy.BlockedTags ?? []), tag] });
      changed.push(u.Name ?? u.Id);
    }
    return changed;
  }

  /** Users whose policy doesn't block this tag (they would see hidden box sets). */
  async usersNotBlocking(tag: string): Promise<string[]> {
    return (await this.users()).filter((u) => !u.Policy?.BlockedTags?.includes(tag)).map((u) => u.Name ?? u.Id ?? '?');
  }

  /** Installed plugins, with Ids normalised to lower-case 32-hex (Jellyfin writes Guids without dashes). */
  async plugins(): Promise<{ id: string; name: string; version: string; status: string }[]> {
    const rows = await this.get<{ Id?: string; Name?: string; Version?: string; Status?: string }[]>('/Plugins');
    return rows.map((p) => ({ id: normGuid(p.Id ?? ''), name: p.Name ?? '', version: p.Version ?? '', status: p.Status ?? '' }));
  }

  /** A plugin's whole configuration object. */
  pluginConfiguration<T>(pluginId: string): Promise<T> {
    return this.get<T>(`/Plugins/${normGuid(pluginId)}/Configuration`);
  }

  /** Replace a plugin's configuration. Always send back the full object you read (it replaces everything). */
  async setPluginConfiguration(pluginId: string, config: unknown): Promise<void> {
    await this.send('POST', `/Plugins/${normGuid(pluginId)}/Configuration`, undefined, config);
  }

  /** Home Screen Sections: tell clients to refetch their section lists. */
  async bustHomeScreenCache(): Promise<void> {
    await this.send('POST', '/HomeScreen/BustCache', undefined, {});
  }

  /** The user context for user-scoped reads. API-key calls are admin, but some endpoints want a userId. */
  async userId(): Promise<string> {
    if (this.adminUserId) return this.adminUserId;
    const admin = (await this.users()).find((u) => u.Policy?.IsAdministrator);
    if (!admin?.Id) throw new Error('No administrator user found on the Jellyfin server');
    this.adminUserId = admin.Id;
    return admin.Id;
  }

  /** Sign a person in with their own credentials (used for app sign-in, not for server calls). */
  async authenticateByName(username: string, password: string): Promise<AuthenticationResult> {
    const res = await request(this.f, this.url('/Users/AuthenticateByName'), {
      method: 'POST',
      headers: { authorization: authHeader(undefined, 'maverick-jellyfin-complete-signin'), accept: 'application/json' },
      json: { Username: username, Pw: password },
      retries: 0,
    });
    if (!res.ok) throw new HttpError(res.status, this.url('/Users/AuthenticateByName'), '');
    return (await res.json()) as AuthenticationResult;
  }

  /** Page through /Items. CollapseBoxSetItems=false is forced so films inside box sets are not hidden. */
  async *items(query: ItemsQuery, pageSize = 500): AsyncGenerator<BaseItemDto> {
    let start = 0;
    for (;;) {
      const page = await this.get<{ Items: BaseItemDto[]; TotalRecordCount: number }>('/Items', {
        Recursive: true, ...query, CollapseBoxSetItems: false, StartIndex: start, Limit: pageSize,
      });
      for (const item of page.Items) yield item;
      start += page.Items.length;
      if (start >= page.TotalRecordCount || page.Items.length === 0) return;
    }
  }

  async allItems(query: ItemsQuery): Promise<BaseItemDto[]> {
    const out: BaseItemDto[] = [];
    for await (const item of this.items(query)) out.push(item);
    return out;
  }

  async getItem(id: string): Promise<BaseItemDto | null> {
    try {
      return await this.get<BaseItemDto>(`/Items/${id}`, { userId: await this.userId() });
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) return null;
      throw e;
    }
  }

  /**
   * GET → modify → POST the whole DTO (POST /Items/{id} is a full overwrite in 12.4).
   * LockData is always restored to the value the server sent, whatever `mutate` did.
   */
  async updateItem(id: string, mutate: (dto: BaseItemDto) => BaseItemDto): Promise<{ before: BaseItemDto; after: BaseItemDto }> {
    const before = await this.getItem(id);
    if (!before) throw new HttpError(404, this.url(`/Items/${id}`), 'item not found');
    const body = mutate(structuredClone(before));
    body.LockData = before.LockData ?? false;
    await this.send('POST', `/Items/${id}`, undefined, body);
    return { before, after: (await this.getItem(id)) ?? body };
  }

  /**
   * Always created locked (ADR-040): Jellyfin identifies an unlocked new box set by a TMDb name search within seconds
   * and attaches whatever it finds (provider ID, poster, backdrop, logo, overview), which can be the wrong collection.
   * Locking at creation doesn't lock the titles added to it; changing LockData later would (it propagates).
   */
  async createCollection(name: string, ids: string[] = []): Promise<string> {
    const res = await this.send('POST', '/Collections', { name, ids: ids.join(',') || undefined, isLocked: true });
    const json = (await res.json()) as { Id?: string };
    if (!json.Id) throw new Error('Jellyfin did not return an Id for the new collection');
    return json.Id;
  }

  async addToCollection(collectionId: string, ids: string[]): Promise<void> {
    await mapLimit(chunk(ids, 100), 1, (batch) => this.send('POST', `/Collections/${collectionId}/Items`, { ids: batch.join(',') }));
  }

  async removeFromCollection(collectionId: string, ids: string[]): Promise<void> {
    await mapLimit(chunk(ids, 100), 1, (batch) => this.send('DELETE', `/Collections/${collectionId}/Items`, { ids: batch.join(',') }));
  }

  /** Deleting a box set removes the grouping only; its linked films stay (verified by spikes/06). */
  async deleteItem(id: string): Promise<void> {
    await this.send('DELETE', `/Items/${id}`);
  }

  async collectionChildren(collectionId: string): Promise<BaseItemDto[]> {
    return this.allItems({ ParentId: collectionId, userId: await this.userId(), Recursive: false, Fields: 'ProviderIds' });
  }

  /**
   * Each item's file as Jellyfin probed it (ADR-041): its own duration, path, and the title tags on its streams.
   * MediaSources are heavy, so 50 items a request.
   */
  async mediaDetails(ids: string[]): Promise<Map<string, { durationTicks: number | null; path: string | null; titles: string[] }>> {
    const out = new Map<string, { durationTicks: number | null; path: string | null; titles: string[] }>();
    for (const batch of chunk(ids, 50)) {
      for (const it of await this.allItems({ Ids: batch.join(','), Fields: 'MediaSources,Path' })) {
        if (!it.Id) continue;
        const src = it.MediaSources?.[0];
        const titles = [...new Set((src?.MediaStreams ?? []).map((m) => m.Title?.trim()).filter((t): t is string => Boolean(t)))];
        out.set(it.Id, { durationTicks: src?.RunTimeTicks ?? null, path: src?.Path ?? it.Path ?? null, titles });
      }
    }
    return out;
  }

  /** Delete one image; for backdrops, by index (a box set can have several). */
  async deleteImage(id: string, type: string, index?: number): Promise<void> {
    await this.send('DELETE', `/Items/${id}/Images/${type}`, index === undefined ? undefined : { imageIndex: index });
  }

  // There is deliberately no metadata refresh here: a full refresh with replaceAllMetadata makes Jellyfin repeat its
  // name search on a box set (ADR-040). test/artwork-safety.test.ts checks the app never calls /Items/{id}/Refresh.

  /** An item's poster as stored, or null if it has none. */
  async downloadPrimaryImage(id: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    const res = await request(this.f, this.url(`/Items/${id}/Images/Primary`), { headers: { authorization: authHeader(this.opts.apiKey), accept: 'image/*' }, retries: 1 });
    if (res.status === 404) return null;
    if (!res.ok) throw new HttpError(res.status, this.url(`/Items/${id}/Images/Primary`), (await res.text()).slice(0, 300));
    return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get('content-type')?.split(';')[0] || 'image/jpeg' };
  }

  /** Each item's current poster tag (it changes whenever the poster does), 100 items a request. Missing items are left out. */
  async posterTags(ids: string[]): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    for (const batch of chunk(ids, 100)) {
      for (const it of await this.allItems({ Ids: batch.join(',') })) if (it.Id) out.set(it.Id, it.ImageTags?.Primary ?? null);
    }
    return out;
  }

  /** The server wraps the body in a base64 transform: send base64 text with an image/* content type. */
  async uploadPrimaryImage(id: string, bytes: Uint8Array, contentType = 'image/jpeg'): Promise<void> {
    const res = await request(this.f, this.url(`/Items/${id}/Images/Primary`), {
      method: 'POST',
      headers: { authorization: authHeader(this.opts.apiKey), 'content-type': contentType },
      body: Buffer.from(bytes).toString('base64'),
      retries: 1,
    });
    if (!res.ok) throw new HttpError(res.status, this.url(`/Items/${id}/Images/Primary`), (await res.text()).slice(0, 300));
  }
}

export function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

/** Guids compare as lower-case hex without dashes, the way Jellyfin writes them. */
export const normGuid = (g: string) => g.replace(/-/g, '').toLowerCase();
