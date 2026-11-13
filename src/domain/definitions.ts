// Collection definitions: seeding from presets and loading with their sources, modes and pins.
import { eq } from 'drizzle-orm';
import type { DB } from '../db/index.js';
import { definition, definitionSource, definitionMode, pin } from '../db/schema.js';
import type { ActionType } from '../db/schema.js';
import { PRESETS } from '../presets/index.js';
import type { Mode } from '../settings.js';

export type LoadedDefinition = typeof definition.$inferSelect & {
  sources: (typeof definitionSource.$inferSelect)[];
  modes: Partial<Record<ActionType, Mode>>;
  pins: Set<string>;
  excludes: Set<string>;
};

/** Insert any preset that isn't defined yet (seasonal on, franchises and universes off). Never overwrites your edits. */
export function seedPresets(db: DB, now = Date.now()): number {
  let added = 0;
  for (const p of PRESETS) {
    const d = p.definition;
    if (db.select({ id: definition.id }).from(definition).where(eq(definition.slug, d.slug)).get()) continue;
    const row = db.insert(definition).values({
      slug: d.slug, name: d.name, target: d.target, enabled: p.enabledByDefault, homeRow: p.family === 'seasonal' || p.family === 'holiday_episodes', presetKey: d.presetKey, presetRev: d.presetRev,
      window: d.window, filters: {}, libraryIds: null, minItems: d.minItems, syncMode: d.syncMode, sortBy: d.sortBy,
      sortTitle: d.sortTitle, overview: d.overview, poster: d.poster, visibility: d.visibility, createdAt: now, updatedAt: now,
    }).returning({ id: definition.id }).get();
    d.sources.forEach((s, i) => db.insert(definitionSource).values({ definitionId: row.id, type: s.type, config: s.config, role: s.role ?? 'add', position: i }).run());
    for (const [actionType, mode] of Object.entries(d.modes ?? {})) db.insert(definitionMode).values({ definitionId: row.id, actionType, mode }).run();
    added++;
  }
  return added;
}

/**
 * Bring existing presets up to date where it's safe: add IDs the code's preset lists now have (such as new spin-offs)
 * to the matching source. Only adds, never removes or changes anything else, so your edits stay. Returns how many
 * sources changed.
 */
export function upgradePresets(db: DB, now = Date.now()): number {
  let changed = 0;
  for (const p of PRESETS) {
    const row = db.select({ id: definition.id }).from(definition).where(eq(definition.slug, p.definition.slug)).get();
    if (!row) continue;
    const mine = db.select().from(definitionSource).where(eq(definitionSource.definitionId, row.id)).all();
    for (const want of p.definition.sources) {
      const wantIds = (want.config as { ids?: unknown }).ids;
      if (!Array.isArray(wantIds)) continue;
      const src = mine.find((s) => s.type === want.type && Array.isArray((s.config as { ids?: unknown }).ids));
      if (!src) continue;
      const have = ((src.config as { ids: unknown[] }).ids).map(String);
      const add = wantIds.map(String).filter((id) => !have.includes(id));
      if (!add.length) continue;
      db.update(definitionSource).set({ config: { ...(src.config as object), ids: [...have, ...add] } }).where(eq(definitionSource.id, src.id)).run();
      db.update(definition).set({ updatedAt: now }).where(eq(definition.id, row.id)).run();
      changed++;
    }
  }
  return changed;
}

export function loadDefinitions(db: DB, opts: { enabledOnly?: boolean } = {}): LoadedDefinition[] {
  const defs = db.select().from(definition).all().filter((d) => !opts.enabledOnly || d.enabled);
  const sources = db.select().from(definitionSource).all();
  const modes = db.select().from(definitionMode).all();
  const pins = db.select().from(pin).all();
  return defs.map((d) => ({
    ...d,
    sources: sources.filter((s) => s.definitionId === d.id).sort((a, b) => a.position - b.position),
    modes: Object.fromEntries(modes.filter((m) => m.definitionId === d.id).map((m) => [m.actionType, m.mode])) as LoadedDefinition['modes'],
    pins: new Set(pins.filter((p) => p.definitionId === d.id && p.kind === 'pin').map((p) => p.jfId)),
    excludes: new Set(pins.filter((p) => p.definitionId === d.id && p.kind === 'exclude').map((p) => p.jfId)),
  }));
}

export function loadDefinition(db: DB, id: number): LoadedDefinition | undefined {
  return loadDefinitions(db).find((d) => d.id === id);
}
