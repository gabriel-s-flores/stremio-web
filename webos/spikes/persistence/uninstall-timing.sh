#!/usr/bin/env bash
# Investiga por que o localStorage às vezes SOBREVIVE à desinstalação no emulador.
# Hipótese: remover o app pouco depois de abri-lo deixa o localStorage para trás.
# Cada ciclo: instala, abre, espera T s desde o lançamento, grava uma chave, fecha, remove, instala,
# abre e lê o localStorage. Registra T, o uptime do guest e o resultado.
#
#   [LOAD=N] webos/tools/emu-run -- webos/spikes/persistence/uninstall-timing.sh <pasta-de-evidências> [T…]   (padrão: 1 3 5 8 1 3 5 8)
# LOAD=N liga N laços de CPU dentro do guest durante o teste (o revisor rodou com o pool de emuladores cheio;
# a hipótese é que a contenção de CPU muda a ordem entre o fim do app e a remoção dos dados).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TOOLS="$(cd "$HERE/../../tools" && pwd)"
EVID="$(realpath -m "${1:?pasta de evidências}")"; shift
TIMES=("$@"); [[ ${#TIMES[@]} -gt 0 ]] || TIMES=(1 3 5 8 1 3 5 8)
: "${EMU_DEVICE:?rode dentro do emu-run}" "${EMU_CDP_PORT:?}" "${EMU_SSH_PORT:?}"
APP="io.github.gabrielsflores.persistmirror"
PKG="$(mktemp -d)"; trap 'rm -rf "$PKG"' EXIT
mkdir -p "$EVID"
SSH=(ssh -o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa -o StrictHostKeyChecking=no
     -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=5
     -i "$HOME/webos-tv-sdk/run/ares_webos_emul" -p "$EMU_SSH_PORT" developer@127.0.0.1)
log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$EVID/uninstall-timing.log" >&2; }
"$HERE/build.sh" 1.0.0 "$APP" "$PKG" mirror >/dev/null
IPK="$PKG/${APP}_1.0.0_all.ipk"
ev() { node "$TOOLS/cdp.mjs" --port "$EMU_CDP_PORT" --target "$APP" eval "$1"; }
wait_page() { local i; for i in $(seq 1 60); do [[ "$(ev 'typeof window.__mirror' 2>/dev/null)" == object ]] && return 0; sleep 0.3; done; return 1; }
uptime_s() { "${SSH[@]}" 'cut -d. -f1 /proc/uptime' 2>/dev/null; }

LOAD_PIDS=""
for _ in $(seq 1 "${LOAD:-0}"); do
    "${SSH[@]}" 'sh -c "while :; do :; done" >/dev/null 2>&1 & echo $!' > /tmp/uninstall-timing-load.$$ && LOAD_PIDS="$LOAD_PIDS $(cat /tmp/uninstall-timing-load.$$)"
done
rm -f /tmp/uninstall-timing-load.$$
[[ -n "$LOAD_PIDS" ]] && log "carga de CPU no guest: pids$LOAD_PIDS (load average: $("${SSH[@]}" 'cut -d" " -f1-3 /proc/loadavg'))"
ares-install -d "$EMU_DEVICE" --remove "$APP" >/dev/null 2>&1 || true
CYCLE=0
for T in "${TIMES[@]}"; do
    CYCLE=$((CYCLE + 1))
    ares-install -d "$EMU_DEVICE" "$IPK" >/dev/null
    ares-launch -d "$EMU_DEVICE" "$APP" >/dev/null
    T0=$(date +%s.%N)
    wait_page || { log "ERRO: página não apareceu"; exit 1; }
    ev '(function(){ localStorage.setItem("ciclo_chave", "x"); return localStorage.length; })()' >/dev/null
    # espera até T s contados desde o lançamento
    ELAPSED=$(echo "$(date +%s.%N) - $T0" | bc); REST=$(echo "$T - $ELAPSED" | bc)
    [[ "${REST:0:1}" == "-" ]] || sleep "$REST"
    UP=$(uptime_s)
    ares-launch -d "$EMU_DEVICE" -c "$APP" >/dev/null 2>&1
    ares-install -d "$EMU_DEVICE" --remove "$APP" >/dev/null 2>&1
    ares-install -d "$EMU_DEVICE" "$IPK" >/dev/null
    ares-launch -d "$EMU_DEVICE" "$APP" >/dev/null
    wait_page || { log "ERRO: página não apareceu (2)"; exit 1; }
    KEYS=$(ev 'JSON.stringify(Object.keys(localStorage))')
    log "ciclo $CYCLE T=${T}s uptime_no_remove=${UP}s -> localStorage após desinstalar+reinstalar: $KEYS"
    echo "$CYCLE $T $UP $KEYS" >> "$EVID/resultado.txt"
    ares-launch -d "$EMU_DEVICE" -c "$APP" >/dev/null 2>&1
    ares-install -d "$EMU_DEVICE" --remove "$APP" >/dev/null 2>&1
    sleep 6   # separa os ciclos
done
[[ -n "$LOAD_PIDS" ]] && "${SSH[@]}" "kill $LOAD_PIDS" 2>/dev/null
log fim
