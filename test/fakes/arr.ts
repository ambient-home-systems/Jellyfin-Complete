// Fake Radarr 6 / Sonarr 4 (v3 API), with the shapes spike 02 recorded. Lookups never add; POST /movie and /series do.
import type { FetchLike } from '../../src/clients/http.js';

type Title = { title: string; year: number; tmdbId?: number; tvdbId?: number; imdbId?: string; status: string; digitalRelease?: string; firstAired?: string };

export class FakeArr {
  readonly calls: { method: string; path: string; body?: any }[] = [];
  library: (Title & { id: number; monitored: boolean; hasFile: boolean; added?: string })[] = [];
  /** Radarr's import history: downloadFolderImported (3) and movieFolderImported (7) events. */
  history: { movieId: number; date: string; eventType: 'downloadFolderImported' | 'movieFolderImported' | 'grabbed' }[] = [];
  excluded = new Set<number>(); // TMDb (Radarr) or TVDB (Sonarr) IDs
  collections = [{ id: 7, title: 'Halloween Collection', tmdbId: 91361, monitored: false, missingMovies: 5 }];
  private seq = 100;

  constructor(readonly app: 'radarr' | 'sonarr', readonly url: string, readonly key: string, readonly catalogue: Title[]) {}

  fetch(): FetchLike {
    return async (u, init) => {
      if (new Headers(init?.headers).get('X-Api-Key') !== this.key) return new Response('Unauthorized', { status: 401 });
      const url = new URL(u);
      const path = url.pathname.replace('/api/v3', '');
      const method = init?.method ?? 'GET';
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      this.calls.push({ method, path: path + url.search, body });
      const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
      const items = this.app === 'radarr' ? '/movie' : '/series';
      if (path === '/system/status') return json({ version: this.app === 'radarr' ? '6.4.4.10685' : '4.0.20.3014' });
      if (path === '/qualityprofile') return json([{ id: 1, name: 'Any' }, { id: 4, name: 'HD-1080p' }]);
      if (path === '/rootfolder') return json([{ path: this.app === 'radarr' ? '/movies' : '/tv', freeSpace: 1_099e9, accessible: true }]);
      if (path === '/tag') return json([{ id: 3, label: 'maverick' }]);
      if (path === '/history' && method === 'GET') {
        const want = { 3: 'downloadFolderImported', 7: 'movieFolderImported' }[Number(url.searchParams.get('eventType'))];
        const all = this.history.filter((h) => !want || h.eventType === want).sort((a, b) => a.date.localeCompare(b.date));
        const page = Number(url.searchParams.get('page') ?? 1), size = Number(url.searchParams.get('pageSize') ?? 10);
        return json({ page, pageSize: size, totalRecords: all.length, records: all.slice((page - 1) * size, page * size) });
      }
      if (path === items && method === 'GET') return json(this.library.map((m) => ({ ...m, statistics: { episodeFileCount: m.hasFile ? 1 : 0 } })));
      if (path === `${items}/lookup`) {
        const term = url.searchParams.get('term') ?? '';
        const [kind, id] = term.split(':');
        const t = this.catalogue.find((x) => (kind === 'tmdb' && String(x.tmdbId) === id) || (kind === 'imdb' && x.imdbId === id) || (kind === 'tvdb' && String(x.tvdbId) === id));
        if (!t) return json([]);
        const own = this.library.find((m) => (t.tmdbId && m.tmdbId === t.tmdbId) || (t.tvdbId && m.tvdbId === t.tvdbId));
        return json([{ ...t, id: own?.id ?? 0, ...(this.app === 'radarr' ? { isExcluded: this.excluded.has(t.tmdbId ?? -1) } : {}) }]);
      }
      if (path === items && method === 'POST') {
        if (typeof body.monitored !== 'boolean' || body.qualityProfileId === undefined || !body.rootFolderPath) return json({ message: 'invalid' }, 400);
        const id = this.seq++;
        this.library.push({ ...body, id, hasFile: false });
        return json({ ...body, id }, 201);
      }
      if (path === '/exclusions/paged' || path === '/importlistexclusion/paged') {
        const page = Number(url.searchParams.get('page'));
        const all = [...this.excluded].map((id) => (this.app === 'radarr' ? { tmdbId: id } : { tvdbId: id }));
        return json({ page, totalRecords: all.length, records: page === 1 ? all : [] });
      }
      if (path === '/collection' && method === 'GET') return json(this.collections);
      if (path === '/collection' && method === 'PUT') {
        for (const c of this.collections) if (body.collectionIds.includes(c.id)) c.monitored = body.monitored;
        return json(this.collections.filter((c) => body.collectionIds.includes(c.id)), 202);
      }
      if (path === '/command' && method === 'POST') return json({ id: 1, name: body.name }, 201);
      return new Response('not found', { status: 404 });
    };
  }
}

export const RADARR_CATALOGUE: Title[] = [
  { title: 'Halloween III: Season of the Witch', year: 1982, tmdbId: 10676, imdbId: 'tt0085636', status: 'released' },
  { title: 'Halloween: Resurrection', year: 2002, tmdbId: 11442, imdbId: 'tt0220506', status: 'released' },
  { title: 'Halloween Kills', year: 2021, tmdbId: 610253, imdbId: 'tt10665338', status: 'released' },
  { title: 'Trick ’r Treat', year: 2007, tmdbId: 23202, imdbId: 'tt0862856', status: 'released' },
  { title: 'Halloween Forever', year: 2027, tmdbId: 999001, imdbId: 'tt9990001', status: 'announced' },
  { title: 'Hocus Pocus 2', year: 2022, tmdbId: 642885, imdbId: 'tt3228088', status: 'inCinemas', digitalRelease: '2022-09-30T00:00:00Z' },
];

export const SONARR_CATALOGUE: Title[] = [
  { title: 'Star Trek: Lower Decks', year: 2020, tvdbId: 367138, imdbId: 'tt9184820', status: 'ended', firstAired: '2020-08-06' },
  { title: 'Upcoming Show', year: 2027, tvdbId: 999999, status: 'upcoming' },
];
