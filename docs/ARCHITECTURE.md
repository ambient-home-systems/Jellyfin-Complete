# Architecture (proposed)

Everything here is a proposal for approval. Each design choice links to its ADR in [DECISIONS.md](DECISIONS.md).

## 1. Shape

The app is one Node process in one Docker image, with one SQLite file in `/config`.

```
┌──────────────────────────────── maverick-jellyfin-complete (Node 22, Hono, port 8097) ────────────────────────────────┐
│  web/        Hono routes → server-rendered HTML (+HTMX). Admin sign-in via Jellyfin.                             │
│  jobs/       in-process scheduler (croner, TZ America/New_York): window check, nightly refresh, cache refresh    │
│  pipeline/   index → resolve → match → plan → route → apply   (pure core, side effects at the edges)              │
│  sources/    adapters: jellyfin-query · tmdb-* · mdblist · letterboxd · imdb-list · imdb-search · plex (P2)       │
│  imdb/       fetch-only resolver (no Node APIs) — also runs in a GitHub Action for the snapshot route              │
│  clients/    jellyfin (types from the live OpenAPI spec) · tmdb · radarr · sonarr · plex                          │
│  presets/    seasonal (19, ported from Kometa v2.5.3) · show franchise (27) · universe (17)                       │
│  db/         Drizzle schema + migrations (better-sqlite3, WAL)                                                    │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
          │ HTTP (LAN)                     │ HTTPS                         │ HTTP (LAN)
   Jellyfin :8096                  IMDb · TMDb · MDBList · Letterboxd     Radarr · Sonarr · Plex :32400
```

Repository layout:

- `src/` holds the app.
- `src/imdb/` must not import `node:*`, so the same file runs in the app, in a GitHub Action and in a Worker.
- `test/` holds Vitest suites and recorded fixtures.
- `spikes/` holds the Phase 0 scripts and is not shipped.

## 2. Data model (SQLite)

| Table | Purpose | Key columns |
|---|---|---|
| `setting` | Global settings, modes and guardrails | `key`, `value_json` |
| `secret` | API keys, encrypted with a key file in `/config` | `name`, `ciphertext`, `last4` |
| `library_item` | Index of movies, series and episodes in every Movies/TV library | `jf_id` PK, `kind`, `library_id`, `name`, `year`, `imdb`, `tmdb`, `tvdb`, `series_jf_id`, `season`, `episode`, `official_rating`, `genres`, `tags`, `date_added`, `seen_at` |
| `tmdb_cache` | One `/movie` or `/tv` call per owned title with `append_to_response=keywords,external_ids,watch/providers`, plus `/find` results | `kind`, `id`, `payload_json`, `fetched_at`, `ttl_days` |
| `definition` | A collection definition | `id`, `slug`, `name`, `target` (movies\|shows\|both\|episodes), `enabled`, `preset_key`, `preset_rev`, `window_json`, `filters_json`, `min_items`, `sync_mode`, `sort_by`, `sort_title`, `overview`, `poster_json`, `visibility` |
| `definition_source` | Sources of a definition | `definition_id`, `type`, `config_json`, `role` (add\|suggest), `position` |
| `definition_mode` | Per-collection mode overrides | `definition_id`, `action_type`, `mode` |
| `definition_arr` | Per-collection Radarr/Sonarr overrides | `definition_id`, `app`, `options_json` |
| `pin` | Manual pins and excludes | `definition_id`, `jf_id`, `kind` (pin\|exclude) |
| `source_result` | Cached builder output, with the last good result kept | `source_hash` PK, `status`, `error`, `fetched_at`, `items_json`, `last_good_at`, `last_good_items_json` |
| `managed_collection` | Ownership | `definition_id`, `jf_boxset_id`, `origin` (created\|adopted), `state` (live\|absent), `saved_meta_json` (sort title, overview, poster hash, locked fields) |
| `membership` | Current members with provenance | `definition_id`, `jf_id`, `provenance_json` (sources + ranks + match method), `since`, `action_id` |
| `run` | Job runs | `id`, `job`, `started_at`, `finished_at`, `status`, `stats_json`, `log` |
| `action` | Every planned, proposed or applied action | `id`, `run_id`, `type`, `fingerprint`, `definition_id`, `target_json`, `item_json`, `payload_json`, `mode`, `reason`, `status` (proposed\|approved\|applied\|dismissed\|snoozed\|failed\|superseded), `apply_at` (for upcoming windows), `before_json`, `after_json`, `undo_of`, `decided_by` (Jellyfin user), timestamps |
| `decision` | Remembered dismissals and snoozes | `fingerprint` PK, `kind` (dismiss\|snooze), `until`, `created_at` |
| `job_schedule` | Cron per job | `job`, `cron`, `enabled`, `last_run_at` |
| `imdb_hash` | Kometa hash files | `name`, `value`, `last_good`, `checked_at`, `error` |

**Fingerprint** = `sha1(action_type | definition slug | target | item ref)`. The item ref is an IMDb, TMDb or TVDB ID, or `series+SxxEyy`. It is stable across runs, so a dismissal or snooze keeps matching the same proposal night after night (ADR-006).

## 3. Plan → review → apply

```
 index ──► resolve sources ──► match ──► desired state ──► diff vs Jellyfin ──► route by mode ──► apply / queue
 (Jellyfin   (adapters; cache;   (ProviderIds;  (window open?   (managed box sets   (Off / Review /    (executors log
  + TMDb)     last good kept)     /find)         filters, pins,  only)               Auto + dry run +    before/after;
                                                 min items)                          guardrails)          undo)
```

1. **Index.**
   - Page through `/Items` per library with `Fields=ProviderIds,Tags,…` and `CollapseBoxSetItems=false`. The API has no provider-ID filter, so the index is local.
   - Upsert into `library_item`.
   - Fill gaps in `tmdb_cache` (TTL 30 days).
2. **Resolve.**
   - Each source adapter returns `SourceItem[]` (`imdb?`, `tmdb?`, `tvdb?`, `type`, `rank`, `title?`, `year?`, episode refs).
   - Results are cached for one day, matching Kometa's `cache_builders: 1`.
   - **On failure the adapter returns the last good result, marked `stale`, and the error shows on the Dashboard.** If there is no last good result, the source is `failed` (§5).
3. **Match.** Matching is by ProviderIds only; never by title (ADR-018):
   - movies/shows: IMDb → `library_item.imdb`, then TMDb, then TVDB
   - an unmatched IMDb ID goes through TMDb `/find` (cached)
   - episodes: episode IMDb ID, else `/find` → `tv_episode_results` (show, season, episode) → `series.tmdb` + S/E, else TVDB + S/E
4. **Desired state**, per definition:
   - `open` = window evaluation (§6).
   - `members` = (union of `role=add` sources) − excludes − filter failures + pins.
   - `exists` = `open && members ≥ min_items`.
   - Desired metadata: name, sort title, overview, poster, display order.
   - `role=suggest` sources produce candidates, never members.
   - A window opening within the **pre-review lead time** (default 14 days) is planned ahead, with each action's `apply_at` set to the opening. You review early and the executors apply at the flip.
5. **Diff** against the managed box set:
   - `collection.create` / `delete`
   - `add_items` / `remove_items` (only under `sync`; `append` never removes)
   - `update_metadata`
   - `radarr.*` / `sonarr.*` for unowned source items (Phase 2)
6. **Route.** For each candidate action:

   | Step | Result |
   |---|---|
   | Global mode, then per-collection override | Off → drop |
   | Fingerprint dismissed, or snoozed and not expired | Drop |
   | Dry run on | Review |
   | `radarr`/`sonarr` adds | Guardrails (cap, released, already present, exclusion list); past the cap → Review |
   | Otherwise | Auto → apply now; Review → `action.status = proposed` |

7. **Apply.**
   - Executors run in a fixed order: create, metadata, add, remove, delete, then *arr adds.
   - Each re-reads the live state first. If the state drifted, the action is marked `superseded` and the next run re-plans it.
   - Each records `before_json` and `after_json`.
   - Membership, metadata, create and delete can be undone: undo creates the inverse action and runs it through the same executors. *arr adds are not undone automatically.
8. **Review.** Approving a proposal runs its executor immediately with the same drift check. Dismissing writes a `decision` row. Snoozing writes one with an expiry: a duration, or "until the window opens". Both can be reversed.

## 4. Source adapters and caching

| Adapter | Fetch | Cache key | Notes |
|---|---|---|---|
| `jellyfin_query` | local `library_item` (tags, genres, studios/networks) | none (local) | For shows, "studio" means network. |
| `tmdb_collection` · `tmdb_movie` · `tmdb_show` · `tmdb_keyword` · `tmdb_list` | TMDb v3 | type + ids | Rate-limited to about 35 requests per 10 s. |
| `mdblist_list` | public `…/json`, or the API with a key | URL | Mediatype → movie/show. |
| `letterboxd_list` | list pages → film pages → IMDb/TMDb links | URL | Cloudflare-challenged from the cloud; see ADR-023. |
| `imdb_list` | GraphQL `TitleListMainPage` | `ls…` | 100 per page, cursor paging. |
| `imdb_search` | GraphQL `AdvancedTitleSearch`, **or** Kometa's hosted service, **or** a snapshot file, **or** the TMDb keyword fallback (setting) | constraint hash | `list.any` uses `listConstraint` (ADR-012). Kometa's limit and popularity sort. |
| `plex_collection` (P2) | Plex `/library/collections/{id}/children?includeGuids=1` | collection id | Parity source and report. |

The IMDb resolver:

- reads `LIST_HASH` and `HASH` from `Kometa-Team/IMDb-Hash` on each run, keeping the last good value
- on `PERSISTED_QUERY_NOT_FOUND` sets a Dashboard alert and serves the stale result, never an empty one

## 5. Failure rules

These are hard rules, tested (ADR-008).

- **A failed source never removes anything.**
  - A source with no current result and no last good result makes the whole definition `blocked`.
  - A blocked definition gets no `remove_items` and no `delete` this run; adds from healthy sources still go ahead.
- **A stale source counts as its last good result.** It is listed on the Dashboard as "served from cache" with its age.
- **The Jellyfin index must be complete.** If indexing fails, the run plans nothing, because a partial index would look like missing items.
- **Ownership.**
  - Executors refuse to act on a box set that isn't in `managed_collection`.
  - Managed box sets are tagged `managed:maverick-collections`.
  - A box set tagged `Jellyfin-Auto-Collections` is never adopted automatically.

## 6. Windows and the scheduler

- **Windows.** A window is an inclusive `MM/DD–MM/DD` range evaluated against the local date in America/New_York.
  - If `to < from`, it wraps past New Year.
  - `02/29` clamps to `02/28` in non-leap years.
  - Optional relative rules: nth weekday of a month, or Easter ± n days, with lead and lag days.
  - Pure functions, fully unit-tested (ADR-015).
- **Jobs.** Croner runs them in process with `timezone: 'America/New_York'`. Crons are stored in `job_schedule` and editable in Settings.

  | Job | Default | What it does |
  |---|---|---|
  | `window-check` | `0 0 * * *` and **at startup** | Re-plans only definitions whose `open` state changed since the last check; cheap. |
  | `nightly-refresh` | `30 2 * * *` | Index, resolve all sources, full plan. Finishes before Jellyfin-Auto-Collections (04:00) and Kometa (05:00). |
  | `tmdb-cache` | `10 3 * * 0` | Re-fetch expired TMDb entries. |

- **Run lock.** One run at a time, enforced by a lock row in `run`. "Run now" queues if a run is already going. Progress streams to the browser with HTMX polling (every 1 s) of `/runs/:id/progress`.
- **Catch-up.** At startup, if `window-check` hasn't run since the last local midnight, it runs immediately. That covers a container that was down at midnight.

## 7. Walkthrough: Christmas Movies opens and closes

Example settings: dry run **off**; global modes create/delete = Auto, add = Auto, remove = Review, metadata = Auto; Christmas Movies overrides add = Review. **Pre-review lead time:** 14 days (a setting). The planner plans upcoming windows that far ahead, so you can review before a window opens.

**Tue 17 Nov, 02:30, nightly refresh.**

- Christmas opens in 14 days, so the planner includes it with `apply_at = Tue 1 Dec 00:00`.
- MDBList `christmas-extravaganza` resolves 641 titles, of which you own 42 (server spike, 2 Nov).
- Planned actions, all scheduled for the opening:
  - `collection.create`, Auto
  - `collection.update_metadata`, Auto
  - 42 × `collection.add_items`, Review per the override, so they enter the queue as proposals marked "applies when it opens"
- The Dashboard's "Next change" panel shows the opening, and Review shows the group under "Christmas Movies · opens Tue 1 Dec 00:00".

**Sat 21 Nov, your weekly session.**

- You approve 40 and dismiss 2. Approved actions move to `approved`, waiting for `apply_at`.
- The dismissals are remembered by fingerprint, so they don't come back.

**Through to 30 Nov.** Nightly refreshes add proposals for newly owned list titles (14 waiting on the mockup's Dashboard). Titles that leave the list drop out of the plan; nothing exists in Jellyfin yet to remove.

**Tue 1 Dec, 00:00, window check.**

1. `open` changes to true.
2. The executors run in order:
   - **create** the box set "Christmas Movies"
   - **metadata:**
     - ForcedSortName `!00_Christmas Movies`
     - Kometa's overview text
     - poster from Default-Images, uploaded as base64
     - `DisplayOrder: SortName`
     - `LockedFields [Name, Overview, Tags]`
     - tag `managed:maverick-collections`
   - **add** the approved items
3. Before creating, the executor checks that approved members ≥ `min_items` (1 for Kometa presets). Below that, the create waits for the next approval or run, so an empty box set never appears.
4. Unreviewed adds stay in the queue and apply as soon as you approve them, because the window is now open.
5. Every executor records `before` and `after`. `managed_collection.state` becomes `live`.

**Tue 1 Dec, 00:00, same run.** Thanksgiving Movies and Veteran's Day Movies close (11/30 inclusive). `collection.delete` (Auto) first saves sort title, overview and poster hash to `saved_meta_json`, then calls `DELETE /Items/{id}`. Their linked movies are untouched; `spikes/06` checks this.

**Through December.**

- New owned list titles become add proposals.
- Titles that leave the list become `remove_items` proposals, because remove is set to Review. These are created only while the MDBList source is healthy.
- An MDBList 429 (rate limit) means the source serves from cache and nothing is removed.
- Membership rows record provenance, for example `MDBList #528 · IMDb tt0099785 = ProviderIds.Imdb`, and the editor's live preview shows it.

**Fri 1 Jan 2027, 00:00, window check.**

- `open` changes to false, so `collection.delete` (Auto) runs and `saved_meta_json` keeps the metadata.
- On 17 Nov 2027 the cycle repeats. On 1 Dec 2027 the create step restores that metadata, so the collection comes back looking the same.

If you later pick tag-gate visibility (ADR-010), "close" means adding the gate tag instead of deleting, and "open" means removing it. Membership and posters then persist all year.

## 8. Security and secrets

- **Sign-in.** `POST /Users/AuthenticateByName` with your Jellyfin credentials; only `Policy.IsAdministrator` users are allowed. The session cookie is HttpOnly and SameSite=Strict, and contains a random ID only.
- **API keys.** Stored encrypted (AES-256-GCM, key file `/config/secret.key`, created on first boot). The UI shows only the last 4 characters and offers Replace, never Reveal.
- **Logging.** The logger redacts every secret value before writing to the run log or stdout.
- **Development.** Keys go in a gitignored `.env`; `.env.example` lists the names only.
- **Public installs (ADR-031, Phase 4):**
  - rate-limited sign-in
  - a strict Content-Security-Policy
  - guidance for running behind a reverse proxy with HTTPS when exposed beyond a LAN
