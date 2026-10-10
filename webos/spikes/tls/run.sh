#!/usr/bin/env bash
# Roda o spike da F0.7 numa instância do emulador e grava as evidências em OUT.
#   webos/tools/emu-run -- webos/spikes/tls/run.sh [OUT]          (SOAK=n acrescenta uma carga de n pôsteres)
# 1ª passada: instala app + serviço e abre o app em modo hold; o cdp-net.mjs liga o log de rede e
#   libera os testes (serviço sobe a frio).
# 2ª passada: recarrega a página com o log de rede ligado (serviço já de pé).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TOOLS="$(cd "$HERE/../../tools" && pwd)"
OUT="$(realpath -m "${1:-$HERE/out}")"
APP_ID="io.github.gabrielsflores.webostls"
: "${EMU_DEVICE:?rode dentro do webos/tools/emu-run}"
mkdir -p "$OUT"
CDP=(node "$TOOLS/cdp.mjs" --port "$EMU_CDP_PORT" --target "$APP_ID" --timeout 30000)
SSH=(ssh -q -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o HostKeyAlgorithms=+ssh-rsa
     -o PubkeyAcceptedAlgorithms=+ssh-rsa -o BatchMode=yes -i "$HOME/webos-tv-sdk/run/ares_webos_emul"
     -p "$EMU_SSH_PORT" developer@127.0.0.1)

mem_snapshot() {
    # RSS do processo do serviço visto de fora (/proc), para cruzar com process.memoryUsage().
    "${SSH[@]}" 'for p in $(pgrep -f webostls.service); do
        printf "pid=%s cmd=%s " "$p" "$(tr "\0" " " < /proc/$p/cmdline | cut -c1-80)"
        grep -E "^(VmRSS|VmHWM|VmSize)" /proc/$p/status | tr -s " \t\n" " "; echo; done; free -m' || echo "(ssh indisponível)"
}

PKG_DIR="$(mktemp -d)"
trap 'rm -rf "$PKG_DIR"' EXIT
ares-package "$HERE/app" "$HERE/service" -o "$PKG_DIR" | tee "$OUT/ares-package.log"
ares-install -d "$EMU_DEVICE" "$PKG_DIR"/*.ipk 2>&1 | tee "$OUT/ares-install.log"
mem_snapshot > "$OUT/mem-before.txt" 2>&1

# 1ª passada com o log de rede: o app abre em modo hold e o cdp-net.mjs o libera já capturando.
ares-launch -d "$EMU_DEVICE" "$APP_ID" -p '{"hold":true}'
for _ in $(seq 1 30); do "${CDP[@]}" eval 'typeof window.__tlsGo' 2>/dev/null | grep -q function && break; sleep 1; done
node "$HERE/cdp-net.mjs" --port "$EMU_CDP_PORT" --target "$APP_ID" --out "$OUT/run1-net.json" --timeout 240 --go | tee "$OUT/run1-net.txt"
"${CDP[@]}" eval 'JSON.stringify(window.__tls, null, 2)' > "$OUT/run1-tls.json" || true
"${CDP[@]}" screenshot "$OUT/run1-app.png" >/dev/null || true
"$TOOLS/emulator-qemu.sh" -i "$EMU_INSTANCE" screenshot "$OUT/run1-tela.png" >/dev/null || true
mem_snapshot > "$OUT/mem-run1.txt" 2>&1

# 2ª passada com o log de rede: a página recarrega, o serviço já está de pé.
node "$HERE/cdp-net.mjs" --port "$EMU_CDP_PORT" --target "$APP_ID" --out "$OUT/run2-net.json" --timeout 240 | tee "$OUT/run2-net.txt"
"${CDP[@]}" eval 'JSON.stringify(window.__tls, null, 2)' > "$OUT/run2-tls.json" || true
"${CDP[@]}" screenshot "$OUT/run2-app.png" >/dev/null || true
"$TOOLS/emulator-qemu.sh" -i "$EMU_INSTANCE" screenshot "$OUT/run2-tela.png" >/dev/null || true
mem_snapshot > "$OUT/mem-run2.txt" 2>&1

# Carga longa opcional (SOAK=n pôsteres) para ver se a memória do serviço estabiliza.
if [[ -n "${SOAK:-}" ]]; then
    node "$TOOLS/cdp.mjs" --port "$EMU_CDP_PORT" --target "$APP_ID" --timeout 900000 eval "window.__tlsSoak($SOAK)" > "$OUT/soak.json"
    mem_snapshot > "$OUT/mem-soak.txt" 2>&1
fi
"${SSH[@]}" 'grep -h "tls-proxy" /var/log/messages 2>/dev/null | tail -40' > "$OUT/service-log.txt" 2>&1 || true
echo "evidências em $OUT"
