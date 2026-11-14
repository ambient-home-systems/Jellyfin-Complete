# User guide

## The idea in one minute

- **Collections.** A *collection* is a group of titles in Jellyfin (Jellyfin calls it a box set) that the app builds and keeps up to date from *sources*: IMDb lists and searches, MDBList, TMDb, Letterboxd, Plex, or your own Jellyfin tags and genres.
- **Dates.** A collection can have dates, such as 1 to 31 December. It appears in Jellyfin at midnight on the first day and goes away after the last.
- **Nothing changes without you.** Each run works out the changes (create a collection, add or remove a title, update its poster). Each change then either happens on its own or waits in your **Inbox**, depending on its *approval* setting.
- **Approve everything first.** That's how the app starts: every change waits for you. After your first approvals, Home offers once to let routine changes happen by themselves; you can switch it any time in Settings → Approvals.

## Finding your way

| Where | What for |
|---|---|
| **Home** | What needs you, what broke, what's next. The timetable lists the next 120 days of collections appearing and going away. |
| **Inbox** | Everything waiting for a decision, in one place, with one count in the menu. **Collection changes** are grouped by collection: **Approve** applies a change straight away, **Approve all** does a whole collection, **Snooze** means "not now" and **Dismiss** means "never this change". Snoozed and dismissed changes are remembered, and **Bring back** undoes either. **Library health** and **Missing titles** are tabs here too, once they're switched on. |
| **Collections** | Every collection, with a switch each. **Already in Jellyfin** is its second tab. |
| **History** | Every change made, with who approved it and an **Undo**, and every run with its log. |
| **Settings** | One page per subject: Connections, Libraries and region, Approvals, Schedule, Extras, Advanced. |

Runs happen at these times:

| What runs | Default time | What it does |
|---|---|---|
| Midnight date check | 00:00 | Collections appear and go away on their dates. It also runs at start-up. |
| Nightly refresh | 02:30 | Re-reads your library and sources, works out every change, and applies what's due. |
| Clean-up | Sundays 03:10 | Clears out saved results that have expired. |

Change the times in Settings → Schedule, or press **Run now** on Home.

**Getting started** walks a new install through six steps, one at a time: libraries, timezone, a TMDb key, which collections, collections Jellyfin already has, and your first changes. The first run starts as soon as you've chosen your collections, so its results are waiting by the last step.

## Approvals

Each kind of change has an approval setting: **Never**, **Ask me** (it waits in your Inbox) or **Automatic**. Set them in Settings → Approvals. A single collection can be the exception, under its Advanced tab.

| Change | To begin with |
|---|---|
| Create and remove collections in Jellyfin | Automatic |
| Add titles | Automatic |
| Remove titles | **Ask me** |
| Update name, poster and description | Automatic |
| Send a movie to Radarr or a show to Sonarr | **Ask me** |

While **Approve everything first** is on, every change asks first, whatever is set here.

Some rules hold whatever the settings say:

- **A failing source never removes anything.** It keeps its last good results, and its collections lose nothing until it recovers.
- **No empty collections.** A collection is created in Jellyfin only once at least its fewest number of titles is approved.
- **Suggestions always ask.** These include titles matched only by an episode's title, and titles from a source set to "Ask before adding".
- **Hands off other collections.** The app never touches a collection it didn't create or take over.

## Collections

The **ready-made collections** come in families. Turn single ones on or off under Collections.

**Turning collections on and off.** Each row on the Collections page has a switch. One click turns that collection on or off, the row says what will happen, and **Undo** beside it takes it back. **All on** and **All off** beside each family switch the whole family. For streaming services, All on picks only the services offered in your country. A collection you turn on is read on the next run. One you turn off is removed from Jellyfin on the next run, if it's there. Both follow your approval settings, so while you're approving everything first the change waits in your Inbox. Runs happen at midnight and 2:30 am, or straight away with **Run now**.

| Family | Comes from | Starts |
|---|---|---|
| Seasonal (19) | Kometa's seasonal collections | On |
| Holiday episodes (3) | Christmas, Halloween and Thanksgiving episodes from your shows | On (additions ask first) |
| New and recent (5) | Kometa's basic collections, Newly Released and New Episodes, plus Recently Added | Off |
| Universes (17) | Kometa's universe collections | Off |
| Movie series (one per series you own) | Kometa's movie franchise collections: every TMDb movie series you have at least 2 movies of | Off |
| Show franchises (27) | Kometa's show franchise collections | Off |
| IMDb charts (5) | Kometa's IMDb chart collections: the titles you own from the Top 250, Most Popular and Lowest Rated charts | Off |
| Streaming services (41) | Kometa's streaming collections: the titles you own that stream on Netflix, Disney+ and 20 more services in your country | Off |

**New collection** makes your own: movies, shows or episodes, all year or between two dates, from any sources.

### New and recent

Five collections that follow your library's own dates:

| Collection | Holds |
|---|---|
| Newly Released Movies | Movies released in the last 90 days |
| Newly Released Shows | Shows that first aired in the last 90 days |
| New Episodes | Episodes that aired in the last 7 days |
| Recently Added Movies | Movies that arrived in the last 30 days |
| Recently Added Shows | Shows with an episode that arrived in the last 30 days |

- Days are whole days, today included. A release date still to come doesn't count.
- **Added means first arrived.** A replaced file, such as a Radarr or Sonarr upgrade, keeps its first date, so upgrades don't show as new.
  - **With Radarr connected,** a movie arrived when Radarr first imported it (from Radarr's history). Upgrades don't move that date, and a movie you asked Radarr for long before it downloaded counts from the download. This is checked on every run, so it doesn't matter when you connected Radarr. A movie with no import in Radarr's history counts from when it was added to Radarr.
  - **Otherwise,** the app remembers the first date it saw each movie (by its TMDb ID) and each episode, and a title that was gone for over a week and comes back counts as new.
  - **A show** was added when its newest episode was, so it comes back when a new episode arrives.
- They change every night: titles that have aged out are taken out without asking (unless you're approving everything first). You can change that, or the number of days, per collection.
- A collection with nothing in it is deleted, and made again when something qualifies.
- After updating to 0.10.0, they start after the next nightly refresh (or a manual run), when the app has read each title's release date.

### Movie series

**What it makes.** Movie series are the collections Jellyfin used to make itself from TMDb, Kometa-style:
- one collection for each movie series you have at least 2 movies of
- named from TMDb, without the word "Collection"
- in release order, with TMDb's overview and poster
- new series appear as you add movies, and each collection updates as movies arrive

Kometa's additions apply, such as Prometheus in Alien and Hobbs & Shaw in The Fast and the Furious.

**Turning it on.** Use Getting started (step 4) or ask Claude. It's one switch for every series, and the next run adds them. It needs a TMDb key. The minimum number of movies is a setting (2 by default).

**Your existing series collections.** If Jellyfin already made them, open **Collections → Already in Jellyfin** after that run. It lists Jellyfin's own series collections, and says whether each one's TMDb link matches its series and movies. **Take over all suggested** replaces each with a fresh collection holding the same movies, with this app's name, overview and artwork; nothing Jellyfin attached carries over.

Which series a movie belongs to comes from Jellyfin's TMDb metadata. If Jellyfin has recorded none, the app asks TMDb, a few hundred movies per run, and remembers the answers.

### IMDb charts

Five collections: **IMDb Top 250 Movies**, **IMDb Top 250 Shows**, **IMDb Popular Movies**, **IMDb Popular Shows** and **IMDb Lowest Rated Movies**. Each holds the titles you own from that IMDb chart, follows the chart as it changes, and stays all year. The chart's other titles are under Missing titles in the Inbox, ready for Radarr or Sonarr.

Turn them on in Getting started (step 4) or one at a time under Collections. They read IMDb the way Settings → Advanced says, like every IMDb source.

### Streaming services

A collection for each service, such as **Netflix Movies** or **Disney+ Shows**, holding the titles you own that stream on it in your country. Subscription, free and with-ads offers count; rentals and purchases don't. The services are Kometa's 22: Netflix, Prime Video, Disney+, HBO Max, Hulu, Apple TV, Paramount+, Peacock and more, with some offered in one country only (ITVX and NOW in the UK, Crave in Canada, Movistar Plus+ in Spain).

- **Your country** is set in Settings → Libraries and region (US by default).
- **Turning them on** in Getting started (step 4) turns on the services offered in your country. Turn single ones on or off under Collections.
- **How it works.** Each run asks TMDb which services carry the titles you own, starting with ones it hasn't asked about, then each title once a week. It asks about at most 600 titles a run, so a big library fills in over a few nights. Until every title has been checked once, nothing is removed from these collections. It needs a TMDb key.

Streaming data comes from JustWatch, through TMDb.

### Collection artwork

Jellyfin fills in an unlocked collection by searching TMDb for its name, and can pick the wrong collection: another collection's poster, backdrop and overview. So for every collection it manages, the app:

- creates it locked, so that search never runs (the titles in it aren't locked)
- sets its TMDb link itself: the series' own for a movie series, none for anything else
- gives it this app's poster (the one it came with, Kometa's for universes and show franchises, TMDb's for a movie series) or none, and no backdrop, logo, thumb, banner or art
- checks all of that every run, with its lock, name and overview, and puts back anything else changed. Each repair shows on Home for a week.

Some things follow from that:
- A collection found unlocked is replaced by a fresh locked one with the same titles. Locking it in place would lock every title in it.
- The poster is whatever the collection's **Name and poster** tab says: the one it came with, an image you upload, an image on the web, or none. A poster added in Jellyfin instead is removed.
- If "Automatically add to collection" is on for a Jellyfin library, Home recommends turning it off: Jellyfin makes unlocked collections of its own. Turn it off in Jellyfin: Dashboard → Libraries, open the library's menu → Manage library.

### A collection's page

The top of the page says where the collection stands, in a sentence: whether it's in Jellyfin, how many titles it has, when it next appears or goes away, and how many changes wait for you. The rest is in tabs, and **Save changes** saves all of them at once.

- **Titles.** What the collection holds right now, with the source that lists each title. **Always include** keeps a title whatever the sources say; **Leave out** keeps one out. If Plex is connected, **Compared with Plex** sets the collection beside the one Kometa built in Plex and explains each difference.
- **Sources.** Paste an address from your browser, an ID or keywords. **Released in the last … days** and **Added in the last … days** take a number of days (for an episode collection, released means aired). An **IMDb chart** source takes top, popular or lowest; a **Streaming service** source takes a service's name (for a collection of movies or of shows). Turn on **Ask before adding** for a source whose titles should wait in your Inbox as suggestions. A new source is read on the next run. Adding or removing a source is saved straight away.
  - **Titles you don't have:** tick **Send missing titles…** to have runs suggest them for Radarr or Sonarr.
- **Dates.** All year, or between two dates each year. The dates can run past New Year.
- **Name and poster.** The name, the description, whether it's turned on, and the poster: the one it came with, an image you upload (JPEG, PNG or WebP, up to 10 MB), an image on the web, or none. A new poster goes on the collection in Jellyfin as soon as you save. Uploads are kept in `/config/posters`.
  - **The posters ready-made collections come with** were made for this app: seasonal movies, holiday episodes, New and recent, IMDb charts and streaming services each have one, in one style, with the collection's name set in the app's typeface. Streaming services share a picture in each service's colour. Universes and show franchises use Kometa's posters, and movie series TMDb's.
  - Your choice always wins: an upload, an address or "No poster" stays until you change it. To use Kometa's poster for a ready-made collection instead, paste its address.
- **Advanced.** Most collections never need these.
  - **Fewest titles:** with fewer in your library, the collection isn't created, or it's removed.
  - **When a title leaves every source:** *Keep in step with the lists* removes it from the collection too; *Only ever add* never removes.
  - **Sort title** and **Home-screen row.**
  - **Outside its dates:** remove the collection from Jellyfin (Kometa's way; the poster and sort title come back next time), or keep it, hidden. Hiding keeps the same collection with its titles, but adds a tag to every Jellyfin user's blocked tags.
  - **Approvals for this collection:** make this collection the exception to Settings → Approvals.

### Collections already in Jellyfin

**Collections → Already in Jellyfin** lists collections Jellyfin already has under the same names as yours, and leftovers from Jellyfin-Auto-Collections. You can:

- **take one over:** it's replaced by a fresh, locked collection with the same titles and this app's name, description and artwork, which the app looks after from then on. Nothing Jellyfin attached to the old one carries over, because Jellyfin may have linked it to the wrong TMDb collection (see [Collection artwork](#collection-artwork)).
- **delete** it: its titles stay in your library
- **leave** it alone

If another tool builds the same collections, remove them from that tool first so the two don't fight.

## Library health

The app checks each movie and episode against its title, and each movie's and show's artwork. **Library health**, a tab of the Inbox (its findings count towards the Inbox's number), shows how much of the library has been checked, what needs review and what's been reviewed, by library. It flags a file for:

- **Length:** the file runs more than 12 minutes or 15% (whichever is larger) longer or shorter than it should. A two-hour movie has to be 18 minutes out; an episode, 12.
  - A movie is measured against TMDb's runtime.
  - An episode is measured against TMDb's runtime too, unless TMDb lists the whole season at a different length. Some networks list the TV slot, ads included: *Dirty Jobs* at 60 minutes for 42-minute files. Then the episode is measured against the season's typical (median) file length, so only the odd ones out are flagged: an episode with the ads left in, two episodes in one file, a double-length crossover. A season with fewer than three files uses the whole show's typical length. When TMDb has no runtimes, the typical length is used too.
  - A file about twice the typical length says it may contain two episodes, and whether the next episode also has its own file. A file Jellyfin already knows holds two episodes ("S07E13-E14") is expected to be twice as long.
- **Title tags:** a title tag inside the file names another title, for example "Bewitched (2005)" on *Black Panther: Wakanda Forever*. A tag with the same year is treated as a translated title and left alone.
- **Audio:** the file plays in another language by default, though it has a track in the library's language (a French dub on a kids' movie that has English too).
  - If every Jellyfin user's settings already pick the library's language, it's listed **For information** and not counted. Those settings are a preferred audio language, with "Play default audio track" off.
  - Home names users without those settings.

And each movie's and show's **artwork**:

- **No poster.**
- **Poster from the video or file:** a wide 16:9 picture, like a frame from the video. Or a poster that isn't one of TMDb's for the title and has the same shape as the picture embedded in the file (or the file has one attached).
- **Poster language:** the poster is TMDb's poster in another language, and TMDb has one in the library's language.
  - The library's own language is used, else the server's (Jellyfin: Dashboard → Libraries).
  - If TMDb has none in that language, the poster is kept and a note says so; it isn't flagged.
- **Artwork from another title:** Jellyfin links the title to a different TMDb title than the one its IMDb ID and folder name point to, as with *Inside Out* linked to a lookalike. Also: a collection the app doesn't manage, linked to a TMDb collection its movies aren't in.

**Reset from TMDb** fixes an artwork finding: on one row, or **Reset artwork for selected** for the ones you tick. Nothing resets the whole library.
- It takes TMDb's best-rated poster in the library's language, and optionally the backdrop, logo and thumb too.
- It goes by the title's **confirmed** TMDb ID, never a name search.
  - An ID is confirmed when TMDb's record for it carries the same IMDb ID (or, for shows, TVDB ID) as Jellyfin's, or the folder name ("Inside Out (2015)") says so.
  - Without a confirmed ID there's no reset, only the finding.
- Just before replacing, it reads the title again and checks its ID again. If anything changed since the check, it stops and leaves the finding.
- The old images are kept in `/config/artwork/backups`. **Artwork fixed** lists what was replaced, before and after, with **Undo**.
- A poster with the app's overlays is backed up as its clean original, and the badges go back on the new one.
- Collections the app doesn't manage are only reported. **Take it over** has the app rebuild one cleanly.

**Fixing posters without asking:** in Settings → Extras → Library health, choose libraries where "No poster" and "Poster from the video or file" are fixed on each run, the same way, once you've stopped approving everything first. Everything else waits for you.

**Collection artwork changed** lists the repairs the app made to its own collections in the last 30 days (see Collection artwork).

Each finding shows the library, the rating and the file's path. Check it by playing it.
- **It's fine** moves it to Reviewed, with who marked it and when, until the file changes.
- **Several at once:** tick findings and choose **Mark selected fine**, or pick a show and choose **Mark all for this show fine**.
- **Review again** puts it back.
- A finding that's no longer true goes away by itself.

The app never moves, deletes or hides files.

Each file is checked once, and again when it changes, a few thousand a night, so a big library is covered over a few nights. Artwork is checked a few hundred titles a night: new or changed first, then each title again after a month. Extended editions much longer than TMDb's runtime show up too: mark them fine once. Turn the checks off in Settings → Extras; its tab then leaves the Inbox.

**Reading files' own titles (optional).** Jellyfin shows only the title tags on a file's streams, not the title stored in the file itself. The file's own title is the tag that gave away *Bewitched* inside a file labelled *Black Panther: Wakanda Forever*. To have it checked too:
1. Mount your media folder into the container **read-only**, for example `- /path/to/your/media:/media:ro` under `volumes` (see `docker-compose.yml`). The app's user (uid 1000) must be able to read the files.
2. In Settings → Advanced → **Media files**, turn on "Read each new file's own title", with the folder it's mounted at (`/media` by default).

On the next run, the app works out where Jellyfin's files are under the mount by finding a few of them, so the folders don't have to be named the same. The Settings page shows what it found and how many files it has read.
- **What's read:** only the few kilobytes of each file that hold its title, once per file and again when the file changes. Nothing is ever written.
- **Formats:** Matroska and WebM, MP4, M4V and MOV, and AVI.
- **A finding** reads "The file's own title names ...".

**A frame from the middle.** A flagged file can show one frame from its middle, hidden behind **Show a frame from the middle** until you open it (a mislabelled file can hold anything). It comes from:
- **Jellyfin's trickplay previews,** when Jellyfin has made them for that file. Turn trickplay on per library in Jellyfin (Dashboard → Libraries → the library → Trickplay). No mount or ffmpeg is needed.
- **ffmpeg on the mounted file,** otherwise. The image doesn't include ffmpeg (it would add a few hundred MB for everyone). To use one, mount an ffmpeg binary into the container and set `FFMPEG_PATH` to it.

Frames are kept in `/config/frames` until the file changes.

**Recommendations on Home.** These aren't faults in the app, so Home lists them apart from its problems, each with its steps under **How to fix**.
- **Image fetchers:** a movie or TV library with **Screen Grabber** or **Embedded Image Extractor** turned on as an image fetcher, for Movie, Series or Season. Jellyfin then uses a random frame, or a mislabelled file's own picture, when TMDb has no poster. Turn them off in Jellyfin under the library's Image fetchers. Episode stills are fine.
- **Audio settings:** Jellyfin users with no preferred audio language, or with "Play default audio track" on.

## Missing titles, Radarr and Sonarr

**Missing titles**, a tab of the Inbox once Radarr or Sonarr is connected, lists what each collection's sources name that isn't in your library, best-ranked first, with each title's status in Radarr or Sonarr. Tick titles and **Send to Radarr/Sonarr**, or **Add to Inbox instead** to approve them later.

- **Checks.** Before every send, the app checks again that the title is released, not already in Radarr/Sonarr, and not on their exclusion list.
- **Limits.** Sends are capped, 10 at a time by default (Settings → Approvals). Nothing is ever removed from Radarr or Sonarr.
- **Movie series.** For a collection with TMDb collection sources, **Monitor in Radarr** lets Radarr add the missing movies itself as they're released.
- **Automatic sending.** To have runs suggest sends, tick **Send missing titles…** on the collection's Sources tab. They follow the Radarr and Sonarr approval settings, Ask me to begin with.

Choose how titles are sent (quality profile, root folder, tags and so on) in Settings → Extras → Radarr and Sonarr.

## Poster overlays

Kometa-style badges on your posters, off until you choose them in **Settings → Extras → Poster overlays**:

- **Status on shows:** AIRING (an episode in the last 14 days), RETURNING, CANCELED or ENDED, top left. The status comes from TMDb, or from Jellyfin when TMDb has none.
- **IMDb Top 250 ribbon:** on movies and shows in IMDb's Top 250, bottom right.

**Before anything changes,** the section shows how many posters would change and previews a few, drawn on their own posters.

- **Apply now** changes them, even while you're approving everything first: pressing it is your approval.
- After that, each run keeps them up to date. While you're approving everything first, runs only report what would change.
- **Remove all overlays** puts every original back.

**Your originals are kept.**
- The badges go on a copy at the poster's own size. The original is saved in `/config/overlays/originals`, and goes back when you turn a badge off or remove them all.
- If Jellyfin gets a new poster (a metadata refresh, or one you picked), the new one becomes the original and the badges go back on it.
- Back up `/config` with that folder in it.
- If Jellyfin saves artwork into your media folders, the badged poster is saved there too, and removing the overlays puts the original back there as well.

**Which libraries.** Only titles in the libraries chosen under Settings → Libraries and region get overlays, and you can untick any of them under Poster overlays.
- **Kids' libraries get none unless you tick them.** A library counts as a kids' library when its name says so (Kids, Children's, Family, Cartoons, Disney, Pixar, Animated…) or at least 80% of its rated titles have children's ratings (G, PG, TV-Y, TV-Y7, TV-G).
- Unticking a library takes its overlays off on the next update, putting the originals back.
- Collections never get overlays.

## Home-screen rows

With the Home Screen Sections and Collection Sections plugins installed in Jellyfin, each collection that asks for one gets a row on the home screen while it's in Jellyfin. Turn this on in Settings → Extras → Home-screen rows. See [PHASE3.md](PHASE3.md) for how it works and its limits.

## Let Claude use it

Claude Code or Claude Desktop, on a computer on your home network, can use the app for you through MCP. You can ask, for example:
- "What's waiting in my Inbox?"
- "Which Christmas movies am I missing?"
- "Approve the Thanksgiving additions."

1. **Create a token** in Settings → Advanced → Claude access. Name it after where you'll use it, and choose what it may do:
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
| See status, settings, collections and their titles, the Inbox, History and runs | ✓ | ✓ | ✓ |
| Approve, snooze or dismiss changes in the Inbox | | ✓ | ✓ |
| Start a run | | ✓ | ✓ |
| See why a title is in or out of a collection, compare with Plex, see collections already in Jellyfin and Radarr/Sonarr options | ✓ | ✓ | ✓ |
| Change settings and job schedules | | | ✓ |
| Create, edit, delete and turn collections on or off, with their dates, minimum, filters and sources; always include or leave out titles | | | ✓ |
| Take over or delete collections already in Jellyfin, undo changes, send missing titles to Radarr or Sonarr, update home-screen rows | | | ✓ |
| See or change connections and keys, or Claude access tokens | | | |

Connections and keys stay on the Settings pages. If Claude could change an address, someone with a leaked token could point it at their own server, and the app would send your saved key there.

**Approving through Claude does the same as pressing Approve in the Inbox:**
- The change applies to Jellyfin straight away.
- History shows "Claude (*token name*)" as who approved it.

Claude is told to show you each change and wait for your yes, and to ask before it stops approving everything first, sets a kind of change to Automatic, or turns a collection off. (Claude's tools keep the app's older names for these: dry run, modes, Review. Claude is told the pages' words.) Still, treat a review token like a password. Revoking it in Settings → Advanced → Claude access stops it at once.

The Claude app on the web or on a phone can't connect: Claude would reach the app from Anthropic's servers, which can't see your home network.

## Troubleshooting

| You see | What to do |
|---|---|
| A source **failing** or **using last good results** on Home | Its message says why: a missing key, a list that moved, or a site that refused. Its collections keep their titles until it recovers. |
| "Nothing in your library matches" | The source lists titles you don't have, or Jellyfin has no IMDb/TMDb IDs for them. Refresh their metadata in Jellyfin, and add a TMDb key. |
| **IMDb can't be read** | IMDb changed its query. Kometa's hash files usually catch up within a day. Until then, IMDb sources serve their last good results. If IMDb blocks your server for good, see [IMDB-SNAPSHOT.md](IMDB-SNAPSHOT.md). |
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
