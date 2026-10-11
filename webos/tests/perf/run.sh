#!/usr/bin/env bash
# One measurement scenario inside an emu-run reservation (F7.1): starts the guest memory sampler, runs
# the scenario script, stops the sampler and turns the phases into mem.json (mem-analyze.mjs).
#
#   webos/tools/emu-run --profile c8 --timeout 40 -- webos/tests/perf/run.sh <out-dir> <boot|nav|play> [script options...]
#
# e.g. ... run.sh out/nav-1 nav --ipk dist-webos/x.ipk --quiet 30
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$(realpath -m "${1:?usage: run.sh <out-dir> <boot|nav|play> [options]}")"
SCENARIO="${2:?scenario}"
shift 2
: "${EMU_DEVICE:?run inside webos/tools/emu-run}"
mkdir -p "$OUT"
rm -f "$OUT/mem.log"
"$HERE/context.sh" > "$OUT/context-start.json"
"$HERE/mem-sampler.sh" "$OUT/mem.log" &
SAMPLER=$!
trap 'kill $SAMPLER 2>/dev/null; pkill -P $SAMPLER 2>/dev/null || true' EXIT
# A baseline before the first phase: the app's renderer is the one that was not there yet.
for _ in $(seq 1 30); do [[ -s "$OUT/mem.log" ]] && break; sleep 1; done
sleep 8
node "$HERE/$SCENARIO.mjs" --out "$OUT" "$@" 2>&1 | tee "$OUT/$SCENARIO.log"
rc=${PIPESTATUS[0]}
"$HERE/context.sh" > "$OUT/context-end.json"
kill $SAMPLER 2>/dev/null; pkill -P $SAMPLER 2>/dev/null || true
# Did the kernel kill something (OOM)? dmesg stamps are seconds since the guest boot; the guest uptime
# and the host clock taken together convert them to the host time of the phases.
ssh -q -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o HostKeyAlgorithms=+ssh-rsa -o PubkeyAcceptedAlgorithms=+ssh-rsa \
    -o BatchMode=yes -i "$HOME/webos-tv-sdk/run/ares_webos_emul" -p "$EMU_SSH_PORT" developer@127.0.0.1 \
    'cut -d" " -f1 /proc/uptime; dmesg | grep -iE "oom|out of memory|killed process|lowmem|memorymanager" | tail -40' > "$OUT/dmesg-oom.txt" 2>/dev/null
echo "hostEpochMs $(date +%s%3N)" >> "$OUT/dmesg-oom.txt"
if [[ -s "$OUT/phases.jsonl" && -s "$OUT/mem.log" ]]; then
    node "$HERE/mem-analyze.mjs" "$OUT/mem.log" "$OUT/phases.jsonl" "$OUT/mem.json" > /dev/null || echo "mem-analyze failed" >&2
fi
exit "$rc"
