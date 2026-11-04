// Spike 1a (read-only): Jellyfin version, OpenAPI spec, endpoints we depend on, libraries,
// ProviderId coverage, and the box sets that already exist (for adoption and name collisions).
import { loadEnv, need, jf, save, report } from './lib.mjs';

loadEnv(); need('JELLYFIN_URL', 'JELLYFIN_API_KEY');
const { call } = jf();

const info = await call('/System/Info');
if (!info.ok) { report('Jellyfin /System/Info failed', { status: info.status, error: info.error }); process.exit(1); }
report('Server', { version: info.json.Version, product: info.json.ProductName, os: info.json.OperatingSystemDisplayName, id: info.json.Id?.slice(0, 8) });

const spec = await call('/api-docs/openapi.json', { timeout: 60000 });
if (spec.ok) {
  save('jellyfin-openapi.json', spec.text);
  const paths = spec.json.paths;
  const needed = [
    ['post', '/Collections'], ['post', '/Collections/{collectionId}/Items'], ['delete', '/Collections/{collectionId}/Items'],
    ['delete', '/Items/{itemId}'], ['post', '/Items/{itemId}'], ['get', '/Items/{itemId}'], ['post', '/Items/{itemId}/Images/{imageType}'],
    ['get', '/Items'], ['post', '/Playlists'], ['post', '/Playlists/{playlistId}/Items'], ['post', '/Playlists/{playlistId}/Users/{userId}'],
    ['post', '/Users/AuthenticateByName'], ['post', '/Users/{userId}/Policy'], ['get', '/UserViews'],
  ];
  const itemsParams = (paths['/Items']?.get?.parameters || []).map((p) => p.name);
  report('OpenAPI', {
    specVersion: spec.json.info?.version,
    endpoints: Object.fromEntries(needed.map(([m, p]) => [`${m.toUpperCase()} ${p}`, Boolean(paths[p]?.[m])])),
    itemsParamsOfInterest: Object.fromEntries(['collapseBoxSetItems', 'hasImdbId', 'hasTmdbId', 'hasTvdbId', 'tags', 'fields', 'anyProviderIdEquals', 'excludeItemIds'].map((n) => [n, itemsParams.includes(n)])),
    imageUploadRequestBody: Object.keys(paths['/Items/{itemId}/Images/{imageType}']?.post?.requestBody?.content || {}),
    savedTo: 'spikes/out/jellyfin-openapi.json',
  });
}

// Libraries
const vf = await call('/Library/VirtualFolders');
const libs = (vf.json || []).map((l) => ({ name: l.Name, type: l.CollectionType, id: l.ItemId }));
report('Libraries', libs.map(({ name, type }) => ({ name, type })));

// ProviderId coverage per library and item type. Fields=ProviderIds; CollapseBoxSetItems=false so movies in box sets are not hidden.
async function all(params) {
  const out = []; let start = 0;
  for (;;) {
    const q = new URLSearchParams({ Recursive: 'true', Fields: 'ProviderIds,Tags,SortName,ParentId', CollapseBoxSetItems: 'false', StartIndex: String(start), Limit: '1000', ...params });
    const r = await call(`/Items?${q}`, { timeout: 120000 });
    if (!r.ok) return { error: r.status, items: out };
    out.push(...r.json.Items); start += r.json.Items.length;
    if (start >= r.json.TotalRecordCount || !r.json.Items.length) return { items: out, total: r.json.TotalRecordCount };
  }
}
const coverage = [];
const index = { movies: [], series: [], episodes: [] };
for (const lib of libs.filter((l) => ['movies', 'tvshows'].includes(l.type))) {
  for (const type of lib.type === 'movies' ? ['Movie'] : ['Series', 'Episode']) {
    const { items } = await all({ ParentId: lib.id, IncludeItemTypes: type });
    const has = (k) => items.filter((i) => i.ProviderIds?.[k]).length;
    coverage.push({ library: lib.name, type, count: items.length, imdb: has('Imdb'), tmdb: has('Tmdb'), tvdb: has('Tvdb'), noIds: items.filter((i) => !i.ProviderIds?.Imdb && !i.ProviderIds?.Tmdb && !i.ProviderIds?.Tvdb).length });
    const bucket = type === 'Movie' ? index.movies : type === 'Series' ? index.series : index.episodes;
    for (const i of items) bucket.push({ id: i.Id, name: i.Name, year: i.ProductionYear, lib: lib.name, p: i.ProviderIds, s: i.ParentIndexNumber, e: i.IndexNumber, seriesId: i.SeriesId });
  }
}
report('ProviderId coverage', coverage);
save('library-index.json', index);

// Existing box sets: names, sizes, tags (Jellyfin-Auto-Collections marks its own), sort names.
const boxsets = (await all({ IncludeItemTypes: 'BoxSet' })).items;
const seasonalNames = ["New Year's Day", "Valentine's Day", "St. Patrick's Day", 'Easter', "Mother's Day", 'Memorial Day', "Father's Day", 'Independence Day', 'Labor Day', 'Halloween', "Veteran's Day", 'Thanksgiving', 'Christmas', 'Asian American & Pacific Islander Heritage Month', 'Day of Persons with Disabilities', 'Black History Month', 'LGBTQ+ Pride Month', 'Latinx Heritage Month', "Women's History Month"].map((n) => `${n} Movies`);
const summary = boxsets.map((b) => ({ name: b.Name, sortName: b.SortName, tags: b.Tags, jac: (b.Tags || []).includes('Jellyfin-Auto-Collections'), seasonalNameMatch: seasonalNames.includes(b.Name), childCount: b.ChildCount }));
report('Box sets', {
  total: summary.length,
  jellyfinAutoCollections: summary.filter((b) => b.jac).map((b) => b.name),
  matchSeasonalNames: summary.filter((b) => b.seasonalNameMatch).map((b) => b.name),
  untaggedSample: summary.filter((b) => !b.jac).slice(0, 15).map((b) => b.name),
});
save('boxsets.json', summary);

const users = await call('/Users');
report('Users', { count: users.json?.length, admins: users.json?.filter((u) => u.Policy?.IsAdministrator).length, withBlockedTags: users.json?.filter((u) => (u.Policy?.BlockedTags || []).length).length });
console.log('\nDone. Full output in spikes/out/. Paste the console output above back into the session (it is redacted).');
