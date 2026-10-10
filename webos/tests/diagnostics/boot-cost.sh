#!/usr/bin/env bash
# F3.6: boot cost of a build. Installs an IPK and launches it cold N times (closing between the
# launches), running boot-probe.mjs on each, and writes one JSON line per launch. Run the same
# script on the IPK of origin/webos and on the one with the diagnostics code to compare.
#   webos/tools/emu-run --timeout 25 --profile c8 -- webos/tests/diagnostics/boot-cost.sh <ipk> <output-file> [launches]
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
IPK="$(realpath "${1:?usage: boot-cost.sh <ipk> <output-file> [launches]}")"
OUT="$(realpath -m "${2:?output file}")"
LAUNCHES="${3:-3}"
APP=io.github.gabrielsflores.stremio
: "${EMU_DEVICE:?run inside webos/tools/emu-run}"
mkdir -p "$(dirname "$OUT")"
: > "$OUT"
ares-install -d "$EMU_DEVICE" "$IPK" >/dev/null 2>&1
for n in $(seq 1 "$LAUNCHES"); do
    ares-launch -d "$EMU_DEVICE" --close "$APP" >/dev/null 2>&1
    sleep 6
    node "$HERE/boot-probe.mjs" --port "$EMU_CDP_PORT" --timeout 240 > "$OUT.$n.tmp" 2> "$OUT.$n.err" &
    probe=$!
    ares-launch -d "$EMU_DEVICE" "$APP" >/dev/null 2>&1
    wait "$probe"
    echo "{\"launch\": $n, \"profile\": \"${EMU_PROFILE:-default}\", \"result\": $(cat "$OUT.$n.tmp" 2>/dev/null || echo null)}" | tee -a "$OUT"
    rm -f "$OUT.$n.tmp" "$OUT.$n.err"
done
