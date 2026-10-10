#!/usr/bin/env bash
# Acceptance of the tlsproxy in the app (F3.7) on one emulator instance, from a clean boot:
#   pnpm webos:package
#   webos/tools/emu-run --timeout 20 -- webos/tlsproxy/emulator/run.sh <out-dir>
# 1. installs dist-webos/*.ipk and samples the memory of the service and of WebAppMgr (SSH, 2 s);
# 2. launches the app and runs accept.mjs (Board, Discover, detail, Let's Encrypt addon, service
#    killed and recovered, latency, network log);
# 3. runs security-test.mjs against the app's service through an SSH tunnel, with the redirect
#    cases also in the app's fetch (Chromium 53);
# 4. runs node012-test.js (proxy.js on the emulator's Node 0.12, local HTTPS upstreams);
# 5. closes the app and checks that the service exits by itself.
# Exit status: non-zero if accept.mjs, security-test.mjs or node012-test.js failed.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
OUT="$(realpath -m "${1:?out dir}")"
APP=io.github.gabrielsflores.stremio
: "${EMU_DEVICE:?run inside webos/tools/emu-run}"
mkdir -p "$OUT"
SSH_OPTS=(-q -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o HostKeyAlgorithms=+ssh-rsa
    -o PubkeyAcceptedAlgorithms=+ssh-rsa -o BatchMode=yes -i "$HOME/webos-tv-sdk/run/ares_webos_emul" -p "$EMU_SSH_PORT")
SSH=(ssh "${SSH_OPTS[@]}" developer@127.0.0.1)
CDP=(node "$ROOT/webos/tools/cdp.mjs" --port "$EMU_CDP_PORT" --target "$APP" --timeout 30000)
# "<epoch> <MemAvailable kB> svc:<pid>:<VmRSS kB> wam:<pid>:<VmRSS kB>..." (the service's process
# name is its id, cut to 15 characters).
SAMPLER='while true; do
  a=$(grep MemAvailable /proc/meminfo | tr -s " " | cut -d" " -f2); line=""
  for s in /proc/[0-9]*/status; do
    n=$(sed -n "s/^Name:\t//p" "$s" 2>/dev/null)
    case "$n" in io.github.gabri*) t=svc;; WebAppMgr*|wam*) t=wam;; *) continue;; esac
    k=$(sed -n "s/^VmRSS:[^0-9]*\([0-9]*\).*/\1/p" "$s" 2>/dev/null); [ -n "$k" ] || continue
    p=${s#/proc/}; line="$line $t:${p%/status}:$k"
  done
  echo "$(date +%s) $a$line"; sleep 2
done'

{ echo "start $(date -Is) · profile ${EMU_PROFILE:-default} · instance $EMU_INSTANCE"; echo "commit $(git -C "$ROOT" rev-parse --short HEAD)"; } > "$OUT/info.txt"
ares-install -d "$EMU_DEVICE" "$ROOT"/dist-webos/*.ipk >> "$OUT/info.txt" 2>&1
"${SSH[@]}" "$SAMPLER" > "$OUT/mem.log" 2>/dev/null &
SAMPLER_PID=$!
trap 'kill $SAMPLER_PID 2>/dev/null || true' EXIT
sleep 4

ares-launch -d "$EMU_DEVICE" "$APP" >> "$OUT/info.txt" 2>&1
node "$HERE/accept.mjs" --port "$EMU_CDP_PORT" --out "$OUT" 2> "$OUT/accept.log" | tee "$OUT/accept.txt"
accept=${PIPESTATUS[0]}

# Security battery through a tunnel to the service port inside the emulator.
CONFIG="$("${CDP[@]}" eval 'window.__webosTlsProxy.config().then(function(c){return c.port+" "+c.token;})')"
read -r PORT TOKEN <<< "$CONFIG"
LP=$((47500 + EMU_INSTANCE))
ssh "${SSH_OPTS[@]}" -o ExitOnForwardFailure=yes -N -L "$LP:127.0.0.1:$PORT" developer@127.0.0.1 &
TUNNEL_PID=$!
for _ in $(seq 1 20); do (exec 3<>"/dev/tcp/127.0.0.1/$LP") 2>/dev/null && break; sleep 0.5; done
node "$ROOT/webos/tlsproxy/security-test.mjs" --base "http://127.0.0.1:$LP" --port "$PORT" --token "$TOKEN" \
    --cdp-port "$EMU_CDP_PORT" --target "$APP" --out "$OUT/security.json" | tee "$OUT/security.txt"
security=${PIPESTATUS[0]}
kill "$TUNNEL_PID" 2>/dev/null || true
"${CDP[@]}" eval 'new Promise(function(r){webOS.service.request("luna://io.github.gabrielsflores.stremio.tlsproxy",{method:"status",parameters:{},onSuccess:r,onFailure:r});})' > "$OUT/service-status.json" 2>&1
node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log((s.log||[]).join("\n"))' "$OUT/service-status.json" > "$OUT/service-log.txt" 2>&1 || true

# proxy.js on the emulator's own Node 0.12 against local HTTPS upstreams (short body, timeout,
# A -> B -> A, 0xFF signatures): node012-test.js with proxy.js and the test fixtures in /tmp.
REMOTE=/tmp/f37-node012
"${SSH[@]}" "rm -rf $REMOTE && mkdir -p $REMOTE"
for f in "$ROOT/webos/tlsproxy/service/proxy.js" "$HERE/node012-test.js" "$ROOT"/webos/tests/tlsproxy/fixtures/{ca.pem,leaf.pem,leaf.key}; do
    "${SSH[@]}" "cat > $REMOTE/$(basename "$f")" < "$f"
done
"${SSH[@]}" "NODE=\$(command -v node || ls /usr/bin/node* 2>/dev/null | head -1); echo \"node: \$NODE\"; \$NODE $REMOTE/node012-test.js $REMOTE; echo exit=\$?; rm -rf $REMOTE" 2>&1 | tee "$OUT/node012.txt"
node012=1; grep -q '^exit=0$' "$OUT/node012.txt" && node012=0

# Closing the app drops the subscription: the service must exit by itself (idle timer, 5 s).
ares-launch -d "$EMU_DEVICE" --close "$APP" >> "$OUT/info.txt" 2>&1
sleep 15
kill $SAMPLER_PID 2>/dev/null || true
"${SSH[@]}" 'for s in /proc/[0-9]*/status; do sed -n "s/^Name:\t//p" "$s"; done | grep -c "^io.github.gabri"' > "$OUT/service-after-close.txt" 2>&1
echo "end $(date -Is) · accept=$accept security=$security node012=$node012 · service processes after close: $(cat "$OUT/service-after-close.txt")" | tee -a "$OUT/info.txt"
node "$HERE/memory.mjs" "$OUT/mem.log" | tee "$OUT/memory.txt"
[[ $accept -eq 0 && $security -eq 0 && $node012 -eq 0 ]]
