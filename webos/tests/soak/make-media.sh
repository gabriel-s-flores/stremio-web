#!/usr/bin/env bash
# Long media of the endurance run (F7.3): the e2e set (webos/tests/e2e/make-media.sh) with DURATION=3600, so a
# 60-minute playback never reaches the end of the file (a clip that ends sends the Player back on its own).
#   webos/tests/soak/make-media.sh [folder]      (default: ~/webos-tv-sdk/media-tests/e2e-long)
# Use it with the test addon: E2E_MEDIA_DIR=<folder> node webos/tests/addon/server.mjs --set e2e
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$HOME/webos-tv-sdk/media-tests/e2e-long}"
DURATION="${DURATION:-3600}" nice -n 10 "$HERE/../e2e/make-media.sh" "$OUT"
