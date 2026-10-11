#!/usr/bin/env bash
# Host state around a measurement (F7.1): one JSON line with the load, the pool use and a CPU
# reference loop, so that every number in BASELINE-C8.md can be judged against the contention it
# was taken under. The host is shared with other agents and emulators.
#
#   webos/tests/perf/context.sh [--no-ref]
#
# - load1/5/15, runnable tasks and CPUs (/proc/loadavg, nproc);
# - poolBusy: how many of the emu-N.lock files are held by someone else (read from /proc/locks, so
#   it never takes a lock and never steals an instance from a waiting emu-run); EMU_INSTANCE (this
#   reservation) is excluded when set;
# - qemu: number of qemu-system processes, and how many of them are under a CPU quota (profile c8);
# - mhz: mean "cpu MHz" (a laptop CPU that throttles shows up here);
# - psiCpu/psiIo/psiMem: /proc/pressure avg10 of "some" (% of the last 10 s with a task stalled on that resource);
# - hostRefMs: the same 30 M-iteration loop as baseline-c8.sh (min of 3). ~600 ms on an idle host.
#   Skipped with --no-ref (it takes ~2 s of one host core).
set -uo pipefail
RUN="$HOME/webos-tv-sdk/run"
REF=1
[[ "${1:-}" == "--no-ref" ]] && REF=0
inodes=""
for n in 0 1 2 3 4 5 6 7; do
    [[ "$n" == "${EMU_INSTANCE:-x}" ]] && continue
    [[ -e "$RUN/emu-$n.lock" ]] && inodes="$inodes $(stat -c %i "$RUN/emu-$n.lock")"
done
busy=0
for i in $inodes; do grep -qE "[0-9a-f]+:[0-9a-f]+:$i " /proc/locks && busy=$((busy + 1)); done
qemu=$(pgrep -xc qemu-system-x86 || true)
quota=$(for c in /sys/fs/cgroup/user.slice/user-"$(id -u)".slice/user@"$(id -u)".service/app.slice/app-flatpak-org.gnome.Boxes-*.scope/cpu.max; do [[ -e "$c" ]] && grep -v '^max' "$c"; done 2>/dev/null | wc -l)
ref=null
if [[ "$REF" == 1 ]]; then
    ref=$(for _ in 1 2 3; do node -e 'var t=Date.now(),a=0;for(var i=0;i<30000000;i++){a=(a+i*i)%1000003}console.log(Date.now()-t)'; done | sort -n | head -1)
fi
mhz=$(awk '/^cpu MHz/ {s+=$4; n++} END {if (n) printf "%d", s/n}' /proc/cpuinfo)
read -r l1 l5 l15 procs _ < /proc/loadavg
# Pressure stall information (kernel >= 4.20): the share of the last 10 s in which some task waited for the CPU, for
# the disk and for memory. The load average and the CPU loop do not see the disk and memory contention that slowed
# some rounds of the A/B (F7.1); empty if the kernel has no PSI.
psi() { [[ -r "/proc/pressure/$1" ]] && sed -n 's/^some avg10=\([0-9.]*\).*/\1/p' "/proc/pressure/$1" || echo null; }
psi_cpu="$(psi cpu)" psi_io="$(psi io)" psi_mem="$(psi memory)"
node -e '
const [l1, l5, l15, procs, cpus, busy, qemu, quota, ref, mhz, pc, pi, pm] = process.argv.slice(1);
console.log(JSON.stringify({
    at: new Date().toISOString(), load1: +l1, load5: +l5, load15: +l15, running: +procs.split("/")[0], cpus: +cpus,
    poolBusy: +busy, qemu: +qemu, qemuWithQuota: +quota, mhz: +mhz || null, hostRefMs: ref === "null" ? null : +ref,
    psiCpu: pc === "null" ? null : +pc, psiIo: pi === "null" ? null : +pi, psiMem: pm === "null" ? null : +pm,
}));' "$l1" "$l5" "$l15" "$procs" "$(nproc)" "$busy" "$qemu" "$quota" "$ref" "$mhz" "$psi_cpu" "$psi_io" "$psi_mem"
