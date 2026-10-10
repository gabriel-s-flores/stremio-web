#!/usr/bin/env bash
# F6.2 check in the emulator: the streams list of a movie, with the local test addon
# (webos/tests/addon), ordered and labelled by the C8 rules. Records the list over time (names
# first, then the probes of the top), moves into the list with the remote and stays on an item
# further down (focus probe, frozen order), and keeps the media server log (which files were read).
# No playback. Run inside a pool reservation, after `pnpm webos:package`:
#   webos/tools/emu-run --timeout 15 -- webos/tests/streams/emulator.sh <output-dir>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="${1:?usage: emulator.sh <output-dir>}"
MOVIE="${MOVIE:-tt0111161}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
CDP=(node "$ROOT/webos/tools/cdp.mjs" --port "$EMU_CDP_PORT")
REMOTE=(node "$ROOT/webos/tools/remote.mjs" --port "$EMU_REMOTE_PORT")
cdp_eval() { "${CDP[@]}" eval "$1"; }
log() { echo "[$(date +%T)] $*" | tee -a "$OUT/actions.log"; }

node "$ROOT/webos/tests/addon/server.mjs" --host 10.0.2.2 --info "$OUT/addon.json" > "$OUT/addon-server.log" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT
for _ in $(seq 1 50); do [[ -s "$OUT/addon.json" ]] && break; sleep 0.2; done
[[ -s "$OUT/addon.json" ]] || { echo "error: the test addon did not start" >&2; cat "$OUT/addon-server.log" >&2; exit 1; }
MANIFEST_URL="$(node -p "require('$OUT/addon.json').manifestUrl")"
log "addon: $MANIFEST_URL"

cd "$ROOT"
pnpm webos:install
pnpm webos:launch

ready=''
for _ in $(seq 1 90); do
    sleep 2
    if cdp_eval "!!(window.core && window.core.dispatch)" 2>/dev/null | grep -q true; then ready=1; break; fi
done
[[ -n "$ready" ]] || { echo "error: the core did not start" >&2; exit 1; }
cdp_eval "$(cat "$ROOT/webos/tests/streams/page.js")"
cdp_eval "window.__f62.install('$MANIFEST_URL')"
for _ in $(seq 1 20); do
    sleep 0.5
    if [[ "$(cdp_eval "window.__f62.installed || ''")" != '' ]]; then break; fi
done
log "installed: $(cdp_eval "window.__f62.installed || ''")"
sleep 2
"${CDP[@]}" screenshot "$OUT/tela-board.png" || true

# The streams of a Cinemeta movie: the test addon answers for any tt id.
cdp_eval "(function(){ window.__f62.track(60000); location.hash = '#/detail/movie/$MOVIE/$MOVIE'; return true; })()" > /dev/null
log "navigated to the streams of $MOVIE"
for _ in $(seq 1 100); do
    if [[ "$(cdp_eval "window.__f62.list().length")" -gt 0 ]]; then break; fi
    sleep 0.2
done
"${CDP[@]}" screenshot "$OUT/tela-1-abertura.png" || true
log "list shown: $(cdp_eval "window.__f62.list().length") items"

# The top probes start 1 s after the list settles; local files answer in a few ms.
sleep 6
"${CDP[@]}" screenshot "$OUT/tela-2-apos-probes.png" || true
cdp_eval "JSON.stringify(window.__f62.list())" > "$OUT/lista-apos-probes.json"
log "after the top probes"

# Into the list with the remote: the 1st item gets the focus, then DOWN to the unnamed 720p
# (Atmos only shows up with the probe). The first key freezes the order.
target="$(cdp_eval "(function(){ var l = window.__f62.list(); for (var i = 0; i < l.length; i++) { if (/720p\\.WEB-DL-GRP/.test(l[i].file)) return i; } return -1; })()")"
log "target index: $target"
cdp_eval "window.__f62.focus(0)" > /dev/null
for _ in $(seq 1 "$target"); do
    "${REMOTE[@]}" DOWN > /dev/null
    sleep 0.25
done
log "focused: $(cdp_eval "JSON.stringify(window.__f62.list().filter(function(i){ return i.focused; }))")"
"${CDP[@]}" screenshot "$OUT/tela-3-foco-antes.png" || true
sleep 3
"${CDP[@]}" screenshot "$OUT/tela-4-foco-probe.png" || true
"$ROOT/webos/tools/emulator-qemu.sh" -i "$EMU_INSTANCE" screenshot "$OUT/tela-vm-foco-probe.png" || true
cdp_eval "JSON.stringify(window.__f62.list())" > "$OUT/lista-apos-foco.json"
log "after the focus probe"

cdp_eval "window.__f62.readSettings()" > /dev/null || true
sleep 1
cdp_eval "JSON.stringify(window.__f62.settings || null)" > "$OUT/settings.json"
cdp_eval "JSON.stringify(window.__f62.timeline)" > "$OUT/timeline.json"
cdp_eval "JSON.stringify({ console: window.__f62.console, errors: window.__f62.errors })" > "$OUT/console.json"
cdp_eval "JSON.stringify(window.performance && performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null)" > "$OUT/memoria.json" || true
cp "$OUT/addon-server.log" "$OUT/media-server.log.txt"

node "$ROOT/webos/tests/streams/evaluate.mjs" "$OUT" | tee "$OUT/resultado.json"
