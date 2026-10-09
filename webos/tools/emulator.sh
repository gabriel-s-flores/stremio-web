#!/usr/bin/env bash
# Controle do emulador LG webOS TV 4.0 (VirtualBox) para testes automatizados.
#
#   emulator.sh register            registra a VM do SDK no VirtualBox (uma vez)
#   emulator.sh start [headless|gui|separate]
#   emulator.sh wait [segundos]     espera o boot (SSH + Web Inspector)
#   emulator.sh status
#   emulator.sh screenshot <arquivo.png>
#   emulator.sh stop
#   emulator.sh unregister
#
# Portas encaminhadas pela VM: 6622 -> SSH, 9998 -> Web Inspector, 19001 -> controle remoto.
set -euo pipefail

SDK_HOME="${LG_WEBOS_TV_SDK_HOME:-$HOME/webos-tv-sdk/sdk}"
VM_DIR="$SDK_HOME/Emulator/v4.0.0"
VM_UUID="9e8b9f29-44b9-4a6e-1466-2058a70341cb"
VM_NAME="LG webOS TV Emulator 4.0.0"

die() { echo "erro: $*" >&2; exit 1; }
need_vbox() { command -v VBoxManage >/dev/null || die "VirtualBox não instalado (rode scripts/install-virtualbox-root.sh com sudo)"; }
is_registered() { VBoxManage showvminfo "$VM_UUID" >/dev/null 2>&1; }
is_running() { VBoxManage list runningvms | grep -q "$VM_UUID"; }
port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

cmd="${1:-status}"
shift || true

case "$cmd" in
    register)
        need_vbox
        if is_registered; then echo "já registrada"; exit 0; fi
        VBoxManage registervm "$VM_DIR/LG_webOS_TV_Emulator.vbox"
        # O .vbox original usa o driver de áudio do Windows (DirectSound).
        VBoxManage modifyvm "$VM_UUID" --audio-driver default --macaddress1 auto --clipboard-mode disabled
        mkdir -p "$HOME/webOS_SDK/EmulWorkspace"
        VBoxManage sharedfolder add "$VM_UUID" --name shared --hostpath "$HOME/webOS_SDK/EmulWorkspace" || true
        echo "registrada: $VM_NAME"
        ;;
    start)
        need_vbox
        is_registered || die "VM não registrada (emulator.sh register)"
        if is_running; then echo "já em execução"; exit 0; fi
        VBoxManage startvm "$VM_UUID" --type "${1:-headless}"
        ;;
    wait)
        timeout_s="${1:-240}"
        for ((i = 0; i < timeout_s; i += 3)); do
            if port_open 6622 && port_open 9998; then echo "pronto (SSH 6622 e inspector 9998 abertos)"; exit 0; fi
            sleep 3
        done
        die "timeout esperando o boot"
        ;;
    status)
        need_vbox
        if ! is_registered; then echo "não registrada"; exit 0; fi
        if is_running; then echo "em execução"; else echo "parada"; fi
        for p in 6622 9998 19001; do
            if port_open "$p"; then echo "  porta $p: aberta"; else echo "  porta $p: fechada"; fi
        done
        ;;
    screenshot)
        need_vbox
        out="${1:?informe o arquivo .png}"
        VBoxManage controlvm "$VM_UUID" screenshotpng "$(realpath -m "$out")"
        echo "$out"
        ;;
    stop)
        need_vbox
        is_running && VBoxManage controlvm "$VM_UUID" poweroff || echo "já parada"
        ;;
    unregister)
        need_vbox
        is_running && VBoxManage controlvm "$VM_UUID" poweroff || true
        # Não usa --delete: o disco fica no SDK para reutilização.
        VBoxManage unregistervm "$VM_UUID"
        ;;
    *)
        sed -n '2,13p' "$0"
        exit 1
        ;;
esac
