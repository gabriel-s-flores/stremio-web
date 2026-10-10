# Helpers shared by the emulator scenarios of the diagnostics screen (source it from inside emu-run,
# after setting OUT; cwd = the repository).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
CDP=(node "$ROOT/webos/tools/cdp.mjs" --port "$EMU_CDP_PORT")
REMOTE=(node "$ROOT/webos/tools/remote.mjs" --port "$EMU_REMOTE_PORT" --delay "${KEY_DELAY:-800}")
FAILS=0
log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$OUT/steps.log" >&2; }
ok() { log "OK    $*"; }
fail() { log "FAIL  $*"; FAILS=$((FAILS + 1)); }
ev() { "${CDP[@]}" eval "$1" 2>/dev/null; }
key() { "${REMOTE[@]}" "$@" >/dev/null; log "key $*"; }
shot() { "${CDP[@]}" screenshot "$OUT/$1.png" >/dev/null 2>&1 || log "(no screenshot $1)"; }
wait_for() { # <expression that evaluates to "yes"> <seconds>
    local state=''
    for _ in $(seq 1 "$2"); do
        state="$(ev "$1" || true)"
        [[ "$state" == yes ]] && return 0
        sleep 1
    done
    return 1
}
BOARD='document.querySelector("[class*=\"meta-item-container\"]") ? "yes" : "no"'
REPORT='window.__webos && window.__webos.diagnostics ? "yes" : "no"'
HISTORY='JSON.stringify({ hash: location.hash.slice(0, 40), idx: history.state ? history.state.idx : null })'
