// Build an IMDb snapshot (ADR-011 route 4, docs/IMDB-SNAPSHOT.md) with the same resolver the direct route uses.
//
//   npx tsx scripts/imdb-snapshot.ts --out imdb-snapshot.json
//
// Always includes every preset's IMDb lists and searches. Add your own collections with either:
//   --queries queries.json   the file from Settings → IMDb → "Download the query list"
//   --db /config/maverick.db  read them straight from the app's database (read-only)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { PRESETS } from '../src/presets/index.js';
import { buildSnapshot, type SnapshotRequest } from '../src/imdb/snapshot.js';
import { queriesFor } from '../src/imdb/queries.js';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const sources: { type: string; config: Record<string, unknown> }[] = PRESETS.flatMap((p) => p.definition.sources);
const extra: SnapshotRequest = { searches: [], lists: [] };

const queriesFile = opt('--queries');
if (queriesFile && existsSync(queriesFile)) {
  const q = JSON.parse(readFileSync(queriesFile, 'utf8')) as SnapshotRequest;
  extra.searches.push(...(q.searches ?? []));
  extra.lists.push(...(q.lists ?? []));
} else if (queriesFile) {
  console.error(`No ${queriesFile}; using the presets only.`);
}

const dbPath = opt('--db');
let series: string[] = [];
if (dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  series = (db.prepare("select imdb from library_item where kind = 'series' and imdb is not null").all() as { imdb: string }[]).map((r) => r.imdb);
  for (const r of db.prepare("select type, config from definition_source where type in ('imdb_search', 'imdb_list')").all() as { type: string; config: string }[]) {
    sources.push({ type: r.type, config: JSON.parse(r.config) as Record<string, unknown> });
  }
  db.close();
}

// Holiday-episode searches are scoped to the series you own, so they need --db (or come in via --queries).
const fromSources = queriesFor(sources, series);
const req: SnapshotRequest = { searches: [...fromSources.searches, ...extra.searches], lists: [...fromSources.lists, ...extra.lists] };
const snap = await buildSnapshot(fetch, req, new Date(), (m) => console.error(m));
const json = JSON.stringify(snap);
const out = opt('--out');
if (out) writeFileSync(out, json);
else process.stdout.write(json);

const failed = Object.keys(snap.errors).length;
console.error(`${Object.keys(snap.searches).length} searches, ${Object.keys(snap.lists).length} lists, ${failed} failed`);
for (const [key, err] of Object.entries(snap.errors)) console.error(`  failed: ${key.slice(0, 100)}: ${err}`);
// Fail the job only if nothing resolved, so one bad list doesn't stop the rest being published.
if (failed && !Object.keys(snap.searches).length && !Object.keys(snap.lists).length) process.exitCode = 1;
