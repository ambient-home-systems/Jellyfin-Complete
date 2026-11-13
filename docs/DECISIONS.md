# Decisions

Each entry is a short ADR: context, options, recommendation, consequences.

- You approved the Phase 0 package and the Phase 1 plan on 2 Nov, so every ADR below is **Accepted** unless it says **Decided** (a choice you made between options).
- Accepted ADRs can still be revisited; a change gets a new entry or an amendment note.
- Evidence lives in [VERIFIED.md](VERIFIED.md); the walkthrough is in [ARCHITECTURE.md](ARCHITECTURE.md) §7.

| # | Decision | Status |
|---|---|---|
| 001 | TypeScript strict, Node 22 LTS, Hono, better-sqlite3 (WAL) + Drizzle | Accepted |
| 002 | Server-rendered HTML + HTMX, no SPA | Accepted |
| 003 | In-process scheduler (croner), crons in DB, configured timezone | Accepted |
| 004 | Sign-in with Jellyfin admin credentials | Accepted |
| 005 | One image, `/config` volume, port 8097, healthcheck, Portainer stack | Accepted |
| 006 | Plan → review → apply with stable action fingerprints; pre-review lead time 14 days | Accepted (lead time confirmed) |
| 007 | Modes Off/Review/Auto, dry run on at first boot, guardrail defaults | Accepted (removals = Review confirmed) |
| 008 | Source failure keeps the last good result; never removes | Accepted |
| 009 | Ownership and the JAC seasonal sets | **Decided** (2 Nov): hand over 7 lines at go-live |
| 010 | Visibility: create-and-delete default; tag-gate available (verified) | **Decided** (2 Nov): keep delete |
| 011 | IMDb search route default: direct GraphQL | Accepted (verified from the server) |
| 012 | `list.any` = one `AdvancedTitleSearch`, not a union of lists | Accepted (corrects brief) |
| 013 | Read Kometa's hash files; cache last good; alert on `PERSISTED_QUERY_NOT_FOUND` | Accepted |
| 014 | Seasonal presets: exact port of Kometa v2.5.3 | Accepted (sort title verified; runtime posters confirmed) |
| 015 | Window semantics | Accepted |
| 016 | Seasonal presets: every movie library by default; minimum 1 item | **Decided** (2 Nov) |
| 017 | Holiday episodes: box set container (verified), scoped IMDb episode search | Accepted |
| 018 | Matching by ProviderIds; TMDb `/find` fallback; episode rules | Accepted |
| 019 | Jellyfin write rules | Accepted (verified on 12.4) |
| 020 | Library index + TMDb enrichment cache | Accepted |
| 021 | Default schedules | Accepted |
| 022 | Secrets handling | Accepted |
| 023 | Letterboxd: plain fetch + cached ID resolution | Accepted (reachable from the server) |
| 024 | Plex as a source (Phase 2) | Accepted |
| 025 | Home-screen rows via Collection Sections (Phase 3) | Accepted (amended 3 Nov) |
| 026 | Design direction: Timetable | **Decided** (you chose it, 2 Nov) |
| 027 | Radarr/Sonarr integration rules | Accepted |
| 028 | Repository layout | Accepted |
| 029 | Testing strategy | Accepted |
| 030 | Jellyfin client from the live 12.4.0 spec | Accepted |
| 031 | Public release: what changes now and what waits | Accepted (2 Nov) |
| 032 | Claude access through MCP, on the home network | **Decided** (13 Nov) |

---

### ADR-001 Stack: Accepted
- **Context.** The brief proposes TypeScript strict, Node LTS, Hono, SQLite with better-sqlite3 (WAL) and Drizzle. It's a single-user LAN app, and the IMDb resolver must also run in a GitHub Action or Worker.
- **Options.**
  - (a) As proposed.
  - (b) Python, like Kometa and JAC.
  - (c) Go.
- **Recommendation.** (a), on Node 22 LTS. Hono runs on Node and Workers alike; better-sqlite3 is synchronous and fast for one writer; Drizzle gives typed migrations.
- **Consequences.**
  - The resolver can be shared with a Worker or Action as-is.
  - The native module (better-sqlite3) needs build tools in the image's build stage.

### ADR-002 UI: server-rendered + HTMX: Accepted
- **Context.** The mockups are forms, tables, tabs, filters and a live preview. Nothing needs client-side routing or shared client state.
- **Options.**
  - (a) Hono JSX templates + HTMX.
  - (b) A React SPA plus a JSON API.
- **Recommendation.** (a). These need small vanilla-JS islands (no framework):
  - theme toggle
  - select-all checkboxes
  - run progress polling (HTMX `hx-trigger="every 1s"`)

  Live preview is an HTMX `hx-post` on form change, debounced at 400 ms.
- **Consequences.**
  - One rendering path and no build tooling for the UI.
  - If the editor later needs drag-to-reorder sources, add one small script; no switch to a SPA.

### ADR-003 Scheduler: Accepted
- **Context.** The jobs are window flips at local midnight, a nightly refresh and cache upkeep. Crons must be editable in the UI.
- **Options.**
  - (a) croner in-process, with crons in `job_schedule`.
  - (b) host cron calling an endpoint.
  - (c) a Portainer-scheduled container.
- **Recommendation.** (a): a configured timezone, a run lock in the DB, and catch-up at startup (ARCHITECTURE §6).
- **Consequences.**
  - If the container is down at midnight, the flip happens at the next start.
  - The Docker healthcheck surfaces a stuck scheduler.

### ADR-004 Sign-in: Accepted
- **Context.** Admin-only, single user (you).
- **Recommendation.**
  - Sign in through `POST /Users/AuthenticateByName` and require `Policy.IsAdministrator`.
  - Use a server-side session with an HttpOnly, SameSite=Strict cookie.
  - Server-to-server calls use the stored Jellyfin API key, not the user's token.
- **Consequences.**
  - No separate password to manage.
  - If Jellyfin is down, you can't sign in. Accepted, because the app can't do anything useful without Jellyfin anyway.

### ADR-005 Packaging and runtime: Accepted
- **Recommendation.**
  - **Image.** One image based on `node:22-bookworm-slim`. Runs as non-root (UID/GID configurable), with `/config` holding the SQLite DB, secret key and logs.
  - **Runtime.** Port 8097, `TZ` seeding the timezone setting, and a `HEALTHCHECK` on `GET /healthz` (DB writable, scheduler heartbeat under 2 min old).
  - **Deploy.** A Docker Compose / Portainer stack file on a network that can reach the Jellyfin server.
- **Consequences.** Runs like most home-server services. No reverse proxy needed on a LAN; see [REVERSE-PROXY.md](REVERSE-PROXY.md) for anything wider.

### ADR-006 Plan → review → apply: Accepted
- **Context.** Nothing outside the app's DB changes except through the pipeline. Dismissals must stick across nightly runs.
- **Recommendation.**
  - Every candidate action gets a fingerprint: `sha1(type|definition|target|item ref)`. Dismissals and snoozes key on it.
  - Approval re-checks live state, and drifted actions become `superseded`.
  - Windows opening within **14 days** are planned ahead with `apply_at`, so you can review in your weekly session before the flip.
  - Executors apply in a fixed order and record before and after.
  - Membership, metadata, create and delete changes can be undone. *arr adds cannot.
- **Consequences.**
  - Review volume is front-loaded the week before a holiday.
  - Approved-but-unapplied actions are visible as "waiting for 1 Dec".

### ADR-007 Modes, dry run, guardrails: Accepted
- **Recommendation.**
  - **Global defaults:**

    | Action | Default |
    |---|---|
    | create/delete | Auto |
    | add items | Auto |
    | remove items | **Review** |
    | metadata | Auto |
    | `radarr.add_movie` | Review |
    | `radarr.monitor_collection` | Review |
    | `sonarr.add_series` | Review |

  - **Dry run** is on at first boot and forces Review everywhere. Approving still applies.
  - **Guardrails:**
    - cap of **10** Radarr+Sonarr adds per run
    - released only (Radarr `status==='released'` or a digital/physical release date in the past; Sonarr `status!=='upcoming'` and `firstAired ≤ now`)
    - already-present and exclusion-list checks, always on and not optional
    - overflow goes to Review
- **Consequences.**
  - Removals stay human-approved until you trust the sources.
  - The cap is shown as a running total, e.g. "7 / 10".

### ADR-008 Source failure policy: Accepted
- **Rule.**
  - A failed source serves its last good result, marked stale with its age on the Dashboard.
  - With no last good result, the definition is *blocked* for removals and deletes in that run.
  - An incomplete Jellyfin index blocks the whole run.
  - The IMDb hash error `PERSISTED_QUERY_NOT_FOUND` counts as a source failure.
- **Consequences.** A collection can carry stale members for a while. That's the intended trade: never empty on a bad night.

### ADR-009 Ownership and the JAC seasonal sets: Decided (2 Nov, option a)
- **Context.** The development server already ran Jellyfin-Auto-Collections (JAC). Seven of its list entries built seasonal box sets that this app now owns:
  - Christmas, from Kometa's MDBList list plus a Jellyfin tag query
  - Halloween, Thanksgiving, Valentine's Day, Easter and New Year's, from Jellyfin tag queries

  An older JAC config without `list_name` also left **orphan** box sets, named like `{'includeItemTypes': 'Movie', 'tags': '…'}`. Nothing updates them, and JAC never deletes anything.

  JAC finds sets by its tag, then by exact name, and rewrites them every run, so two tools can't share them.
- **Recommendation (option a): hand over at go-live.**
  - Remove the overlapping entries from JAC's config and restart JAC. Its other lists keep working.
  - **Existing box sets** then lists the old sets:
    - **Adopt** sets whose window is open. JAC's tags are removed and the app takes ownership. Members that aren't in Kometa's sources become removal proposals in Review.
    - **Delete** out-of-window sets and orphans, through Review.
  - **JAC's tag queries can live on as suggestions.** Each one maps to a `role=suggest` Jellyfin-tag source on the matching preset, so JAC's broader matches become Review proposals instead of disappearing.
- **Also overlapping.** The universe presets **Marvel Cinematic Universe** and **DC Extended Universe** share names, and DCEU shares its MDBList list, with sets JAC users commonly have. All universe presets start **disabled**, and adoption only matches collections that are turned on.
- **General ownership rules (unchanged).**
  - Managed box set IDs are tracked in `managed_collection`, and each set is tagged `managed:maverick-collections`.
  - Executors refuse anything not tracked.
  - JAC-tagged sets are never adopted automatically.
- **Consequences.**
  - The handover is a small edit to the other tool's config at go-live, plus a restart.
  - Jellyfin's own automatic TMDb collections are untouched.

### ADR-010 Visibility strategy: Decided (2 Nov): delete-and-recreate default
- **Context.** Kometa uses `delete_not_scheduled: true`, i.e. create-and-delete. **`spikes/06` verified tag-gating on 12.4.** With a box set's tag in a user's `BlockedTags`, the set is no longer listed and a direct fetch returns 404, but its films and episodes stay visible, and the app's API key can still read and edit it. It applies per user, admins included.
- **Options.**
  - (a) Create-and-delete, restoring metadata from the DB.
  - (b) Tag-gate: a blocked tag on every user except the app's.
  - (c) Always visible.
- **Recommendation.**
  - Keep (a) as the default, as the brief asked, to match Kometa.
  - (b) is now a per-collection option in the editor.
  - Switching the default to (b) is a reasonable choice for your server: one write at each window change instead of create, metadata, poster and adds, and a stable box set ID for Phase 3 home-screen rows. It's your call (open question 2).
- **Consequences.**
  - Your server has **one user, the admin**, so a gated set is hidden from everyone using that account. That's equivalent to deleting it, but membership, poster and the box set ID survive between seasons.
  - That makes (b) more attractive than it looked, especially for Phase 3 home-screen rows, which match by name or ID.
  - (b) needs a job that adds the gate tag to every user's `BlockedTags`, including your admin account and any new user.
  - Because `POST /Users/{id}/Policy` replaces the whole policy, the job must always GET, modify, then POST, the same rule as ADR-019.
  - If the tag is ever removed from your policy, every hidden seasonal set reappears at once. The Dashboard would flag that.

### ADR-011 IMDb search route default: Accepted
- **Context.** Four routes per the brief. Measured 2 Nov: direct GraphQL and Kometa's service returned the **same 500 IDs** for the Thanksgiving search, and the direct call answered from the cloud with no challenge.
- **Options.**
  1. Direct `AdvancedTitleSearch`.
  2. Kometa hosted service.
  3. TMDb keyword fallback.
  4. Private daily snapshot (GitHub Actions in a private repo; preferred over a Cloudflare Worker).
- **Recommendation.**
  - **Route 1 as default.** It is the same query and hash Kometa's service uses, with no dependency on infrastructure built for Kometa.
  - Route 2 is a setting, for exact parity checks only.
  - Route 4 is the fallback if IMDb starts refusing your server; the shared resolver makes it a config switch.
  - Route 3 is the last resort, labelled "results differ from Plex".
- **Consequences.**
  - If IMDb changes the persisted query, Kometa's hash repo is the early warning (ADR-013).
  - Route 1 is **confirmed from your server**: `spikes/04` returned the same results in 3.4 s.

### ADR-012 `list.any` semantics: Accepted (corrects the brief)
- **Context.** The brief says "`list.any` is the union of the individual list fetches". Kometa 2.5.3 instead sends `listConstraint.inAnyList` to `AdvancedTitleSearch` through its service, sorted by popularity ascending, with `limit: 500`. Four presets go over 500:

  | Preset | Titles across its lists |
  |---|---|
  | Valentine's Day | 634 |
  | Memorial Day | 556 |
  | Veteran's Day | 566 |
  | LGBTQ+ Pride | 560 |

  For those four, a union wouldn't match Plex.
- **Recommendation.**
  - Implement `imdb_search list.any` as one `AdvancedTitleSearch` with `listConstraint`, exactly like Kometa.
  - Use `TitleListMainPage` for plain `imdb_list` sources, for example the universe presets.
- **Consequences.** Parity with Plex for all 19 presets.

### ADR-013 IMDb hashes: Accepted
- **Recommendation.**
  - Fetch `LIST_HASH` and `HASH` from `Kometa-Team/IMDb-Hash` each run.
  - Keep the last good values in `imdb_hash`.
  - On `PERSISTED_QUERY_NOT_FOUND`, retry once with a fresh fetch, then mark the IMDb sources failed (serve last good results) and raise a Dashboard alert.
- **Consequences.** The app depends on Kometa's community keeping the hash files current, the same as Kometa does.

### ADR-014 Seasonal preset port: Accepted
- **Context.** `defaults/movie/seasonal.yml` is identical in 2.5.3 and 2.5.4. It is ported to `spikes/seasonal-presets.json`, which becomes the golden test fixture.
- **Recommendation.** Port every field:
  - all 19 keys and names, in the form "<key_name> Movies"
  - windows
  - sources and limits
  - `sync_mode: sync`, `sort_by: title.asc` → `DisplayOrder: SortName`
  - `cache_builders: 1`
  - `delete_not_scheduled`
  - summary "A collection of <name> movies that may relate to the season."
  - **sort title `!00_<name>`**, from `templates.yml` `shared`: `sort_prefix` "!" + `collection_section` "00" + "_" + title. **Confirmed in your Plex:** `!00_Thanksgiving Movies`, `!00_Veteran's Day Movies`.
  - posters from `Default-Images/seasonal/<key>.jpg`, **fetched at runtime rather than bundled**, because the repository has no licence file
  - `delete_collections_named`, the old emoji names, offered as adoption candidates
- **Consequences.**
  - A preset carries `preset_rev`, so future Kometa changes show as a diff to accept.
  - The Presets table flags local edits.

### ADR-015 Window semantics: Accepted
- **Recommendation.**
  - `range(MM/DD-MM/DD)` is inclusive at both ends and evaluated on the local date in the configured timezone.
  - A window wraps when `to < from`.
  - `02/29` clamps to `02/28` in non-leap years.
  - Evaluated at 00:00 and at startup.
  - Optional relative rules: nth weekday of a month (`4th Thu Nov`), or Easter ± n days, plus lead and lag days.
- **Consequences.**
  - "Opens" and "closes" times show as 00:00 in the timetable.
  - Unit tests cover year wrap, Feb 29 and DST weeks.

### ADR-016 Seasonal targets and libraries: Accepted
- **Context.**
  - Kometa's seasonal file is movies-only, and Kometa runs per Plex library. Many servers keep more than one movie library, for example a separate one for animation.
  - A Jellyfin box set is not tied to a library, so it can mix items from several.
  - The sources also list TV series, but few of them are usually owned.
- **Decision (2 Nov).**
  - Seasonal presets match films in **every movie library by default**. Which libraries is a setting (Settings → Libraries), not code.
  - Keep Kometa's **minimum of 1 item**. A small library gets single-film collections, and a preset with nothing owned isn't created.
  - Seasonal "Shows" sets are not built. Holiday episodes cover TV instead (ADR-017).
- **Consequences.**
  - The Jellyfin collections can hold more items than Kometa's Plex collections, when more libraries are included than Kometa runs on.
  - The Plex parity report lists those differences.

### ADR-017 Holiday episodes: Accepted (Phase 2)
- **Context.** **Box sets accept episodes, verified by `spikes/06`** (a test box set held 2 films and 1 episode). An unscoped IMDb episode keyword search is huge (16,819 Christmas episodes). Scoped to owned series, it's small (58 across 5 sample series).
- **Recommendation.**
  - **Container:** one box set per holiday, e.g. "Christmas Episodes", spanning every TV library. A public playlist also works (verified), but isn't needed.
  - **Measured 2 Nov** on the development server (about 50 owned series):

    | Holiday | Owned by IMDb episode ID | Title suggestions |
    |---|---:|---:|
    | Christmas | 30 | 12 |
    | Halloween | 20 | 2 |
    | Thanksgiving | 6 | 3 |
  - **Sources:**
    - IMDb `AdvancedTitleSearch` with `tvEpisode` + keyword + `episodicConstraint.anySeriesIds`, using owned series in batches of 50
    - episode-title matches as `role=suggest` (Review only)
  - **Windows:** the same as the matching movie preset.
  - **Matching:** see ADR-018.
- **Consequences.** IMDb keyword relevance is loose (sitcom episodes tagged "christmas" that aren't holiday episodes, for example), so episodes default to Review.

### ADR-018 Matching: Accepted
- **Rule.** Never by title. In order:
  1. IMDb ID against `ProviderIds.Imdb`
  2. TMDb ID (from the source, or `/find/{imdb}?external_source=imdb_id`, cached)
  3. TVDB ID
- **Episodes:**
  1. episode IMDb ID
  2. `/find` → `tv_episode_results` (show TMDb ID, season, episode) → series by TMDb + S/E
  3. series TVDB + S/E
- **Consequences.** Every match records its method, shown as provenance chips.

### ADR-019 Jellyfin write rules: Accepted
- **Rules.**
  - GET, then modify, then POST the **full** DTO.
  - Echo back `LockData` unchanged. **Never set it on a box set**, because it propagates to every linked item.
  - Lock with `LockedFields: [Name, Overview, Tags]`.
  - Re-assert `ForcedSortName` every run, since it can't be locked. 12.4 normalises it (`!00_X` becomes `!0000000000_x`), and `!` still sorts first.
  - Set `DisplayOrder` from the sort setting.
  - Upload posters as base64 text with `Content-Type: image/jpeg`. Verified: 204, and the image is present.
  - Rate-limit to 5 concurrent requests.
  - Always pass `CollapseBoxSetItems=false` when indexing.
- **Consequences.** These are written down in ARCHITECTURE and enforced in the client wrapper, so no executor can skip them.

### ADR-020 Library index and TMDb cache: Accepted
- **Recommendation.**
  - Index every Movies and TV library:
    - nightly: an incremental pass by `DateLastSaved`
    - weekly: a full pass, which also catches deletions
  - TMDb enrichment: one `/movie/{id}` or `/tv/{id}` call per owned title with `append_to_response=keywords,external_ids,watch/providers`, kept for 30 days.
- **Consequences.**
  - The first full TMDb fill is about 800 calls for a library of roughly 750 films and 50 series, at ~35 per 10 s about 4 minutes. Later runs are quick.
  - 23 films have no provider IDs. They are listed in a "can't match" diagnostic so you can fix their metadata in Jellyfin.
  - Watch-provider data is ready for Phase 2's "available on" collections.

### ADR-021 Default schedules: Accepted
- **Recommendation.**

  | Job | When | Cron |
  |---|---|---|
  | Window check | 00:00 daily, plus at startup | `0 0 * * *` |
  | Nightly refresh | 02:30 | `30 2 * * *` |
  | TMDb cache | Sundays 03:10 | `10 3 * * 0` |

  The refresh finishes before JAC at 04:00 and Kometa at 05:00. The Settings strip shows all four apps' jobs together.
- **Consequences.** JAC also runs at its container start, so the app's executors re-read state before writing (ADR-006).

### ADR-022 Secrets: Accepted
- **Recommendation.**
  - Development: a gitignored `.env`.
  - Production: keys entered in Settings and stored AES-256-GCM encrypted, with the key file in `/config`. The UI shows only the last 4 characters.
  - A redacting logger is used everywhere; spike scripts redact output the same way.
- **Consequences.** Losing `/config/secret.key` means re-entering keys, nothing worse.

### ADR-023 Letterboxd: Accepted
- **Context.**
  - Letterboxd has no public API.
  - The cloud sandbox got a Cloudflare challenge, but **your server reaches it.** `spikes/05` found 100 films on page 1 of `mardarrius/list/black-is-beautiful` (it doesn't resolve them to IDs by default).
  - Kometa and JAC both use `letterboxdpy`, which impersonates a browser's TLS fingerprint.
  - Only Black History uses Letterboxd, and that preset also has an IMDb list.
- **Recommendation.**
  - **(a) Plain fetch:**
    - Read each list page (`/page/N/`).
    - Resolve each film page once for its IMDb and TMDb links, about 1 request a second.
    - Cache the film → ID mapping permanently, since IDs don't change. After the first resolve, a list refresh costs only the list pages.
  - If Letterboxd starts challenging the server, the source fails and keeps its last good result (ADR-008). The fallback is then an MDBList mirror of the list.
- **Consequences.**
  - The first Black History refresh is slow, a few minutes, then fast.
  - For public users (ADR-031), installs Cloudflare challenges get a clear error and the mirror option.

### ADR-024 Plex as a source: Accepted (Phase 2)
- **Recommendation.**
  - A read-only `plex_collection` source that reads items by GUID (IMDb or TMDb).
  - A parity report per collection: Plex count vs Jellyfin count, with the differences listed.
  - Baselines come from `spikes/03`.
- **Consequences.** Exact parity, for as long as Plex and Kometa keep running. Optional per collection.

### ADR-025 Home-screen rows: Accepted (Phase 3)
- **Context.** Home Screen Sections registers sections in-process. Its HTTP registration still needs an endpoint inside Jellyfin. IAmParadox27's **Collection Sections** plugin already shows "a row per box set", configured by box set name.
- **Options.**
  - (a) Drive Collection Sections through its plugin configuration API.
  - (b) Write our own companion plugin.
- **Recommendation.** Try (a) first; build (b) only if (a) can't keep rows in sync.
- **Consequences.**
  - Each row is capped at 16 items.
  - Rows are matched by name, so names must stay stable.
  - Its README says the feature is moving into Home Screen Sections for Jellyfin 12.
- **Amendment, 3 Nov (Phase 3, from both plugins' source).**
  - **Supported versions.** Collection Sections' main branch builds for Jellyfin 12.4 and Home Screen Sections' for 12.1. The plan to merge Collection Sections into Home Screen Sections hasn't shipped yet.
  - **Configuration.** Collection Sections is configured through Jellyfin's plugin API: `{ Sections: [{ UniqueId, DisplayText, CollectionName, SectionType }] }`. Saving registers each section with Home Screen Sections in-process.
  - **Registrations persist.** Removing a section only takes effect after a Jellyfin restart. So each collection keeps one permanent entry, `maverick-<slug>`.
  - **Startup cache.** Collection Sections caches each user's box sets at startup, so a deleted or hidden set can keep its row until a restart. Rows are therefore switched with Home Screen Sections' `SectionSettings[].Enabled` (users can't override), not by the set existing.
  - **Option (b) is ruled out as a quick win.** Home Screen Sections' HTTP `RegisterSection` only accepts a results endpoint on the Jellyfin server itself, so this app can't serve rows directly.
  - **Writes.** Only `maverick-` entries are touched, each config is read, changed and written back whole, and nothing is written in dry run (the Settings button is an explicit approval).

### ADR-026 Design direction: Timetable: Decided
- You chose it in the 2 Nov direction round, out of the assigned Timetable, a "repertory programme" pick and the category standard.
- **The system:**
  - **Four inks.**
    - paper and ink
    - timetable yellow, only for the next change and for selection
    - signal red, only for failures and the today hand
  - **Type:** Archivo (self-hosted, OFL) with tabular figures.
  - **Signature:** the upcoming-changes timetable.
- See `docs/mockups/` and `DESIGN.md`.

### ADR-027 Radarr and Sonarr integration rules: Accepted
- **Rules.**
  - Look up with `term=tmdb:` / `term=tvdb:`.
  - Exclusions:
    - Radarr: `/exclusions/paged`, plus the `isExcluded` flag on lookup results
    - Sonarr: `/importlistexclusion/paged`
  - Set `monitored` explicitly. Radarr's `monitor: none` doesn't unmonitor.
  - Never use `isAvailable` before adding.
  - Collections: monitor through `PUT /collection` (bulk, partial) and refresh with `POST /command {name: RefreshCollections}`. The command name is inferred; confirm it in `spikes/02`.
  - Dropdowns are always read live.
- **Consequences.** A Radarr collection appears only after one of its films is in the library. The Missing page explains that.

### ADR-028 Repository layout: Accepted
- **Recommendation.**
  - **One package.**
    - `src/` for the app
    - `src/imdb/` for the fetch-only resolver (lint rule: no `node:*` imports)
    - `snapshot/` for the optional GitHub Action entry point
  - **Docs and spikes:**
    - `docs/` holds the ADRs, architecture and mockups
    - `spikes/` holds Phase 0 scripts and isn't shipped
- **Consequences.** No monorepo tooling. The resolver can still be copied into a separate private repo for the snapshot route.

### ADR-029 Testing: Accepted
- **Recommendation.** Vitest covering:
  - window math
  - ProviderId and episode matching
  - plan diffing
  - mode routing and guardrails
  - the failure policy
  - golden tests: `seasonal.yml` → presets JSON
  - integration tests against a Jellyfin mock built from recorded, redacted fixtures from `spikes/out/`

  CI runs on GitHub Actions.
- **Consequences.** Fixtures can't be recorded until the read-only spikes have run on your server.

### ADR-030 Jellyfin client: Accepted
- **Recommendation.**
  - Generate types with `openapi-typescript` from **your** server's spec: Jellyfin **12.4.0**, saved by `spikes/01` on the server and committed as `spec/jellyfin-openapi.json` at the start of Phase 1.
  - Add a small hand-written wrapper that enforces ADR-019.
  - Target 10.10 and up, and check the version at startup.
- **Consequences.** A Jellyfin upgrade means regenerating the types and running the integration tests.

### ADR-031 Public release: Accepted (2 Nov)
- **Context.** You plan to offer the tool publicly if it works out. Other people would run their own copy against their own Jellyfin. That changes some assumptions behind Phase 0:
  - single admin
  - your libraries
  - New York time
  - Kometa and JAC as neighbours
  - Jellyfin 12.4 only
- **Recommendation.** Don't let public-readiness delay Christmas. Split it into **cheap now** and **later**.
  - **Phase 1 adds about 8 h, so nothing has to be undone later:**
    - Nothing specific to your server in code. Libraries, timezone, URLs, neighbour schedules, and which libraries presets use all live in settings, with your values as your config, not as defaults.
    - Approvals and undos record **who** did them (`action.decided_by`, shown in Activity). Other installs can have several admins, and your household may add Jellyfin users.
    - A licence and a `NOTICE` file crediting what's derived from other projects:
      - Kometa's preset definitions (Kometa is MIT-licensed)
      - Kometa's IMDb hash files
      - Kometa's default posters, fetched at runtime from Kometa's repo, never bundled
    - Kometa's hosted IMDb service stays **off by default**, an opt-in parity check, so public installs don't load infrastructure the Kometa team runs for Kometa users.
  - **New Phase 4, "Public release" (about 50 h, after Phase 2):**
    - first-run setup wizard: connections, library picker, timezone, dry run
    - Jellyfin 10.10/10.11/12.x compatibility, with a test matrix (sort-name and tag behaviour differ by version)
    - published Docker image (GHCR) with versioned releases and a changelog
    - security hardening for installs exposed beyond a LAN: rate-limited sign-in, CSP, reverse-proxy and HTTPS guidance
    - user docs and a public README
    - a courtesy note to the Kometa team about the hash repo and posters
    - choosing a public name; "Maverick Collections" is still a working name
- **Risks to know before going public.**
  - IMDb's GraphQL API isn't an official public API. Many installs calling it could draw blocks. The private-snapshot route (route 4) and last-good results soften this, but don't remove the risk.
  - Letterboxd's site terms. Kometa and JAC carry the same exposure.
- **Consequences.** About 8 h added to Phase 1, outside the Christmas slice. Public release becomes its own phase with its own approval.

### ADR-032 Claude access through MCP: Decided (13 Nov)
- **Context.** You want Claude to use the app for you: say what's coming up, what's waiting in Review and why a title is missing, and act on Review.
- **Decision.**
  - **An MCP endpoint at `/mcp`** (Streamable HTTP, stateless, JSON responses), using the official TypeScript SDK. MCP is how Claude Code and Claude Desktop call other apps' tools.
  - **For computers on your network only.** Claude Code connects directly. Claude Desktop connects through the `mcp-remote` bridge, which runs on that computer. The Claude app on the web or a phone would need the app reachable from the internet, with an OAuth sign-in. That isn't built.
  - **Access tokens made in Settings → Claude access.** A token is shown once. Only its SHA-256 hash and last four characters are stored, and revoking deletes it. Each token is either **Read only**, or **Read, review and run** (the default, chosen 13 Nov).
  - **Tools.**
    - Reading: status, collections, one collection with its titles, the Review queue, missing titles, activity, run details.
    - With a review token, also: approve, dismiss or snooze proposals, and start a run.
    - Never: settings, keys, connections, or editing and enabling collections.
  - **Approving through Claude is the Review button.** It is the same code path (`reviewVerdict`), so it applies straight away even in dry run. It is recorded as decided by "Claude (token name)". The tool and server descriptions tell Claude to show the change and get your go-ahead first.
  - **Hardening.**
    - Bearer tokens only (no cookies), so the endpoint needs no CSRF token.
    - Requests that carry another site's `Origin` are refused (DNS rebinding).
    - Ten wrong tokens from one address in 15 minutes lock that address out for 15 minutes.
    - `GET` and `DELETE` answer 405.
    - Tokens never appear in the log.
- **Consequences.**
  - A new dependency, `@modelcontextprotocol/sdk`.
  - A new table, `api_token` (migration 0003).
  - Anyone holding a review token can change your Jellyfin through Review. Treat a token like a password, and revoke it when a computer is no longer yours.

---

## Open questions

**Decided on 2 Nov:**

- Hand over JAC's 7 seasonal lines at go-live (ADR-009).
- Keep delete-and-recreate as the default (ADR-010).
- Seasonal presets use every movie library by default; minimum of 1 (ADR-016).
- Seasonal "Shows" sets off.
- 14-day pre-review lead time.
- Removals need review.
- Kometa posters fetched at runtime.
- `spikes/06` approved and run; all checks passed.
- The GitHub Actions and Worker IMDb tests are skipped.

**Resolved by the spikes:**

- Jellyfin 12.4.0.
- IMDb works from your server.
- Sort title is `!00_<name>`.
- Box sets hold episodes.
- The tag-gate works.
- Letterboxd is reachable from your server.

**Decided since:**

1. **Phase 0 approval.** The architecture, decisions and mockups were approved on 2 Nov, and Phase 1 started with the Christmas slice.
2. **Licence: MIT** (2 Nov), the same as Kometa.
3. **Christmas deadline.** The Christmas slice was finished on 2 Nov, and go-live is planned for 18–23 Nov. Phases 2–4 followed on 3 Nov (see [PHASE2.md](PHASE2.md) and [PHASE3.md](PHASE3.md)).

**Name** (4 Nov): Maverick Jellyfin Complete, published from `ambient-home-systems/Jellyfin-Complete`.
