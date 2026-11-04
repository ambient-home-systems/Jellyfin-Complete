// Spike 1f (read-only): item counts and sort titles of the collections Kometa built in Plex,
// as the parity baseline. Reads the local Plex server only.
import { loadEnv, need, http, report, save } from './lib.mjs';

loadEnv(); need('PLEX_URL', 'PLEX_TOKEN');
const base = process.env.PLEX_URL.replace(/\/$/, '');
const plex = (path) => http(`${base}${path}${path.includes('?') ? '&' : '?'}X-Plex-Token=${process.env.PLEX_TOKEN}`, { headers: { accept: 'application/json' } });

const id = await plex('/identity');
const sections = (await plex('/library/sections')).json?.MediaContainer?.Directory || [];
const rows = [];
for (const s of sections.filter((d) => ['movie', 'show'].includes(d.type))) {
  const colls = (await plex(`/library/sections/${s.key}/collections`)).json?.MediaContainer?.Metadata || [];
  for (const c of colls) {
    const guids = [];
    const kids = (await plex(`/library/collections/${c.ratingKey}/children?includeGuids=1`)).json?.MediaContainer?.Metadata || [];
    for (const k of kids) guids.push({ title: k.title, year: k.year, guids: (k.Guid || []).map((g) => g.id) });
    rows.push({ library: s.title, type: s.type, title: c.title, titleSort: c.titleSort, childCount: Number(c.childCount), labels: (c.Label || []).map((l) => l.tag), items: guids });
  }
}
const seasonal = rows.filter((r) => / (Movies|Shows)$/.test(r.title) && r.titleSort?.startsWith('!'));
report('Plex', { version: id.json?.MediaContainer?.version, libraries: sections.map((s) => `${s.title} (${s.type})`), collections: rows.length });
report('Kometa-style collections (sort title starts with "!")', seasonal.map((r) => ({ library: r.library, title: r.title, titleSort: r.titleSort, items: r.childCount })));
save('plex-collections.json', rows);
console.log('\nItem GUIDs per collection saved to spikes/out/plex-collections.json for the parity report.');
