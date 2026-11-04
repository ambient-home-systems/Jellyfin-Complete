// Key/value cache with TTL on the tmdb_cache table (TMDb lookups, Letterboxd film → ID map, etc.).
import { eq } from 'drizzle-orm';
import type { DB } from './db/index.js';
import { tmdbCache } from './db/schema.js';

const DAY = 86_400_000;

export function getCached<T>(db: DB, key: string, now = Date.now()): { hit: true; value: T } | { hit: false } {
  const row = db.select().from(tmdbCache).where(eq(tmdbCache.key, key)).get();
  if (!row || now - row.fetchedAt > row.ttlDays * DAY) return { hit: false };
  return { hit: true, value: row.payload as T };
}

export function putCached(db: DB, key: string, payload: unknown, ttlDays: number, now = Date.now()): void {
  const values = { payload, fetchedAt: now, ttlDays };
  db.insert(tmdbCache).values({ key, ...values }).onConflictDoUpdate({ target: tmdbCache.key, set: values }).run();
}

export async function cached<T>(db: DB, key: string, ttlDays: number, load: () => Promise<T>): Promise<T> {
  const hit = getCached<T>(db, key);
  if (hit.hit) return hit.value;
  const value = await load();
  putCached(db, key, value, ttlDays);
  return value;
}
