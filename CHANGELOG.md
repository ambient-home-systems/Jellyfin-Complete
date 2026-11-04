# Changelog

Versions follow [semantic versioning](https://semver.org). The release workflow publishes the section matching a tag as that release's notes. Nothing has been published yet.

## 0.4.0 — unreleased

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
- **Portainer without a copy of the repository.** Docker builds the image straight from GitHub. The README also covers moving a `docker compose` install into Portainer.
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
