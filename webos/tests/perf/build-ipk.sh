#!/usr/bin/env bash
# IPK of any commit of the repo, built in a throwaway worktree (F7.1: A/B and bisect of boot times):
#
#   webos/tests/perf/build-ipk.sh [--keep] <commit> <out.ipk> [work-dir]
#
# The worktree lives in <work-dir>/<short-sha> (default ~/webos-tv-sdk/run/f71/wt) and is REMOVED when the build
# ends; --keep leaves it (and its node_modules) for a second build of the same commit. A leftover registration
# (the folder was deleted by hand) is pruned first, and the worktree HEAD is checked against the commit.
# `pnpm install` uses the shared store; the heavy steps go through build-run (the build semaphore).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
KEEP=0
[[ "${1:-}" == "--keep" ]] && { KEEP=1; shift; }
SHA="$(git -C "$ROOT" rev-parse --short=9 "${1:?usage: build-ipk.sh [--keep] <commit> <out.ipk> [work-dir]}")"
FULL="$(git -C "$ROOT" rev-parse "$SHA")"
OUT="$(realpath -m "${2:?out.ipk}")"
WORK="${3:-$HOME/webos-tv-sdk/run/f71/wt}"
WT="$WORK/$SHA"
mkdir -p "$WORK" "$(dirname "$OUT")"
git -C "$ROOT" worktree prune
[[ -d "$WT" ]] || git -C "$ROOT" worktree add --detach "$WT" "$FULL" > /dev/null
[[ "$(git -C "$WT" rev-parse HEAD)" == "$FULL" ]] || { echo "build-ipk.sh: $WT is not at $FULL" >&2; exit 1; }
cleanup() { [[ "$KEEP" == 1 ]] || git -C "$ROOT" worktree remove --force "$WT" > /dev/null 2>&1 || true; }
trap cleanup EXIT
cd "$WT"
"$ROOT/webos/tools/build-run" -- pnpm install --frozen-lockfile > "$WORK/$SHA.install.log" 2>&1
rm -rf dist-webos
"$ROOT/webos/tools/build-run" -- pnpm webos:package > "$WORK/$SHA.build.log" 2>&1
cp dist-webos/*.ipk "$OUT"
echo "$SHA -> $OUT ($(stat -c %s "$OUT") bytes)"
