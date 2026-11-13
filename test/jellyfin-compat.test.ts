// Jellyfin version compatibility (Phase 4): every call, query parameter, item property and enum value the app relies
// on must exist in each supported version's published OpenAPI spec (surfaces extracted to test/fixtures/jellyfin-api).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { JELLYFIN_CALLS, ITEM_PROPERTIES, POLICY_PROPERTIES, LIBRARY_PROPERTIES, ENUM_VALUES, API_CHECKED, versionSupport, compareVersions } from '../src/clients/jellyfin/compat.js';

type Surface = { version: string; paths: Record<string, Record<string, string[]>>; schemas: Record<string, string[]>; enums: Record<string, string[]> };
const dir = join(__dirname, 'fixtures/jellyfin-api');
const surfaces: Surface[] = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
const norm = (p: string) => p.replace(/\{[^}]+\}/g, '{}').toLowerCase();

describe('Jellyfin API compatibility', () => {
  it('has a published-spec surface for every version it claims', () => {
    expect(surfaces.map((s) => s.version).sort(compareVersions)).toEqual(API_CHECKED);
  });

  for (const s of surfaces) {
    describe(`Jellyfin ${s.version}`, () => {
      it('has every endpoint and query parameter the app uses', () => {
        const missing: string[] = [];
        for (const call of JELLYFIN_CALLS) {
          const op = s.paths[norm(call.path)]?.[call.method];
          if (!op) { missing.push(`${call.method.toUpperCase()} ${call.path}`); continue; }
          const have = new Set(op.map((q) => q.toLowerCase()));
          for (const q of call.query ?? []) if (!have.has(q.toLowerCase())) missing.push(`${call.method.toUpperCase()} ${call.path} ?${q}`);
        }
        expect(missing).toEqual([]);
      });

      it('has the item, policy and library properties and enum values the app reads and writes', () => {
        expect(ITEM_PROPERTIES.filter((p) => !s.schemas.BaseItemDto!.includes(p))).toEqual([]);
        expect(POLICY_PROPERTIES.filter((p) => !s.schemas.UserPolicy!.includes(p))).toEqual([]);
        for (const [schema, props] of Object.entries(LIBRARY_PROPERTIES)) expect(props.filter((p) => !s.schemas[schema]!.includes(p)), schema).toEqual([]);
        for (const [e, values] of Object.entries(ENUM_VALUES)) expect(values.filter((v) => !s.enums[e]!.includes(v)), e).toEqual([]);
      });
    });
  }

  it('describes how far each version is checked', () => {
    expect(versionSupport('10.9.11').level).toBe('unsupported');
    expect(versionSupport('10.10.7').level).toBe('checked');
    expect(versionSupport('10.11.3').level).toBe('checked');
    expect(versionSupport('12.4.0').level).toBe('verified');
    expect(versionSupport('12.4.2').level).toBe('verified');
    expect(versionSupport('12.5.0').level).toBe('untested');
    expect(versionSupport('13.0.0').note).toMatch(/newer than the versions/);
  });
});

describe('version check at run time', () => {
  async function world(version: string) {
    const { FakeJellyfin, FAKE_URL } = await import('./fakes/jellyfin.js');
    const { createContext } = await import('../src/app-context.js');
    const { readConfig } = await import('../src/config.js');
    const { openDb } = await import('../src/db/index.js');
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const fake = new FakeJellyfin();
    fake.version = version;
    const config = { ...readConfig({}), configDir: mkdtempSync(join(tmpdir(), 'mc-')), timezone: 'America/New_York', seeds: {} };
    const app = createContext(config, { db: openDb(':memory:'), fetch: async () => new Response('nope', { status: 404 }), jellyfinFetch: fake.fetch() });
    app.updateSettings({ connections: { jellyfinUrl: FAKE_URL, plexUrl: '', radarrUrl: '', sonarrUrl: '' } });
    app.secrets.set('jellyfin.apiKey', fake.apiKey);
    return { app, fake };
  }

  it('refuses to plan against a server older than 10.10, and records the version', async () => {
    const { runPipeline } = await import('../src/pipeline/run.js');
    const { app, fake } = await world('10.9.11');
    const r = await runPipeline(app, { job: 'manual', trigger: 'manual', index: true });
    expect(r).toMatchObject({ status: 'failed', error: expect.stringMatching(/older than 10\.10\.0/) });
    expect(fake.calls.some((c) => c.path === '/Items')).toBe(false);
    expect(app.settings().server.version).toBe('10.9.11');
  });

  it('runs on an API-checked version and says so on the Dashboard', async () => {
    const { runPipeline } = await import('../src/pipeline/run.js');
    const { dashboardModel } = await import('../src/web/model.js');
    const { app } = await world('10.11.8');
    expect((await runPipeline(app, { job: 'manual', trigger: 'manual', index: true })).status).toBe('ok');
    expect(dashboardModel(app).server).toMatchObject({ version: '10.11.8', level: 'checked' });
  });
});

