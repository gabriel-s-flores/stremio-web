#!/usr/bin/env bash
# Smoke das regras da C8 no emulador. Rode dentro de uma reserva:
#   webos/tools/emu-run -- webos/lib/c8-rules/smoke/run.sh <pasta-de-saída>
# Monta o app com o bundle transpilado para Chrome 53 e os casos (saídas reais do probe e nomes
# de stream), roda as regras no Chromium 53 do emulador e compara com as mesmas regras no Node.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
TOOLS="$REPO/webos/tools"
OUT="$(mkdir -p "${1:-/tmp/c8-rules-smoke}" && cd "${1:-/tmp/c8-rules-smoke}" && pwd)"
APP_ID="io.github.gabrielsflores.c8rules"
: "${EMU_DEVICE:?rode dentro do webos/tools/emu-run}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

node "$HERE/build.mjs" "$WORK/build" > "$OUT/build.log" 2>&1
cp "$WORK/build/expected.json" "$WORK/build/syntax.txt" "$OUT/"
ares-install -d "$EMU_DEVICE" "$WORK"/build/*.ipk
ares-launch -d "$EMU_DEVICE" "$APP_ID"
CDP=(node "$TOOLS/cdp.mjs" --port "$EMU_CDP_PORT" --target "$APP_ID")
for _ in $(seq 1 40); do
    "${CDP[@]}" eval 'typeof window.runSmoke' 2>/dev/null | grep -q function && break
    sleep 1
done

"${CDP[@]}" --timeout 60000 eval 'runSmoke()' > "$OUT/emulator.json"
"${CDP[@]}" screenshot "$OUT/emulator-app.png" >/dev/null || true
"$TOOLS/emulator-qemu.sh" -i "$EMU_INSTANCE" screenshot "$OUT/emulator-tela.png" >/dev/null 2>&1 || true

node "$HERE/compare.mjs" "$OUT/emulator.json" "$OUT/expected.json" | tee "$OUT/compare.txt"
