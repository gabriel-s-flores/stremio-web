#!/usr/bin/env bash
# Emulador LG webOS TV 4.0 em QEMU/KVM sem root (QEMU do flatpak org.gnome.Boxes, instalado com --user).
# Usa a imagem oficial do SDK com um overlay qcow2 por instância: o disco original fica intacto.
#
#   emulator-qemu.sh [-i N] start [headless|gui] [--mem MB] [--smp N] [--sound off|pa]
#                                 [--profile c8] [--cpu-quota PCT]
#   emulator-qemu.sh [-i N] wait [segundos]          espera o SSH responder
#   emulator-qemu.sh [-i N] status | stop | reset    reset recria o overlay (estado de fábrica)
#   emulator-qemu.sh [-i N] pid                      PID do QEMU da instância no host (sai com 1 se parada)
#   emulator-qemu.sh [-i N] screenshot <arquivo.png>
#   emulator-qemu.sh [-i N] key <qcode>...           teclado do PC (ex.: ret esc left)
#   emulator-qemu.sh [-i N] env                      variáveis da instância (para "eval")
#
# Perfil C8 (opt-in, --profile c8 ou EMU_PROFILE=c8): 1 GB, 2 vCPUs e cota de CPU no cgroup do QEMU
# (EMU_CPU_QUOTA, % de um núcleo do host para a VM inteira) para estimar o desempenho da TV.
# Sem perfil nada muda. Detalhes e calibração: webos/docs/BASELINE-C8.md.
#
# Instância N (padrão 0 ou $EMU_INSTANCE): portas no host = base + N*100
#   SSH 6622 (ares "emulator" / "emuN"), Web Inspector 9998, controle remoto 19001, VNC 590(5+N).
# O host é visto pelo emulador como 10.0.2.2.
set -euo pipefail

ROOT="$HOME/webos-tv-sdk"
HERE="$(cd "$(dirname "$0")" && pwd)"
RUN="$ROOT/run"
BASE="$ROOT/sdk/Emulator/v4.0.0/LG_webOS_TV_Emulator.vmdk"
BOXES=(flatpak run --filesystem="$ROOT" --command=qemu-system-x86_64 org.gnome.Boxes)

N="${EMU_INSTANCE:-0}"
if [[ "${1:-}" == "-i" ]]; then N="$2"; shift 2; fi
[[ "$N" =~ ^[0-9]$ ]] || { echo "erro: instância inválida: $N" >&2; exit 1; }

SSH_PORT=$((6622 + N * 100))
CDP_PORT=$((9998 + N * 100))
REMOTE_PORT=$((19001 + N * 100))
VNC_DISPLAY=$((5 + N))
OVERLAY="$RUN/overlay-$N.qcow2"
QMP="$RUN/qmp-$N.sock"
PIDFILE="$RUN/qemu-$N.pid"
SERIAL="$RUN/serial-$N.log"
DEVICE=$([[ "$N" == 0 ]] && echo emulator || echo "emu$N")

die() { echo "erro: $*" >&2; exit 1; }
# PID do QEMU no host. O pidfile do QEMU traz o PID do namespace do flatpak, então
# procura pelo nome do processo e pelo "-name webos4-N" na linha de comando.
host_pid() {
    local pid
    for pid in $(pgrep -x qemu-system-x86); do
        if tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q -- "-name webos4-$N "; then echo "$pid"; return 0; fi
    done
    return 1
}
running() { host_pid >/dev/null; }
# O QEMU roda em segundo plano e sobrevive ao chamador: ele não pode herdar a trava do pool
# (emu-run, flock em run/emu-N.lock), senão um emu-run morto à força deixaria a instância presa.
close_pool_locks() {
    local fd
    for fd in /proc/self/fd/*; do
        case "$(readlink "$fd" 2>/dev/null)" in
            "$RUN"/emu-*.lock) eval "exec ${fd##*/}>&-" ;;
        esac
    done
}
qmp() { WEBOS_QMP="$QMP" python3 -I "$HERE/qmp.py" "$@"; }
ensure_overlay() {
    [[ -f "$OVERLAY" ]] && return
    flatpak run --filesystem="$ROOT" --command=qemu-img org.gnome.Boxes \
        create -f qcow2 -b "$BASE" -F vmdk "$OVERLAY" >/dev/null
}

cmd="${1:-status}"
shift || true

case "$cmd" in
    env)
        echo "export EMU_INSTANCE=$N EMU_DEVICE=$DEVICE EMU_SSH_PORT=$SSH_PORT EMU_CDP_PORT=$CDP_PORT EMU_REMOTE_PORT=$REMOTE_PORT EMU_QMP=$QMP CDP_PORT=$CDP_PORT WEBOS_QMP=$QMP"
        ;;
    start)
        running && { echo "instância $N já em execução"; exit 0; }
        mode=headless mem="" smp="" sound=off
        profile="${EMU_PROFILE:-}" quota="${EMU_CPU_QUOTA:-}"
        while [[ $# -gt 0 ]]; do
            case "$1" in
                headless|gui) mode="$1" ;;
                --mem) mem="$2"; shift ;;
                --smp) smp="$2"; shift ;;
                --sound) sound="$2"; shift ;;   # off (padrão) | pa (som no PC)
                --profile) profile="$2"; shift ;;
                --cpu-quota) quota="$2"; shift ;;
                *) die "opção desconhecida: $1" ;;
            esac
            shift
        done
        # Precedência: opção explícita > variável > perfil > padrão (1024 MB, 3 vCPUs, sem cota).
        case "$profile" in
            "") ;;
            c8) : "${mem:=${EMU_C8_MEM:-1024}}" "${smp:=${EMU_C8_SMP:-2}}" "${quota:=${EMU_C8_QUOTA:-40}}" ;;
            *) die "perfil desconhecido: $profile (use c8)" ;;
        esac
        mem="${mem:-1024}" smp="${smp:-3}"
        [[ -z "$quota" || "$quota" =~ ^[0-9]+$ ]] || die "--cpu-quota deve ser um inteiro (% de um núcleo do host)"
        # Sem placa de som o pipeline de mídia do emulador reproduz normalmente; com AC97 e
        # backend "none" a reprodução trava em "stalled".
        case "$sound" in
            off) audio=() ;;
            pa) audio=(-audiodev pa,id=snd0 -device AC97,audiodev=snd0) ;;
            *) die "--sound deve ser off ou pa" ;;
        esac
        mkdir -p "$RUN"
        close_pool_locks
        ensure_overlay
        rm -f "$QMP" "$PIDFILE"
        if [[ "$mode" == gui ]]; then display=(-display gtk,zoom-to-fit=on); else display=(-display none -vnc "127.0.0.1:$VNC_DISPLAY"); fi
        # e1000: a NIC PCnet da VM oficial trava no QEMU depois de transferências grandes.
        nohup "${BOXES[@]}" -name "webos4-$N" -machine pc,accel=kvm -cpu host -smp "$smp" -m "$mem" \
            -drive file="$OVERLAY",format=qcow2,if=ide \
            -vga std \
            -netdev user,id=n0,hostfwd=tcp:127.0.0.1:$SSH_PORT-:22,hostfwd=tcp:127.0.0.1:$CDP_PORT-:9998,hostfwd=tcp:127.0.0.1:$REMOTE_PORT-:19001 \
            -device e1000,netdev=n0 \
            "${audio[@]}" \
            -usb -device usb-tablet \
            "${display[@]}" \
            -pidfile "$PIDFILE" \
            -qmp unix:"$QMP",server=on,wait=off \
            -serial file:"$SERIAL" > "$RUN/qemu-$N.log" 2>&1 &
        for _ in $(seq 1 20); do running && break; sleep 0.5; done
        running || die "QEMU não subiu (veja $RUN/qemu-$N.log)"
        if [[ -n "$quota" ]]; then
            # O flatpak move o QEMU para um scope transitório próprio (app-flatpak-org.gnome.Boxes-*.scope),
            # então um "systemd-run --scope" por fora não o alcança: a cota vai nesse scope, em tempo de execução.
            unit="$(sed 's#.*/##' "/proc/$(host_pid)/cgroup" 2>/dev/null || true)"
            if [[ "$unit" != app-flatpak-org.gnome.Boxes-*.scope ]] ||
                ! systemctl --user set-property --runtime "$unit" "CPUQuota=${quota}%" ${EMU_CPU_PERIOD_MS:+"CPUQuotaPeriodSec=${EMU_CPU_PERIOD_MS}ms"}; then
                kill "$(host_pid)" 2>/dev/null || true
                die "não consegui aplicar CPUQuota=${quota}% (scope do QEMU: ${unit:-?})"
            fi
        fi
        echo "instância $N iniciada ($mode, ${mem} MB, ${smp} vCPU${profile:+, perfil $profile}${quota:+, cota ${quota}% de CPU}) — ares: $DEVICE, inspector: $CDP_PORT"
        ;;
    pid)
        host_pid
        ;;
    wait)
        limit="${1:-180}"
        # O Web Inspector só responde com um app web aberto; o SSH basta para o ares.
        for ((i = 0; i < limit; i += 3)); do
            if timeout 3 bash -c "exec 3<>/dev/tcp/127.0.0.1/$SSH_PORT; head -c 4 <&3" 2>/dev/null | grep -q SSH; then
                echo "pronto"; exit 0
            fi
            sleep 3
        done
        die "timeout esperando o boot da instância $N"
        ;;
    status)
        if running; then qmp raw '{"execute":"query-status"}'; else echo "instância $N parada"; fi
        ;;
    stop)
        if ! running; then echo "instância $N já parada"; exit 0; fi
        timeout 5 env WEBOS_QMP="$QMP" python3 -I "$HERE/qmp.py" quit >/dev/null 2>&1 || true
        for _ in 1 2 3 4 5; do running || break; sleep 1; done
        if running; then
            kill "$(host_pid)"
            for _ in 1 2 3 4 5; do running || break; sleep 1; done
            if running; then kill -9 "$(host_pid)"; fi
        fi
        rm -f "$PIDFILE"
        echo "instância $N parada"
        ;;
    reset)
        running && die "pare a instância $N antes"
        rm -f "$OVERLAY"; ensure_overlay; echo "instância $N: overlay recriado (estado de fábrica)"
        ;;
    screenshot)
        out="$(realpath -m "${1:?informe o arquivo .png}")"
        qmp screendump "$out" >/dev/null && echo "$out"
        ;;
    key)
        [[ $# -gt 0 ]] || die "informe as teclas (qcodes)"
        qmp key "$@" >/dev/null
        ;;
    *)
        sed -n '2,16p' "$0"; exit 1
        ;;
esac
