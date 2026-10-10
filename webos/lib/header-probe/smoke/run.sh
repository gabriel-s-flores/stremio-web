#!/usr/bin/env bash
# Smoke do header probe no emulador. Rode dentro de uma reserva:
#   webos/tools/emu-run -- webos/lib/header-probe/smoke/run.sh <pasta-de-saída>
# Materializa as fixtures (arquivos esparsos) e as mídias sintéticas do kit, serve tudo com o
# media-server.mjs (Range, CORS e /redirect/ como um link de debrid), instala o app de smoke,
# roda o probe no Chromium 53 do emulador e compara com o mesmo probe rodando no Node.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
TOOLS="$REPO/webos/tools"
OUT="$(mkdir -p "${1:-/tmp/header-probe-smoke}" && cd "${1:-/tmp/header-probe-smoke}" && pwd)"
SYNTHETIC="${SYNTHETIC_MEDIA:-$HOME/webos-tv-sdk/media-tests/files}"
APP_ID="io.github.gabrielsflores.headerprobe"
: "${EMU_DEVICE:?rode dentro do webos/tools/emu-run}"

WORK="$(mktemp -d)"
SERVER_PID=""
cleanup() { [[ -n "$SERVER_PID" ]] && kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$WORK"; }
trap cleanup EXIT

node "$HERE/materialize.mjs" "$WORK/media" "$SYNTHETIC"/t2_multi.mkv "$SYNTHETIC"/t3_hevc10_eac3.mp4 > "$WORK/files.txt"
FILES=()
while read -r name; do FILES+=("$name"); done < "$WORK/files.txt"
# Um arquivo também pela rota de redirect (302), como os links de debrid. O dv-p5-mp4 precisa de
# 2 pedidos (moov no fim): o 2º deve ir direto à URL final, sem repetir o redirect.
REDIRECTED="dv-p5-mp4.mp4"
[[ -f "$WORK/media/$REDIRECTED" ]] || REDIRECTED="${FILES[0]}"
FILES+=("redirect/$REDIRECTED")

PORT=$((18100 + RANDOM % 800))
node "$TOOLS/media-server.mjs" "$WORK/media" "$PORT" > "$OUT/media-server.log" 2>&1 &
SERVER_PID=$!
sleep 1

node "$HERE/build.mjs" "$WORK/build" > "$OUT/build.log" 2>&1
ares-install -d "$EMU_DEVICE" "$WORK"/build/*.ipk
ares-launch -d "$EMU_DEVICE" "$APP_ID"
CDP=(node "$TOOLS/cdp.mjs" --port "$EMU_CDP_PORT" --target "$APP_ID")
for _ in $(seq 1 40); do
    "${CDP[@]}" eval 'typeof window.runSmoke' 2>/dev/null | grep -q function && break
    sleep 1
done

LIST="$(printf '"%s",' "${FILES[@]}")"
"${CDP[@]}" --timeout 180000 eval "runSmoke('http://10.0.2.2:$PORT/', [${LIST%,}])" > "$OUT/emulator.json"
"${CDP[@]}" screenshot "$OUT/emulator-app.png" >/dev/null || true
"$TOOLS/emulator-qemu.sh" -i "$EMU_INSTANCE" screenshot "$OUT/emulator-tela.png" >/dev/null 2>&1 || true

# O emulador deve passar pelo 302 uma vez só e fazer os pedidos seguintes direto na URL final.
{
    echo "redirect: pedidos do emulador em /redirect/$REDIRECTED: $(grep -c " /redirect/$REDIRECTED " "$OUT/media-server.log")"
    echo "redirect: pedidos do emulador direto em /$REDIRECTED: $(grep -c " /$REDIRECTED " "$OUT/media-server.log")"
} > "$OUT/redirect.txt"

# Referência: o mesmo probe no Node, lendo os mesmos arquivos pelo mesmo servidor.
for name in "${FILES[@]}"; do
    node "$HERE/../tools/probe.mjs" "http://127.0.0.1:$PORT/$name" > "$WORK/node-${name//\//_}.json"
done
node "$HERE/compare.mjs" "$OUT/emulator.json" "$WORK" | tee "$OUT/compare.txt"
cat "$OUT/redirect.txt"
