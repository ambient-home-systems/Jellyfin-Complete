// Regressions for the 0.7.0 fixes: approving a new box set fills it in one step (bug 4), and presets gain new
// spin-offs on existing installs without losing your edits (bug 5).
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { runPipeline } from '../src/pipeline/run.js';
import { reviewVerdict } from '../src/web/review-actions.js';
import { upgradePresets } from '../src/domain/definitions.js';
import { action, definition, definitionSource } from '../src/db/schema.js';
import { FAKE_URL } from './fakes/jellyfin.js';
import { setup, form } from './helpers/web.js';

describe('0.7.0 fixes', () => {
  it('approving "Create box set" creates it with its titles in one step', async () => {
    const t = setup();
    await t.web.request('/setup', form({ url: FAKE_URL, apiKey: t.fake.apiKey, setupCode: t.app.setupCode ?? '' }));
    await runPipeline(t.app, { job: 'manual', trigger: 'manual', index: true, now: Date.UTC(2026, 10, 17, 15) });
    const create = t.app.db.select().from(action).where(eq(action.type, 'collection.create')).all().find((a) => a.status === 'proposed')!;
    const r = await reviewVerdict(t.app, [create.id], 'approve', 'admin');
    expect(r.message).toMatch(/Approved 3 \(including 2 title and detail changes for the new collection\)\. Applied 3\./);
    expect(t.fake.boxSets().find((b) => b.Name === 'Thanksgiving Movies')?.children).toEqual(['m-ptna']);
  });

  it('approving "Create box set" also applies titles approved earlier by Auto (0.8.1)', async () => {
    const t = setup();
    await t.web.request('/setup', form({ url: FAKE_URL, apiKey: t.fake.apiKey, setupCode: t.app.setupCode ?? '' }));
    // Dry run off; creating waits for review, adding titles is Auto: the adds are approved but can't apply without a box set.
    t.app.updateSettings({ dryRun: false, modes: { ...t.app.settings().modes, 'collection.create': 'review', 'collection.delete': 'review' } });
    await runPipeline(t.app, { job: 'manual', trigger: 'manual', index: true, now: Date.UTC(2026, 10, 17, 15) });
    const acts = t.app.db.select().from(action).all();
    const create = acts.find((a) => a.type === 'collection.create' && a.status === 'proposed')!;
    expect(acts.find((a) => a.type === 'collection.add_items')!.status).toBe('approved');
    expect(t.fake.boxSets()).toEqual([]);
    const r = await reviewVerdict(t.app, [create.id], 'approve', 'admin');
    expect(r.message).toContain('Applied 3');
    expect(t.fake.boxSets().find((b) => b.Name === 'Thanksgiving Movies')?.children).toEqual(['m-ptna']);
  });

  it('adds new spin-offs to existing show franchises, keeping IDs you added yourself', () => {
    const t = setup();
    const def = t.app.db.select().from(definition).where(eq(definition.slug, 'franchise-show-75219')).get()!;
    const src = t.app.db.select().from(definitionSource).where(eq(definitionSource.definitionId, def.id)).get()!;
    expect((src.config as { ids: string[] }).ids).toEqual(['75219', '89393', '284838']); // a new install has 9-1-1: Nashville
    // An install from before 0.7.0, where someone also added a show of their own:
    t.app.db.update(definitionSource).set({ config: { ids: ['75219', '89393', '999'] } }).where(eq(definitionSource.id, src.id)).run();
    expect(upgradePresets(t.app.db)).toBeGreaterThanOrEqual(1);
    expect((t.app.db.select().from(definitionSource).where(eq(definitionSource.id, src.id)).get()!.config as { ids: string[] }).ids).toEqual(['75219', '89393', '999', '284838']);
    expect(upgradePresets(t.app.db)).toBe(0); // nothing left to add
    const ys = t.app.db.select().from(definition).where(eq(definition.slug, 'franchise-show-73586')).get()!;
    expect((t.app.db.select().from(definitionSource).where(eq(definitionSource.definitionId, ys.id)).get()!.config as { ids: string[] }).ids).toEqual(expect.arrayContaining(['299167', '225891']));
  });
});
