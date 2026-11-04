// Spike 1c (read-only): can THIS machine reach IMDb's GraphQL API the way Kometa 2.5.3 does?
// One seasonal list (TitleListMainPage) and one keyword search (AdvancedTitleSearch).
import { imdbHashes, imdbList, imdbSearch, report, save } from './lib.mjs';

const h = await imdbHashes();
if (!h.ok) { report('IMDb hashes', 'could not fetch hash files from raw.githubusercontent.com'); process.exit(1); }
const t0 = Date.now();
const list = await imdbList(h.list, 'ls066838460'); // New Year's Day preset list
const kw = await imdbSearch(h.search, { titleTypeConstraint: { anyTitleTypeIds: [] }, keywordConstraint: { anyKeywords: ['thanksgiving'] } }, { limit: 500 });
const result = {
  where: process.env.SPIKE_LOCATION || 'this machine',
  hashes: { list: h.list.slice(0, 12), search: h.search.slice(0, 12) },
  titleListMainPage: list.error ? { error: list.error } : { list: 'ls066838460', total: list.total, fetched: list.ids.length },
  advancedTitleSearch: kw.error ? { error: kw.error } : { keyword: 'thanksgiving', total: kw.total, kept: kw.items.length },
  seconds: (Date.now() - t0) / 1000,
};
report('IMDb from ' + result.where, result);
save('imdb.json', result);
