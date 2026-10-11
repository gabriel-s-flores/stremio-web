#!/usr/bin/env node
// F7.3 debt: the diagnostics screen (R-G-Y-B, F3.6) opened from inside the Player while a video plays.
// It used to leave the page unresponsive in 3 of 5 runs. One run = one emulator boot (one media
// scenario per boot). Run inside a pool reservation, after `pnpm webos:package`:
//   webos/tools/emu-run --timeout 15 -- node webos/tests/diagnostics/player-emulator.mjs <out-dir> [wait-s]
// Plays the 1080p H264 + AAC stream (300 s) of the e2e set of the local test addon (webos/tests/addon,
// media from webos/tests/e2e/make-media.sh), presses RED GREEN YELLOW
// BLUE with the remote, then probes the page over CDP for <wait-s> seconds (default 40): every probe
// has a deadline, a probe that misses it counts as "page not responding". Also records the guest's
// renderer/starfish processes and the kernel log (OOM). Writes <out-dir>/result.json; exit 1 if the
// page stopped answering, the diagnostics screen did not appear, or the renderer was replaced.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const OUT = path.resolve(process.argv[2] || 'diagnostics-player-out');
const WAIT_S = Number(process.argv[3] || 40);
// STREAM: part of the stream's text (default the 1080p H264 + AAC); PLAY_S: seconds the video has
// played when the shortcut is pressed (default 4, 0 = as soon as the Player route is up);
// BACK_OUT=1: Back from the diagnostics, then Back from the Player, probing after each.
const STREAM = process.env.STREAM || 'H264.AAC';
const PLAY_S = Number(process.env.PLAY_S || 4);
const BACK_OUT = process.env.BACK_OUT === '1';
const { EMU_CDP_PORT, EMU_REMOTE_PORT, EMU_DEVICE, EMU_SSH_PORT } = process.env;
const APP_ID = 'io.github.gabrielsflores.stremio';
if (!EMU_CDP_PORT || !EMU_REMOTE_PORT || !EMU_DEVICE) {
    console.error('run inside webos/tools/emu-run');
    process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (line) => {
    const text = `[${new Date().toISOString().slice(11, 23)}] ${line}`;
    console.log(text);
    fs.appendFileSync(path.join(OUT, 'run.log'), `${text}\n`);
};
const sh = (command, args, options = {}) => spawnSync(command, args, { encoding: 'utf8', cwd: ROOT, ...options });
const cdp = (timeoutMs, ...args) => {
    const result = sh('node', ['webos/tools/cdp.mjs', '--port', EMU_CDP_PORT, '--target', APP_ID, '--timeout', String(timeoutMs), ...args], { timeout: timeoutMs + 3000 });
    return { ok: result.status === 0, out: (result.stdout || '').trim(), err: (result.stderr || '').trim() };
};
const evaluate = (expression, timeoutMs = 8000) => {
    const result = cdp(timeoutMs, 'eval', `JSON.stringify((function(){ ${expression} })())`);
    if (!result.ok) return undefined;
    try {
        return JSON.parse(result.out.split('\n').pop());
    } catch {
        return undefined;
    }
};
const waitFor = async (expression, timeoutS, intervalMs = 1000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutS * 1000) {
        if (evaluate(expression) === true) return Date.now() - started;
        await sleep(intervalMs);
    }
    return null;
};
const remote = (...keys) => sh('node', ['webos/tools/remote.mjs', '--port', EMU_REMOTE_PORT, '--delay', '0', ...keys]);
const ares = (command) => sh('webos/scripts/ares.sh', [command], { env: { ...process.env, WEBOS_DEVICE: EMU_DEVICE } });

const SSH = ['-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'LogLevel=ERROR', '-o', 'HostKeyAlgorithms=+ssh-rsa',
    '-o', 'PubkeyAcceptedAlgorithms=+ssh-rsa', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-i', path.join(process.env.HOME, 'webos-tv-sdk/run/ares_webos_emul'),
    '-p', String(EMU_SSH_PORT), 'developer@127.0.0.1'];
const ssh = (command) => (sh('ssh', [...SSH, command], { timeout: 20000 }).stdout || '').trim();
// The processes that matter: the app's renderer (its WebAppMgr child) and the media pipelines.
const processes = () => ssh('ps -eo pid,rss,args | grep -E "WebAppMgr|starfish-media|com.webos.service.mediaindexer" | grep -v grep | cut -c1-110');

const results = [];
const check = (name, ok, detail) => {
    results.push({ name, ok, detail });
    log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
};

const finish = (extra = {}) => {
    const failed = results.filter((result) => !result.ok);
    fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ date: new Date().toISOString(), failed: failed.map((result) => result.name), results, ...extra }, null, 2));
    log(`${results.length - failed.length}/${results.length} passed`);
    return failed.length === 0 ? 0 : 1;
};

const info = path.join(OUT, 'addon.json');
fs.rmSync(info, { force: true });
const server = spawn('node', ['webos/tests/addon/server.mjs', '--set', 'e2e', '--host', '10.0.2.2', '--info', info], { cwd: ROOT, stdio: ['ignore', fs.openSync(path.join(OUT, 'addon-server.log'), 'w'), 'inherit'] });

let code = 1;
try {
    let manifestUrl = null;
    for (let i = 0; i < 100 && manifestUrl === null; i++) {
        try {
            manifestUrl = JSON.parse(fs.readFileSync(info, 'utf8')).manifestUrl.replace('127.0.0.1', '10.0.2.2');
        } catch {
            await sleep(200);
        }
    }
    check('addon server up', manifestUrl !== null, manifestUrl);
    if (manifestUrl === null) throw new Error('no addon');

    ares('install');
    ares('launch');
    const boardMs = await waitFor('return document.querySelectorAll(\'a[href^="#/metadetails"], a[href^="#/detail/"]\').length > 0 && !!window.core;', 240);
    check('Board loaded', boardMs !== null, boardMs);
    if (boardMs === null) throw new Error('no board');
    // The Welcome app of a clean boot may come to the front: keys go to the foreground app only.
    const running = (sh('ares-launch', ['--device', EMU_DEVICE, '--running']).stdout || '').split('\n').map((line) => line.trim()).filter((line) => /^[a-z0-9]+(\.[a-z0-9-]+)+$/i.test(line));
    running.filter((id) => id !== APP_ID).forEach((id) => sh('ares-launch', ['--device', EMU_DEVICE, '--close', id]));
    ares('launch');
    await waitFor('return document.hasFocus();', 20);
    await sleep(3000);

    const url = JSON.stringify(manifestUrl);
    evaluate(`fetch(${url}).then(function(r){return r.json();}).then(function(m){ window.core.dispatch({ action: 'Ctx', args: { action: 'InstallAddon', args: { transportUrl: ${url}, manifest: m, flags: { official: false, protected: false } } } }); window.__diagAddon = m.id; }); return true;`);
    await sleep(3000);
    // Detail page of a movie (the addon answers any tt id), then the H264 + AAC stream.
    evaluate('location.hash = "#/detail/movie/tt0111161/tt0111161"; return true;');
    const stream = 'Array.prototype.filter.call(document.querySelectorAll(\'.route-container:last-child a[href^="#/player"]\'), function (a) { return a.textContent.indexOf(' + JSON.stringify(STREAM) + ') !== -1; })[0]';
    const streamMs = await waitFor(`return !!(${stream});`, 90, 1000);
    check('stream listed', streamMs !== null, streamMs);
    if (streamMs === null) throw new Error('no stream');
    evaluate(`var a = ${stream}; a.focus(); a.click(); return true;`);
    const playingMs = PLAY_S > 0 ?
        await waitFor(`var v = document.querySelector("video"); return !!v && v.readyState >= 3 && v.currentTime > ${PLAY_S};`, 90, 1000) :
        await waitFor('return location.hash.indexOf("#/player") === 0;', 30, 200);
    check(PLAY_S > 0 ? 'video playing' : 'Player route up', playingMs !== null, playingMs);
    if (playingMs === null) throw new Error('not playing');
    fs.writeFileSync(path.join(OUT, 'ps-before.txt'), processes());
    evaluate('window.__diagBefore = { t: document.querySelector("video").currentTime, hash: location.hash }; return window.__diagBefore;');

    const openedAt = Date.now();
    remote('RED', 'GREEN', 'YELLOW', 'BLUE');
    log('R-G-Y-B sent');
    const probes = [];
    let lastGood = null;
    let hangs = 0;
    while (Date.now() - openedAt < WAIT_S * 1000) {
        const started = Date.now();
        const state = evaluate('var v = document.querySelector("video"); return { hash: location.hash, video: v ? [v.currentTime, v.readyState, v.paused] : null, diag: !!(window.__webos && window.__webos.diagnostics), cards: document.querySelectorAll("[data-card]").length };', 6000);
        const entry = { at: started - openedAt, ms: Date.now() - started, state: state === undefined ? 'NO ANSWER' : state };
        probes.push(entry);
        if (state === undefined) hangs++;
        else lastGood = entry;
        await sleep(1000);
    }
    if (BACK_OUT) {
        for (const [name, expected] of [['diagnostics', '#/player/'], ['player', '#/detail/']]) {
            remote('BACK');
            await sleep(3000);
            const state = evaluate('return { hash: location.hash.slice(0, 20), focus: document.hasFocus() };', 8000);
            check(`Back from ${name} answers and leaves it`, !!state && state.hash.indexOf(expected) === 0, state === undefined ? 'NO ANSWER' : state);
        }
    }
    fs.writeFileSync(path.join(OUT, 'probes.json'), JSON.stringify(probes, null, 1));
    check('page answered every probe', hangs === 0, `${hangs} of ${probes.length} probes without an answer`);
    check('diagnostics screen shown', !!lastGood && /#\/webos-diagnostics/.test(lastGood.state.hash), lastGood && lastGood.state.hash);
    check('report collected', !!lastGood && lastGood.state.diag === true && lastGood.state.cards > 0, lastGood && lastGood.state);
    const after = processes();
    fs.writeFileSync(path.join(OUT, 'ps-after.txt'), after);
    fs.writeFileSync(path.join(OUT, 'dmesg.txt'), ssh('dmesg | tail -60'));
    const pidsOf = (text) => text.split('\n').filter((line) => /WebAppMgr/.test(line)).map((line) => line.trim().split(/\s+/)[0]).sort().join(',');
    const before = fs.readFileSync(path.join(OUT, 'ps-before.txt'), 'utf8');
    check('renderer processes unchanged', pidsOf(before) === pidsOf(after), { before: pidsOf(before), after: pidsOf(after) });
    check('no OOM in dmesg', !/Out of memory|oom-kill|Killed process/i.test(fs.readFileSync(path.join(OUT, 'dmesg.txt'), 'utf8')));
    cdp(15000, 'screenshot', path.join(OUT, 'after.png'));
    code = finish({ waitS: WAIT_S });
} catch (error) {
    check('no exception', false, String((error && error.message) || error));
    // What the guest says about a page that never got there (a killed renderer shows up here).
    fs.writeFileSync(path.join(OUT, 'ps-failure.txt'), processes());
    fs.writeFileSync(path.join(OUT, 'dmesg-failure.txt'), ssh('dmesg | tail -60'));
    check('no OOM in dmesg', !/Out of memory|oom-kill|Killed process/i.test(fs.readFileSync(path.join(OUT, 'dmesg-failure.txt'), 'utf8')));
    check('page still answers', evaluate('return location.hash.slice(0, 30);', 6000) !== undefined);
    code = finish();
} finally {
    server.kill();
}
process.exit(code);
