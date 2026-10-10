#!/usr/bin/env bash
# Desktop (Chrome headless) captures of the layout page, the reference for the emulator ones:
#   webos/tests/layout/shoot-desktop.sh <output folder>
# Needs webos/tests/layout/build/desktop (webpack --env target=desktop, see webpack.config.js).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$(realpath -m "${1:?usage: shoot-desktop.sh <output folder>}")"
mkdir -p "$OUT"
# <name>:<hash>, the same list as run.
. "$HERE/scenes.sh"
for entry in "${SCENES[@]}"; do
    name="${entry%%:*}"
    hash="${entry#*:}"
    google-chrome-stable --headless=new --disable-gpu --no-sandbox --hide-scrollbars --window-size=1920,1080 \
        --virtual-time-budget=5000 --screenshot="$OUT/$name.png" "file://$HERE/build/desktop/index.html#$hash" >/dev/null 2>&1
    echo "$OUT/$name.png"
done
