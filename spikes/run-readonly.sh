#!/bin/sh
# Runs the read-only spikes 01–05 from the repo root and saves the console output
# (secrets already redacted) to spikes/out/console.txt. Uses Node 20+ if installed,
# otherwise Docker, with sudo when your user can't reach the Docker socket.
set -u
cd "$(dirname "$0")/.." || exit 1
[ -f .env ] || { echo "No .env yet: run  cp .env.example .env  and fill in the keys, then try again."; exit 1; }
mkdir -p spikes/out

if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; then
  run() { SPIKE_LOCATION=server node "spikes/$1.mjs"; }
else
  DOCKER=docker
  docker info >/dev/null 2>&1 || DOCKER="sudo docker"
  run() { $DOCKER run --rm --network host --user "$(id -u):$(id -g)" -v "$PWD":/w -w /w -e SPIKE_LOCATION=server node:22-alpine node "spikes/$1.mjs"; }
fi

for s in 01-jellyfin 02-arr 03-plex 04-imdb 05-coverage; do
  echo "### $s"
  run "$s"
done 2>&1 | tee spikes/out/console.txt

echo
echo "Saved to spikes/out/console.txt. Paste it back into the session."
