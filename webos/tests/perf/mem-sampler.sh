#!/usr/bin/env bash
# Guest memory sampler (F7.1): runs on the host, reads the emulator over SSH and writes one line per
# sample to <out-file>:
#   <host epoch ms> <MemAvailable kB> <name>:<pid>:<VmRSS kB>:<RssAnon kB>:<RssFile kB>:<RssShmem kB> ...
# The host clock stamps the lines (the guest clock drifts), so the phases written by the scenarios
# (host clock too) line up. Processes listed: WebAppMgr (the app's renderer is a new one), the media
# pipeline (umediaserver, *pipeline*), node (the certificate proxy service) and anything with more
# than 5 MB. One awk per sample (a shell loop per process costs real CPU on a VM capped at 40 %,
# and the sampler must not be what is measured). Period: $PERF_MEM_PERIOD (default 2 s).
#   webos/tests/perf/mem-sampler.sh <out-file>     (inside webos/tools/emu-run; kill it when done)
set -uo pipefail
OUT="${1:?usage: mem-sampler.sh <out-file>}"
: "${EMU_SSH_PORT:?run inside webos/tools/emu-run}"
PERIOD="${PERF_MEM_PERIOD:-2}"
REMOTE="while true; do awk 'FNR==1 { n=\"\"; r=0 } /^MemAvailable:/ { a=\$2 } /^Name:/ { n=\$2 } /^VmRSS:/ { r=\$2 } /^RssAnon:/ { an=\$2 } /^RssFile:/ { fi=\$2 } /^RssShmem:/ { if (n != \"\" && (r > 5000 || n ~ /WebAppMgr|umediaserver|pipeline|starfish|gst-|node|stremio/)) { split(FILENAME, p, \"/\"); l = l \" \" n \":\" p[3] \":\" r \":\" an \":\" fi \":\" \$2 } } END { print a l }' /proc/meminfo /proc/[0-9]*/status 2>/dev/null; sleep $PERIOD; done"
ssh -q -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o HostKeyAlgorithms=+ssh-rsa \
    -o PubkeyAcceptedAlgorithms=+ssh-rsa -o BatchMode=yes -o ServerAliveInterval=10 \
    -i "$HOME/webos-tv-sdk/run/ares_webos_emul" -p "$EMU_SSH_PORT" developer@127.0.0.1 "$REMOTE" 2>/dev/null |
    node -e 'const rl=require("readline").createInterface({input:process.stdin});const fs=require("fs");const out=process.argv[1];rl.on("line",l=>{if(/^\d+( |$)/.test(l))fs.appendFileSync(out,Date.now()+" "+l+"\n")})' "$OUT"
