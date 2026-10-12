#!/usr/bin/env bash
# F8.5 check in the emulator (review c2 of F8.1, B2): the final URL learned by the stream list's probe
# is reused by the Player's load. The test addon (webos/tests/addon, --far) sends every stream link,
# through the media server's /far/ resolver, to ANOTHER origin (the debrid file host): the list's
# probe follows it and notes it; opening the stream afterwards must give the <video> that final URL
# without asking the resolver again ("final URL known"). Run inside a pool reservation, after
# `pnpm webos:package`:
#   webos/tools/emu-run --timeout 15 -- webos/tests/final-url/list-probe.sh <output-dir>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="${1:?usage: list-probe.sh <output-dir>}"
MOVIE="${MOVIE:-tt0111161}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
CDP=(node "$ROOT/webos/tools/cdp.mjs" --port "$EMU_CDP_PORT")
REMOTE=(node "$ROOT/webos/tools/remote.mjs" --port "$EMU_REMOTE_PORT")
cdp_eval() { "${CDP[@]}" eval "$1"; }
log() { echo "[$(date +%T.%N | cut -c1-12)] $*" | tee -a "$OUT/actions.log"; }

node "$ROOT/webos/tests/addon/server.mjs" --host 10.0.2.2 --far --set "${SET:-e2e}" --info "$OUT/addon.json" > "$OUT/addon-server.log" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do [[ -s "$OUT/addon.json" ]] && break; sleep 0.2; done
[[ -s "$OUT/addon.json" ]] || { echo "error: the test addon did not start" >&2; cat "$OUT/addon-server.log" >&2; exit 1; }
MANIFEST_URL="$(node -p "require('$OUT/addon.json').manifestUrl")"

cd "$ROOT"
pnpm webos:install
pnpm webos:launch
ready=''
for _ in $(seq 1 90); do
    sleep 2
    if cdp_eval "!!(window.core && window.core.dispatch)" 2>/dev/null | grep -q true; then ready=1; break; fi
done
[[ -n "$ready" ]] || { echo "error: the core did not start" >&2; exit 1; }
cdp_eval "$(cat "$ROOT/webos/tests/streams/page.js")" > /dev/null
cdp_eval "$(cat "$ROOT/webos/tests/player/page.js")" > /dev/null
cdp_eval "$(cat "$ROOT/webos/tests/final-url/page.js")" > /dev/null
cdp_eval "window.__f62.install('$MANIFEST_URL')" > /dev/null
sleep 3
cdp_eval "(function(){ window.__f62.track(60000); location.hash = '#/detail/movie/$MOVIE/$MOVIE'; return true; })()" > /dev/null
for _ in $(seq 1 100); do
    [[ "$(cdp_eval "window.__f62.list().length")" -gt 0 ]] && break
    sleep 0.2
done
log "list shown: $(cdp_eval "window.__f62.list().length") items"
# The top probes start 1 s after the list settles.
sleep 8
"${CDP[@]}" screenshot "$OUT/tela-lista.png" || true
farhits() { grep -c ' GET /far/' "$OUT/addon-server.log" || true; }
BEFORE="$(farhits)"
log "resolver (/far/) requests before opening: $BEFORE"

# A stream the top probes read and the emulator plays (PLAY_FILE: a regex on the file name): focused from
# the page, then OK on the remote.
PLAY_FILE="${PLAY_FILE:-1080p\\.WEB-DL\\.H264\\.AAC}"
index="$(cdp_eval "(function(){ var l = window.__f62.list(); for (var i = 0; i < l.length; i++) { if (/$PLAY_FILE/.test(l[i].file)) return i; } return -1; })()")"
[[ "$index" -ge 0 ]] || { echo "error: no stream matches $PLAY_FILE" >&2; exit 1; }
cdp_eval "window.__f62.focus($index)" > /dev/null
log "focused item $index: $(cdp_eval "JSON.stringify(window.__f62.list().filter(function(i){ return i.focused; }))")"
cdp_eval "(window.__f81.mark('open'), true)" > /dev/null
"${REMOTE[@]}" OK > /dev/null
start="$(date +%s)"
for _ in $(seq 1 40); do
    sleep 1
    if [[ "$(cdp_eval "(function(){ var v = document.querySelector('video'); return !!(v && !v.paused && v.currentTime > 1) || !!document.querySelector('[class*=\"error-layer\"]'); })()" 2>/dev/null)" == true ]]; then break; fi
done
log "player after $(( $(date +%s) - start )) s"
"${CDP[@]}" screenshot "$OUT/tela-player.png" || true
AFTER="$(farhits)"
log "resolver (/far/) requests after opening: $AFTER"
sleep 1
cdp_eval "JSON.stringify(window.__f81)" > "$OUT/page.json"
cdp_eval "JSON.stringify(window.__f51.console.filter(function(c){ return /\\[webos\\] (player|tracks)/.test(c.text); }))" > "$OUT/console.json"
cdp_eval "(function(){ var v = document.querySelector('video'); return JSON.stringify({ playing: !!(v && !v.paused && v.currentTime > 1), errorLayer: !!document.querySelector('[class*=\"error-layer\"]') }); })()" > "$OUT/final-state.json"
printf '{"before":%s,"after":%s,"farPort":%s}\n' "$BEFORE" "$AFTER" "$(node -p "require('$OUT/addon.json').farPort")" > "$OUT/far-hits.json"
node "$ROOT/webos/tests/final-url/evaluate-list-probe.mjs" "$OUT" | tee "$OUT/resultado.json"
