#!/usr/bin/env bash
# F0.12: a SIGKILL on emu-run must not leave the pool instance locked.
#
# Hermetic: runs the real emu-run and emulator-qemu.sh against a throwaway $HOME, with a fake
# `flatpak` that "boots" a stand-in QEMU (a python3 symlink named qemu-system-x86_64 that answers
# the SSH banner). Same process tree as the real thing: the QEMU is started in the background by
# emulator-qemu.sh and survives its caller. Uses instance 9 (outside the pool) so it never touches
# real instances or ports of other agents. Takes ~15 s, no emulator needed.
#
#   webos/tests/emu-run/lock-kill.sh [tools-dir]      (tools-dir defaults to webos/tools)
set -euo pipefail
TOOLS="$(cd "${1:-$(dirname "$0")/../../tools}" && pwd)"
N=9
SSH_PORT=$((6622 + N * 100))

TMP="$(mktemp -d)"
export HOME="$TMP/home"
RUN="$HOME/webos-tv-sdk/run"
BIN="$TMP/bin"
LOCK="$RUN/emu-$N.lock"
mkdir -p "$RUN" "$BIN"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }
cleanup() {
    local pid
    for pid in "$(qemu_pid)" "$(cat "$TMP/inner.pid" 2>/dev/null || true)"; do
        [[ -z "$pid" ]] || kill -9 "$pid" 2>/dev/null || true
    done
    rm -rf "$TMP"
}
trap cleanup EXIT

# Fake flatpak: `--command=qemu-img … <overlay>` creates the overlay; `--command=qemu-system-x86_64 <args>`
# execs a process whose comm is qemu-system-x86 and whose cmdline carries the real QEMU arguments.
ln -s "$(realpath "$(command -v python3)")" "$BIN/qemu-system-x86_64"
cat > "$BIN/flatpak" <<'FAKE'
#!/usr/bin/env bash
cmd="" args=()
for a in "$@"; do
    case "$a" in
        --command=*) cmd="${a#--command=}" ;;
        run|--filesystem=*|org.gnome.Boxes) ;;
        *) args+=("$a") ;;
    esac
done
case "$cmd" in
    qemu-img) touch "${args[-1]}" ;;
    qemu-system-x86_64)
        exec "$(dirname "$0")/qemu-system-x86_64" -c '
import re, socket, sys, time
port = int(re.search(r"hostfwd=tcp:127\.0\.0\.1:(\d+)-", " ".join(sys.argv)).group(1))
s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(("127.0.0.1", port)); s.listen(8)
while True:
    c, _ = s.accept(); c.sendall(b"SSH-2.0-fake\r\n"); c.close()
' "${args[@]}" ;;
    *) echo "fake flatpak: unexpected $*" >&2; exit 1 ;;
esac
FAKE
chmod +x "$BIN/flatpak"
export PATH="$BIN:$PATH"

qemu_pid() { # host pid of the stand-in QEMU of instance $N (empty if none)
    local pid
    for pid in $(pgrep -x qemu-system-x86 || true); do
        if tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q -- "-name webos4-$N "; then echo "$pid"; return 0; fi
    done
    return 0
}
lock_free() { flock -n "$LOCK" true; }
holders() { fuser "$LOCK" 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$' || true; }
show_holders() { fuser -v "$LOCK" 2>&1 || echo "  (no process holds $LOCK)"; }

wait_for() { # <description> <command...>
    local what="$1"; shift
    for _ in $(seq 1 120); do "$@" && return 0; sleep 0.5; done
    fail "timeout waiting for: $what"
}
grep_log() { grep -q -- "$1" "$TMP/$2.log"; }

# 1. Reserve the instance and keep a command running inside it.
"$TOOLS/emu-run" --instance "$N" --timeout 5 -- bash -c "echo \$\$ > $TMP/inner.pid; exec sleep 4242" > "$TMP/run1.log" 2>&1 &
RUN1=$!
wait_for "emu-run reservation ready" grep_log "instância $N pronta" run1
QPID="$(qemu_pid)"
[[ -n "$QPID" ]] || fail "QEMU of instance $N not running"
lock_free && fail "lock must be held while emu-run is alive"
pass "reserved: emu-run=$RUN1 qemu=$QPID, lock held"
echo "fuser before kill:"; show_holders

# 2. Who holds the lock before the kill (the bug: QEMU, timeout and the command inherited the FD).
others="$({ holders | grep -vx "$RUN1" || true; } | tr '\n' ' ')"

# 3. SIGKILL emu-run in the middle of the reservation: the lock must be released.
kill -9 "$RUN1"; wait "$RUN1" 2>/dev/null || true
lock_free || fail "lock still held after SIGKILL of emu-run (holders: $(holders | tr '\n' ' '))"
pass "lock released after SIGKILL"
[[ -z "$others" ]] || fail "children inherited the lock FD: $others"
pass "only emu-run held the lock"
# The user command must die with emu-run: it would otherwise act on the next reservation's emulator.
INNER="$(cat "$TMP/inner.pid")"
for _ in $(seq 1 20); do kill -0 "$INNER" 2>/dev/null || break; sleep 0.25; done
kill -0 "$INNER" 2>/dev/null && fail "user command $INNER survived the SIGKILL of emu-run"
pass "user command died with emu-run"
echo "fuser after kill:"; show_holders
[[ "$(qemu_pid)" == "$QPID" ]] || fail "orphan QEMU should still be around for the cleanup check"
pass "orphan QEMU $QPID survived (as in the incident)"

# 4. The next reservation of the instance cleans the orphan and goes on.
"$TOOLS/emu-run" --instance "$N" --timeout 5 -- bash -c 'echo ran-inside-$EMU_INSTANCE' > "$TMP/run2.log" 2>&1 \
    || { cat "$TMP/run2.log" >&2; fail "second reservation failed"; }
grep -q "QEMU órfão (pid $QPID)" "$TMP/run2.log" || { cat "$TMP/run2.log" >&2; fail "orphan not reported/cleaned"; }
grep -q "ran-inside-$N" "$TMP/run2.log" || fail "command of the second reservation did not run"
kill -0 "$QPID" 2>/dev/null && fail "orphan QEMU $QPID still alive"
[[ -z "$(qemu_pid)" ]] || fail "QEMU left running after the second emu-run"
lock_free || fail "lock still held after the second emu-run"
pass "second reservation cleaned the orphan, ran, and shut down"
echo "ALL OK"
