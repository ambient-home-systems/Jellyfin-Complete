# IMDb snapshot route

The app normally asks IMDb directly, with the same GraphQL queries Kometa uses (ADR-011, route 1). If IMDb ever refuses your server, switch to the snapshot route. A scheduled job somewhere IMDb doesn't refuse runs the same queries once a day and publishes the results as one JSON file. The app then reads that file instead of calling IMDb.

The job uses the same resolver code as the app (`src/imdb/`), so the results are identical.

## What's in a snapshot

- **Presets.** Every IMDb list, search and chart the presets use (seasonal, universes, show franchises, IMDb charts), whether or not they're turned on. Snapshots made before 0.9.0 have no charts; run the job again for them.
- **Your collections.** Any IMDb sources from your own collections, if you give the job your query list (step 3 below).

A full snapshot of the presets is about 0.5 MB and takes about a minute to build.

## Set it up with GitHub Actions

1. **Create a private repository** with a copy of this app's source code.
2. **Add the workflow.** Copy `docs/imdb-snapshot.workflow.example.yml` to `.github/workflows/imdb-snapshot.yml` and commit it. It runs daily and pushes `imdb-snapshot.json` to a branch called `imdb-snapshot`.
3. **Add your own collections (optional).** In the app, open **Settings → IMDb** and use **Download the query list**. Commit the file as `queries.json` at the repository root, and do this again whenever you add IMDb sources.
4. **Run it once.** Go to **Actions → IMDb snapshot → Run workflow**.
5. **Make a token.** In GitHub, create a fine-grained token with **read-only Contents** access to that one repository.
6. **Point the app at the snapshot.** In **Settings → IMDb**, choose **Daily snapshot** and enter:
   - **Snapshot URL:** `https://raw.githubusercontent.com/<you>/<repo>/imdb-snapshot/imdb-snapshot.json`
   - **Access token:** the token from step 5. It's sent as a bearer token and stored encrypted.

## Run it anywhere else

The script needs Node 22 and network access to IMDb and raw.githubusercontent.com (for Kometa's query hashes):

```bash
npm run imdb:snapshot -- --out imdb-snapshot.json
```

- **Add the query list:** `--queries queries.json`.
- **Read the app's own database instead (read-only):** `--db /config/maverick.db`.

Publish the file anywhere the app can fetch it over HTTP(S).

## How the app treats it

- **Reads.** The snapshot is read once per run.
- **Stale snapshots.** A snapshot older than **3 days** counts as a failed source. Each collection keeps its last good result and makes no removals until a fresh snapshot arrives (ADR-008).
- **Missing queries.** A list, search or chart that isn't in the snapshot fails with "Not in the IMDb snapshot". Add it with the query list and run the job again.
