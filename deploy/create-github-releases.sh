#!/usr/bin/env bash
# Create GitHub releases for tags that exist locally/remotely but lack a release page.
# Requires: gh auth login (or GH_TOKEN with repo scope).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

GH="${GH:-gh}"
if ! command -v "$GH" >/dev/null 2>&1; then
  echo "error: gh not found (brew install gh)" >&2
  exit 1
fi

if ! "$GH" auth status >/dev/null 2>&1; then
  echo "error: not logged in — run: gh auth login" >&2
  exit 1
fi

REPO="${GITHUB_REPOSITORY:-niksh06/irida}"

create_release() {
  local tag="$1"
  local notes="$ROOT/deploy/releases/${tag}.md"
  if [[ ! -f "$notes" ]]; then
    echo "error: missing $notes" >&2
    exit 1
  fi
  if "$GH" release view "$tag" -R "$REPO" >/dev/null 2>&1; then
    echo "skip $tag — release already exists"
    "$GH" release view "$tag" -R "$REPO" --json url -q .url
    return 0
  fi
  "$GH" release create "$tag" \
    -R "$REPO" \
    --title "$tag" \
    --notes-file "$notes"
}

create_release v0.1.1
create_release v0.2.0

echo "done"
