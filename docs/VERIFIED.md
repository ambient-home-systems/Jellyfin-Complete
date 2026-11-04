# What was verified on a real server

Before building, the design's assumptions were checked with throwaway scripts ([spikes/](../spikes/README.md)) against a real home server: Jellyfin 12.4.0, Plex, Radarr 6.4 and Sonarr 4.0, plus IMDb from both the cloud and the server. These are the findings that hold for any install. Test objects were named `zz-test-*` and deleted afterwards.

## Jellyfin 12.4

| Check | Result |
|---|---|
| A box set holding films and an episode | Works, so holiday-episode collections are box sets |
| `POST /Items/{id}` with the full item | 204. It replaces the whole item, so the app always sends back everything it read, including `LockData`. |
| `ForcedSortName "!00_X"` | Kept as given. `SortName` comes back normalised as `!0000000000_x`: lower case, `-` removed, digits padded to 10. `!` and `_` survive, so seasonal sets still sort first. |
| `LockedFields [Name, Overview, Tags]` | Kept; `LockData` stays false, and the box set's films stay unlocked |
| `DisplayOrder: SortName` | Kept |
| Poster upload as base64 text with `image/jpeg` | 204, Primary image present |
| Deleting a box set | Its films and episodes stay in the library |

Tag-gate, a blocked tag on a user (ADR-010):

| Check | Result |
|---|---|
| Box set listed after its tag is added to the user's `BlockedTags` | No |
| Direct fetch of the box set as that user | 404 |
| Its films and episode, fetched by ID or in a library search | Visible |
| The app's API key reading the hidden box set | Still works |

It applies per user, administrators included.

## IMDb

| Route | List (`TitleListMainPage`) | Keyword search (`AdvancedTitleSearch`) |
|---|---|---|
| From a cloud machine | All 23 items | 1,185 matches, the top 500 kept |
| From a home server | All 23 items | The same |
| Kometa's hosted service | n/a | The same 500 IDs as the direct call |

- **`imdb_search`.** Kometa 2.5.3 sends every `imdb_search`, including `list.any`, to its hosted service. That sorts by popularity and caps at 500, so `list.any` is one search, not a union of lists (ADR-012). Four seasonal presets list more than 500 titles.
- **Owned-series scoping.** An episode search scoped to about 50 owned series found 34 Christmas episodes; the same search unscoped finds 16,819. Holiday episodes are built on this (ADR-017).

## Other services

- **Radarr and Sonarr.**
  - Exclusions are at `/api/v3/exclusions/paged` (Radarr) and `/api/v3/importlistexclusion/paged` (Sonarr).
  - Lookups by `tmdb:` and `tvdb:` return the library entry when there is one, and Radarr's say whether the title is excluded.
  - A Radarr collection only appears once one of its films is in Radarr.
- **Plex.** Collections and their items, with `imdb://`, `tmdb://` and `tvdb://` GUIDs, are readable with a token. Kometa's seasonal sets use the sort title `!00_<name>`, and Kometa deletes them out of season.
- **Coverage.** In a library without IMDb IDs on many episodes (common for children's shows), episode matching has to fall back to series + season and episode numbers. Title suggestions help most there.
- **Letterboxd.** Public list pages were reachable from a home server.

See also [COMPATIBILITY.md](COMPATIBILITY.md) for other Jellyfin versions.
