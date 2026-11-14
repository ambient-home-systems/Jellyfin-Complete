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
| 033 | Claude can change settings (Full control tokens) | **Decided** (13 Nov) |
| 034 | Full control means everything except connections, keys and tokens | **Decided** (13 Nov) |
| 035 | Film series: a collection per owned TMDb film series | **Decided** (13 Nov) |

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
  - posters from `Default-Images/seasonal/<key>.jpg`, **fetched at runtime rather than bundled**, because the repository has no licence file. Since 0.19.0 the app has its own (ADR-045).
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
  - Echo back `LockData` unchanged. **Never change it on an existing box set**, because a change propagates to every linked item. (ADR-040: box sets are now *created* locked, which doesn't lock their titles.)
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
- **Name mapping (0.16.0).** Kometa names some collections once per Plex library ("IMDb Top 250" in a films library and again in a TV library; "IMDb Popular", "IMDb Lowest Rated", "Newly Released", "New Episodes"), where this app names the films and shows versions apart ("IMDb Top 250 Movies"). The comparison now matches those by family and kind: Kometa's name in a library of the right type. Everything else matches by its own name or an older one (`plexCounterpart`).

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

### ADR-033 Claude can change settings: Decided (13 Nov)
- **Context.** You asked for Claude to change settings, not only read them. ADR-032 gave Claude no settings tools at all.
- **Decision.**
  - **Every token** can read the settings (`get_settings`). Connections show their address and whether a key is saved, never the key.
  - **A third access level, Full control.** It does everything Read, review and run does, plus:
    - `update_settings`: dry run, timezone, plan-ahead days, default snooze, action modes, the Radarr/Sonarr cap and released-only rule, the IMDb route, libraries, home-screen rows, and other tools' schedules
    - `set_schedule`: a job's cron expression, or turning it on or off
    - `set_collection_enabled`: turning a collection on or off
  - **One set of rules.** The Settings and Collections pages and these tools check input with the same code (`src/web/settings-actions.ts`). A change that fails any check saves nothing.
  - **Still page-only:**
    - **Connections and keys.** Changing an address while its key stays saved would let a leaked token send that key to another server.
    - **Claude access tokens,** so a token can't make itself a stronger one.
    - **Radarr and Sonarr defaults,** which need live choices from those apps.
  - **Claude asks first.** The tool and server descriptions tell Claude to ask before turning dry run off, setting a mode to auto, or turning a collection off.
- **Consequences.**
  - Existing tokens keep their level. For settings, create a Full control token.
  - The settings forms now save through the shared module. Their checks and messages are unchanged.

### ADR-034 Full control means everything except connections, keys and tokens: Decided (13 Nov)
- **Context.** ADR-033's Full control covered settings, schedules and turning collections on or off. It couldn't edit a collection's dates, so Claude couldn't fix a collection, and the name overstated what it did.
- **Decision.**
  - **Full control does whatever the pages do,** except connections, keys and Claude access tokens (ADR-033's reasons). The level is renamed "Full control (except connections and keys)". New tools:
    - collections: create, update (name, dates, minimum, filters, overview, sort title, sync or append, when closed, home row, sending missing titles, per-collection modes), delete, add and remove sources, make a source add or suggest
    - titles: pin or exclude
    - existing box sets: adopt, or delete
    - undo an applied change
    - Radarr and Sonarr: send missing titles, monitor a TMDb collection, change the defaults
    - update home-screen rows now
  - **Every token can read more:**
    - `explain_collection`: for every title a collection's sources list, whether it's a member and, if not, the first reason why (not in the library, wrong kind, outside the chosen libraries, filtered out, excluded, or only suggested)
    - `compare_with_plex`, `list_existing_box_sets` and `get_radarr_sonarr_options`
    - `get_collection` now shows filters, modes and source ids, and title ids
  - **One code path.** The collection editor, Missing and the Radarr/Sonarr defaults now save through `src/web/collection-actions.ts`, the same code the tools use.
  - **Filters,** which the planner already applied but no page set, can now be set by Claude and are shown by `get_collection`. A page for them can follow.
- **Consequences.** `get_collection`'s titles include their ids (used by the pin and exclude tool).

### ADR-035 Film series: Decided (13 Nov)
- **Context.**
  - You turned off Jellyfin's own TMDb collections, so its roughly 100 series box sets stopped picking up new films.
  - Kometa's movie `franchise` default makes these dynamically. Our universe presets only cover a few curated universes.
- **Decision.**
  - **A dynamic family, Film series,** that follows Kometa's `defaults/movie/franchise.yml` (master, 13 Nov 2026):
    - a collection for every TMDb collection the library has at least 2 films of (the minimum is a setting)
    - "Collection" removed from the name, plus Kometa's title overrides
    - sync mode, release order, and TMDb's overview and poster
    - Kometa's add-on series folded in, and its extra films added
  - **Membership** comes from Jellyfin's `TmdbCollection` provider ID, stored on the library index (migration 0004). If Jellyfin recorded none at all, TMDb `/movie/{id}` is asked instead: at most 300 uncached films per run, cached for 30 days.
  - **Each run** creates collections for new series, enabled. Existing ones only gain IDs and are never rewritten, so edits stay.
  - **One switch** in settings (`filmSeries`), set by Getting started or Claude. It turns every film series collection on or off.
  - **Adoption.** Existing box sets match a film series by their TMDb provider ID (Jellyfin's own sets carry it) or by "<series> Collection". **Adopt all suggested** takes them over in one press.
- **Consequences.**
  - A library can get a hundred or more collections. They go through Review like any other change while dry run is on. Approving a create approves its titles.
  - New series need a TMDb key; without one, the run logs which ones are waiting.

### ADR-036 Streaming services and IMDb charts: Decided (13 Nov)
- **Context.** Kometa's `defaults/both/streaming.yml` and `defaults/chart/imdb.yml` (v2.5.3, unchanged on master on 13 Nov 2026) were next on your list of gaps.
  - Kometa builds each streaming collection from TMDb's discover, filtered by watch provider and country. That is a service's whole catalogue: thousands of titles, hundreds of requests for every service, every day.
  - Kometa reads IMDb charts with a plain GraphQL `chartTitles` query (no persisted-query hash), or from its hosted service.
- **Decision.**
  - **IMDb charts: a new source, `imdb_chart`,** with Kometa's five charts and sizes (Top 250 films and shows, Most Popular films and shows, Lowest Rated films). It follows the IMDb route setting:
    - **direct:** Kometa's query, also asking for each title's name and year for the Missing page; if IMDb refuses those fields, Kometa's exact IDs-only query
    - **Kometa's service:** its `chart/<name>` endpoint
    - **snapshot:** a new `charts` table in the snapshot, which the snapshot job now fills
    - An empty chart counts as a failure, so the last good one is kept.
  - **Streaming: a new source, `tmdb_watch_provider`,** asks the other way round: which services carry each title you own.
    - Before sources resolve, each run looks up TMDb's `/movie|tv/{id}/watch/providers` for titles with a TMDb ID: ones never checked in this country first, then the oldest past a week, at most 600 a run.
    - Subscription, free and with-ads offers count; rentals and purchases don't. The answers are kept per country, so changing the country keeps the old ones.
    - The source reads only those stored answers, so it's resolved afresh each run. Until every title has been checked once, it's partial, so nothing is removed.
  - **Presets, both off by default:**
    - **IMDb charts (5):** "IMDb Top 250 Movies", "IMDb Top 250 Shows" and so on. Kometa makes one "IMDb Top 250" in each Plex library; Jellyfin shows every collection together, so films and shows are named apart.
    - **Streaming services (41):** Kometa's 22 services as "<service> Movies" and "<service> Shows", except shows only for hayu, discovery+ and Crunchyroll. Kometa's TMDb provider IDs, its Prime Video rule (119 outside AT, DE, GB, JP and US), and its earlier names for adoption.
    - Both use Kometa's sections (020, 030), summaries and Default-Images colour posters; sync; minimum 1; release order, since Jellyfin box sets can't sort newest first.
  - **A country setting, `streaming.region`** (US by default, as in Kometa), in Settings → Run and review and through Claude. Turning the family on in Getting started turns on only the services offered there, using Kometa's single-country rules.
  - Both sources are in the collection editor, for your own collections.
- **Consequences.**
  - A first fill takes a few nights on a big library: about 3 minutes of TMDb lookups per run at its rate limit. After that, about a seventh of the library is checked each night.
  - Streaming data comes from JustWatch, through TMDb; the Settings page and the guide say so.
  - IMDb can't be reached from the development sandbox, so the chart query is tested against fakes. Kometa uses the same query.

### ADR-037 New and recent collections: Decided (13 Nov)
- **Context.** Next on your list: Kometa's `defaults/chart/basic.yml` (v2.5.3, unchanged on master on 13 Nov 2026), plus Recently Added.
  - Kometa's file has two collections, both Plex smart filters: **Newly Released** (released in the last 90 days, in film and show libraries) and **New Episodes** (episodes aired in the last 7 days).
  - Recently Added isn't in that file, but Kometa's "Recently Added" poster still is in Default-Images.
  - Jellyfin has no smart collections, so the box sets have to be kept up to date by the app.
- **Decision.**
  - **The library index keeps each title's `PremiereDate`** (release date, first air date or episode air date; migration 0005). Jellyfin returns it without asking, and it's in every checked API version.
  - **A new source, `jellyfin_recent`,** reads the index: titles released, first aired or aired in the last N days, or added (`DateCreated`) in the last N days.
    - Counted in whole days, today included; future dates don't count. Newest first, as Kometa sorts them.
    - It reads only the index, so it's resolved afresh every run, including the midnight window check.
  - **Presets, off by default (family "New and recent"):** Newly Released Movies and Shows (90 days), New Episodes (7 days), Recently Added Movies and Shows (30 days).
    - Kometa's section (010), summaries and colour chart posters; sync; minimum 1.
    - Films and shows are named apart, as for the charts (ADR-036).
    - **Removals apply without review** (a per-collection mode, `collection.remove_items: auto`): titles age out every day, and a daily queue of removals in Review would be noise. Dry run still holds everything for review, and the mode can be changed per collection.
  - Both kinds of window are sources in the collection editor, for your own collections.
- **Consequences.**
  - These box sets change every day. A week with no new episodes deletes New Episodes (minimum 1); the next new episode creates it again.
  - Jellyfin box sets can only list oldest first, so the newest-first order shows only in the app.
  - Until the first full index after updating, release dates are unknown, so these collections start after the next nightly refresh or a manual run.

### ADR-038 When a title was added: Decided (13 Nov)
- **Context.** Two problems in 0.10.0's Recently Added, from using Jellyfin's `DateCreated`:
  - Shows went by when the series entry was created, so a show with new episodes didn't come back. Plex and Kometa go by the newest episode.
  - Films whose file was replaced (a Radarr upgrade) showed as newly added: Jellyfin often indexes the new file as a new item, with a new date.
  - You suggested Radarr's "added" date, which doesn't move on upgrade. But it's when a film was added *to Radarr*: a film added there before release can download months later, and wouldn't show as new when it arrives.
- **Decision.**
  - **The app remembers when each film and episode first arrived** (`title_added`, migration 0006), keyed by a stable ID: TMDb, else IMDb, for films; the series' TMDb, TVDB or IMDb ID with season and episode numbers for episodes. After each index it keeps the earliest Jellyfin date seen, and writes it to the library index (`first_added`).
  - **Radarr seeds it once.** The first time films are remembered, a film's Radarr "added" date is used when it's earlier, since the library may already hold upgrades. After that only Jellyfin's dates count, so a long-wanted film shows as new when it downloads.
  - **A title missing from every index for over a week that comes back** counts as newly added (deleted, then downloaded again). Missing only while the app wasn't running doesn't count.
  - **Recently Added Shows** goes by the newest episode's first-arrival date. A show with no episodes uses its own date.
- **Consequences.** Upgrades no longer count as new, for films or episodes. When this first runs, a film added to Radarr before it downloaded in the last 30 days may be missed until it ages out.
- **Amended in 0.16.0: Radarr's first import, on every run.** On a real library, Recently Added Movies held 153 films, mostly upgrades: Radarr hadn't been connected when films were first remembered, so their upgrade dates stuck. Now, while Radarr is connected, a film it knows arrived when Radarr **first imported** it (`/history`, `downloadFolderImported` and `movieFolderImported`, earliest per film), or Jellyfin's date for the current file if that's earlier. This is worked out on every run, so nothing from an earlier pass can stick. Upgrades are later imports, so they never move it. A long-wanted film counts from its download, which is why the import date is used rather than Radarr's `added` date you suggested. A film with a file but no import in the history (history cleared, or added with files already in place) uses `added`. Films Radarr doesn't know, and episodes, keep the remembered first-seen date and the came-back rule.

### ADR-039 Poster overlays: Decided (13 Nov)
- **Context.** Last on your list of Kometa gaps: badges on posters, keeping the originals.
  - Kometa's overlay defaults draw on each poster in Plex and keep the original so it can go back.
  - Unlike everything else here, this changes titles' own posters, not just box sets the app made. So it has to be off until chosen, follow dry run, and be fully reversible.
- **Decision.**
  - **Two overlays to start, both from Kometa v2.5.3:**
    - **Status** (`defaults/overlays/status.yml`), on shows: AIRING if an episode aired in the last 14 days, else RETURNING, CANCELED or ENDED from TMDb's status (`/tv/{id}`, kept a week, at most 300 lookups a run). Jellyfin's Continuing/Ended is used when TMDb has nothing. One status a show, Kometa's weights deciding.
    - **IMDb Top 250 ribbon** (`defaults/overlays/ribbon.yml`), on films and shows in IMDb's Top 250, from the `imdb_chart` source (ADR-036).
    - Kometa's geometry on its 1000-pixel-wide canvas, scaled to each poster's own width, so posters keep their size. Inter Medium (OFL) and Kometa's ribbon image (MIT) are bundled in `assets/overlays`.
  - **Drawing:** sharp (libvips). It loads only when overlays are used, so the rest of the app runs even where it can't. The image carries both Linux builds, and its build draws a test overlay on each platform, so a broken image fails to build rather than ship.
  - **Originals are safe:**
    - Each original is saved to `/config/overlays/originals` before anything is uploaded, and a record (table `overlay`, migration 0007) is written before the upload.
    - Overlays are always drawn on the saved original, never on an overlaid poster.
    - The app knows its own images by the uploaded image's hash and an EXIF marker. One of its own is never taken for an original; a marked poster with no saved original is left alone.
    - If Jellyfin's poster changes after an upload (a metadata refresh, or a poster you chose), the new poster becomes the original and the badges go back on.
    - Taking a badge off uploads the saved original and deletes the copy. If IMDb's chart can't be read, ribbons stay as they are.
  - **When posters change:**
    - Runs change posters only while dry run is off, at most 500 a run.
    - With dry run on, a run only reports how many would change. **Apply now** in Settings (or Claude's `apply_poster_overlays`) is the approval: it starts a run that changes them.
    - **Remove all overlays** turns them off and puts every original back.
  - **Scope:** only titles in the libraries collections draw from. The Settings section previews up to four posters drawn on their originals, without changing anything.
- **Consequences.**
  - `/config` must be backed up with `overlays/originals`: those files are the only copies of the original posters until the overlays come off.
  - Kometa's other overlays (resolution, audio, ratings, streaming logos…) can be added on the same machinery.
- **Kids' libraries (0.16.0).** At your request, kids' libraries get no overlays by default: a CANCELED badge or a ribbon isn't for a children's shelf. A library counts as a kids' library when its name says so (Kids, Children's, Family, Cartoons, Disney, Pixar, Animated…) or at least 80% of its rated titles (five or more) have children's ratings (G, PG, TV-Y, TV-Y7, TV-G, U). Settings → Poster overlays lists the libraries collections draw from, with the kids' ones marked, to tick or untick. The choice is stored as the libraries to skip (`overlays.skipLibraryIds`), or null for the default. Unticking a library takes its overlays off on the next update. Box sets never get overlays.

### ADR-040 Box set identity and artwork: Decided (13 Nov)
- **Context: an incident on your server.** Seven managed box sets showed another TMDb collection's artwork. Two were harmful on a children's server: "Inside Out" had an adult collection's nude poster and backdrop, and "9-1-1" an erotic "9½ Weeks" backdrop. Your experiments established:
  - Jellyfin identifies any **unlocked** box set by name within about 2 seconds of creation. It searches TMDb collections and attaches the match: provider ID, poster, logo, thumb, backdrop and overview, and renames the set "X Collection". A full refresh with `replaceAllMetadata` repeats the search; a rename or a default refresh doesn't.
  - The search is ambiguous and isn't checked against the set's titles.
  - `isLocked=true` at creation prevents it.
- **How the app let it through:**
  - It created box sets with `isLocked=false` (9-1-1).
  - It adopted Jellyfin's own unlocked "X Collection" sets "keeping their IDs and posters", without checking the TMDb link.
  - It rewrote the name and overview, which hid the problem, but managed only the poster, so backdrops, logos and thumbs stayed. Where a collection had no overview of its own, it kept Jellyfin's.
- **Decision.**
  - **Create locked:** `POST /Collections?isLocked=true`, everywhere, including undo. That doesn't lock the titles in it.
  - **The app owns each managed box set's identity:**
    - provider IDs: `{Tmdb: <series>}` for a film series, `{}` for everything else
    - images: its poster (the TMDb collection's for a film series, Kometa's for presets) or none, and no backdrop, logo, thumb, banner or art. A poster it can't fetch isn't replaced by one it can't vouch for: the existing one is removed and the next run tries again.
    - overview: cleared when the collection has none of its own, never kept from Jellyfin
    - It records what it wrote: provider IDs, poster tag, name and overview.
  - **Re-check after creating:** a few seconds after creating (or adopting) box sets, the app reads them again and repairs anything Jellyfin attached.
  - **Never change `LockData` on an existing box set.** Jellyfin copies a lock change to every title in the set. So a managed box set found unlocked isn't locked in place; it's replaced by a fresh locked one with the same titles, and the old one deleted.
  - **Adoption replaces the set, never trusts it:**
    - Adopting builds a fresh locked box set with the same titles and the app's own name, overview, provider IDs and artwork, and deletes the old one. Nothing Jellyfin attached carries over.
    - The adoption screen still checks a film series set's TMDb link against the series and every title's `TmdbCollection`, and says when it doesn't match.
    - Adopting can't be undone, since the old set is gone.
  - **Integrity check every run,** dry run or not, because it only puts back what the app already applied:
    - provider IDs as expected
    - locked
    - images as the app last wrote them
    - name and overview as the app last wrote them
    - Differences are repaired at once, logged, and shown on the Dashboard for a week. Repairs that fail show as errors.
    - The first check of a set (nothing recorded yet) replaces its poster with the app's own without reporting it; anything else it removes is reported as "First check".
  - **No metadata refresh, ever:** the client has no refresh call, and the tests check none is sent.
  - **Dashboard warning** while any Jellyfin library has "Automatically add to collection" on (it creates unlocked, name-identified sets). The app now reads `LibraryOptions`, which is checked against all four API specs.
  - **Regression tests** (`test/artwork-safety.test.ts`) use the incident's names and wrong matches: Inside Out, 9-1-1, Twister, Night at the Museum, Home Alone, The Chronicles of Narnia, Teenage Mutant Ninja Turtles. The fake Jellyfin reproduces the name search. After creating, after adopting, and after outside changes, they assert every managed set's TMDb link, poster, other images, overview and lock, and that its titles stay unlocked.
- **Consequences.**
  - Box set IDs change on adoption and when an unlocked managed set is repaired.
  - Collections with no poster of their own (your custom ones) lose any poster set in Jellyfin.
  - Hand-made backdrops and logos on managed sets are removed, since the app doesn't supply them.
  - Locking existing box sets yourself through Jellyfin (metadata editor or API) likely locked their titles too; that's worth checking.

### ADR-041 Library health: Decided (13 Nov)
- **Context.** The same audit (ADR-040) found four files that weren't what they said: a kids' "TMNT" episode held a live-action adult drama, "Black Panther: Wakanda Forever" held *Bewitched*, "The Spy Who Loved Me" held *The Lucky One*, and "The Search for General Tso" held a Trans-Siberian Orchestra concert. They were caught by comparing each file's length with TMDb's runtime, and by title tags inside the files naming other films. You asked for that as a feature.
- **Decision.**
  - **Length:**
    - The file's own duration, as Jellyfin probed it (`MediaSources[].RunTimeTicks`, not the item's metadata runtime), against TMDb's runtime. Films use `/movie/{id}`, cached 180 days. Episodes use `/tv/{id}/season/{n}`, one lookup a season, cached 90 days.
    - A file is flagged when the difference is **more than 12 minutes or 15%, whichever is larger**. The larger keeps director's cuts and long credits out, and still catches all four (diffs of 60, 24, 25 and 73 minutes).
  - **Title tags:**
    - Jellyfin doesn't expose a file's container-level title, only its streams' (`MediaStreams[].Title`), so those are read.
    - A tag that looks like a release name ("Name 2012", "Name (2012)") and names a different title is flagged. Different means fewer than half its words are shared and neither name contains the other; for an episode, the show's name counts too.
    - It's not flagged when the year is within one of the title's, which is likely a translated title (*Le Fabuleux Destin d'Amélie Poulain* on *Amélie*). Tags that aren't titles (English, SDH, Commentary…) are ignored.
  - **Cost:** each file is probed once, and again when it changes (its `DateCreated`), 3,000 a run in batches of 50. TMDb runtime lookups are capped at 400 films and 150 seasons a run, so a big library is checked over a few nights.
  - **Read-only:**
    - Findings are listed on a **Library health** page (title, library, rating, what doesn't match, file path) and counted on the Dashboard. Claude can list them, and mark one fine at the review level and above.
    - **It's fine** hides a finding until the file changes. Findings that stop being true go away.
    - The app never moves, deletes or hides a file.
  - On by default; a setting turns it off.
- **Consequences.**
  - Extended editions far longer than TMDb's runtime will be flagged; mark them fine once.
  - Where TMDb has no runtime (common for episodes), only the title tags are checked.
  - **Its own page and menu item** (added in 0.14.0, at your request):
    - "Library health" sits in the menu, with a count of files needing review.
    - The page is a dashboard: needs review (by length or by title tag), reviewed, and how much of the library has been checked (with how many could be compared with a TMDb runtime).
    - A by-library table, the files needing review, and the reviewed ones, with who marked each fine and when. **Review again** puts one back.
- **Episode lengths, amended in 0.16.0.** On a real library, 136 of the first 140 findings were false alarms. TMDb lists some networks' episodes at the TV slot length, ads included: *Dirty Jobs* at 60 minutes for 42-minute files, *Scorpion* at 59 for 41.
  - **A season off as a whole uses its own median.** When a season's typical (median) file length is more than 4 minutes or 10% from TMDb's typical runtime, or TMDb has fewer than three runtimes for it, its episodes are measured against the season's median file length instead. They're flagged beyond the same 12 minutes or 15%. A season with fewer than three files uses the show's median.
  - **Still caught**, from the same library: an episode with the TV commercials left in (*9-1-1* S3E3, 57 minutes against 43), two episodes in one file (*Last Man Standing* S7E13, 43 against 21), a combined crossover (*FBI* S2E18, 84 minutes).
  - **About twice the typical length** (1.7 to 2.4 times): the finding says the file may contain two episodes, and whether the next episode also has its own file, in which case the second half may be something else.
  - **Multi-episode files:** a file Jellyfin knows spans several episodes (`IndexNumberEnd`, stored as `episode_end`, migration 0010) is expected to be that many times as long.
- **Several at once (0.16.0).** Approving 138 findings took 138 calls. The page has checkboxes with **Mark selected fine**, and **Mark all for this show fine**. `mark_library_health_fine` takes `ids` (optionally one `kind`) or a `seriesId`. `get_status` gives a Library health summary: open findings by kind, files checked and left to check.
- **Fixes in 0.18.0** (from a real library on 0.17.0):
  - **Encoding notes:** eight false alarms came from stream titles such as "1080p COMPRESSED (from 23.2Mb/s VC-1 BluRay REMUX - 2009 Warner Bros. …)", "DTS-HD MA 5.1 / 1968 kbps / original" and "x265 / 12098 kbps / … BT.2020". Two tiers of vocabulary now apply:
    - **Never in a release name** (kbps, kb/s, Mbps, Mb/s, fps, COMPRESSED, Handbrake, BT.709/2020/2100, Main 10, 4:2:x, "N bits"): the whole tag is ruled out. The match works even without a space before the word ("23.2Mb/s").
    - **Common in release names after the year** (x264, x265, HEVC, AVC, VC-1, REMUX, DTS, TrueHD, Atmos, 10bit, HDR10, Blu-ray, WEB-DL): the tag is ruled out when these come before the year. Skipping every tag with x264 would lose the audit's real find, "The.Lucky.One.2012.1080p.BluRay.x264" inside *The Spy Who Loved Me*.
    - A number followed by kbps or Mb/s, or following "BT", is never taken as a year.
  - **Deleted or replaced files:**
    - **The problem:** findings for them stayed open until the nightly index noticed the item was gone.
    - **Jellyfin check:** every run now asks Jellyfin which flagged items still exist (100 a request), and drops the findings of those that don't.
    - **Mount check:** with the media mount on (ADR-044), it also drops file findings whose file is gone from the mount, even while Jellyfin still lists it.

### ADR-042 Collection posters: Decided (13 Nov)
- **Context.** Since ADR-040 the app supplies the only image a managed box set carries. Collections of your own had no poster setting, so a poster added in Jellyfin was removed; you asked for a poster field.
- **Decision.**
  - **A Poster section in the collection editor:** an image address, an uploaded image, the preset's own poster (presets only), or none.
    - Uploads are kept in `/config/posters`, named after the collection, and deleted when replaced or when the collection is deleted.
    - Addresses and uploads are checked before saving: JPEG, PNG or WebP, at most 10 MB, at least 100 × 100, and an image that actually decodes.
  - **Saving is the approval:** a live box set gets the new poster straight away, with the same ADR-040 code that owns its artwork. Otherwise it goes on when the box set is created.
  - **The integrity check knows the difference** between the app's poster being changed in the app (applied quietly) and something else changing the box set's poster (a repair).
  - **Claude:** `update_collection` takes `poster` (an address, `none` or `default`). Uploading a file is only on the page.
  - The editor shows the poster through the app, so any address works under the page's content security policy.
- **Consequences.** Back up `/config/posters` with the rest of `/config`.

### ADR-043 Artwork and audio checks: Decided (14 Nov)
- **Context.** From the artwork incident (ADR-040) and a kids'-safety audit of a real library:
  - a kids' film showing a video still as its poster
  - Donald Duck shorts with French posters
  - box sets linked to another title's TMDb collection
  - about 25 kids' films that start in a French, Chinese, Spanish, Portuguese, Danish or Turkish dub although they include English

  You asked for artwork checks on the Library health page, with a safe fix, instead of copying Kometa's `mass_poster_update`. Jellyfin already picks TMDb posters by language, and a blind library-wide reset is the kind of operation behind the incident.
- **Decision.**
  - **Five new finding kinds**, on the same page with the same "It's fine" flow. A dismissal lasts until the poster or IDs change.
    - **No poster:** the film or show has no Primary image.
    - **Poster from the video or file.** Jellyfin doesn't record which fetcher made an image, so:
      - A Primary on a film or show that's wide (aspect 1.2 or more) is a frame.
      - A poster that matches none of TMDb's posters for the title is from the file when it has the same shape (within 2%) as the file's embedded picture stream, or the file has an image attachment.

      Comparing against actual frames of the video needs the file itself: the optional read-only media mount planned for 0.18.0.
    - **Poster language.** Jellyfin doesn't record an image's language either. The current poster's 64-bit difference hash is matched (within 10 bits) against the title's TMDb posters, which carry their language. TMDb's `w92` thumbnails are a few KB, and their hashes are kept for good, since a TMDb file path never changes.
      - The likeliest are tried first, up to 40: the library's language, textless, the original language, English, then the rest.
      - A match in another language is flagged when TMDb has a poster in the library's language (the library's own, else the server's).
      - When it has none, the poster is kept, and a note says so ("TMDb has no English poster for it"). It isn't flagged, and isn't checked again until the poster changes or a month passes.
    - **Artwork from another title.** Jellyfin's TMDb ID doesn't match the confirmed one (below), or, for a box set the app doesn't manage, its TMDb link isn't the collection its films belong to (`TmdbCollection`).
    - **Audio** (from the probe, now version 2: audio tracks and embedded pictures): the default audio track isn't in the library's language, and another track is.
      - The default is the flagged one, else the first. Languages compare across ISO 639-1 and 639-2 codes (`fr`, `fre`, `fra`).
      - **Severity:** it's *for information* when every enabled Jellyfin user prefers the library's language and doesn't play the default track. Otherwise it counts as needing review.
  - **The confirmed TMDb ID: never a name search.**
    - Jellyfin's TMDb ID is confirmed when TMDb's record for it carries the same IMDb ID Jellyfin has (shows: or TVDB ID).
    - When they disagree, the IMDb (or TVDB) ID's own TMDb title is found with `/find`, by ID. The file's folder or file name (`Title (Year)`, a strict name match: at least 80% of words shared, year within one) decides.
    - With no IMDb or TVDB ID, the folder name alone can confirm Jellyfin's ID.
    - When nothing confirms either, the finding is shown with no fix offered.
    - TMDb's details, external IDs and images (every language: asked for on their own) are cached for 30 days.
  - **Fix: "Reset from TMDb"**, for one finding or the ones ticked. There's no library-wide button, and at most 50 per request.
    1. **Re-check.** It re-reads the item, and stops (leaving the finding) if its poster or IDs changed since the check. It then confirms the TMDb ID again.
    2. **Choose.** It picks TMDb's best-rated poster in the library's language. For no poster and video posters, it falls back to textless, then the original language, then any; for the language finding it uses only the library's language. Optionally it also replaces:
       - **backdrop:** textless first
       - **logo:** the library's language first
       - **thumb:** a backdrop in the library's language, which carries the title
    3. **Replace.** It downloads them first (so nothing changes if TMDb can't be read), backs up what it replaces to `/config/artwork/backups`, and uploads.
       - **Overlays:** a poster carrying the app's overlays is backed up as its saved original. Its check also looks at the original.
    4. **Record.** It re-reads the item, records the new poster tag, and logs the fix (`artwork_fix`).
    5. **Undo** puts the backups back.
  - **Fixing by itself:** a per-library setting fixes "No poster" and "Poster from the video or file" on each run, 50 a run at most, only while dry run is off. Everything else waits for you.
  - **Box sets:** the app's own sets keep ADR-040's nightly repair. Its log now also shows on this page as "Collection artwork changed". Box sets it doesn't manage are only reported, with a link to adopt them, as you asked: it touches only box sets it created or you adopted.
  - **Dashboard:**
    - It warns when a film or TV library has Screen Grabber or Embedded Image Extractor on as an image fetcher for Movie, Series or Season. Episodes are left out: their stills are frames by design.
    - It warns about Jellyfin users with no preferred audio language, or "Play default audio track" on.
  - **Data** (migration 0011):
    - libraries' preferred language and image fetchers
    - each film's and show's poster tag and path
    - the probe's audio tracks and embedded picture
    - `artwork_check`, `image_hash` and `artwork_fix`
    - findings gain the proposed image and, for box sets, a name to show
  - **Cost:** 300 titles a run, new or changed first, then any not checked for 30 days. Box sets the app doesn't manage: 100 a run. Files probed before 0.17 are probed again once, a few thousand a night, without counting as unchecked.
  - **New Jellyfin calls**, checked against 10.10.7, 10.11.0, 10.11.8 and 12.4.0:
    - `GET /System/Configuration` (the server's language)
    - `GET /Items/{id}/Images/{type}?maxWidth` (thumbnails)
    - `GET /Items/{id}/Images/Backdrop/{index}` (backups)
  - **Claude:**
    - `list_library_health` lists every kind, with `resetFromTmdb` where there's a fix, and recent fixes.
    - `reset_artwork` and `undo_artwork_fix` work at the review level and above.
    - `update_settings` takes `libraryHealth` (checking on or off, and the libraries that fix posters by themselves).
- **Consequences.**
  - **Unverifiable titles aren't fixed:** a poster Jellyfin got from TMDb for a title with no IMDb or TVDB ID, and a folder name that doesn't say, is reported but not offered a fix.
  - **Posters from elsewhere aren't flagged:** a poster from another provider (fanart.tv) or one you uploaded matches none of TMDb's. It isn't flagged unless the file's embedded picture or an attachment points to the file.
  - **The first pass on a big library** takes a few nights, and fetches each title's TMDb thumbnails once.
- **Poster language, amended in 0.18.0.** Three false alarms (Brave "Spanish", Home Alone "Portuguese", Minions: The Rise of Gru "French"): TMDb files the same picture more than once, under different language tags.
  - **Matching:** when the first match is in another language, the rest of the library's-language and textless posters are tried too, and one of those wins.
  - **Same-image check before flagging:** the poster TMDb would put on is compared with this one. It's the same picture when it's the same file, or its fingerprint is within 16 bits of the current poster's, or within 10 bits of the matched image's. A looser threshold is safe here, because it compares two specific pictures rather than searching.
  - **When it is the same:** it isn't flagged. It's noted under "For information" ("The poster has a Spanish tag on TMDb but is the same image as its English one") and not counted.
  - **Recheck:** migration 0013 makes titles flagged for language in 0.17.0 be checked again on the next run. Their "It's fine" marks are kept.

### ADR-044 Read-only media mount and frames: Decided (14 Nov)
- **Context.** Item 4c of your pending updates: Jellyfin doesn't expose a file's container-level title, only its streams' title tags (ADR-041). The container title is what gave *Bewitched* away inside the *Wakanda Forever* file. You suggested an optional read-only media mount, reading new files with ffprobe, and optionally saving one mid-film frame per new file for the Library health page. Off by default.
- **Decision.**
  - **The mount:**
    - Off by default. Turned on in Settings → Run and review → Media files, with the folder it's mounted at (default `/media`).
    - The folder must be absolute, can't be `/`, `/config`, `/app` or a system folder, and can't contain `..`.
    - **Path mapping is worked out, not configured.** For a few known files, the shortest tail of Jellyfin's path that exists under the mount gives the mapping ("/data/movies/Heat (1995)/Heat.mkv" found as "/media/movies/…" maps `/data` to `/media`). The answer most agree on wins. It's found again when the folder changes, or when files stop being found.
    - A mapped path is never outside the mount.
  - **Container titles without ffprobe.** The image doesn't include ffmpeg: Debian's package adds a few hundred MB for every user of an optional feature. Instead the app reads the title directly, touching only the few kilobytes that hold it:
    - Matroska/WebM: Segment → Info → Title, through the SeekHead when Info is far in.
    - MP4/M4V/MOV: `moov → udta → ©nam`, QuickTime or iTunes-style `meta → ilst → ©nam → data`, with `moov` anywhere in the file.
    - AVI: `LIST INFO → INAM`.
    - A truncated or odd file gives no title, never half of one.
  - **How it's read:**
    - 3,000 files a run; each file once, and again when it changes.
    - A file's own title is checked before its streams' tags, and the finding says "The file's own title names …".
    - Files that can't be read (not under the mount, or not readable by uid 1000) are counted and shown on the Settings page. Nothing is written to the mount.
  - **Frames from the middle,** for flagged files only rather than every new file: one frame per finding is enough to check what a file holds, and costs nothing for the rest.
    - **First choice: Jellyfin's trickplay previews.** `Trickplay` on the item gives tile sizes and the interval. The thumbnail at the middle is cropped from its tile (`/Videos/{id}/Trickplay/{width}/{index}.jpg`). This needs no mount and no ffmpeg; Jellyfin has had trickplay since 10.9. The schema was renamed `TrickplayInfoDto` in 10.11, and the compatibility check accepts either.
    - **Otherwise ffmpeg** (`FFMPEG_PATH`, or `ffmpeg` on the PATH) on the mounted file: one frame, 480 wide, given up after 30 seconds.
    - **Hidden until opened:** the frame sits behind "Show a frame from the middle". A mislabelled file can hold anything, and the image only loads when opened.
    - Kept in `/config/frames` until the file changes.
  - **Probe 3** records whether Jellyfin has trickplay previews of each file. Files are probed again once, a few thousand a night. Migration 0012 adds the trickplay flag, the file's own title and whether it was read.
  - **Claude:** `get_settings` shows `mediaFiles` (mounted, mapping, files read, ffmpeg). `update_settings` takes `mediaFiles` (`readOwnTitles`, `mountedAt`).
- **Consequences.**
  - Container titles in other formats (MPEG-TS, WMV) aren't read.
  - Frames need trickplay previews in Jellyfin, or an ffmpeg you provide.
  - Back up `/config/frames` with the rest of `/config`, or don't: frames are made again when needed.

### ADR-045 The presets' own posters: Decided (14 Nov)
- **Context.** Presets used Kometa's Default-Images posters, fetched at runtime because that repository has no licence file (ADR-014). You asked for posters designed for this app instead, built as part of the Docker image, while keeping the Poster section's choices (ADR-042): an upload, an address or no poster still win.
- **Decision.**
  - **Artwork made for the app.** 29 textless illustrations in one house style (mid-century travel poster crossed with gouache), from the brief in [posters/ART-BRIEF.md](posters/ART-BRIEF.md). They're kept as WebP in `assets/posters/art`; the prompts behind each are in [posters/PROMPTS.txt](posters/PROMPTS.txt).
  - **The title is set by the app, not drawn.** The collection's name goes over the art's quiet bottom third in Archivo ExtraCondensed Black (cream), with "MOVIES", "SHOWS" or "EPISODES" below in Archivo SemiBold (gold), and a small line above where it reads better ("IMDb", "Asian American & Pacific Islander"). Titles take one to three lines at the largest size that fits. So every poster is spelled right and the set matches.
  - **Which presets:** seasonal films (19), holiday episodes (3), New and recent (5), IMDb charts (5) and streaming services (41): 73 posters. Films and shows versions share a picture.
    - **Streaming services share one picture,** tinted in each service's colour, with the service's name set in the app's type. No logos.
    - **Universes and show franchises keep Kometa's posters,** and film series TMDb's: those show the franchises' own characters and worlds, which the app doesn't draw.
  - **Built with the image.** `npm run build` sets every poster into `dist/posters` (about 6 seconds, 12 MB). The image's self-test checks all 73 are there at 1000 × 1500, and the source art isn't copied into the runtime image. Run from source, a poster is set the first time it's asked for and kept in memory.
  - **A new poster kind,** `{ kind: 'bundled', key: <preset slug> }`. Its key for the integrity check is `bundled:<slug>@<revision>`. `BUNDLED_POSTERS_REV` goes up whenever the art, lettering or layout changes, so box sets get the new version on their next run, like any other change of poster setting.
  - **Switching existing installs, once.** On the first start of this version, a preset whose poster is still the Kometa address it came with gets the app's own. A poster you uploaded, an address you entered, or none, stays. A marker (`bundledPostersSwitched`) stops it running again, so putting Kometa's address back afterwards sticks. Live box sets get the new poster on the next run.
  - **The editor** shows it as "The preset's own poster", as before.
- **Consequences.**
  - The image is about 12 MB bigger.
  - Changing the art or lettering means raising `BUNDLED_POSTERS_REV`, or box sets keep the old version.
  - Kometa's posters for these presets are no longer fetched. To go back to one, paste its address into the Poster section.

### ADR-046 Pages organised around what you want to do, in plain words: Decided (14 Nov)
- **Context.** A usability review of 0.19.0 found the engine sound and the pages hard to learn. The pages were organised by the pipeline (definition → source → window → plan → proposal → action → mode → run) and used its words. Three things followed:
  - **Five places held "things waiting for me":** Review, Library health, Missing, Existing box sets, and the Dashboard's service notices.
  - **Four controls answered "will this happen without asking me?":** dry run, the global action modes, a collection's own modes, and a source's "add directly / suggest".
  - **Every page gave all its options equal weight.** Settings was one 5,262-pixel page with 11 sections and 8 Save buttons; a collection's editor was 2,648 pixels with nine sections and three ways of saving.
  - Before the first run, the Dashboard showed "Plan: create 0 box sets, delete 0", and its button led to an empty Review that said "Nothing waits for review" while the run was still going.
- **Decision.** Change how things are presented, and nothing about what the app does. No feature is removed, and the database, settings keys, routes' meanings and MCP tools are unchanged.
  - **Navigation: Home, Inbox, Collections, History, Settings.**
    - The Inbox is one queue with tabs: Collection changes (`/review`), Library health (`/health`) and Missing titles (`/missing`). Its one badge is changes to approve plus open health findings. The Library health tab shows while the check is on, and Missing titles while Radarr or Sonarr is connected.
    - "Already in Jellyfin" (`/adoption`) is a tab of Collections.
    - Getting started has its own menu item until it's finished.
    - Old addresses still work: the paths didn't change.
  - **One vocabulary, in one file** (`src/web/terms.ts`). Mode → approval, with Never / Ask me / Automatic. Dry run → "Approve everything first". Window opens / closes → the collection appears / goes away on its dates. Proposal → change to approve. Adopt → take over. Film → movie, as the collections are named. "Box set" is said once, in help text.
    - The engine keeps its names in code, the database and the MCP tools, so nothing stored changes and Claude's tools keep working. The MCP instructions tell Claude the pages' words.
    - Reasons the planner stores with a change are reworded too. Changes already waiting keep their old reason until the next run plans them again.
  - **Settings is six pages,** each saved on its own: Connections, Libraries and region, Approvals, Schedule, Extras, Advanced. Approvals holds "Approve everything first", the approval for each kind of change, and the limits. Extras holds what's optional (Library health, poster overlays, home-screen rows, Radarr and Sonarr), each saved by itself because each is a feature of its own. Advanced holds how IMDb is read, the media mount and Claude access.
  - **A collection's page** opens with its poster, where it stands in a sentence, and its titles at full width. Sources, Dates, Name and poster, and Advanced are tabs. Every tab's fields are on the page, in one form, so one Save covers them all, the poster included; a small script (`public/app.js`) switches tabs without losing what was typed, and without it the tabs are plain links. Adding or removing a source, and "Always include" or "Leave out" on a title, are saved straight away, as before, and the page says so.
  - **Getting started** shows one step at a time with one Continue. The first run starts when the collections step is saved, so results are ready by the last step. The "already in Jellyfin" step finishes itself when Jellyfin has nothing under the chosen names. A step that can't read Jellyfin says why.
  - **Before the first run,** Home shows "Start your first run" in place of the next change, lists no collection as going away unless it's in Jellyfin, and the Inbox says a run is in progress and refreshes itself.
  - **Approval is met late.** A new install approves everything first. After the first approved change, Home offers once ("Let routine changes happen by themselves?") to follow the per-change settings instead (`onboarding.automaticOffered`). Either answer is kept, and Settings → Approvals changes it at any time.
  - **Home's notices** put the app's own problems first. Settings worth changing in Jellyfin are listed apart as Recommendations, each one line long with its steps folded under "How to fix".
- **Alternatives considered.**
  - **Rename the routes** to match (`/inbox`, `/history`). Not done: bookmarks, the README and the MCP instructions point at the old paths, and a path isn't something people read.
  - **Merge the three Inbox lists into one table.** Not done: a collection change, a mislabelled file and a missing title are decided with different information and different actions. Tabs under one name and one count give one place to look without one overloaded table.
  - **A separate save per tab** on a collection's page. Not done: it was the three ways of saving that people tripped on.
- **Consequences.**
  - `public/app.js` is the app's first script of its own (htmx aside). The pages must keep working without it, and `script-src 'self'` still holds.
  - A new word for an old thing goes in `src/web/terms.ts`, not in a page.
  - Mockups in `docs/mockups` show the earlier layout and words.
  - A container restart in the middle of Getting started ends the guide, as before, once a run exists.

---


## Open questions

**Decided on 2 Nov:**

- Hand over JAC's 7 seasonal lines at go-live (ADR-009).
- Keep delete-and-recreate as the default (ADR-010).
- Seasonal presets use every movie library by default; minimum of 1 (ADR-016).
- Seasonal "Shows" sets off.
- 14-day pre-review lead time.
- Removals need review.
- Kometa posters fetched at runtime (since ADR-045, only for universes and show franchises).
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
