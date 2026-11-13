// IMDb snapshot route (ADR-011 route 4). A scheduled job (GitHub Actions, a Worker, or any machine IMDb doesn't refuse)
// resolves every IMDb list and search with the same code as the direct route and publishes one JSON file; the app reads
// that file instead of calling IMDb. Fetch-only, no node: imports (ADR-028), so it runs anywhere.
import { fetchHashes, imdbChart, imdbList, imdbSearch, isImdbChart, ImdbError, type ImdbTitle, type KometaImdbSearch } from './index.js';

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export type ImdbSnapshot = {
  version: 1;
  generatedAt: string;
  searches: Record<string, { total: number; titles: ImdbTitle[] }>;
  lists: Record<string, { total: number; ids: string[]; titles?: ImdbTitle[] }>;
  /** IMDb charts by chartKey (snapshots made before 0.9.0 have none). */
  charts?: Record<string, { titles: ImdbTitle[] }>;
  /** Queries that failed while building, by key; the app treats them as missing. */
  errors: Record<string, string>;
};

/** JSON with object keys sorted at every depth: equal configs give equal keys. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

export const searchKey = (search: KometaImdbSearch) => stableJson(search);
export const listKey = (listId: string, limit?: number) => stableJson({ listId, limit: limit ?? null });
export const chartKey = (chart: string) => `chart:${chart}`;

export type SnapshotRequest = { searches: KometaImdbSearch[]; lists: { listId: string; limit?: number }[]; charts?: string[] };

/** Resolve every query once, in order, politely. One failure is recorded and doesn't stop the rest. */
export async function buildSnapshot(f: Fetch, req: SnapshotRequest, now = new Date(), onProgress?: (msg: string) => void): Promise<ImdbSnapshot> {
  const hashes = await fetchHashes(f);
  const snap: ImdbSnapshot = { version: 1, generatedAt: now.toISOString(), searches: {}, lists: {}, charts: {}, errors: {} };
  const seen = new Set<string>();
  for (const chart of req.charts ?? []) {
    const key = chartKey(chart);
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      if (!isImdbChart(chart)) throw new ImdbError(`Unknown IMDb chart: ${chart}`, 'BAD_INPUT');
      snap.charts![key] = { titles: await imdbChart(f, chart) };
      onProgress?.(`chart ${chart}: ${snap.charts![key]!.titles.length}`);
    } catch (e) {
      snap.errors[key] = (e as Error).message;
    }
  }
  for (const l of req.lists) {
    const key = listKey(l.listId, l.limit);
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      snap.lists[key] = await imdbList(f, hashes.list, l.listId, { limit: l.limit });
      onProgress?.(`list ${l.listId}: ${snap.lists[key]!.ids.length}`);
    } catch (e) {
      snap.errors[key] = (e as Error).message;
    }
  }
  for (const s of req.searches) {
    const key = searchKey(s);
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      snap.searches[key] = await imdbSearch(f, hashes.search, s);
      onProgress?.(`search ${key.slice(0, 60)}: ${snap.searches[key]!.titles.length}`);
    } catch (e) {
      snap.errors[key] = (e as Error).message;
    }
  }
  return snap;
}

/** Read a published snapshot. A token is sent as a bearer token (e.g. a GitHub token for a private repository). */
export async function readSnapshot(f: Fetch, url: string, token?: string | null): Promise<ImdbSnapshot> {
  const res = await f(url, { headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  if (!res.ok) throw new ImdbError(`IMDb snapshot HTTP ${res.status}`, 'SNAPSHOT_FETCH_FAILED');
  const json = (await res.json()) as Partial<ImdbSnapshot>;
  if (json.version !== 1 || typeof json.generatedAt !== 'string' || !json.searches || !json.lists) throw new ImdbError('Not an IMDb snapshot (version 1)', 'SNAPSHOT_INVALID');
  return { errors: {}, ...json } as ImdbSnapshot;
}
