// The 19 seasonal presets, ported exactly from Kometa v2.5.3 defaults/movie/seasonal.yml (ADR-014, NOTICE.md).
// test/presets.test.ts parses the vendored YAML and checks every field below against it.
import type { WindowDef } from '../db/schema.js';
import type { SourceSpec } from '../sources/index.js';

export const KOMETA_VERSION = 'v2.5.3';
export const DEFAULT_IMAGES = 'https://raw.githubusercontent.com/Kometa-Team/Default-Images/master';

export type SeasonalPreset = {
  key: string;
  keyName: string;
  window: Extract<WindowDef, { type: 'range' }>;
  sources: SourceSpec[];
  /** Old Kometa emoji names, offered as adoption candidates. */
  deleteCollectionsNamed: string[];
};

const imdbSearch = (search: Record<string, unknown>): SourceSpec => ({ type: 'imdb_search', config: { search } });
const lists = (...ids: string[]) => imdbSearch({ 'list.any': ids, limit: 500 });
const keywords = (kw: string, extra: Record<string, unknown> = {}) => imdbSearch({ ...extra, 'keyword.any': kw, limit: 500 });
const mdblist = (url: string): SourceSpec => ({ type: 'mdblist_list', config: { url } });

export const SEASONAL_PRESETS: SeasonalPreset[] = [
  { key: 'years', keyName: "New Year's Day", window: { type: 'range', from: '12/26', to: '01/04' }, sources: [lists('ls066838460')], deleteCollectionsNamed: ["🎊 New Year's Day Movies"] },
  { key: 'valentine', keyName: "Valentine's Day", window: { type: 'range', from: '02/01', to: '02/29' }, sources: [lists('ls032692441', 'ls000094398', 'ls057783436', 'ls064427905')], deleteCollectionsNamed: ["💘 Valentine's Day Movies"] },
  { key: 'patrick', keyName: "St. Patrick's Day", window: { type: 'range', from: '03/01', to: '03/18' }, sources: [lists('ls067580975')], deleteCollectionsNamed: ["☘ St. Patrick's Day Movies"] },
  { key: 'easter', keyName: 'Easter', window: { type: 'range', from: '03/20', to: '04/30' }, sources: [lists('ls062665509', 'ls051733651')], deleteCollectionsNamed: ['🐰 Easter Movies'] },
  { key: 'mother', keyName: "Mother's Day", window: { type: 'range', from: '05/05', to: '05/10' }, sources: [keywords('motherhood, pregnancy')], deleteCollectionsNamed: ["🤱 Mother's Day Movies"] },
  { key: 'memorial', keyName: 'Memorial Day', window: { type: 'range', from: '5/18', to: '6/7' }, sources: [lists('ls526590990')], deleteCollectionsNamed: ['🪖 Memorial Day Movies'] },
  { key: 'father', keyName: "Father's Day", window: { type: 'range', from: '06/15', to: '06/20' }, sources: [keywords('fatherhood')], deleteCollectionsNamed: ["👨 Father's Day Movies"] },
  { key: 'independence', keyName: 'Independence Day', window: { type: 'range', from: '06/23', to: '07/11' }, sources: [lists('ls561449172', 'ls541213215', 'ls068664510', 'ls080925875')], deleteCollectionsNamed: ['🎆 Independence Day Movies'] },
  { key: 'labor', keyName: 'Labor Day', window: { type: 'range', from: '09/01', to: '09/10' }, sources: [lists('ls002014923')], deleteCollectionsNamed: ['⚒ Labor Day Movies'] },
  {
    key: 'halloween', keyName: 'Halloween', window: { type: 'range', from: '10/01', to: '10/31' },
    sources: [
      { type: 'tmdb_collection', config: { ids: ['185103', '11716', '750822', '313086', '91361', '8581', '1733', '8091', '2980', '751156'] } },
      { type: 'tmdb_movie', config: { ids: ['23437'] } },
      lists('ls546214737', 'ls023118929', 'ls000099714'),
    ],
    deleteCollectionsNamed: ['🎃 Halloween Movies'],
  },
  { key: 'veteran', keyName: "Veteran's Day", window: { type: 'range', from: '11/01', to: '11/30' }, sources: [lists('ls526590990', 'ls565595526')], deleteCollectionsNamed: ["🎖 Veteran's Day Movies"] },
  { key: 'thanksgiving', keyName: 'Thanksgiving', window: { type: 'range', from: '11/01', to: '11/30' }, sources: [keywords('thanksgiving')], deleteCollectionsNamed: ['🦃 Thanksgiving Movies'] },
  { key: 'christmas', keyName: 'Christmas', window: { type: 'range', from: '12/01', to: '12/31' }, sources: [mdblist('https://mdblist.com/lists/k0meta/christmas-extravaganza')], deleteCollectionsNamed: ['🎅 Christmas Movies'] },
  { key: 'aapi', keyName: 'Asian American & Pacific Islander Heritage Month', window: { type: 'range', from: '04/30', to: '05/31' }, sources: [mdblist('https://mdblist.com/lists/k0meta/asian-american-pacific-islander-heritage-month')], deleteCollectionsNamed: ['🌊🌺 Asian American Pacific Islander Movies'] },
  { key: 'disabilities', keyName: 'Day of Persons with Disabilities', window: { type: 'range', from: '12/02', to: '12/04' }, sources: [keywords('disability')], deleteCollectionsNamed: ['♿ Disability Month Movies'] },
  {
    key: 'black_history', keyName: 'Black History Month', window: { type: 'range', from: '02/01', to: '03/01' },
    sources: [lists('ls023525790'), { type: 'letterboxd_list', config: { url: 'https://letterboxd.com/mardarrius/list/black-is-beautiful/' } }],
    deleteCollectionsNamed: ['✊🏿 Black History Month Movies'],
  },
  { key: 'lgbtq', keyName: 'LGBTQ+ Pride Month', window: { type: 'range', from: '05/31', to: '06/30' }, sources: [lists('ls080580859')], deleteCollectionsNamed: ['🏳️‍🌈 LGBTQ Month Movies'] },
  { key: 'latinx', keyName: 'Latinx Heritage Month', window: { type: 'range', from: '09/15', to: '10/15' }, sources: [mdblist('https://mdblist.com/lists/k0meta/latinx-heritage-month')], deleteCollectionsNamed: ['🪅 National Hispanic Heritage Movies'] },
  {
    key: 'women', keyName: "Women's History Month", window: { type: 'range', from: '02/28', to: '03/31' },
    sources: [keywords("women in film, women's rights, women's suffrage, womens rights, womens suffrage", { type: 'movie', sort_by: 'rating.desc' })],
    deleteCollectionsNamed: ["🚺 Women's History Month Movies"],
  },
];

/** Kometa's derived fields: name "<key_name> Movies", sort title "!00_<name>", summary, Default-Images poster. */
export function presetDefinition(p: SeasonalPreset) {
  const name = `${p.keyName} Movies`;
  return {
    slug: `seasonal-${p.key}`,
    name,
    target: 'movies' as const,
    presetKey: `seasonal:${p.key}`,
    presetRev: KOMETA_VERSION,
    window: p.window,
    minItems: 1,
    syncMode: 'sync' as const,
    sortBy: 'title.asc',
    sortTitle: `!00_${name}`,
    overview: `A collection of ${p.keyName} movies that may relate to the season.`,
    poster: { kind: 'url' as const, url: `${DEFAULT_IMAGES}/seasonal/${p.key}.jpg` },
    visibility: 'delete' as const,
    sources: p.sources,
  };
}
