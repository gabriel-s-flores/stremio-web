#!/usr/bin/env bash
# F6.2 check in the emulator: the streams list of a movie, with the local test addon
# (webos/tests/addon), ordered and labelled by the C8 rules. Records the list over time and keeps
# the media server log (which files were read). Two modes (MODE):
#   sem-toque (default): nobody touches the list while the top probes land (names first, then the
#     probes reorder it); then the remote enters the list from the page (DOWN from the body) and
#     stays on an item further down (focus probe, frozen order);
#   entrada: debrid latency (DELAY_MS, default 1200) and the remote enters the list right after it
#     shows up, before the probes land, and stays still: the focused stream and the order must not
#     change while the probes land (review c1, finding 1).
# AUDIO_LANG (e.g. por) sets the profile audio language first. No playback. Run inside a pool
# reservation, after `pnpm webos:package`:
#   webos/tools/emu-run --timeout 15 -- webos/tests/streams/emulator.sh <output-dir>
#   MODE=entrada AUDIO_LANG=por webos/tools/emu-run --timeout 15 -- webos/tests/streams/emulator.sh <output-dir>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="${1:?usage: emulator.sh <output-dir>}"
MOVIE="${MOVIE:-tt0111161}"
MODE="${MODE:-sem-toque}"
if [[ "$MODE" == entrada ]]; then DELAY_MS="${DELAY_MS:-1200}"; else DELAY_MS="${DELAY_MS:-0}"; fi
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
CDP=(node "$ROOT/webos/tools/cdp.mjs" --port "$EMU_CDP_PORT")
REMOTE=(node "$ROOT/webos/tools/remote.mjs" --port "$EMU_REMOTE_PORT")
cdp_eval() { "${CDP[@]}" eval "$1"; }
log() { echo "[$(date +%T.%N | cut -c1-12)] $*" | tee -a "$OUT/actions.log"; }
focused() { cdp_eval "JSON.stringify(window.__f62.list().map(function(x, i){ return x.focused ? i + ' ' + x.file : null; }).filter(Boolean))"; }
# Index of the focused list item, or -1.
focused_index() { cdp_eval "(function(){ var l = window.__f62.list(); for (var i = 0; i < l.length; i++) { if (l[i].focused) return i; } return -1; })()"; }
# The page must be the one with the helpers (a reload would lose them).
alive() { [[ "$(cdp_eval "!!window.__f62" 2>/dev/null)" == true ]] || { echo "error: the page reloaded (window.__f62 is gone)" >&2; exit 1; }; }
# Into the list from the page, as a user would: DOWN on the remote until a list item has the focus
# (the first keys may land on the page's buttons). Prints the item index.
enter_list() {
    local index=-1
    for _ in 1 2 3 4 5 6; do
        "${REMOTE[@]}" DOWN > /dev/null
        for _ in 1 2 3 4; do
            sleep 0.25
            index="$(focused_index)"
            [[ "$index" -ge 0 ]] && break 2
        done
        log "DOWN: active $(cdp_eval "(function(){ var a = document.activeElement; return a ? a.tagName + ' ' + String(a.className).slice(0, 40) : 'none'; })()")" >&2
    done
    echo "$index"
}
echo "$MODE" > "$OUT/modo.txt"
log "mode $MODE, media latency ${DELAY_MS} ms"

node "$ROOT/webos/tests/addon/server.mjs" --host 10.0.2.2 --delay "$DELAY_MS" --info "$OUT/addon.json" > "$OUT/addon-server.log" 2>&1 &
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
if [[ -n "${AUDIO_LANG:-}" ]]; then
    cdp_eval "(window.core.getState('ctx').then(function(ctx){ window.core.dispatch({ action: 'Ctx', args: { action: 'UpdateSettings', args: Object.assign({}, ctx.profile.settings, { audioLanguage: '$AUDIO_LANG' }) } }); return true; }))" > /dev/null
    sleep 1
fi
cdp_eval "window.__f62.readSettings()" > /dev/null || true
log "settings: $(cdp_eval "JSON.stringify(window.__f62.settings || null)")"
sleep 2
"${CDP[@]}" screenshot "$OUT/tela-board.png" || true

# The streams of a Cinemeta movie: the test addon answers for any tt id.
cdp_eval "(function(){ window.__f62.track(60000); location.hash = '#/detail/movie/$MOVIE/$MOVIE'; return true; })()" > /dev/null
log "navigated to the streams of $MOVIE"
for _ in $(seq 1 100); do
    alive
    if [[ "$(cdp_eval "window.__f62.list().length")" -gt 0 ]]; then break; fi
    sleep 0.2
done
"${CDP[@]}" screenshot "$OUT/tela-1-abertura.png" || true
log "list shown: $(cdp_eval "window.__f62.list().length") items"

if [[ "$MODE" == entrada ]]; then
    # Into the list right away, from the page (the focus is on the body): one DOWN on the remote.
    log "active before the key: $(cdp_eval "(function(){ var a = document.activeElement; return a ? a.tagName + ' ' + String(a.className).slice(0, 40) : 'none'; })()")"
    cdp_eval "JSON.stringify(window.__f62.list())" > "$OUT/lista-entrada-antes.json"
    index="$(enter_list)"
    log "entered the list at $index; focused: $(focused)"
    cdp_eval "JSON.stringify(window.__f62.list())" > "$OUT/lista-entrada.json"
    "${CDP[@]}" screenshot "$OUT/tela-2-entrada.png" || true
    # Still, while the probes land (1 s after the list settles, then 2 requests of 1.2 s each).
    : > "$OUT/amostras.jsonl"
    for i in $(seq 1 10); do
        sleep 1
        alive
        echo "{\"t\":$i,\"list\":$(cdp_eval "JSON.stringify(window.__f62.list())")}" >> "$OUT/amostras.jsonl"
        log "t+${i}s focused: $(focused)"
    done
    "${CDP[@]}" screenshot "$OUT/tela-3-parado-depois.png" || true
    "$ROOT/webos/tools/emulator-qemu.sh" -i "$EMU_INSTANCE" screenshot "$OUT/tela-vm-parado-depois.png" || true
    cdp_eval "JSON.stringify(window.__f62.list())" > "$OUT/lista-final.json"
else
    # The top probes start 1 s after the list settles; local files answer in a few ms.
    sleep 6
    "${CDP[@]}" screenshot "$OUT/tela-2-apos-probes.png" || true
    cdp_eval "JSON.stringify(window.__f62.list())" > "$OUT/lista-apos-probes.json"
    log "after the top probes"

    # Into the list with the remote, from the page (the focus is on the body): DOWN to the 1st item,
    # then DOWN to the unnamed 720p (Atmos only shows up with the probe).
    target="$(cdp_eval "(function(){ var l = window.__f62.list(); for (var i = 0; i < l.length; i++) { if (/720p\\.WEB-DL-GRP/.test(l[i].file)) return i; } return -1; })()")"
    log "active before the keys: $(cdp_eval "(function(){ var a = document.activeElement; return a ? a.tagName : 'none'; })()"); target index: $target"
    index="$(enter_list)"
    entered="$(focused)"
    echo "$entered" > "$OUT/entrada.json"
    log "entered the list at $index: $entered"
    while [[ "$index" -ge 0 && "$index" -lt "$target" ]]; do
        "${REMOTE[@]}" DOWN > /dev/null
        sleep 0.25
        index="$(focused_index)"
    done
    log "focused: $(cdp_eval "JSON.stringify(window.__f62.list().filter(function(i){ return i.focused; }))")"
    "${CDP[@]}" screenshot "$OUT/tela-3-foco-antes.png" || true
    sleep 3
    "${CDP[@]}" screenshot "$OUT/tela-4-foco-probe.png" || true
    "$ROOT/webos/tools/emulator-qemu.sh" -i "$EMU_INSTANCE" screenshot "$OUT/tela-vm-foco-probe.png" || true
    cdp_eval "JSON.stringify(window.__f62.list())" > "$OUT/lista-apos-foco.json"
    log "after the focus probe"
fi

cdp_eval "window.__f62.readSettings()" > /dev/null || true
sleep 1
cdp_eval "JSON.stringify(window.__f62.settings || null)" > "$OUT/settings.json"
cdp_eval "JSON.stringify(window.__f62.timeline)" > "$OUT/timeline.json"
cdp_eval "JSON.stringify({ console: window.__f62.console, errors: window.__f62.errors })" > "$OUT/console.json"
cdp_eval "JSON.stringify(window.performance && performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null)" > "$OUT/memoria.json" || true
cp "$OUT/addon-server.log" "$OUT/media-server.log.txt"

node "$ROOT/webos/tests/streams/evaluate.mjs" "$OUT" | tee "$OUT/resultado.json"
