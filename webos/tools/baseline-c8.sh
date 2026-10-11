#!/usr/bin/env bash
# Mede o baseline de CPU de uma instância do emulador: tempo de boot até o SSH, tempo da sonda, um
# microbenchmark de JS e a compilação do core MVP (wasm-compile-test.sh). Uma linha JSON por execução.
# Roda DENTRO do emu-run, que define o perfil (opt-in):
#
#   emu-run [--profile c8] -- webos/tools/baseline-c8.sh <rótulo> [arquivo.wasm em run/www]
#
# Saída em $BASELINE_OUT (padrão ~/webos-tv-sdk/run/baseline-c8). Precisa de EMU_* (emu-run).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HOME/webos-tv-sdk"
LABEL="${1:?informe o rótulo da medição}"
WASM="${2:-core-0.65.0-mvp.wasm}"
OUT="${BASELINE_OUT:-$ROOT/run/baseline-c8}"
: "${EMU_INSTANCE:?rode dentro do emu-run}"
mkdir -p "$OUT"
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d)"
trap 'kill ${HTTP:-} 2>/dev/null || true; rm -rf "$WORK"' EXIT

# Boot: idade do processo QEMU quando o SSH respondeu (precisão de ~3 s, o intervalo do "wait").
qpid="$(for p in $(pgrep -x qemu-system-x86); do tr '\0' ' ' < /proc/$p/cmdline | grep -q -- "-name webos4-$EMU_INSTANCE " && echo "$p" && break; done)"
boot_s="$(ps -o etimes= -p "$qpid" | tr -d ' ')"
unit="$(sed 's#.*/##' /proc/$qpid/cgroup)"
# Sem cota, o arquivo some ou diz "max 100000", conforme outro scope tenha ligado o controlador cpu em app.slice: os dois viram "max".
cpu_max="$(cat "/sys/fs/cgroup/user.slice/user-$(id -u).slice/user@$(id -u).service/app.slice/$unit/cpu.max" 2>/dev/null || echo max)"
[[ "$cpu_max" != "max "* ]] || cpu_max=max
smp="$(tr '\0' ' ' < /proc/$qpid/cmdline | grep -o -- '-smp [0-9]*' | cut -d' ' -f2)"
load_start="$(cut -d' ' -f1-3 /proc/loadavg)"
# Referência no host (mesmo laço do benchmark da página, em Node, mínimo de 3): mostra a disputa por CPU.
host_ref() { for _ in 1 2 3; do node -e 'var t=Date.now(),a=0;for(var i=0;i<30000000;i++){a=(a+i*i)%1000003}console.log(Date.now()-t)'; done | sort -n | head -1; }
ref_start="$(host_ref)"

# Sonda: da instalação até window.__probe.complete.
t0=$(date +%s.%N)
PROBE_WAIT=300 PROBE_OUT="$OUT/probe-$LABEL-$STAMP" "$HERE/probe-run.sh" >"$WORK/probe.out" 2>&1 || { cat "$WORK/probe.out" >&2; exit 1; }
probe_s=$(echo "$(date +%s.%N) - $t0" | bc)
probe_json="$(tail -1 "$WORK/probe.out")"
hc="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["hardwareConcurrency"])' "$probe_json")"
pcomplete="$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["complete"])' "$probe_json")"

# Microbenchmark de JS na página da sonda (CPU pura: laço de inteiros e sort).
JSB='(function(){var best=null;for(var r=0;r<2;r++){var t=Date.now(),a=0,i;for(i=0;i<30000000;i++){a=(a+i*i)%1000003;}var l=Date.now()-t;var arr=[];for(i=0;i<300000;i++)arr.push((i*7919)%100003);t=Date.now();arr.sort(function(x,y){return x-y;});var s=Date.now()-t;if(!best||l+s<best.loopMs+best.sortMs)best={loopMs:l,sortMs:s,chk:a};}return JSON.stringify(best);})()'
jsb="$(node "$HERE/cdp.mjs" --target io.github.gabrielsflores.webosprobe --timeout 300000 eval "$JSB")"

# Compilação do core MVP num Worker, com a porta SSH da instância e um servidor estático próprio
# e só de leitura (run/www) numa porta por instância, sem disputar a 8099 com outros usos.
WP=$((18000 + EMU_INSTANCE))
python3 -I -m http.server "$WP" --bind 127.0.0.1 --directory "$ROOT/run/www" >/dev/null 2>&1 &
HTTP=$!
sleep 1
# Se a compilação passar de $WASM_TIMEOUT_MS (padrão 180 s) ela é registrada como "timeout".
WASM_TIMEOUT_MS="${WASM_TIMEOUT_MS:-180000}" WASM_HTTP_PORT="$WP" WASM_MEM_LOG="$WORK/mem.log" \
    bash "$HERE/wasm-compile-test.sh" "$WASM" > "$WORK/wasm.out" 2>&1 || true
cp "$WORK/wasm.out" "$OUT/wasm-$LABEL-$STAMP.txt"
wasm_json="$(sed -n '/^{/,/^}/p' "$WORK/wasm.out")"
[[ -n "$wasm_json" ]] || wasm_json='{"name": "'"$WASM"'", "compile": "timeout"}'
memmin="$(grep -o 'mínimo (kB): [0-9]*' "$WORK/wasm.out" | grep -o '[0-9]*$' || true)"
memmin="${memmin:-0}"
load_end="$(cut -d' ' -f1-3 /proc/loadavg)"
ref_end="$(host_ref)"

python3 -I - "$LABEL" "${EMU_PROFILE:-}" "$smp" "$cpu_max" "$boot_s" "$probe_s" "$hc" "$jsb" "$wasm_json" "$memmin" "$load_start" "$load_end" "$(nproc)" "$ref_start" "$ref_end" "$pcomplete" <<'PY' | tee -a "$OUT/results.jsonl"
import json, sys
(label, profile, smp, cpu_max, boot, probe, hc, jsb, wasm, mem, l0, l1, nproc, r0, r1, pc) = sys.argv[1:]
w = json.loads(wasm)
print(json.dumps({
    "label": label, "profile": profile or "none", "vcpus": int(smp), "cpu_max": cpu_max,
    "boot_to_ssh_s": int(boot), "probe_s": round(float(probe), 1), "probe_complete": pc == "True", "guest_hardwareConcurrency": int(hc),
    "js": json.loads(jsb), "wasm": {k: w.get(k) for k in ("name", "bytes", "fetchMs", "validateMs", "compile", "compileMs")},
    "memavail_min_kb": int(mem), "host_load_start": l0, "host_load_end": l1, "host_cpus": int(nproc), "host_ref_ms": [int(r0), int(r1)],
}))
PY
