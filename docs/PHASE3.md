# Phase 3: home-screen rows

Started 3 Nov. ADR-025, amended the same day after reading both plugins' source.

## What it does

Each live collection that asks for one gets a row on the Jellyfin home screen. The row appears when the collection goes live and disappears when it closes.

- **Defaults.** Seasonal films and holiday episodes ask for a row; other collections can turn one on in the editor (Output in Jellyfin). The feature as a whole is **off** until you turn it on in Settings → Home-screen rows.
- **Plugins needed.** It uses two Jellyfin plugins by IAmParadox27, from `https://www.iamparadox.dev/jellyfin/plugins/manifest.json`:
  - **Home Screen Sections**, which replaces the home screen with sections and decides which ones users see
  - **Collection Sections**, which turns a box set into a section of up to 16 titles

## How

| Plugin | What the app writes | Why |
|---|---|---|
| Collection Sections | One entry per collection that wants a row: `maverick-<slug>`, with the box set's name | Entries register at save time and only unregister on a Jellyfin restart, so they stay permanently |
| Home Screen Sections | `SectionSettings[].Enabled` for each of those entries: on while the box set is live, off otherwise, with user override off | Showing and hiding takes effect without a restart. It also avoids Collection Sections' startup cache, which can keep a deleted or hidden box set until a restart |

The same rules as everywhere else in the app apply:

- **Ownership:** only entries starting `maverick-` are touched.
- **Writes:** each plugin's configuration is read, changed and written back whole.
- **Dry run:** nothing is written in dry run. "Update rows in Jellyfin now" in Settings is an explicit approval.
- **Clients:** after a change, the app asks Home Screen Sections to bust its cache, so open apps pick up the change.

## Limits

- **Up to 16 titles** per row (Collection Sections).
- **The same rows for every user.** Rows can't be per-user, because user override is turned off for them.
- **Delete-and-recreate visibility.** If Jellyfin has been running since before a set was deleted, its row can show last season's titles for a while after the set is recreated. A Jellyfin restart clears it. The tag-gate visibility option keeps the same box set and avoids this.
- **A future merge.** Collection Sections may be merged into Home Screen Sections in a future release (its README, 16 Sep 2026). When that ships, this integration needs revisiting.
