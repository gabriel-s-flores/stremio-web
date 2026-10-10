#!/usr/bin/env bash
# Mede o que sobrevive a atualização, reboot e desinstalar+reinstalar no emulador.
# Roda DENTRO de uma reserva (cria o disco limpo e faz o reboot por conta própria):
#
#   webos/tools/emu-run -- webos/spikes/persistence/scenario.sh <pasta-de-evidências>
#
# Cada passo abre a sonda, espera ela terminar e salva <passo>.json (+ .png). O JSON diz, por
# armazenamento, se achou o dado gravado antes e qual versão o gravou.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TOOLS="$(cd "$HERE/../../tools" && pwd)"
EVID="$(realpath -m "${1:?pasta de evidências}")"
: "${EMU_DEVICE:?rode dentro do emu-run}" "${EMU_CDP_PORT:?}" "${EMU_SSH_PORT:?}" "${EMU_INSTANCE:?}"
APP="io.github.gabrielsflores.persistprobe"
APP_B="io.github.gabrielsflores.persistprobeb"   # outro app, para ver se o armazenamento é isolado por app
PKG="$(mktemp -d)"; trap 'rm -rf "$PKG"' EXIT
mkdir -p "$EVID"
EMU="$TOOLS/emulator-qemu.sh -i $EMU_INSTANCE"
SSH=(ssh -o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa -o StrictHostKeyChecking=no
     -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=5
     -i "$HOME/webos-tv-sdk/run/ares_webos_emul" -p "$EMU_SSH_PORT" developer@127.0.0.1)
log() { echo "[$(date +%H:%M:%S)] $*" | tee -a "$EVID/scenario.log" >&2; }

"$HERE/build.sh" 1.0.0 "$APP" "$PKG" >/dev/null
"$HERE/build.sh" 2.0.0 "$APP" "$PKG" >/dev/null
"$HERE/build.sh" 1.0.0 "$APP_B" "$PKG" >/dev/null
V1="$PKG/${APP}_1.0.0_all.ipk"; V2="$PKG/${APP}_2.0.0_all.ipk"; B1="$PKG/${APP_B}_1.0.0_all.ipk"

install() { log "ares-install $(basename "$1")"; ares-install -d "$EMU_DEVICE" "$1" 2>&1 | tee -a "$EVID/scenario.log" >&2; }
remove()  { log "ares-install --remove $1"; ares-install -d "$EMU_DEVICE" --remove "$1" 2>&1 | tee -a "$EVID/scenario.log" >&2 || true; }
close()   { ares-launch -d "$EMU_DEVICE" -c "$1" >/dev/null 2>&1 || true; sleep 2; }
cdp()     { node "$TOOLS/cdp.mjs" --port "$EMU_CDP_PORT" --target "$1" "${@:2}"; }

# snap <passo> <app-id> [keep]: abre o app, espera a sonda terminar e guarda o JSON e a captura.
# Por padrão fecha o app antes (senão o ares-launch só traz a instância velha para a frente);
# "keep" mantém a instância aberta e espera o openedAt mudar (usado após uma atualização).
snap() {
    local step="$1" id="${2:-$APP}" keep="${3:-}"
    log "snap $step ($id)"
    local stale=""
    if [[ "$keep" == keep ]]; then stale="$(cdp "$id" eval 'window.__persist && window.__persist.openedAt' 2>/dev/null || true)"; else close "$id"; fi
    ares-launch -d "$EMU_DEVICE" "$id" >/dev/null
    local i opened
    for i in $(seq 1 60); do
        sleep 1
        if cdp "$id" eval 'window.__persist && window.__persist.complete' 2>/dev/null | grep -q true; then
            opened="$(cdp "$id" eval 'window.__persist.openedAt' 2>/dev/null || true)"
            [[ -n "$opened" && "$opened" != "$stale" ]] && break
        fi
    done
    sleep 1
    cdp "$id" eval 'JSON.stringify(window.__persist)' > "$EVID/$step.json"
    cdp "$id" screenshot "$EVID/$step.png" >/dev/null || true
    log "  -> $(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1]));const f=(r.session&&r.session.firstLoad&&r.session.firstLoad.found)||{};console.log(r.version,"loads="+(r.session&&r.session.loadCount),Object.keys(f).map(k=>k+":"+(f[k]===null?"semAPI":(f[k]?"SIM("+f[k]+")":"nao"))).join(" "))' "$EVID/$step.json")"
}

uptime_s() { "${SSH[@]}" 'cut -d. -f1 /proc/uptime' 2>/dev/null || true; }
wait_ssh_up() { local i; for i in $(seq 1 120); do "${SSH[@]}" true 2>/dev/null && return 0; sleep 3; done; return 1; }
# O emulador não tem reboot gracioso: o "reboot" precisa de root, o Luna nega machineReboot e o ACPI
# system_powerdown é ignorado. Reboot = fechar o app, dar tempo ao Chromium para gravar, `sync` no guest
# e `system_reset` pelo QMP (a VM reinicia do disco, sem perder o overlay).
reboot_after_sync() {
    local before after i
    before="$(uptime_s)"
    "${SSH[@]}" sync
    python3 -I "$TOOLS/qmp.py" raw '{"execute":"system_reset"}' >&2
    sleep 5
    wait_ssh_up || return 1
    for i in $(seq 1 40); do
        after="$(uptime_s)"
        [[ -n "$after" && "$after" -lt "${before:-999999}" ]] && break
        sleep 3
    done
    log "uptime antes=${before}s depois=${after}s"
    [[ -n "$after" && "$after" -lt "${before:-999999}" ]] || { log "ERRO: o guest não reiniciou"; return 1; }
}

log "=== A: instalar v1, abrir e reabrir ==="
remove "$APP"; remove "$APP_B"
install "$V1"
snap 01-v1-primeira-abertura
close "$APP"
snap 02-v1-reabrir

log "=== B: atualização (ares-install da v2.0.0 por cima, com a v1 ainda aberta) ==="
install "$V2"
sleep 3
snap 03-v2-apos-atualizacao "$APP" keep

log "=== C: reinstalar a mesma versão por cima ==="
close "$APP"
install "$V2"
snap 04-v2-apos-reinstalar-por-cima

log "=== D: outro app (id diferente, mesmo origin file://) enxerga os dados? ==="
install "$B1"
snap 05-appB-isolamento "$APP_B"
close "$APP_B"
remove "$APP_B"
# O app B pode ter gravado marcadores próprios; confirma que o app principal continua com os dele.
snap 06-v2-apos-appB

log "=== E: reboot do webOS (sync + system_reset, dentro da mesma reserva) ==="
close "$APP"
sleep 6   # o Chromium grava o localStorage em até ~5 s
reboot_after_sync || exit 1
sleep 15
log "boot concluído"
snap 07-v2-apos-reboot

log "=== F: desinstalar + reinstalar ==="
close "$APP"
remove "$APP"
install "$V2"
snap 08-v2-apos-desinstalar-reinstalar
close "$APP"
remove "$APP"
install "$V1"
snap 09-v1-apos-desinstalar-reinstalar-v1   # grava dados novos (v1) para o teste de queda de energia

log "=== G: queda de energia (QMP quit = corta a VM sem desligar o guest) 1 s depois de gravar ==="
sleep 1
$EMU stop >&2
$EMU start headless --smp 2 >&2
$EMU wait 240 >&2
sleep 15
snap 10-apos-queda-1s

log "=== H: queda de energia 20 s depois de gravar ==="
close "$APP"
remove "$APP"
install "$V1"
snap 11-v1-regravar-para-queda-20s
sleep 20
$EMU stop >&2
$EMU start headless --smp 2 >&2
$EMU wait 240 >&2
sleep 15
snap 12-apos-queda-20s
log "fim"
