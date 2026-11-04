// Home-screen rows (Phase 3, ADR-025): one row per collection, on Jellyfin's home screen, while its box set is live.
//
// Built on two plugins by IAmParadox27, installed in Jellyfin:
//   - Collection Sections (CS) registers a row per entry in its config; each row shows up to 16 items of the box set
//     with that name. We keep one CS entry per collection permanently ("maverick-<slug>"), because removing an
//     entry only takes effect after a Jellyfin restart.
//   - Home Screen Sections (HSS) decides which registered rows users see. We switch our rows on and off with
//     SectionSettings[].Enabled, so a row shows only while its collection is live. That also sidesteps CS's
//     startup cache, which can keep a deleted or hidden box set around until Jellyfin restarts.
// Only entries whose ID starts with "maverick-" are ever touched. Each config is read, changed and written back whole.
import type { AppContext } from '../app-context.js';
import { definition, managedCollection } from '../db/schema.js';
import { normGuid, type JellyfinClient } from '../clients/jellyfin/index.js';
import { log } from '../log.js';

export const HSS_ID = 'b8298e012697407ab44daa8dc795e850'; // Home Screen Sections
export const CS_ID = '043b2c48b3e04610b3988217b146d1a4'; // Collection Sections
export const ROW_PREFIX = 'maverick-';
/** Collection Sections shows at most this many items per row. */
export const ROW_ITEM_CAP = 16;

type CsSection = { UniqueId: string; DisplayText: string; CollectionName: string; SectionType: string | number };
type CsConfig = { Sections?: CsSection[] } & Record<string, unknown>;
type HssSectionSettings = {
  SectionId: string; Enabled: boolean; AllowUserOverride: boolean; LowerLimit: number; UpperLimit: number; OrderIndex: number;
  ViewMode: string | number; HideWatchedItems: boolean; PluginConfigurations?: unknown[];
} & Record<string, unknown>;
type HssConfig = { Enabled?: boolean; SectionSettings?: HssSectionSettings[] } & Record<string, unknown>;

export type PluginState = { installed: boolean; version: string | null; status: string | null };
export type RowPlan = { id: string; definitionId: number; name: string; live: boolean };
export type HomeStatus = {
  hss: PluginState;
  cs: PluginState;
  /** HSS's own master switch: when off, Jellyfin shows its normal home screen and no plugin rows at all. */
  hssEnabled: boolean | null;
  rows: RowPlan[];
  problem: string | null;
};

export const rowId = (slug: string) => `${ROW_PREFIX}${slug}`;

/** Which rows we want, and which of them should be showing (box set live, not hidden by the tag-gate). */
export function plannedRows(app: AppContext): RowPlan[] {
  const states = new Map(app.db.select().from(managedCollection).all().map((m) => [m.definitionId, m.state]));
  return app.db.select().from(definition).all()
    .filter((d) => d.enabled && d.homeRow)
    .sort((a, b) => (a.sortTitle ?? a.name).localeCompare(b.sortTitle ?? b.name))
    .map((d) => ({ id: rowId(d.slug), definitionId: d.id, name: d.name, live: states.get(d.id) === 'live' }));
}

async function plugins(jf: JellyfinClient): Promise<{ hss: PluginState; cs: PluginState }> {
  const all = await jf.plugins();
  const one = (id: string): PluginState => {
    const p = all.find((x) => normGuid(x.id) === id);
    return p ? { installed: true, version: p.version, status: p.status } : { installed: false, version: null, status: null };
  };
  return { hss: one(HSS_ID), cs: one(CS_ID) };
}

export async function homeStatus(app: AppContext): Promise<HomeStatus> {
  const rows = plannedRows(app);
  const jf = app.jellyfin();
  const none: PluginState = { installed: false, version: null, status: null };
  if (!jf) return { hss: none, cs: none, hssEnabled: null, rows, problem: 'Jellyfin isn’t connected.' };
  try {
    const { hss, cs } = await plugins(jf);
    const hssEnabled = hss.installed ? Boolean((await jf.pluginConfiguration<HssConfig>(HSS_ID)).Enabled) : null;
    const problem = !hss.installed ? 'Home Screen Sections isn’t installed in Jellyfin.'
      : !cs.installed ? 'Collection Sections isn’t installed in Jellyfin.'
      : null;
    return { hss, cs, hssEnabled, rows, problem };
  } catch (e) {
    return { hss: none, cs: none, hssEnabled: null, rows, problem: `Couldn’t read Jellyfin’s plugins: ${(e as Error).message}` };
  }
}

export type SyncResult = { changed: boolean; csChanged: boolean; hssChanged: boolean; showing: string[]; dryRun: boolean; problem: string | null };

/**
 * Bring the two plugin configs in line with the collections. Rows for collections that no longer want one are
 * switched off (and their CS entries dropped). Does nothing in dry run except report what it would do.
 */
export async function syncHomeRows(app: AppContext, opts: { dryRun?: boolean } = {}): Promise<SyncResult> {
  const s = app.settings();
  const dryRun = opts.dryRun ?? s.dryRun;
  const rows = plannedRows(app);
  const showing = rows.filter((r) => r.live).map((r) => r.name);
  const result: SyncResult = { changed: false, csChanged: false, hssChanged: false, showing, dryRun, problem: null };
  const jf = app.jellyfin();
  if (!jf) return { ...result, problem: 'Jellyfin isn’t connected.' };
  const { hss, cs } = await plugins(jf);
  if (!hss.installed || !cs.installed) return { ...result, problem: !hss.installed ? 'Home Screen Sections isn’t installed in Jellyfin.' : 'Collection Sections isn’t installed in Jellyfin.' };

  // 1. Collection Sections: one entry per wanted row; everything that isn't ours is left exactly as it was.
  const csCfg = await jf.pluginConfiguration<CsConfig>(CS_ID);
  const theirs = (csCfg.Sections ?? []).filter((x) => !String(x.UniqueId).startsWith(ROW_PREFIX));
  const ours: CsSection[] = rows.map((r) => ({ UniqueId: r.id, DisplayText: r.name, CollectionName: r.name, SectionType: 'Collection' }));
  const csNext = { ...csCfg, Sections: [...theirs, ...ours] };
  result.csChanged = JSON.stringify(csCfg.Sections ?? []) !== JSON.stringify(csNext.Sections);

  // 2. Home Screen Sections: our rows on while live, off otherwise; users can't override them (the season decides).
  const hssCfg = await jf.pluginConfiguration<HssConfig>(HSS_ID);
  const current = hssCfg.SectionSettings ?? [];
  const wanted = new Map(rows.map((r, i) => [r.id, { live: r.live, order: s.homeRows.orderIndex + i }]));
  // A row nobody wants any more stays in the list, switched off: CS keeps it registered until Jellyfin restarts, and
  // without a setting HSS might show it by default.
  const next: HssSectionSettings[] = current
    .map((x) => {
      if (!String(x.SectionId).startsWith(ROW_PREFIX)) return x;
      const w = wanted.get(x.SectionId);
      return { ...x, Enabled: Boolean(w?.live), AllowUserOverride: false, OrderIndex: w?.order ?? x.OrderIndex, ViewMode: s.homeRows.viewMode, LowerLimit: 1, UpperLimit: 1 };
    });
  for (const [id, w] of wanted) {
    if (next.some((x) => x.SectionId === id)) continue;
    next.push({ SectionId: id, Enabled: w.live, AllowUserOverride: false, LowerLimit: 1, UpperLimit: 1, OrderIndex: w.order, ViewMode: s.homeRows.viewMode, HideWatchedItems: false, PluginConfigurations: [] });
  }
  result.hssChanged = JSON.stringify(current) !== JSON.stringify(next);
  result.changed = result.csChanged || result.hssChanged;

  if (!result.changed || dryRun) {
    if (result.changed) log.info(`Dry run: home-screen rows not changed (would show ${showing.join(', ') || 'none'})`);
    return result;
  }
  if (result.csChanged) await jf.setPluginConfiguration(CS_ID, csNext);
  if (result.hssChanged) await jf.setPluginConfiguration(HSS_ID, { ...hssCfg, SectionSettings: next });
  try {
    await jf.bustHomeScreenCache(); // so open apps refetch their rows
  } catch (e) {
    log.warn(`Home Screen Sections cache refresh failed: ${(e as Error).message}`);
  }
  log.info(`Home-screen rows updated: ${showing.length ? `showing ${showing.join(', ')}` : 'none showing'}`);
  return result;
}
