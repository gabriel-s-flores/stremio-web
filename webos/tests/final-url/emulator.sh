#!/usr/bin/env bash
# F8.1 check in the emulator: the Player gives the <video> the final URL of a debrid link, not the
# resolver's (on the C8 a src that answers 302 takes minutes to start), and the start watchdog does
# not cut a load the element still reports as loading. The stream is opened by route
# (#/player/<encoded stream>, as in webos/tests/debrid/emulator.sh) against webos/tools/media-server.mjs,
# which imitates the resolver: /redirect/<file> answers 302, /slow/<ms>/<rest> answers <rest> after
# <ms>. One media scenario per boot (webos/docs/PESQUISA.md §7). Run inside a pool reservation, after
# `pnpm webos:package`:
#   webos/tools/emu-run --timeout 15 -- webos/tests/final-url/emulator.sh <output-dir> <scenario>
# Scenarios (SCENARIOS in evaluate.mjs):
#   redirect       resolver answers 302 at once: the <video> gets the final URL
#   slow-redirect  the 302 comes after 3 s: the <video> gets the final URL when it comes
#   slow-timeout   the 302 comes after 8 s, past the 5 s of the app: the <video> gets the original link
#   direct         a link without redirect: played as it is
#   off            webos.player.finalUrl = off (the app before F8.1): the <video> gets the resolver's link
#   slow-load      the file comes at 10 kbit/s: minutes without a media event while the element loads
#                  (like the 75 GB MP4 on the C8): no watchdog error at 60 s, the metadata comes later.
#                  (A file whose headers never come is not this case: the emulator's own pipeline gives up
#                  after about 40 s, with or without the guard, as measured in F5.6.)
#   rate-probe     a moov-at-end MP4 through a 16 Mbit/s shared link, with the Player's probe
#   rate-noprobe   the same with the Player's probe refused (A/B: does the probe delay the start?)
#   switch         play one stream, then open another by route (in-Player switch): how long the quiet
#                  release of F5.6 holds the second load
#   notice         the resolver answers with its own notice video on its origin (Torrentio's "downloading"
#                  while Real-Debrid caches the torrent), then with the file on another origin: opened
#                  again, the stream must ask the resolver again and play the file (review c1, M1); opened
#                  a third time, the file's final URL is reused
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="${1:?usage: emulator.sh <output-dir> <scenario>}"
SCENARIO="${2:?usage: emulator.sh <output-dir> <scenario>}"
SUITE_DIR="${SUITE_DIR:-$HOME/webos-tv-sdk/media-tests/suite}"
E2E_DIR="${E2E_DIR:-$HOME/webos-tv-sdk/media-tests/e2e}"
MEDIA_DIR="${MEDIA_DIR:-$HOME/webos-tv-sdk/media-tests/f81}"
mkdir -p "$OUT" "$MEDIA_DIR"
OUT="$(cd "$OUT" && pwd)"
CDP=(node "$ROOT/webos/tools/cdp.mjs" --port "$EMU_CDP_PORT")
EMU=("$ROOT/webos/tools/emulator-qemu.sh" -i "$EMU_INSTANCE")
cdp_eval() { "${CDP[@]}" eval "$1"; }

# The media: two short clips of the suite and a 300 s 1080p MP4 with the moov at the end (like the
# remux files of the C8 tests; ffmpeg's mp4 muxer writes the moov last without +faststart).
for file in t1_h264_aac.mp4 t6_h264_aac.mkv; do
    [[ -f "$MEDIA_DIR/$file" ]] || cp "$SUITE_DIR/$file" "$MEDIA_DIR/$file"
done
if [[ ! -f "$MEDIA_DIR/moov_end_1080p.mp4" ]]; then
    ffmpeg -v error -y -i "$E2E_DIR/e2e_1080p_h264_aac.mp4" -c copy "$MEDIA_DIR/moov_end_1080p.mp4"
fi

RATE=0
case "$SCENARIO" in
    rate-probe|rate-noprobe) RATE=16 ;;
esac
freeport() { node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"; }
PORT="$(freeport)"
# Another origin, for the file a resolver sends to once it is ready (the debrid file host).
REAL_PORT="$(freeport)"
MEDIA_RATE_MBPS="$RATE" MEDIA_REAL_BASE="http://10.0.2.2:$REAL_PORT" node "$ROOT/webos/tools/media-server.mjs" "$MEDIA_DIR" "$PORT" > "$OUT/media-server.log" 2>&1 &
SERVER_PID=$!
node "$ROOT/webos/tools/media-server.mjs" "$MEDIA_DIR" "$REAL_PORT" > "$OUT/real-host.log" 2>&1 &
REAL_PID=$!
trap 'kill "$SERVER_PID" "$REAL_PID" 2>/dev/null || true' EXIT
BASE="http://10.0.2.2:$PORT"
SECOND_URL=''
case "$SCENARIO" in
    redirect|off)               URL="$BASE/redirect/t1_h264_aac.mp4" ;;
    slow-redirect)              URL="$BASE/slow/3000/redirect/t1_h264_aac.mp4" ;;
    slow-timeout)               URL="$BASE/slow/8000/redirect/t1_h264_aac.mp4" ;;
    direct)                     URL="$BASE/t1_h264_aac.mp4" ;;
    slow-load)                  URL="$BASE/redirect/rate/10/t1_h264_aac.mp4" ;;
    rate-probe|rate-noprobe)    URL="$BASE/redirect/moov_end_1080p.mp4" ;;
    switch)                     URL="$BASE/redirect/t1_h264_aac.mp4"; SECOND_URL="$BASE/redirect/t6_h264_aac.mkv" ;;
    notice)                     URL="$BASE/pending/t1_h264_aac.mp4" ;;
    *) echo "error: unknown scenario $SCENARIO" >&2; exit 1 ;;
esac
printf '{"scenario":"%s","url":"%s","second":"%s","base":"%s","realBase":"%s","rateMbps":%s}\n' "$SCENARIO" "$URL" "$SECOND_URL" "$BASE" "http://10.0.2.2:$REAL_PORT" "$RATE" > "$OUT/scenario.json"

cd "$ROOT"
pnpm webos:install
pnpm webos:launch

encode() {
    local encoded=''
    for _ in $(seq 1 150); do
        encoded="$(cdp_eval "window.core ? window.core.encodeStream({ name: 'F8.1', description: '$SCENARIO', url: '$1' }) : ''" 2>/dev/null || true)"
        if [[ -n "$encoded" && "$encoded" != 'null' && "$encoded" != *'erro'* ]]; then echo "$encoded"; return 0; fi
        sleep 2
    done
    return 1
}
ENCODED="$(encode "$URL")" || { echo "error: the core did not answer encodeStream" >&2; exit 1; }
if [[ "$SCENARIO" == off ]]; then
    # Read when the app starts: set it and reload.
    cdp_eval "(localStorage.setItem('webos.player.finalUrl', 'off'), location.reload(), true)" > /dev/null
    sleep 5
    ENCODED="$(encode "$URL")" || { echo "error: the core did not answer encodeStream after the reload" >&2; exit 1; }
fi
cdp_eval "$(cat "$ROOT/webos/tests/player/page.js")" > /dev/null
cdp_eval "$(cat "$ROOT/webos/tests/final-url/page.js")" > /dev/null
[[ "$SCENARIO" == rate-noprobe ]] && cdp_eval "window.__f81.blockProbe()" > /dev/null
cdp_eval "(window.__f81.mark('open'), location.hash = '#/player/' + encodeURIComponent('$ENCODED'), true)" > /dev/null
start="$(date +%s)"

snapshot() {
    cdp_eval "(function(){
        var video = document.querySelector('video');
        var layer = document.querySelector('[class*=\"error-layer\"]');
        return JSON.stringify({
            t: Date.now(),
            video: video ? { currentTime: video.currentTime, paused: video.paused, readyState: video.readyState, networkState: video.networkState, error: video.error ? video.error.code : null } : null,
            errorLayer: !!layer,
        });
    })()" 2>/dev/null || echo null
}
# Until the video moves (currentTime > 1 s; with METADATA_ONLY=1, until it has its metadata) or the
# error layer shows up.
METADATA_ONLY=0
wait_playing() {
    local limit="$1" label="$2"
    for _ in $(seq 1 "$limit"); do
        sleep 1
        local sample
        sample="$(snapshot)"
        echo "{\"label\":\"$label\",\"elapsed\":$(( $(date +%s) - start )),\"sample\":$sample}" >> "$OUT/samples.jsonl"
        [[ "$sample" == *'"errorLayer":true'* ]] && return 0
        node -e "const s = JSON.parse(process.argv[1]); process.exit(s && s.video && (process.argv[2] === '1' ? s.video.readyState >= 1 : !s.video.paused && s.video.currentTime > 1) ? 0 : 1)" "$sample" "$METADATA_ONLY" && return 0
    done
    return 0
}
: > "$OUT/samples.jsonl"
LIMIT=40
if [[ "$SCENARIO" == slow-load ]]; then LIMIT=330; METADATA_ONLY=1; fi
wait_playing "$LIMIT" first
"${CDP[@]}" screenshot "$OUT/tela-player.png" || true
"${EMU[@]}" screenshot "$OUT/tela-vm-player.png" || true

if [[ -n "$SECOND_URL" ]]; then
    SECOND="$(encode "$SECOND_URL")" || { echo "error: encodeStream of the second stream" >&2; exit 1; }
    sleep 3
    cdp_eval "(window.__f81.mark('switch'), location.hash = '#/player/' + encodeURIComponent('$SECOND'), true)" > /dev/null
    start="$(date +%s)"
    wait_playing 40 second
    "${CDP[@]}" screenshot "$OUT/tela-player-2.png" || true
    "${EMU[@]}" screenshot "$OUT/tela-vm-player-2.png" || true
fi

if [[ "$SCENARIO" == notice ]]; then
    # The debrid service has the file now; the user goes back and opens the stream again, twice.
    curl -s "http://127.0.0.1:$PORT/ready" > /dev/null
    for again in open2 open3; do
        cdp_eval "(window.__f81.mark('back'), location.hash = '#/', true)" > /dev/null
        sleep 8
        cdp_eval "(window.__f81.mark('$again'), location.hash = '#/player/' + encodeURIComponent('$ENCODED'), true)" > /dev/null
        start="$(date +%s)"
        wait_playing 40 "$again"
        "${CDP[@]}" screenshot "$OUT/tela-player-$again.png" || true
        "${EMU[@]}" screenshot "$OUT/tela-vm-player-$again.png" || true
    done
fi

sleep 2
cdp_eval "JSON.stringify(window.__f81)" > "$OUT/page.json"
cdp_eval "JSON.stringify(window.__f51.console.filter(function(c){ return /\\[webos\\] (player|tracks)/.test(c.text); }))" > "$OUT/console.json"
cdp_eval "JSON.stringify(window.__f51.errors)" > "$OUT/page-errors.json"
node "$ROOT/webos/tests/final-url/evaluate.mjs" "$OUT" | tee "$OUT/resultado.json"
