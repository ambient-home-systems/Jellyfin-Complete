# Phase 1 task breakdown

Approved 2 Nov.

## Status, 2 Nov (evening)

Phase 1 is built and tested, apart from task 27, which happens on your server. The Christmas slice (★) went first.

Later the same day:
- **Collections:** custom collections; adding, removing and switching sources; TMDb keyword and list sources.
- **Undo:** for create, delete and metadata changes.
- **Presets:** show franchise and universe presets, all off by default.
- **Visibility:** the tag-gate option.
- **IMDb:** the snapshot route.


| Done | Notes |
|---|---|
| 1–6, 10, 14, 17–20, 22, 23, 25, 26 | As planned. Task 1 enforces the `src/imdb` no-`node:` rule with a test, not ESLint. Task 26 uses a Jellyfin fake that encodes the 12.4 behaviours from spike 06. |
| 7 | TMDb `/find` and collection, movie and show lookups, with caching |
| 8 | Direct route, Kometa's hosted service (off by default), and the snapshot route with its build script and an example workflow ([IMDB-SNAPSHOT.md](IMDB-SNAPSHOT.md)) |
| 9 | IMDb list and search, MDBList, TMDb collection/movie/show/keyword/list, Jellyfin query, Letterboxd (first-time lookups capped per run) |
| 11 | Movies and shows. Episodes come with holiday episodes (Phase 2). |
| 12 | Ranges, New Year wrap, Feb 29, nth weekday, Easter, local-midnight flips |
| 13 | 19 seasonal (on), 17 universe and 27 show franchise presets (off), with golden tests against Kometa v2.5.3's YAML |
| 15 | Modes with per-collection overrides, dry run, fingerprints, snooze and dismiss. The Radarr/Sonarr cap waits for Phase 2. |
| 16 | Ordered apply with drift checks, before/after history, and undo for every kind of change |
| 21 | List grouped by family, new custom collections, editor (schedule, sources, output, visibility, modes, minimum, sync mode), live preview with provenance, pins and excludes |
| 24 | Everything except preset management |
| 27a | No install-specific defaults, `decidedBy` on actions, LICENSE and NOTICE, Kometa service off by default |

Also done: the tag-gate visibility option (ADR-010), and turning a collection off now removes its box set. Next comes Phase 2 (holiday episodes, Radarr and Sonarr).


- Estimates are focused build hours, including tests.
- Today is Mon 2 Nov. **Christmas Movies opens Tue 1 Dec at 00:00** (29 days), Disabilities on 2 Dec, New Year's on 26 Dec.
- ★ marks the **Christmas slice**: the minimum that must be deployed and dry-run tested on your server by about **Mon 23 Nov**. That leaves a week of real nightly runs and your review session before the 1 Dec flip. The 14-day pre-review lead time (ADR-006) puts Christmas proposals in the queue from **17 Nov**.

## Prerequisites (you, before building starts)

| | Item | Why |
|---|---|---|
| P1 | Approve this Phase 0 package (architecture, decisions, mockups) | Hard stop |
| P2 | Run read-only spikes `01`–`05` on the server and paste the output back (or connect Remote Control) | Jellyfin version, live spec, fixtures, owned counts |
| P3 | Decide on the write spike `06` and the IMDb Actions/Worker runs | Tag-gate and episode-container answers |
| P4 | Put API keys in a gitignored `.env` on the dev box: Jellyfin, TMDb, Plex, Radarr, Sonarr | Development and tests |

## Breakdown

| # | Task | Hours | ★ |
|---|---|---:|:-:|
| **Foundation** | | | |
| 1 | Repo scaffold: TS strict, Hono, Vitest, ESLint (with the `src/imdb` no-`node:` rule), scripts | 4 | ★ |
| 2 | Config: `.env` for dev, `/config` layout, encrypted secret store, redacting logger | 5 | ★ |
| 3 | DB: Drizzle schema for all tables in ARCHITECTURE §2, migrations, WAL | 6 | ★ |
| 4 | Jellyfin client: types from the saved live spec + wrapper (paging, collections, GET-modify-POST, base64 images, write rules in ADR-019) | 8 | ★ |
| 5 | Sign-in with Jellyfin admin, sessions, CSRF | 4 | ★ |
| **Data in** | | | |
| 6 | Library indexer: Movies + all TV libraries, ProviderIds, incremental and full | 6 | ★ |
| 7 | TMDb client: rate limiter, `/find` cache, enrichment cache (TTL 30 d) | 6 | ★ (find only, 3 h) |
| 8 | IMDb resolver (fetch-only): `TitleListMainPage`, `AdvancedTitleSearch` with Kometa's variable mapping, hash handling + alert; routes direct / Kometa service / snapshot reader / TMDb fallback | 10 | ★ (direct route, 6 h) |
| 9 | Source adapters: MDBList, TMDb collection/movie/show/keyword/list, Jellyfin query, Letterboxd per ADR-023 | 10 | ★ (MDBList, 2 h) |
| 10 | Source cache: `cache_builders` 1 day, last good result, stale/failed states | 4 | ★ |
| 11 | Matching engine: movies, shows, episodes; provenance records | 6 | ★ (movies, 3 h) |
| **Core** | | | |
| 12 | Window engine: ranges, wrap, Feb 29, relative rules, tz; tests | 6 | ★ (ranges, 3 h) |
| 13 | Presets: seasonal 19 (golden test against `seasonal.yml`), show franchise 27, universe 17 | 6 | ★ (seasonal, 3 h) |
| 14 | Planner: desired state, diff, min items, sync/append, metadata, pre-review lead time | 10 | ★ |
| 15 | Router: modes, overrides, dry run, fingerprints, dismiss/snooze, guardrails | 6 | ★ |
| 16 | Executors: ordered apply, drift check, before/after history, undo | 10 | ★ (no undo, 7 h) |
| 17 | Ownership: first-run adoption scan, JAC detection, `managed:` tag | 5 | ★ |
| 18 | Scheduler: croner, crons in DB, startup catch-up, run lock, progress endpoint, run logs | 6 | ★ |
| **UI** (from the approved mockups) | | | |
| 19 | Shell: tokens and components ported from `docs/mockups/mock.css`, rail, themes, container queries | 6 | ★ |
| 20 | Dashboard: answer band, year strip, upcoming-changes timetable | 6 | ★ |
| 21 | Collections list + editor with live preview and provenance | 14 | ★ (read-only list + basic editor, 6 h) |
| 22 | Review queue: grouping, bulk, snooze/dismiss tabs | 10 | ★ (approve/dismiss, 6 h) |
| 23 | Activity: runs, applied actions, undo | 5 | |
| 24 | Settings: connections + tests, modes and guardrails, IMDb route, schedules, presets, dry run; Radarr/Sonarr defaults (connections only in Phase 1) | 10 | ★ (connections, dry run, 4 h) |
| **Ship** | | | |
| 25 | Docker image, healthcheck, Portainer stack file, deploy notes | 4 | ★ |
| 26 | Integration tests against a Jellyfin mock built from recorded fixtures | 8 | ★ (core paths, 4 h) |
| 27 | Deploy to the server, hand over from JAC (delete its 7 seasonal lines, restart it; ADR-009), adoption screen, first dry run, parity check against Plex baselines | 5 | ★ |
| 27a | Public-readiness basics (ADR-031): no install-specific defaults, `decided_by` on actions, LICENSE + NOTICE, Kometa service off by default | 8 | |
| 28 | Buffer (about 10%) | 19 | ★ (10 h) |
| | **Total** | **≈ 213** | **≈ 142** |

## Order (critical path to 1 Dec)

1. **Week of 2 Nov:** P1–P4, then tasks 1–6 and 12.
2. **Week of 9 Nov:** tasks 7, 8 (direct route), 9 (MDBList), 10, 11, 13 (seasonal), 14, 15.
3. **Week of 16 Nov:** tasks 16, 17, 18, 19, 20, 22 (approve and dismiss), 24 (connections, dry run), 25.
   - First deploy around **18 Nov**, in dry run.
   - Christmas proposals appear from 17 Nov, or on the first run after deploy.
4. **Week of 23 Nov:**
   - Nightly runs on the real server.
   - Your review session.
   - Fix what the runs show.
   - Decide whether to leave dry run before 1 Dec.
5. **1 Dec onward:** the rest of Phase 1 (full editor, Activity and undo, remaining adapters, show presets, Settings complete). Disabilities (2 Dec) and New Year's (26 Dec) use the IMDb direct route, which is already in the slice.

**Risk.** About 142 hours in three weeks (roughly 47 hours a week) is tight for one builder. If it slips:

- Christmas still opens correctly with the Dashboard and Review queue alone, because the definitions come from presets and need no editor.
- The editor UI is the first thing to defer.

## Later: Phase 4, public release (proposed, about 50 h; ADR-031)

| Task | Hours |
|---|---:|
| First-run setup wizard: connections, library picker, timezone, dry run | 12 |
| Jellyfin 10.10/10.11/12.x compatibility + test matrix | 10 |
| GHCR image, versioned releases, changelog, upgrade notes | 6 |
| Security hardening for non-LAN installs: sign-in rate limit, CSP, proxy/HTTPS guide | 8 |
| User docs + public README | 8 |
| Public name, licence, Kometa courtesy note, IMDb/Letterboxd risk notes | 3 |
| Buffer | 3 |
