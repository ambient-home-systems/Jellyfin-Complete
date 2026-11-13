// Planner: desired state vs Jellyfin → candidate actions (ARCHITECTURE §3 steps 4–5). Pure: no I/O.
import { createHash } from 'node:crypto';
import type { ActionType, Provenance, SavedMeta } from '../db/schema.js';
import type { LoadedDefinition } from '../domain/definitions.js';
import type { ResolvedSource } from '../sources/index.js';
import { LibraryIndex, mergeProvenance, type LibRow, type Match } from '../domain/matching.js';
import type { FindResult } from '../clients/tmdb.js';
import { isOpen, localDay, localMidnight, opensWithin, occurrence, fromDayNumber, transitions } from '../domain/windows.js';

export const MANAGED_TAG = 'managed:maverick-collections';
export const LOCKED_FIELDS = ['Name', 'Overview', 'Tags'];
/** The blocked tag that hides a gated box set from every user (ADR-010). */
export const GATE_TAG = 'maverick-collections:hidden';

export type LiveCollection = {
  jfBoxsetId: string;
  /** Kept between seasons but gated by GATE_TAG (visibility "tag_gate"). */
  hidden?: boolean;
  children: Set<string>;
  meta: { name: string; forcedSortName: string | null; overview: string | null; tags: string[]; lockedFields: string[]; displayOrder: string | null; hasPoster: boolean };
};

export type PlanInput = {
  now: number;
  tz: string;
  leadDays: number;
  definitions: LoadedDefinition[];
  index: LibraryIndex;
  movieLibraryIds: string[];
  showLibraryIds: string[];
  /** Resolved sources per definition id, in definition order. */
  resolved: Map<number, ResolvedSource[]>;
  /** Live, managed box sets per definition id (absent = no box set). */
  live: Map<number, LiveCollection>;
  saved: Map<number, SavedMeta | null>;
  /** TMDb /find results for IMDb IDs that didn't match directly. */
  found: Map<string, FindResult>;
};

export type PlannedAction = {
  type: ActionType;
  definitionId: number;
  fingerprint: string;
  applyAt: number | null;
  reason: string;
  suggested?: boolean;
  /** jfId is absent for Radarr/Sonarr adds: the title isn't in the library yet. */
  item?: { jfId?: string; name: string; year: number | null; provenance: Provenance };
  payload?: Record<string, unknown>;
};

export type DefinitionPlan = {
  definitionId: number;
  open: boolean;
  opensAt: number | null;
  members: Map<string, Provenance>;
  blocked: boolean;
  sourceStatus: { key: string; label: string; status: string; error: string | null; listed: number; matched: number }[];
};

export function fingerprint(...parts: (string | number | null | undefined)[]): string {
  return createHash('sha1').update(parts.map((p) => String(p ?? '')).join('|')).digest('hex').slice(0, 20);
}

const itemRef = (r: LibRow) => r.imdb ?? (r.tmdb ? `tmdb:${r.tmdb}` : r.tvdb ? `tvdb:${r.tvdb}` : `jf:${r.jfId}`);
export const RATING_ORDER = ['G', 'TV-Y', 'TV-Y7', 'TV-G', 'PG', 'TV-PG', 'PG-13', 'TV-14', 'R', 'TV-MA', 'NC-17'];

export function passesFilters(row: LibRow, def: LoadedDefinition): boolean {
  const f = def.filters ?? {};
  if (f.yearFrom && (row.year ?? 0) < f.yearFrom) return false;
  if (f.yearTo && (row.year ?? 9999) > f.yearTo) return false;
  const genres = row.genres.map((g) => g.toLowerCase());
  if (f.genresInclude?.length && !f.genresInclude.some((g) => genres.includes(g.toLowerCase()))) return false;
  if (f.genresExclude?.length && f.genresExclude.some((g) => genres.includes(g.toLowerCase()))) return false;
  if (f.maxRating) {
    const max = RATING_ORDER.indexOf(f.maxRating);
    const r = row.officialRating ? RATING_ORDER.indexOf(row.officialRating) : -1;
    if (max >= 0 && r > max) return false;
  }
  return true;
}

type MetaDef = Pick<LoadedDefinition, 'slug' | 'name' | 'sortTitle' | 'overview' | 'poster'>;

export function desiredMeta(def: MetaDef) {
  return { name: def.name, forcedSortName: def.sortTitle ?? null, overview: def.overview ?? null, posterUrl: def.poster.kind === 'url' ? def.poster.url : null };
}

/** Fingerprint of "fix metadata drift" for the current definition; stable until the definition's metadata changes. */
export function driftFingerprint(def: MetaDef): string {
  const sig = createHash('sha1').update(JSON.stringify(desiredMeta(def))).digest('hex').slice(0, 8);
  return fingerprint('collection.update_metadata', def.slug, sig);
}

/** Compute members (with provenance) and suggestions for one definition. */
export function members(def: LoadedDefinition, input: PlanInput) {
  const want = def.target === 'movies' ? 'movie' : def.target === 'shows' ? 'series' : def.target === 'episodes' ? 'episode' : 'any';
  const scope = new Set(def.libraryIds ?? (def.target === 'movies' ? input.movieLibraryIds : def.target === 'shows' || def.target === 'episodes' ? input.showLibraryIds : [...input.movieLibraryIds, ...input.showLibraryIds]));
  const inScope = (jfId: string) => {
    const row = input.index.get(jfId);
    if (!row) return false;
    const lib = row.kind === 'episode' && row.seriesJfId ? input.index.get(row.seriesJfId)?.libraryId : row.libraryId;
    return lib ? scope.has(lib) : false;
  };
  const resolved = input.resolved.get(def.id) ?? [];
  const perRole = { add: [] as { key: string; label: string; matches: Match[] }[], suggest: [] as { key: string; label: string; matches: Match[] }[] };
  const sourceStatus: DefinitionPlan['sourceStatus'] = [];
  def.sources.forEach((src, i) => {
    const r = resolved[i];
    if (!r) return;
    const matches: Match[] = [];
    for (const item of r.items) {
      const m = input.index.matchDirect(item, want) ?? (item.imdb ? input.index.matchFound(item, input.found.get(item.imdb) ?? null, want) : null);
      if (m && inScope(m.jfId)) {
        const row = input.index.get(m.jfId)!;
        if (passesFilters(row, def)) matches.push(m);
      }
    }
    perRole[src.role].push({ key: r.key, label: r.label, matches });
    sourceStatus.push({ key: r.key, label: r.label, status: r.status, error: r.error, listed: r.items.length, matched: matches.length });
  });
  const mem = mergeProvenance(perRole.add);
  for (const id of def.pins) if (input.index.get(id)) mem.set(id, { ...(mem.get(id) ?? { sources: [], match: 'pinned' }), pinned: true });
  for (const id of def.excludes) mem.delete(id);
  const sugg = mergeProvenance(perRole.suggest);
  for (const id of [...sugg.keys()]) if (mem.has(id) || def.excludes.has(id)) sugg.delete(id);
  const blocked = def.sources.some((s, i) => s.role === 'add' && (resolved[i]?.status === 'failed' || Boolean(resolved[i]?.meta?.partial)));
  return { members: mem, suggestions: sugg, blocked, sourceStatus };
}

export function plan(input: PlanInput): { actions: PlannedAction[]; plans: DefinitionPlan[] } {
  const actions: PlannedAction[] = [];
  const plans: DefinitionPlan[] = [];
  const today = localDay(input.now, input.tz);
  for (const def of input.definitions) {
    if (!def.enabled) {
      // Turning a collection off removes its box set (routed by the delete mode, like a window closing).
      if (input.live.has(def.id)) actions.push({ type: 'collection.delete', definitionId: def.id, fingerprint: fingerprint('collection.delete', def.slug, 'turned-off', def.updatedAt), applyAt: null, reason: 'Collection turned off' });
      continue;
    }
    const open = isOpen(def.window, today);
    const opensDay = opensWithin(def.window, today, input.leadDays);
    const { members: mem, suggestions, blocked, sourceStatus } = members(def, input);
    const live = input.live.get(def.id);
    const applyAt = open ? null : opensDay !== null ? localMidnight(opensDay, input.tz) : null;
    const cycleDay = open && def.window ? currentStart(def, today) : opensDay;
    const cycle = cycleDay !== null && cycleDay !== undefined ? isoDay(cycleDay) : 'always';
    plans.push({ definitionId: def.id, open, opensAt: open ? null : applyAt, members: mem, blocked, sourceStatus });
    const item = (jfId: string, provenance: Provenance) => {
      const r = input.index.get(jfId)!;
      return { jfId, name: input.index.displayName(r), year: r.kind === 'episode' ? null : r.year, provenance };
    };
    const ref = (jfId: string) => itemRef(input.index.get(jfId)!);

    if (open || opensDay !== null) {
      if (mem.size >= def.minItems) {
        const metaPayload = { ...desiredMeta(def), tags: [MANAGED_TAG], lockedFields: LOCKED_FIELDS, displayOrder: def.sortBy === 'title.asc' ? 'SortName' : 'PremiereDate' };
        if (!live) {
          const reason = open ? 'Window is open' : `Window opens ${isoDay(opensDay!)}`;
          actions.push({ type: 'collection.create', definitionId: def.id, fingerprint: fingerprint('collection.create', def.slug, cycle), applyAt, reason, payload: { name: def.name, minItems: def.minItems } });
          actions.push({ type: 'collection.update_metadata', definitionId: def.id, fingerprint: fingerprint('collection.update_metadata', def.slug, cycle), applyAt, reason, payload: { ...metaPayload, uploadPoster: true } });
          for (const [jfId, prov] of mem) {
            actions.push({ type: 'collection.add_items', definitionId: def.id, fingerprint: fingerprint('collection.add_items', def.slug, ref(jfId)), applyAt, reason: prov.pinned ? 'Pinned' : `On ${prov.sources.map((s) => s.label).join(', ')}`, item: item(jfId, prov) });
          }
        } else {
          if (live.hidden) {
            const reason = open ? 'Window is open' : `Window opens ${isoDay(opensDay!)}`;
            actions.push({ type: 'collection.show', definitionId: def.id, fingerprint: fingerprint('collection.show', def.slug, cycle), applyAt, reason });
          }
          for (const [jfId, prov] of mem) {
            if (live.children.has(jfId)) continue;
            actions.push({ type: 'collection.add_items', definitionId: def.id, fingerprint: fingerprint('collection.add_items', def.slug, ref(jfId)), applyAt: null, reason: prov.pinned ? 'Pinned' : `On ${prov.sources.map((s) => s.label).join(', ')}`, item: item(jfId, prov) });
          }
          if (def.syncMode === 'sync' && !blocked) {
            for (const jfId of live.children) {
              // A suggestion you accepted stays while a source still suggests it; only titles no source lists any more go.
              if (mem.has(jfId) || suggestions.has(jfId) || !input.index.get(jfId)) continue;
              actions.push({ type: 'collection.remove_items', definitionId: def.id, fingerprint: fingerprint('collection.remove_items', def.slug, ref(jfId)), applyAt: null, reason: 'No longer on any source (sources healthy)', item: item(jfId, { sources: [], match: 'current member' }) });
            }
          }
          const want = desiredMeta(def);
          const m = live.meta;
          const drift = m.name !== want.name || (m.forcedSortName ?? null) !== want.forcedSortName || (m.overview ?? null) !== want.overview
            || !m.tags.includes(MANAGED_TAG) || LOCKED_FIELDS.some((f) => !m.lockedFields.includes(f)) || (!m.hasPoster && want.posterUrl);
          if (drift) {
            actions.push({ type: 'collection.update_metadata', definitionId: def.id, fingerprint: driftFingerprint(def), applyAt: null, reason: 'Metadata differs from the definition', payload: { ...metaPayload, uploadPoster: !m.hasPoster } });
          }
        }
        for (const [jfId, prov] of suggestions) {
          if (live?.children.has(jfId)) continue; // already in the box set: nothing to suggest
          actions.push({ type: 'collection.add_items', definitionId: def.id, fingerprint: fingerprint('collection.add_items', def.slug, ref(jfId)), applyAt: live ? null : applyAt, reason: `Suggested by ${prov.sources.map((s) => s.label).join(', ')}`, suggested: true, item: item(jfId, prov) });
        }
      } else if (live && open && !blocked) {
        const reason = `Below the minimum of ${def.minItems} item(s)`;
        if (def.visibility !== 'tag_gate') actions.push({ type: 'collection.delete', definitionId: def.id, fingerprint: fingerprint('collection.delete', def.slug, cycle, 'below-min'), applyAt: null, reason });
        else if (!live.hidden) actions.push({ type: 'collection.hide', definitionId: def.id, fingerprint: fingerprint('collection.hide', def.slug, cycle, 'below-min'), applyAt: null, reason });
      }
    } else if (live) {
      const closed = def.window ? transitions(def.window, today - 400, 20, true).filter((t) => t.kind === 'closes' && t.day <= today).pop() : undefined;
      const when = closed ? isoDay(closed.day) : isoDay(today);
      // Tag-gate keeps the box set (members, poster, ID) and hides it; otherwise it's deleted, Kometa's way.
      if (def.visibility === 'tag_gate') {
        if (!live.hidden) actions.push({ type: 'collection.hide', definitionId: def.id, fingerprint: fingerprint('collection.hide', def.slug, when), applyAt: null, reason: 'Window closed' });
      } else {
        actions.push({ type: 'collection.delete', definitionId: def.id, fingerprint: fingerprint('collection.delete', def.slug, when), applyAt: null, reason: 'Window closed' });
      }
    }
  }
  return { actions, plans };
}

function currentStart(def: LoadedDefinition, today: number): number | undefined {
  if (!def.window) return undefined;
  const y = fromDayNumber(today).y;
  for (const yy of [y - 1, y, y + 1]) {
    const o = occurrence(def.window, yy);
    if (today >= o.start && today <= o.end) return o.start;
  }
  return undefined;
}

function isoDay(day: number): string {
  const { y, m, d } = fromDayNumber(day);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
