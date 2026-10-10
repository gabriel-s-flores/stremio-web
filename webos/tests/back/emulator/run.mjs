#!/usr/bin/env node
// Back key on the emulator (F3.2): real remote keys (webos/tools/remote.mjs, port 19001) on the
// packaged app, with the state read over CDP after each press. Run from the repo root, inside an
// emu-run reservation, after `pnpm webos:package`:
//   webos/tools/emu-run --timeout 15 -- node webos/tests/back/emulator/run.mjs <out-dir> [navigation|player]
// Writes <out-dir>/back-<scenario>.json (every step with its state before and after) and screenshots.
// The output folder must be under $HOME (the VM screenshots are written by QEMU, in a flatpak).
// Scenarios (one per emu-run: the emulator only plays the first media after a boot):
// - navigation (default): Board, quit dialog, dropdown, popup, MetaDetails, modal, keyboard, quit;
// - player: a video served from the host (webos/tools/media-server.mjs, $MEDIA_FILE, by default
//   ~/webos-tv-sdk/run/f16-media/longo_h264_aac.mp4, 90 s), its speed menu and its context menu
//   closed by Back with the playback rate checked, then Back out of the Player.
//
// Navigation between screens is done the way the remote would trigger it (clicks on the app's own
// links and buttons over CDP, so react-router pushes history entries); every Back is a real key.
// "No double navigation" is checked on each press: exactly one dispatch in window.__webosBack, the
// expected route, history.state.idx and the number of popstate events (WebAppMgr must not go back
// on its own: disableBackHistoryAPI).
import { execFileSync, spawn } from 'node:child_process';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] || 'back-emulator');
const SCENARIO = process.argv[3] || 'navigation';
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
const screenshot = (name) => {
    const file = path.join(OUT, `${name}.png`);
    try {
        cdp('screenshot', file);
        return path.basename(file);
    } catch (error) {
        return `failed: ${error.message.split('\n')[0]}`;
    }
};

// The whole screen of the VM (the system keyboard is not part of the page screenshot).
const vmScreenshot = (name) => {
    const file = path.join(OUT, `${name}-vm.png`);
    try {
        // QEMU runs inside a flatpak with its own /tmp: the output folder must be under $HOME.
        const result = run('python3', ['webos/tools/qmp.py', 'screendump', file]);
        return fs.existsSync(file) ? path.basename(file) : `failed: ${result.trim()}`;
    } catch (error) {
        return `failed: ${error.message.split('\n')[0]}`;
    }
};

const runningApps = () => {
    let output = '';
    try {
        output = run('ares-launch', ['--device', DEVICE, '--running']);
    } catch (error) {
        output = String(error.stdout || '');
    }
    return output.split('\n').map((line) => line.trim()).filter((line) => /^[a-z0-9]+(\.[a-z0-9-]+)+$/i.test(line));
};

const closeOtherApps = () => {
    const others = runningApps().filter((id) => id !== APP_ID);
    others.forEach((id) => {
        try {
            run('ares-launch', ['--device', DEVICE, '--close', id]);
        } catch {
            // system apps may refuse to close
        }
    });
    return others;
};

// Page helpers, injected once (ES2015 for Chromium 53).
const PAGE_HELPERS = `
    if (!window.__f32) {
        window.__f32 = { popstates: 0 };
        window.addEventListener('popstate', function () { window.__f32.popstates++; });
        window.__f32.keyboardEvents = [];
        document.addEventListener('keyboardStateChange', function (event) {
            window.__f32.keyboardEvents.push({ time: Date.now(), visibility: event.detail && event.detail.visibility });
        });
    }
    window.__f32.sel = function (prefix) { return '[class^="' + prefix + '-"], [class*=" ' + prefix + '-"]'; };
    window.__f32.describe = function (element) {
        if (!element) return null;
        if (element === document.body) return 'body';
        return element.tagName.toLowerCase() + (element.id ? '#' + element.id : '') +
            (typeof element.className === 'string' && element.className ? '.' + element.className.trim().split(/\\s+/).slice(0, 3).join('.') : '') +
            (element.textContent ? ' "' + element.textContent.trim().slice(0, 30) + '"' : '');
    };
    window.__f32.state = function () {
        var back = window.__webosBack;
        var history = back ? back.history : [];
        var route = document.querySelector('.routes-container > .route-container:last-child');
        return {
            hash: location.hash,
            idx: window.history.state ? window.history.state.idx : null,
            historyLength: window.history.length,
            popstates: window.__f32.popstates,
            dispatches: history.length,
            backKeyEvents: back ? back.keyEvents : null,
            keyboardEvents: window.__f32.keyboardEvents.length,
            lastKeyboardEvent: window.__f32.keyboardEvents.length ? window.__f32.keyboardEvents[window.__f32.keyboardEvents.length - 1].visibility : null,
            lastDispatch: history.length ? history[history.length - 1] : null,
            exitDialog: !!document.getElementById('webos-exit-dialog-title'),
            modals: route ? route.querySelectorAll('.modals-container > .modal-container').length : 0,
            expanded: document.querySelectorAll('[aria-expanded="true"]').length,
            activePopups: document.querySelectorAll('.active > ' + window.__f32.sel('menu-container').split(', ').join(', .active > ')).length,
            keyboardVisible: !!(window.PalmSystem && window.PalmSystem.isKeyboardVisible),
            focused: window.__f32.describe(document.activeElement),
        };
    };
    return true;
`;
const state = () => evaluate('return window.__f32.state();');
// The app opens without a hash; going back to that first entry leaves the hash empty.
const onBoard = (hash) => hash === '#/' || hash === '';

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

// One real Back press, then the state once things settle. `expect` gets (before, after).
// `dispatches` is how many presses the page must dispatch: 1, or 0 when the system takes the key
// (the virtual keyboard hides itself on Back and the page gets no key event).
const back = async (name, expectFn, { settleMs = 1200, shot = true, vm = false, dispatches = 1 } = {}) => {
    if (evaluate('return document.hasFocus();') !== true) {
        record(`${name}-focus-lost`, { ok: false, note: `running: ${runningApps().join(', ')}`, vmScreenshot: vmScreenshot(`${name}-focus-lost`) });
        closeOtherApps();
        run('webos/scripts/ares.sh', ['launch'], { env: { ...process.env, WEBOS_DEVICE: DEVICE } });
        await waitFor('return document.hasFocus();', 10000);
    }
    const before = state();
    const vmBefore = vm ? vmScreenshot(`${name}-before`) : undefined;
    remote('BACK');
    await sleep(settleMs);
    const after = state();
    const vmAfter = vm ? vmScreenshot(name) : undefined;
    const dispatched = after.backKeyEvents.keydown - before.backKeyEvents.keydown;
    const problems = [];
    if (dispatched !== dispatches) problems.push(`Back keydowns ${dispatched}, expected ${dispatches}`);
    const expectation = expectFn(before, after);
    Object.entries(expectation).forEach(([key, ok]) => {
        if (!ok) problems.push(key);
    });
    record(name, {
        ok: problems.length === 0,
        note: problems.join('; '),
        before,
        after,
        screenshot: shot ? screenshot(name) : undefined,
        vmScreenshots: vm ? [vmBefore, vmAfter] : undefined,
    });
    return after;
};

// Clicks the first element matching the selector, the way OK on a focused element does.
const click = (name, selectorExpression) => {
    const result = evaluate(`
        var element = ${selectorExpression};
        if (!element) return 'not found';
        element.focus && element.focus();
        element.click();
        return window.__f32.describe(element);
    `);
    record(name, { note: String(result), ok: result !== 'not found' });
    return result !== 'not found';
};

// Installs and opens the app, brings it to the front and waits for the Board.
const boot = async () => {
    const started = Date.now();
    console.log(run('webos/scripts/ares.sh', ['install'], { env: { ...process.env, WEBOS_DEVICE: DEVICE } }).trim());
    console.log(run('webos/scripts/ares.sh', ['launch'], { env: { ...process.env, WEBOS_DEVICE: DEVICE } }).trim());

    const boardMs = await waitFor(`
        ${PAGE_HELPERS}
        return document.querySelectorAll('a[href^="#/metadetails"], a[href^="#/detail/"]').length > 0 && !!window.__webosBack;
    `, 240000, 2000);
    evaluate(PAGE_HELPERS);
    // Keys from the remote go to the foreground app only. On a clean boot the emulator's Welcome
    // app opens by itself and may come to the front after ours: close every other app, then
    // launch ours again (that brings it to the front) and wait for the page to have the focus.
    const others = closeOtherApps();
    run('webos/scripts/ares.sh', ['launch'], { env: { ...process.env, WEBOS_DEVICE: DEVICE } });
    const focusMs = await waitFor('return document.hasFocus();', 20000);
    record('other-apps-closed', { note: others.join(', ') || '(none)', vmScreenshot: vmScreenshot('00-foreground') });
    record('app-focused', { ok: focusMs !== null });
    record('board-loaded', { ok: boardMs !== null, note: `${Math.round((Date.now() - started) / 1000)} s after install`, state: state() });
    if (boardMs === null) {
        record('board-dom', { dump: evaluate('return document.body.innerHTML.slice(0, 4000);') });
        return false;
    }
    await sleep(3000);
    record('environment', {
        data: evaluate(`
            var event = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape' });
            return {
                userAgent: navigator.userAgent,
                hasFocus: document.hasFocus(),
                keyboardEventKey: event.key,
                keyboardEventCode: event.code,
                webOS: typeof window.webOS,
                platformBack: !!(window.PalmSystem && window.PalmSystem.platformBack),
                handlers: window.__webosBack.handlers,
            };
        `),
    });
    screenshot('00-board');
    return true;
};

const navigationScenario = async () => {
    // 1. Root: Back opens the quit dialog, Back again closes it. No history movement.
    await back('01-board-back-opens-exit-dialog', (b, a) => ({
        'dialog open': a.exitDialog,
        'still on Board': onBoard(a.hash),
        'no popstate': a.popstates === b.popstates,
        'focus on Cancel': /button/.test(a.focused || ''),
    }));
    await back('02-exit-dialog-back-cancels', (b, a) => ({
        'dialog closed': !a.exitDialog,
        'still on Board': a.hash === b.hash,
        'no popstate': a.popstates === b.popstates,
    }), { shot: false });

    // 2. Discover with a dropdown open: Back closes the dropdown, then goes back to the Board.
    if (click('03-open-discover', 'document.querySelector(\'a[href="#/discover"]\')')) {
        await waitFor('return location.hash.indexOf("#/discover") === 0 && document.querySelectorAll(\'[aria-haspopup="listbox"]\').length > 0;', 60000);
        await sleep(1500);
        click('04-open-discover-dropdown', 'document.querySelector(\'[aria-haspopup="listbox"]\')');
        await sleep(800);
        screenshot('04-discover-dropdown-open');
        await back('05-discover-back-closes-dropdown', (b, a) => ({
            'dropdown was open': b.expanded > 0,
            'dropdown closed': a.expanded === 0,
            'still on Discover': a.hash === b.hash,
            'no popstate': a.popstates === b.popstates,
            'consumed by overlay': a.lastDispatch && a.lastDispatch.consumedBy === 'overlay',
        }));
        await back('06-discover-back-to-board', (b, a) => ({
            'on Board': onBoard(a.hash),
            'one popstate': a.popstates === b.popstates + 1,
            'one entry back': a.idx === b.idx - 1,
            'no dialog': !a.exitDialog,
        }));
    }

    // 3. Board profile menu (Popup): Back closes it and stays on the Board.
    if (click('07-open-nav-menu', 'document.querySelector(window.__f32.sel("menu-button-container"))')) {
        await sleep(800);
        await back('08-board-back-closes-nav-menu', (b, a) => ({
            'menu was open': b.activePopups > 0,
            'menu closed': a.activePopups === 0,
            'still on Board': onBoard(a.hash),
            'no dialog': !a.exitDialog,
            'no popstate': a.popstates === b.popstates,
        }));
    }

    // 4. MetaDetails opened from the Board goes back to its origin.
    const metaLinksMs = await waitFor('return document.querySelectorAll(\'a[href^="#/metadetails"], a[href^="#/detail/"]\').length > 0;', 60000, 1000);
    if (metaLinksMs === null) {
        record('09-board-links', {
            data: evaluate(`return { state: window.__f32.state(), links: Array.prototype.slice.call(document.querySelectorAll('a[href]'), 0, 30).map(function (a) { return a.getAttribute('href'); }) };`),
        });
    }
    if (click('09-open-metadetails', 'document.querySelector(\'a[href^="#/metadetails"], a[href^="#/detail/"]\')')) {
        await waitFor('return /^#\\/(metadetails|detail)\\//.test(location.hash);', 30000);
        await sleep(4000);
        screenshot('09-metadetails');
        await back('10-metadetails-back-to-board', (b, a) => ({
            'was on MetaDetails': /^#\/(metadetails|detail)\//.test(b.hash),
            'on Board': onBoard(a.hash),
            'no dialog': !a.exitDialog,
        }));
    }

    // 5. A ModalDialog: the Addons route, its "add addon" modal.
    if (click('11-open-addons', 'document.querySelector(\'a[href="#/addons"]\')')) {
        await waitFor('return location.hash.indexOf("#/addons") === 0;', 30000);
        await sleep(3000);
        record('11-addons-buttons', {
            data: evaluate(`return Array.prototype.slice.call(document.querySelectorAll('.route-container:last-child [class*="button"]'), 0, 25).map(window.__f32.describe);`),
        });
        if (click('12-open-add-addon-modal', 'document.querySelector(window.__f32.sel("add-button-container"))')) {
            await sleep(1500);
            screenshot('12-add-addon-modal');
            // The URL field has autofocus, so the system keyboard is up.
            await back('13-addons-back-system-hides-keyboard', (b, a) => ({
                'keyboard was up': b.keyboardVisible,
                'keyboard hidden (keyboardStateChange false)': a.lastKeyboardEvent === false,
                'modal still open': a.modals > 0,
                'still on Addons': a.hash.indexOf('#/addons') === 0,
                'no popstate': a.popstates === b.popstates,
            }), { settleMs: 3000, vm: true, dispatches: 0 });
            await back('14-addons-back-closes-modal', (b, a) => ({
                'modal closed': a.modals === 0,
                'consumed by overlay': a.lastDispatch && a.lastDispatch.consumedBy === 'overlay',
                'still on Addons': a.hash.indexOf('#/addons') === 0,
                'no popstate': a.popstates === b.popstates,
            }));
        }
        await back('15-addons-back-leaves', (b, a) => ({
            'left Addons': a.hash.indexOf('#/addons') !== 0,
            'no dialog': !a.exitDialog,
        }));
    }

    // 6. Search with the virtual keyboard: the system hides the keyboard on the first Back, the
    //    next one leaves the route.
    if (click('16-open-search', 'document.querySelector(window.__f32.sel("search-bar-container"))')) {
        await waitFor('return location.hash.indexOf("#/search") === 0;', 30000);
        await sleep(2000);
        click('17-focus-search-input', 'document.querySelector(".route-container:last-child input")');
        const keyboardMs = await waitFor('return !!(window.PalmSystem && window.PalmSystem.isKeyboardVisible);', 8000);
        record('17-keyboard-visible', { ok: keyboardMs !== null, note: keyboardMs === null ? 'virtual keyboard did not show up' : `${keyboardMs} ms`, screenshot: screenshot('17-search-keyboard') });
        await back('18-search-back-system-hides-keyboard', (b, a) => ({
            'keyboard was up': b.keyboardVisible,
            'keyboard hidden (keyboardStateChange false)': a.lastKeyboardEvent === false,
            'still on Search': a.hash.indexOf('#/search') === 0,
            'no popstate': a.popstates === b.popstates,
        }), { settleMs: 3000, vm: true, dispatches: 0 });
        await back('19-search-back-leaves', (b, a) => ({
            'consumed by route': a.lastDispatch && a.lastDispatch.consumedBy === 'route',
            'left Search': a.hash.indexOf('#/search') !== 0,
            'no dialog': !a.exitDialog,
        }));
    }

    // 7. Back at the Board until the dialog, then quit with RIGHT + OK on the remote.
    let current = state();
    for (let i = 0; i < 4 && !onBoard(current.hash); i++) {
        current = await back(`20-back-to-board-${i}`, () => ({}), { shot: false });
    }
    await back('21-board-back-opens-exit-dialog', (b, a) => ({ 'dialog open': a.exitDialog }));
    remote('RIGHT');
    await sleep(500);
    const focused = state().focused;
    record('22-focus-on-quit', { ok: /button/.test(focused || '') && focused.indexOf('Cancel') === -1 && focused.indexOf('Cancelar') === -1, note: focused, screenshot: screenshot('22-exit-dialog-quit-focused') });
    remote('OK');
    await sleep(4000);
    const running = runningApps().join(', ');
    let targets = '';
    try {
        targets = run('node', ['webos/tools/cdp.mjs', '--port', CDP_PORT, 'targets']);
    } catch (error) {
        targets = String(error.message);
    }
    record('23-app-closed', {
        ok: running.indexOf(APP_ID) === -1 && targets.indexOf(APP_ID) === -1,
        note: `running: ${running || '(none)'}`,
        targets: targets.trim(),
    });
};

// The Player with a real video: Back closes its menus without touching the playback, then leaves.
const MEDIA_FILE = process.env.MEDIA_FILE || path.join(process.env.HOME, 'webos-tv-sdk', 'run', 'f16-media', 'longo_h264_aac.mp4');

const videoState = () => evaluate(`
    var video = document.querySelector('video');
    return video ? { time: Math.round(video.currentTime * 10) / 10, rate: video.playbackRate, paused: video.paused, readyState: video.readyState } : null;
`);

const playerScenario = async () => {
    const port = 8120 + Number(process.env.EMU_INSTANCE || 0);
    const server = spawn('node', ['webos/tools/media-server.mjs', path.dirname(MEDIA_FILE), String(port)], { cwd: REPO, stdio: 'ignore' });
    try {
        await sleep(1000);
        // The Player route takes the stream as deflated JSON in base64 (src/routes/Player). A
        // router entry is pushed the way a link would, so Back has an entry to go back to.
        const stream = zlib.deflateSync(Buffer.from(JSON.stringify({ url: `http://10.0.2.2:${port}/${path.basename(MEDIA_FILE)}`, name: '', description: '' })), { level: 0 }).toString('base64');
        const playerHash = `#/player/${encodeURIComponent(stream)}`;
        evaluate(`
            var idx = window.history.state && typeof window.history.state.idx === 'number' ? window.history.state.idx + 1 : 1;
            var state = { usr: null, key: 'f32player', idx: idx };
            window.history.pushState(state, '', ${JSON.stringify(playerHash)});
            window.dispatchEvent(new PopStateEvent('popstate', { state: state }));
            return true;
        `);
        const playingMs = await waitFor('var video = document.querySelector("video"); return !!video && video.readyState >= 3 && video.currentTime > 1;', 90000, 1000);
        record('P01-player-playing', { ok: playingMs !== null, data: videoState(), state: state(), screenshot: screenshot('P01-player') });
        if (playingMs === null) {
            return;
        }

        // Speed menu (a Player menu layer), opened with its shortcut.
        evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true })); return true;');
        await sleep(800);
        const menuLayers = evaluate(`return document.querySelectorAll(window.__f32.sel('menu-layer')).length;`);
        record('P02-speed-menu-open', { ok: menuLayers > 0, note: `menu layers: ${menuLayers}`, screenshot: screenshot('P02-speed-menu') });
        await back('P03-player-back-closes-speed-menu', (b, a) => ({
            'consumed by overlay (player-menu)': a.lastDispatch && a.lastDispatch.detail === 'player-menu',
            'menu closed': evaluate(`return document.querySelectorAll(window.__f32.sel('menu-layer')).length;`) === 0,
            'still in Player': a.hash.indexOf('#/player') === 0,
            'no popstate': a.popstates === b.popstates,
        }), { settleMs: 1500 });
        await sleep(1000);
        const afterMenu = videoState();
        record('P04-playback-after-speed-menu', { ok: afterMenu.rate === 1 && !afterMenu.paused, data: afterMenu });

        // Context menu of the Player (right click on the video; the remote has no right click,
        // but the bridge has to close it right when it is open).
        evaluate(`
            var event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 400, button: 2 });
            document.querySelector('video').dispatchEvent(event);
            return true;
        `);
        await sleep(800);
        const contextMenuOpen = () => evaluate(`return !!document.querySelector('body > ' + window.__f32.sel('context-menu-container').split(', ').join(', body > '));`);
        record('P05-context-menu-open', { ok: contextMenuOpen() === true, screenshot: screenshot('P05-context-menu') });
        await back('P06-player-back-closes-context-menu', (b, a) => ({
            'consumed by overlay (context-menu)': a.lastDispatch && a.lastDispatch.detail === 'context-menu',
            'still in Player': a.hash.indexOf('#/player') === 0,
            'no popstate': a.popstates === b.popstates,
        }), { settleMs: 1500 });
        record('P07-context-menu-closed', { ok: contextMenuOpen() === false });
        // The Player switches to 2x 400 ms after a press that is not released: check well after.
        const rates = [];
        for (let i = 0; i < 4; i++) {
            await sleep(1000);
            rates.push(videoState());
        }
        record('P08-playback-after-context-menu', {
            ok: rates.every((video) => video && video.rate === 1 && !video.paused),
            note: `rate over 4 s: ${rates.map((video) => video && video.rate).join(', ')}`,
            data: rates,
        });

        // Back while the video plays: leaves the Player, one entry back.
        await back('P09-player-back-leaves', (b, a) => ({
            'left Player': a.hash.indexOf('#/player') !== 0,
            'one popstate': a.popstates === b.popstates + 1,
            'one entry back': a.idx === b.idx - 1,
            'no dialog': !a.exitDialog,
        }), { settleMs: 2500 });
    } finally {
        server.kill();
    }
};

const SCENARIOS = { navigation: navigationScenario, player: playerScenario };

try {
    if (!SCENARIOS[SCENARIO]) {
        throw new Error(`unknown scenario ${SCENARIO}`);
    }
    if (await boot()) {
        await SCENARIOS[SCENARIO]();
    }
} catch (error) {
    record('error', { ok: false, note: error.message });
}
const failed = steps.filter((step) => step.ok === false);
fs.writeFileSync(path.join(OUT, `back-${SCENARIO}.json`), JSON.stringify({ date: new Date().toISOString(), failed: failed.map((step) => step.name), steps }, null, 2));
console.log(`\n${steps.filter((step) => step.ok === true).length} ok, ${failed.length} falharam -> ${path.join(OUT, `back-${SCENARIO}.json`)}`);
process.exit(failed.length === 0 ? 0 : 1);
