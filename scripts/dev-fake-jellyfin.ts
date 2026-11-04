// Development only: serve the in-memory Jellyfin 12.4 fake on :8096 with a small sample library,
// so the app can be run and looked at without a real server. Usage: npx tsx scripts/dev-fake-jellyfin.ts
import { serve } from '@hono/node-server';
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
serve({ fetch: fake.app().fetch, port: Number(process.env.FAKE_PORT ?? 8096) }, (i) => console.log(`fake Jellyfin on :${i.port} (admin / pw, key ${fake.apiKey})`));
