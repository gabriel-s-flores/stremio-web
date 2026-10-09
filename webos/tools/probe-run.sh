#!/usr/bin/env bash
# Instala e executa o app-sonda num dispositivo ares e salva o resultado.
#   probe-run.sh                 # emulador (sobe a VM se preciso)
#   probe-run.sh tv              # TV em Developer Mode já configurada no ares como "tv"
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$HERE")"
APP_ID="io.github.gabrielsflores.webosprobe"
DEVICE="${1:-${EMU_DEVICE:-emulator}}"
HOST="${2:-127.0.0.1}"
OUT_DIR="${PROBE_OUT:-$HOME/webos-tv-sdk/probe/results}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT_DIR"

# Emulador: QEMU sem root por padrão; VirtualBox se estiver instalado e WEBOS_EMU=vbox.
if [[ "${WEBOS_EMU:-qemu}" == vbox ]]; then EMU="$HERE/emulator.sh"; else EMU="$HERE/emulator-qemu.sh"; fi
# Dentro do emu-run (EMU_DEVICE definido) a instância já está no ar.
if [[ "$DEVICE" == "emulator" && -z "${EMU_DEVICE:-}" ]]; then
    [[ "$EMU" == "$HERE/emulator.sh" ]] && "$EMU" register >/dev/null
    "$EMU" start headless || true
    "$EMU" wait 300
fi

# Pacote numa pasta própria: várias execuções podem rodar ao mesmo tempo (pool de emuladores).
PKG_DIR="$(mktemp -d)"
ares-package "$HERE/probe/app" -o "$PKG_DIR" >/dev/null
ares-install -d "$DEVICE" "$PKG_DIR"/*.ipk
rm -rf "$PKG_DIR"
ares-launch -d "$DEVICE" "$APP_ID"
PORT="${EMU_CDP_PORT:-9998}"
if [[ "$DEVICE" != "emulator" && "$DEVICE" != emu* ]]; then
    # Na TV o ares-inspect abre um túnel local para o inspector do app e imprime a URL.
    INSPECT_LOG="$OUT_DIR/inspect-$STAMP.log"
    ares-inspect -d "$DEVICE" --app "$APP_ID" > "$INSPECT_LOG" 2>&1 &
    INSPECT_PID=$!
    trap 'kill $INSPECT_PID 2>/dev/null || true' EXIT
    for _ in $(seq 1 30); do
        url="$(grep -oE 'http://(localhost|127\.0\.0\.1):[0-9]+' "$INSPECT_LOG" | head -1 || true)"
        [[ -n "$url" ]] && break
        sleep 1
    done
    [[ -n "${url:-}" ]] || { cat "$INSPECT_LOG"; echo "erro: ares-inspect não informou a URL" >&2; exit 1; }
    HOST=127.0.0.1
    PORT="${url##*:}"
fi
CDP=(node "$HERE/cdp.mjs" --host "$HOST" --port "$PORT" --target "$APP_ID")

for _ in $(seq 1 40); do
    if "${CDP[@]}" eval 'window.__probe && window.__probe.complete' 2>/dev/null | grep -q true; then
        break
    fi
    sleep 1
done

"${CDP[@]}" eval 'JSON.stringify(window.__probe)' > "$OUT_DIR/$DEVICE-$STAMP.json"
"${CDP[@]}" screenshot "$OUT_DIR/$DEVICE-$STAMP-app.png" >/dev/null || true
if [[ "$DEVICE" == "emulator" || "$DEVICE" == emu* ]]; then
    "$EMU" screenshot "$OUT_DIR/$DEVICE-$STAMP-tela.png" >/dev/null || true
fi
echo "$OUT_DIR/$DEVICE-$STAMP.json"
