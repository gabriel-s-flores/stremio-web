#!/usr/bin/env bash
# F3.6 check in the emulator: the packaged app boots to the Board, then the diagnostics screen
# (#/webos-diagnostics) collects its report. Saves the report (JSON and text), the boot marks seen
# before the screen was opened and screenshots. Run inside a pool reservation, after
# `pnpm webos:package`:
#   webos/tools/emu-run --timeout 15 [--profile c8] -- webos/tests/diagnostics/emulator.sh <output-dir>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="${1:?usage: emulator.sh <output-dir>}"
mkdir -p "$OUT"
CDP=(node "$ROOT/webos/tools/cdp.mjs" --port "$EMU_CDP_PORT")
REMOTE=(node "$ROOT/webos/tools/remote.mjs" --port "$EMU_REMOTE_PORT")
WAIT="${DIAGNOSTICS_WAIT:-120}"

cd "$ROOT"
pnpm webos:install
pnpm webos:launch

# The Board is up when a catalog item exists.
board=''
for _ in $(seq 1 $((WAIT / 2))); do
    sleep 2
    board="$("${CDP[@]}" eval 'document.querySelector("[class*=\"meta-item-container\"]") ? "yes" : "no"' 2>/dev/null || true)"
    [[ "$board" == yes ]] && break
done
echo "board visible: ${board:-no answer}"
[[ "$board" == yes ]]
"${CDP[@]}" screenshot "$OUT/board.png" >/dev/null

# Open the screen from the page (the remote path is covered by remote.sh).
"${CDP[@]}" eval '(location.hash = "#/webos-diagnostics", "ok")' >/dev/null
report=''
for _ in $(seq 1 30); do
    sleep 1
    report="$("${CDP[@]}" eval 'window.__webos && window.__webos.diagnostics ? "ready" : "waiting"' 2>/dev/null || true)"
    [[ "$report" == ready ]] && break
done
echo "report: ${report:-no answer}"
[[ "$report" == ready ]]
sleep 1
"${CDP[@]}" eval 'JSON.stringify(window.__webos.diagnostics, null, 2)' > "$OUT/report.json"
"${CDP[@]}" eval 'window.__webos.diagnosticsText' > "$OUT/report.txt"
"${CDP[@]}" eval 'JSON.stringify({ hash: location.hash, memory: performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null, sections: document.querySelectorAll("[class*=\"diagnostics-content\"] [class*=\"section\"]").length })' > "$OUT/page.json"
"${CDP[@]}" screenshot "$OUT/diagnostics-1.png" >/dev/null
cat "$OUT/report.txt"
