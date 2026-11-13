// Radarr v3 API and Sonarr v3/v4 API (ADR-027). Lookups by term (tmdb:/imdb:/tvdb:), exclusions paged, `monitored` always
// set explicitly, `isAvailable` never used. Spike 02 verified the endpoints on Radarr 6.4 and Sonarr 4.0.
import { type FetchLike, request, requestJson, HttpError } from './http.js';
import type { ArrOptions } from '../db/schema.js';

export type ArrApp = 'radarr' | 'sonarr';
export type Option = { id: number; name: string };
export type RootFolder = { path: string; freeSpace: number | null; accessible: boolean };

/** One title as Radarr or Sonarr sees it after a lookup. */
export type ArrTitle = {
  title: string;
  year: number | null;
  tmdbId?: number;
  tvdbId?: number;
  imdbId?: string;
  status: string;
  inLibrary: boolean;
  excluded: boolean;
  released: boolean;
  /** The raw lookup resource, posted back (with options) to add it. */
  resource: Record<string, unknown>;
};

const past = (d: unknown, now: number) => typeof d === 'string' && Date.parse(d) <= now;

export class ArrClient {
  constructor(readonly app: ArrApp, private baseUrl: string, private apiKey: string, private f: FetchLike) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private get<T>(path: string): Promise<T> {
    return requestJson<T>(this.f, `${this.baseUrl}/api/v3${path}`, { headers: { 'X-Api-Key': this.apiKey } });
  }

  private async send<T>(method: string, path: string, json: unknown): Promise<T> {
    const url = `${this.baseUrl}/api/v3${path}`;
    const res = await request(this.f, url, { method, json, headers: { 'X-Api-Key': this.apiKey }, retries: 0 });
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, url, text.slice(0, 500));
    return (text ? JSON.parse(text) : null) as T;
  }

  async version(): Promise<string> {
    return (await this.get<{ version: string }>('/system/status')).version;
  }

  async qualityProfiles(): Promise<Option[]> {
    return (await this.get<{ id: number; name: string }[]>('/qualityprofile')).map((p) => ({ id: p.id, name: p.name }));
  }

  async rootFolders(): Promise<RootFolder[]> {
    return (await this.get<{ path: string; freeSpace?: number; accessible?: boolean }[]>('/rootfolder')).map((r) => ({ path: r.path, freeSpace: r.freeSpace ?? null, accessible: r.accessible !== false }));
  }

  async tags(): Promise<Option[]> {
    return (await this.get<{ id: number; label: string }[]>('/tag')).map((t) => ({ id: t.id, name: t.label }));
  }

  /** Every title Radarr/Sonarr already has (with or without a file), by TMDb/TVDB and IMDb ID. */
  async library(): Promise<{ ids: Set<string>; monitoredNoFile: Set<string> }> {
    const ids = new Set<string>();
    const monitoredNoFile = new Set<string>();
    const rows = await this.get<{ tmdbId?: number; tvdbId?: number; imdbId?: string; monitored?: boolean; hasFile?: boolean; statistics?: { episodeFileCount?: number } }[]>(this.app === 'radarr' ? '/movie' : '/series');
    for (const r of rows) {
      const keys = [r.tmdbId && `tmdb:${r.tmdbId}`, r.tvdbId && `tvdb:${r.tvdbId}`, r.imdbId && `imdb:${r.imdbId}`].filter(Boolean) as string[];
      const noFile = this.app === 'radarr' ? !r.hasFile : !r.statistics?.episodeFileCount;
      for (const k of keys) {
        ids.add(k);
        if (r.monitored && noFile) monitoredNoFile.add(k);
      }
    }
    return { ids, monitoredNoFile };
  }

  /** Radarr only: when each film was added to Radarr, by "tmdb:<id>" and "imdb:<id>" (ADR-038). */
  async addedDates(): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const r of await this.get<{ tmdbId?: number; imdbId?: string; added?: string }[]>('/movie')) {
      const at = r.added ? Date.parse(r.added) : NaN;
      if (!Number.isFinite(at) || at <= 0) continue; // Radarr reports 0001-01-01 for unknown
      if (r.tmdbId) out.set(`tmdb:${r.tmdbId}`, at);
      if (r.imdbId) out.set(`imdb:${r.imdbId}`, at);
    }
    return out;
  }

  /** Excluded titles: Radarr /exclusions/paged (TMDb IDs), Sonarr /importlistexclusion/paged (TVDB IDs). */
  async exclusions(): Promise<Set<string>> {
    const out = new Set<string>();
    const path = this.app === 'radarr' ? '/exclusions/paged' : '/importlistexclusion/paged';
    for (let page = 1; page <= 50; page++) {
      const r = await this.get<{ records: { tmdbId?: number; tvdbId?: number }[]; totalRecords: number }>(`${path}?page=${page}&pageSize=1000`);
      for (const x of r.records) {
        if (x.tmdbId) out.add(`tmdb:${x.tmdbId}`);
        if (x.tvdbId) out.add(`tvdb:${x.tvdbId}`);
      }
      if (page * 1000 >= r.totalRecords || !r.records.length) break;
    }
    return out;
  }

  /** Look one title up by term (tmdb:603, imdb:tt0133093, tvdb:81189). Nothing is added. */
  async lookup(term: string, now = Date.now()): Promise<ArrTitle | null> {
    const rows = await this.get<Record<string, any>[]>(`${this.app === 'radarr' ? '/movie' : '/series'}/lookup?term=${encodeURIComponent(term)}`);
    const r = rows[0];
    if (!r) return null;
    // ADR-007: Radarr "released", or a digital/physical release in the past; Sonarr not "upcoming" and first aired.
    const released = this.app === 'radarr'
      ? r.status === 'released' || past(r.digitalRelease, now) || past(r.physicalRelease, now)
      : r.status !== 'upcoming' && past(r.firstAired, now);
    return {
      title: r.title, year: r.year ?? null, tmdbId: r.tmdbId, tvdbId: r.tvdbId, imdbId: r.imdbId, status: r.status ?? 'unknown',
      inLibrary: Number(r.id ?? 0) > 0, excluded: Boolean(r.isExcluded), released, resource: r,
    };
  }

  /** Add a looked-up title with these options. Returns the new Radarr/Sonarr ID. */
  async add(t: ArrTitle, o: ArrOptions): Promise<number> {
    if (o.qualityProfileId === undefined || !o.rootFolderPath) throw new Error(`Choose a quality profile and root folder for ${this.app === 'radarr' ? 'Radarr' : 'Sonarr'} in Settings first`);
    const common = { ...t.resource, qualityProfileId: o.qualityProfileId, rootFolderPath: o.rootFolderPath, monitored: o.monitored !== false, tags: o.tags ?? [] };
    const body = this.app === 'radarr'
      ? { ...common, minimumAvailability: o.minimumAvailability ?? 'released', addOptions: { searchForMovie: o.searchOnAdd !== false, monitor: o.monitored === false ? 'none' : 'movieOnly' } }
      : { ...common, seriesType: o.seriesType ?? 'standard', seasonFolder: o.seasonFolder !== false, addOptions: { monitor: o.monitor ?? 'all', searchForMissingEpisodes: o.searchOnAdd !== false, searchForCutoffUnmetEpisodes: false } };
    const created = await this.send<{ id: number }>('POST', this.app === 'radarr' ? '/movie' : '/series', body);
    return created.id;
  }

  /** Radarr collections (one appears only once a film of it is in Radarr). */
  async collections(): Promise<{ id: number; tmdbId: number; title: string; monitored: boolean; missingMovies: number }[]> {
    if (this.app !== 'radarr') return [];
    return this.get('/collection');
  }

  /** Monitor Radarr collections so Radarr adds their films itself, then refresh them (ADR-027). */
  async monitorCollections(ids: number[], o: ArrOptions): Promise<void> {
    await this.send('PUT', '/collection', {
      collectionIds: ids, monitored: true, monitorMovies: o.monitored !== false, searchOnAdd: o.searchOnAdd !== false,
      ...(o.qualityProfileId !== undefined ? { qualityProfileId: o.qualityProfileId } : {}), ...(o.rootFolderPath ? { rootFolderPath: o.rootFolderPath } : {}),
      minimumAvailability: o.minimumAvailability ?? 'released',
    });
    await this.send('POST', '/command', { name: 'RefreshCollections' });
  }
}
