# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Proposed in the kickoff brief, pending confirmation in `docs/DECISIONS.md`: TypeScript (strict) on Node LTS, Hono, server-rendered HTML with HTMX, SQLite (better-sqlite3, WAL) with Drizzle. Single Docker image, `/config` volume, port 8097, `TZ=America/New_York`.

## Users

**First user:** the owner and administrator of a home media server running Jellyfin alongside Plex, Kometa, Radarr and Sonarr, who commissioned the tool. Their household may add Jellyfin users. They sign in with Jellyfin admin credentials.

**Later, if it works out:** other self-hosters who run Jellyfin and want Kometa-style collections. Each runs their own copy against their own server, possibly with several admins. So the UI records who approved, dismissed or undid each action. Viewers in Jellyfin never see this app, only the collections it produces.

## Product Purpose

Maverick Jellyfin Complete brings Kometa-style collections to Jellyfin for movies, shows and holiday episodes. It starts with the 19 seasonal collections from Kometa v2.5.3 `defaults/movie/seasonal.yml`, which appear and disappear on a schedule and match what Kometa builds in Plex. Success means Jellyfin's seasonal collections match Plex on time every year, the owner never finds a collection emptied by a failed source, and nothing outside the app changes without either their approval or an explicit Auto rule.

## Positioning

Every run computes a **plan**: the actions needed to make Jellyfin (and optionally Radarr and Sonarr) match the collection definitions. Each action type has a mode (Off, Review or Auto), set globally and overridable per collection. Proposals wait in a Review queue, and every applied change is logged with its before and after state and can be undone. Kometa and Jellyfin-Auto-Collections apply changes directly. This app's difference is plan → review → apply with provenance (which source or rule put each item where).

## Operating Context

- **Rhythm:** a weekly session at a desktop. Edit definitions, work through a batch of Review proposals, check what broke and what changes next. Usable on a phone, but the phone is not the primary scene.
- **The three questions a visit must answer at a glance:**
  1. What needs me? (pending reviews)
  2. What broke? (failed sources, served-from-cache sources, IMDb hash alerts, last run)
  3. What's next? (the next window to open or close, and what will change)

  "What's live now" matters less, because the owner sees it in Jellyfin.
- **Neighbours that must keep working:**
  - Kometa for Plex, on its own early-morning schedule
  - Jellyfin-Auto-Collections (it adopts box sets by name and can clear them)
  - Jellyfin's own automatic TMDb box sets
- **Data sources:**
  - IMDb, through the GraphQL API only, never HTML pages
  - TMDb
  - MDBList
  - Letterboxd
  - Plex (optional, for parity)
  - Radarr and Sonarr (optional push)

## Capabilities and Constraints

- **Action types:**
  - `collection.create` / `collection.delete`
  - `collection.add_items` / `collection.remove_items`
  - `collection.update_metadata`
  - `radarr.add_movie`
  - `radarr.monitor_collection`
  - `sonarr.add_series`
- **Modes:** Off, Review or Auto, per action type, with per-collection overrides.
- **Global dry run** forces every action to Review. It is on at first boot.
- **Dismissals and snoozes** are remembered per action, target and item, and can be reversed.
- **Auto guardrails:**
  - per-run cap on Radarr and Sonarr adds
  - released titles only
  - already-present and exclusion-list checks
  - overflow goes to Review
- **A failed source never empties a collection.** The app keeps its last good result and shows the error.
- **Ownership:** the app touches only box sets it created or that the owner adopted. Managed box sets are tagged `managed:maverick-collections`.
- **Terminology.** The engine's names stay in the code and the MCP tools. The pages use plain words for them (ADR-046, `src/web/terms.ts`):
  - collection (a Jellyfin box set; the pages say "box set" once, in help text)
  - definition → a collection's settings
  - source (a list or search)
  - preset → ready-made collection
  - window → dates; it opens and closes → it appears and goes away
  - plan, proposal and action → a change, to approve
  - mode (Off, Review, Auto) → approval (Never, Ask me, Automatic)
  - global dry run → "Approve everything first"
  - Review queue → Inbox; Dashboard → Home; Activity → History
  - provenance → why a title is in
  - run
- **Undecided** (see `docs/DECISIONS.md`):
  - the visibility strategy beyond create-and-delete
  - the container for holiday episodes
  - the default IMDb search route

## Brand Commitments

- The name is Maverick Jellyfin Complete (chosen 4 Nov; "Maverick Collections" was the working name).
- The owner explicitly does **not** want:
  - **holiday kitsch.** No snowflakes, pumpkins or themed decoration. It must feel like a dependable tool.
  - **an overly technical feel.** No log-viewer or terminal look. It must be calm and easy to scan.
- Seasonal posters come from Kometa's `Default-Images` repo so Jellyfin matches Plex. These are content shown in the UI, not app decoration.

## Evidence on Hand

- Kometa v2.5.3 defaults (seasonal, show franchise, universe, templates) and source counts resolved on 2026-11-02 ([docs/VERIFIED.md](docs/VERIFIED.md)).
- Kometa default poster art at `https://raw.githubusercontent.com/Kometa-Team/Default-Images/master/seasonal/<key>.jpg`.
- Server spikes, 2 Nov, against a real home server: Jellyfin write behaviour, IMDb from the server, owned counts per preset, Plex parity baselines, and Radarr and Sonarr options.
- Review counts and service states in mockups are illustrative and must stay labelled so.

## Product Principles

1. **Nothing changes silently.** Every external change goes through plan → review → apply. Auto is an explicit, guarded choice.
2. **Failure is visible and harmless.** A broken source shows up on the Dashboard and never removes anything.
3. **Explain every item.** Provenance and the reason for a match are always one step away.
4. **Nothing hard-wired to one server.** Libraries, timezone, neighbours and URLs are settings, so the same build can be offered to others (ADR-031).
5. **Mirror Kometa.** Kometa's definitions are the source of truth for presets. The app copies their behaviour first and improves on it only where the owner agrees.
6. **Good neighbour.** The app never touches what it doesn't own, and it stays out of Kometa's and Jellyfin-Auto-Collections' way.

## Accessibility & Inclusion

No specific requirement was stated. The default is WCAG 2.1 AA contrast and full keyboard operation, with light and dark themes.
