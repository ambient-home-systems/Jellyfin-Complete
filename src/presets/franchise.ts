// The 27 show franchise presets, ported from Kometa v2.5.3 defaults/show/franchise.yml (ADR-014, NOTICE.md).
// Each is the TMDb show plus its "addons" (spin-offs). test/presets.test.ts checks every entry against the YAML.
import { DEFAULT_IMAGES, KOMETA_VERSION } from './seasonal.js';
import type { SourceSpec } from '../sources/index.js';

export type ShowFranchise = { key: string; name: string; addons: string[] };

export const SHOW_FRANCHISES: ShowFranchise[] = [
  { key: '121', name: 'Doctor Who', addons: ['57243', '1057', '424', '203', '64073', '239770'] },
  { key: '253', name: 'Star Trek', addons: ['655', '580', '1855', '1992', '314', '103516', '67198', '82491', '85948', '85949', '106393'] },
  { key: '549', name: 'Law & Order', addons: ['2734', '4601', '3357', '32632', '72496', '106158', '7098'] },
  { key: '951', name: 'Archie Comics', addons: ['25641', '4489', '24211', '9829', '605', '69050', '79242', '87539'] },
  { key: '1399', name: 'Game of Thrones', addons: ['94997'] },
  { key: '1402', name: 'The Walking Dead', addons: ['62286', '94305', '194583', '211684', '206586'] },
  { key: '1412', name: 'Arrowverse', addons: ['60735', '62688', '62643', '71663', '89247'] },
  { key: '1431', name: 'CSI', addons: ['1620', '2458', '122194', '61811'] },
  { key: '4614', name: 'NCIS', addons: ['17610', '124271', '61387', '4376', '157950', '243006', '247732', '319800'] },
  { key: '4629', name: 'Stargate', addons: ['2290', '5148', '72925'] },
  { key: '8514', name: "RuPaul's Drag Race", addons: ['200870', '212798', '38409', '200865', '67482', '124045', '216276', '77233', '92611', '98888', '94038', '127841', '67564', '122692', '139203', '203734', '108934', '204701', '210689', '155431', '106475', '152261', '66769'] },
  { key: '6357', name: 'The Twilight Zone', addons: ['1918', '83135', '16399'] },
  { key: '10222', name: 'The Real Housewives', addons: ['34268', '32390', '17380', '18204', '65300', '31493', '217065', '14808', '136105', '61868', '39283', '62087', '76474', '70612', '110381', '70463', '67480', '196592', '139703', '126149', '59556', '113333', '214463', '131449', '216849'] },
  { key: '31917', name: 'Pretty Little Liars', addons: ['46958', '79863', '110531'] },
  { key: '44006', name: 'One Chicago', addons: ['58841', '62650', '67993'] },
  { key: '54650', name: 'Power', addons: ['97890', '124394', '119845'] },
  { key: '73586', name: 'Yellowstone', addons: ['157744', '118357', '157732'] },
  { key: '75219', name: '9-1-1', addons: ['89393'] },
  { key: '79744', name: 'The Rookie', addons: ['201992'] },
  { key: '80748', name: 'FBI', addons: ['94372', '121658'] },
  { key: '85536', name: 'Star Wars', addons: ['71412', '3478', '105971', '92830', '83867', '60554', '82856', '115036', '114461', '202879', '114478', '79093', '4194', '203085'] },
  { key: '46296', name: 'Spartacus', addons: ['240459'] },
  { key: '108978', name: 'Reacher', addons: ['273207'] },
  { key: '60585', name: 'Bosch', addons: ['153657'] },
  { key: '3476', name: 'Inspector Morse', addons: ['44264', '2343'] },
  { key: '61511', name: 'Father Brown (2013)', addons: ['157282'] },
  { key: '41956', name: 'Death in Paradise (2011)', addons: ['205072', '244978'] },
];

/** Kometa v2.5.3 points at a poster that doesn't exist in Default-Images; this is the file that does (checked 2 Nov 2026). */
const POSTER_FILE_OVERRIDES: Record<string, string> = { '61511': 'Father Brown' };

/** Python's urllib.parse.quote, which Kometa uses for key_name_encoded. */
export const pyQuote = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/**
 * Kometa's tmdbshow template: name is the key name, minimum 2, sync, release order, Default-Images franchise poster.
 * The file sets no collection_section, so Kometa drops the sort title and so do we.
 */
export function showFranchiseDefinition(p: ShowFranchise) {
  const sources: SourceSpec[] = [{ type: 'tmdb_show', config: { ids: [p.key, ...p.addons] } }];
  return {
    slug: `franchise-show-${p.key}`,
    name: p.name,
    target: 'shows' as const,
    presetKey: `show_franchise:${p.key}`,
    presetRev: KOMETA_VERSION,
    window: null,
    minItems: 2,
    syncMode: 'sync' as const,
    sortBy: 'release',
    sortTitle: null,
    overview: null,
    poster: { kind: 'url' as const, url: `${DEFAULT_IMAGES}/franchise/${pyQuote(POSTER_FILE_OVERRIDES[p.key] ?? p.name)}.jpg` },
    visibility: 'delete' as const,
    sources,
  };
}
