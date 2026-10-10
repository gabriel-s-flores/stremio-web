#!/usr/bin/env bash
# Mede quanto tempo depois de gravar um corte de energia ainda preserva os dados.
# Para cada atraso D: instala a v1 do zero, abre a sonda (que grava), espera D s depois de ela terminar,
# corta a VM (QMP quit, sem desligar o guest), sobe de novo e lê o que sobrou.
#
#   webos/tools/emu-run -- webos/spikes/persistence/power-cut.sh <pasta-de-evidências> [atrasos…]   (padrão: 0 3 6 12)
# Os helpers repetem os do scenario.sh de propósito: cada script do spike roda sozinho.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TOOLS="$(cd "$HERE/../../tools" && pwd)"
EVID="$(realpath -m "${1:?pasta de evidências}")"; shift
DELAYS=("$@"); [[ ${#DELAYS[@]} -gt 0 ]] || DELAYS=(0 3 6 12)
: "${EMU_DEVICE:?rode dentro do emu-run}" "${EMU_CDP_PORT:?}" "${EMU_INSTANCE:?}"
APP="io.github.gabrielsflores.persistprobe"
PKG="$(mktemp -d)"; trap 'rm -rf "$PKG"' EXIT
mkdir -p "$EVID"
EMU="$TOOLS/emulator-qemu.sh -i $EMU_INSTANCE"
log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$EVID/power-cut.log" >&2; }
cdp() { node "$TOOLS/cdp.mjs" --port "$EMU_CDP_PORT" --target "$APP" "$@"; }
"$HERE/build.sh" 1.0.0 "$APP" "$PKG" >/dev/null
IPK="$PKG/${APP}_1.0.0_all.ipk"
summary() { node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1]));const f=(r.session&&r.session.firstLoad&&r.session.firstLoad.found)||{};console.log(Object.keys(f).filter(k=>f[k]!==null).map(k=>k+":"+(f[k]?"SIM":"nao")).join(" "))' "$1"; }
wait_complete() { local i; for i in $(seq 1 60); do cdp eval 'window.__persist && window.__persist.complete' 2>/dev/null | grep -q true && return 0; sleep 0.3; done; return 1; }

for D in "${DELAYS[@]}"; do
    log "=== corte ${D}s depois de gravar ==="
    ares-launch -d "$EMU_DEVICE" -c "$APP" >/dev/null 2>&1 || true
    ares-install -d "$EMU_DEVICE" --remove "$APP" >/dev/null 2>&1 || true
    ares-install -d "$EMU_DEVICE" "$IPK" >/dev/null
    ares-launch -d "$EMU_DEVICE" "$APP" >/dev/null
    wait_complete || { log "ERRO: a sonda não terminou"; exit 1; }
    cdp eval 'JSON.stringify(window.__persist)' > "$EVID/corte-${D}s-antes.json"
    log "gravou: $(summary "$EVID/corte-${D}s-antes.json") (mas este é o relatório da escrita; o que importa é o que sobrar)"
    sleep "$D"
    $EMU stop >&2
    $EMU start headless --smp 2 >&2
    $EMU wait 240 >&2
    sleep 15
    ares-launch -d "$EMU_DEVICE" "$APP" >/dev/null
    wait_complete || { log "ERRO: a sonda não terminou após o boot"; exit 1; }
    cdp eval 'JSON.stringify(window.__persist)' > "$EVID/corte-${D}s-depois.json"
    log "após o corte de ${D}s: $(summary "$EVID/corte-${D}s-depois.json")"
done
log fim
