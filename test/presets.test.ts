// Golden test: the TypeScript presets must match Kometa v2.5.3's seasonal.yml exactly (ADR-014).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse, parseDocument, isMap, isScalar } from 'yaml';
import { SEASONAL_PRESETS, presetDefinition } from '../src/presets/seasonal.js';
import { SHOW_FRANCHISES, showFranchiseDefinition } from '../src/presets/franchise.js';
import { UNIVERSES, universeDefinition } from '../src/presets/universe.js';
import { PRESETS } from '../src/presets/index.js';

const yml = parse(readFileSync(join(__dirname, 'fixtures/kometa-v2.5.3/seasonal.yml'), 'utf8'));
const seasonal = yml.dynamic_collections.Seasonal;
const tv = seasonal.template_variables;
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : String(v).split(',').map((s) => s.trim()));

describe('seasonal presets vs Kometa v2.5.3 seasonal.yml', () => {
  it('has all 19 keys in Kometa order, with the same key names', () => {
    expect(SEASONAL_PRESETS.map((p) => p.key)).toEqual(Object.keys(seasonal.data));
    for (const p of SEASONAL_PRESETS) expect(p.keyName).toBe(seasonal.data[p.key]);
  });

  it('uses the same windows', () => {
    for (const p of SEASONAL_PRESETS) expect(`range(${p.window.from}-${p.window.to})`).toBe(tv.schedule[p.key]);
  });

  it('uses the same IMDb searches (lists, keywords, type, sort, limit)', () => {
    for (const p of SEASONAL_PRESETS) {
      const mine = p.sources.find((s) => s.type === 'imdb_search')?.config.search as Record<string, unknown> | undefined;
      const theirs = tv.imdb_search[p.key];
      if (!theirs) {
        expect(mine).toBeUndefined();
        continue;
      }
      expect(mine?.limit).toBe(theirs.limit);
      for (const k of ['list.any', 'keyword.any', 'type', 'sort_by']) {
        if (k in theirs) expect(list(mine?.[k]), `${p.key} ${k}`).toEqual(list(theirs[k]));
        else expect(mine?.[k]).toBeUndefined();
      }
    }
  });

  it('uses the same TMDb, MDBList and Letterboxd sources', () => {
    for (const p of SEASONAL_PRESETS) {
      const ids = (type: string) => p.sources.filter((s) => s.type === type).flatMap((s) => list(s.config.ids));
      const urls = (type: string) => p.sources.filter((s) => s.type === type).map((s) => String(s.config.url));
      expect(ids('tmdb_collection').map(Number)).toEqual(tv.tmdb_collection[p.key] ?? []);
      expect(ids('tmdb_movie').map(Number)).toEqual(tv.tmdb_movie[p.key] ?? []);
      expect(urls('mdblist_list')).toEqual(tv.mdblist_list[p.key] ?? []);
      expect(urls('letterboxd_list')).toEqual(tv.letterboxd_list[p.key] ?? []);
    }
  });

  it('keeps the old emoji names as adoption candidates', () => {
    for (const p of SEASONAL_PRESETS) expect(p.deleteCollectionsNamed).toEqual([tv.delete_collections_named[p.key]]);
  });

  it('derives Kometa’s name, sort title, summary and poster', () => {
    const xmas = presetDefinition(SEASONAL_PRESETS.find((p) => p.key === 'christmas')!);
    expect(xmas).toMatchObject({
      name: 'Christmas Movies',
      sortTitle: '!00_Christmas Movies', // confirmed against Plex: !00_Thanksgiving Movies, !00_Veteran's Day Movies
      overview: 'A collection of Christmas movies that may relate to the season.',
      poster: { kind: 'url', url: 'https://raw.githubusercontent.com/Kometa-Team/Default-Images/master/seasonal/christmas.jpg' },
      syncMode: 'sync',
      sortBy: 'title.asc',
      minItems: 1,
      visibility: 'delete',
    });
    expect(tv.image.default).toBe('seasonal/<<key>>');
  });
});

describe('show franchise presets vs Kometa v2.5.3 defaults/show/franchise.yml', () => {
  const y = parse(readFileSync(join(__dirname, 'fixtures/kometa-v2.5.3/franchise.yml'), 'utf8'));
  const dyn = y.dynamic_collections['Show Franchise Collections'];
  const tmpl = y.templates.tmdbshow;

  it('has all 27 shows in Kometa order, with the same names and spin-offs', () => {
    // Numeric keys lose their order in a JS object, so read the order from the document itself.
    const doc = parseDocument(readFileSync(join(__dirname, 'fixtures/kometa-v2.5.3/franchise.yml'), 'utf8'));
    const data = doc.getIn(['dynamic_collections', 'Show Franchise Collections', 'data']);
    const order = isMap(data) ? data.items.map((it) => String(isScalar(it.key) ? it.key.value : it.key)) : [];
    expect(order).toHaveLength(27);
    expect(SHOW_FRANCHISES.map((f) => f.key)).toEqual(order);
    for (const f of SHOW_FRANCHISES) {
      expect(f.name).toBe(dyn.data[f.key]);
      const addons = dyn.addons[f.key] ?? dyn.addons[Number(f.key)];
      expect(f.addons).toEqual(list(addons));
    }
  });

  it('derives the definition like the tmdbshow template', () => {
    expect(tmpl.default.minimum_items).toBe(2);
    expect(tmpl.default.sync_mode).toBe('sync');
    expect(tmpl.default.collection_order).toBe('release');
    expect(y.external_templates).toBeUndefined(); // no collection_section, so Kometa drops the sort title
    const d = showFranchiseDefinition(SHOW_FRANCHISES.find((f) => f.key === '8514')!);
    expect(d).toMatchObject({ name: "RuPaul's Drag Race", target: 'shows', minItems: 2, syncMode: 'sync', sortBy: 'release', sortTitle: null, window: null });
    expect(d.sources).toEqual([{ type: 'tmdb_show', config: { ids: ['8514', ...SHOW_FRANCHISES.find((f) => f.key === '8514')!.addons] } }]);
    // key_name_encoded is Python's quote(): ' and ( ) are escaped too.
    expect(d.poster).toEqual({ kind: 'url', url: 'https://raw.githubusercontent.com/Kometa-Team/Default-Images/master/franchise/RuPaul%27s%20Drag%20Race.jpg' });
    expect(showFranchiseDefinition(SHOW_FRANCHISES.find((f) => f.key === '41956')!).poster).toMatchObject({ url: expect.stringMatching(/franchise\/Death%20in%20Paradise%20%282011%29\.jpg$/) });
    // Kometa's own URL for Father Brown (2013) is a 404 upstream; we use the file that exists.
    expect(showFranchiseDefinition(SHOW_FRANCHISES.find((f) => f.key === '61511')!).poster).toMatchObject({ url: expect.stringMatching(/franchise\/Father%20Brown\.jpg$/) });
  });
});

describe('universe presets vs Kometa v2.5.3 defaults/both/universe.yml', () => {
  const y = parse(readFileSync(join(__dirname, 'fixtures/kometa-v2.5.3/universe.yml'), 'utf8'));
  const dyn = y.dynamic_collections['Universe Collections'];
  const v = dyn.template_variables;

  it('has all 17 universes in Kometa order, with the same names', () => {
    expect(UNIVERSES.map((u) => u.key)).toEqual(Object.keys(dyn.data));
    for (const u of UNIVERSES) expect(u.name).toBe(dyn.data[u.key]);
  });

  it('uses the same list for each, and the same movie-only libraries', () => {
    for (const u of UNIVERSES) {
      const c = u.source.config as Record<string, string>;
      if (v.imdb_url[u.key]) expect(`https://www.imdb.com/list/${c.listId}/`).toBe(v.imdb_url[u.key]);
      else if (v.mdblist_url[u.key]) expect(c.url).toBe(v.mdblist_url[u.key]);
      else expect(c.listId).toBe(String(v.tmdb_url[u.key]));
      expect(u.movieOnly).toBe(v.allowed_libraries[u.key] === 'movie');
      expect(u.deleteCollectionsNamed).toEqual(v.delete_collections_named[u.key] ? [v.delete_collections_named[u.key]] : []);
    }
  });

  it('derives the definition like the universe and custom templates', () => {
    expect(y.external_templates.template_variables.collection_section).toBe('040');
    expect(y.templates.universe.default.minimum_items).toBe(2);
    expect(v.image.default).toBe('universe/<<key>>');
    const d = universeDefinition(UNIVERSES.find((u) => u.key === 'avp')!);
    expect(d).toMatchObject({ name: 'Alien / Predator', target: 'movies', minItems: 2, sortTitle: '!040_Alien / Predator', window: null });
    expect(d.poster).toEqual({ kind: 'url', url: 'https://raw.githubusercontent.com/Kometa-Team/Default-Images/master/universe/avp.jpg' });
    expect(universeDefinition(UNIVERSES.find((u) => u.key === 'mcu')!).target).toBe('both');
  });
});

describe('preset registry', () => {
  it('seeds 112 presets: seasonal films and holiday episodes on, universes, show franchises, charts and streaming off', () => {
    expect(PRESETS).toHaveLength(19 + 3 + 17 + 27 + 5 + 41);
    // Chart and streaming names clash with nothing (Star Trek and Arrowverse are both a universe and a show franchise, as in Kometa).
    const added = PRESETS.filter((p) => p.family === 'imdb_chart' || p.family === 'streaming').map((p) => p.definition.name);
    const others = new Set(PRESETS.filter((p) => p.family !== 'imdb_chart' && p.family !== 'streaming').map((p) => p.definition.name));
    expect(new Set(added).size).toBe(added.length);
    expect(added.filter((n) => others.has(n))).toEqual([]);
    expect(new Set(PRESETS.map((p) => p.definition.slug)).size).toBe(PRESETS.length);
    expect(PRESETS.filter((p) => p.enabledByDefault).every((p) => p.family === 'seasonal' || p.family === 'holiday_episodes')).toBe(true);
    expect(PRESETS.filter((p) => p.enabledByDefault)).toHaveLength(22);
  });

  it('opens holiday episodes with their film preset, and sends their additions to Review', () => {
    for (const p of PRESETS.filter((x) => x.family === 'holiday_episodes')) {
      const key = p.definition.presetKey.split(':')[1];
      const film = PRESETS.find((x) => x.definition.presetKey === `seasonal:${key}`)!;
      expect(p.definition.window).toEqual(film.definition.window);
      expect(p.definition.target).toBe('episodes');
      expect(p.definition.modes).toEqual({ 'collection.add_items': 'review' });
      expect(p.definition.sources.map((s) => [s.type, s.role ?? 'add'])).toEqual([['imdb_episodes', 'add'], ['jellyfin_episode_title', 'suggest']]);
    }
  });
});
