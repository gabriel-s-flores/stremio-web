#!/usr/bin/env bash
# The same scenes in the desktop build (build/, after `pnpm build`) on headless Chrome, 1920x1080
# viewport, for the comparison with the emulator:
#   webos/tests/screens/desktop.sh <output folder> [scene...]
# CHROME= picks the browser (google-chrome-stable). The webOS-only scenes (exit-dialog) show the
# route without the dialog; there is no Player scene (no STREAM_URL).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
OUT="$(realpath -m "${1:?usage: desktop.sh <output folder> [scene...]}")"
shift
CHROME="${CHROME:-google-chrome-stable}"
mkdir -p "$OUT"
free_port() { node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"; }
HTTP_PORT="$(free_port)"
CDP_PORT="$(free_port)"
PROFILE="$(mktemp -d)"
python3 -m http.server "$HTTP_PORT" --bind 127.0.0.1 -d "$ROOT/build" > "$OUT/http.log" 2>&1 &
HTTP_PID=$!
# The window is taller than the viewport by the browser UI headless Chrome still accounts for.
"$CHROME" --headless=new --remote-debugging-port="$CDP_PORT" --window-size=1920,1167 --hide-scrollbars \
    --user-data-dir="$PROFILE" --no-first-run "http://127.0.0.1:$HTTP_PORT/" > "$OUT/chrome.log" 2>&1 &
CHROME_PID=$!
trap 'kill "$HTTP_PID" "$CHROME_PID" 2>/dev/null; wait "$CHROME_PID" 2>/dev/null; rm -rf "$PROFILE"' EXIT
sleep 5
CDP_PORT="$CDP_PORT" CDP_TARGET="127.0.0.1:$HTTP_PORT" "$HERE/run" "$OUT" "$@"
