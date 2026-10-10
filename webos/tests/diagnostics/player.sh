#!/usr/bin/env bash
# F3.6 (review cycle 1, M1): opening the screen during playback must not unmount the Player, and BACK
# returns to it. A media scenario: one per emu-run (the emulator only plays the first media after boot).
# The test file comes from the media library of the kit (media-tests/files), served by tools/media-server.mjs.
#   webos/tools/emu-run --timeout 15 -- webos/tests/diagnostics/player.sh <output-dir>
set -uo pipefail
OUT="$(realpath -m "${1:?usage: player.sh <output-dir>}")"; mkdir -p "$OUT"; : > "$OUT/steps.log"
source "$(dirname "$0")/lib.sh"
cd "$ROOT"
PORT=8137
node "$ROOT/webos/tools/media-server.mjs" "$HOME/webos-tv-sdk/media-tests/files" "$PORT" > "$OUT/media-server.log" 2>&1 &
MEDIA_SERVER=$!
trap 'kill $MEDIA_SERVER 2>/dev/null' EXIT
VIDEO='JSON.stringify((function(){ var v = document.querySelector("video"); return { hash: location.hash.slice(0, 24), videos: document.querySelectorAll("video").length, same: !!(window.__rv && document.contains(window.__rv)), t: v ? Math.round(v.currentTime * 10) / 10 : null, paused: v ? v.paused : null }; })())'
pnpm webos:install >/dev/null && pnpm webos:launch >/dev/null
wait_for "$BOARD" "${DIAGNOSTICS_WAIT:-180}" && ok "Board" || { fail "the Board never showed"; exit 1; }
log "encodeStream -> $(ev 'window.core.encodeStream({ url: "http://10.0.2.2:'$PORT'/t1_h264_aac.mp4", name: "F3.6 player" }).then(function (s) { location.hash = "#/player/" + encodeURIComponent(s); return "ok"; })')"
wait_for 'document.querySelector("video") ? "yes" : "no"' 60 && ok "Player mounted with its <video>" || { fail "the Player did not mount"; shot 0-no-player; exit 1; }
sleep 5
ev '(window.__rv = document.querySelector("video"), "ok")' >/dev/null
log "before the shortcut: $(ev "$VIDEO")"; shot 1-playing
key RED GREEN YELLOW BLUE
wait_for "$REPORT" 60 && ok "screen opened during playback" || fail "the shortcut did not open the screen"
sleep 4
state="$(ev "$VIDEO")"; log "with the screen open: $state"; shot 2-screen-over-player
[[ "$state" == *'"same":true'* ]] && ok "the Player (and its <video>) stays mounted under the screen" || fail "the screen unmounted the Player"
mem="$(ev 'JSON.stringify(window.__webos.diagnostics.sections.filter(function(s){ return s.id === "memory"; })[0].data.jsHeap)')"; log "JS heap during playback: $mem"
key BACK; sleep 5
state="$(ev "$VIDEO")"; log "after BACK: $state"; shot 3-back
[[ "$state" == *'"same":true'* && "$state" == *'#/player'* ]] && ok "BACK returns to the same Player" || fail "BACK did not return to the same Player ($state)"
log "failures: $FAILS"
exit $FAILS
