// Spike 1d (read-only): Radarr and Sonarr versions, profiles, root folders, tags, exclusions,
// Radarr collections, and a Sonarr series lookup by TVDB ID. GET requests only.
import { loadEnv, http, report, save } from './lib.mjs';

loadEnv();
const out = {};

async function arr(name, urlKey, keyKey) {
  const base = process.env[urlKey]?.replace(/\/$/, ''); const key = process.env[keyKey];
  if (!base || !key) { report(name, `skipped: set ${urlKey} and ${keyKey} in .env`); return null; }
  return (path) => http(`${base}/api/v3${path}`, { headers: { 'X-Api-Key': key } });
}

const radarr = await arr('Radarr', 'RADARR_URL', 'RADARR_API_KEY');
if (radarr) {
  const [status, qp, rf, tags, excl, coll] = await Promise.all(['/system/status', '/qualityprofile', '/rootfolder', '/tag', '/exclusions/paged?page=1&pageSize=1', '/collection'].map(radarr));
  const collections = coll.json || [];
  out.radarr = {
    version: status.json?.version, branch: status.json?.branch,
    qualityProfiles: qp.json?.map((p) => p.name), rootFolders: rf.json?.map((r) => ({ path: r.path, accessible: r.accessible, freeGB: r.freeSpace ? Math.round(r.freeSpace / 1e9) : null })),
    tags: tags.json?.map((t) => t.label), exclusions: excl.json?.totalRecords ?? (excl.ok ? 0 : `HTTP ${excl.status}`),
    collections: { total: collections.length, monitored: collections.filter((c) => c.monitored).length, withMissing: collections.filter((c) => c.missingMovies > 0).length,
      sample: collections.slice(0, 5).map((c) => ({ title: c.title, tmdbId: c.tmdbId, monitored: c.monitored, missing: c.missingMovies })) },
    seasonalTmdbCollectionsPresent: [185103, 11716, 750822, 313086, 91361, 8581, 1733, 8091, 2980, 751156].map((id) => ({ id, present: collections.some((c) => c.tmdbId === id) })),
  };
  // Lookup does not add anything. term=tmdb:… returns the library entry if present (id > 0) and isExcluded when excluded.
  const look = await radarr('/movie/lookup?term=tmdb:10676');
  out.radarr.lookupSample = look.json?.[0] ? { title: look.json[0].title, inLibrary: look.json[0].id > 0, isExcluded: look.json[0].isExcluded ?? false, status: look.json[0].status } : look.status;
}

const sonarr = await arr('Sonarr', 'SONARR_URL', 'SONARR_API_KEY');
if (sonarr) {
  const [status, qp, rf, tags, excl, series] = await Promise.all(['/system/status', '/qualityprofile', '/rootfolder', '/tag', '/importlistexclusion/paged?page=1&pageSize=1', '/series'].map(sonarr));
  out.sonarr = {
    version: status.json?.version, branch: status.json?.branch,
    qualityProfiles: qp.json?.map((p) => p.name), rootFolders: rf.json?.map((r) => ({ path: r.path, accessible: r.accessible, freeGB: r.freeSpace ? Math.round(r.freeSpace / 1e9) : null })),
    tags: tags.json?.map((t) => t.label), exclusions: excl.json?.totalRecords ?? (excl.ok ? 0 : `HTTP ${excl.status}`),
    seriesInLibrary: series.json?.length,
    seriesTypes: series.json?.reduce((a, s) => ({ ...a, [s.seriesType]: (a[s.seriesType] || 0) + 1 }), {}),
  };
  // Read-only lookups: by name to find a TVDB ID, then by tvdb:<id> the way the app will add shows.
  const byName = await sonarr('/series/lookup?term=' + encodeURIComponent('Star Trek: Lower Decks'));
  const tvdbId = byName.json?.[0]?.tvdbId;
  const look = tvdbId ? await sonarr(`/series/lookup?term=tvdb:${tvdbId}`) : byName;
  const s = look.json?.[0];
  out.sonarr.lookupSample = s ? { title: s.title, tvdbId: s.tvdbId, inLibrary: s.id > 0, status: s.status, firstAired: s.firstAired, seasons: s.seasons?.length } : look.status;
}

report('Radarr / Sonarr', out);
save('arr.json', out);
