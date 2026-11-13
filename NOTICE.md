# Notices and credits

Maverick Jellyfin Complete is MIT-licensed (see `LICENSE`). It builds on work from these projects.

## Kometa

<https://github.com/Kometa-Team/Kometa>, MIT License, Copyright (c) 2026 meisnate12.

- **Preset definitions.** The seasonal, show franchise, universe, new and recent, IMDb chart and streaming presets (`src/presets/`) are ported from Kometa v2.5.3:
  - `defaults/movie/seasonal.yml`
  - `defaults/show/franchise.yml`
  - `defaults/both/universe.yml`
  - `defaults/chart/imdb.yml` (kept as `imdb-chart.yml`)
  - `defaults/chart/basic.yml` (kept as `basic-chart.yml`)
  - `defaults/both/streaming.yml`

  Copies of those files are kept under `test/fixtures/kometa-v2.5.3/` for the golden tests, with Kometa's MIT licence applying to them.
- **Poster overlays.** The status and IMDb Top 250 ribbon overlays follow Kometa v2.5.3's `defaults/overlays/status.yml` and `ribbon.yml`. The ribbon image (`assets/overlays/ribbon-imdb-top-250.png`) is Kometa's `defaults/overlays/images/ribbon/yellow/imdb.png`, under Kometa's MIT licence.
- **IMDb query mapping.** The IMDb GraphQL variable mapping and chart query (`src/imdb/`) follow Kometa's `modules/imdb.py` (v2.5.3).
- **Hash files, read at runtime.** The IMDb persisted-query hashes are read from <https://github.com/Kometa-Team/IMDb-Hash> while the app runs, not bundled.
- **Default posters, read at runtime.** Kometa's default collection posters are fetched from <https://github.com/Kometa-Team/Default-Images> while the app runs. They are not redistributed with this software. That repository has no licence file; the posters remain the work of their authors.
- **Hosted IMDb service.** Kometa's hosted IMDb service (`utilities.kometa.wiki`) is an **opt-in** setting, off by default, intended only for parity checks.

## Inter

`assets/overlays/Inter-Medium.ttf` is Inter 3.019 (<https://github.com/rsms/inter>), Copyright (c) 2016-2020 The Inter Project Authors, under the SIL Open Font License 1.1; the licence is in `assets/overlays/Inter-OFL.txt`. It's the font Kometa's overlays use.

## sharp and libvips

Poster overlays are drawn with sharp (<https://sharp.pixelplumbing.com>, Apache License 2.0), which uses libvips (<https://www.libvips.org>, LGPL-3.0-or-later). The Docker image ships their prebuilt Linux binaries unmodified, as published on npm under `@img/`, with their licences in those packages.

## Data services

- **TMDb.** This product uses the TMDB API but is not endorsed or certified by TMDB.
- **No affiliation.** IMDb, MDBList, Letterboxd, Plex, Radarr, Sonarr and Jellyfin are used as data sources or targets. None of them is affiliated with this project or endorses it. [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md) describes how each is used.

## Other

- **Archivo** typeface: SIL Open Font License 1.1, Copyright 2020 The Archivo Project Authors. See `docs/mockups/fonts/OFL.txt`.
- **htmx** (BSD Zero Clause License), bundled from the `htmx.org` npm package.
- **Lucide** icon paths (ISC License) are used in the UI icon sprite.
