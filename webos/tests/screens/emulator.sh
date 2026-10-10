#!/usr/bin/env bash
# Main screens of the packaged app in the emulator (F2.6; reusable by the visual regression, F2.7).
# Inside a pool reservation, after `pnpm webos:package` (or with IPK=<file>):
#   webos/tools/emu-run --timeout 15 -- webos/tests/screens/emulator.sh <output folder> [scene...]
# Serves $MEDIA_DIR (default ~/webos-tv-sdk/media-tests/suite) through webos/tools/media-server.mjs
# for the Player scene (/redirect/t1_h264_aac.mp4, like a debrid link; MEDIA_FILE= picks another,
# MEDIA_FILE=none skips the Player). SCALE= and WAIT= go to run.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
OUT="$(realpath -m "${1:?usage: emulator.sh <output folder> [scene...]}")"
shift
: "${EMU_DEVICE:?run inside webos/tools/emu-run}"
APP_ID=io.github.gabrielsflores.stremio
IPK="${IPK:-$(ls "$ROOT"/dist-webos/*.ipk | head -1)}"
MEDIA_DIR="${MEDIA_DIR:-$HOME/webos-tv-sdk/media-tests/suite}"
MEDIA_FILE="${MEDIA_FILE:-t1_h264_aac.mp4}"
mkdir -p "$OUT"

if [[ "$MEDIA_FILE" != none && -f "$MEDIA_DIR/$MEDIA_FILE" ]]; then
    PORT="$(node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")"
    node "$ROOT/webos/tools/media-server.mjs" "$MEDIA_DIR" "$PORT" > "$OUT/media-server.log" 2>&1 &
    SERVER_PID=$!
    trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT
    export STREAM_URL="http://10.0.2.2:$PORT/redirect/$MEDIA_FILE"
fi

ares-install -d "$EMU_DEVICE" "$IPK" > "$OUT/install.log" 2>&1
ares-launch -d "$EMU_DEVICE" "$APP_ID" >> "$OUT/install.log" 2>&1
sleep 5
CDP_PORT="$EMU_CDP_PORT" "$HERE/run" "$OUT" "$@"
