#!/usr/bin/env bash
# F3.6 (review cycle 1, M2): the shortcut opens the screen through the router, so the Back key of F3.2
# returns to the route the user was on. Remote only: Board -> OK on a title (MetaDetails, idx > 0) ->
# RED GREEN YELLOW BLUE -> BACK must land on the MetaDetails again, then BACK again on the Board.
#   webos/tools/emu-run --timeout 15 -- webos/tests/diagnostics/back-origin.sh <output-dir>
set -uo pipefail
OUT="$(realpath -m "${1:?usage: back-origin.sh <output-dir>}")"; mkdir -p "$OUT"; : > "$OUT/steps.log"
source "$(dirname "$0")/lib.sh"
cd "$ROOT"
pnpm webos:install >/dev/null && pnpm webos:launch >/dev/null
wait_for "$BOARD" "${DIAGNOSTICS_WAIT:-180}" && ok "Board" || { fail "the Board never showed"; exit 1; }
sleep 3
for _ in 1 2 3 4 5; do
    [[ "$(ev 'document.activeElement && document.activeElement.closest("[class*=\"meta-item-container\"]") ? "yes" : "no"')" == yes ]] && break
    key DOWN; sleep 1
done
key OK; sleep 5
log "MetaDetails: $(ev "$HISTORY")"; shot 1-metadetails
[[ "$(ev "$HISTORY")" == *metadetails* || "$(ev "$HISTORY")" == *detail* ]] && ok "MetaDetails opened by the remote" || { fail "OK did not open a MetaDetails"; exit 1; }
key RED GREEN YELLOW BLUE
wait_for "$REPORT" 60 && ok "shortcut opened the screen" || fail "the shortcut did not open the screen"
sleep 2; log "screen: $(ev "$HISTORY")"; shot 2-screen
key BACK; sleep 4
state="$(ev "$HISTORY")"; log "after BACK: $state"; shot 3-back
[[ "$state" == *metadetails* || "$state" == *detail* ]] && ok "BACK returns to the MetaDetails" || fail "BACK did not return to the MetaDetails ($state)"
key BACK; sleep 3
state="$(ev "$HISTORY")"; log "after the second BACK: $state"
log "failures: $FAILS"
exit $FAILS
