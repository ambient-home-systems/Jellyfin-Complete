# Where the data comes from

The app runs on your server and fetches what each collection's sources need, from your server's own address. Read this before relying on it: some sources aren't official APIs.

| Source | What the app reads | Key | How it's spared | Things to know |
|---|---|---|---|---|
| **IMDb** | Lists, searches and charts through IMDb's own GraphQL queries, the way Kometa does | No | Each source refreshes at most daily, or weekly out of season; the last good result is kept | **Not an official public API.** IMDb could change it or block servers that call it a lot. If that happens to you, the [snapshot route](IMDB-SNAPSHOT.md) moves the calls elsewhere. Don't scrape IMDb pages: the app never does. |
| **Kometa's hash files** | IMDb's query hashes, from [Kometa-Team/IMDb-Hash](https://github.com/Kometa-Team/IMDb-Hash) | No | Fetched once per run; the last good copy is kept | Maintained by the Kometa team for Kometa users. |
| **Kometa's hosted IMDb service** | The same searches, run by Kometa's servers | No | **Off by default.** An opt-in for checking results against Kometa | Infrastructure the Kometa team runs for Kometa users; please don't leave it on. |
| **Kometa's posters** | Default collection posters from [Kometa-Team/Default-Images](https://github.com/Kometa-Team/Default-Images) | No | Fetched only when a box set is created or loses its poster | Not bundled with the app; they stay their authors' work. |
| **TMDb** | Collections, keywords, lists, films, shows, and IMDb ID lookups; for streaming collections, which services carry each title you own; for status overlays, each show's status; for library health, film and episode runtimes | Free key | Rate-limited to about 35 requests per 10 seconds; lookups cached for 90 days; streaming lookups at most 600 a run, each title once a week; show statuses at most 300 a run, each show once a week; runtimes at most 400 films and 150 seasons a run, cached for months | See TMDb's API terms. This product uses the TMDB API but is not endorsed or certified by TMDB. Streaming data comes from JustWatch, through TMDb. |
| **MDBList** | Public lists | Optional | Daily at most | A key lifts MDBList's anonymous limits. |
| **Letterboxd** | Public list pages, and each film's page once, to find its IMDb/TMDb ID | No | About one film page a second, at most 120 new films per run, and film IDs cached for years | **No public API.** This reads public web pages, which Letterboxd's terms may not allow. Use Letterboxd sources sparingly. |
| **Plex** | Collections and their items, read-only | Plex token | Read at most every 10 minutes for parity | Your own Plex server only. |
| **Radarr / Sonarr** | Library, exclusions, profiles and folders; adds only when you send or approve | API key | Library and exclusions read in bulk, every 5 minutes at most | Your own servers. Nothing is ever removed from them. |
| **Jellyfin** | Your library, box sets, users (for the tag-gate), plugin settings (for home-screen rows), library settings, and each file's probed length and stream titles (for library health) | API key | | Your own server. Only box sets the app created or adopted are changed, plus titles' posters if you turn on poster overlays (originals kept). |

None of these projects is affiliated with, or endorses, this app.
