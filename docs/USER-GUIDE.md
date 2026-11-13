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

**Turning collections on and off.** Each row on the Collections page has a switch. One click turns that collection on or off, and the page stays where you are. **All on** and **All off** beside each family switch the whole family. For streaming services, All on picks only the services offered in your country. A collection you turn on is planned on the next run. One you turn off has its box set removed on the next run, if it has one. Both follow your dry-run setting and action modes, so with dry run on the change waits in Review. Runs happen at midnight and 2:30 am, or straight away with **Run now**.

| Family | Comes from | Starts |
|---|---|---|
| Seasonal (19) | Kometa's seasonal collections | On |
| Holiday episodes (3) | Christmas, Halloween and Thanksgiving episodes from your shows | On (additions wait for review) |
| New and recent (5) | Kometa's basic collections, Newly Released and New Episodes, plus Recently Added | Off |
| Universes (17) | Kometa's universe collections | Off |
| Film series (one per series you own) | Kometa's movie franchise collections: every TMDb film series you have at least 2 films of | Off |
| Show franchises (27) | Kometa's show franchise collections | Off |
| IMDb charts (5) | Kometa's IMDb chart collections: the titles you own from the Top 250, Most Popular and Lowest Rated charts | Off |
| Streaming services (41) | Kometa's streaming collections: the titles you own that stream on Netflix, Disney+ and 20 more services in your country | Off |

**New collection** makes your own: films, shows or episodes, always on or between two dates, from any sources.

### New and recent

Five collections that follow your library's own dates:

| Collection | Holds |
|---|---|
| Newly Released Movies | Films released in the last 90 days |
| Newly Released Shows | Shows that first aired in the last 90 days |
| New Episodes | Episodes that aired in the last 7 days |
| Recently Added Movies | Films that arrived in the last 30 days |
| Recently Added Shows | Shows with an episode that arrived in the last 30 days |

- Days are whole days, today included. A release date still to come doesn't count.
- **Added means first arrived.** A replaced file, such as a Radarr or Sonarr upgrade, keeps its first date, so upgrades don't show as new.
  - **With Radarr connected,** a film arrived when Radarr first imported it (from Radarr's history). Upgrades don't move that date, and a film you asked Radarr for long before it downloaded counts from the download. This is checked on every run, so it doesn't matter when you connected Radarr. A film with no import in Radarr's history counts from when it was added to Radarr.
  - **Otherwise,** the app remembers the first date it saw each film (by its TMDb ID) and each episode, and a title that was gone for over a week and comes back counts as new.
  - **A show** was added when its newest episode was, so it comes back when a new episode arrives.
- They change every night: titles that have aged out are taken out without waiting for review (unless dry run is on). You can change that, or the number of days, per collection.
- A collection with nothing in it is deleted, and made again when something qualifies.
- After updating to 0.10.0, they start after the next nightly refresh (or a manual run), when the app has read each title's release date.

### Film series

**What it makes.** Film series are the collections Jellyfin used to make itself from TMDb, Kometa-style:
- one collection for each film series you have at least 2 films of
- named from TMDb, without the word "Collection"
- in release order, with TMDb's overview and poster
- new series appear as you add films, and each collection updates as films arrive

Kometa's additions apply, such as Prometheus in Alien and Hobbs & Shaw in The Fast and the Furious.

**Turning it on.** Use Getting started (step 4) or ask Claude. It's one switch for every series, and the next run adds them. It needs a TMDb key. The minimum number of films is a setting (2 by default).

**Your existing series box sets.** If Jellyfin already made them, open **Collections → Existing box sets** after that run. It lists Jellyfin's own series box sets, and says whether each one's TMDb link matches its series and films. **Adopt all suggested** replaces each with a fresh box set holding the same films, with this app's name, overview and artwork; nothing Jellyfin attached carries over.

Which series a film belongs to comes from Jellyfin's TMDb metadata. If Jellyfin has recorded none, the app asks TMDb, a few hundred films per run, and remembers the answers.

### IMDb charts

Five collections: **IMDb Top 250 Movies**, **IMDb Top 250 Shows**, **IMDb Popular Movies**, **IMDb Popular Shows** and **IMDb Lowest Rated Movies**. Each holds the titles you own from that IMDb chart, follows the chart as it changes, and stays all year. The chart's other titles are on the Missing page, ready for Radarr or Sonarr.

Turn them on in Getting started (step 4) or one at a time under Collections. They use the IMDb route in Settings, like every IMDb source.

### Streaming services

A collection for each service, such as **Netflix Movies** or **Disney+ Shows**, holding the titles you own that stream on it in your country. Subscription, free and with-ads offers count; rentals and purchases don't. The services are Kometa's 22: Netflix, Prime Video, Disney+, HBO Max, Hulu, Apple TV, Paramount+, Peacock and more, with some offered in one country only (ITVX and NOW in the UK, Crave in Canada, Movistar Plus+ in Spain).

- **Your country** is set in Settings → Run and review (US by default).
- **Turning them on** in Getting started (step 4) turns on the services offered in your country. Turn single ones on or off under Collections.
- **How it works.** Each run asks TMDb which services carry the titles you own, starting with ones it hasn't asked about, then each title once a week. It asks about at most 600 titles a run, so a big library fills in over a few nights. Until every title has been checked once, nothing is removed from these collections. It needs a TMDb key.

Streaming data comes from JustWatch, through TMDb.

### Box set artwork

Jellyfin fills in an unlocked box set by searching TMDb for its name, and can pick the wrong collection: another collection's poster, backdrop and overview. So for every box set it manages, the app:

- creates it locked, so that search never runs (the titles in it aren't locked)
- sets its TMDb link itself: the series' own for a film series, none for anything else
- gives it this app's poster (TMDb's for a film series, Kometa's for presets) or none, and no backdrop, logo, thumb, banner or art
- checks all of that every run, with its lock, name and overview, and puts back anything else changed. Each repair shows on the Dashboard for a week.

Some things follow from that:
- A box set found unlocked is replaced by a fresh locked one with the same titles. Locking it in place would lock every title in it.
- The poster is whatever the collection's **Poster** section says (in its editor): an image address, an image you upload, the preset's own, or none. A poster added in Jellyfin instead is removed.
- If "Automatically add to collection" is on for a Jellyfin library, the Dashboard warns you: Jellyfin makes unlocked box sets of its own. Turn it off in Jellyfin: Dashboard → Libraries, open the library's menu → Manage library.

### In the editor

- **Schedule.** Always on, or between two dates each year. A range can wrap past New Year.
- **Sources.** Paste an ID, a URL or keywords. **Released in the last … days** and **Added in the last … days** take a number of days (for an episode collection, released means aired). An **IMDb chart** source takes top, popular or lowest; a **Streaming service** source takes a service's name (for a collection of films or of shows). A source can **add** titles directly or only **suggest** them for Review. A source the app hasn't fetched yet is fetched on the next run.
- **Live preview.** What the collection would hold right now, with the reason each title is in. **Pin** a title to keep it whatever the sources say; **exclude** one to keep it out.
- **Output in Jellyfin:**
  - **Minimum items:** below this, the box set isn't created, or it's deleted.
  - **Sync or append:** sync removes titles that have left every source; append never removes.
  - **Sort title.**
  - **Home-screen row.**
- **When the window is closed.** Either delete the box set (Kometa's way; the poster and sort title come back next season), or keep it hidden with a blocked tag. Hiding keeps the same box set with its titles, but adds a tag to every Jellyfin user's blocked tags.
- **Plex parity.** If Plex is connected, compares the collection with the one Kometa built in Plex and explains each difference.
- **Poster.** An image address, an image you upload (JPEG, PNG or WebP, up to 10 MB), the preset's own poster, or none. Saving puts it on the box set in Jellyfin straight away. Uploads are kept in `/config/posters`.

### Box sets you already have

**Collections → Existing box sets** lists box sets with the same names as your collections, and leftovers from Jellyfin-Auto-Collections. You can:

- **adopt** a box set: it's replaced by a fresh, locked box set with the same titles and this app's name, overview and artwork, which the app manages from then on. Nothing Jellyfin attached to the old one carries over, because Jellyfin may have linked it to the wrong TMDb collection (see [Box set artwork](#box-set-artwork)).
- **delete** a box set: its titles stay in your library
- **leave** it alone

If another tool builds the same collections, remove them from that tool first so the two don't fight.

## Library health

The app checks each film and episode against its title. **Library health** in the menu (with a count of files needing review) shows how much of the library has been checked, what needs review and what's been reviewed, by library. It flags a file for:

- **Length:** the file runs more than 12 minutes or 15% (whichever is larger) longer or shorter than it should. A two-hour film has to be 18 minutes out; an episode, 12.
  - A film is measured against TMDb's runtime.
  - An episode is measured against TMDb's runtime too, unless TMDb lists the whole season at a different length. Some networks list the TV slot, ads included: *Dirty Jobs* at 60 minutes for 42-minute files. Then the episode is measured against the season's typical (median) file length, so only the odd ones out are flagged: an episode with the ads left in, two episodes in one file, a double-length crossover. A season with fewer than three files uses the whole show's typical length. When TMDb has no runtimes, the typical length is used too.
  - A file about twice the typical length says it may contain two episodes, and whether the next episode also has its own file. A file Jellyfin already knows holds two episodes ("S07E13-E14") is expected to be twice as long.
- **Title tags:** a title tag inside the file names another title, for example "Bewitched (2005)" on *Black Panther: Wakanda Forever*. A tag with the same year is treated as a translated title and left alone.

Each finding shows the library, the rating and the file's path. Check it by playing it.
- **It's fine** moves it to Reviewed, with who marked it and when, until the file changes.
- **Several at once:** tick findings and choose **Mark selected fine**, or pick a show and choose **Mark all for this show fine**.
- **Review again** puts it back.
- A finding that's no longer true goes away by itself.

The app never moves, deletes or hides files.

Each file is checked once, and again when it changes, a few thousand a night, so a big library is covered over a few nights. Extended editions much longer than TMDb's runtime show up too: mark them fine once. Turn the check off in Settings → Run and review.

## Missing titles, Radarr and Sonarr

**Missing** lists what each collection's sources name that isn't in your library, best-ranked first, with each title's status in Radarr or Sonarr. Select titles and **Send to Radarr/Sonarr**, or **Send to Review instead**.

- **Checks.** Before every add, the app checks again that the title is released, not already in Radarr/Sonarr, and not on their exclusion list.
- **Limits.** Sends are capped, 10 at a time by default (Settings → Run and review). Nothing is ever removed from Radarr or Sonarr.
- **TMDb collections.** For a collection with TMDb collection sources, **Monitor in Radarr** lets Radarr add the missing films itself as they're released.
- **Automatic sending.** To have runs propose adds, tick **Send missing titles…** in the collection's editor. Proposals follow the Radarr/Sonarr modes, Review by default.

Choose the defaults (quality profile, root folder, tags and so on) in Settings → Radarr and Sonarr.

## Poster overlays

Kometa-style badges on your posters, off until you choose them in **Settings → Poster overlays**:

- **Status on shows:** AIRING (an episode in the last 14 days), RETURNING, CANCELED or ENDED, top left. The status comes from TMDb, or from Jellyfin when TMDb has none.
- **IMDb Top 250 ribbon:** on films and shows in IMDb's Top 250, bottom right.

**Before anything changes,** the section shows how many posters would change and previews a few, drawn on their own posters.

- **Apply now** changes them, even while dry run is on.
- After that, each run keeps them up to date while dry run is off. With dry run on, runs only report what would change.
- **Remove all overlays** puts every original back.

**Your originals are kept.**
- The badges go on a copy at the poster's own size. The original is saved in `/config/overlays/originals`, and goes back when you turn a badge off or remove them all.
- If Jellyfin gets a new poster (a metadata refresh, or one you picked), the new one becomes the original and the badges go back on it.
- Back up `/config` with that folder in it.
- If Jellyfin saves artwork into your media folders, the badged poster is saved there too, and removing the overlays puts the original back there as well.

**Which libraries.** Only titles in the libraries chosen under Settings → Libraries get overlays, and you can untick any of them in Settings → Poster overlays.
- **Kids' libraries get none unless you tick them.** A library counts as a kids' library when its name says so (Kids, Children's, Family, Cartoons, Disney, Pixar, Animated…) or at least 80% of its rated titles have children's ratings (G, PG, TV-Y, TV-Y7, TV-G).
- Unticking a library takes its overlays off on the next update, putting the originals back.
- Box sets never get overlays.

## Home-screen rows

With the Home Screen Sections and Collection Sections plugins installed in Jellyfin, each live collection that asks for one gets a row on the home screen while it's live. Turn this on in Settings → Home-screen rows. See [PHASE3.md](PHASE3.md) for how it works and its limits.

## Let Claude use it

Claude Code or Claude Desktop, on a computer on your home network, can use the app for you through MCP. You can ask, for example:
- "What's waiting in Review?"
- "Which Christmas films am I missing?"
- "Approve the Thanksgiving additions."

1. **Create a token** in Settings → Claude access. Name it after where you'll use it, and choose what it may do:
   - **Read, review and run**
   - **Full control (except connections and keys)**
   - **Read only**

   The token is shown once, with the Claude Code command and the Claude Desktop config already filled in.
2. **Claude Code:** run the command shown. Then `claude mcp list` should show `maverick … Connected`.
   ```bash
   claude mcp add --transport http maverick http://<host>:8097/mcp --header "Authorization: Bearer <token>"
   ```
3. **Claude Desktop:** paste the config shown into `claude_desktop_config.json` (Settings → Developer → Edit config), then restart Claude Desktop.
   - It uses the `mcp-remote` bridge, which needs Node.js on that computer.
   - Settings → Connectors won't work for this: it expects a server that's reachable from the internet.

| Claude can | Read only | Read, review and run | Full control |
|---|---|---|---|
| See status, settings, collections and their titles, Review, Missing, Activity and runs | ✓ | ✓ | ✓ |
| Approve, snooze or dismiss proposals in Review | | ✓ | ✓ |
| Start a run | | ✓ | ✓ |
| See why a title is in or out of a collection, compare with Plex, see existing box sets and Radarr/Sonarr options | ✓ | ✓ | ✓ |
| Change settings and job schedules | | | ✓ |
| Create, edit, delete and turn collections on or off, with their dates, minimum, filters and sources; pin or exclude titles | | | ✓ |
| Adopt or delete existing box sets, undo changes, send missing titles to Radarr or Sonarr, update home-screen rows | | | ✓ |
| See or change connections and keys, or Claude access tokens | | | |

Connections and keys stay on the Settings page. If Claude could change an address, someone with a leaked token could point it at their own server, and the app would send your saved key there.

**Approving through Claude does the same as pressing Approve in Review:**
- The change applies to Jellyfin straight away, even with dry run on.
- Activity shows "Claude (*token name*)" as who approved it.

Claude is told to show you each change and wait for your yes, and to ask before turning dry run off, setting a mode to auto, or turning a collection off. Still, treat a review token like a password. Revoking it in Settings → Claude access stops it at once.

The Claude app on the web or on a phone can't connect: Claude would reach the app from Anthropic's servers, which can't see your home network.

## Troubleshooting

| You see | What to do |
|---|---|
| A source **failing** or **from cache** on the Dashboard | Its message says why: a missing key, a list that moved, or a site that refused. Its collections keep their titles until it recovers. |
| "Nothing in your library matches" | The source lists titles you don't have, or Jellyfin has no IMDb/TMDb IDs for them. Refresh their metadata in Jellyfin, and add a TMDb key. |
| **IMDb query hashes** failing | IMDb changed its query. Kometa's hash files usually catch up within a day. Until then, IMDb sources serve their last good results. If IMDb blocks your server for good, see [IMDB-SNAPSHOT.md](IMDB-SNAPSHOT.md). |
| A run **failed** with "older than 10.10.0" | Update Jellyfin. See [COMPATIBILITY.md](COMPATIBILITY.md). |
| "Too many failed sign-ins" | Wait 15 minutes. It's per address and per username. |
| Lost the **setup code** | Restart the container. A new code is printed in its log for as long as Jellyfin isn't connected. |
| Claude can't connect | Open `http://<host>:8097/healthz` from that computer: it should say `ok`. A 401 means the token is wrong or revoked; create a new one. After ten wrong tokens, that address waits 15 minutes. |

## Back up and move

Everything lives in `/config`:

- the database
- `secret.key`, which decrypts the saved API keys
- `overlays/originals`, the original posters while poster overlays are on
- `posters`, the posters you uploaded for collections
- logs

Back up the whole folder, and keep `secret.key` with the database. To move to a new machine, copy `/config` and start the same image there.
