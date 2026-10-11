#!/usr/bin/env node
// Modals, popups and menus with the remote on the emulator (F4.3): real keys (webos/tools/remote.mjs)
// on the packaged app, with the state read over CDP after each press. Run from the repo root, inside
// an emu-run reservation, after `pnpm webos:package`:
//   webos/tools/emu-run --timeout 15 -- node webos/tests/modals/emulator/run.mjs <out-dir> [menus|player|pointer]
// Writes <out-dir>/modals-<scenario>.json (every step) and screenshots. <out-dir> must be under $HOME
// (the VM screenshots are written by QEMU, in a flatpak).
// Scenarios (one per emu-run: the emulator only plays the first media after a boot):
// - menus (default): the profile popup, the Discover dropdown, the add-addon modal, the Settings
//   dropdown and the episode context menu (YELLOW), each: the focus enters, ten arrows keep it inside,
//   Back closes it and gives the focus back to what opened it;
// - player: the Player context menu (YELLOW) and the audio menu, Back closes each one, the playback
//   goes on at 1x, and the Back that leaves the Player (this also replaces the speed menu step of
//   webos/tests/back, which the speed removal of F5.1 made impossible: see README of webos/lib/navigation);
// - pointer: the Magic Remote long press (trusted mouse events over CDP Input.dispatchMouseEvent).
import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] || 'modals-emulator');
const SCENARIO = process.argv[3] || 'menus';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', '..');
const APP_ID = 'io.github.gabrielsflores.stremio';
const DEVICE = process.env.EMU_DEVICE;
const CDP_PORT = process.env.EMU_CDP_PORT;
const REMOTE_PORT = process.env.EMU_REMOTE_PORT;
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
const shot = (name) => {
    const file = path.join(OUT, `${name}.png`);
    try {
        cdp('screenshot', file);
        return path.basename(file);
    } catch (error) {
        return `failed: ${error.message.split('\n')[0]}`;
    }
};

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

const PAGE_HELPERS = `
    if (!window.__f43) {
        window.__f43 = {};
        window.__f43.describe = function (element) {
            if (!element) return null;
            if (element === document.body) return 'body';
            return element.tagName.toLowerCase() + (typeof element.className === 'string' && element.className ? '.' + element.className.trim().split(/\\s+/).slice(0, 2).join('.') : '') +
                (element.textContent ? ' "' + element.textContent.trim().slice(0, 28) + '"' : '');
        };
        window.__f43.visible = function (element) {
            var style = getComputedStyle(element);
            var rect = element.getBoundingClientRect();
            if (style.display === 'none' || style.visibility === 'hidden' || (rect.width === 0 && rect.height === 0)) return false;
            var hit = document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
            return hit === element || element.contains(hit);
        };
        // The overlay the manager tracks, where the focus is, and what else could take it.
        window.__f43.state = function () {
            var manager = window.__webosModalFocus;
            var root = manager ? manager.current : null;
            var active = document.activeElement;
            var behind = root ? Array.prototype.filter.call(document.querySelectorAll('*'), function (element) {
                return element.tabIndex >= 0 && !element.disabled && !root.contains(element) && window.__f43.visible(element);
            }).length : null;
            return {
                hash: location.hash,
                idx: window.history.state ? window.history.state.idx : null,
                managerInstalled: !!manager,
                overlay: root ? window.__f43.describe(root).slice(0, 60) : null,
                focused: window.__f43.describe(active),
                inside: root ? root.contains(active) : null,
                reachableBehind: behind,
                keyboardVisible: !!(window.PalmSystem && window.PalmSystem.isKeyboardVisible),
                exitDialog: !!document.getElementById('webos-exit-dialog-title'),
                trace: manager ? manager.history.slice(-6).map(function (entry) { return entry.what + ': ' + entry.detail; }) : null,
                lastBack: window.__webosBack && window.__webosBack.history.length ? window.__webosBack.history[window.__webosBack.history.length - 1] : null,
            };
        };
    }
    return true;
`;
const state = () => evaluate('return window.__f43.state();');

const APP_ENV = { ...process.env, WEBOS_DEVICE: DEVICE };
const runningApps = () => {
    let output = '';
    try {
        output = run('ares-launch', ['--device', DEVICE, '--running']);
    } catch (error) {
        output = String(error.stdout || '');
    }
    return output.split('\n').map((line) => line.trim()).filter((line) => /^[a-z0-9]+(\.[a-z0-9-]+)+$/i.test(line));
};

const boot = async () => {
    console.log(run('webos/scripts/ares.sh', ['install'], { env: APP_ENV }).trim());
    console.log(run('webos/scripts/ares.sh', ['launch'], { env: APP_ENV }).trim());
    const boardReady = `
        ${PAGE_HELPERS}
        return location.hash.length <= 2 && document.querySelectorAll('a[href^="#/detail/"]').length > 0 && !!document.querySelector('a[href="#/discover"]') && !!document.querySelector('[class*="menu-button-container"]') && !!window.__webosBack && !!window.__webosModalFocus;
    `;
    let boardMs = await waitFor(boardReady, 240000, 2000);
    runningApps().filter((id) => id !== APP_ID).forEach((id) => {
        try {
            run('ares-launch', ['--device', DEVICE, '--close', id]);
        } catch {
            // system apps may refuse to close
        }
    });
    // Bringing the app to the front again may restart the page, a few seconds later: mark this page and
    // wait for the mark to go away (or for 25 s, when no restart comes) before looking at the Board.
    evaluate('window.__f43Marker = true; return true;');
    run('webos/scripts/ares.sh', ['launch'], { env: APP_ENV });
    await waitFor('return !window.__f43Marker;', 25000, 1000);
    const focusMs = await waitFor('return document.hasFocus();', 20000);
    // Bringing the app to the front again may restart the page: wait for the Board once more.
    await sleep(3000);
    boardMs = await waitFor(boardReady, 120000, 2000) === null ? null : boardMs;
    record('app-focused', { ok: focusMs !== null });
    record('board-loaded', { ok: boardMs !== null, state: boardMs === null ? undefined : state() });
    shot('00-board');
    return boardMs !== null;
};

const click = (expression) => evaluate(`var element = ${expression}; if (!element) return false; element.click(); return true;`) === true;

// Clicks the first element that matches, after focusing it: what OK on a focused element does.
const activate = (name, selectorExpression) => {
    const result = evaluate(`
        var element = ${selectorExpression};
        if (!element) return 'not found';
        element.focus();
        element.click();
        return window.__f43.describe(element);
    `);
    record(name, { note: String(result), ok: result !== 'not found' });
    return result !== 'not found' ? result : null;
};

const ARROWS = ['DOWN', 'DOWN', 'UP', 'UP', 'LEFT', 'RIGHT', 'RIGHT', 'DOWN', 'DOWN', 'DOWN'];

// The full life of an overlay with the remote, after `open` (a function that opens it).
//   enters: the focus is inside it; stays: after each of ten arrows it still is, and the page behind
//   kept its route; closes: Back removes it, once, without leaving the route; returns: the focus is
//   back where it was before the overlay (`origin`).
const overlayLife = async (name, open, { settleMs = 1500, backDispatches = 1, focus = null, enterTimeoutMs = 10000 } = {}) => {
    // The element the remote is on when the overlay opens (it gets the focus back at the end).
    if (focus && evaluate(`var element = ${focus}; if (!element) return false; element.focus(); return true;`) !== true) {
        record(`${name}-focus-origin`, { ok: false, note: `not found: ${focus}` });
        return false;
    }
    const origin = state();
    const opened = await open();
    if (!opened) return false;
    await sleep(settleMs);
    // The content of some overlays (the profile menu reads the core) can take a while on a loaded VM;
    // the focus enters as soon as it is there.
    const waited = await waitFor('var s = window.__f43.state(); return s.overlay !== null && s.inside === true;', enterTimeoutMs, 250);
    const entered = state();
    record(`${name}-opened`, {
        ok: entered.overlay !== null && entered.inside === true,
        note: `${entered.overlay} | focus ${entered.focused} | reachable behind: ${entered.reachableBehind}${waited ? ` | focus entered ${waited} ms after the settle time` : ''}`,
        state: entered,
        screenshot: shot(`${name}-opened`),
    });
    if (entered.overlay === null) return false;
    const trail = [];
    let outside = 0;
    for (const arrow of ARROWS) {
        remote(arrow);
        await sleep(450);
        const now = state();
        trail.push(`${arrow}: ${now.focused}`);
        if (now.inside !== true) outside++;
    }
    const after = state();
    record(`${name}-arrows`, {
        ok: outside === 0 && after.hash === entered.hash,
        note: outside === 0 ? 'focus stayed inside for all 10 arrows' : `${outside} arrows left the overlay`,
        trail,
        state: after,
        screenshot: shot(`${name}-after-arrows`),
    });
    if (after.keyboardVisible) {
        // A text field got the focus again: the system takes this Back to hide its keyboard.
        remote('BACK');
        await sleep(2500);
    }
    const backsBefore = evaluate('return window.__webosBack.keyEvents.keydown;');
    remote('BACK');
    await sleep(1500);
    const closed = state();
    const backsAfter = evaluate('return window.__webosBack.keyEvents.keydown;');
    record(`${name}-back`, {
        ok: closed.overlay === null && backsAfter - backsBefore === backDispatches && closed.hash === entered.hash && !closed.exitDialog,
        note: `overlay ${closed.overlay}, ${backsAfter - backsBefore} Back keydown(s), consumed by ${closed.lastBack && closed.lastBack.consumedBy}${closed.lastBack && closed.lastBack.detail ? ` (${closed.lastBack.detail})` : ''}`,
        state: closed,
        screenshot: shot(`${name}-closed`),
    });
    record(`${name}-focus-returns`, {
        ok: closed.focused === origin.focused || (origin.focused === 'body' && closed.focused !== null),
        note: `before: ${origin.focused} | after: ${closed.focused}`,
    });
    return true;
};

const goTo = async (name, linkSelector, readyExpression) => {
    if (!activate(`${name}-open-route`, `document.querySelector('${linkSelector}')`)) return false;
    const ms = await waitFor(readyExpression, 60000, 1000);
    record(`${name}-route-ready`, { ok: ms !== null, state: state() });
    await sleep(1500);
    return ms !== null;
};

const menusScenario = async () => {
    // Profile popup (Popup, non-portal) on the Board.
    const profile = 'document.querySelector(\'[class*="menu-button-container"]\')';
    await overlayLife('profile-popup', async () => click(profile), { settleMs: 1200, focus: profile, enterTimeoutMs: 40000 });

    // Discover: a Multiselect dropdown.
    if (await goTo('discover', 'a[href="#/discover"]', 'return location.hash.indexOf("#/discover") === 0 && document.querySelectorAll(\'[aria-haspopup="listbox"]\').length > 0;')) {
        const dropdown = 'document.querySelector(\'[aria-haspopup="listbox"]\')';
        await overlayLife('discover-dropdown', async () => click(dropdown), { focus: dropdown });
        // OK on an option of a dropdown without portal: the focus must not fall on the body.
        evaluate(`var element = ${dropdown}; element.focus(); element.click(); return true;`);
        await sleep(1500);
        remote('DOWN');
        await sleep(600);
        remote('OK');
        await sleep(2500);
        const chosen = state();
        record('discover-dropdown-ok-keeps-focus', { ok: chosen.overlay === null && chosen.focused !== 'body' && chosen.focused !== null, note: `after OK on an option: focus ${chosen.focused}`, state: chosen, screenshot: shot('discover-dropdown-ok') });
        remote('BACK');
        await sleep(1500);
    }

    // Addons: the add-addon modal (ModalDialog). Its URL field has autofocus: the system keyboard hides on
    // the first Back and the page gets no key (0 dispatches); the next one closes the modal.
    if (await goTo('addons', 'a[href="#/addons"]', 'return location.hash.indexOf("#/addons") === 0;')) {
        const addButton = 'document.querySelector(\'[class*="add-button-container"]\')';
        await overlayLife('addon-modal', async () => {
            if (!click(addButton)) return false;
            await sleep(2000);
            const kb = state();
            record('addon-modal-keyboard', { note: `keyboard visible: ${kb.keyboardVisible}`, state: kb });
            if (kb.keyboardVisible) {
                remote('BACK');
                await sleep(2500);
            }
            return true;
        }, { settleMs: 500, focus: addButton });
        remote('BACK');
        await sleep(1500);
    }

    // Settings: a Multiselect with portal.
    if (await goTo('settings', 'a[href="#/settings"]', 'return location.hash.indexOf("#/settings") === 0 && document.querySelectorAll(\'[aria-haspopup="listbox"]\').length > 0;')) {
        const dropdown = 'document.querySelector(\'[aria-haspopup="listbox"]\')';
        await overlayLife('settings-dropdown', async () => click(dropdown), { focus: dropdown });
    }

    // A series: the episode menu (right click upstream) with YELLOW on the focused episode.
    evaluate('location.hash = "#/"; return true;');
    await waitFor('return location.hash === "#/" && document.querySelectorAll(\'a[href^="#/detail/series/"]\').length > 0;', 60000, 1000);
    const series = evaluate('var a = document.querySelector(\'a[href^="#/detail/series/"]\'); return a && a.getAttribute("href");');
    if (series && await goTo('series', `a[href="${series}"]`, 'return document.querySelectorAll(\'[class*="video-container"][class*="label-container"]\').length > 0;')) {
        const episode = 'document.querySelector(\'[class*="video-container"][class*="label-container"]\')';
        await overlayLife('episode-menu', async () => {
            remote('YELLOW');
            return true;
        }, { focus: episode });
    }
};

// ----- pointer (Magic Remote long press) -----
const mouse = async (events) => {
    const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
    const target = targets.find((entry) => (entry.url + entry.title).indexOf(APP_ID) !== -1);
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        socket.onopen = resolve;
        socket.onerror = reject;
    });
    let id = 0;
    const send = (method, params) => new Promise((resolve) => {
        const mine = ++id;
        const onMessage = (message) => {
            if (JSON.parse(message.data).id === mine) {
                socket.removeEventListener('message', onMessage);
                resolve();
            }
        };
        socket.addEventListener('message', onMessage);
        socket.send(JSON.stringify({ id: mine, method, params }));
    });
    for (const event of events) {
        if (event.wait) await sleep(event.wait);
        else await send('Input.dispatchMouseEvent', { button: 'left', clickCount: 1, ...event });
    }
    socket.close();
};

// ----- player -----
const MEDIA_FILE = process.env.MEDIA_FILE || path.join(process.env.HOME, 'webos-tv-sdk', 'run', 'f16-media', 'longo_h264_aac.mp4');
const videoState = () => evaluate(`
    var video = document.querySelector('video');
    return video ? { time: Math.round(video.currentTime * 10) / 10, rate: video.playbackRate, paused: video.paused, readyState: video.readyState } : null;
`);
const freePort = () => new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
        const { port } = probe.address();
        probe.close(() => resolve(port));
    });
});

const playerScenario = async () => {
    const port = await freePort();
    const log = fs.openSync(path.join(OUT, 'media-server.log'), 'w');
    const server = spawn('node', ['webos/tools/media-server.mjs', path.dirname(MEDIA_FILE), String(port)], { cwd: REPO, stdio: ['ignore', log, log] });
    try {
        let serving = false;
        for (let i = 0; i < 20 && !serving; i++) {
            await sleep(500);
            serving = await fetch(`http://127.0.0.1:${port}/${path.basename(MEDIA_FILE)}`, { method: 'HEAD' }).then((response) => response.ok, () => false);
        }
        record('P00-media-server', { ok: serving, note: `port ${port}` });
        if (!serving) return;
        const stream = zlib.deflateSync(Buffer.from(JSON.stringify({ url: `http://10.0.2.2:${port}/${path.basename(MEDIA_FILE)}`, name: '', description: '' })), { level: 0 }).toString('base64');
        evaluate(`
            var idx = window.history.state && typeof window.history.state.idx === 'number' ? window.history.state.idx + 1 : 1;
            var state = { usr: null, key: 'f43player', idx: idx };
            window.history.pushState(state, '', ${JSON.stringify(`#/player/${encodeURIComponent(stream)}`)});
            window.dispatchEvent(new PopStateEvent('popstate', { state: state }));
            return true;
        `);
        const playingMs = await waitFor('var video = document.querySelector("video"); return !!video && video.readyState >= 3 && video.currentTime > 1;', 90000, 1000);
        record('P01-player-playing', { ok: playingMs !== null, data: videoState(), screenshot: shot('P01-player') });
        if (playingMs === null) return;

        // Magic Remote: hold the pointer still on the seek bar for 0.9 s, then drag. The long press must not
        // send a right click there (its mouseup would end the Slider's drag): the drag goes on and seeks.
        const seek = () => evaluate(`var s = document.querySelector('[class*="seek-bar-container"] [class*="slider-container"]') || document.querySelector('[class*="slider-container"]');
            if (!s) return null; var r = s.getBoundingClientRect(); return { x0: Math.round(r.left), x1: Math.round(r.right), y: Math.round((r.top + r.bottom) / 2) };`);
        await mouse([{ type: 'mouseMoved', x: 600, y: 500, button: 'none' }, { wait: 800 }]);
        const bar = seek();
        record('P01b-seek-bar', { ok: !!bar, note: JSON.stringify(bar) });
        if (bar) {
            const at = (p) => Math.round(bar.x0 + (bar.x1 - bar.x0) * p);
            await mouse([
                { type: 'mouseMoved', x: at(0.2), y: bar.y, button: 'none' }, { type: 'mousePressed', x: at(0.2), y: bar.y }, { wait: 900 },
                { type: 'mouseMoved', x: at(0.3), y: bar.y }, { wait: 100 }, { type: 'mouseMoved', x: at(0.4), y: bar.y }, { wait: 100 },
            ]);
            const during = evaluate('return { active: document.documentElement.className.indexOf("active-slider-within") !== -1, menus: document.querySelectorAll(\'body > [class*="context-menu-container"]\').length };');
            await mouse([{ type: 'mouseReleased', x: at(0.4), y: bar.y }]);
            await sleep(2500);
            const seeked = evaluate('var v = document.querySelector("video"); return { t: Math.round(v.currentTime * 10) / 10, d: Math.round(v.duration * 10) / 10 };');
            record('P01c-hold-then-drag-on-slider', {
                ok: during.active && during.menus === 0 && Math.abs(seeked.t - seeked.d * 0.4) < seeked.d * 0.1,
                note: `during the drag: slider active ${during.active}, context menus ${during.menus}; t=${seeked.t}/${seeked.d} (expected ~${Math.round(seeked.d * 0.4)})`,
                data: { during, seeked },
                screenshot: shot('P01c-hold-then-drag'),
            });
        }

        // Context menu of the Player with the remote: YELLOW (nothing is focused, the video takes it).
        await overlayLife('player-context-menu', async () => {
            remote('YELLOW');
            return true;
        });
        await sleep(1000);
        const afterContext = videoState();
        record('P02-playback-after-context-menu', { ok: afterContext.rate === 1 && !afterContext.paused, data: afterContext });

        // Audio menu (shortcut `a`; the control bar is not reachable by arrows yet).
        await overlayLife('player-audio-menu', async () => {
            evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", code: "KeyA", keyCode: 65, bubbles: true })); return true;');
            return true;
        });
        await sleep(1000);
        const afterAudio = videoState();
        record('P03-playback-after-audio-menu', { ok: afterAudio.rate === 1 && !afterAudio.paused, data: afterAudio });

        // The speed menu does not exist on webOS (F5.1 removed it; useVideo.webos.js reports no speed
        // control): its shortcut does nothing and no layer opens, which is what the roteiro of F3.2 now expects.
        evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "r", code: "KeyR", keyCode: 82, bubbles: true })); return true;');
        await sleep(800);
        const layers = evaluate('return document.querySelectorAll(\'[class^="menu-layer-"], [class*=" menu-layer-"]\').length;');
        record('P04-speed-menu-absent', { ok: layers === 0, note: `menu layers: ${layers}` });

        const before = state();
        remote('BACK');
        await sleep(2500);
        const left = state();
        record('P05-player-back-leaves', { ok: left.hash.indexOf('#/player') !== 0 && left.idx === before.idx - 1 && !left.exitDialog, state: left });
    } finally {
        server.kill();
    }
};

const pointerScenario = async () => {
    await waitFor('return document.querySelectorAll(\'a[href^="#/detail/series/"]\').length > 0;', 60000, 1000);
    const series = evaluate('var a = document.querySelector(\'a[href^="#/detail/series/"]\'); return a && a.getAttribute("href");');
    if (!series) return record('X00-series', { ok: false, note: 'no series on the Board' });
    if (!await goTo('series', `a[href="${series}"]`, 'return document.querySelectorAll(\'[class*="video-container"][class*="label-container"]\').length > 0;')) return;
    const center = evaluate(`
        var rect = document.querySelector('[class*="video-container"][class*="label-container"]').getBoundingClientRect();
        window.__f43.clicks = 0;
        document.addEventListener('click', function () { window.__f43.clicks++; }, true);
        return { x: Math.round((rect.left + rect.right) / 2), y: Math.round((rect.top + rect.bottom) / 2) };
    `);
    const hash = evaluate('return location.hash;');
    // A short press is a click: it opens the streams of the episode.
    // First the long press: ~0.9 s without moving, then the release.
    await mouse([
        { type: 'mouseMoved', x: center.x, y: center.y },
        { type: 'mousePressed', x: center.x, y: center.y },
        { wait: 1000 },
    ]);
    const held = state();
    const menuOpen = evaluate('return document.querySelectorAll(\'.active > [class*="menu-container"]\').length;');
    record('X01-long-press-opens-menu', { ok: menuOpen === 1, note: `menus: ${menuOpen} | focus ${held.focused}`, state: held, screenshot: shot('X01-long-press') });
    await mouse([{ type: 'mouseReleased', x: center.x, y: center.y }]);
    await sleep(800);
    const clicks = evaluate('return window.__f43.clicks;');
    record('X02-release-does-not-click', { ok: clicks === 0 && evaluate('return location.hash;') === hash, note: `trusted clicks seen by the page: ${clicks}` });
    // Pointer mode left the focus alone; the first arrow brings it into the menu without moving past its first item.
    remote('DOWN');
    await sleep(800);
    const entered = state();
    record('X03-first-arrow-enters-menu', { ok: entered.inside === true && /Watch/.test(entered.focused), note: entered.focused, state: entered, screenshot: shot('X03-arrow-enters') });
    remote('BACK');
    await sleep(1500);
    const closed = state();
    record('X04-back-closes-menu', { ok: closed.overlay === null && closed.hash === hash, state: closed });
};

const SCENARIOS = { menus: menusScenario, player: playerScenario, pointer: pointerScenario };

try {
    if (!SCENARIOS[SCENARIO]) throw new Error(`unknown scenario ${SCENARIO}`);
    if (await boot()) await SCENARIOS[SCENARIO]();
} catch (error) {
    record('error', { ok: false, note: error.message });
}
const failed = steps.filter((step) => step.ok === false);
fs.writeFileSync(path.join(OUT, `modals-${SCENARIO}.json`), JSON.stringify({ date: new Date().toISOString(), failed: failed.map((step) => step.name), steps }, null, 2));
console.log(`\n${steps.filter((step) => step.ok === true).length} ok, ${failed.length} falharam -> ${path.join(OUT, `modals-${SCENARIO}.json`)}`);
process.exit(failed.length === 0 ? 0 : 1);
