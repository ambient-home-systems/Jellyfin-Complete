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
RUN npm run build && npm prune --omit=dev --ignore-scripts --no-audit --no-fund

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
COPY package.json LICENSE NOTICE.md ./
# Runs as the image's unprivileged "node" user (uid 1000). A bind-mounted /config must be writable by uid 1000.
RUN mkdir -p /config && chown node:node /config
USER node
VOLUME ["/config"]
EXPOSE 8097
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8097)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/server.js"]
