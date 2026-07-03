#!/bin/bash
# Durable prod deploy — mirror the repo (code + docs + tests + specs) into the
# prod copy at $IRIDA_ROOT, replacing the old piecemeal `cp src/*` that left the
# prod tree drifting (missing docs/, Reports/, issues/, stale tests → repeated
# "prod missing X" audit findings, and a clobbered cron.jobs.json).
#
# ADDITIVE for prod-owned content (no rsync --delete): the prod side owns
# runtime + agent-authored content the repo never has — .agent/ (cron jobs/
# state, creds, memory, proposals), agent.config.json (engine + toolPolicy),
# node_modules, and Reports/ the agent writes itself. Those are EXCLUDED so a
# deploy can never clobber them. Repo-DELETED files inside the managed code
# dirs are pruned explicitly (H-9) — an additive sync used to leave them behind
# (2026-07-03: deleted petBridge.ts lingered on prod and broke the build).
#
# H-9 additions: dirty guard, pre-deploy code snapshot + --rollback, stale-file
# prune, npm install when the lockfile changed, .deploy-manifest.json.
#
# Usage:
#   bash deploy/sync-to-prod.sh                    # dry-run (shows what would change)
#   bash deploy/sync-to-prod.sh --apply            # deploy (refuses a dirty repo)
#   bash deploy/sync-to-prod.sh --apply --allow-dirty
#   bash deploy/sync-to-prod.sh --rollback         # restore the newest snapshot
#   bash deploy/sync-to-prod.sh --snapshots        # list available snapshots
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/"
DEST="${IRIDA_ROOT:-$HOME/.irida/irida}/"

# Repo-managed top-level dirs: pruned of repo-deleted files and covered by
# rollback snapshots. Everything prod-owned (.agent, dist, node_modules,
# skills/agent, Reports, logs) stays out of this list.
MANAGED_DIRS=(src test eval scripts deploy docs)
SNAP_DIR="${DEST}.deploy-snapshots"
SNAP_KEEP=5

MODE="--dry-run"
ALLOW_DIRTY=0
ACTION="sync"
for arg in "$@"; do
  case "$arg" in
    --apply) MODE="" ;;
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --rollback) ACTION="rollback" ;;
    --snapshots) ACTION="snapshots" ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

git_rev() { git -C "$SRC" rev-parse --short HEAD 2>/dev/null || echo "unknown"; }
git_branch() { git -C "$SRC" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown"; }
git_dirty() { [[ -n "$(git -C "$SRC" status --porcelain 2>/dev/null)" ]] && echo true || echo false; }

write_manifest() {
  local note="$1"
  local manifest="${DEST}.deploy-manifest.json"
  printf '{\n  "rev": "%s",\n  "branch": "%s",\n  "dirty": %s,\n  "deployedAt": "%s",\n  "note": "%s"\n}\n' \
    "$(git_rev)" "$(git_branch)" "$(git_dirty)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$note" > "$manifest"
  printf '{"rev":"%s","branch":"%s","dirty":%s,"at":"%s","note":"%s"}\n' \
    "$(git_rev)" "$(git_branch)" "$(git_dirty)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$note" >> "${DEST}.deploy-history.jsonl"
  echo "manifest: $(git_rev) ($note)"
}

rebuild_dist() {
  # The gateway/cron run src/ via tsx (always current), but the in-process MCP
  # servers run from dist/ — EXCLUDED from sync (prod-owned build artifact).
  # Stale dist = stale MCP behavior (I-128).
  echo "rebuilding dist on prod (tsc)…"
  if ( cd "$DEST" && npm run build ); then
    echo "dist rebuilt — MCP servers match the synced source"
  else
    echo "WARN: dist build failed — MCP servers may run stale code until rebuilt" >&2
    return 1
  fi
}

list_snapshots() { ls -1t "$SNAP_DIR"/code-*.tgz 2>/dev/null || true; }

if [[ "$ACTION" == "snapshots" ]]; then
  list_snapshots
  exit 0
fi

if [[ "$ACTION" == "rollback" ]]; then
  latest="$(list_snapshots | head -1)"
  if [[ -z "$latest" ]]; then
    echo "no snapshots under $SNAP_DIR" >&2
    exit 1
  fi
  echo "rolling back managed dirs from: $latest"
  # Remove current managed dirs so files ADDED since the snapshot disappear too.
  for d in "${MANAGED_DIRS[@]}"; do rm -rf "${DEST:?}${d}"; done
  tar -xzf "$latest" -C "$DEST"
  ( cd "$DEST" && npm install --no-audit --no-fund )
  rebuild_dist || true
  write_manifest "rollback:$(basename "$latest")"
  echo "rolled back. Restart gateway: launchctl kickstart -k gui/\$(id -u)/ai.irida.gateway"
  exit 0
fi

# ---- sync path ----
if [[ -z "$MODE" && "$ALLOW_DIRTY" != "1" && "$(git_dirty)" == "true" ]]; then
  echo "refusing to deploy a DIRTY working tree — commit first or pass --allow-dirty" >&2
  git -C "$SRC" status --porcelain | head -10 >&2
  exit 1
fi

# Never sync: VCS, deps, build output, local caches, runtime state, prod-owned config/reports.
EXCLUDES=(
  --exclude '.git/'
  --exclude 'node_modules/'
  --exclude 'dist/'
  --exclude '.agent/'              # runtime: cron jobs/state, credentials, memory, proposals
  --exclude 'logs/'
  --exclude 'agent.config.json'    # prod-owned: engine provider/auth + toolPolicy gate
  --exclude 'agent.config.json.bak*'
  --exclude '.env'
  --exclude '*.env'                # keeps *.env.example (templates) — only real .env files skip
  --exclude '.codegraph/'
  --exclude '.cbm/'
  --exclude '.DS_Store'
  --exclude '.claude/'
  --exclude '.cursor/'
  --exclude '.github/'
  --exclude 'repos/'               # dev working copies, not needed on prod
  --exclude 'desktop/'             # local electron client lives in the dev repo
  --exclude 'skills/agent/'        # agent-applied skills (I-98 L1) — prod-local, never from dev
)

echo "sync repo → prod   ${MODE:-APPLY}"
echo "  src:  $SRC ($(git_rev) on $(git_branch), dirty=$(git_dirty))"
echo "  dest: $DEST"
echo

if [[ -z "$MODE" ]]; then
  # Pre-deploy snapshot of the managed code dirs (rollback point).
  mkdir -p "$SNAP_DIR"
  prev_rev="unknown"
  [[ -f "${DEST}.deploy-manifest.json" ]] && prev_rev="$(sed -n 's/.*"rev": "\([^"]*\)".*/\1/p' "${DEST}.deploy-manifest.json" | head -1)"
  snap="$SNAP_DIR/code-$(date -u +%Y%m%dT%H%M%SZ)-${prev_rev:-unknown}.tgz"
  existing=()
  for d in "${MANAGED_DIRS[@]}"; do [[ -d "${DEST}${d}" ]] && existing+=("$d"); done
  if [[ ${#existing[@]} -gt 0 ]]; then
    tar -czf "$snap" -C "$DEST" "${existing[@]}" package.json package-lock.json 2>/dev/null \
      || tar -czf "$snap" -C "$DEST" "${existing[@]}"
    echo "snapshot: $snap"
  fi
  # Retention: keep the newest $SNAP_KEEP.
  list_snapshots | tail -n +$((SNAP_KEEP + 1)) | while read -r old; do rm -f "$old"; done

  lock_before="$(shasum "${DEST}package-lock.json" 2>/dev/null | cut -d' ' -f1 || true)"
fi

# -a archive (perms/exec bits/timestamps), -i itemize changes, -h human sizes.
rsync -aih $MODE "${EXCLUDES[@]}" "$SRC" "$DEST"

if [[ -z "$MODE" ]]; then
  # Prune repo-DELETED files from the managed dirs (H-9). Additive rsync keeps
  # them forever otherwise; a deleted .ts file still compiles on prod and can
  # break the build or resurrect dead behavior. Only files git no longer
  # tracks are removed; *.env / *.bak* are spared just in case.
  echo
  echo "pruning repo-deleted files in: ${MANAGED_DIRS[*]}"
  tracked="$(mktemp)"
  git -C "$SRC" ls-files -- "${MANAGED_DIRS[@]}" > "$tracked"
  pruned=0
  for d in "${MANAGED_DIRS[@]}"; do
    [[ -d "${DEST}${d}" ]] || continue
    while IFS= read -r -d '' f; do
      rel="${f#"$DEST"}"
      case "$rel" in
        *.env|*.bak*) continue ;;
      esac
      if ! grep -qxF "$rel" "$tracked"; then
        # Gitignored content (e.g. deploy/assets/pet art) is local-only BY
        # DESIGN and still rsynced — only files git would track are stale.
        if git -C "$SRC" check-ignore -q "$rel" 2>/dev/null; then
          continue
        fi
        rm -f "$f"
        echo "  pruned: $rel"
        pruned=$((pruned + 1))
      fi
    done < <(find "${DEST}${d}" -type f -print0)
  done
  rm -f "$tracked"
  [[ $pruned -eq 0 ]] && echo "  (nothing stale)"
  find "${DEST}src" "${DEST}test" -type d -empty -delete 2>/dev/null || true

  # Deps: install only when the lockfile actually changed (2026-07-03: the zod
  # bump reached prod source but node_modules stayed behind).
  lock_after="$(shasum "${DEST}package-lock.json" 2>/dev/null | cut -d' ' -f1 || true)"
  if [[ "${lock_before:-}" != "$lock_after" ]]; then
    echo
    echo "package-lock.json changed — npm install on prod…"
    ( cd "$DEST" && npm install --no-audit --no-fund )
  fi

  echo
  rebuild_dist || true
  write_manifest "deploy"
fi

echo
[[ -n "$MODE" ]] && echo "(dry-run — re-run with --apply to sync)" || echo "synced + dist built. Restart gateway to pick up src/MCP changes: launchctl kickstart -k gui/\$(id -u)/ai.irida.gateway"
