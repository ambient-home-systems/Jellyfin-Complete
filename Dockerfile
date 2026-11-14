# Maverick Jellyfin Complete: one container, state in /config (ADR-005).
# Build:  docker build -t maverick-jellyfin-complete:local .
# Run:    docker compose up -d   (see docker-compose.yml)

# The build stage runs on the build machine's own architecture: its output is JavaScript plus better-sqlite3, whose
# package bundles binaries for linux x64/arm64 (glibc and musl). Only the small runtime stage is per-platform.
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 loads the prebuilt binary bundled in its package (linux x64/arm64, glibc and musl),
# so install scripts (node-gyp) are skipped and no compilers are needed.
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src
COPY drizzle ./drizzle
COPY public ./public
COPY assets ./assets
# The build also sets the presets' own posters (ADR-045) into dist/posters; their source artwork isn't needed after that.
RUN npm run build && npm prune --omit=dev --ignore-scripts --no-audit --no-fund && rm -rf assets/posters/art
# sharp (poster overlays) loads a prebuilt library for the machine it runs on, and npm installed only the build
# machine's. Add both Linux builds (amd64, arm64) at the versions sharp asks for, and drop the musl and WebAssembly
# builds this glibc image never uses. The runtime stage checks the one it loads.
RUN node -e "const o=require('./node_modules/sharp/package.json').optionalDependencies;console.log(['linux-x64','linux-arm64'].flatMap(a=>['@img/sharp-'+a,'@img/sharp-libvips-'+a]).map(p=>p+'@'+o[p]).join(' '))" > /tmp/sharp-pkgs \
 && cd /tmp && npm pack --silent $(cat /tmp/sharp-pkgs) \
 && for t in img-sharp-*.tgz; do n=${t#img-}; n=${n%-[0-9]*.tgz}; mkdir -p /app/node_modules/@img/$n && tar -xzf $t -C /app/node_modules/@img/$n --strip-components=1; done \
 && rm -f /tmp/img-sharp-*.tgz /tmp/sharp-pkgs \
 && rm -rf /app/node_modules/@img/sharp-linuxmusl-* /app/node_modules/@img/sharp-libvips-linuxmusl-* /app/node_modules/@img/sharp-wasm32

FROM node:22-bookworm-slim
ARG VERSION=dev
LABEL org.opencontainers.image.title="Maverick Jellyfin Complete" \
      org.opencontainers.image.description="Kometa-style seasonal collections for Jellyfin, with plan, review and apply." \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="$VERSION"
# TZ only seeds the timezone on first start; after that it's a setting (Settings → Run and review).
ENV NODE_ENV=production \
    PORT=8097 \
    CONFIG_DIR=/config \
    TZ=Etc/UTC
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/public ./public
COPY --from=build /app/assets ./assets
COPY package.json LICENSE NOTICE.md ./
# Self-test on this platform: draw a status badge and the ribbon, so an image whose sharp can't load fails here, not in use;
# and check every preset's own poster was set, at 1000 x 1500.
RUN node --input-type=module -e "const m = await import('/app/dist/overlays/render.js'); const s = await m.loadSharp(); const p = await s({ create: { width: 200, height: 300, channels: 3, background: '#336' } }).jpeg().toBuffer(); const out = await m.renderOverlay(p, ['status:ended', 'ribbon:imdb_top_250']); if (!(await m.hasMarker(out))) throw new Error('overlay self-test failed'); console.log('poster overlays ok on ' + process.arch);" \
 && node --input-type=module -e "const b = await import('/app/dist/posters/bundled.js'); const { loadSharp } = await import('/app/dist/overlays/render.js'); const s = await loadSharp(); const all = b.bundledPosters(); for (const p of all) { const m = await s(await b.bundledPosterBytes(p.key)).metadata(); if (m.format !== 'jpeg' || m.width !== 1000 || m.height !== 1500) throw new Error('poster ' + p.key + ' is wrong'); } console.log('preset posters ok: ' + all.length);" \
 && rm -rf /tmp/maverick-fontconfig
# Runs as the image's unprivileged "node" user (uid 1000). A bind-mounted /config must be writable by uid 1000.
RUN mkdir -p /config && chown node:node /config
USER node
VOLUME ["/config"]
EXPOSE 8097
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8097)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/server.js"]
