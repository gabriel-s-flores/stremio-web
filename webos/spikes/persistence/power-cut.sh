#!/usr/bin/env bash
# Mede se um corte de energia preserva o que acabou de ser gravado (e SOBRESCRITO).
#
#   webos/tools/emu-run -- webos/spikes/persistence/power-cut.sh <pasta-de-evidências> [casos…]
#
# Casos (padrão: w0 w3 w6 w12 o0 o3 o6 o12):
#   w<D>  apaga tudo (localStorage, banco do IndexedDB, kind do db8), grava de novo, espera D s, corta
#   o<D>  igual, mas depois da gravação SOBRESCREVE o contador (1 → 2) nos três armazenamentos antes de esperar
# Corte = `emulator-qemu.sh stop` (QMP quit: a VM some sem desligar o guest). Depois sobe, abre a sonda numa
# sessão nova e confere o que sobrou: marcadores ("survived") e o contador esperado (1 em w, 2 em o).
# O intervalo REAL entre a última gravação e o corte é medido (relógio do navegador, corrigido pelo desvio
# em relação ao host) e vai no log: é ele, não o D, que vale.
# Os helpers repetem os do scenario.sh de propósito: cada script do spike roda sozinho.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TOOLS="$(cd "$HERE/../../tools" && pwd)"
EVID="$(realpath -m "${1:?pasta de evidências}")"; shift
CASES=("$@"); [[ ${#CASES[@]} -gt 0 ]] || CASES=(w0 w3 w6 w12 o0 o3 o6 o12)
: "${EMU_DEVICE:?rode dentro do emu-run}" "${EMU_CDP_PORT:?}" "${EMU_INSTANCE:?}"
APP="io.github.gabrielsflores.persistprobe"
PKG="$(mktemp -d)"; trap 'rm -rf "$PKG"' EXIT
mkdir -p "$EVID"
EMU="$TOOLS/emulator-qemu.sh -i $EMU_INSTANCE"
log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$EVID/power-cut.log" >&2; }
cdp() { node "$TOOLS/cdp.mjs" --port "$EMU_CDP_PORT" --target "$APP" "$@"; }
"$HERE/build.sh" 1.0.0 "$APP" "$PKG" >/dev/null
IPK="$PKG/${APP}_1.0.0_all.ipk"
wait_complete() { local i; for i in $(seq 1 80); do cdp eval 'window.__persist && window.__persist.complete' 2>/dev/null | grep -q true && return 0; sleep 0.3; done; return 1; }

for CASE in "${CASES[@]}"; do
    KIND="${CASE:0:1}"; D="${CASE:1}"; ID="corte-$CASE"
    [[ "$KIND" == w || "$KIND" == o ]] || { log "caso inválido: $CASE"; exit 1; }
    log "=== $CASE: $([[ $KIND == w ]] && echo gravar || echo gravar+sobrescrever), esperar ${D}s, cortar ==="
    ares-launch -d "$EMU_DEVICE" -c "$APP" >/dev/null 2>&1 || true
    ares-install -d "$EMU_DEVICE" --remove "$APP" >/dev/null 2>&1 || true
    ares-install -d "$EMU_DEVICE" "$IPK" >/dev/null
    ares-launch -d "$EMU_DEVICE" "$APP" >/dev/null
    wait_complete || { log "ERRO: a sonda não terminou"; exit 1; }
    # Apaga o que sobrou das iterações anteriores (o IndexedDB e o db8 sobrevivem à desinstalação).
    cdp eval '__persistReset()' > "$EVID/$ID-reset.json"
    cdp eval '__persistRun()' >/dev/null
    wait_complete || { log "ERRO: a sonda não terminou após o reset"; exit 1; }
    LAST_WRITE_MS="$(cdp eval 'window.__persist.writesDoneAt')"
    if [[ "$KIND" == o ]]; then
        cdp eval '__persistBump()' > "$EVID/$ID-bump.json"
        LAST_WRITE_MS="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).doneAt)' "$EVID/$ID-bump.json")"
    fi
    cdp eval 'JSON.stringify(window.__persist)' > "$EVID/$ID-antes.json"
    # desvio relógio do navegador x host (inclui a latência do cdp, na casa de dezenas de ms)
    GUEST_NOW="$(cdp eval 'Date.now()')"; HOST_NOW="$(date +%s%3N)"; SKEW=$((HOST_NOW - GUEST_NOW))
    sleep "$D"
    CUT_MS="$(date +%s%3N)"
    $EMU stop >&2
    INTERVAL_MS=$((CUT_MS - SKEW - LAST_WRITE_MS))
    log "intervalo real entre a última gravação e o corte: ${INTERVAL_MS} ms"
    $EMU start headless --smp 2 >&2
    $EMU wait 240 >&2
    sleep 15
    ares-launch -d "$EMU_DEVICE" "$APP" >/dev/null
    wait_complete || { log "ERRO: a sonda não terminou após o boot"; exit 1; }
    cdp eval 'JSON.stringify(window.__persist)' > "$EVID/$ID-depois.json"
    EXPECT=$([[ "$KIND" == w ]] && echo 1 || echo 2)
    VERDICT="$(node -e '
        const r = JSON.parse(require("fs").readFileSync(process.argv[1])); const want = Number(process.argv[2]);
        const out = ["localStorage", "indexedDB", "lunaDb8"].map((k) => {
            const s = r.stores[k]; const c = r.counters[k];
            return k + ":" + (s.survived && c === want ? "OK" : "PERDEU(survived=" + s.survived + ",contador=" + c + ")");
        });
        console.log(out.join(" "));' "$EVID/$ID-depois.json" "$EXPECT")"
    log "após o corte ($CASE, contador esperado $EXPECT): $VERDICT"
    echo "$CASE intervalo_ms=$INTERVAL_MS $VERDICT" >> "$EVID/resultado.txt"
done
log fim
