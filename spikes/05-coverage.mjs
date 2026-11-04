// Spike 1e (read-only): for each of the 19 Kometa seasonal presets, how many titles you own, by source.
// Then the same for Christmas, Halloween and Thanksgiving episodes. Run 01-jellyfin.mjs first (it writes the library index).
// Flags: --no-find (skip TMDb /find fallback), --letterboxd-full (resolve every Letterboxd film page; slow).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv, http, sleep, save, report, imdbHashes, imdbList, imdbSearch, HERE, OUT } from './lib.mjs';

loadEnv();
const args = new Set(process.argv.slice(2));
const indexPath = join(OUT, 'library-index.json');
if (!existsSync(indexPath)) { console.error('Run 01-jellyfin.mjs first (it writes spikes/out/library-index.json).'); process.exit(2); }
const lib = JSON.parse(readFileSync(indexPath, 'utf8'));
const presets = JSON.parse(readFileSync(join(HERE, 'seasonal-presets.json'), 'utf8')).presets;
const TMDB = process.env.TMDB_API_KEY;
const tmdb = (path) => http(`https://api.themoviedb.org/3${path}${path.includes('?') ? '&' : '?'}api_key=${TMDB}`);

// Library lookups by provider ID
const byImdb = new Map(), byTmdbMovie = new Map(), byTmdbShow = new Map(), byTvdb = new Map();
for (const m of lib.movies) { if (m.p?.Imdb) byImdb.set(m.p.Imdb, m); if (m.p?.Tmdb) byTmdbMovie.set(String(m.p.Tmdb), m); }
for (const s of lib.series) { if (s.p?.Imdb) byImdb.set(s.p.Imdb, s); if (s.p?.Tmdb) byTmdbShow.set(String(s.p.Tmdb), s); if (s.p?.Tvdb) byTvdb.set(String(s.p.Tvdb), s); }
const moviesWithoutImdb = lib.movies.filter((m) => !m.p?.Imdb && m.p?.Tmdb).length;

// TMDb /find fallback for IMDb IDs that did not match directly (only useful if some owned titles lack an IMDb ID)
const findCache = new Map();
async function findTmdb(imdbId) {
  if (!TMDB || args.has('--no-find') || moviesWithoutImdb === 0) return null;
  if (findCache.has(imdbId)) return findCache.get(imdbId);
  const r = await tmdb(`/find/${imdbId}?external_source=imdb_id`); await sleep(30);
  const hit = r.json?.movie_results?.[0] ? { kind: 'movie', id: String(r.json.movie_results[0].id) } : r.json?.tv_results?.[0] ? { kind: 'tv', id: String(r.json.tv_results[0].id) } : null;
  findCache.set(imdbId, hit); return hit;
}
async function matchImdb(ids) {
  const movies = new Set(), shows = new Set(); let viaFind = 0;
  for (const id of ids) {
    const hit = byImdb.get(id);
    if (hit) { (lib.series.includes(hit) ? shows : movies).add(hit.id); continue; }
    const f = await findTmdb(id);
    const m = f?.kind === 'movie' ? byTmdbMovie.get(f.id) : f?.kind === 'tv' ? byTmdbShow.get(f.id) : null;
    if (m) { (f.kind === 'tv' ? shows : movies).add(m.id); viaFind++; }
  }
  return { movies, shows, viaFind };
}

const h = await imdbHashes();
const rows = [], detail = {};
for (const p of presets) {
  const union = new Set(); const srcRows = [];
  for (const s of p.sources) {
    let listed = 0, owned = { movies: new Set(), shows: new Set() }, note = '';
    if (s.type === 'imdb_search') {
      const [by, order] = s.sortBy.split('.');
      const c = { titleTypeConstraint: { anyTitleTypeIds: (s.titleTypes || []).map((t) => ({ movie: 'movie', tv_series: 'tvSeries' }[t] || t)) } };
      if (s.listAny) c.listConstraint = { inAnyList: s.listAny };
      if (s.keywordAny) c.keywordConstraint = { anyKeywords: s.keywordAny.map((k) => k.replace(/ /g, '-')) };
      const r = await imdbSearch(h.search, c, { limit: s.limit, sortBy: { popularity: 'POPULARITY', rating: 'USER_RATING' }[by], sortOrder: order.toUpperCase() });
      if (r.error) note = `ERROR ${r.error}`;
      listed = r.items.length; const m = await matchImdb(r.items.map((i) => i.id)); owned = m;
      note ||= `${r.total} matched IMDb, kept ${listed}` + (m.viaFind ? `, ${m.viaFind} via /find` : '');
      if (s.listAny) {
        const union = new Set(); for (const ls of s.listAny) (await imdbList(h.list, ls)).ids.forEach((i) => union.add(i));
        note += `; union of lists = ${union.size}${union.size > s.limit ? ' (over the limit: plain union would differ from Kometa)' : ''}`;
      }
    } else if (s.type === 'tmdb_collection') {
      if (!TMDB) { note = 'skipped: no TMDB_API_KEY'; } else {
        for (const id of s.ids) { const r = await tmdb(`/collection/${id}`); for (const part of r.json?.parts || []) { listed++; const m = byTmdbMovie.get(String(part.id)); if (m) owned.movies.add(m.id); } }
      }
    } else if (s.type === 'tmdb_movie') {
      listed = s.ids.length; for (const id of s.ids) { const m = byTmdbMovie.get(String(id)); if (m) owned.movies.add(m.id); }
    } else if (s.type === 'mdblist_list') {
      const r = await http(s.url.replace(/\/$/, '') + '/json');
      const items = r.json || []; listed = items.length; if (!r.ok) note = `ERROR HTTP ${r.status}`;
      for (const i of items) {
        const m = (i.imdb_id && byImdb.get(i.imdb_id)) || (i.mediatype === 'show' ? (byTvdb.get(String(i.tvdbid)) || byTmdbShow.get(String(i.id))) : byTmdbMovie.get(String(i.id)));
        if (m) (i.mediatype === 'show' ? owned.shows : owned.movies).add(m.id);
      }
    } else if (s.type === 'letterboxd_list') {
      const r = await http(s.url);
      const slugs = [...new Set([...(r.text || '').matchAll(/data-(?:film-slug|target-link)="\/?(?:film\/)?([a-z0-9-]+)\/?"/g)].map((x) => x[1]))];
      if (!r.ok) note = `blocked: HTTP ${r.status}${/cf-mitigated|Just a moment/.test(r.text || '') ? ' (Cloudflare challenge)' : ''}`;
      else if (!args.has('--letterboxd-full')) note = `reachable; ${slugs.length} films on page 1 (run with --letterboxd-full to resolve IDs)`;
      else {
        for (const slug of slugs) { const f = await http(`https://letterboxd.com/film/${slug}/`); const imdb = f.text?.match(/imdb\.com\/title\/(tt\d+)/)?.[1]; listed++; if (imdb && byImdb.get(imdb)) owned.movies.add(byImdb.get(imdb).id); await sleep(400); }
        note = `resolved ${listed} films from page 1`;
      }
    }
    owned.movies.forEach((i) => union.add(i));
    srcRows.push({ source: s.type + (s.url ? ` ${s.url.split('/').filter(Boolean).slice(-1)[0]}` : s.listAny ? ` lists×${s.listAny.length}` : s.keywordAny ? ` kw:${s.keywordAny.join('|')}` : ''), listed, ownedMovies: owned.movies.size, ownedShows: owned.shows.size, note });
  }
  rows.push({ preset: p.key, name: p.name, window: `${p.window.from}–${p.window.to}`, ownedMoviesUnion: union.size });
  detail[p.key] = srcRows;
  console.log(`${p.key.padEnd(14)} owned ${String(union.size).padStart(4)}  ` + srcRows.map((r) => `${r.source}: ${r.ownedMovies}/${r.listed}${r.ownedShows ? ` (+${r.ownedShows} shows)` : ''}`).join(' · '));
}

// Holiday episodes: IMDb episode keyword search limited to the series you own, plus episode-title suggestions.
const ownedSeriesImdb = lib.series.map((s) => s.p?.Imdb).filter(Boolean);
const epByImdb = new Map(lib.episodes.filter((e) => e.p?.Imdb).map((e) => [e.p.Imdb, e]));
const seriesById = new Map(lib.series.map((s) => [s.id, s]));
const epBySE = new Map(lib.episodes.map((e) => { const s = seriesById.get(e.seriesId); return [`${s?.p?.Tmdb}|${e.s}|${e.e}`, e]; }));
const episodes = {};
for (const kw of ['christmas', 'halloween', 'thanksgiving']) {
  const hits = [];
  for (let i = 0; i < ownedSeriesImdb.length; i += 50) {
    const r = await imdbSearch(h.search, { titleTypeConstraint: { anyTitleTypeIds: ['tvEpisode'] }, keywordConstraint: { anyKeywords: [kw] }, episodicConstraint: { anySeriesIds: ownedSeriesImdb.slice(i, i + 50) } }, { limit: 1000 });
    if (r.error) { hits.error = r.error; break; } hits.push(...r.items);
  }
  let direct = 0, viaFind = 0, notOwned = 0;
  for (const ep of hits) {
    if (epByImdb.has(ep.id)) { direct++; continue; }
    if (TMDB && !args.has('--no-find')) {
      const r = await tmdb(`/find/${ep.id}?external_source=imdb_id`); await sleep(30);
      const t = r.json?.tv_episode_results?.[0];
      if (t && epBySE.has(`${t.show_id}|${t.season_number}|${t.episode_number}`)) { viaFind++; continue; }
    }
    notOwned++;
  }
  const re = new RegExp(kw, 'i');
  const titleMatches = lib.episodes.filter((e) => re.test(e.name || ''));
  episodes[kw] = { ownedSeriesSearched: ownedSeriesImdb.length, imdbEpisodeHits: hits.length, ownedByImdbId: direct, ownedViaTmdbFind: viaFind, airedButNotInLibrary: notOwned, titleMatchSuggestions: titleMatches.length, error: hits.error };
}

report('Seasonal presets: owned movies (union across sources)', rows);
report('Holiday episodes', episodes);
save('coverage.json', { generatedAt: new Date().toISOString(), moviesWithoutImdb, rows, detail, episodes });
