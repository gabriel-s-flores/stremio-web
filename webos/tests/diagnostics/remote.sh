#!/usr/bin/env bash
# F3.6 check in the emulator, with the remote control only: open the diagnostics screen with the
# colour-key shortcut and from Settings, scroll it with the arrows, use Copy/Save, switch the core
# variant (the app restarts) and come back with the Back key (F3.2).
# Run inside a pool reservation, after `pnpm webos:package`:
#   webos/tools/emu-run --timeout 15 -- webos/tests/diagnostics/remote.sh <output-dir>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
OUT="${1:?usage: remote.sh <output-dir>}"
mkdir -p "$OUT"
CDP=(node "$ROOT/webos/tools/cdp.mjs" --port "$EMU_CDP_PORT")
REMOTE=(node "$ROOT/webos/tools/remote.mjs" --port "$EMU_REMOTE_PORT" --delay 800)
WAIT="${DIAGNOSTICS_WAIT:-120}"
LOG="$OUT/remote-steps.log"
: > "$LOG"

log() { echo "$*" | tee -a "$LOG"; }
key() { "${REMOTE[@]}" "$@" >/dev/null; }
shot() { "${CDP[@]}" screenshot "$OUT/$1.png" >/dev/null; }
focus() {
    "${CDP[@]}" eval 'JSON.stringify({ hash: location.hash, active: ((document.activeElement && (document.activeElement.textContent || document.activeElement.className)) || "").slice(0, 40), scrollTop: (document.querySelector("[class*=\"diagnostics-content\"]") || {}).scrollTop })'
}
# Presses <key> until the focused element's text contains <pattern> (at most <max> times); logs each step.
press_until() { # <key> <pattern> <max>
    local state n=0
    state="$(focus)"
    while [[ "$state" != *"$2"* && $n -lt "$3" ]]; do
        key "$1"; n=$((n + 1))
        state="$(focus)"
        log "$1 $n -> $state"
    done
    [[ "$state" == *"$2"* ]]
}
wait_for() { # <expression that evaluates to "yes"> <seconds>
    local state=''
    for _ in $(seq 1 "$2"); do
        state="$("${CDP[@]}" eval "$1" 2>/dev/null || true)"
        [[ "$state" == yes ]] && return 0
        sleep 1
    done
    return 1
}
BOARD='document.querySelector("[class*=\"meta-item-container\"]") ? "yes" : "no"'
REPORT='window.__webos && window.__webos.diagnostics ? "yes" : "no"'

cd "$ROOT"
pnpm webos:install
pnpm webos:launch
wait_for "$BOARD" "$WAIT" || { log "FAIL: the Board never showed"; exit 1; }
log "board visible"

# 1. Shortcut RED GREEN YELLOW BLUE from the Board.
key RED GREEN YELLOW BLUE
wait_for "$REPORT" 30 || { log "FAIL: the shortcut did not open the screen"; exit 1; }
sleep 1
log "shortcut -> $(focus)"
shot 1-atalho-topo

# 2. Arrows scroll the page: one DOWN per section, a screenshot at some of them.
for target in 'AppApp version' 'EnvironmentUser' 'CoreVariant' 'Boot timesDOM' 'WebAssemblyWeb' 'TV capabilities' 'Media (canPlayType) (1/3)' 'Media (canPlayType) (2/3)' 'Media (canPlayType) (3/3)' 'MemoryJS' 'Certificate proxy' 'Report (selectable'; do
    press_until DOWN "$target" 8 || { log "FAIL: could not focus $target"; exit 1; }
    case "$target" in CoreVariant) shot 2-rolagem-core ;; 'TV capabilities') shot 2-rolagem-tv ;; 'Media (canPlayType) (1/3)') shot 2-rolagem-midia-1 ;; 'Media (canPlayType) (3/3)') shot 2-rolagem-midia-3 ;; 'Report (selectable') shot 2-rolagem-relatorio ;; esac
done
press_until UP 'Refresh' 80 || { log "FAIL: UP did not come back to Refresh"; exit 1; }
shot 2-volta-ao-topo

# 3. Copy and Save with the remote.
press_until RIGHT 'Copy report' 2
key OK
sleep 1
log "copy -> $("${CDP[@]}" eval 'document.querySelector("[class*=\"notice\"]") ? document.querySelector("[class*=\"notice\"]").textContent : "no notice"')"
shot 3-copiar
press_until RIGHT 'Save report' 2
key OK
sleep 1
log "save -> $("${CDP[@]}" eval 'JSON.stringify({ notice: document.querySelector("[class*=\"notice\"]").textContent, stored: (localStorage.getItem("webos.diagnostics.report") || "").length })')"
shot 3-salvar

# 4. Switch the core to WebAssembly; OK restarts the app, which comes back on the same screen.
press_until RIGHT 'Core: WebAssembly' 3
shot 4-antes-de-trocar
key OK
sleep 8
wait_for "$REPORT" 90 || { log "FAIL: the screen did not come back after the restart"; exit 1; }
sleep 2
log "after restart -> localStorage=$("${CDP[@]}" eval 'localStorage.getItem("webos.coreVariant")') $(focus)"
"${CDP[@]}" eval 'JSON.stringify(window.__webos.diagnostics.sections.filter(function(s){ return s.id === "core" || s.id === "boot"; }), null, 2)' > "$OUT/core-wasm.json"
shot 4-core-wasm
press_until DOWN 'CoreVariant' 8
shot 4-core-wasm-secao

# 5. Back to the default; OK restarts again.
press_until UP 'Refresh' 80
press_until RIGHT 'Core: default' 6
key OK
sleep 8
wait_for "$REPORT" 90 || { log "FAIL: the screen did not come back after the second restart"; exit 1; }
sleep 2
log "after reset -> localStorage=$("${CDP[@]}" eval 'String(localStorage.getItem("webos.coreVariant"))')"
"${CDP[@]}" eval 'JSON.stringify(window.__webos.diagnostics.sections.filter(function(s){ return s.id === "core"; }), null, 2)' > "$OUT/core-default.json"

# 6. The Back key (461, the F3.2 dispatcher): leaves the screen for the route it came from. The
# screen came back after a reload with its own hash as the only entry, so Back falls to the Board.
key BACK
sleep 3
log "BACK -> $(focus)"
shot 6-voltar

# 7. From Settings: Menu -> Diagnostics with the arrows, then Back returns to Settings.
"${CDP[@]}" eval '(location.hash = "#/settings", "settings")' >/dev/null
sleep 4
shot 7-settings
key DOWN DOWN LEFT
press_until DOWN 'Diagnostics' 6 || { log "FAIL: could not focus the Diagnostics button"; exit 1; }
shot 7-settings-foco
key OK
sleep 4
log "settings -> OK -> $(focus)"
shot 7-settings-aberta
key BACK
sleep 3
log "BACK -> $(focus)"
shot 7-settings-voltou
[[ "$("${CDP[@]}" eval 'location.hash')" == '#/settings' ]] || { log "FAIL: Back did not return to Settings"; exit 1; }
