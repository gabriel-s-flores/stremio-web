#!/usr/bin/env bash
# F5.1 check in the emulator: a direct HTTP stream plays in the app's Player through WebOsVideo,
# with the right time and duration, play/pause from the control bar, no speed button and no
# com.webos.media/subscribe. One media scenario per boot (webos/docs/PESQUISA.md §7). Run inside a
# pool reservation, after `pnpm webos:package`:
#   webos/tools/emu-run --timeout 15 -- webos/tests/player/emulator.sh <output-dir> [file]
# <file> is served from $MEDIA_DIR (default ~/webos-tv-sdk/media-tests/suite: gen-media.sh, GOP=24)
# through /redirect/<file> (302, like a debrid link); default t1_h264_aac.mp4. With --profile c8 the
# Player takes ~30 s to start and CDP calls slow down: use a clip longer than the 20 s of the suite. The Player is opened by route
# (#/player/<encoded stream>), the same path as the app's "Play URL": no account and no addon.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="${1:?usage: emulator.sh <output-dir> [file]}"
FILE="${2:-t1_h264_aac.mp4}"
MEDIA_DIR="${MEDIA_DIR:-$HOME/webos-tv-sdk/media-tests/suite}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
CDP=(node "$ROOT/webos/tools/cdp.mjs" --port "$EMU_CDP_PORT")
EMU=("$ROOT/webos/tools/emulator-qemu.sh" -i "$EMU_INSTANCE")
cdp_eval() { "${CDP[@]}" eval "$1"; }

[[ -f "$MEDIA_DIR/$FILE" ]] || { echo "error: $MEDIA_DIR/$FILE not found (webos/tools/gen-media.sh)" >&2; exit 1; }
PORT="$(node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")"
node "$ROOT/webos/tools/media-server.mjs" "$MEDIA_DIR" "$PORT" > "$OUT/media-server.log" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT
STREAM_URL="http://10.0.2.2:$PORT/redirect/$FILE"
EXPECTED_DURATION="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$MEDIA_DIR/$FILE")"
# The speed icon of @stremio/stremio-icons, to prove the button is not rendered.
SPEED_PATH="$(node -e "
const s = require('fs').readFileSync(require.resolve('@stremio/stremio-icons/react', { paths: ['$ROOT'] }), 'utf8');
const m = / speed: \{ viewBox: \"[^\"]*\", paths: \[\{ d: \"([^\"]+)\"/.exec(s);
console.log(m ? m[1] : '');
")"
[[ -n "$SPEED_PATH" ]] || { echo "error: speed icon not found" >&2; exit 1; }

cd "$ROOT"
pnpm webos:install
pnpm webos:launch

# The core is up when encodeStream answers (same call as the app's "Play URL").
encoded=''
for _ in $(seq 1 90); do
    sleep 2
    encoded="$(cdp_eval "window.core ? window.core.encodeStream({ name: 'F5.1', description: '$FILE', url: '$STREAM_URL' }) : ''" 2>/dev/null || true)"
    if [[ -n "$encoded" && "$encoded" != 'null' && "$encoded" != *'erro'* ]]; then break; fi
    encoded=''
done
[[ -n "$encoded" ]] || { echo "error: the core did not answer encodeStream" >&2; exit 1; }
echo "$encoded" > "$OUT/encoded-stream.txt"
cdp_eval "JSON.stringify(window.__webos || null)" > "$OUT/webos-state.json"
cdp_eval "$(cat "$ROOT/webos/tests/player/page.js")"
"${CDP[@]}" screenshot "$OUT/tela-board.png" || true

cdp_eval "location.hash = '#/player/' + encodeURIComponent('$encoded')"
start="$(date +%s)"

sample() { # <label>
    local s
    s="$(cdp_eval "JSON.stringify(window.__f51.sample())" 2>/dev/null || echo null)"
    echo "{\"phase\":\"$1\",\"elapsed\":$(( $(date +%s) - start )),\"sample\":$s}" >> "$OUT/samples.jsonl"
}
show_controls() { # the control bar hides after a few seconds without the pointer
    cdp_eval "(function(){ var c = document.querySelector('[class*=\"player-container\"]'); if (c) { c.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 960, clientY: 900 })); } return !!c; })()" > /dev/null || true
}
click_play_pause() {
    cdp_eval "(function(){ var b = document.querySelector('[class*=\"control-bar-container\"] [class^=\"control-bar-button-\"]'); if (b) b.click(); return b ? b.getAttribute('title') : null; })()"
}

: > "$OUT/samples.jsonl"
# The Player route and the first frame take a while (lazy chunk, slow CPU with --profile c8): the
# timed phases start once the video is moving.
started=''
for _ in $(seq 1 120); do
    sleep 1
    sample loading
    if cdp_eval "(function(){ var v = document.querySelector('video'); return !!v && v.readyState >= 3 && v.currentTime > 0 && !v.paused; })()" 2>/dev/null | grep -q true; then
        started="$(( $(date +%s) - start ))"
        break
    fi
done
echo "{\"secondsToPlayback\":${started:-null}}" > "$OUT/startup.json"
for _ in $(seq 1 8); do sleep 1; sample playing; done
show_controls
sleep 1
"${CDP[@]}" screenshot "$OUT/tela-player.png" || true
"${EMU[@]}" screenshot "$OUT/tela-vm-player.png" || true
sample playing

echo "pause: $(click_play_pause)" | tee -a "$OUT/actions.log"
for _ in $(seq 1 3); do sleep 1; sample paused; done
show_controls
"${CDP[@]}" screenshot "$OUT/tela-paused.png" || true
echo "play: $(click_play_pause)" | tee -a "$OUT/actions.log"
for _ in $(seq 1 4); do sleep 1; sample resumed; done

cdp_eval "(function(){
    var paths = Array.prototype.map.call(document.querySelectorAll('svg path'), function(p) { return p.getAttribute('d'); });
    return JSON.stringify({
        speedIconRendered: paths.indexOf('$SPEED_PATH') !== -1,
        speedMenuRendered: !!document.querySelector('[class*=\"speed-menu\"]'),
    });
})()" > "$OUT/speed.json"
cdp_eval "JSON.stringify({ luna: window.__f51.luna, errors: window.__f51.errors })" > "$OUT/luna.json"
cdp_eval "JSON.stringify(window.__f51.console)" > "$OUT/console.json"
cp "$OUT/media-server.log" "$OUT/media-server.log.txt" 2>/dev/null || true

node "$ROOT/webos/tests/player/evaluate.mjs" "$OUT" "$EXPECTED_DURATION" | tee "$OUT/resultado.json"
