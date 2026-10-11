#!/usr/bin/env node
// F5.7 in the emulator: the remote in the Player (webos/lib/player-remote). One media scenario per
// boot (webos/docs/PESQUISA.md §7), inside a pool reservation, after `pnpm webos:package`:
//
//   webos/tools/emu-run --timeout 20 -- node webos/tests/player-remote/emulator/run.mjs <dir under $HOME> <scenario>
//
// Scenarios:
//   keys          OK, arrows, FF/RW (pressed and held), PLAY/PAUSE, bar navigation, Magic Remote drag on
//                 the seek bar, Back that hides the bar and Back that leaves the Player
//   next          next video popup reached and walked with the arrows, Back dismisses it, the bar's next
//                 button opens episode 2, STOP leaves the Player
//   watch         OK on "watch now" of the popup opens episode 2
//   menu          the audio menu opened from the bar with the remote, Back closes it (F4.3 focus)
//   context-menu  the YELLOW context menu (F4.3) over the video: its arrows change neither the volume
//                 nor the time of the video behind it; Back closes it; paused, Back leaves
//   resume        plays episode 1 up to 200 s, leaves the Player and opens it again: it starts there
//   resume-save   plays episode 1 up to 200 s and leaves the Player (the core keeps the position)
//   resume-check  run with `emu-run --keep-state --instance <same>` after resume-save: the episode opens
//                 where it stopped (SKIP_INSTALL=1 keeps the installed app and its storage)
//
// Media: $F57_MEDIA (default ~/webos-tv-sdk/run/f57-media) with ep1_10min.mp4 (600 s, keyframe every
// 1 s) and ep2_90s.mp4; the test add-on (../addon.mjs) serves a series with those two episodes.
// Real remote keys go through remote.mjs; a held key (no way with remote.mjs) is sent as trusted CDP
// key events with autoRepeat. Output: <dir>/<scenario>.json, screenshots (page and VM).

import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] || 'player-remote-emulator');
const SCENARIO = process.argv[3] || 'keys';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', '..');
const APP_ID = 'io.github.gabrielsflores.stremio';
const DEVICE = process.env.EMU_DEVICE;
const CDP_PORT = process.env.EMU_CDP_PORT;
const REMOTE_PORT = process.env.EMU_REMOTE_PORT;
const MEDIA_DIR = process.env.F57_MEDIA || path.join(process.env.HOME, 'webos-tv-sdk', 'run', 'f57-media');
if (!DEVICE || !CDP_PORT || !REMOTE_PORT) {
    console.error('run inside webos/tools/emu-run');
    process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', cwd: REPO, ...options });
const remote = (...keys) => run('node', ['webos/tools/remote.mjs', '--port', REMOTE_PORT, '--delay', '0', ...keys]);

// Guest shell (system log and memory of the emulator).
const SSH = ['-q', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'HostKeyAlgorithms=+ssh-rsa',
    '-o', 'PubkeyAcceptedAlgorithms=+ssh-rsa', '-o', 'BatchMode=yes', '-i', path.join(process.env.HOME, 'webos-tv-sdk', 'run', 'ares_webos_emul'),
    '-p', String(process.env.EMU_SSH_PORT), 'developer@127.0.0.1'];
const guest = (command) => {
    try {
        return run('ssh', [...SSH, command], { timeout: 20000 });
    } catch (error) {
        // A grep that finds nothing ends with 1: its output is still the answer.
        return error.stdout ? String(error.stdout) : `ssh failed: ${error.message.slice(0, 300)}`;
    }
};
const GUEST_MEMORY = 'grep MemAvailable /proc/meminfo; for s in /proc/[0-9]*/status; do n=$(sed -n "s/^Name:\\t//p" $s 2>/dev/null); case "$n" in WebAppMgr*|*render*|*starfish*) echo "$n $(sed -n "s/^VmRSS:\\t*//p" $s)";; esac; done';
const SYSTEM_LOG = 'dmesg 2>/dev/null | grep -i -E "oom|kill|segfault|out of memory" | tail -n 30; for f in /var/log/messages /tmp/var/log/messages; do [ -f $f ] && grep -i -E "oom|kill|crash|renderer|WebAppMgr.*(reload|exit|died)|sigsegv" $f | tail -n 40; done';

// ----- CDP session -----
let session = null;
const connect = async () => {
    const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
    const target = targets.find((entry) => (entry.url + entry.title).indexOf(APP_ID) !== -1 && entry.webSocketDebuggerUrl);
    if (!target) throw new Error('app target not found');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        socket.onopen = resolve;
        socket.onerror = () => reject(new Error('CDP connection failed'));
    });
    let id = 0;
    const pending = new Map();
    socket.addEventListener('message', (message) => {
        const data = JSON.parse(message.data);
        if (data.id && pending.has(data.id)) {
            pending.get(data.id)(data);
            pending.delete(data.id);
        }
    });
    socket.addEventListener('close', () => {
        session = null;
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const mine = ++id;
        const timer = setTimeout(() => {
            pending.delete(mine);
            reject(new Error(`CDP ${method} timed out`));
        }, 30000);
        pending.set(mine, (data) => {
            clearTimeout(timer);
            if (data.error) reject(new Error(`${method}: ${data.error.message}`));
            else resolve(data.result);
        });
        socket.send(JSON.stringify({ id: mine, method, params }));
    });
    session = { send, close: () => socket.close() };
    return session;
};
const cdp = async (method, params) => (session || await connect()).send(method, params);
const evaluateRaw = async (expression) => {
    const result = await cdp('Runtime.evaluate', { expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`page: ${JSON.stringify(result.exceptionDetails).slice(0, 300)}`);
    return result.result ? result.result.value : undefined;
};
// `body` is a function body (ES2015, Chromium 53); a returned Promise is awaited by polling: the
// inspector of Chromium 53 has no `awaitPromise` in Runtime.evaluate.
let asyncId = 0;
const evaluate = async (body) => {
    const id = ++asyncId;
    const started = await evaluateRaw(`(function(){
        var value = (function(){ ${body} })();
        if (!value || typeof value.then !== 'function') return { done: true, value: value };
        window.__f57async = window.__f57async || {};
        window.__f57async[${id}] = { done: false };
        value.then(function (v) { window.__f57async[${id}] = { done: true, value: v }; },
            function (e) { window.__f57async[${id}] = { done: true, error: String(e && (e.stack || e)) }; });
        return { done: false };
    })()`);
    if (started.done) return started.value;
    for (let i = 0; i < 300; i++) {
        await sleep(100);
        const entry = await evaluateRaw(`(function(){ var e = window.__f57async[${id}]; if (e.done) delete window.__f57async[${id}]; return e; })()`);
        if (entry.done) {
            if (entry.error) throw new Error(`page promise: ${entry.error}`);
            return entry.value;
        }
    }
    throw new Error('page promise timed out');
};
const key = (keyCode, type, autoRepeat = false) => cdp('Input.dispatchKeyEvent', {
    type,
    windowsVirtualKeyCode: keyCode,
    nativeVirtualKeyCode: keyCode,
    autoRepeat,
});
const mouse = (event) => cdp('Input.dispatchMouseEvent', { button: 'none', ...event });

const screenshot = async (name) => {
    try {
        const { data } = await cdp('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
        return `${name}.png`;
    } catch (error) {
        return `failed: ${error.message}`;
    }
};
// The VM screen: shows the video plane too (the page capture has the video area empty).
const vmScreenshot = (name) => {
    const file = path.join(OUT, `${name}-vm.png`);
    try {
        run('python3', ['webos/tools/qmp.py', 'screendump', file]);
        return fs.existsSync(file) ? path.basename(file) : 'failed';
    } catch (error) {
        return `failed: ${error.message.split('\n')[0]}`;
    }
};

const BOOT_SETTLE_UPTIME_S = Number(process.env.BOOT_SETTLE_UPTIME_S || 100);
const steps = [];
const record = (name, data) => {
    steps.push({ name, time: new Date().toISOString(), ...data });
    const mark = data.ok === undefined ? '-' : data.ok ? 'ok' : 'FALHOU';
    console.log(`[${mark}] ${name}${data.note ? ` (${data.note})` : ''}`);
};
const save = (extra = {}) => {
    const failed = steps.filter((step) => step.ok === false).map((step) => step.name);
    fs.writeFileSync(path.join(OUT, `${SCENARIO}.json`), JSON.stringify({ scenario: SCENARIO, failed, steps, ...extra }, null, 2));
    return failed;
};

const waitFor = async (body, timeoutMs, intervalMs = 500) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            if (await evaluate(body) === true) return Date.now() - started;
        } catch {
            // the page may be reloading
        }
        await sleep(intervalMs);
    }
    return null;
};

const freePort = () => new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        server.close(() => resolve(port));
    });
});

const children = [];
process.on('exit', () => children.forEach((child) => child.kill()));
const startServers = async () => {
    const mediaPort = await freePort();
    const media = spawn('node', ['webos/tools/media-server.mjs', MEDIA_DIR, String(mediaPort)], { cwd: REPO, stdio: ['ignore', fs.openSync(path.join(OUT, `${SCENARIO}-media.log`), 'w'), 'inherit'] });
    children.push(media);
    const addonPort = await freePort();
    const addon = spawn('node', ['webos/tests/player-remote/addon.mjs', '--media', `http://10.0.2.2:${mediaPort}`, '--port', String(addonPort)], { cwd: REPO, stdio: ['ignore', fs.openSync(path.join(OUT, `${SCENARIO}-addon.log`), 'w'), 'inherit'] });
    children.push(addon);
    for (let i = 0; i < 50; i++) {
        try {
            const ok = (await fetch(`http://127.0.0.1:${addonPort}/manifest.json`)).ok && (await fetch(`http://127.0.0.1:${mediaPort}/ep1_10min.mp4`, { method: 'HEAD' })).ok;
            if (ok) break;
        } catch {
            // not up yet
        }
        await sleep(200);
    }
    return { addonPort, manifestUrl: `http://10.0.2.2:${addonPort}/manifest.json` };
};

// ----- app -----
const PAGE_HELPERS = `
    if (!window.__f57) {
        window.__f57 = { errors: [] };
        window.addEventListener('error', function (event) { window.__f57.errors.push(String(event.message) + ' ' + event.filename + ':' + event.lineno); });
        // Who sets the time and the source of the <video> elements (next episode diagnosis).
        window.__f57.media = [];
        var describeVideo = function (video) { return String(video.getAttribute('src') || '').split('/').pop() + '#' + (video.__f57id || (video.__f57id = Math.random().toString(36).slice(2, 6))); };
        var timeProperty = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
        Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
            configurable: true,
            get: timeProperty.get,
            set: function (value) {
                window.__f57.media.push({ time: Date.now(), what: 'currentTime', value: value, video: describeVideo(this), readyState: this.readyState, duration: this.duration });
                return timeProperty.set.call(this, value);
            },
        });
        var srcProperty = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
        Object.defineProperty(HTMLMediaElement.prototype, 'src', {
            configurable: true,
            get: srcProperty.get,
            set: function (value) {
                window.__f57.media.push({ time: Date.now(), what: 'src', value: String(value).split('/').pop(), video: describeVideo(this) });
                return srcProperty.set.call(this, value);
            },
        });
        // Every key event that reaches the page (capture on window, before the Player remote).
        window.__f57.keys = [];
        ['keydown', 'keyup'].forEach(function (type) {
            window.addEventListener(type, function (event) {
                if (event.keyCode === 1536 || event.keyCode === 1537) return;
                window.__f57.keys.push({ type: type, keyCode: event.keyCode, repeat: event.repeat, trusted: event.isTrusted, at: Date.now() });
                if (window.__f57.keys.length > 200) window.__f57.keys.shift();
            }, true);
        });
        // Player actions sent to the core, with the route and how many Players are mounted.
        window.__f57.core = [];
        if (window.core && !window.core.__f57) {
            var dispatchCore = window.core.dispatch;
            window.core.dispatch = function (action, field) {
                if (action && action.action === 'Player' && action.args) {
                    window.__f57.core.push({
                        time: Date.now(),
                        action: action.args.action,
                        args: action.args.args && typeof action.args.args.time === 'number' ? action.args.args.time : (action.args.action === 'Load' ? JSON.stringify(action.args.args).slice(-60) : null),
                        hash: location.hash.slice(-14),
                        players: document.querySelectorAll('[class*="player-container"]').length,
                        stack: String(new Error().stack).split('\\n').slice(2, 6).join(' | ').slice(0, 300),
                    });
                }
                return dispatchCore.apply(this, arguments);
            };
            window.core.__f57 = true;
        }
        // The pipeline guard's log (F5.6): releases, dropped load() calls, watchdog.
        window.__f57.guard = [];
        var originalInfo = console.info;
        console.info = function () {
            var text = Array.prototype.map.call(arguments, String).join(' ');
            if (text.indexOf('[webos] player:') !== -1) window.__f57.guard.push({ time: Date.now(), text: text.slice(0, 300) });
            return originalInfo.apply(console, arguments);
        };
        var original = console.error;
        console.error = function () {
            window.__f57.errors.push(Array.prototype.map.call(arguments, String).join(' ').slice(0, 300));
            return original.apply(console, arguments);
        };
    }
    var sel = function (prefix) { return '[class^="' + prefix + '-"], [class*=" ' + prefix + '-"]'; };
    var describe = function (element) {
        if (!element) return null;
        if (element === document.body) return 'body';
        var title = element.getAttribute && element.getAttribute('title');
        return element.tagName.toLowerCase() + '.' + String(element.className).trim().split(/\\s+/).slice(0, 2).join('.') + (title ? ' [' + title + ']' : '');
    };
    // The last <video>: during a switch the previous one may still be in the page (F5.6).
    window.__f57.video = function () {
        var videos = document.querySelectorAll('video');
        return videos.length ? videos[videos.length - 1] : null;
    };
    window.__f57.state = function () {
        var video = window.__f57.video();
        var container = document.querySelector(sel('player-container'));
        var bar = container && container.querySelector(sel('control-bar-container'));
        var seek = bar && bar.querySelector(sel('seek-bar-container'));
        var popup = container && container.querySelector(sel('next-video-popup-container'));
        var remote = window.__webosPlayerRemote;
        return {
            hash: location.hash,
            t: video ? Math.round(video.currentTime * 10) / 10 : null,
            d: video ? Math.round(video.duration * 10) / 10 : null,
            paused: video ? video.paused : null,
            readyState: video ? video.readyState : null,
            src: video ? String(video.currentSrc || video.src).split('/').pop() : null,
            videos: document.querySelectorAll('video').length,
            rate: video ? video.playbackRate : null,
            hidden: container ? /(^|\\s)overlayHidden-/.test(container.className) : null,
            focused: describe(document.activeElement),
            focusRing: !!(document.activeElement && document.activeElement.hasAttribute('data-focus-visible-added')),
            seekFocused: !!(seek && seek === document.activeElement),
            seekLabel: seek ? Array.prototype.map.call(seek.querySelectorAll(sel('label')), function (l) { return l.textContent; }).join(' / ') : null,
            popup: !!popup,
            remote: remote ? { action: remote.status.action, zone: remote.status.zone, result: remote.status.result, count: remote.status.count, key: remote.status.key } : null,
            lastBack: window.__webosBack && window.__webosBack.history.length ? window.__webosBack.history[window.__webosBack.history.length - 1] : null,
            errors: window.__f57.errors.length,
            guard: window.__f57.guard.length,
        };
    };
    return true;
`;
// A page that reloads by itself (the WebAppMgr reloads a crashed renderer) loses the helpers: the
// reload is recorded with the guest memory and log, and the helpers go in again.
const reloads = [];
const state = async () => {
    const now = await evaluate('return window.__f57 ? window.__f57.state() : { reloaded: true, hash: location.hash, navigationStart: performance.timing.navigationStart, uptime: Math.round(performance.now()) };');
    if (!now || !now.reloaded) return now;
    const entry = { at: new Date().toISOString(), ...now, guest: guest(GUEST_MEMORY), log: guest(SYSTEM_LOG) };
    reloads.push(entry);
    record('page-reloaded', { ok: false, note: `the page reloaded by itself (navigationStart ${now.navigationStart}, ${now.uptime} ms ago, hash ${now.hash})`, ...entry });
    await evaluate(PAGE_HELPERS);
    return evaluate('return window.__f57.state();');
};

const boot = async () => {
    const env = { ...process.env, WEBOS_DEVICE: DEVICE };
    if (process.env.SKIP_INSTALL !== '1') run('webos/scripts/ares.sh', ['install'], { env });
    run('webos/scripts/ares.sh', ['launch'], { env });
    const ready = await waitFor('return !!window.__webosBack && !!window.core && document.querySelectorAll(\'a[href^="#/detail/"]\').length > 0;', 240000, 2000);
    record('boot', { ok: ready !== null, note: `Board in ${ready} ms` });
    // The Welcome app may take the foreground: remote keys only reach the foreground app.
    let output = '';
    try {
        output = run('ares-launch', ['--device', DEVICE, '--running']);
    } catch (error) {
        output = String(error.stdout || '');
    }
    output.split('\n').map((line) => line.trim()).filter((id) => /^[a-z0-9]+(\.[a-z0-9-]+)+$/i.test(id) && id !== APP_ID).forEach((id) => {
        try {
            run('ares-launch', ['--device', DEVICE, '--close', id]);
        } catch {
            // system apps may refuse
        }
    });
    run('webos/scripts/ares.sh', ['launch'], { env });
    await waitFor('return document.hasFocus();', 15000);
    await evaluate(PAGE_HELPERS);
    // The memory peak of the boot is when the OOM killer of the 1 GB VM takes the page (F5.6, player
    // README): the media starts after it.
    let uptime = 0;
    for (let i = 0; i < 40; i++) {
        uptime = parseFloat(guest('cut -d" " -f1 /proc/uptime')) || 0;
        if (uptime >= BOOT_SETTLE_UPTIME_S) break;
        await sleep(3000);
    }
    record('boot-settled', { note: `guest uptime ${uptime} s; ${guest(GUEST_MEMORY).replace(/\n/g, ' | ')}` });
    await state();
};

// Opens episode N of the test series in the Player, as the streams list would (navigate PUSH with a
// history entry, so Back has the Board under it).
const openEpisode = async (manifestUrl, addonPort, episode) => {
    const { streams } = await (await fetch(`http://127.0.0.1:${addonPort}/stream/series/tt9100001:1:${episode}.json`)).json();
    const encoded = await evaluate(`return Promise.resolve(window.core.encodeStream(${JSON.stringify(streams[0])}));`);
    const transport = encodeURIComponent(manifestUrl);
    const hash = `#/player/${encodeURIComponent(encoded)}/${transport}/${transport}/series/tt9100001/${encodeURIComponent(`tt9100001:1:${episode}`)}`;
    await evaluate(`
        var idx = window.history.state && typeof window.history.state.idx === 'number' ? window.history.state.idx + 1 : 1;
        var entry = { usr: null, key: 'f57p' + idx, idx: idx };
        window.history.pushState(entry, '', ${JSON.stringify(hash)});
        window.dispatchEvent(new PopStateEvent('popstate', { state: entry }));
        return idx;
    `);
    return hash;
};

// `file`: the <video> playing must be that one (episode 2 after a switch).
const waitPlaying = async (label, timeoutMs = 120000, file = null) => {
    const elapsed = await waitFor(`var vs = document.querySelectorAll('video'); var v = vs[vs.length - 1];
        return !!v && v.readyState >= 3 && v.currentTime > 0.5 && !v.paused${file ? ` && String(v.currentSrc || v.src).indexOf(${JSON.stringify(file)}) !== -1` : ''};`, timeoutMs, 1000);
    const now = await state();
    // The next episode plays from its start (not from the position of the previous one).
    const fromStart = !file || (now.t !== null && now.t < 30);
    record(label, {
        ok: elapsed !== null && fromStart,
        note: elapsed !== null ? `playing after ${elapsed} ms, t=${now.t}/${now.d} (${now.src})${fromStart ? '' : '; FAILED: not from the start'}` : `did not play (readyState ${now.readyState}, t=${now.t})`,
        state: now,
        vm: vmScreenshot(label),
    });
    return elapsed !== null;
};

const waitHidden = async () => waitFor('return !!window.__f57 && window.__f57.state().hidden === true;', 15000, 300);

// One real remote key, then the state once it settles.
const press = async (name, keyName, check, { settle = 1200, shot = false } = {}) => {
    const before = await state();
    const started = Date.now();
    if (keyName) remote(keyName);
    await sleep(settle);
    const after = await state();
    const wall = (Date.now() - started) / 1000;
    const result = check ? check(before, after, wall) : {};
    const problems = Object.keys(result).filter((condition) => !result[condition]);
    record(name, {
        ok: check ? problems.length === 0 : undefined,
        note: `${keyName}: t ${before.t} -> ${after.t}, paused ${before.paused} -> ${after.paused}, focus ${after.focused}, remote ${after.remote ? after.remote.result : '-'}${problems.length ? '; FAILED: ' + problems.join(', ') : ''}`,
        before,
        after,
        wall,
        screenshot: shot ? await screenshot(name) : undefined,
        vm: shot ? vmScreenshot(name) : undefined,
    });
    return after;
};

const near = (value, expected, tolerance) => Math.abs(value - expected) <= tolerance;
// A seek by `step` seconds: the playback goes on during `wall` seconds (keyframes every 1 s).
const seekedBy = (step) => (before, after, wall) => ({
    [`moved ${step} s`]: near(after.t - before.t, step + wall, 2.5),
});

// ----- scenarios -----
const keys = async ({ manifestUrl, addonPort }) => {
    await openEpisode(manifestUrl, addonPort, 1);
    if (!await waitPlaying('K00-playing')) return;
    record('K01-bar-hides', { ok: await waitHidden() !== null, screenshot: await screenshot('K01-bar-hidden'), vm: vmScreenshot('K01-bar-hidden') });

    // OK with the bar hidden: pause, bar up with the focus on play/pause.
    await press('K02-ok-pauses', 'OK', (b, a) => ({ paused: a.paused === true, 'bar shown': a.hidden === false, 'focus on play': /control-bar-button/.test(a.focused), 'focus ring': a.focusRing }), { shot: true });
    await press('K03-ok-plays', 'OK', (b, a) => ({ playing: a.paused === false, 'clicked the focused button': a.remote.result === 'click' }));
    await press('K04-right-next-button', 'RIGHT', (b, a) => ({ 'focus moved in the row': a.focused !== b.focused && /control-bar-button/.test(a.focused), 'no seek': near(a.t - b.t, 1.2, 1.5) }), { shot: true });
    await press('K05-up-seek-bar', 'UP', (b, a) => ({ 'seek bar focused': a.seekFocused, 'focus ring': a.focusRing }), { shot: true });
    await press('K06-right-seeks', 'RIGHT', seekedBy(10));
    await press('K07-left-seeks', 'LEFT', seekedBy(-10));
    await press('K08-down-back-to-button', 'DOWN', (b, a) => ({ 'back on the button': /control-bar-button/.test(a.focused) }));

    // Bar hidden again: RIGHT seeks right away and the focus goes to the seek bar.
    record('K09-bar-hides', { ok: await waitHidden() !== null });
    await press('K10-right-hidden-seeks', 'RIGHT', (b, a, wall) => ({ ...seekedBy(10)(b, a, wall), 'seek bar focused': a.seekFocused }), { shot: true });
    await press('K11-fast-forward', 'FASTFORWARD', seekedBy(10));
    await press('K12-rewind', 'REWIND', seekedBy(-10));

    // FF held for 2.6 s (trusted CDP key events with autoRepeat every 100 ms): the target moves on the
    // seek bar while the video keeps playing, with growing steps, and is committed once on release.
    const before = await state();
    const started = Date.now();
    await key(417, 'rawKeyDown', false);
    const labels = [];
    for (let i = 0; i < 26; i++) {
        await sleep(100);
        await key(417, 'rawKeyDown', true);
        if (i % 5 === 4) labels.push((await state()).seekLabel);
    }
    const during = await state();
    const duringShot = await screenshot('K13-ff-held-preview');
    const duringVm = vmScreenshot('K13-ff-held-preview');
    await key(417, 'keyUp');
    await sleep(2500);
    const after = await state();
    const wall = (Date.now() - started) / 1000;
    const jumped = after.t - before.t - wall;
    record('K13-ff-held', {
        ok: near(during.t - before.t, (Date.now() - started) / 1000 - 2.5, 3) && jumped > 150,
        note: `video during the hold ${before.t} -> ${during.t} (no seek yet), seek bar labels ${labels.join(' | ')}, committed jump ${Math.round(jumped)} s (13 accepted repeats at 10 s each would be 130 s)`,
        before, during, after, labels, screenshot: duringShot, vm: duringVm,
    });

    await press('K14-pause-key', 'PAUSE', (b, a) => ({ paused: a.paused === true }));
    await press('K15-pause-key-again', 'PAUSE', (b, a) => ({ 'still paused': a.paused === true }));
    await press('K16-play-key', 'PLAY', (b, a) => ({ playing: a.paused === false }));

    // Magic Remote: the pointer over the seek bar shows it; press at 20 % and drag to 60 %.
    const rect = await evaluate(`
        var slider = document.querySelector('[class*="seek-bar-container"] [class*="slider-container"]');
        var factor = window.innerWidth / document.documentElement.getBoundingClientRect().width;
        var r = slider.getBoundingClientRect();
        return { x: r.left * factor, y: (r.top + r.height / 2) * factor, w: r.width * factor };
    `);
    const at = (fraction) => ({ x: Math.round(rect.x + rect.w * fraction), y: Math.round(rect.y) });
    await mouse({ type: 'mouseMoved', ...at(0.5) });
    await sleep(300);
    await mouse({ type: 'mousePressed', button: 'left', clickCount: 1, ...at(0.2) });
    for (const fraction of [0.3, 0.4, 0.5, 0.6]) {
        await sleep(120);
        await mouse({ type: 'mouseMoved', button: 'left', ...at(fraction) });
    }
    const dragging = await state();
    await mouse({ type: 'mouseReleased', button: 'left', clickCount: 1, ...at(0.6) });
    await sleep(2500);
    const dragged = await state();
    record('K17-magic-remote-drag', {
        ok: near(dragged.t, dragged.d * 0.6, 12) && dragged.rate === 1,
        note: `drag 20 % -> 60 %: t=${dragged.t}/${dragged.d} (expected ~${Math.round(dragged.d * 0.6)}), label while dragging ${dragging.seekLabel}, rate ${dragged.rate}`,
        dragging, dragged, screenshot: await screenshot('K17-drag'),
    });
    // The pointer leaves the bar; the 5-way keys take over again.
    await mouse({ type: 'mouseMoved', x: 960, y: 300 });
    await sleep(500);
    await press('K18-right-after-pointer', 'RIGHT', seekedBy(10));

    // Back: hides the bar first (still in the Player), then leaves.
    await press('K19-up-shows-bar', 'UP', (b, a) => ({ 'bar shown': a.hidden === false }));
    await press('K20-back-hides-bar', 'BACK', (b, a) => ({ 'still in the Player': a.hash.indexOf('#/player/') === 0, 'bar hidden': a.hidden === true, 'consumed by player-controls': a.lastBack && a.lastBack.consumedBy === 'player-controls', playing: a.paused === false }), { shot: true });
    await press('K21-back-leaves', 'BACK', (b, a) => ({ 'left the Player': a.hash.indexOf('#/player/') !== 0, 'by the route layer': a.lastBack && a.lastBack.consumedBy === 'route' }), { settle: 2500, shot: true });
};

const toPopup = async ({ manifestUrl, addonPort }) => {
    await openEpisode(manifestUrl, addonPort, 1);
    if (!await waitPlaying('N00-playing')) return false;
    // 40 s before the end: the popup comes 35 s before it (nextVideoNotificationDuration).
    await evaluate('var v = window.__f57.video(); v.currentTime = v.duration - 40; return true;');
    const shown = await waitFor('return !!window.__f57 && window.__f57.state().popup === true;', 20000, 500);
    await sleep(1500);
    const now = await state();
    record('N01-popup', { ok: shown !== null && /play-button/.test(now.focused), note: `popup after ${shown} ms, focus ${now.focused}`, state: now, screenshot: await screenshot('N01-popup'), vm: vmScreenshot('N01-popup') });
    return shown !== null;
};

const next = async (servers) => {
    if (!await toPopup(servers)) return;
    // With the popup up the upstream keyboard seek is off: FF does nothing and says so.
    await press('N01b-ff-with-popup', 'FASTFORWARD', (b, a, wall) => ({ 'no seek': near(a.t - b.t, wall, 2), 'result none': !!a.remote && a.remote.result === 'none', 'popup still up': a.popup }));
    await press('N02-down-to-seek-bar', 'DOWN', (b, a) => ({ 'seek bar focused': a.seekFocused, 'popup still up': a.popup }));
    await press('N03-up-to-popup', 'UP', (b, a) => ({ 'watch focused': /play-button/.test(a.focused) }));
    await press('N04-left-dismiss', 'LEFT', (b, a) => ({ 'dismiss focused': /dismiss/.test(a.focused) }), { shot: true });
    await press('N05-right-watch', 'RIGHT', (b, a) => ({ 'watch focused': /play-button/.test(a.focused) }));
    await press('N06-back-dismisses', 'BACK', (b, a) => ({ 'popup gone': !a.popup, 'still in the Player': a.hash.indexOf('#/player/') === 0, 'by the overlay bridge': a.lastBack && a.lastBack.consumedBy === 'overlay' }), { shot: true });
    await press('N07-down-row', 'DOWN', (b, a) => ({ 'focus in the row': /control-bar-button/.test(a.focused) }));
    const nextButton = await press('N08-right-next-button', 'RIGHT', (b, a) => ({ 'next video button': /\[.+\]/.test(a.focused) }), { shot: true });
    await press('N09-ok-next-episode', 'OK', (b, a) => ({ 'episode 2 route': a.hash.indexOf(encodeURIComponent('tt9100001:1:2')) !== -1 }), { settle: 3000 });
    record('N09b-next-button-title', { note: nextButton.focused });
    await waitPlaying('N10-episode-2-playing', 90000, 'ep2_90s.mp4');
    await press('N11-stop-leaves', 'STOP', (b, a) => ({ 'left the Player': a.hash.indexOf('#/player/') !== 0, 'by the route layer': a.lastBack && a.lastBack.consumedBy === 'route' }), { settle: 2500, shot: true });
};

// The core player state and the <video> calls during the switch to episode 2.
const traceSwitch = async (name) => {
    const trace = [];
    for (let i = 0; i < 20; i++) {
        const player = await coreState('player').catch(() => null);
        const now = await state();
        trace.push({
            i,
            hash: now.hash.slice(-30),
            t: now.t, d: now.d, src: now.src, videos: now.videos, paused: now.paused,
            selected: player && player.selected && player.selected.streamRequest ? player.selected.streamRequest.path.id : null,
            libraryVideo: player && player.libraryItem ? player.libraryItem.state.video_id : null,
            timeOffset: player && player.libraryItem ? player.libraryItem.state.timeOffset : null,
        });
        await sleep(300);
    }
    const media = await evaluate('return window.__f57.media;');
    const core = await evaluate('return window.__f57.core.filter(function (e) { return e.action !== "TimeChanged" || e.time > Date.now() - 12000; });');
    record(name, { note: `${trace.length} samples, ${media.length} media calls, ${core.length} core actions`, trace, media, core });
};

const watch = async (servers) => {
    if (!await toPopup(servers)) return;
    await evaluate('window.__f57.media = []; window.__f57.core = []; return true;');
    remote('OK');
    await traceSwitch('W02a-switch-trace');
    await press('W02-ok-watch', null, (b, a) => ({ 'episode 2 route': a.hash.indexOf(encodeURIComponent('tt9100001:1:2')) !== -1 }), { settle: 500 });
    await waitPlaying('W03-episode-2-playing', 90000, 'ep2_90s.mp4');
};

const coreState = (field) => evaluate(`return Promise.resolve(window.core.getState(${JSON.stringify(field)})).then(function (s) { return JSON.parse(JSON.stringify(s)); });`);
const continueWatching = async () => {
    const preview = await coreState('continue_watching_preview');
    const items = preview && preview.items ? preview.items : [];
    // The item is the library item flattened: its id is serialized as `_id`.
    const item = items.filter((entry) => (entry._id || entry.id) === 'tt9100001')[0];
    if (!item) return null;
    // core-web serializes the preview items with their own fields (progress in %, deep links).
    return { id: item._id || item.id, progress: item.progress, type: item.type, name: item.name };
};

const resumeSave = async ({ manifestUrl, addonPort }) => {
    await openEpisode(manifestUrl, addonPort, 1);
    if (!await waitPlaying('R00-playing')) return;
    await evaluate('window.__f57.video().currentTime = 200; return true;');
    await sleep(8000);
    const player = await coreState('player');
    record('R01-core-position', { ok: !!player.libraryItem && player.libraryItem.state.timeOffset > 190000, note: `libraryItem.state.timeOffset ${player.libraryItem && player.libraryItem.state.timeOffset}`, t: (await state()).t });
    for (let i = 0; i < 3 && (await state()).hash.indexOf('#/player/') === 0; i++) {
        remote('BACK');
        await sleep(2000);
    }
    await sleep(4000);
    const item = await continueWatching();
    // 200 s of 600 s: about 33 %.
    record('R02-left-and-saved', { ok: (await state()).hash.indexOf('#/player/') !== 0 && !!item && item.progress > 30 && item.progress < 40, note: JSON.stringify(item), timeOffset: player.libraryItem && player.libraryItem.state.timeOffset, screenshot: await screenshot('R02-board') });
};

const resumeCheck = async ({ manifestUrl, addonPort }) => {
    const item = await continueWatching();
    record('R10-saved-after-reboot', { ok: !!item && item.progress > 30 && item.progress < 40, note: JSON.stringify(item) });
    // The position the core kept before the reboot (resume-save, same output folder).
    let saved = null;
    try {
        saved = JSON.parse(fs.readFileSync(path.join(OUT, 'resume-save.json'), 'utf8')).steps.filter((step) => step.name === 'R02-left-and-saved')[0].timeOffset;
    } catch {
        // resume-save not in this folder
    }
    await openEpisode(manifestUrl, addonPort, 1);
    // The first samples after the video starts: it must start at the saved position, not at 0.
    const samples = [];
    const started = Date.now();
    while (Date.now() - started < 120000) {
        const now = await state();
        if (now.readyState !== null && now.readyState >= 1) samples.push({ ms: Date.now() - started, t: now.t, readyState: now.readyState, paused: now.paused, label: now.seekLabel });
        if (samples.length > 0 && now.readyState >= 3 && now.t > 0.5 && !now.paused) break;
        await sleep(300);
    }
    const last = samples[samples.length - 1];
    const expected = saved ? saved / 1000 : 200;
    record('R11-resumed', {
        ok: !!last && near(last.t, expected, 4) && samples.every((sample) => sample.t === 0 || sample.t > expected - 4),
        note: `saved ${expected} s (resume-save ${saved}); started at ${last ? last.t : '-'} s (label ${last ? last.label : '-'})`,
        samples,
        vm: vmScreenshot('R11-resumed'),
        screenshot: await screenshot('R11-resumed'),
    });
};

// Diagnostics of the page near the end of episode 1 (POPUP_PROBE_LEAD s before it, default 40: the
// popup comes at 35): page state, JS heap and guest memory every second for 40 s, then the system log.
const popupProbe = async ({ manifestUrl, addonPort }) => {
    await openEpisode(manifestUrl, addonPort, 1);
    if (!await waitPlaying('P00-playing')) return;
    record('P01-guest-memory', { note: guest(GUEST_MEMORY) });
    const lead = Number(process.env.POPUP_PROBE_LEAD || 40);
    await evaluate(`var v = window.__f57.video(); v.currentTime = v.duration - ${lead}; return true;`);
    const samples = [];
    for (let i = 0; i < 40; i++) {
        await sleep(1000);
        const sample = { i };
        try {
            sample.state = await Promise.race([
                evaluate('var s = window.__f57 ? window.__f57.state() : { reloaded: true, hash: location.hash }; s.heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null; return s;'),
                sleep(5000).then(() => 'timeout'),
            ]);
        } catch (error) {
            sample.error = error.message.slice(0, 200);
            session = null;
        }
        if (i % 5 === 0 || sample.error || sample.state === 'timeout') sample.guest = guest(GUEST_MEMORY);
        samples.push(sample);
        console.log(JSON.stringify(sample).slice(0, 300));
    }
    record('P02-samples', { samples, vm: vmScreenshot('P02-end') });
    record('P03-system-log', { note: guest(SYSTEM_LOG) });
};

// Resume in one boot (the second load works with the pipeline guard, F5.6): play episode 1 up to
// 200 s, leave the Player, open it again; it must start where it stopped.
const resume = async (servers) => {
    await resumeSave(servers);
    if (steps.some((step) => step.ok === false)) return;
    await sleep(3000);
    const saved = steps.filter((step) => step.name === 'R02-left-and-saved')[0].timeOffset;
    await openEpisode(servers.manifestUrl, servers.addonPort, 1);
    const samples = [];
    const started = Date.now();
    while (Date.now() - started < 120000) {
        const now = await state();
        if (now.readyState !== null && now.readyState >= 1) samples.push({ ms: Date.now() - started, t: now.t, readyState: now.readyState, paused: now.paused, label: now.seekLabel, src: now.src });
        if (samples.length > 0 && now.readyState >= 3 && now.t > 0.5 && !now.paused) break;
        await sleep(300);
    }
    const last = samples[samples.length - 1];
    const expected = saved / 1000;
    record('R11-resumed', {
        ok: !!last && near(last.t, expected, 4) && samples.every((sample) => sample.t === 0 || sample.t > expected - 4),
        note: `saved ${expected} s; started at ${last ? last.t : '-'} s (label ${last ? last.label : '-'})`,
        samples,
        vm: vmScreenshot('R11-resumed'),
        screenshot: await screenshot('R11-resumed'),
    });
};

// A Player menu opened with the remote only (F4.3 owns its focus): the audio button of the bar, OK,
// the focus inside the menu, arrows stay in it, Back closes it and the focus is back on the button.
const AUDIO_ICON = 'M57.48 223.57v75.86';
const isAudioFocused = `return !!document.activeElement && document.activeElement.innerHTML.indexOf('${AUDIO_ICON}') !== -1;`;
const menu = async ({ manifestUrl, addonPort }) => {
    await openEpisode(manifestUrl, addonPort, 1);
    if (!await waitPlaying('M00-playing')) return;
    const inMenu = 'var layer = document.querySelector(\'[class*="player-container"] [class*="menu-layer"]\'); return !!layer && layer.contains(document.activeElement);';
    await press('M01-down-row', 'DOWN', (b, a) => ({ 'focus in the row': /control-bar-button/.test(a.focused) }));
    let now = await state();
    for (let i = 0; i < 8 && !(await evaluate(isAudioFocused)); i++) {
        remote('RIGHT');
        await sleep(700);
        now = await state();
    }
    record('M02-audio-button', { ok: await evaluate(isAudioFocused), note: now.focused });
    await press('M03-ok-opens-menu', 'OK', () => ({}), { settle: 1500, shot: true });
    record('M03b-audio-menu-open', { ok: await evaluate('return !!document.querySelector(\'[class*="audio-menu"]\');') });
    record('M04-focus-in-menu', { ok: await evaluate(inMenu), note: (await state()).focused });
    remote('DOWN');
    await sleep(600);
    remote('DOWN');
    await sleep(600);
    record('M05-arrows-stay-in-menu', { ok: await evaluate(inMenu), note: (await state()).focused });
    await press('M06-back-closes-menu', 'BACK', (b, a) => ({
        'menu closed': true,
        'still in the Player': a.hash.indexOf('#/player/') === 0,
        'by the overlay bridge': !!a.lastBack && a.lastBack.consumedBy === 'overlay',
    }), { settle: 1500 });
    record('M07-focus-back-on-button', {
        ok: await evaluate(`return !document.querySelector('[class*="audio-menu"]') && document.activeElement.innerHTML.indexOf('${AUDIO_ICON}') !== -1;`),
        note: (await state()).focused,
        screenshot: await screenshot('M07-after-back'),
    });
};

// The F4.3 context menu (YELLOW) over the playing video: its arrows move the focus in the menu and
// must not reach the video behind it (volume, seek), as the review of cycle 1 found (X05b/X06 of its
// review2 scenario). Then Back closes the menu, and paused, Back leaves the Player.
const volumeNow = 'var v = window.__f57.video(); return v ? Math.round(v.volume * 100) : null;';
const contextMenu = async ({ manifestUrl, addonPort }) => {
    await openEpisode(manifestUrl, addonPort, 1);
    if (!await waitPlaying('C00-playing')) return;
    record('C01-bar-hidden', { ok: await waitHidden() !== null });
    const v0 = await evaluate(volumeNow);
    await press('C02-down-no-menu', 'DOWN', () => ({}));
    const v1 = await evaluate(volumeNow);
    record('C02b-volume-no-menu', { ok: v1 === v0, note: `volume ${v0} -> ${v1}` });
    await sleep(3500);
    await press('C03-yellow', 'YELLOW', () => ({}), { settle: 1500 });
    record('C03b-menu-open', { ok: await evaluate('return !!document.querySelector(\'[class*="context-menu-container"]\');') });
    const v2 = await evaluate(volumeNow);
    const focusBefore = (await state()).focused;
    await press('C04-down-in-menu', 'DOWN', (b, a) => ({ 'remote leaves it to F4.3': !!a.remote && a.remote.result === 'overlay-arrow' }));
    await press('C05-down-in-menu', 'DOWN', () => ({}));
    const v3 = await evaluate(volumeNow);
    const focusAfter = (await state()).focused;
    record('C05b-volume-in-menu', { ok: v3 === v2 && focusAfter !== null, note: `volume ${v2} -> ${v3} after two DOWN in the context menu; focus ${focusBefore} -> ${focusAfter}`, screenshot: await screenshot('C05-menu') });
    await press('C06-right-in-menu', 'RIGHT', (b, a, wall) => ({ 'no seek': near(a.t - b.t, wall, 2) }));
    await press('C07-left-in-menu', 'LEFT', (b, a, wall) => ({ 'no seek': near(a.t - b.t, wall, 2) }));
    await press('C08-up-in-menu', 'UP', () => ({}));
    const v4 = await evaluate(volumeNow);
    record('C08b-volume-after-up', { ok: v4 === v2, note: `volume ${v2} -> ${v4}` });
    await press('C09-back-closes', 'BACK', (b, a) => ({
        'still in the Player': a.hash.indexOf('#/player/') === 0,
        'menu closed': true,
        'by the overlay bridge': !!a.lastBack && a.lastBack.consumedBy === 'overlay',
    }), { settle: 1500 });
    record('C09b-menu-closed', { ok: await evaluate('return !document.querySelector(\'[class*="context-menu-container"]\');') });
    await press('C10-right-seeks-again', 'RIGHT', seekedBy(10));
    await press('C11-pause', 'PAUSE', (b, a) => ({ paused: a.paused === true }));
    await press('C12-back-paused-leaves', 'BACK', (b, a) => ({ 'left the Player': a.hash.indexOf('#/player/') !== 0 }), { settle: 2500, shot: true });
};

// Seek timing (the c8 profile of F6.4 measured 5-13 s net for two RIGHT asking 20 s): the gesture of
// the e2e (two RIGHT 300 ms apart, then 3 s) and a single RIGHT, with the times the app set on the
// <video>, its seeking/seeked/waiting/playing events and the net jump the e2e way (forward - elapsed).
const SEEK_EVENTS = `
    var v = window.__f57.video();
    window.__f57.mediaEvents = [];
    ['seeking', 'seeked', 'waiting', 'playing', 'pause', 'play', 'canplay'].forEach(function (type) {
        v.addEventListener(type, function () { window.__f57.mediaEvents.push({ type: type, at: Date.now(), t: Math.round(v.currentTime * 10) / 10 }); });
    });
    window.__f57.media = [];
    return true;
`;
const seekRound = async (name, presses) => {
    await evaluate(SEEK_EVENTS);
    await evaluate('window.__f57.keys = []; return true;');
    const countBefore = ((await state()).remote || {}).count || 0;
    const before = await state();
    const started = Date.now();
    for (let i = 0; i < presses; i++) {
        if (i > 0) await sleep(300);
        remote('RIGHT');
    }
    const samples = [];
    let atThree = null;
    while (Date.now() - started < 12000) {
        const now = await state();
        samples.push({ ms: Date.now() - started, t: now.t, readyState: now.readyState, paused: now.paused, label: now.seekLabel });
        if (atThree === null && Date.now() - started >= 3300 + 300 * (presses - 1)) atThree = { ms: Date.now() - started, t: now.t };
        await sleep(250);
    }
    const events = await evaluate('return window.__f57.mediaEvents.map(function (e) { return e; });');
    const sets = await evaluate('return window.__f57.media.filter(function (e) { return e.what === "currentTime"; });');
    const keysSeen = await evaluate('return window.__f57.keys;');
    const countAfter = ((await state()).remote || {}).count || 0;
    const firstSeeking = events.filter((e) => e.type === 'seeking')[0];
    const lastPlaying = events.filter((e) => e.type === 'playing' || e.type === 'canplay').slice(-1)[0];
    const asked = 10 * presses;
    const net = atThree ? Math.round((atThree.t - before.t - atThree.ms / 1000) * 10) / 10 : null;
    const last = samples[samples.length - 1];
    record(name, {
        note: `asked +${asked} s from ${before.t}; time(s) set ${sets.map((e) => Math.round(e.value * 10) / 10).join(', ')}; ` +
            `keys at the page ${keysSeen.filter((k) => k.type === 'keydown').length} down/${keysSeen.filter((k) => k.type === 'keyup').length} up, handled ${countAfter - countBefore}; net the e2e way at ${atThree && atThree.ms} ms: ${net} s; stall ${firstSeeking && lastPlaying ? lastPlaying.at - firstSeeking.at : '-'} ms; ` +
            `after 12 s: t=${last.t} (target + playback = ${Math.round((before.t + asked + 12 - (firstSeeking && lastPlaying ? (lastPlaying.at - firstSeeking.at) / 1000 : 0)) * 10) / 10})`,
        before: before.t, sets, events, samples, net, keysSeen, remoteKeys: countAfter - countBefore,
    });
};
const seekProbe = async ({ manifestUrl, addonPort }) => {
    await openEpisode(manifestUrl, addonPort, 1);
    if (!await waitPlaying('S00-playing')) return;
    record('S01-bar-hidden', { ok: await waitHidden() !== null });
    await seekRound('S02-two-right', 2);
    await waitHidden();
    await seekRound('S03-one-right', 1);
    await waitHidden();
    await seekRound('S04-two-right-again', 2);
    for (let i = 5; i <= 8; i++) {
        await waitHidden();
        await seekRound(`S0${i}-two-right`, 2);
    }
};

// Leaving the Player opened from the streams list: the focus must come back to the stream played
// (F4.1c), as upstream where the Player never took it. The test add-on is installed, the episode's
// streams page opened, the stream played with OK, the bar focused, then Back until the details page.
const exitFocus = async ({ manifestUrl, addonPort }) => {
    const manifest = await (await fetch(`http://127.0.0.1:${addonPort}/manifest.json`)).json();
    await evaluate(`window.core.dispatch({ action: 'Ctx', args: { action: 'InstallAddon', args: { transportUrl: ${JSON.stringify(manifestUrl)}, manifest: ${JSON.stringify(manifest)}, flags: { official: false, protected: false } } } }); return true;`);
    await sleep(2000);
    const detailsHash = `#/detail/series/tt9100001/${encodeURIComponent('tt9100001:1:1')}`;
    await evaluate(`
        var idx = window.history.state && typeof window.history.state.idx === 'number' ? window.history.state.idx + 1 : 1;
        var entry = { usr: null, key: 'f57d' + idx, idx: idx };
        window.history.pushState(entry, '', ${JSON.stringify(detailsHash)});
        window.dispatchEvent(new PopStateEvent('popstate', { state: entry }));
        return idx;
    `);
    const listed = await waitFor('return document.querySelectorAll(\'[class*="stream-container"]\').length > 0;', 30000, 500);
    record('E00-streams', { ok: listed !== null, note: (await state()).focused });
    for (let i = 0; i < 3 && !/stream-container/.test(String((await state()).focused)); i++) {
        remote('DOWN');
        await sleep(1200);
    }
    const streamFocused = (await state()).focused;
    const streamHref = await evaluate('return document.activeElement && document.activeElement.getAttribute("href");');
    record('E01-stream-focused', { ok: /stream-container/.test(String(streamFocused)), note: `${streamFocused} ${streamHref}` });
    remote('OK');
    if (!await waitPlaying('E02-playing')) return;
    record('E02b-focus-in-player', { note: `${(await state()).focused}; stream still focused: ${await evaluate('return !!document.activeElement && document.activeElement.getAttribute("href") === ' + JSON.stringify(streamHref) + ';')}` });
    await press('E03-down-bar', 'DOWN', (b, a) => ({ 'focus in the bar': /control-bar-button/.test(a.focused) }));
    for (let i = 0; i < 3 && (await state()).hash.indexOf('#/player/') === 0; i++) {
        remote('BACK');
        await sleep(1500);
    }
    const samples = [];
    for (let i = 0; i < 10; i++) {
        samples.push({ ms: i * 400, focused: (await state()).focused, href: await evaluate('return document.activeElement && document.activeElement.getAttribute("href");') });
        await sleep(400);
    }
    const exit = await evaluate('var l = window.__webosPlayerRemoteLast; return l ? { entry: l.entry, installActive: l.installActive, firstFocusFrom: l.firstFocusFrom, exit: l.exit } : null;');
    const last = samples[samples.length - 1];
    record('E04-focus-back-on-stream', { ok: last.href === streamHref, note: `focus ${last.focused} (${last.href}); expected ${streamHref}; remote ${JSON.stringify(exit)}`, samples, exit, screenshot: await screenshot('E04-back') });
};

const SCENARIOS = { keys, next, watch, resume, menu, 'context-menu': contextMenu, 'seek-probe': seekProbe, 'exit-focus': exitFocus, 'resume-save': resumeSave, 'resume-check': resumeCheck, 'popup-probe': popupProbe };

const main = async () => {
    if (!SCENARIOS[SCENARIO]) throw new Error(`unknown scenario ${SCENARIO}`);
    const servers = await startServers();
    record('servers', { note: JSON.stringify(servers) });
    await boot();
    try {
        await SCENARIOS[SCENARIO](servers);
    } catch (error) {
        record('error', { ok: false, note: error.stack });
    }
    const final = await state().catch(() => null);
    record('system-log', { note: guest(SYSTEM_LOG), memory: guest(GUEST_MEMORY) });
    const errors = await evaluate('return window.__f57.errors;').catch(() => null);
    const guardLog = await evaluate('return window.__f57.guard;').catch(() => null);
    // With the pipeline guard (F5.6): no watchdog error and no stream error during the scenario.
    const watchdog = (errors || []).concat((guardLog || []).map((entry) => entry.text)).filter((text) => /watchdog|STREAM_FAILED_TO_LOAD|failed to load/i.test(text));
    record('pipeline-guard', { ok: watchdog.length === 0, note: `${(guardLog || []).length} guard log lines, ${watchdog.length} watchdog/stream errors`, guardLog, watchdog });
    const failed = save({ final, reloads, errors, guardLog });
    console.log(failed.length ? `FALHAS: ${failed.join(', ')}` : 'tudo ok');
    if (session) session.close();
    process.exit(failed.length ? 1 : 0);
};

main().catch((error) => {
    record('fatal', { ok: false, note: error.stack });
    save();
    process.exit(1);
});
