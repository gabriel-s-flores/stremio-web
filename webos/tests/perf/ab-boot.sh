#!/usr/bin/env bash
# A/B (or A/B/C...) of cold boots in ONE reservation, interleaved (F7.1): the same instance, the same
# host contention for every build, which is the only fair way to tell two builds apart on a shared
# host (the F3.5 and F4.2 tasks did the same). Used to bisect a boot-time regression and to compare
# the two core variants of one build.
#
#   webos/tools/emu-run --profile c8 --timeout 58 -- webos/tests/perf/ab-boot.sh <out-dir> <rounds> <entry>...
#
# <entry> is <ipk> or <ipk>:<variant> (variant = webos.coreVariant: wasm | wasm2js), so the same IPK can
# appear with both variants: `a.ipk:wasm2js a.ipk:wasm`.
# Each round installs each entry in turn and takes AB_LAUNCHES cold launches (default 1, plus AB_WARMUP
# warm-up launches, default 1: the first launch after an install has no code cache and is not counted),
# with the F3.6 probe marks (no diagnostics screen, no quiet window).
# Order: the list in the odd rounds, REVERSED in the even ones (a b, then b a: ABBA), so that the position in
# the reservation is not the same as the build. The VM ages with the installs (BASELINE-C8.md): above 8 installs
# in one reservation the script warns (set AB_MAX_INSTALLS to change the limit).
# Output: <out-dir>/<n>-<name>/boot.jsonl per entry, plus ab.log; `node summarize.mjs <out-dir>/*` groups them.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$(realpath -m "${1:?usage: ab-boot.sh <out-dir> <rounds> <entry>...}")"
ROUNDS="${2:?rounds}"
shift 2
: "${EMU_DEVICE:?run inside webos/tools/emu-run}"
[[ $# -ge 1 ]] || { echo "ab-boot.sh: no entries" >&2; exit 2; }
if [[ -n "$(ls -A "$OUT" 2>/dev/null)" ]]; then echo "ab-boot.sh: $OUT is not empty; pick a new folder" >&2; exit 2; fi
installs=$((ROUNDS * $#))
if [[ "$installs" -gt "${AB_MAX_INSTALLS:-8}" ]]; then
    echo "ab-boot.sh: warning: $installs installs in one reservation; the VM ages after ~12 (BASELINE-C8.md). Prefer more reservations with fewer rounds." >&2
fi
mkdir -p "$OUT"
entries=("$@")
n=0
for r in $(seq 1 "$ROUNDS"); do
    order=("${entries[@]}")
    if (( r % 2 == 0 )); then
        order=()
        for ((i = ${#entries[@]} - 1; i >= 0; i--)); do order+=("${entries[$i]}"); done
    fi
    for entry in "${order[@]}"; do
        n=$((n + 1))
        ipk="${entry%%:*}" variant="default"
        [[ "$entry" == *:* ]] && variant="${entry#*:}"
        name="$(basename "$ipk" .ipk)"
        [[ "$variant" == default ]] || name="$name-$variant"
        node "$HERE/boot.mjs" --ipk "$ipk" --variant "$variant" --out "$OUT/$(printf '%02d' "$n")-$name" \
            --launches "${AB_LAUNCHES:-1}" --warmup "${AB_WARMUP:-1}" --no-diag --quiet 0 2>&1 | tee -a "$OUT/ab.log"
    done
done
