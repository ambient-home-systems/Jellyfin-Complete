// IMDb resolver, the way Kometa v2.5.3 does it (modules/imdb.py): GraphQL persisted queries against
// api.graphql.imdb.com with hashes from Kometa-Team/IMDb-Hash. Never scrapes IMDb HTML pages.
//
// This module must only use `fetch` and plain JS — no `node:` imports — so the same file runs in the app,
// in a GitHub Action (snapshot route) or in a Worker (ADR-011, ADR-028). test/imdb.test.ts enforces that.

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export const GRAPHQL_URL = 'https://api.graphql.imdb.com/';
export const HASH_URLS = {
  list: 'https://raw.githubusercontent.com/Kometa-Team/IMDb-Hash/master/LIST_HASH',
  search: 'https://raw.githubusercontent.com/Kometa-Team/IMDb-Hash/master/HASH',
} as const;
export const KOMETA_SERVICE_URL = 'https://utilities.kometa.wiki/imdb-service/search/advanced';

export class ImdbError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

export type ImdbTitle = { id: string; type?: string; title?: string; year?: number; seriesId?: string };

// ── option tables, from Kometa modules/imdb.py ──
export const TITLE_TYPES: Record<string, string> = {
  movie: 'movie', tv_series: 'tvSeries', short: 'short', tv_episode: 'tvEpisode', tv_mini_series: 'tvMiniSeries',
  tv_movie: 'tvMovie', tv_special: 'tvSpecial', tv_short: 'tvShort', video_game: 'videoGame', video: 'video',
  music_video: 'musicVideo', podcast_series: 'podcastSeries', podcast_episode: 'podcastEpisode',
};
export const SEARCH_SORT: Record<string, string> = {
  popularity: 'POPULARITY', title: 'TITLE_REGIONAL', rating: 'USER_RATING', votes: 'USER_RATING_COUNT',
  box_office: 'BOX_OFFICE_GROSS_DOMESTIC', runtime: 'RUNTIME', year: 'YEAR', release: 'RELEASE_DATE',
};
export const LIST_SORT: Record<string, string> = {
  custom: 'LIST_ORDER', popularity: 'POPULARITY', title: 'TITLE_REGIONAL', rating: 'USER_RATING',
  votes: 'USER_RATING_COUNT', runtime: 'RUNTIME', added: 'DATE_ADDED', release: 'RELEASE_DATE',
};
const GENRES = ['Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Documentary', 'Drama', 'Crime', 'Family', 'History',
  'News', 'Short', 'Western', 'Sport', 'Reality-TV', 'Horror', 'Fantasy', 'Film-Noir', 'Music', 'Romance', 'Talk-Show',
  'Thriller', 'War', 'Sci-Fi', 'Musical', 'Mystery', 'Game-Show', 'Adult'];
const GENRE_MAP: Record<string, string> = Object.fromEntries(GENRES.map((g) => [g.toLowerCase(), g]));

/** A Kometa `imdb_search` block, e.g. `{ 'list.any': ['ls…'], limit: 500 }` or `{ 'keyword.any': 'thanksgiving' }`. */
export type KometaImdbSearch = Record<string, unknown>;

function list(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  return (Array.isArray(v) ? v : String(v).split(',')).map((x) => String(x).trim()).filter(Boolean);
}

/** Translate a Kometa imdb_search block into AdvancedTitleSearch constraints (Kometa's _graphql_variables). */
export function searchConstraints(search: KometaImdbSearch): Record<string, unknown> {
  const out: Record<string, Record<string, unknown>> = {};
  const set = (constraint: string, key: string, value: unknown) => {
    out[constraint] = { ...(out[constraint] ?? {}), [key]: value };
  };
  const mods = (attr: string, pairs: [string, string][], constraint: string, suffix: string, tr: (v: string) => string = (v) => v) => {
    for (const [mod, imdbMod] of pairs) {
      const key = mod ? `${attr}.${mod}` : attr;
      if (key in search) set(constraint, `${imdbMod}${suffix}`, list(search[key]).map(tr));
    }
  };
  const types = list(search.type).map((t) => {
    const v = TITLE_TYPES[t.toLowerCase()];
    if (!v) throw new ImdbError(`Unknown IMDb title type: ${t}`, 'BAD_INPUT');
    return v;
  });
  out.titleTypeConstraint = { anyTitleTypeIds: types };
  if ('type.not' in search) set('titleTypeConstraint', 'excludeTitleTypeIds', list(search['type.not']).map((t) => TITLE_TYPES[t.toLowerCase()] ?? t));

  for (const [attr, range, constraint] of [['release', 'releaseDateRange', 'releaseDateConstraint']] as const) {
    const r: Record<string, unknown> = {};
    if (`${attr}.after` in search) r.start = String(search[`${attr}.after`]);
    if (`${attr}.before` in search) r.end = String(search[`${attr}.before`]);
    if (Object.keys(r).length) set(constraint, range, r);
  }
  const ratings: Record<string, Record<string, number>> = {};
  for (const [attr, range] of [['rating', 'aggregateRatingRange'], ['votes', 'ratingsCountRange']] as const) {
    for (const [mod, key] of [['gte', 'min'], ['lte', 'max']] as const) {
      if (`${attr}.${mod}` in search) ratings[range] = { ...(ratings[range] ?? {}), [key]: Number(search[`${attr}.${mod}`]) };
    }
  }
  if (Object.keys(ratings).length) out.userRatingsConstraint = ratings;
  if ('title' in search) set('titleTextConstraint', 'searchTerm', String(search.title));
  mods('genre', [['', 'all'], ['any', 'any'], ['not', 'exclude']], 'genreConstraint', 'GenreIds', (g) => GENRE_MAP[g.toLowerCase()] ?? g);
  mods('series', [['', 'any'], ['any', 'any'], ['not', 'exclude']], 'episodicConstraint', 'SeriesIds');
  mods('list', [['', 'inAllLists'], ['any', 'inAnyList'], ['not', 'notInAnyList']], 'listConstraint', '');
  mods('keyword', [['', 'all'], ['any', 'any'], ['not', 'exclude']], 'keywordConstraint', 'Keywords', (k) => k.toLowerCase().replace(/ /g, '-'));
  mods('country', [['', 'all'], ['any', 'any'], ['not', 'exclude'], ['origin', 'anyPrimary']], 'originCountryConstraint', 'Countries', (c) => c.toUpperCase());
  mods('language', [['', 'all'], ['any', 'any'], ['not', 'exclude'], ['primary', 'anyPrimary']], 'languageConstraint', 'Languages');
  const runtime: Record<string, number> = {};
  if ('runtime.gte' in search) runtime.min = Number(search['runtime.gte']);
  if ('runtime.lte' in search) runtime.max = Number(search['runtime.lte']);
  if (Object.keys(runtime).length) set('runtimeConstraint', 'runtimeRangeMinutes', runtime);
  return out;
}

export function searchSort(search: KometaImdbSearch): { sortBy: string; sortOrder: string } {
  const [by = 'popularity', order = 'asc'] = String(search.sort_by ?? 'popularity.asc').split('.');
  const sortBy = SEARCH_SORT[by];
  if (!sortBy) throw new ImdbError(`Unknown IMDb sort: ${by}`, 'BAD_INPUT');
  return { sortBy, sortOrder: order.toUpperCase() };
}

/** Kometa's imdb_search defaults `limit` to 100. */
export function searchLimit(search: KometaImdbSearch): number {
  const n = Number(search.limit ?? 100);
  return Number.isFinite(n) && n > 0 ? n : 100;
}

// ── transport ──
export async function fetchHashes(f: Fetch): Promise<{ list: string; search: string }> {
  const [list, search] = await Promise.all([f(HASH_URLS.list), f(HASH_URLS.search)]);
  if (!list.ok || !search.ok) throw new ImdbError(`Could not fetch IMDb hash files (HTTP ${list.status}/${search.status})`, 'HASH_FETCH_FAILED');
  return { list: (await list.text()).trim(), search: (await search.text()).trim() };
}

async function graphql(f: Fetch, operationName: string, sha256Hash: string, variables: Record<string, unknown>): Promise<any> {
  const res = await f(GRAPHQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-imdb-client-name': 'imdb-web-next' },
    body: JSON.stringify({ operationName, variables, extensions: { persistedQuery: { version: 1, sha256Hash } } }),
  });
  if (!res.ok) throw new ImdbError(`IMDb GraphQL HTTP ${res.status}`, res.status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR');
  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new ImdbError('IMDb GraphQL returned a non-JSON response', 'BAD_RESPONSE');
  }
  if (json.errors?.length) {
    const code = json.errors[0]?.extensions?.code ?? (String(json.errors[0]?.message).includes('PersistedQueryNotFound') ? 'PERSISTED_QUERY_NOT_FOUND' : 'GRAPHQL_ERROR');
    throw new ImdbError(`IMDb: ${json.errors[0]?.message ?? code}`, code);
  }
  return json.data;
}

/** All titles on an IMDb list (`ls…`), 100 per page with cursor paging. */
export async function imdbList(f: Fetch, listHash: string, listId: string, opts: { limit?: number; sort?: string } = {}): Promise<{ ids: string[]; total: number; titles: ImdbTitle[] }> {
  const [by = 'custom', order = 'asc'] = (opts.sort ?? 'custom.asc').split('.');
  const ids: string[] = [];
  const titles: ImdbTitle[] = [];
  let after: string | undefined;
  let total = 0;
  for (;;) {
    const variables: Record<string, unknown> = { locale: 'en-US', first: 100, lsConst: listId, isInPace: false, sort: { by: LIST_SORT[by] ?? 'LIST_ORDER', order: order.toUpperCase() } };
    if (after) variables.after = after;
    const data = await graphql(f, 'TitleListMainPage', listHash, variables);
    const s = data?.list?.titleListItemSearch;
    if (!s) throw new ImdbError(`IMDb list ${listId} not found`, 'RESOURCE_NOT_FOUND');
    total = s.total;
    for (const e of s.edges as any[]) {
      // Kometa only reads the ID; the title, year and type come in the same response and help the Missing page.
      const t = e.listItem;
      ids.push(t.id as string);
      titles.push({ id: t.id, type: t.titleType?.id, title: t.titleText?.text, year: t.releaseYear?.year });
    }
    if (opts.limit && ids.length >= opts.limit) return { ids: ids.slice(0, opts.limit), total, titles: titles.slice(0, opts.limit) };
    if (!s.pageInfo?.hasNextPage || s.edges.length === 0) return { ids, total, titles };
    after = s.pageInfo.endCursor;
  }
}

/** AdvancedTitleSearch with Kometa's semantics (sort, limit; 250 per page). */
export async function imdbSearch(f: Fetch, searchHash: string, search: KometaImdbSearch): Promise<{ titles: ImdbTitle[]; total: number }> {
  const constraints = searchConstraints(search);
  const { sortBy, sortOrder } = searchSort(search);
  const limit = searchLimit(search);
  const titles: ImdbTitle[] = [];
  let after: string | undefined;
  let total = 0;
  while (titles.length < limit) {
    const variables: Record<string, unknown> = { locale: 'en-US', first: Math.min(250, limit - titles.length), sortBy, sortOrder, ...constraints };
    if (after) variables.after = after;
    const data = await graphql(f, 'AdvancedTitleSearch', searchHash, variables);
    const s = data?.advancedTitleSearch;
    if (!s) throw new ImdbError('IMDb search returned no data', 'BAD_RESPONSE');
    total = s.total;
    for (const e of s.edges) {
      const t = e.node.title;
      titles.push({ id: t.id, type: t.titleType?.id, title: t.titleText?.text, year: t.releaseYear?.year, seriesId: t.series?.series?.id });
    }
    if (!s.pageInfo?.hasNextPage || s.edges.length === 0) break;
    after = s.pageInfo.endCursor;
  }
  return { titles: titles.slice(0, limit), total };
}

/** Kometa's hosted IMDb service (opt-in parity route; off by default — ADR-011, ADR-031). */
export async function kometaServiceSearch(f: Fetch, search: KometaImdbSearch): Promise<{ titles: ImdbTitle[]; total: number }> {
  const constraints = searchConstraints(search);
  const res = await f(KOMETA_SERVICE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ constraints, sort: searchSort(search), limit: searchLimit(search) }),
  });
  if (!res.ok) throw new ImdbError(`Kometa IMDb service HTTP ${res.status}`, 'HTTP_ERROR');
  const json: any = await res.json();
  const ids: string[] = json.results ?? [];
  return { titles: ids.map((id) => ({ id })), total: json.total ?? ids.length };
}
