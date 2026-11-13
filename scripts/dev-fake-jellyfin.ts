// Development only: serve the in-memory Jellyfin 12.4 fake on :8096 with a small sample library,
// so the app can be run and looked at without a real server. Usage: npx tsx scripts/dev-fake-jellyfin.ts
import { serve } from '@hono/node-server';
import sharp from 'sharp';
import { FakeJellyfin } from '../test/fakes/jellyfin.js';

const fake = new FakeJellyfin();
// Home Screen Sections + Collection Sections, so Settings → Home-screen rows has something to show (Phase 3).
fake.plugins.push({ Id: 'b8298e012697407ab44daa8dc795e850', Name: 'Home Screen Sections', Version: '3.1.0.0', Status: 'Active' }, { Id: '043b2c48b3e04610b3988217b146d1a4', Name: 'Collection Sections', Version: '2.0.0.0', Status: 'Active' });
fake.pluginConfigs.set('b8298e012697407ab44daa8dc795e850', { Enabled: true, SectionSettings: [] });
fake.pluginConfigs.set('043b2c48b3e04610b3988217b146d1a4', { Sections: [] });
fake.apiKey = process.env.FAKE_JELLYFIN_KEY ?? 'dev-fake-key-0000';
const films: [string, string, number, string, string][] = [
  ['Home Alone', 'tt0099785', 1990, '771', 'lib-movies'], ['Elf', 'tt0319343', 2003, '10719', 'lib-movies'],
  ['Die Hard', 'tt0095016', 1988, '562', 'lib-movies'], ['Klaus', 'tt4729430', 2019, '508965', 'lib-movies'],
  ['The Muppet Christmas Carol', 'tt0104940', 1992, '10437', 'lib-movies'], ['Arthur Christmas', 'tt1430607', 2011, '51052', 'lib-movies'],
  ['A Christmas Story', 'tt0085334', 1983, '850', 'lib-movies'], ["It's a Wonderful Life", 'tt0038650', 1946, '1585', 'lib-movies'],
  ['Planes, Trains and Automobiles', 'tt0093748', 1987, '2609', 'lib-movies'], ['Addams Family Values', 'tt0106220', 1993, '2758', 'lib-movies'],
  ['Halloween', 'tt0077651', 1978, '948', 'lib-movies'], ['Hocus Pocus', 'tt0107120', 1993, '10439', 'lib-movies'],
  ['The Nightmare Before Christmas', 'tt0107688', 1993, '9479', 'lib-animated'], ["Mickey's Christmas Carol", 'tt0086106', 1983, '13154', 'lib-animated'],
  ['When Harry Met Sally...', 'tt0098635', 1989, '639', 'lib-movies'], ['Independence Day', 'tt0116629', 1996, '602', 'lib-movies'],
];
for (const [Name, Imdb, ProductionYear, Tmdb, ParentId] of films) fake.add({ Name, Type: 'Movie', ParentId, ProductionYear, ProviderIds: { Imdb, Tmdb } });
fake.add({ Id: 'jac-xmas', Name: 'Christmas Movies', Type: 'BoxSet', ParentId: 'lib-collections', Tags: ['Jellyfin-Auto-Collections', 'mdblist'], children: [] });
fake.add({ Id: 'jac-orphan', Name: "{'includeItemTypes': 'Movie', 'tags': 'christmas|santa claus'}", Type: 'BoxSet', ParentId: 'lib-collections', Tags: ['Jellyfin-Auto-Collections'], children: [] });
// One mislabelled file, so Library health has something to show (ADR-041).
const klaus = [...fake.items.values()].find((i) => i.Name === 'Klaus')!;
klaus.DateCreated = '2026-11-01T00:00:00Z';
klaus.MediaSources = [{ RunTimeTicks: 98 * 600_000_000, Path: '/movies/Klaus (2019)/Klaus.mkv', MediaStreams: [{ Type: 'Video', Title: 'Bewitched (2005) 1080p' }, { Type: 'Audio', Title: 'English' }] }];

// A few shows and posters, so Settings → Poster overlays has something to preview (ADR-039).
const today = new Date();
const daysAgo = (n: number) => new Date(today.getTime() - n * 86_400_000).toISOString();
fake.add({ Id: 's-bluey', Name: 'Bluey', Type: 'Series', ParentId: 'lib-shows', Status: 'Continuing', ProviderIds: { Imdb: 'tt7678620' } } as Parameters<typeof fake.add>[0]);
fake.add({ Id: 'e-bluey', Name: 'Ghostbasket', Type: 'Episode', SeriesId: 's-bluey', ParentIndexNumber: 3, IndexNumber: 9, PremiereDate: daysAgo(4) });
fake.add({ Id: 's-bb', Name: 'Breaking Bad', Type: 'Series', ParentId: 'lib-shows', Status: 'Ended', ProviderIds: { Imdb: 'tt0903747' } } as Parameters<typeof fake.add>[0]);
// A sitcom season where one file holds two episodes (Library health's median rule, ADR-041).
fake.add({ Id: 's-lms', Name: 'Last Man Standing', Type: 'Series', ParentId: 'lib-shows', Status: 'Ended' } as Parameters<typeof fake.add>[0]);
for (const [n, min] of [[11, 21], [12, 21], [13, 43], [14, 21], [15, 21]] as const) {
  fake.add({ Id: `e-lms-${n}`, Name: `Episode ${n}`, Type: 'Episode', SeriesId: 's-lms', ParentIndexNumber: 7, IndexNumber: n, DateCreated: daysAgo(40), MediaSources: [{ RunTimeTicks: min * 600_000_000, Path: `/tv/Last Man Standing/Season 07/S07E${n}.mkv`, MediaStreams: [{ Type: 'Video' }] }] } as Parameters<typeof fake.add>[0]);
}
fake.add({ Id: 's-glee', Name: 'Glee', Type: 'Series', ParentId: 'lib-shows', Status: 'Continuing', ProviderIds: { Imdb: 'tt1327801' } } as Parameters<typeof fake.add>[0]);
const colours: [string, string, string][] = [['s-bluey', '#2a6fdb', '#8fd3ff'], ['s-bb', '#1f3d2b', '#a7c957'], ['s-glee', '#c1121f', '#fdf0d5']];
for (const [id, a, b] of colours) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="680" height="1000"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  fake.setImage(id, new Uint8Array(await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer()));
}
serve({ fetch: fake.app().fetch, port: Number(process.env.FAKE_PORT ?? 8096) }, (i) => console.log(`fake Jellyfin on :${i.port} (admin / pw, key ${fake.apiKey})`));
