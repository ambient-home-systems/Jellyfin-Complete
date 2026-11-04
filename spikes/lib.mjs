// Phase 0 spike helpers. Throwaway code, not the application. No dependencies: Node 20+ only.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const OUT = join(HERE, 'out');

/** Load KEY=VALUE pairs from the repo-root .env (or spikes/.env) without printing them. */
export function loadEnv() {
  for (const p of [join(HERE, '..', '.env'), join(HERE, '.env')]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  return process.env;
}

/** Every secret value in the environment, so output can be scrubbed before it is printed or saved. */
function secrets() {
  return Object.entries(process.env)
    .filter(([k, v]) => /KEY|TOKEN|PASSWORD|SECRET/.test(k) && v && v.length >= 6)
    .map(([, v]) => v);
}
export function redact(text) {
  let s = String(text);
  for (const v of secrets()) s = s.split(v).join('«redacted»');
  return s;
}

export async function http(url, { method = 'GET', headers = {}, body, timeout = 30000, raw = false } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method, signal: ctrl.signal,
      headers: { 'user-agent': 'maverick-jellyfin-complete-spike/0.1', ...(body && !raw ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { ok: res.ok, status: res.status, json, text, ms: Date.now() - started, headers: res.headers };
  } catch (e) {
    return { ok: false, status: 0, error: e.name === 'AbortError' ? 'timeout' : e.message, ms: Date.now() - started };
  } finally { clearTimeout(t); }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function save(name, data) {
  mkdirSync(OUT, { recursive: true });
  const p = join(OUT, name);
  writeFileSync(p, redact(typeof data === 'string' ? data : JSON.stringify(data, null, 2)));
  return p;
}

export function report(title, obj) {
  console.log(`\n=== ${title} ===`);
  console.log(redact(typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)));
}

export function need(...keys) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) { console.error(`Missing in .env: ${missing.join(', ')}`); process.exit(2); }
}

// ── Jellyfin ──
export function jf() {
  const base = process.env.JELLYFIN_URL.replace(/\/$/, '');
  const auth = { authorization: `MediaBrowser Client="maverick-spike", Device="spike", DeviceId="maverick-spike", Version="0.1", Token="${process.env.JELLYFIN_API_KEY}"` };
  const call = (path, opts = {}) => http(base + path, { ...opts, headers: { ...auth, ...(opts.headers || {}) } });
  return { base, call };
}

// ── IMDb (GraphQL persisted queries, the way Kometa 2.5.3 does it) ──
const HASH_BASE = 'https://raw.githubusercontent.com/Kometa-Team/IMDb-Hash/master/';
export async function imdbHashes() {
  const [list, search] = await Promise.all([http(HASH_BASE + 'LIST_HASH'), http(HASH_BASE + 'HASH')]);
  return { list: list.text?.trim(), search: search.text?.trim(), ok: list.ok && search.ok };
}
export async function imdbGql(operationName, sha256Hash, variables) {
  return http('https://api.graphql.imdb.com/', {
    method: 'POST', headers: { 'x-imdb-client-name': 'imdb-web-next' },
    body: { operationName, variables, extensions: { persistedQuery: { version: 1, sha256Hash } } },
  });
}
/** All IDs on an IMDb list (TitleListMainPage, 100 per page, cursor paging). */
export async function imdbList(hash, lsConst) {
  const ids = []; let after;
  for (;;) {
    const v = { locale: 'en-US', first: 100, lsConst, isInPace: false, sort: { by: 'LIST_ORDER', order: 'ASC' } };
    if (after) v.after = after;
    const r = await imdbGql('TitleListMainPage', hash, v);
    if (!r.ok || r.json?.errors) return { error: r.json?.errors?.[0]?.extensions?.code || r.status || r.error, ids };
    const s = r.json.data.list.titleListItemSearch;
    ids.push(...s.edges.map((e) => e.listItem.id));
    if (!s.pageInfo.hasNextPage || !s.edges.length) return { ids, total: s.total };
    after = s.pageInfo.endCursor; await sleep(250);
  }
}
/** AdvancedTitleSearch with Kometa's defaults (popularity asc, limit). Returns ids plus title details. */
export async function imdbSearch(hash, constraints, { limit = 500, sortBy = 'POPULARITY', sortOrder = 'ASC' } = {}) {
  const items = []; let after, total;
  while (items.length < limit) {
    const v = { locale: 'en-US', first: Math.min(250, limit - items.length), sortBy, sortOrder, ...constraints };
    if (after) v.after = after;
    const r = await imdbGql('AdvancedTitleSearch', hash, v);
    if (!r.ok || r.json?.errors) return { error: r.json?.errors?.[0]?.extensions?.code || r.json?.errors?.[0]?.message || r.status || r.error, items, total };
    const s = r.json.data.advancedTitleSearch; total = s.total;
    for (const e of s.edges) {
      const t = e.node.title;
      items.push({ id: t.id, type: t.titleType?.id, title: t.titleText?.text, year: t.releaseYear?.year, series: t.series?.series?.id });
    }
    if (!s.pageInfo.hasNextPage) break;
    after = s.pageInfo.endCursor; await sleep(250);
  }
  return { items: items.slice(0, limit), total };
}
