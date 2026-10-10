#!/usr/bin/env bash
# Compila um .wasm dentro de um Web Worker no emulador (como o core roda em produção)
# e amostra a memória do convidado durante a compilação.
#   wasm-compile-test.sh <arquivo em run/www>     ex.: core-0.57.0.wasm
# Requer: emulador no ar, app-sonda aberto, servidor estático em 127.0.0.1:8099 (run/www).
# Dentro do emu-run usa a porta SSH da instância ($EMU_SSH_PORT; fora dele, 6622). Variáveis opcionais:
# WASM_HTTP_PORT (servidor estático, padrão 8099), WASM_MEM_LOG (arquivo da amostragem de memória)
# e WASM_TIMEOUT_MS (padrão 600000).
set -euo pipefail
ROOT="$HOME/webos-tv-sdk"
NAME="${1:?informe o .wasm (em run/www)}"
SSH=(ssh -q -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o HostKeyAlgorithms=+ssh-rsa
     -o PubkeyAcceptedAlgorithms=+ssh-rsa -o BatchMode=yes -i "$ROOT/run/ares_webos_emul" -p "${EMU_SSH_PORT:-6622}" developer@127.0.0.1)
LOG="${WASM_MEM_LOG:-$ROOT/run/mem-$NAME.log}"
HTTP_PORT="${WASM_HTTP_PORT:-8099}"

"${SSH[@]}" 'while true; do echo "$(date +%s) $(grep MemAvailable /proc/meminfo | tr -s " " | cut -d" " -f2)"; sleep 2; done' > "$LOG" 2>/dev/null &
MON=$!
trap 'kill $MON 2>/dev/null || true' EXIT

WORKER='self.onmessage=function(e){var n=e.data,t0=Date.now();fetch("http://10.0.2.2:8099/"+n).then(function(r){return r.arrayBuffer();}).then(function(b){var t1=Date.now(),v;try{v=WebAssembly.validate(b);}catch(x){v="throw "+x;}var t2=Date.now();return WebAssembly.compile(b).then(function(m){var M=WebAssembly.Module;self.postMessage({name:n,bytes:b.byteLength,fetchMs:t1-t0,validate:v,validateMs:t2-t1,compile:"ok",compileMs:Date.now()-t2,imports:M.imports?M.imports(m).length:null,exports:M.exports?M.exports(m).length:null});},function(x){self.postMessage({name:n,validate:v,compile:String(x).slice(0,400),compileMs:Date.now()-t2});});}).catch(function(x){self.postMessage({name:n,error:String(x)});});};'
WORKER="${WORKER//10.0.2.2:8099/10.0.2.2:$HTTP_PORT}"

EXPR="new Promise(function(res){var w=new Worker(URL.createObjectURL(new Blob([$(python3 -I -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$WORKER")],{type:'application/javascript'})));w.onmessage=function(e){res(e.data);w.terminate();};w.onerror=function(e){res({workerError:e.message});};w.postMessage('$NAME');})"

node "$(dirname "$0")/cdp.mjs" --target webosprobe --timeout "${WASM_TIMEOUT_MS:-600000}" eval "$EXPR"
sleep 3
awk 'NR==1{min=$2} {if($2<min)min=$2} END{print "MemAvailable mínimo (kB): " min " em " NR " amostras"}' "$LOG"
