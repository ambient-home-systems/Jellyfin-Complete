# Jellyfin versions

| Jellyfin | Status | What that means |
|---|---|---|
| 12.4 | **Tested on a real server** | All write behaviours were verified by the Phase 0 spikes (`spikes/06`), and it has run nightly since. |
| 10.11 (10.11.0 and 10.11.8 checked) | **API-checked** | Every endpoint, query parameter, item field and enum value the app uses exists in this version's published API. It hasn't been run on a real 10.11 server yet. |
| 10.10 (10.10.7 checked) | **API-checked** | As for 10.11. |
| Older than 10.10 | **Not supported** | The setup page refuses the server, and runs stop before planning anything. |
| Newer than 12.4 | **Untested** | It will probably work. The Dashboard says so; check the first dry run before approving changes. |

The app checks the version when you connect Jellyfin, on Settings → Connections → Test, and at the start of every run. A version that is only API-checked or untested shows on the Dashboard under Service notices.

## How "API-checked" works

- **The declared surface.** `src/clients/jellyfin/compat.ts` lists exactly what the app relies on: each Jellyfin endpoint and method, the query parameters it sends, the `BaseItemDto` and `UserPolicy` properties it reads and writes back, and the enum values it uses (`ItemFields`, `MetadataField`, `BaseItemKind`, `ImageType`).
- **The extracts.** `test/fixtures/jellyfin-api/<version>.json` holds that slice of each version's published OpenAPI spec. `test/jellyfin-compat.test.ts` fails if any version is missing anything.
- **What it found.** The first run caught `OfficialRating` and `ProductionYear` being requested in `Fields`. They aren't valid `Fields` values in any version (Jellyfin returns them anyway and ignored the request), so they were removed.

To add a Jellyfin call, add it to `compat.ts`, then regenerate the extracts:

```bash
npx tsx scripts/jellyfin-api-surface.ts jellyfin-openapi-10.11.8.json > test/fixtures/jellyfin-api/10.11.8.json
```

- **Where specs come from:** `https://api.jellyfin.org/openapi/stable/jellyfin-openapi-<version>.json` for 10.x, the current one at `https://api.jellyfin.org/openapi/jellyfin-openapi-stable.json`, or `/api-docs/openapi.json` on any server.
- **Adding a version:** add its extract and list it in `API_CHECKED`.

## Behaviour the API spec can't show

These were verified on 12.4 only. Report a difference on another version as a bug.

- `POST /Items/{id}` replaces the whole item, so the app sends back everything it read, including `LockData`.
- Box sets can hold episodes.
- A tag in a user's `BlockedTags` hides a box set from that user but not its items. The API key still sees it.
- `ForcedSortName` is stored as given. `SortName` is normalised (on 12.4, `!00_X` becomes `!0000000000_x`). The app only compares `ForcedSortName`, so the normalisation doesn't matter to it.
- Posters upload as base64 with an `image/*` content type.
- Authentication uses the `Authorization: MediaBrowser Token="…"` header. The legacy methods (`X-Emby-Token`, `api_key`) are never used; 10.11 turns them off by default.
