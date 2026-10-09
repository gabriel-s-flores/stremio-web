#!/usr/bin/env bash
# Instala o VirtualBox para rodar o emulador LG webOS TV 4.0 (executar como root).
#   sudo bash <repo>/webos/tools/install-virtualbox-root.sh
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "Execute como root (sudo)." >&2
    exit 1
fi

# Módulos para os dois kernels instalados (6.18 em uso e 7.2).
pacman -S --needed --noconfirm \
    virtualbox \
    linux618-virtualbox-host-modules \
    linux72-virtualbox-host-modules

# Desde o kernel 6.12 o KVM liga o VT-x ao carregar o módulo, o que impede o
# VirtualBox de iniciar VMs. Com enable_virt_at_load=0 o KVM só liga o VT-x
# quando uma VM KVM está rodando, e os dois convivem.
echo "options kvm enable_virt_at_load=0" > /etc/modprobe.d/kvm-virtualbox.conf

if lsmod | grep -q '^kvm_intel'; then
    # Falha se houver uma VM KVM aberta; nesse caso a opção vale a partir do próximo boot.
    if ! modprobe -r kvm_intel kvm; then
        echo "aviso: KVM em uso; feche as VMs KVM ou reinicie para o VirtualBox funcionar" >&2
    fi
fi
modprobe kvm_intel
modprobe vboxdrv
modprobe vboxnetflt
modprobe vboxnetadp

echo "OK: VirtualBox $(VBoxManage --version) pronto; kvm.enable_virt_at_load=$(cat /sys/module/kvm/parameters/enable_virt_at_load)"
