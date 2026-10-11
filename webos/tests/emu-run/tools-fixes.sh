#!/usr/bin/env bash
# Checks of the small fixes of webos/tools made in F7.1 (from the F0.9 review). No emulator needed (a few
# seconds): the help of emulator-qemu.sh, the quota validation, and the .ppm.tmp left by qmp.py.
#   webos/tests/emu-run/tools-fixes.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TOOLS="$HERE/../../tools"
fail=0
check() { if [[ "$2" == ok ]]; then echo "ok    $1"; else echo "FAIL  $1: $2"; fail=1; fi; }

# 1. The help prints the whole comment header (it used to be cut by a fixed `sed 2,Np`).
help="$("$TOOLS/emulator-qemu.sh" -i 9 not-a-command 2>&1 || true)"
[[ "$help" == *'O host é visto pelo emulador como 10.0.2.2.'* ]] && check "help shows the last header line" ok || check "help shows the last header line" "missing"
[[ "$help" != *'set -euo pipefail'* ]] && check "help stops before the code" ok || check "help stops before the code" "prints code"

# 2. Quota 0 is refused before QEMU starts (systemd would refuse it only after the VM was up).
for q in 0 00 abc -5 ''; do
    [[ -z "$q" ]] && continue
    out="$(EMU_CPU_QUOTA=$q "$TOOLS/emulator-qemu.sh" -i 9 start headless --profile c8 2>&1)"; rc=$?
    if [[ $rc -ne 0 && "$out" == *'inteiro maior que zero'* ]] && [[ "$("$TOOLS/emulator-qemu.sh" -i 9 status 2>&1)" == *parada* ]]; then check "quota '$q' refused, no QEMU" ok; else check "quota '$q' refused, no QEMU" "rc=$rc out=$out"; fi
done

# 3. qmp.py removes its .ppm.tmp even when the conversion fails (fake QMP server, bad and good PPM).
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"; kill $(jobs -p) 2>/dev/null' EXIT
for mode in bad good; do
    rm -f "$TMP/s.sock" "$TMP/out.png"
    python3 -I - "$mode" "$TMP/s.sock" > /dev/null <<'PY' &
import json, socket, sys
mode, path = sys.argv[1], sys.argv[2]
s = socket.socket(socket.AF_UNIX); s.bind(path); s.listen(1)
c, _ = s.accept(); f = c.makefile('rw')
f.write(json.dumps({"QMP": {}}) + "\n"); f.flush()
for line in f:
    cmd = json.loads(line)
    if cmd['execute'] == 'screendump':
        open(cmd['arguments']['filename'], 'wb').write(b'P5\n1 1\n255\n\0' if mode == 'bad' else b'P6\n1 1\n255\n\1\2\3')
    f.write(json.dumps({"return": {}}) + "\n"); f.flush()
PY
    for _ in $(seq 1 50); do [[ -S "$TMP/s.sock" ]] && break; sleep 0.1; done
    WEBOS_QMP="$TMP/s.sock" python3 -I "$TOOLS/qmp.py" screendump "$TMP/out.png" > /dev/null 2>&1
    wait
    left="$(ls "$TMP"/*.tmp 2>/dev/null | wc -l)"
    [[ "$left" == 0 ]] && check "qmp.py $mode PPM leaves no .ppm.tmp" ok || check "qmp.py $mode PPM leaves no .ppm.tmp" "$left left"
done
[[ -s "$TMP/out.png" ]] && check "qmp.py good PPM writes the PNG" ok || check "qmp.py good PPM writes the PNG" "no PNG"
exit $fail
