#!/usr/bin/env bash
# Guest memory sampler (F7.1): runs on the host, reads the emulator over SSH and writes one line per
# sample to <out-file>:
#   <host epoch ms> <MemAvailable kB> <name>:<pid>:<VmRSS kB>:<RssAnon kB>:<RssFile kB>:<RssShmem kB> ...
# The host clock stamps the lines (the guest clock drifts), so the phases written by the scenarios
# (host clock too) line up. Processes listed: WebAppMgr (the app's renderer is a new one), the media
# pipeline (umediaserver, starfish-media-pipeline, gst-*), node (the certificate proxy service) and anything
# with more than 5 MB. One awk per sample (a shell loop per process costs real CPU on a VM capped at 40 %,
# and the sampler must not be what is measured). Period: $PERF_MEM_PERIOD (default 2 s).
# PERF_THREADS=1 also samples the CPU ticks of the renderer's threads (by name) into <out-file with .log -> .threads.log>:
#   <host epoch ms> <name>:<ticks> ...        (the guest side is mem-sampler-guest.sh)
#   webos/tests/perf/mem-sampler.sh <out-file>     (inside webos/tools/emu-run; kill it when done)
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:?usage: mem-sampler.sh <out-file>}"
: "${EMU_SSH_PORT:?run inside webos/tools/emu-run}"
THREADS_OUT="${OUT%.log}.threads.log"
{ printf 'PERIOD=%s THREADS=%s\n' "${PERF_MEM_PERIOD:-2}" "${PERF_THREADS:-0}"; cat "$HERE/mem-sampler-guest.sh"; } |
    ssh -q -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o HostKeyAlgorithms=+ssh-rsa \
        -o PubkeyAcceptedAlgorithms=+ssh-rsa -o BatchMode=yes -o ServerAliveInterval=10 \
        -i "$HOME/webos-tv-sdk/run/ares_webos_emul" -p "$EMU_SSH_PORT" developer@127.0.0.1 "sh -s" 2>/dev/null |
    node -e 'const rl=require("readline").createInterface({input:process.stdin});const fs=require("fs");const [out,tout]=process.argv.slice(1);rl.on("line",l=>{if(/^\d+( |$)/.test(l))fs.appendFileSync(out,Date.now()+" "+l+"\n");else if(l.startsWith("T "))fs.appendFileSync(tout,Date.now()+" "+l.slice(2)+"\n")})' "$OUT" "$THREADS_OUT"
