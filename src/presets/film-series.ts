// Film series (ADR-035): Kometa's movie "franchise" default (defaults/movie/franchise.yml, master on 13 Nov 2026). It's
// dynamic: one collection for each TMDb collection (film series) the library has at least `minimum_items` (2) films of,
// named from TMDb without the " Collection" suffix, in release order, with TMDb's overview and poster. Kometa's add-ons
// fold one series into another (Prometheus into Alien), and its extra films join a series (Hobbs & Shaw into Fast & Furious).
import type { PresetDefinition } from './index.js';
import type { CollectionDetails } from '../clients/tmdb.js';

/** addons: these TMDb collections' films join the main one, and get no collection of their own. */
export const SERIES_ADDONS: Record<string, string[]> = {
  '8091': ['135416'], // Alien: Prometheus
  '2806': ['298820'], // American Pie: spin-off
  '87800': ['371526'], // Appleseed: Appleseed XIII
  '477208': ['557495'], // DC Super Hero Girls: LEGO DC Super Hero Girls
  '86066': ['544669'], // Despicable Me: Minions
  '86115': ['373918'], // Garfield: Garfield CGI
  '91361': ['126209'], // Halloween: Rob Zombie series
  '9818': ['931431'], // Mortal Kombat: 2021 series
  '495': ['608103'], // Shaft: reboot
  '1582': ['401562'], // Teenage Mutant Ninja Turtles: remake
  '111751': ['425175'], // Texas Chainsaw Massacre: reboot
  '748': ['453993'], // X-Men: The Wolverine
};

/** template_variables.movie: single films that join a series. */
export const SERIES_EXTRA_FILMS: Record<string, string[]> = {
  '521226': ['762441'], // A Quiet Place: Day One
  '105995': ['336560'], // Anaconda: Lake Placid vs. Anaconda
  '176097': ['14177'], // Barbershop: Beauty Shop
  '448150': ['567604'], // Deadpool: Once Upon a Deadpool
  '9485': ['384018'], // The Fast and the Furious: Hobbs & Shaw
  '9735': ['6466', '222724'], // Friday the 13th: Freddy vs. Jason, Crystal Lake Memories
  '386382': ['326359', '460793'], // Frozen: Frozen Fever, Olaf's Frozen Adventure
  '2980': ['43074'], // Ghostbusters: Ghostbusters (2016)
  '374509': ['18983'], // Godzilla (Showa): Godzilla, King of the Monsters!
  '374511': ['39256'], // Godzilla (Heisei): Godzilla 1985
  '535313': ['293167'], // Godzilla (MonsterVerse): Kong: Skull Island
  '9743': ['11454'], // Hannibal Lecter: Manhunter
  '8354': ['79218', '387893'], // Ice Age: A Mammoth Christmas, The Great Egg-Scapade
  '70068': ['658009', '643413', '450001', '751391', '44249', '182127', '44865'], // Ip Man
  '328': ['630322'], // Jurassic Park: Battle at Big Rock
  '8580': ['38575'], // The Karate Kid: The Karate Kid (2010)
  '14740': ['161143', '25472', '270946'], // Madagascar: Madly Madagascar, Merry Madagascar, Penguins of Madagascar
  '9818': ['664767'], // Mortal Kombat: Legends: Scorpion's Revenge
  '171732': ['39410'], // Rebirth of Mothra: Mothra
  '8581': ['6466', '23437'], // A Nightmare on Elm Street: Freddy vs. Jason, the 2010 remake
  '627517': ['13155', '68728'], // Oz: Return to Oz, Oz the Great and Powerful
  '10789': ['157433'], // Pet Sematary: Pet Sematary (2019)
  '708816': ['305470', '306264'], // Power Rangers: Power Rangers (2017), Super Megaforce
  '190435': ['687354', '11667'], // Street Fighter (Animated): Assassin's Fist, Street Fighter
  '1582': ['1273'], // Teenage Mutant Ninja Turtles: TMNT
  '2467': ['338970'], // Tomb Raider: Tomb Raider (2018)
  '10194': ['130925'], // Toy Story: Partysaurus Rex
  '63043': ['73362'], // TRON: The Next Day
  '748': ['567604'], // X-Men: Once Upon a Deadpool
};

/** title_override */
export const SERIES_TITLES: Record<string, string> = {
  '10': 'Star Wars: Skywalker Saga',
  '535313': 'Godzilla (MonsterVerse)',
  '535790': 'Godzilla (Anime)',
};

/** Which series a TMDb collection counts toward: itself, or the series it's an add-on of. */
export const SERIES_OF: Record<string, string> = Object.fromEntries(Object.entries(SERIES_ADDONS).flatMap(([main, addons]) => addons.map((a) => [a, main])));

/** Kometa's remove_suffix "Collection": "Toy Story Collection" → "Toy Story". */
export const seriesName = (id: string, tmdbName: string) => SERIES_TITLES[id] ?? tmdbName.replace(/\s+Collection$/i, '').trim();

export const SERIES_PREFIX = 'film_series:';

export function filmSeriesDefinition(id: string, details: Pick<CollectionDetails, 'name' | 'overview' | 'posterPath'>, minimum: number): PresetDefinition {
  const extra = SERIES_EXTRA_FILMS[id] ?? [];
  return {
    slug: `film-series-${id}`,
    name: seriesName(id, details.name),
    target: 'movies',
    presetKey: `${SERIES_PREFIX}${id}`,
    presetRev: 'kometa-franchise-2026-11',
    window: null,
    minItems: minimum,
    syncMode: 'sync',
    sortBy: 'release',
    sortTitle: null, // Kometa sets no collection_section here, so it drops the sort title
    overview: details.overview,
    poster: details.posterPath ? { kind: 'url', url: `https://image.tmdb.org/t/p/original${details.posterPath}` } : { kind: 'none' },
    visibility: 'delete',
    sources: [
      { type: 'tmdb_collection', config: { ids: [id, ...(SERIES_ADDONS[id] ?? [])] } },
      ...(extra.length ? [{ type: 'tmdb_movie', config: { ids: extra } }] : []),
    ],
  };
}
