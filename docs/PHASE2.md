# Phase 2

Started 3 Nov, after the Phase 1 dry run on the server checked out.

## Built

| | What | Decisions |
|---|---|---|
| Holiday episodes | Christmas, Halloween and Thanksgiving Episodes: one box set per holiday across every TV library, open on the film preset's dates. Sources: an IMDb episode search scoped to the series you own (50 per search), plus episode-title suggestions. Additions go to Review by default. Custom collections can hold episodes too. | ADR-017, ADR-018 |
| Plex parity | Collection editor → Plex parity: the same-named Plex collection against this app's plan, with each difference explained. A `plex_collection` source mirrors any Plex collection by ID. Read-only. | ADR-024 |
| Radarr and Sonarr | A **Missing** page per collection: what its sources list that you don't own, each title's Radarr/Sonarr status, and "Send to Radarr/Sonarr" or "Send to Review". It also offers "Monitor in Radarr" for TMDb collections. Per collection, you can turn on sending missing titles automatically; it's off by default. Defaults (profile, root folder, tags and so on) are read live in Settings. | ADR-007, ADR-027 |

## Guardrails for Radarr and Sonarr

Each add is checked first:

- **Released:** in Radarr, status `released` or a past digital/physical release; in Sonarr, aired and not `upcoming`.
- **Not already in Radarr/Sonarr.**
- **Not on their exclusion list.**

Automatic adds are capped per run, 10 by default; the rest wait in Review. A manual send is limited to the same number of titles at a time. Nothing in this app removes anything from Radarr or Sonarr.

## Not in Phase 2

- **Missing episodes.** These remain Sonarr's own job.
- **Per-collection option overrides in the editor.** The data model supports them (`definition_arr.options`); the Missing page's send panel covers one-off changes.
- **Home-screen rows.** These are Phase 3 (ADR-025).
