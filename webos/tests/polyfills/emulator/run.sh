#!/usr/bin/env bash
# Emulator probe of the F1.3 polyfills. Run from the repo root, inside an emu-run reservation:
#   webos/tools/emu-run --timeout 15 -- webos/tests/polyfills/emulator/run.sh <out-dir> [with|without]
# Builds the probe (with the polyfills by default), packages it as its own app, installs it,
# launches it and reads window.__probe over CDP (page and worker results) plus a screenshot.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
OUT="${1:?usage: run.sh <out-dir> [with|without]}"
MODE="${2:-with}"
APP_ID=io.github.gabrielsflores.polyfillsprobe
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
cd "$REPO"

if [[ "$MODE" == "without" ]]; then export NO_POLYFILLS=1; else unset NO_POLYFILLS; fi
pnpm exec webpack --config webos/tests/polyfills/emulator/webpack.config.js 2>&1 | tail -4
rm -rf "$HERE/app"; mkdir -p "$HERE/app"
cp "$HERE"/dist/main.js "$HERE"/dist/worker.js "$HERE/index.html" "$HERE/appinfo.json" "$HERE/app/"
cp webos/app/icon.png "$HERE/app/icon.png"
ares-package --no-minify --outdir "$HERE/app/.." "$HERE/app" >/dev/null
IPK="$(ls "$HERE"/${APP_ID}_*_all.ipk)"
mv "$IPK" "$OUT/probe-$MODE.ipk"

ares-install --device "$EMU_DEVICE" "$OUT/probe-$MODE.ipk" 2>&1 | tail -2
ares-launch --device "$EMU_DEVICE" "$APP_ID" 2>&1 | tail -2
CDP=(node "$REPO/webos/tools/cdp.mjs" --port "$EMU_CDP_PORT" --target "$APP_ID")
for _ in $(seq 1 40); do
    node "$REPO/webos/tools/cdp.mjs" --port "$EMU_CDP_PORT" targets 2>/dev/null | grep -q "$APP_ID" && break
    sleep 1
done
for _ in $(seq 1 40); do
    [[ "$("${CDP[@]}" eval 'window.__probe && window.__probe.done' 2>/dev/null)" == "true" ]] && break
    sleep 1
done
"${CDP[@]}" eval 'JSON.stringify(window.__probe, null, 2)' | tee "$OUT/probe-$MODE.json"
"${CDP[@]}" screenshot "$OUT/probe-$MODE.png"
