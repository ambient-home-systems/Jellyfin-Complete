// Plex, read-only (ADR-024): the collections Kometa builds there, item by item, with their IMDb/TMDb/TVDB GUIDs.
// Used as a source and for the parity report. Never writes to Plex.
import { type FetchLike, requestJson } from './http.js';

export type PlexItem = { title: string; year: number | undefined; type: string; imdb?: string; tmdb?: string; tvdb?: string };
export type PlexCollection = { ratingKey: string; title: string; titleSort: string | null; section: string; sectionType: 'movie' | 'show'; childCount: number };

type Container<T> = { MediaContainer?: { Metadata?: T[]; Directory?: T[]; version?: string } };
type Meta = { ratingKey: string; title: string; titleSort?: string; year?: number; type: string; childCount?: string | number; Guid?: { id: string }[] };

export class PlexClient {
  constructor(private baseUrl: string, private token: string, private f: FetchLike) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  private get<T>(path: string): Promise<T> {
    return requestJson<T>(this.f, `${this.baseUrl}${path}`, { headers: { accept: 'application/json', 'X-Plex-Token': this.token } });
  }

  async version(): Promise<string | undefined> {
    return (await this.get<Container<never>>('/identity')).MediaContainer?.version;
  }

  /** Every collection in the movie and show libraries. */
  async collections(): Promise<PlexCollection[]> {
    const sections = (await this.get<Container<{ key: string; title: string; type: string }>>('/library/sections')).MediaContainer?.Directory ?? [];
    const out: PlexCollection[] = [];
    for (const s of sections.filter((x) => x.type === 'movie' || x.type === 'show')) {
      const colls = (await this.get<Container<Meta>>(`/library/sections/${s.key}/collections`)).MediaContainer?.Metadata ?? [];
      for (const c of colls) out.push({ ratingKey: c.ratingKey, title: c.title, titleSort: c.titleSort ?? null, section: s.title, sectionType: s.type as 'movie' | 'show', childCount: Number(c.childCount ?? 0) });
    }
    return out;
  }

  /** The items in a collection, with provider IDs from their GUIDs (imdb://tt…, tmdb://…, tvdb://…). */
  async items(ratingKey: string): Promise<PlexItem[]> {
    const kids = (await this.get<Container<Meta>>(`/library/collections/${encodeURIComponent(ratingKey)}/children?includeGuids=1`)).MediaContainer?.Metadata ?? [];
    return kids.map((k) => {
      const ids = Object.fromEntries((k.Guid ?? []).map((g) => g.id.split('://')).filter((p) => p.length === 2)) as Record<string, string>;
      return { title: k.title, year: k.year, type: k.type, imdb: ids.imdb, tmdb: ids.tmdb, tvdb: ids.tvdb };
    });
  }

  /** Collections with exactly this name (one per library at most, usually). */
  async findCollection(name: string): Promise<PlexCollection[]> {
    return (await this.collections()).filter((c) => c.title === name);
  }
}
