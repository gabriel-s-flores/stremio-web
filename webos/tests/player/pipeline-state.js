#!/usr/bin/env node
// State of the emulator's media pipelines (F5.6), read over SSH: one entry per
// starfish-media-pipeline process, with its threads sampled twice one second apart, and `wedged`
// when the emulator's known failure shows up. Inside a pool reservation (EMU_SSH_PORT):
//   node webos/tests/player/pipeline-state.js            -> JSON on stdout
//   node webos/tests/player/pipeline-state.js --wait 20  -> waits up to 20 s for a wedged pipeline
// Exit code: 0 healthy (or no pipeline), 3 wedged, 2 could not read the emulator.
//
// The failure (webos/lib/player/README.md, "Trocas de stream"): the emulator's pipeline starts,
// makes its one GET and never reaches loadedmetadata (readyState 0). Its video streaming thread
// (`vqueue:src`) is busy-looping in the kernel: state R, system time growing by most of the wall
// clock and almost no voluntary context switches, while the audio thread never gets data. A
// pipeline that plays spends its `vqueue:src` time in user mode (software decoding) instead.
// Once it happens, every later pipeline of the boot does the same, across page reloads and app
// relaunches: the state lives in the system, not in the app.

const { execFileSync } = require('child_process');
const os = require('os');
const path = require('path');

// /proc/<pid>/stat counts in clock ticks (USER_HZ = 100 on the emulator's kernel).
const TICKS_PER_SECOND = 100;
// Share of the sampling interval spent in kernel mode by `vqueue:src` that marks the busy loop.
// Seen: 0.75 to 0.80 when wedged; 0 to 0.02 while playing.
const WEDGED_SYSTEM_SHARE = 0.4;
const VIDEO_THREAD = 'vqueue:src';

// Prints, for every pipeline process: "P <pid> <rssKb>" and one "T <pid> <state> <utime> <stime> <vcs> <comm>"
// per thread; twice, one second apart, separated by "S".
const REMOTE_SCRIPT = [
    'snap() {',
    '  for p in $(pgrep starfish-media); do',
    '    echo "P $p $(grep VmRSS /proc/$p/status 2>/dev/null | tr -s " " | cut -d" " -f2)"',
    '    for t in /proc/$p/task/*; do',
    '      [ -r "$t/stat" ] || continue',
    '      set -- $(sed "s/.*) //" "$t/stat")',
    '      echo "T $p $1 ${12} ${13} $(grep ^voluntary_ctxt "$t/status" | cut -f2) $(cat "$t/comm")"',
    '    done',
    '  done',
    '}',
    'snap; echo S; sleep 1; snap',
].join('\n');

const parseSnapshot = (text) => {
    const processes = {};
    text.split('\n').forEach((line) => {
        const parts = line.trim().split(/\s+/);
        if (parts[0] === 'P' && parts.length >= 2) {
            processes[parts[1]] = { pid: Number(parts[1]), rssKb: parts[2] ? Number(parts[2]) : null, threads: [] };
        } else if (parts[0] === 'T' && parts.length >= 7 && processes[parts[1]]) {
            processes[parts[1]].threads.push({
                name: parts.slice(6).join(' '),
                state: parts[2],
                utime: Number(parts[3]),
                stime: Number(parts[4]),
                voluntarySwitches: Number(parts[5]),
            });
        }
    });
    return processes;
};

// before/after: parseSnapshot results taken `seconds` apart.
const classify = (before, after, seconds) => {
    const interval = (seconds || 1) * TICKS_PER_SECOND;
    const pipelines = Object.keys(after).map((pid) => {
        const now = after[pid];
        const then = before[pid] || null;
        const video = now.threads.filter((thread) => thread.name === VIDEO_THREAD)[0] || null;
        const videoBefore = then ? then.threads.filter((thread) => thread.name === VIDEO_THREAD)[0] || null : null;
        let videoThread = null;
        let wedged = false;
        if (video && videoBefore) {
            const systemShare = (video.stime - videoBefore.stime) / interval;
            const userShare = (video.utime - videoBefore.utime) / interval;
            const switches = video.voluntarySwitches - videoBefore.voluntarySwitches;
            videoThread = {
                state: video.state,
                systemShare: Math.round(systemShare * 100) / 100,
                userShare: Math.round(userShare * 100) / 100,
                voluntarySwitches: switches,
            };
            wedged = systemShare >= WEDGED_SYSTEM_SHARE && systemShare > userShare;
        }
        return { pid: now.pid, rssKb: now.rssKb, threads: now.threads.length, videoThread, wedged };
    });
    return { wedged: pipelines.some((pipeline) => pipeline.wedged), pipelines };
};

const sshArgs = () => {
    const port = process.env.EMU_SSH_PORT;
    if (!port) throw new Error('EMU_SSH_PORT is not set (run inside webos/tools/emu-run)');
    const key = process.env.EMU_SSH_KEY || path.join(os.homedir(), 'webos-tv-sdk', 'run', 'ares_webos_emul');
    return ['-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'LogLevel=ERROR',
        '-o', 'HostKeyAlgorithms=+ssh-rsa', '-o', 'PubkeyAcceptedAlgorithms=+ssh-rsa', '-o', 'ConnectTimeout=10',
        '-i', key, '-p', String(port), 'developer@127.0.0.1', REMOTE_SCRIPT];
};

const read = () => {
    const output = execFileSync('ssh', sshArgs(), { encoding: 'utf8', timeout: 30000 });
    const halves = output.split(/^S$/m);
    return Object.assign({ t: Date.now() }, classify(parseSnapshot(halves[0] || ''), parseSnapshot(halves[1] || ''), 1));
};

if (require.main === module) {
    const waitIndex = process.argv.indexOf('--wait');
    const waitSeconds = waitIndex !== -1 ? Number(process.argv[waitIndex + 1]) : 0;
    const deadline = Date.now() + waitSeconds * 1000;
    let state;
    try {
        do {
            state = read();
        } while (!state.wedged && Date.now() < deadline);
    } catch (error) {
        console.error('pipeline-state: ' + error.message);
        process.exit(2);
    }
    console.log(JSON.stringify(state));
    process.exit(state.wedged ? 3 : 0);
}

module.exports = { parseSnapshot, classify, WEDGED_SYSTEM_SHARE, VIDEO_THREAD };
