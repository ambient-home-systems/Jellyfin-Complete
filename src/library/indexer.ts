// Library index: every movies and TV library, with ProviderIds (ARCHITECTURE §3 step 1, ADR-020).
// The index must be complete before planning: a partial index would look like missing items (ADR-008),
// so any failure throws and the run plans nothing.
import { lt, sql } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { library, libraryItem } from '../db/schema.js';
import type { JellyfinClient, BaseItemDto } from '../clients/jellyfin/index.js';

// Not OfficialRating or ProductionYear: Jellyfin returns those anyway, and they aren't valid Fields values.
const FIELDS = 'ProviderIds,Genres,Tags,Studios,SortName,DateCreated,ParentId';

export type IndexStats = { libraries: number; movies: number; series: number; episodes: number; removed: number };

function pid(item: BaseItemDto, key: string): string | null {
  const ids = item.ProviderIds as Record<string, string | null> | null | undefined;
  if (!ids) return null;
  const hit = Object.entries(ids).find(([k]) => k.toLowerCase() === key.toLowerCase());
  return hit?.[1] || null;
}

/** Read Jellyfin's libraries (names and types only). Cheap; Settings uses it before the first full index. */
export async function syncLibraries(db: DB, jf: JellyfinClient, at = Date.now()) {
  const folders = await jf.virtualFolders();
  for (const f of folders) {
    if (!f.ItemId || !f.Name) continue;
    db.insert(library).values({ id: f.ItemId, name: f.Name, collectionType: f.CollectionType ?? null, seenAt: at })
      .onConflictDoUpdate({ target: library.id, set: { name: f.Name, collectionType: f.CollectionType ?? null, seenAt: at } }).run();
  }
  return folders;
}

export async function indexLibrary(db: DB, jf: JellyfinClient, onProgress?: (msg: string) => void): Promise<IndexStats> {
  const startedAt = Date.now();
  const stats: IndexStats = { libraries: 0, movies: 0, series: 0, episodes: 0, removed: 0 };
  const folders = await syncLibraries(db, jf, startedAt);
  const inScope = folders.filter((f) => f.CollectionType === 'movies' || f.CollectionType === 'tvshows');
  for (const lib of inScope) {
    if (!lib.ItemId) continue;
    stats.libraries++;
    const types = lib.CollectionType === 'movies' ? ['Movie'] : ['Series', 'Episode'];
    for (const type of types) {
      onProgress?.(`Indexing ${lib.Name} (${type === 'Movie' ? 'films' : type === 'Series' ? 'series' : 'episodes'})`);
      const items = await jf.allItems({ ParentId: lib.ItemId, IncludeItemTypes: type, Fields: FIELDS });
      const kind = type === 'Movie' ? 'movie' : type === 'Series' ? 'series' : 'episode';
      db.transaction((tx) => {
        for (const it of items) {
          if (!it.Id) continue;
          const row = {
            kind: kind as 'movie' | 'series' | 'episode',
            libraryId: lib.ItemId as string,
            name: it.Name ?? '',
            sortName: it.SortName ?? null,
            year: it.ProductionYear ?? null,
            imdb: pid(it, 'Imdb'),
            tmdb: pid(it, 'Tmdb'),
            tvdb: pid(it, 'Tvdb'),
            tmdbCollection: kind === 'movie' ? pid(it, 'TmdbCollection') : null,
            seriesJfId: it.SeriesId ?? null,
            season: it.ParentIndexNumber ?? null,
            episode: it.IndexNumber ?? null,
            officialRating: it.OfficialRating ?? null,
            genres: it.Genres ?? [],
            tags: it.Tags ?? [],
            studios: (it.Studios ?? []).map((s) => s.Name ?? '').filter(Boolean),
            dateAdded: it.DateCreated ? Date.parse(it.DateCreated) : null,
            premiereDate: it.PremiereDate ? Date.parse(it.PremiereDate) : null,
            status: kind === 'series' ? it.Status ?? null : null,
            seenAt: startedAt,
          };
          tx.insert(libraryItem).values({ jfId: it.Id, ...row }).onConflictDoUpdate({ target: libraryItem.jfId, set: row }).run();
        }
      });
      if (kind === 'movie') stats.movies += items.length;
      else if (kind === 'series') stats.series += items.length;
      else stats.episodes += items.length;
    }
  }
  // Only after a complete pass: forget items Jellyfin no longer has.
  const gone = db.select({ n: sql<number>`count(*)` }).from(libraryItem).where(lt(libraryItem.seenAt, startedAt)).get();
  stats.removed = gone?.n ?? 0;
  db.delete(libraryItem).where(lt(libraryItem.seenAt, startedAt)).run();
  return stats;
}
