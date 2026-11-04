#!/bin/sh
# Runs one spike from the repo root, e.g.  sh spikes/run-one.sh 06-jellyfin-writes --i-approve-writes
# Uses Node 20+ if installed, otherwise Docker (with sudo when needed), and appends the output to spikes/out/console.txt.
set -u
cd "$(dirname "$0")/.." || exit 1
[ $# -ge 1 ] || { echo "usage: sh spikes/run-one.sh <spike name without .mjs> [args]"; exit 2; }
[ -f .env ] || { echo "No .env yet: run  cp .env.example .env  and fill in the keys, then try again."; exit 1; }
name="$1"; shift
mkdir -p spikes/out
if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; then
  node "spikes/$name.mjs" "$@" 2>&1 | tee -a spikes/out/console.txt
else
  DOCKER=docker
  docker info >/dev/null 2>&1 || DOCKER="sudo docker"
  $DOCKER run --rm --network host --user "$(id -u):$(id -g)" -v "$PWD":/w -w /w node:22-alpine node "spikes/$name.mjs" "$@" 2>&1 | tee -a spikes/out/console.txt
fi
