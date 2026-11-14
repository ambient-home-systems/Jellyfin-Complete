// Extract the slice of a Jellyfin OpenAPI spec that the app depends on (src/clients/jellyfin/compat.ts), so the
// compatibility test can check several versions without committing megabytes of specs.
//
//   npx tsx scripts/jellyfin-api-surface.ts spec.json > test/fixtures/jellyfin-api/<version>.json
//
// Published specs: https://api.jellyfin.org/openapi/stable/jellyfin-openapi-<version>.json (10.x) and
// https://api.jellyfin.org/openapi/jellyfin-openapi-stable.json (current), or /api-docs/openapi.json on a server.
import { readFileSync } from 'node:fs';
import { JELLYFIN_CALLS, ENUM_VALUES, SCHEMA_PROPERTIES } from '../src/clients/jellyfin/compat.js';

type Spec = {
  info: { version: string };
  paths: Record<string, Record<string, { parameters?: { name: string; in: string }[] }>>;
  components: { schemas: Record<string, { properties?: Record<string, unknown>; enum?: string[] }> };
};

const file = process.argv[2];
if (!file) throw new Error('Usage: npx tsx scripts/jellyfin-api-surface.ts <openapi.json>');
const spec = JSON.parse(readFileSync(file, 'utf8')) as Spec;
// Path parameters are named differently across versions ({id} vs {itemId}), so compare them as "{}".
const norm = (p: string) => p.replace(/\{[^}]+\}/g, '{}').toLowerCase();
const byNorm = new Map(Object.entries(spec.paths).map(([p, ops]) => [norm(p), ops]));

const paths: Record<string, Record<string, string[]>> = {};
for (const call of JELLYFIN_CALLS) {
  const ops = byNorm.get(norm(call.path));
  if (!ops) continue;
  paths[norm(call.path)] ??= {};
  for (const [method, op] of Object.entries(ops)) {
    paths[norm(call.path)]![method] = (op.parameters ?? []).filter((x) => x.in === 'query').map((x) => x.name).sort();
  }
}
const props = (name: string) => Object.keys(spec.components.schemas[name]?.properties ?? {}).sort();
const out = {
  version: spec.info.version,
  paths,
  // A key like "TrickplayInfo|TrickplayInfoDto" names a schema that was renamed: the first one this version has.
  schemas: Object.fromEntries(['BaseItemDto', 'UserPolicy', ...Object.keys(SCHEMA_PROPERTIES)].map((n) => [n, props(n.split('|').find((x) => spec.components.schemas[x]) ?? n)])),
  enums: Object.fromEntries(Object.keys(ENUM_VALUES).map((e) => [e, spec.components.schemas[e]?.enum ?? []])),
};
process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
