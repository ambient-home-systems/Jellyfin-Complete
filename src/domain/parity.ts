// Plex parity (ADR-024): what Kometa built in Plex vs what this app plans in Jellyfin, matched by provider IDs.
import type { SourceItem } from '../db/schema.js';
import type { LibraryIndex } from './matching.js';

export type ParityEntry = { title: string; year: number | null; ids: string };

export type Parity = {
  plexCount: number;
  plannedCount: number;
  both: number;
  /** In Plex, and the title isn't in your Jellyfin library (or has no matching IDs there). */
  plexOnlyNotInLibrary: ParityEntry[];
  /** In Plex and in your Jellyfin library, but this collection's sources don't pick it. */
  plexOnlyNotPlanned: (ParityEntry & { jfId: string })[];
  /** Planned here, not in the Plex collection. */
  hereOnly: (ParityEntry & { jfId: string })[];
};

const ids = (i: SourceItem) => [i.imdb && `IMDb ${i.imdb}`, i.tmdb && `TMDb ${i.tmdb}`, i.tvdb && `TVDB ${i.tvdb}`].filter(Boolean).join(' · ') || 'no IDs in Plex';

export function parity(plexItems: SourceItem[], planned: Set<string>, index: LibraryIndex, want: 'movie' | 'series' | 'episode' | 'any'): Parity {
  const out: Parity = { plexCount: plexItems.length, plannedCount: planned.size, both: 0, plexOnlyNotInLibrary: [], plexOnlyNotPlanned: [], hereOnly: [] };
  const matched = new Set<string>();
  for (const it of plexItems) {
    const m = index.matchDirect(it, want);
    const entry = { title: it.title ?? '?', year: it.year ?? null, ids: ids(it) };
    if (!m) { out.plexOnlyNotInLibrary.push(entry); continue; }
    matched.add(m.jfId);
    if (planned.has(m.jfId)) out.both++;
    else out.plexOnlyNotPlanned.push({ ...entry, jfId: m.jfId });
  }
  for (const jfId of planned) {
    if (matched.has(jfId)) continue;
    const r = index.get(jfId);
    if (r) out.hereOnly.push({ title: index.displayName(r), year: r.kind === 'episode' ? null : r.year, ids: [r.imdb && `IMDb ${r.imdb}`, r.tmdb && `TMDb ${r.tmdb}`].filter(Boolean).join(' · '), jfId });
  }
  const byTitle = (a: ParityEntry, b: ParityEntry) => a.title.localeCompare(b.title);
  out.plexOnlyNotInLibrary.sort(byTitle);
  out.plexOnlyNotPlanned.sort(byTitle);
  out.hereOnly.sort(byTitle);
  return out;
}
