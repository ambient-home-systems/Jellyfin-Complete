# Phase 0 spikes

These are throwaway scripts that answered the Phase 0 questions on a real server; [docs/VERIFIED.md](../docs/VERIFIED.md) has the findings. They are not the application, but they still work as a read-only check of your own setup.

- **Read-only by default.** `06-jellyfin-writes.mjs` is the only script that writes. It needs `--i-approve-writes`, only touches `zz-test-*` objects, and deletes them in a `finally` block.
- **No secrets in output.** Every value whose `.env` name contains KEY, TOKEN, PASSWORD or SECRET is redacted from console output and saved files. Paste the console output back into the session.
- **No dependencies.** They need Node 20+ only.

## Setup

1. Copy `.env.example` to `.env` in the repo root and fill it in. `.env` is gitignored.
2. Run the scripts from the repo root, with Node on the server, or in a throwaway container on the host network:

```bash
docker run --rm --network host -v "$PWD":/w -w /w node:22-alpine node spikes/01-jellyfin.mjs
```

## Scripts

| Script | Writes? | Answers |
|---|---|---|
| `01-jellyfin.mjs` | no | Version, live OpenAPI spec (saved to `spikes/out/jellyfin-openapi.json`), required endpoints, libraries, ProviderId coverage, existing box sets (including JAC-tagged and seasonal-name matches), user counts. Writes `spikes/out/library-index.json`. |
| `02-arr.mjs` | no | Radarr and Sonarr versions, quality profiles, root folders, tags, exclusion counts, Radarr collections, lookups by TMDb and TVDB ID. |
| `03-plex.mjs` | no | Every Plex collection with item count, sort title and item GUIDs: the parity baseline. |
| `04-imdb.mjs` | no | Whether this machine can reach IMDb's GraphQL API Kometa's way (one list, one keyword search). Set `SPIKE_LOCATION=server` to label the output. |
| `05-coverage.mjs` | no | Owned matches for all 19 seasonal presets by source, plus Christmas, Halloween and Thanksgiving episodes. Needs `01` first. Flags: `--no-find`, `--letterboxd-full`. |
| `06-jellyfin-writes.mjs` | **yes, only with `--i-approve-writes`** | Box set holding episodes, `!00_` sort title survival, locked fields, base64 poster upload, the tag-gate with a throwaway user, and a public playlist. Cleans up afterwards. |

To run all the read-only spikes in order, from the repo root:

```bash
sh spikes/run-readonly.sh
```

It uses Node 20+ if it's installed. Otherwise it uses Docker, adding `sudo` if your user can't reach the Docker socket. The output is saved to `spikes/out/console.txt`.

To run a single spike (Node or Docker, with `sudo` if needed), from the repo root:

```bash
sh spikes/run-one.sh 06-jellyfin-writes --i-approve-writes
```

Without `--i-approve-writes`, `06` only prints what it would do.

`seasonal-presets.json` is the 19 Kometa v2.5.3 seasonal presets ported from `defaults/movie/seasonal.yml`. Phase 1's golden test checks against it.
