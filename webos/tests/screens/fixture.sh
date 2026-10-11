# Starts the fixture addon (fixture/server.mjs) for emulator.sh and desktop.sh (F2.7), sourced by them:
#   start_fixture <host> <log file>   host: how the client reaches this machine (10.0.2.2 in the emulator)
# Sets FIXTURE_URL (the manifest url, read by run) and FIXTURE_PID. FIXTURE=0 skips it (live Cinemeta).
start_fixture() {
    [[ "${FIXTURE:-1}" == 0 ]] && return 0
    local info
    info="$(mktemp)"
    node "$(dirname "${BASH_SOURCE[0]}")/fixture/server.mjs" --host "$1" --info "$info" > "$2" 2>&1 &
    FIXTURE_PID=$!
    local _
    for _ in $(seq 1 50); do
        [[ -s "$info" ]] && break
        sleep 0.1
    done
    FIXTURE_URL="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$info', 'utf8')).manifestUrl)")"
    rm -f "$info"
    export FIXTURE_URL
}
