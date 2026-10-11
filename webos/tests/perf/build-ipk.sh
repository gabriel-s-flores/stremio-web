#!/usr/bin/env bash
# IPK of any commit of the repo, built in a throwaway worktree (F7.1: A/B and bisect of boot times):
#
#   webos/tests/perf/build-ipk.sh <commit> <out.ipk> [work-dir]
#
# The worktree lives in <work-dir>/<short-sha> (default ~/webos-tv-sdk/run/f71/wt) and is kept, so a
# second build of the same commit is only the webpack run. `pnpm install` uses the shared store.
# The heavy steps go through build-run (the build semaphore of the machine).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SHA="$(git -C "$ROOT" rev-parse --short=9 "${1:?usage: build-ipk.sh <commit> <out.ipk> [work-dir]}")"
OUT="$(realpath -m "${2:?out.ipk}")"
WORK="${3:-$HOME/webos-tv-sdk/run/f71/wt}"
WT="$WORK/$SHA"
mkdir -p "$WORK" "$(dirname "$OUT")"
[[ -d "$WT" ]] || git -C "$ROOT" worktree add --detach "$WT" "$SHA" > /dev/null
cd "$WT"
"$ROOT/webos/tools/build-run" -- pnpm install --frozen-lockfile > "$WORK/$SHA.install.log" 2>&1
rm -rf dist-webos
"$ROOT/webos/tools/build-run" -- pnpm webos:package > "$WORK/$SHA.build.log" 2>&1
cp dist-webos/*.ipk "$OUT"
echo "$SHA -> $OUT ($(stat -c %s "$OUT") bytes)"
