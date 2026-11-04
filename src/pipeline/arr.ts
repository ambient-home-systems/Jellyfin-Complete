// Radarr and Sonarr in the pipeline (ADR-007, ADR-027): propose adds for missing titles, run the guardrails, apply.
// Every add re-checks live: released, not already present, not excluded. Nothing here removes anything from Radarr/Sonarr.
import { and, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import type { AppContext } from '../app-context.js';
import { action, definitionArr, type ActionType, type ArrOptions } from '../db/schema.js';
import type { ArrApp, ArrClient } from '../clients/arr.js';
import type { LoadedDefinition } from '../domain/definitions.js';
import { statusOf, type ArrState, type MissingTitle } from '../domain/missing.js';
import { fingerprint, type PlannedAction } from './planner.js';
import { cached } from '../cache.js';
import { log } from '../log.js';

export const ARR_TYPES: ActionType[] = ['radarr.add_movie', 'sonarr.add_series', 'radarr.monitor_collection'];
/** Missing titles looked up per collection per run when sending automatically; the rest wait for later runs. */
export const ARR_CANDIDATES_PER_COLLECTION = 25;

const label = (app: ArrApp) => (app === 'radarr' ? 'Radarr' : 'Sonarr');
const client = (app: AppContext, which: ArrApp) => (which === 'radarr' ? app.radarr() : app.sonarr());

// Radarr's and Sonarr's library and exclusion lists, read in bulk and kept for 5 minutes.
const stateCache = new Map<ArrApp, { at: number; state: ArrState }>();
export function forgetArrState(): void {
  stateCache.clear();
}
export async function arrState(app: AppContext, which: ArrApp): Promise<ArrState | null> {
  const c = client(app, which);
  if (!c) return null;
  const hit = stateCache.get(which);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.state;
  const [lib, exclusions] = await Promise.all([c.library(), c.exclusions()]);
  const state = { library: lib.ids, monitoredNoFile: lib.monitoredNoFile, exclusions };
  stateCache.set(which, { at: Date.now(), state });
  return state;
}

/** The term to add by. Sonarr needs a TVDB ID; get one from TMDb when the source only had IMDb or TMDb IDs. */
export async function resolveTerm(app: AppContext, m: MissingTitle): Promise<string | null> {
  if (m.term) return m.term;
  const tmdb = app.tmdb();
  if (m.app !== 'sonarr' || !tmdb) return null;
  let showTmdb = m.tmdb;
  if (!showTmdb && m.imdb) {
    const f = await tmdb.find(m.imdb);
    if (f?.kind === 'tv') showTmdb = f.tmdb;
  }
  const tvdb = showTmdb ? await tmdb.tvdbForShow(showTmdb) : null;
  return tvdb ? `tvdb:${tvdb}` : null;
}

/** Settings defaults, then the collection's own overrides. */
export function arrOptions(app: AppContext, which: ArrApp, definitionId: number | null): ArrOptions {
  const base = app.settings().arr[which];
  const own = definitionId === null ? undefined : app.db.select().from(definitionArr).where(eq(definitionArr.definitionId, definitionId)).get()?.options;
  return { ...base, ...(own ?? {}) };
}

/**
 * Plan adds for collections that send missing titles automatically. Only the best-ranked few per collection are
 * looked up each run (cached for a day), and only released titles that aren't present or excluded are proposed.
 */
export async function proposeArrAdds(app: AppContext, defs: { def: LoadedDefinition; missing: MissingTitle[] }[], log_: (m: string) => void): Promise<PlannedAction[]> {
  const out: PlannedAction[] = [];
  const seen = new Set<string>();
  const releasedOnly = app.settings().guardrails.releasedOnly;
  for (const { def, missing } of defs) {
    for (const which of ['radarr', 'sonarr'] as const) {
      const c = client(app, which);
      const mine = missing.filter((m) => m.app === which);
      if (!c || !mine.length) continue;
      const state = await arrState(app, which);
      let looked = 0;
      for (const m of mine) {
        if (looked >= ARR_CANDIDATES_PER_COLLECTION) break;
        if (statusOf(m, state) !== 'not_in_arr' && statusOf(m, state) !== 'needs_id') continue;
        const term = await resolveTerm(app, m);
        if (!term) continue;
        looked++;
        const t = await cached(app.db, `${which}:lookup:${term}`, 1, () => c.lookup(term)).catch((e: Error) => { log_(`${label(which)} lookup ${term} failed: ${e.message}`); return null; });
        if (!t || t.inLibrary || t.excluded || (releasedOnly && !t.released)) continue;
        const type: ActionType = which === 'radarr' ? 'radarr.add_movie' : 'sonarr.add_series';
        const fp = fingerprint(type, term);
        if (seen.has(fp)) continue;
        seen.add(fp);
        out.push({
          type, definitionId: def.id, fingerprint: fp, applyAt: null,
          reason: `Missing from ${def.name}: on ${m.sources.map((s) => `${s.label} #${s.rank}`).join(', ')}`,
          item: { name: t.title, year: t.year, provenance: { sources: m.sources.map((s) => ({ key: s.label, label: s.label, rank: s.rank })), match: 'missing' } },
          payload: { app: which, term },
        });
      }
    }
  }
  return out;
}

export type ArrResult = { applied: number; skipped: { title: string; why: string }[]; failed: { title: string; why: string }[] };

/** Apply approved Radarr/Sonarr actions that are due, each re-checked live first. */
export async function executeArrDue(app: AppContext, now = Date.now(), onlyIds?: number[]): Promise<ArrResult> {
  const result: ArrResult = { applied: 0, skipped: [], failed: [] };
  const due = app.db.select().from(action)
    .where(and(eq(action.status, 'approved'), inArray(action.type, ARR_TYPES), or(isNull(action.applyAt), lte(action.applyAt, now)), onlyIds?.length ? inArray(action.id, onlyIds) : undefined))
    .all();
  const releasedOnly = app.settings().guardrails.releasedOnly;
  for (const a of due) {
    const p = (a.payload ?? {}) as { app?: ArrApp; term?: string; radarrCollectionIds?: number[]; collectionTitle?: string; options?: ArrOptions };
    const which: ArrApp = a.type === 'sonarr.add_series' ? 'sonarr' : 'radarr';
    const title = a.item?.name ?? p.collectionTitle ?? p.term ?? '?';
    const set = (status: 'applied' | 'failed' | 'superseded', extra: Record<string, unknown> = {}) =>
      app.db.update(action).set({ status, updatedAt: Date.now(), ...(status === 'applied' ? { appliedAt: Date.now() } : {}), ...extra }).where(eq(action.id, a.id)).run();
    const c: ArrClient | null = client(app, which);
    if (!c) { set('failed', { error: `${label(which)} isn’t connected` }); result.failed.push({ title, why: `${label(which)} isn’t connected` }); continue; }
    try {
      if (a.type === 'radarr.monitor_collection') {
        await c.monitorCollections(p.radarrCollectionIds ?? [], { ...arrOptions(app, 'radarr', a.definitionId), ...(p.options ?? {}) });
        set('applied', { after: { monitored: p.radarrCollectionIds } });
        result.applied++;
        continue;
      }
      const t = p.term ? await c.lookup(p.term) : null;
      const skip = !t ? `not found in ${label(which)}` : t.inLibrary ? `already in ${label(which)}` : t.excluded ? `excluded in ${label(which)}` : releasedOnly && !t.released ? `not released yet (${t.status})` : null;
      if (skip || !t) { set('superseded', { error: skip }); result.skipped.push({ title: t?.title ?? title, why: skip ?? 'not found' }); continue; }
      const id = await c.add(t, { ...arrOptions(app, which, a.definitionId), ...(p.options ?? {}) }); // a send can carry its own options
      set('applied', { before: { inLibrary: false }, after: { id, title: t.title, year: t.year, term: p.term } });
      result.applied++;
    } catch (e) {
      const why = (e as Error).message;
      log.error(`${label(which)}: ${title}: ${why}`);
      set('failed', { error: why });
      result.failed.push({ title, why });
    }
  }
  if (result.applied) forgetArrState();
  return result;
}
