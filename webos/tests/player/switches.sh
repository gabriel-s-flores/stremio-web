#!/usr/bin/env bash
# F5.6 check in the emulator: 6 loads in a row in the app's Player (5 stream switches), alternating
# the two ways the app changes streams: a new #/player/ route while in the Player (like the next
# episode) and leaving the Player and opening it again (like going back to the stream list). Both
# remount the Player (WebOsVideo destroy + a new <video>). Each load must play; the emulator's
# pipelines are watched over SSH (pipeline-state.js) so a wedged pipeline is told apart from an app
# failure. Run inside a pool reservation, after `pnpm webos:package`:
#   webos/tools/emu-run --timeout 20 -- webos/tests/player/switches.sh <output-dir> [on|off]
# off: the same build with the guard turned off (localStorage webos.pipelineGuard = "off"), for the
# A/B. The F5.5 review case is load 3: a subtitle chosen right before leaving the Player must reach
# that stream's pipeline (Luna selectTrack with its mediaId, before its release), not the next one.
# The files of $MEDIA_DIR (default ~/webos-tv-sdk/media-tests/suite: gen-media.sh) are looped
# to 60 s or more (stream copy, cached in $SWITCH_MEDIA_DIR): a clip that ends makes the Player go
# back on its own, in the middle of the test. Served through /redirect/<file> (302, like a debrid
# link), a different file per load so the server log tells the pipelines of each load apart.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="${1:?usage: switches.sh <output-dir> [on|off]}"
GUARD="${2:-on}"
MEDIA_DIR="${MEDIA_DIR:-$HOME/webos-tv-sdk/media-tests/suite}"
FILES=(t1_h264_aac.mp4 t6_h264_aac.mkv t7_h264_ac3.mp4 t2_multi.mkv t4_h264_eac3.mkv t5_h264_ac3.mkv)
# Load 3 (t2_multi.mkv, embedded subtitles): Portuguese is chosen in the subtitles menu and the Player
# is left at once, so WebOsVideo's Luna selectTrack (500 ms after the choice) runs during the switch.
SUBTITLES_AT=3
# Load 0 opens the Player; then odd loads switch inside it and even loads leave it and open it again.
WAIT_PLAY_S="${WAIT_PLAY_S:-60}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
CDP=(node "$ROOT/webos/tools/cdp.mjs" --port "$EMU_CDP_PORT")
EMU=("$ROOT/webos/tools/emulator-qemu.sh" -i "$EMU_INSTANCE")
SSH=(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o HostKeyAlgorithms=+ssh-rsa
    -o PubkeyAcceptedAlgorithms=+ssh-rsa -i "$HOME/webos-tv-sdk/run/ares_webos_emul" -p "$EMU_SSH_PORT" developer@127.0.0.1)
cdp_eval() { "${CDP[@]}" eval "$1"; }
SUBTITLES_ICON="$(node -e "
const s = require('fs').readFileSync(require.resolve('@stremio/stremio-icons/react', { paths: ['$ROOT'] }), 'utf8');
const m = / subtitles: \{ viewBox: \"[^\"]*\", paths: \[\{ d: \"([^\"]+)\"/.exec(s);
console.log(m ? m[1] : '');
")"
[[ -n "$SUBTITLES_ICON" ]] || { echo "error: subtitles icon not found" >&2; exit 1; }
# Opens the subtitles menu, chooses $1 and leaves the Player 100 ms later (the menu as in the F5.5 test).
choose_subtitles_and_leave() {
    cdp_eval "(function(){ var c = document.querySelector('[class*=\"player-container\"]'); if (c) c.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 960, clientY: 900 })); return true; })()" > /dev/null
    sleep 1
    cdp_eval "(function(){
        var path = Array.prototype.filter.call(document.querySelectorAll('[class*=\"control-bar-container\"] svg path'), function(p) { return p.getAttribute('d') === '$SUBTITLES_ICON'; })[0];
        var button = path ? path.closest('[class*=\"control-bar-button\"]') : null;
        if (button) button.click();
        return !!button;
    })()" > /dev/null
    sleep 1
    cdp_eval "(function(){ var b = document.querySelector('[class*=\"subtitles-menu-container\"] [data-lang=\"$1\"]'); if (b) { window.__f56.mark('subtitles chosen'); b.click(); } setTimeout(function(){ window.__f56.mark('left the Player'); location.hash = '#/'; }, 100); return !!b; })()"
}
log() { echo "$(date +%T) $*" | tee -a "$OUT/steps.log" >&2; }

SWITCH_MEDIA_DIR="${SWITCH_MEDIA_DIR:-$HOME/webos-tv-sdk/media-tests/switches}"
mkdir -p "$SWITCH_MEDIA_DIR"
for f in "${FILES[@]}"; do
    [[ -f "$MEDIA_DIR/$f" ]] || { echo "error: $MEDIA_DIR/$f not found (webos/tools/gen-media.sh)" >&2; exit 1; }
    [[ -s "$SWITCH_MEDIA_DIR/$f" && "$SWITCH_MEDIA_DIR/$f" -nt "$MEDIA_DIR/$f" ]] && continue
    duration="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$MEDIA_DIR/$f")"
    loops="$(node -e "console.log(Math.max(0, Math.ceil(60 / Number(process.argv[1])) - 1))" "$duration")"
    flags=(); [[ "$f" == *.mp4 ]] && flags=(-movflags +faststart)
    ffmpeg -loglevel error -y -stream_loop "$loops" -i "$MEDIA_DIR/$f" -map 0 -c copy "${flags[@]}" "$SWITCH_MEDIA_DIR/$f"
done
MEDIA_DIR="$SWITCH_MEDIA_DIR"
PORT="$(node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")"
node "$ROOT/webos/tools/media-server.mjs" "$MEDIA_DIR" "$PORT" > "$OUT/media-server.log" 2>&1 &
SERVER_PID=$!
# Every starfish-media-pipeline process alive, once a second: how many pipelines each load created.
( while true; do echo "$(date +%s%3N) $("${SSH[@]}" 'echo $(pgrep starfish-media)' 2>/dev/null)"; sleep 1; done ) > "$OUT/pipelines.log" 2>&1 &
SAMPLER_PID=$!
trap 'kill "$SERVER_PID" "$SAMPLER_PID" 2>/dev/null || true' EXIT

cd "$ROOT"
pnpm webos:install
pnpm webos:launch

wait_core() {
    local encoded=''
    for _ in $(seq 1 90); do
        sleep 2
        encoded="$(cdp_eval "window.core ? window.core.encodeStream({ name: 'F5.6', description: 'probe', url: 'http://10.0.2.2:$PORT/redirect/${FILES[0]}' }) : ''" 2>/dev/null || true)"
        if [[ -n "$encoded" && "$encoded" != 'null' && "$encoded" != *'erro'* ]]; then return 0; fi
    done
    echo "error: the core did not answer encodeStream" >&2
    exit 1
}
wait_core
if [[ "$GUARD" == off ]]; then
    cdp_eval "(function(){ localStorage.setItem('webos.pipelineGuard', 'off'); location.reload(); return true; })()" > /dev/null
    sleep 5
    wait_core
fi
cdp_eval "JSON.stringify({ guard: localStorage.getItem('webos.pipelineGuard'), webos: window.__webos || null })" > "$OUT/app-state.json"
cdp_eval "$(cat "$ROOT/webos/tests/player/switches-page.js")" > /dev/null

encode() { # <file> -> encoded stream for #/player/
    cdp_eval "window.core.encodeStream({ name: 'F5.6', description: '$1', url: 'http://10.0.2.2:$PORT/redirect/$1' })"
}

: > "$OUT/loads.jsonl"
for i in "${!FILES[@]}"; do
    file="${FILES[$i]}"
    encoded="$(encode "$file")"
    if (( i == 0 )); then
        way=open
    elif (( i % 2 == 1 )); then
        way=switch
    else
        way=reopen
        if (( i == SUBTITLES_AT + 1 )); then
            log "load $i: subtitles por chosen in the menu, then left the Player: $(choose_subtitles_and_leave por)"
            echo "$SUBTITLES_AT" > "$OUT/subtitles-load.txt"
        else
            cdp_eval "(function(){ location.hash = '#/'; return true; })()" > /dev/null
            log "load $i: left the Player"
        fi
        sleep 3
    fi
    log "load $i: $way -> $file"
    start=$(date +%s%3N)
    cdp_eval "(function(){ location.hash = '#/player/' + encodeURIComponent('$encoded'); return true; })()" > /dev/null
    played=null
    sample=null
    for _ in $(seq 1 $(( WAIT_PLAY_S * 2 ))); do
        sleep 0.5
        sample="$(cdp_eval "JSON.stringify(window.__f56.sample())" 2>/dev/null || echo null)"
        if node -e "
            const s = JSON.parse(process.argv[1]);
            process.exit(s && s.video && s.video.src === '$file' && s.video.readyState >= 3 && s.video.currentTime > 0.5 ? 0 : 1);
        " "$sample"; then
            played=$(( $(date +%s%3N) - start ))
            break
        fi
        if [[ "$sample" == *'"errorLayer":true'* ]]; then break; fi
    done
    [[ "$played" == null ]] || sleep 4
    after="$(cdp_eval "JSON.stringify(window.__f56.sample())" 2>/dev/null || echo null)"
    wedge="$(node "$ROOT/webos/tests/player/pipeline-state.js" 2>/dev/null || true)"
    # The page reloaded (the helpers are gone): say so, and put them back for the next loads.
    if [[ "$(cdp_eval "typeof window.__f56" 2>/dev/null || true)" != object ]]; then
        log "load $i: the page reloaded (navigationStart $(cdp_eval "performance.timing.navigationStart" 2>/dev/null || echo '?'))"
        echo "{\"i\":$i,\"reloaded\":true}" >> "$OUT/reloads.jsonl"
        cdp_eval "$(cat "$ROOT/webos/tests/player/switches-page.js")" > /dev/null 2>&1 || true
    fi
    { echo "== load $i $(date +%T)"; "${SSH[@]}" 'free; dmesg 2>&1 | tail -n 15' 2>&1; } >> "$OUT/system.log"
    echo "{\"i\":$i,\"file\":\"$file\",\"way\":\"$way\",\"startedAt\":$start,\"msToPlay\":$played,\"atPlay\":$sample,\"after\":$after,\"pipelines\":${wedge:-null}}" >> "$OUT/loads.jsonl"
    log "load $i: $( [[ "$played" == null ]] && echo 'did not play' || echo "playing after $played ms" ); wedged: $( [[ "$wedge" == *'"wedged":true'* ]] && echo yes || echo no )"
    "${CDP[@]}" screenshot "$OUT/tela-load-$i.png" > /dev/null 2>&1 || true
done
"${EMU[@]}" screenshot "$OUT/tela-vm-final.png" > /dev/null 2>&1 || true
cdp_eval "JSON.stringify({ videos: window.__f56.videos, events: window.__f56.events, console: window.__f56.console, errors: window.__f56.errors, luna: window.__f56.luna, marks: window.__f56.marks })" > "$OUT/page.json"

node "$ROOT/webos/tests/player/switches-evaluate.mjs" "$OUT" "$GUARD" | tee "$OUT/resultado.json"
