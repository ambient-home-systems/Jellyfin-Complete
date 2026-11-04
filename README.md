<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo/mark-dark.svg">
    <img src="docs/logo/mark.svg" width="96" height="96" alt="">
  </picture>
</p>

# Maverick Jellyfin Complete

Kometa-style collections for Jellyfin: seasonal box sets that appear and disappear on their dates, built from IMDb, TMDb, MDBList, Letterboxd and more. Nothing changes in your library until you approve it.

- **Kometa's seasonal collections.** All 19, including Christmas, Halloween, Valentine's and the awareness months, built from the same lists and searches as Kometa. Each opens at local midnight on its first day and goes away after its last.
- **Holiday episodes.** Christmas, Halloween and Thanksgiving episodes from the shows you own.
- **Your own collections**, from IMDb lists or keywords, MDBList, TMDb collections, keywords or lists, Letterboxd, Plex collections, or your own Jellyfin tags and genres.
- **Plan → review → apply.** Choose which kinds of change happen on their own and which wait for you. A failing source never empties a collection, and any change can be undone.
- **Optional extras:**
  - send missing titles to Radarr or Sonarr
  - compare collections with what Kometa built in Plex
  - show a home-screen row per live collection

**Status: 0.4.0, not yet released.** It runs nightly on one Jellyfin 12.4 server. Jellyfin 10.10 and later should work: see [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md).

## Quick start

You need Docker and a Jellyfin 10.10+ server the container can reach.

```yaml
# docker-compose.yml
services:
  maverick-jellyfin-complete:
    image: ghcr.io/ambient-home-systems/jellyfin-complete:latest
    container_name: maverick-jellyfin-complete
    restart: unless-stopped
    ports:
      - "8097:8097"
    environment:
      TZ: Europe/London     # your timezone
    volumes:
      - maverick-config:/config
volumes:
  maverick-config:
```

```bash
docker compose up -d
```
```bash
docker logs maverick-jellyfin-complete
```

The published image arrives with the first release. Until then, build from source: clone this repository and run `docker compose up -d --build`, which uses the [docker-compose.yml](docker-compose.yml) in the repository.

Then open `http://<host>:8097`:

1. **Connect Jellyfin.** Enter its address and an API key (Jellyfin → Dashboard → API Keys), plus the **setup code** from the log. The code stops anyone else who can reach the page from connecting first.
2. **Sign in** with a Jellyfin administrator account.
3. **Follow Getting started.** It covers libraries, timezone, a TMDb key, which collections to turn on, box sets you already have, and a first dry run.
4. **Check Review,** and turn dry run off in Settings when the plans look right.

### Portainer

Paste the compose file above into **Stacks → Add stack → Web editor**. If you build from source instead:

1. Run `docker build -t maverick-jellyfin-complete:local .` on the host.
2. Use `image: maverick-jellyfin-complete:local` in the stack.

### What the container uses

| | |
|---|---|
| Port | 8097 |
| `/config` | Database, encryption key (`secret.key`) and logs. Back up the whole folder, and keep `secret.key` with the database: without it, saved API keys can't be read. |
| `TZ` | Seeds the timezone setting on first start. After that, change it in Settings. |
| `TRUST_PROXY` | Set to `1` only behind a reverse proxy; see [docs/REVERSE-PROXY.md](docs/REVERSE-PROXY.md). |
| `SETUP_CODE` | Choose the first-run setup code yourself, instead of reading it from the log. |
| User | uid 1000. Run `chown 1000:1000` on a bind-mounted `/config` first. |
| Health | `GET /healthz` returns `ok`, with the version in `X-App-Version`. |

## Upgrade

```bash
docker compose pull
```
```bash
docker compose up -d
```

Database migrations run at start-up. Read [CHANGELOG.md](CHANGELOG.md) first.

## Documentation

| Using it | |
|---|---|
| [docs/USER-GUIDE.md](docs/USER-GUIDE.md) | How it works, each screen, modes, collections, Missing, home-screen rows, troubleshooting |
| [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md) | Where data comes from, which keys you need, and the risks: IMDb's GraphQL API isn't official, and Letterboxd has no API |
| [docs/REVERSE-PROXY.md](docs/REVERSE-PROXY.md) | Reaching it from outside your network safely |
| [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) | Jellyfin versions |
| [docs/IMDB-SNAPSHOT.md](docs/IMDB-SNAPSHOT.md) | The fallback if IMDb refuses your server |

| How it's built | |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · [docs/DECISIONS.md](docs/DECISIONS.md) | Design and decision records |
| [docs/PHASE1-TASKS.md](docs/PHASE1-TASKS.md) · [docs/PHASE2.md](docs/PHASE2.md) · [docs/PHASE3.md](docs/PHASE3.md) | What each phase built |
| [docs/VERIFIED.md](docs/VERIFIED.md) · [spikes/](spikes/README.md) | What was verified against a real server before building |
| [DESIGN.md](DESIGN.md) · [PRODUCT.md](PRODUCT.md) · [docs/mockups/](docs/mockups/index.html) | Design system and mockups |

## Development

Node 22.12 or later.

```bash
npm install
```
```bash
npm test
```
```bash
npm run dev
```

- `npm run dev` serves the app at http://localhost:8097, with its data in `./config`.
- `npx tsx scripts/dev-fake-jellyfin.ts` runs a fake Jellyfin with sample films. Start it with `FAKE_PORT=18096`, then point the app at it.
- `.env.example` lists optional development settings. Copy it to `.env`, which is gitignored; never commit keys.

CI runs on every push. Pushing a `vX.Y.Z` tag that matches `package.json` publishes the image and a GitHub release.

## Licence and credits

MIT, see [LICENSE](LICENSE). The preset definitions and the IMDb approach come from [Kometa](https://github.com/Kometa-Team/Kometa) (MIT). [NOTICE.md](NOTICE.md) has the full credits. This product uses the TMDB API but is not endorsed or certified by TMDB. It isn't affiliated with Jellyfin, Kometa, IMDb, TMDb, MDBList, Letterboxd or Plex.
