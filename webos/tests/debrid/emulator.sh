#!/usr/bin/env bash
# F6.3 check in the emulator: what the Player says when the debrid link behind the stream is
# redirected, expired, gone, missing, rate limited, failing or unreachable. The stream is opened by
# route (#/player/<encoded stream>), the same path as the "Play URL" of F5.1, against
# webos/tools/media-server.mjs, which imitates the debrid resolver: /redirect/<path> answers 302,
# /status/<code>/<file> answers that HTTP status, /drop/<file> cuts the connection. One media
# scenario per boot (webos/docs/PESQUISA.md §7). Run inside a pool reservation, after
# `pnpm webos:package`:
#   webos/tools/emu-run --timeout 15 -- webos/tests/debrid/emulator.sh <output-dir> <scenario>
# Scenarios (SCENARIOS in evaluate.mjs): redirect-ok, redirect-403, expired-410, not-found-404,
# rate-limited-429, server-error-503, network-drop, network-refused (the TV has internet, the link
# host does not answer), le-host (a Let's Encrypt host the Chromium 53 fetch() refuses, with
# internet), offline-drop (navigator.onLine false: the TV has no internet).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="${1:?usage: emulator.sh <output-dir> <scenario>}"
SCENARIO="${2:?usage: emulator.sh <output-dir> <scenario>}"
FILE="${FILE:-t1_h264_aac.mp4}"
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
# A port nobody listens on: connection refused (the network is "down" for that host).
DEAD_PORT="$(node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")"
BASE="http://10.0.2.2:$PORT"
case "$SCENARIO" in
    redirect-ok)        URL="$BASE/redirect/$FILE" ;;
    redirect-403)       URL="$BASE/redirect/status/403/$FILE" ;;
    expired-410)        URL="$BASE/status/410/$FILE" ;;
    not-found-404)      URL="$BASE/redirect/missing-$FILE" ;;
    rate-limited-429)   URL="$BASE/status/429/$FILE" ;;
    server-error-503)   URL="$BASE/status/503/$FILE" ;;
    network-drop)       URL="$BASE/drop/$FILE" ;;
    network-refused)    URL="http://10.0.2.2:$DEAD_PORT/$FILE" ;;
    le-host)            URL="https://letsencrypt.org/robots.txt" ;;
    offline-drop)       URL="$BASE/drop/$FILE" ;;
    *) echo "error: unknown scenario $SCENARIO" >&2; exit 1 ;;
esac
echo "$SCENARIO" > "$OUT/scenario.txt"

cd "$ROOT"
pnpm webos:install
pnpm webos:launch

encoded=''
for _ in $(seq 1 90); do
    sleep 2
    encoded="$(cdp_eval "window.core ? window.core.encodeStream({ name: 'F6.3', description: '$SCENARIO', url: '$URL' }) : ''" 2>/dev/null || true)"
    if [[ -n "$encoded" && "$encoded" != 'null' && "$encoded" != *'erro'* ]]; then break; fi
    encoded=''
done
[[ -n "$encoded" ]] || { echo "error: the core did not answer encodeStream" >&2; exit 1; }
cdp_eval "$(cat "$ROOT/webos/tests/player/page.js")"
if [[ "$SCENARIO" == offline-drop ]]; then
    cdp_eval "(function(){ Object.defineProperty(navigator, 'onLine', { get: function() { return false; }, configurable: true }); return String(navigator.onLine); })()" > "$OUT/online.txt"
fi
cdp_eval "location.hash = '#/player/' + encodeURIComponent('$encoded')"
start="$(date +%s)"

# What is on screen: the video and, when the Player failed, its error layer (the label, the hint and
# which kind of link problem the override found).
snapshot() {
    cdp_eval "(function(){
        var video = document.querySelector('video');
        var layer = document.querySelector('[class*=\"error-layer\"]');
        var label = layer && layer.querySelector('[class*=\"error-label\"]');
        var hint = layer && layer.querySelector('[class*=\"error-sub\"]');
        return JSON.stringify({
            t: Date.now(),
            hash: location.hash.slice(0, 30),
            video: video ? { currentTime: video.currentTime, paused: video.paused, readyState: video.readyState, error: video.error ? video.error.code : null } : null,
            errorLayer: !!layer,
            label: label ? label.textContent : null,
            hint: hint ? hint.textContent : null,
            kind: layer ? layer.getAttribute('data-link-problem') : null,
        });
    })()" 2>/dev/null || echo null
}
: > "$OUT/samples.jsonl"
for _ in $(seq 1 40); do
    sleep 1
    echo "{\"elapsed\":$(( $(date +%s) - start )),\"sample\":$(snapshot)}" >> "$OUT/samples.jsonl"
    done_state="$(tail -1 "$OUT/samples.jsonl")"
    # Failure: the error layer with its final text (the check lands a moment after the layer). Success: moving video.
    if [[ "$SCENARIO" == redirect-ok ]]; then
        [[ "$done_state" == *'"paused":false'* && "$done_state" != *'"currentTime":0,'* ]] && break
    else
        [[ "$done_state" == *'"errorLayer":true'* && "$done_state" == *'"hint":"'* ]] && break
        [[ "$done_state" == *'"errorLayer":true'* ]] && sleep 3 && break
    fi
done
sleep 2
echo "{\"elapsed\":$(( $(date +%s) - start )),\"sample\":$(snapshot)}" >> "$OUT/samples.jsonl"
"${CDP[@]}" screenshot "$OUT/tela-player.png" || true
"${EMU[@]}" screenshot "$OUT/tela-vm-player.png" || true
cdp_eval "JSON.stringify(window.__f51.console.filter(function(c){ return /Player|link check/.test(c.text); }))" > "$OUT/console.json"
cdp_eval "JSON.stringify(window.__f51.errors)" > "$OUT/page-errors.json"
cp "$OUT/media-server.log" "$OUT/media-server.log.txt" 2>/dev/null || true
node "$ROOT/webos/tests/debrid/evaluate.mjs" "$OUT" "$SCENARIO" | tee "$OUT/resultado.json"
