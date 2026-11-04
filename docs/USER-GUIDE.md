# User guide

## The idea in one minute

- **Collections.** A *collection* is a Jellyfin box set that the app builds and keeps up to date from *sources*: IMDb lists and searches, MDBList, TMDb, Letterboxd, Plex, or your own Jellyfin tags and genres.
- **Windows.** A collection can have a *window*, such as 1 to 31 December. It appears in Jellyfin at midnight on the first day and goes away after the last.
- **Plan, review, apply.** Nothing changes in Jellyfin directly. Each run *plans* the changes (create a box set, add or remove a title, update its poster or sort title). Each change then either applies on its own or waits for you in **Review**, depending on its *mode*.
- **Dry run.** Dry run is on when you first start, so every change waits for you. Turn it off in Settings when the plans look right.

## Each day

| Where | What for |
|---|---|
| **Dashboard** | What needs you, what broke, what's next. The timetable lists the next 120 days of collections opening and closing. |
| **Review** | Proposed changes, grouped by collection. **Approve** applies a change straight away, even in dry run. **Dismiss** means "never this change". **Snooze** means "not now". Dismissed and snoozed changes are remembered, and both can be undone from their tabs. |
| **Activity** | Every run with its log, and every change applied, with who approved it. Any change can be undone once. |

Runs happen at these times:

| Job | Default time | What it does |
|---|---|---|
| Window check | 00:00 | Opens and closes windows at local midnight. It also runs at start-up. |
| Nightly refresh | 02:30 | Re-reads your library and sources, plans everything, and applies what's due. |
| Cache cleanup | Sundays 03:10 | Drops expired cache entries. |

Change the times in Settings → Schedules, or press **Run now** on the Dashboard.

## Modes

Each kind of change has a mode: **Off** (never), **Review** (wait for you) or **Auto** (apply on its own). Set them in Settings → Modes, and override them per collection in its editor.

| Change | Default |
|---|---|
| Create or delete a box set | Auto |
| Add titles | Auto |
| Remove titles | **Review** |
| Update metadata (name, sort title, overview, poster) | Auto |
| Send a film to Radarr or a series to Sonarr | **Review** |

Some rules hold whatever the modes say:

- **A failing source never removes anything.** It keeps its last good result, and its collections make no removals until it recovers.
- **No empty box sets.** A box set is created only once at least its minimum number of titles is approved.
- **Suggestions always wait for Review.** These include titles matched only by an episode's title.
- **Hands off other box sets.** The app never touches a box set it didn't create or adopt.

## Collections

The ready-made **presets** come in families. Turn single ones on or off under Collections.

| Family | Comes from | Starts |
|---|---|---|
| Seasonal (19) | Kometa's seasonal collections | On |
| Holiday episodes (3) | Christmas, Halloween and Thanksgiving episodes from your shows | On (additions wait for review) |
| Universes (17) | Kometa's universe collections | Off |
| Show franchises (27) | Kometa's show franchise collections | Off |

**New collection** makes your own: films, shows or episodes, always on or between two dates, from any sources.

### In the editor

- **Schedule.** Always on, or between two dates each year. A range can wrap past New Year.
- **Sources.** Paste an ID, a URL or keywords. A source can **add** titles directly or only **suggest** them for Review. A source the app hasn't fetched yet is fetched on the next run.
- **Live preview.** What the collection would hold right now, with the reason each title is in. **Pin** a title to keep it whatever the sources say; **exclude** one to keep it out.
- **Output in Jellyfin:**
  - **Minimum items:** below this, the box set isn't created, or it's deleted.
  - **Sync or append:** sync removes titles that have left every source; append never removes.
  - **Sort title.**
  - **Home-screen row.**
- **When the window is closed.** Either delete the box set (Kometa's way; the poster and sort title come back next season), or keep it hidden with a blocked tag. Hiding keeps the same box set with its titles, but adds a tag to every Jellyfin user's blocked tags.
- **Plex parity.** If Plex is connected, compares the collection with the one Kometa built in Plex and explains each difference.

### Box sets you already have

**Collections → Existing box sets** lists box sets with the same names as your collections, and leftovers from Jellyfin-Auto-Collections. You can:

- **adopt** a box set: the app manages it from then on
- **delete** a box set: its titles stay in your library
- **leave** it alone

If another tool builds the same collections, remove them from that tool first so the two don't fight.

## Missing titles, Radarr and Sonarr

**Missing** lists what each collection's sources name that isn't in your library, best-ranked first, with each title's status in Radarr or Sonarr. Select titles and **Send to Radarr/Sonarr**, or **Send to Review instead**.

- **Checks.** Before every add, the app checks again that the title is released, not already in Radarr/Sonarr, and not on their exclusion list.
- **Limits.** Sends are capped, 10 at a time by default (Settings → Run and review). Nothing is ever removed from Radarr or Sonarr.
- **TMDb collections.** For a collection with TMDb collection sources, **Monitor in Radarr** lets Radarr add the missing films itself as they're released.
- **Automatic sending.** To have runs propose adds, tick **Send missing titles…** in the collection's editor. Proposals follow the Radarr/Sonarr modes, Review by default.

Choose the defaults (quality profile, root folder, tags and so on) in Settings → Radarr and Sonarr.

## Home-screen rows

With the Home Screen Sections and Collection Sections plugins installed in Jellyfin, each live collection that asks for one gets a row on the home screen while it's live. Turn this on in Settings → Home-screen rows. See [PHASE3.md](PHASE3.md) for how it works and its limits.

## Troubleshooting

| You see | What to do |
|---|---|
| A source **failing** or **from cache** on the Dashboard | Its message says why: a missing key, a list that moved, or a site that refused. Its collections keep their titles until it recovers. |
| "Nothing in your library matches" | The source lists titles you don't have, or Jellyfin has no IMDb/TMDb IDs for them. Refresh their metadata in Jellyfin, and add a TMDb key. |
| **IMDb query hashes** failing | IMDb changed its query. Kometa's hash files usually catch up within a day. Until then, IMDb sources serve their last good results. If IMDb blocks your server for good, see [IMDB-SNAPSHOT.md](IMDB-SNAPSHOT.md). |
| A run **failed** with "older than 10.10.0" | Update Jellyfin. See [COMPATIBILITY.md](COMPATIBILITY.md). |
| "Too many failed sign-ins" | Wait 15 minutes. It's per address and per username. |
| Lost the **setup code** | Restart the container. A new code is printed in its log for as long as Jellyfin isn't connected. |

## Back up and move

Everything lives in `/config`:

- the database
- `secret.key`, which decrypts the saved API keys
- logs

Back up the whole folder, and keep `secret.key` with the database. To move to a new machine, copy `/config` and start the same image there.
