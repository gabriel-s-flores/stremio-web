#!/usr/bin/env bash
# Roda DENTRO do emu-run (usa EMU_DEVICE, EMU_CDP_PORT, EMU_INSTANCE): instala a sonda, abre,
# executa o play-test.sh sobre uma URL e grava o resultado na pasta de saída do cenário.
#   run-one.sh <pasta-saida> <ipk-da-sonda> <url> <segundos> [seek] [luna 0|1]
# Saídas: meta.json (instância, tempos), play.json (resultado), play.err, tela-app.png, tela-vm.png
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TOOLS="$(dirname "$HERE")"
OUT="${1:?pasta de saída}"; IPK="${2:?ipk}"; URL="${3:?url}"; SECS="${4:-8}"; SEEK="${5:-}"; LUNA="${6:-0}"
APP_ID="io.github.gabrielsflores.webosprobe"
: "${EMU_DEVICE:?rode dentro do emu-run}"
mkdir -p "$OUT"
now_ms() { date +%s%3N; }
START=$(now_ms)
meta() { printf '{"instance":%s,"device":"%s","startedAt":%s,"playStartedAt":%s,"endedAt":%s,"probeComplete":%s}\n' \
    "${EMU_INSTANCE:-0}" "$EMU_DEVICE" "$START" "${PLAY_START:-null}" "$(now_ms)" "${PROBE_OK:-false}" > "$OUT/meta.json"; }
trap meta EXIT

ares-install -d "$EMU_DEVICE" "$IPK" >&2
ares-launch -d "$EMU_DEVICE" "$APP_ID" >&2
CDP=(node "$TOOLS/cdp.mjs" --port "$EMU_CDP_PORT" --target "$APP_ID")
# O play-test precisa do <video id="v"> da sonda; espera a sonda terminar o próprio levantamento
# (como o probe-run.sh) para a coleta não competir com a reprodução.
PROBE_OK=false
for _ in $(seq 1 60); do
    if "${CDP[@]}" eval 'window.__probe && window.__probe.complete' 2>/dev/null | grep -q true; then PROBE_OK=true; break; fi
    sleep 1
done
[[ "$PROBE_OK" == true ]] || echo "run-one: aviso: a sonda não terminou o levantamento em 60 s" >&2

PLAY_START=$(now_ms)
set +e
LUNA="$LUNA" CDP_PORT="$EMU_CDP_PORT" "$TOOLS/play-test.sh" "$URL" "$SECS" "$SEEK" > "$OUT/play.json" 2> "$OUT/play.err"
status=$?
set -e
"${CDP[@]}" screenshot "$OUT/tela-app.png" >/dev/null 2>&1 || true
"$TOOLS/emulator-qemu.sh" -i "${EMU_INSTANCE:-0}" screenshot "$OUT/tela-vm.png" >/dev/null 2>&1 || true
exit "$status"
