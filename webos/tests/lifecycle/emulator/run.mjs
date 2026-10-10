#!/usr/bin/env node
// App lifecycle on the emulator (F3.3): real HOME key (webos/tools/remote.mjs, port 19001), real
// relaunch (ares-launch), state read over CDP. Run from the repo root, inside an emu-run
// reservation, after `pnpm webos:package`:
//   webos/tools/emu-run --timeout 15 -- node webos/tests/lifecycle/emulator/run.mjs <out-dir>
// Writes <out-dir>/lifecycle-emulator.json (every step with its state) and screenshots.
//
// Scenarios (each one ends in a record with ok true/false):
//   home-relaunch   HOME (launcher bar over the app: only `blur`), then the app is relaunched: route,
//                   focus and scroll are kept (the bar stays: the emulator's relaunch does not close it)
//   background      OK on the launcher opens another full-screen app: real visibilitychange (hidden);
//                   focus and scroll are taken away; the relaunch brings everything back
//   deep-link       relaunch with a contentTarget opens that screen; one outside the app is ignored
//   hidden          a real <video> playing: HOME bar leaves it playing, a full-screen app over it
//                   pauses it (the system does it first: pauseMedia finds it already paused), nothing
//                   resumes it, not even the system's own resume after a relaunch (the page is frozen while hidden:
//                   a play() cannot be attempted from here while the app is behind)
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const OUT = path.resolve(process.argv[2] || 'lifecycle-emulator');
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', '..');
const APP_ID = 'io.github.gabrielsflores.stremio';
const DEVICE = process.env.EMU_DEVICE;
const CDP_PORT = process.env.EMU_CDP_PORT;
const REMOTE_PORT = process.env.EMU_REMOTE_PORT;
const MEDIA_DIR = path.join(os.homedir(), 'webos-tv-sdk', 'media-tests', 'files');
const MEDIA_PORT = 8099;
if (!DEVICE || !CDP_PORT || !REMOTE_PORT) {
    console.error('run inside webos/tools/emu-run');
    process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', cwd: REPO, ...options });
const cdp = (...args) => run('node', ['webos/tools/cdp.mjs', '--port', CDP_PORT, '--target', APP_ID, ...args]).trim();
const evaluate = (expression) => {
    const output = cdp('eval', `JSON.stringify((function(){ ${expression} })())`);
    try {
        return JSON.parse(output);
    } catch {
        return output;
    }
};
const remote = (...keys) => run('node', ['webos/tools/remote.mjs', '--port', REMOTE_PORT, '--delay', '0', ...keys]);
const relaunch = (params) => run('ares-launch', ['--device', DEVICE, APP_ID, ...(params ? ['-p', JSON.stringify(params)] : [])]);
const screenshot = (name) => {
    const file = path.join(OUT, `${name}.png`);
    try {
        cdp('screenshot', file);
        return path.basename(file);
    } catch (error) {
        return `failed: ${error.message.split('\n')[0]}`;
    }
};
// The whole screen of the VM: the launcher bar is not part of the page screenshot.
const vmScreenshot = (name) => {
    const file = path.join(OUT, `${name}-vm.png`);
    try {
        const result = run('python3', ['webos/tools/qmp.py', 'screendump', file]);
        return fs.existsSync(file) ? path.basename(file) : `failed: ${result.trim()}`;
    } catch (error) {
        return `failed: ${error.message.split('\n')[0]}`;
    }
};

const PAGE_HELPERS = `
    if (!window.__f33) {
        window.__f33 = { events: [] };
        var add = function (target, label, type) {
            target.addEventListener(type, function (event) {
                window.__f33.events.push({ time: Date.now(), event: label + type, hidden: document.hidden, hasFocus: document.hasFocus(), detail: event.detail === undefined || event.detail === null ? null : event.detail });
            });
        };
        add(document, 'document:', 'visibilitychange');
        add(document, 'document:', 'webOSRelaunch');
        add(window, 'window:', 'blur');
        add(window, 'window:', 'focus');
        window.__f33.describe = function (element) {
            if (!element) return null;
            if (element === document.body) return 'body';
            var rect = element.getBoundingClientRect();
            return element.tagName.toLowerCase() + (typeof element.className === 'string' && element.className ? '.' + element.className.trim().split(/\\s+/).slice(0, 2).join('.') : '') +
                (element.textContent ? ' "' + element.textContent.trim().slice(0, 30) + '"' : '') + ' @' + Math.round(rect.left) + ',' + Math.round(rect.top);
        };
        window.__f33.state = function () {
            var scrolls = [];
            for (var e = document.activeElement; e && e !== document.documentElement; e = e.parentElement) {
                if (e.scrollTop > 0 || e.scrollLeft > 0) scrolls.push({ element: window.__f33.describe(e).split(' @')[0], top: e.scrollTop, left: e.scrollLeft });
            }
            return {
                hash: location.hash,
                focus: window.__f33.describe(document.activeElement),
                scrolls: scrolls,
                hasFocus: document.hasFocus(),
                hidden: document.hidden,
                isActivated: window.PalmSystem ? window.PalmSystem.isActivated : null,
            };
        };
    }
    return true;
`;
const state = () => evaluate('return window.__f33.state();');
const events = () => evaluate('return window.__f33.events;');
const lifecycleLog = () => evaluate('return window.__webosLifecycle ? window.__webosLifecycle.events : null;');

const steps = [];
const record = (name, data) => {
    steps.push({ name, ...data });
    const mark = data.ok === undefined ? '-' : data.ok ? 'ok' : 'FALHOU';
    console.log(`[${mark}] ${name}${data.note ? ` (${data.note})` : ''}`);
};

const waitFor = async (expression, timeoutMs, intervalMs = 500) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            if (evaluate(expression) === true) return Date.now() - started;
        } catch {
            // CDP target may not be up yet
        }
        await sleep(intervalMs);
    }
    return null;
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const lastOf = (log, type) => (log || []).filter((entry) => entry.type === type).pop();

// Puts the app on a screen with something focused and a scrolled container.
const prepare = async (route) => {
    evaluate(`location.hash = '${route}'; return true;`);
    await sleep(2500);
    remote('DOWN', 'RIGHT', 'DOWN', 'DOWN');
    await sleep(1500);
    return state();
};

const main = async () => {
    const started = Date.now();
    console.log(run('webos/scripts/ares.sh', ['install'], { env: { ...process.env, WEBOS_DEVICE: DEVICE } }).trim());
    run('webos/scripts/ares.sh', ['launch'], { env: { ...process.env, WEBOS_DEVICE: DEVICE } });
    const boardMs = await waitFor("return document.querySelectorAll('[class*=\"meta-item-container\"]').length > 0;", 90000);
    record('boot', { ok: boardMs !== null, note: boardMs === null ? 'no catalog after 90 s' : `board in ${boardMs} ms` });
    if (boardMs === null) return;
    evaluate(PAGE_HELPERS);

    // 1. HOME and the way back
    const before = await prepare('#/discover');
    const shotBefore = screenshot('home-relaunch-1-before');
    record('home-relaunch-prepared', { state: before, ok: before.hash === '#/discover' && before.focus !== null && before.focus !== 'body' });
    remote('HOME');
    await sleep(3000);
    const home = state();
    const vmHome = vmScreenshot('home-relaunch-2-home');
    relaunch();
    await sleep(3000);
    const after = state();
    const log = lifecycleLog();
    const afterEvents = events();
    const relaunchEntry = lastOf(log, 'relaunch');
    record('home-relaunch', {
        ok: same({ hash: before.hash, focus: before.focus, scrolls: before.scrolls }, { hash: after.hash, focus: after.focus, scrolls: after.scrolls }) &&
            !!relaunchEntry && relaunchEntry.activated === true,
        note: `${before.focus} -> ${after.focus}`,
        before, home, after, relaunch: relaunchEntry, events: afterEvents, lifecycleLog: log,
        screenshots: [shotBefore, vmHome, vmScreenshot('home-relaunch-3-after'), screenshot('home-relaunch-3-after-page')],
    });

    // 2. HOME, then OK on the launcher: the highlighted tile is another full-screen app, which covers
    // this one for real (visibilitychange, document.hidden). The system takes the focus and the
    // scroll while the app is behind (the emulator does not do that by itself: the step takes them away
    // over CDP, which proves the restore, not that the system drops the focus); the relaunch must bring everything back.
    remote('OK');
    await sleep(3500);
    const covered = state();
    const vmCovered = vmScreenshot('background-1-covered-by-other-app');
    const logCovered = lifecycleLog();
    evaluate("if (document.activeElement) document.activeElement.blur(); Array.prototype.forEach.call(document.querySelectorAll('*'), function (e) { if (e.scrollTop > 0) e.scrollTop = 0; }); return true;");
    const lost = state();
    record('background-visibilitychange', {
        ok: covered.hidden === true && !!lastOf(logCovered, 'background') && lastOf(logCovered, 'background').reason === 'visibilitychange',
        note: `document.hidden=${covered.hidden}`,
        covered, lost, lifecycleLog: logCovered, events: events(), screenshots: [vmCovered],
    });
    relaunch();
    await sleep(3500);
    const recovered = state();
    const logRecovered = lifecycleLog();
    record('background-relaunch-restores', {
        ok: recovered.hidden === false && recovered.hash === before.hash && recovered.focus === before.focus && same(recovered.scrolls, before.scrolls) &&
            !!lastOf(logRecovered, 'foreground') && !!lastOf(logRecovered, 'relaunch') && lastOf(logRecovered, 'relaunch').activated === true,
        note: `${lost.focus} -> ${recovered.focus}`,
        before, lost, recovered, lifecycleLog: logRecovered, events: events(),
        screenshots: [vmScreenshot('background-2-relaunched'), screenshot('background-2-relaunched-page')],
    });

    // 3. Deep link in the relaunch parameters
    relaunch({ contentTarget: 'stremio:///settings' });
    await sleep(3000);
    const deep = state();
    record('deep-link', { ok: deep.hash === '#/settings', note: deep.hash, state: deep, relaunch: lastOf(lifecycleLog(), 'relaunch'), screenshots: [screenshot('deep-link-settings')] });
    relaunch({ contentTarget: 'https://example.com/' });
    await sleep(2500);
    const outside = state();
    record('deep-link-outside-app', { ok: outside.hash === '#/settings', note: outside.hash, state: outside, relaunch: lastOf(lifecycleLog(), 'relaunch') });
    // The query string never reaches the route: ?streamingServerUrl= would save and activate a streaming server.
    relaunch({ contentTarget: '/discover?streamingServerUrl=http%3A%2F%2F127.0.0.1%3A12345%2F' });
    await sleep(3000);
    const query = state();
    record('deep-link-query-dropped', { ok: query.hash === '#/discover', note: query.hash, state: query, relaunch: lastOf(lifecycleLog(), 'relaunch') });
    relaunch({ contentTarget: '/addons?addon=https%3A%2F%2Fevil.example%2Fmanifest.json' });
    await sleep(3000);
    const addon = state();
    record('deep-link-addon-query-dropped', { ok: addon.hash === '#/addons', note: addon.hash, state: addon, relaunch: lastOf(lifecycleLog(), 'relaunch') });
    relaunch({ contentTarget: 'stremio:///detail/movie/tt0111161' });
    await sleep(3500);
    const detail = state();
    record('deep-link-detail', { ok: detail.hash === '#/detail/movie/tt0111161', note: detail.hash, state: detail, screenshots: [screenshot('deep-link-detail')] });

    // 4. visibilitychange with a real <video> (one media scenario per boot: last)
    const server = spawn('node', ['webos/tools/media-server.mjs', MEDIA_DIR, String(MEDIA_PORT)], { cwd: REPO, stdio: 'ignore' });
    try {
        await sleep(800);
        evaluate(`
            var video = document.createElement('video');
            video.id = 'f33-video';
            video.style.cssText = 'position:fixed;right:40px;bottom:40px;width:480px;height:270px;z-index:99999;background:#000';
            video.loop = true;
            video.src = 'http://10.0.2.2:${MEDIA_PORT}/t1_h264_aac.mp4';
            document.body.appendChild(video);
            video.play();
            window.__f33.mediaEvents = [];
            ['play', 'pause', 'playing'].forEach(function (type) { video.addEventListener(type, function () { window.__f33.mediaEvents.push({ time: Date.now(), type: type, hidden: document.hidden }); }); });
            return true;
        `);
        const playing = await waitFor("var v = document.getElementById('f33-video'); return !v.paused && v.currentTime > 0.5;", 30000);
        const playingState = evaluate("var v = document.getElementById('f33-video'); return { paused: v.paused, currentTime: v.currentTime, readyState: v.readyState };");
        record('hidden-playing', { ok: playing !== null, state: playingState, screenshots: [screenshot('hidden-1-playing')] });
        if (playing !== null) {
            // HOME only opens the launcher bar over the app: the video keeps playing under it.
            remote('HOME');
            await sleep(3000);
            const underBar = evaluate("var v = document.getElementById('f33-video'); return { paused: v.paused, currentTime: v.currentTime, hidden: document.hidden, hasFocus: document.hasFocus() };");
            const vmBar = vmScreenshot('hidden-2-home-bar-playing');
            // OK on the launcher opens another full-screen app: this one is hidden for real.
            remote('OK');
            await sleep(3500);
            const pausedState = evaluate("var v = document.getElementById('f33-video'); return { paused: v.paused, currentTime: v.currentTime, hidden: document.hidden };");
            const backgroundEntry = lastOf(lifecycleLog(), 'background');
            const vmHidden = vmScreenshot('hidden-3-other-app');
            relaunch();
            await sleep(3500);
            const visibleState = evaluate("var v = document.getElementById('f33-video'); return { paused: v.paused, currentTime: v.currentTime, hidden: document.hidden };");
            await sleep(4000);
            const settledState = evaluate("var v = document.getElementById('f33-video'); return { paused: v.paused, currentTime: v.currentTime, hidden: document.hidden };");
            record('hidden-pauses-and-stays-paused', {
                ok: underBar.paused === false && pausedState.paused === true && pausedState.hidden === true && !!backgroundEntry &&
                    visibleState.paused === true && visibleState.hidden === false && settledState.paused === true,
                note: `under the HOME bar: paused=${underBar.paused}; hidden: paused=${pausedState.paused}; after relaunch: paused=${visibleState.paused}, 4 s later: paused=${settledState.paused}`,
                underBar, pausedState, backgroundEntry, visibleState, settledState, mediaEvents: evaluate('return window.__f33.mediaEvents;'), lifecycleLog: lifecycleLog(),
                screenshots: [vmBar, vmHidden, vmScreenshot('hidden-4-relaunched'), screenshot('hidden-4-relaunched-page')],
            });
        }
    } finally {
        server.kill();
    }

    fs.writeFileSync(path.join(OUT, 'lifecycle-emulator.json'), JSON.stringify({ app: APP_ID, device: DEVICE, seconds: Math.round((Date.now() - started) / 1000), steps }, null, 2));
    const failed = steps.filter((step) => step.ok === false);
    console.log(failed.length === 0 ? `\nTudo certo (${steps.length} passos)` : `\n${failed.length} passo(s) falharam: ${failed.map((step) => step.name).join(', ')}`);
    process.exitCode = failed.length === 0 ? 0 : 1;
};

main().catch((error) => {
    fs.writeFileSync(path.join(OUT, 'lifecycle-emulator.json'), JSON.stringify({ app: APP_ID, device: DEVICE, error: String(error), steps }, null, 2));
    console.error(error);
    process.exit(1);
});
