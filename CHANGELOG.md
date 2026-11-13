# Changelog

Versions follow [semantic versioning](https://semver.org). The release workflow publishes the section matching a tag as that release's notes. 0.5.0 is the first published release.

## 0.13.0 — 13 Nov 2026

- **Library health.** The app checks each film and episode against its title, and lists the ones that may not be what they say on a new **Library health** page, counted on the Dashboard:
  - **length:** the file runs more than 12 minutes or 15% (whichever is larger) longer or shorter than TMDb's runtime
  - **title tags:** a title tag inside the file names another title, such as "Bewitched (2005)" on *Black Panther: Wakanda Forever*

  Each finding shows the library, rating and file path. **It's fine** hides one until the file changes. Read-only: the app never moves, deletes or hides files. Each file is checked once (and again when it changes), a few thousand a night. Claude can list findings and mark them fine. On by default; turn it off in Settings → Run and review. See [Library health](https://github.com/ambient-home-systems/Jellyfin-Complete/blob/main/docs/USER-GUIDE.md#library-health).

## 0.12.0 — 13 Nov 2026

**Safety fix: box sets could show another collection's artwork.** Jellyfin fills in an unlocked box set by searching TMDb for its name, and can pick the wrong collection; on one server, "Inside Out" showed an adult collection's poster and "9-1-1" an erotic film's backdrop. Box sets this app created were unlocked, and adopted ones kept whatever Jellyfin had attached. Now:

- **Box sets are created locked,** so Jellyfin's name search never runs. Their titles aren't locked.
- **The app sets each managed box set's TMDb link itself** (a film series' own; none for anything else), **and all its images:** its own poster or none, and no backdrop, logo, thumb, banner or art. It no longer keeps Jellyfin's overview when a collection has none.
- **Adopting replaces the box set** with a fresh locked one holding the same titles, with this app's name, overview and artwork. The adoption screen says when a film series set's TMDb link doesn't match its series. Adopting can't be undone.
- **Every run checks every managed box set**, whatever the dry-run setting: TMDb link, lock, images, name and overview. Anything else changed is put back straight away and shown on the Dashboard. A box set found unlocked is replaced by a fresh locked one, because locking it in place would lock every title in it.
- **The Dashboard warns** while a Jellyfin library has "Automatically add to collection" on.
- **What changes on update:** the first run replaces every managed box set's poster with the app's own and removes backdrops, logos and other images it doesn't supply, including ones you added by hand. Posters you set on your own collections are removed too, since the app has none for them.

## 0.11.0 — 13 Nov 2026

- **Poster overlays.** Kometa's badges on your posters, off until you choose them in Settings → Poster overlays:
  - status on shows: AIRING (an episode in the last 14 days), RETURNING, CANCELED or ENDED, from TMDb or Jellyfin
  - the IMDb Top 250 ribbon on films and shows in IMDb's Top 250

  The section shows how many posters would change, with previews. **Apply now** changes them, even in dry run; after that, runs keep them up to date while dry run is off. The badges go on a copy of each poster: the original is kept in `/config/overlays/originals` and goes back when you turn a badge off or press **Remove all overlays**. If Jellyfin gets a new poster, the badges go on the new one. Claude can choose, apply and remove them too. See [Poster overlays](https://github.com/ambient-home-systems/Jellyfin-Complete/blob/main/docs/USER-GUIDE.md#poster-overlays).
- **Fixed:**
  - Recently Added Shows went by when the series was first added, so a show with new episodes didn't come back. It now goes by its newest episode, as in Plex and Kometa.
  - Recently Added Movies counted replaced files, such as Radarr upgrades, as newly added. The app now remembers when each film and episode first arrived. The first time, films already in your library use Radarr's added date if that's earlier; after that, a film you added to Radarr before release still shows as new when it downloads.

## 0.10.0 — 13 Nov 2026

- **New and recent.** Five collections that follow your library, like Kometa's basic collections:
  - Newly Released Movies and Shows: released or first aired in the last 90 days
  - New Episodes: aired in the last 7 days
  - Recently Added Movies and Shows: added to Jellyfin in the last 30 days

  They change every night. Titles that have aged out are taken out without waiting for review (unless dry run is on); you can change that, or the number of days, per collection. They're off until you turn them on, in Getting started, under Collections or through Claude. They start after the next nightly refresh or a manual run, once the app has read each title's release date.
- **Collection editor:** two new sources, **Released in the last … days** and **Added in the last … days**, for films, shows or episodes.
- See [New and recent](https://github.com/ambient-home-systems/Jellyfin-Complete/blob/main/docs/USER-GUIDE.md#new-and-recent).

## 0.9.0 — 13 Nov 2026

- **Streaming services.** A collection for each service, such as "Netflix Movies" or "Disney+ Shows", holding the titles you own that stream on it in your country. Like Kometa's streaming collections, with its 22 services and posters.
  - Subscription, free and with-ads offers count; rentals and purchases don't.
  - Each run asks TMDb which services carry your titles: new titles first, then each title once a week, at most 600 a run. A big library fills in over a few nights, and nothing is removed until every title has been checked once.
  - Set your country in Settings → Run and review (US by default). Turning the family on in Getting started turns on the services offered there.
  - Needs a TMDb key. Streaming data comes from JustWatch, through TMDb.
- **IMDb charts.** IMDb Top 250, IMDb Popular (films and shows of each) and IMDb Lowest Rated Movies: the titles you own from each chart, following it as it changes. Like Kometa's chart collections. The rest of each chart is on the Missing page.
- Both are off until you turn them on, in Getting started, under Collections or through Claude. Both are also sources in the collection editor, and Claude can set the streaming country.
- **IMDb snapshot route:** snapshots now include the charts. Run the snapshot job again before using the charts on that route.
- See [IMDb charts](https://github.com/ambient-home-systems/Jellyfin-Complete/blob/main/docs/USER-GUIDE.md#imdb-charts) and [Streaming services](https://github.com/ambient-home-systems/Jellyfin-Complete/blob/main/docs/USER-GUIDE.md#streaming-services).

## 0.8.1 — 13 Nov 2026

- **Fixed:**
  - Approving "Create box set" could still answer "Applied 0, waiting for other approvals" when its titles had already been approved (for example by Auto), and the box set only appeared on the next run. A collection's approved changes now apply together.
  - With existing box sets to adopt (such as Jellyfin's own film series sets), a run proposed creating duplicates of them. While a matching box set waits to be adopted, nothing is created for its collection, and the Dashboard says so. Adopting retires proposals made before it.
  - Adopted box sets showed 0 titles (James Bond with all 25 films in Jellyfin, for example). Adopting now records the box set's titles, and every run keeps the count in step with Jellyfin.

## 0.8.0 — 13 Nov 2026

- **Film series.** One collection for each film series you own at least 2 films of (Toy Story, John Wick…), like Kometa's franchise collections.
  - Named and illustrated from TMDb, in release order.
  - New series appear as you add films.
  - Turn it on in Getting started or through Claude.
  - **Collections → Existing box sets** offers Jellyfin's own series box sets for adoption. **Adopt all suggested** takes them all over at once. See [Film series](https://github.com/ambient-home-systems/Jellyfin-Complete/blob/main/docs/USER-GUIDE.md#film-series).
- **Fixed:** external MDBList lists (In Association With Marvel, Middle Earth) still failed after 0.7.0, because MDBList's API has no route for them. They're now read from their public list address, which needs no key. Any list the API answers 404 for falls back to it too.

## 0.7.0 — 13 Nov 2026

- **Full control is full.** The level is now called "Full control (except connections and keys)". With it, Claude can:
  - create, edit and delete collections, including dates, minimum, filters and sources
  - pin or exclude titles
  - adopt or delete existing box sets
  - undo changes
  - send missing titles to Radarr or Sonarr, and change their defaults
  - update home-screen rows

  Every token can also see why a title is in or out of a collection, compare with Plex, and list existing box sets.
- **Fixed:**
  - External MDBList lists (such as `k0meta/external/15110`) were requested without their list number and failed, which broke the In Association With Marvel and Middle Earth universes.
  - A title you accepted from a suggestion was proposed for removal on the next run, then suggested again, over and over. It now stays while a source still suggests it.
  - Approving "Create box set" didn't create it until each title was approved too. Approving it now also approves that collection's pending titles and metadata (not its suggestions), so the box set is created and filled in one step.
  - 9-1-1 now includes 9-1-1: Nashville, and Yellowstone includes Dutton Ranch and The Madison. Existing installs get them on update, and IDs you added yourself are kept.

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
