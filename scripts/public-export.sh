#!/usr/bin/env bash
# Build the public repository from this private one: the committed files (HEAD), minus scripts/public-export.exclude,
# checked by scripts/privacy-check.mjs, as a new git repository with one commit. Nothing is pushed.
#
#   scripts/public-export.sh <empty-output-dir> [--denylist <file>]
#
# Then, in the output directory: create the public repository on GitHub and push (the script prints how).
set -euo pipefail
out="${1:?Usage: scripts/public-export.sh <empty-output-dir> [--denylist <file>]}"
shift
deny_args=()
if [[ "${1:-}" == "--denylist" ]]; then deny_args=(--denylist "$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"); fi

repo="$(git rev-parse --show-toplevel)"
cd "$repo"
if [[ -e "$out" && -n "$(ls -A "$out" 2>/dev/null)" ]]; then echo "Output directory $out isn't empty." >&2; exit 1; fi
if [[ -n "$(git status --porcelain)" ]]; then echo "Note: uncommitted changes are NOT exported; only HEAD ($(git rev-parse --short HEAD)) is." >&2; fi
mkdir -p "$out"
out="$(cd "$out" && pwd)"

git archive --format=tar HEAD | tar -x -C "$out"
while IFS= read -r line; do
  line="${line%%#*}"; line="$(echo "$line" | xargs)"
  [[ -z "$line" ]] && continue
  rm -rf "${out:?}/$line"
done < scripts/public-export.exclude
rm -f "$out/scripts/public-export.exclude"

node scripts/privacy-check.mjs "$out" "${deny_args[@]}"

cd "$out"
git init -q -b main
git add -A
version="$(node -p "require('./package.json').version")"
# The commit's author is public. Your git config is deliberately NOT used: it may hold your real name and email.
# Set GIT_AUTHOR_NAME / GIT_AUTHOR_EMAIL (for example your GitHub noreply address) to choose it.
name="${GIT_AUTHOR_NAME:-Maverick Jellyfin Complete maintainers}"
email="${GIT_AUTHOR_EMAIL:-maintainers@users.noreply.github.com}"
GIT_COMMITTER_NAME="$name" GIT_COMMITTER_EMAIL="$email" git -c user.name="$name" -c user.email="$email" \
  commit -q -m "Initial public release (v$version)"
echo "Committed as: $name <$email>"
echo
echo "Public repository ready in $out: $(git ls-files | wc -l) files, one commit."
echo "Next: create an EMPTY public repository on GitHub, then in $out:"
echo "  git remote add origin https://github.com/<owner>/<name>.git"
echo "  git push -u origin main"
