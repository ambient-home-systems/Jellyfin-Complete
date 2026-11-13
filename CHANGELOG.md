# Changelog

Versions follow [semantic versioning](https://semver.org). The release workflow publishes the section matching a tag as that release's notes. 0.5.0 is the first published release.

## 0.6.0 — 13 Nov 2026

- **Claude can change settings.** A new access level for Claude access tokens, **Full control**, lets Claude:
  - change settings: dry run, timezone, plan-ahead days, action modes, Radarr/Sonarr limits, the IMDb route, libraries and home-screen rows
  - change job schedules
  - turn collections on or off

  Every token can now read the settings. Connections and keys stay on the Settings page: Claude can't see or change them. Existing tokens keep their access; create a Full control token for this. See [Let Claude use it](https://github.com/ambient-home-systems/Jellyfin-Complete/blob/main/docs/USER-GUIDE.md#let-claude-use-it).
- **Releases can start from GitHub:** Actions → Release → Run workflow.

## 0.5.0 — 13 Nov 2026

The first published release, so it also includes 0.1.0 to 0.4.0, which were never published (see the [changelog](https://github.com/ambient-home-systems/Jellyfin-Complete/blob/main/CHANGELOG.md)). Install or update with the image `ghcr.io/ambient-home-systems/jellyfin-complete:latest` (amd64 and arm64); the [README](https://github.com/ambient-home-systems/Jellyfin-Complete/blob/main/README.md) has Docker Compose and Portainer steps.

- **Claude access (MCP).** Claude Code or Claude Desktop on a computer on your network can use the app for you through an MCP endpoint at `/mcp`.
  - Create a token in Settings → Claude access: **Read only**, or **Read, review and run**.
  - Read only covers status, collections, Review, Missing and Activity. Read, review and run can also approve, snooze or dismiss proposals and start a run.
  - Approving through Claude works exactly like Review's Approve button: it applies straight away, even in dry run.
  - See [Let Claude use it](https://github.com/ambient-home-systems/Jellyfin-Complete/blob/main/docs/USER-GUIDE.md#let-claude-use-it).
- **Ready-made images.** Nobody has to build the image.
  - Each release publishes `:latest` and its version (`:0.5.0`, `:0.5`).
  - Every change to `main` publishes `:main`.
  - The README covers Portainer, including moving a `docker compose` install into it.
- **Fixed:**
  - On phones, the navigation rail filled the whole screen and covered the page. It's now a tab bar along the bottom. On tablets, the rail shows the logo again.
  - Getting started showed a bare count beside each kind of collection ("Show franchises 27"), which read like titles found on your server. It now says how many collections each kind can make, and that a franchise or universe collection needs at least 2 of its titles.
  - The interface no longer names Kometa where it isn't about Kometa, and the Plex token's hint says what it's for.

## 0.4.0 — 4 Nov 2026 (not published)

Getting ready for other people's servers (Phase 4).

- **Security for installs reachable beyond a home network:**
  - **First-run setup code.** Until Jellyfin is connected, setup asks for a code printed in the log at start-up (or set with `SETUP_CODE`).
  - **Sign-in limit.** Five failures per address or username in 15 minutes locks that address or username for 15 minutes.
  - **`TRUST_PROXY`** for running behind a reverse proxy. See [docs/REVERSE-PROXY.md](docs/REVERSE-PROXY.md).
  - **More security headers,** plus HSTS over HTTPS.
- **Getting started guide** after the first sign-in: libraries, timezone, TMDb key, which preset families to turn on, existing box sets, and a first dry run.
- **Jellyfin compatibility.** 10.10 and later is supported. Every API call is checked against the published specs for 10.10.7, 10.11.0, 10.11.8 and 12.4.0, and 12.4 is tested on a real server. Older servers are refused before anything is planned. See [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).
- **Releases.**
  - The version is shown in the app.
  - CI runs on every push.
  - Tagged releases publish a multi-arch (amd64, arm64) image to GitHub Container Registry.
  - The image's default timezone is UTC. `TZ` now only seeds the timezone setting on first start.
- **Fixed:**
  - Saving Settings → Libraries with every library ticked failed with an error.
  - `OfficialRating` and `ProductionYear` were requested as `Fields` values, which no Jellyfin version accepts.

## 0.3.0 — 3 Nov 2026 (not published)

Home-screen rows (Phase 3).

- **A row per live collection** on Jellyfin's home screen, through the Home Screen Sections and Collection Sections plugins. A row shows only while its collection is live. Seasonal films and holiday episodes have rows by default. The feature is off until you turn it on in Settings. See [docs/PHASE3.md](docs/PHASE3.md).

## 0.2.0 — 3 Nov 2026 (not published)

Episodes, Plex and Radarr/Sonarr (Phase 2).

- **Holiday episodes:** Christmas, Halloween and Thanksgiving episode collections. Sources are an IMDb search scoped to the series you own, plus episode-title suggestions.
- **Plex parity:** a panel in the collection editor comparing each collection with the one Kometa built in Plex. A Plex collection can also be a source.
- **Radarr and Sonarr:**
  - A Missing page listing what each collection's sources name that you don't own.
  - Sending titles to Radarr or Sonarr, with live options and guardrails (released only, not already present, not excluded, a cap per run).
  - Optional automatic sending per collection.
  - Monitoring TMDb collections in Radarr.
- See [docs/PHASE2.md](docs/PHASE2.md).

## 0.1.0 — 2 Nov 2026 (not published)

The first working version (Phase 1).

- **The 19 Kometa seasonal collections**, plus 17 universe and 27 show franchise presets (off by default), checked against Kometa v2.5.3's YAML.
- **Plan → review → apply.**
  - Modes for each action type (Off, Review, Auto), globally and per collection.
  - Dry run on at first start.
  - Remembered dismissals and snoozes.
  - Planning 14 days before a window opens.
  - A failed source never empties a collection.
  - Undo for every change.
- **Sources:**
  - IMDb lists and searches, using Kometa's query and with a snapshot fallback
  - MDBList
  - TMDb collections, keywords, lists, films and shows
  - Letterboxd
  - Jellyfin queries
- **Collections you can build and edit:** custom collections, a live preview with the reason each title is in, pins and excludes, and adopting box sets that already exist.
- **Visibility out of season:** delete and recreate (Kometa's way), or keep the box set hidden with a blocked tag.
- **One Docker image,** with a Portainer stack file.
