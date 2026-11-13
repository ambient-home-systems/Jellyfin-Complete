// View models: everything the pages need, computed from the database (no Jellyfin calls on page load).
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { AppContext } from '../app-context.js';
import { action, run, sourceResult, imdbHash, managedCollection, membership, definition, library, integrityEvent, healthFinding } from '../db/schema.js';
import type { WindowDef } from '../db/schema.js';
import { loadDefinitions, type LoadedDefinition } from '../domain/definitions.js';
import { localDay, transitions, localMidnight, occurrence, fromDayNumber, dayNumber } from '../domain/windows.js';
import { getPlanSummary } from '../pipeline/summary.js';
import { currentRun } from '../pipeline/run.js';
import { versionSupport } from '../clients/jellyfin/compat.js';
import { sourceLabel } from '../sources/index.js';
import { fmtAgo, fmtTime } from './ui.js';

export function shellModel(app: AppContext) {
  const pending = app.db.select({ n: sql<number>`count(*)` }).from(action).where(eq(action.status, 'proposed')).get()?.n ?? 0;
  const last = app.db.select().from(run).where(sql`${run.status} != 'running'`).orderBy(desc(run.startedAt)).limit(1).get();
  const s = app.settings();
  const healthOpen = app.db.select({ n: sql<number>`count(*)` }).from(healthFinding).where(isNull(healthFinding.dismissedAt)).get()?.n ?? 0;
  return {
    dryRun: s.dryRun,
    pending,
    healthOpen,
    lastRun: last ? `Last run ${fmtTime(last.startedAt, s.timezone)}${last.status === 'failed' ? ' (failed)' : ''}` : 'No runs yet',
  };
}

type Managed = typeof managedCollection.$inferSelect;

function managedMap(app: AppContext): Map<number, Managed> {
  return new Map(app.db.select().from(managedCollection).all().map((m) => [m.definitionId, m]));
}

function memberCounts(app: AppContext): Map<number, number> {
  const rows = app.db.select({ d: membership.definitionId, n: sql<number>`count(*)` }).from(membership).groupBy(membership.definitionId).all();
  return new Map(rows.map((r) => [r.d, r.n]));
}

function pendingByDef(app: AppContext) {
  const rows = app.db.select().from(action).where(eq(action.status, 'proposed')).all();
  const out = new Map<number, { total: number; add: number; remove: number; suggested: number; other: number }>();
  for (const a of rows) {
    if (a.definitionId === null) continue;
    const e = out.get(a.definitionId) ?? { total: 0, add: 0, remove: 0, suggested: 0, other: 0 };
    e.total++;
    if (a.type === 'collection.add_items') (a.payload as { suggested?: boolean } | null)?.suggested ? e.suggested++ : e.add++;
    else if (a.type === 'collection.remove_items') e.remove++;
    else e.other++;
    out.set(a.definitionId, e);
  }
  return out;
}

export type Change = { day: number; at: number; kind: 'opens' | 'closes'; def: LoadedDefinition };

function upcomingChanges(defs: LoadedDefinition[], today: number, tz: string, horizonDays: number): Change[] {
  const out: Change[] = [];
  for (const d of defs) {
    if (!d.enabled || !d.window) continue;
    for (const t of transitions(d.window, today, 6)) {
      if (t.day - today > horizonDays) break;
      out.push({ day: t.day, at: localMidnight(t.day, tz), kind: t.kind, def: d });
    }
  }
  return out.sort((a, b) => a.day - b.day || (a.kind === 'closes' ? -1 : 1) || a.def.name.localeCompare(b.def.name));
}

export type YearBar = { name: string; left: number; width: number; lane: number; state: '' | 'live' | 'next' | 'short' | 'live short' | 'next short'; tip: string; label: string; href: string };

function yearStrip(defs: LoadedDefinition[], year: number, live: Set<number>, next: Set<number>): { bars: YearBar[]; lanes: number } {
  const start = dayNumber(year, 1, 1);
  const days = dayNumber(year + 1, 1, 1) - start;
  type Seg = { d: LoadedDefinition; a: number; b: number };
  const segs: Seg[] = [];
  for (const d of defs) {
    if (!d.enabled || !d.window) continue;
    for (const yy of [year - 1, year]) {
      const o = occurrence(d.window as WindowDef, yy);
      const a = Math.max(o.start, start);
      const b = Math.min(o.end, start + days - 1);
      if (a <= b) segs.push({ d, a, b });
    }
  }
  segs.sort((x, y) => x.a - y.a || y.b - y.a - (x.b - x.a));
  const laneEnds: number[] = [];
  const bars: YearBar[] = [];
  for (const s of segs) {
    let lane = laneEnds.findIndex((end) => end < s.a);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(s.b); } else laneEnds[lane] = s.b;
    const width = ((s.b - s.a + 1) / days) * 100;
    const short = width < 3;
    const base = live.has(s.d.id) ? 'live' : next.has(s.d.id) ? 'next' : '';
    const label = s.d.name.replace(/ Movies$/, '');
    const f = (x: number) => { const p = fromDayNumber(x); return `${p.m}/${p.d}`; };
    bars.push({
      name: s.d.name, left: ((s.a - start) / days) * 100, width, lane, label: short ? '' : label,
      state: (short ? (base ? `${base} short` : 'short') : base) as YearBar['state'],
      tip: `${s.d.name} · ${f(s.a)}–${f(s.b)}${base === 'live' ? ' · live now' : base === 'next' ? ' · next to open' : ''}`,
      href: `/collections/${s.d.id}`,
    });
  }
  return { bars, lanes: Math.max(laneEnds.length, 1) };
}

export function dashboardModel(app: AppContext, now = Date.now()) {
  const s = app.settings();
  const tz = s.timezone;
  const today = localDay(now, tz);
  const defs = loadDefinitions(app.db);
  const managed = managedMap(app);
  const members = memberCounts(app);
  const pend = pendingByDef(app);
  const summary = getPlanSummary(app.db);
  const liveIds = new Set([...managed.values()].filter((m) => m.state === 'live').map((m) => m.definitionId));

  const needs = defs.filter((d) => pend.has(d.id)).map((d) => ({ def: d, ...pend.get(d.id)! })).sort((a, b) => b.total - a.total);
  const pendingTotal = needs.reduce((n, x) => n + x.total, 0);

  const sources = app.db.select().from(sourceResult).all();
  const failing = sources.filter((r) => r.status === 'failed');
  const stale = sources.filter((r) => r.status === 'stale');
  const hashes = app.db.select().from(imdbHash).all();
  const hashError = hashes.find((h) => h.error)?.error ?? null;
  const lastRun = app.db.select().from(run).where(sql`${run.status} != 'running'`).orderBy(desc(run.startedAt)).limit(1).get() ?? null;

  // A "closes" row only matters for a box set that exists or will exist (planned members ≥ minimum).
  const willBeLive = (d: LoadedDefinition) => liveIds.has(d.id) || !summary || (summary.defs[String(d.id)]?.members ?? 0) >= d.minItems;
  const changes = upcomingChanges(defs, today, tz, 400).filter((c) => c.kind === 'opens' || willBeLive(c.def));
  const firstDay = changes[0]?.day;
  const next = firstDay !== undefined ? changes.filter((c) => c.day === firstDay) : [];
  const plannedMembers = (id: number) => summary?.defs[String(id)]?.members ?? 0;
  const nextOpen = new Set(next.filter((c) => c.kind === 'opens').map((c) => c.def.id));
  const strip = yearStrip(defs, fromDayNumber(today).y, liveIds, nextOpen);
  const timetable = changes.filter((c) => c.day - today <= 120).map((c) => {
    const sum = summary?.defs[String(c.def.id)];
    const remarks: string[] = [];
    if (c.kind === 'opens') {
      const n = sum?.members ?? null;
      if (n === null) remarks.push('Not planned yet; run once');
      else if (n < c.def.minItems) remarks.push(n === 0 ? 'Nothing in your library matches; not created' : `Below the minimum of ${c.def.minItems}`);
      else remarks.push(`${n} ${n === 1 ? 'title' : 'titles'}`);
      const p = pend.get(c.def.id);
      if (p?.total) remarks.push(`${p.total} await review`);
    } else {
      remarks.push(c.def.visibility === 'tag_gate' ? 'Box set hidden; kept for next season' : 'Box set deleted; poster and sort title kept');
    }
    const bad = sum?.sources.filter((x) => x.status !== 'ok') ?? [];
    return { ...c, remarks: remarks.join(' · '), sourceLabels: c.def.sources.map((x) => x.type).length, failing: bad, via: (sum?.sources.map((x) => x.label) ?? []).join(', ') };
  });

  return {
    tz, today, now, needs, pendingTotal, failing, stale, hashError, lastRun, next, plannedMembers, members, liveIds,
    strip, timetable, healthyCount: sources.filter((r) => r.status === 'ok').length, progress: currentRun(),
    configured: Boolean(app.jellyfin()), dryRun: s.dryRun,
    waitingForAdoption: defs.filter((d) => d.enabled && summary?.defs[String(d.id)]?.waitingForAdoption).length,
    server: s.server.version ? { version: s.server.version, ...versionSupport(s.server.version) } : null,
    // ADR-040: box set repairs this week, and libraries where Jellyfin makes its own (unlocked) box sets.
    integrity: app.db.select().from(integrityEvent).where(gte(integrityEvent.at, now - 7 * 86_400_000)).orderBy(desc(integrityEvent.at)).limit(50).all(),
    autoCollections: app.db.select().from(library).all().filter((l) => l.autoCollections).map((l) => l.name),
    // ADR-041: files that may not be what they say, not yet marked as fine.
    healthOpen: app.db.select().from(healthFinding).all().filter((f) => !f.dismissedAt).length,
  };
}

export function collectionsModel(app: AppContext, now = Date.now()) {
  const s = app.settings();
  const tz = s.timezone;
  const today = localDay(now, tz);
  const defs = loadDefinitions(app.db);
  const managed = managedMap(app);
  const members = memberCounts(app);
  const summary = getPlanSummary(app.db);
  const pend = pendingByDef(app);
  return defs.map((d) => {
    const m = managed.get(d.id);
    const sum = summary?.defs[String(d.id)];
    const live = m?.state === 'live';
    const hidden = m?.state === 'hidden';
    const nextT = d.window ? transitions(d.window, today, 1)[0] : undefined;
    let status: { label: string; kind: 'live' | 'scheduled' | 'below' | 'off' };
    if (!d.enabled) status = { label: 'Off', kind: 'off' };
    else if (live) status = { label: 'Live', kind: 'live' };
    else if (hidden) status = { label: 'Hidden', kind: 'below' };
    else if (sum?.waitingForAdoption) status = { label: 'Adopt existing box set', kind: 'below' };
    else if (sum && sum.members < d.minItems) status = { label: sum.members === 0 ? 'Nothing matches' : 'Below minimum', kind: 'below' };
    else status = { label: 'Scheduled', kind: 'scheduled' };
    return {
      def: d, status, items: live || hidden ? members.get(d.id) ?? 0 : sum?.members ?? null,
      next: nextT ? { kind: nextT.kind, at: localMidnight(nextT.day, tz) } : null,
      sources: sum?.sources ?? d.sources.map((x) => ({ key: String(x.id), label: sourceLabel({ type: x.type, config: x.config }), status: 'unknown', error: null, listed: 0, matched: 0 })),
      pending: pend.get(d.id)?.total ?? 0,
    };
  });
}

export type ReviewTab = 'pending' | 'snoozed' | 'dismissed';

export function reviewModel(app: AppContext, tab: ReviewTab, filterDef?: number) {
  const statuses = tab === 'pending' ? ['proposed', 'approved'] : tab === 'snoozed' ? ['snoozed'] : ['dismissed'];
  let rows = app.db.select().from(action).where(inArray(action.status, statuses as never[])).orderBy(desc(action.createdAt)).all();
  if (tab === 'pending') rows = rows.filter((r) => r.status === 'proposed' || (r.applyAt !== null && r.applyAt > Date.now()));
  if (filterDef) rows = rows.filter((r) => r.definitionId === filterDef);
  const defs = new Map(loadDefinitions(app.db).map((d) => [d.id, d]));
  const groups = new Map<number, { def: LoadedDefinition | undefined; byType: Map<string, typeof rows> }>();
  for (const r of rows) {
    const id = r.definitionId ?? -1;
    const g = groups.get(id) ?? { def: defs.get(id), byType: new Map() };
    g.byType.set(r.type, [...(g.byType.get(r.type) ?? []), r]);
    groups.set(id, g);
  }
  const counts = Object.fromEntries((['proposed', 'snoozed', 'dismissed'] as const).map((st) => [st, app.db.select({ n: sql<number>`count(*)` }).from(action).where(eq(action.status, st)).get()?.n ?? 0]));
  return { tab, groups: [...groups.values()].sort((a, b) => (a.def?.name ?? '').localeCompare(b.def?.name ?? '')), counts, defs: [...defs.values()] };
}

export function activityModel(app: AppContext) {
  const runs = app.db.select().from(run).orderBy(desc(run.startedAt)).limit(30).all();
  const applied = app.db.select().from(action).where(inArray(action.status, ['applied', 'failed'])).orderBy(desc(action.updatedAt)).limit(150).all();
  const undone = new Set(app.db.select({ u: action.undoOf }).from(action).where(sql`${action.undoOf} is not null`).all().map((r) => r.u));
  const defs = new Map(app.db.select({ id: definition.id, name: definition.name }).from(definition).all().map((d) => [d.id, d.name]));
  return { runs, applied, undone, defs };
}

export function librariesModel(app: AppContext) {
  return app.db.select().from(library).all().filter((l) => l.collectionType === 'movies' || l.collectionType === 'tvshows');
}

export function sourceRows(app: AppContext, keys: string[]) {
  if (!keys.length) return [];
  return app.db.select().from(sourceResult).where(inArray(sourceResult.sourceKey, keys)).all();
}

export { fmtAgo, and };
