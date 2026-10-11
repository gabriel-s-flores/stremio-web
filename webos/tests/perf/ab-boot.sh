#!/usr/bin/env bash
# A/B (or A/B/C...) of cold boots in ONE reservation, interleaved (F7.1): the same instance, the same
# host contention for every build, which is the only fair way to tell two builds apart on a shared
# host (the F3.5 and F4.2 tasks did the same). Used to bisect a boot-time regression.
#
#   webos/tools/emu-run --profile c8 --timeout 55 -- webos/tests/perf/ab-boot.sh <out-dir> <rounds> <ipk>...
#
# Each round installs each IPK in turn and takes ONE cold launch with the F3.6 probe marks (no
# diagnostics screen, no quiet window). Output: <out-dir>/<n>-<ipk-name>/boot.jsonl per launch, plus
# ab.log; `node summarize.mjs <out-dir>/*` groups them by IPK.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$(realpath -m "${1:?usage: ab-boot.sh <out-dir> <rounds> <ipk>...}")"
ROUNDS="${2:?rounds}"
shift 2
: "${EMU_DEVICE:?run inside webos/tools/emu-run}"
mkdir -p "$OUT"
n=0
for r in $(seq 1 "$ROUNDS"); do
    for ipk in "$@"; do
        n=$((n + 1))
        name="$(basename "$ipk" .ipk)"
        node "$HERE/boot.mjs" --ipk "$ipk" --out "$OUT/$(printf '%02d' "$n")-$name" --launches 1 --warmup "${AB_WARMUP:-0}" --no-diag --quiet 0 2>&1 | tee -a "$OUT/ab.log"
    done
done
