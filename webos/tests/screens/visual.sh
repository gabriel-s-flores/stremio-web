#!/usr/bin/env bash
# Visual regression of the screens in the emulator (F2.7): captures them with the fixture addon
# (emulator.sh) and compares with the references in git (visual.mjs), or writes new references.
# Inside a pool reservation, after `pnpm webos:package` (or with IPK=<file>):
#   webos/tools/emu-run --timeout 15 -- webos/tests/screens/visual.sh check  <output folder> [scene...]
#   webos/tools/emu-run --timeout 15 -- webos/tests/screens/visual.sh update <output folder> [scene...]
# check: exit 1 when a scene differs beyond its limits (visual.config.json); the report is
#   <output folder>/report/index.html, the captures <output folder>/capture/.
# update: the new references of those scenes (all without scene names) are written to refs/emulator/.
# Without scene names it takes the whole set in one reservation; with names, only those, one or a few per
# reservation when the pool is busy. DESKTOP=<folder> adds the desktop captures (desktop.sh) to the report.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
MODE="${1:?usage: visual.sh check|update <output folder> [scene...]}"
OUT="$(realpath -m "${2:?usage: visual.sh check|update <output folder> [scene...]}")"
shift 2
[[ "$MODE" == check || "$MODE" == update ]] || { echo "visual.sh: check or update" >&2; exit 2; }
SCENES="$(IFS=,; echo "$*")"
mkdir -p "$OUT"
# The regular Player scene plays a video: not part of the regression (its frame is not stable).
MEDIA_FILE=none "$HERE/emulator.sh" "$OUT/capture" "$@"
EXTRA=()
[[ -n "$SCENES" ]] && EXTRA+=(--scene "$SCENES")
if [[ "$MODE" == update ]]; then
    node "$HERE/visual.mjs" update "$OUT/capture" "${EXTRA[@]}"
else
    [[ -n "${DESKTOP:-}" ]] && EXTRA+=(--desktop "$DESKTOP")
    node "$HERE/visual.mjs" compare "$OUT/capture" --out "$OUT/report" "${EXTRA[@]}"
fi
