#!/usr/bin/env node
// Remote control navigation of Library, Calendar, Addons, Settings and the side navigation bar on
// the emulator (F4.1b). Every move is a real remote key (webos/tools/remote.mjs, port 19001): the
// screens are opened from the side navigation bar with the arrows and OK, never by URL. After each
// key the state is read over CDP: the focused element, whether the focus is lost (body, a hidden
// route), the scroll of the list and the route. Run from the repo root, inside an emu-run
// reservation, after `pnpm webos:package`:
//   webos/tools/emu-run --timeout 15 -- node webos/tests/navigation/f4.1b/run.mjs <out-dir> [guest|library]
// Writes <out-dir>/f41b-<scenario>.json (every key with its state), screenshots (TV zoom of F2.6)
// and the console errors. The output folder must be under $HOME.
// Scenarios (one per emu-run):
// - guest (default, no account, as the app ships): side bar from the Board, the profile menu,
//   Library and Calendar placeholders, Addons (list, filters, details modal and back), Settings
//   (menu, every row, toggles, interface zoom steps, the language list);
// - library: the same app with a fake logged-in profile and 196 Cinemeta titles in the library
//   (fixture.mjs, needed because Library and Calendar only show content to a logged-in profile):
//   the Library grid down to the end (second page loaded on demand), a title opened and Back to it,
//   the Calendar month grid and its episode list.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { WORKER_FILTER, WRITE_FIXTURE } from './fixture.mjs';

const OUT = path.resolve(process.argv[2] || 'f41b-emulator');
const SCENARIO = process.argv[3] || 'guest';
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', '..');
const APP_ID = 'io.github.gabrielsflores.stremio';
const { EMU_DEVICE: DEVICE, EMU_CDP_PORT: CDP_PORT, EMU_REMOTE_PORT: REMOTE_PORT } = process.env;
if (!DEVICE || !CDP_PORT || !REMOTE_PORT) {
    console.error('run inside webos/tools/emu-run');
    process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

const KEY_DELAY_MS = 700;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', cwd: REPO, env: { ...process.env, WEBOS_DEVICE: DEVICE } });

// One CDP session for the whole run (Page.addScriptToEvaluateOnLoad lives as long as it does).
const cdp = {
    socket: null,
    id: 0,
    pending: new Map(),
    console: [],
    async connect() {
        for (let attempt = 0; attempt < 60; attempt++) {
            try {
                const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
                const target = targets.find((entry) => (entry.url || '').includes(APP_ID) || (entry.url || '').includes('index.html'));
                if (target && target.webSocketDebuggerUrl) {
                    this.socket = new WebSocket(target.webSocketDebuggerUrl);
                    await new Promise((resolve, reject) => {
                        this.socket.onopen = resolve;
                        this.socket.onerror = reject;
                    });
                    this.socket.onmessage = (message) => this.onMessage(JSON.parse(message.data));
                    await this.send('Runtime.enable');
                    await this.send('Console.enable');
                    await this.send('Page.enable');
                    return;
                }
            } catch {
                // inspector not up yet
            }
            await sleep(2000);
        }
        throw new Error('no CDP target');
    },
    onMessage(data) {
        if (data.id && this.pending.has(data.id)) {
            this.pending.get(data.id)(data);
            this.pending.delete(data.id);
        } else if (data.method === 'Console.messageAdded') {
            const { level, text, url, line } = data.params.message;
            if (level === 'error' || level === 'warning') this.console.push({ time: Date.now(), level, text: String(text).slice(0, 500), url, line });
        } else if (data.method === 'Runtime.exceptionThrown') {
            const details = data.params.exceptionDetails || {};
            this.console.push({ time: Date.now(), level: 'exception', text: String((details.exception && details.exception.description) || details.text).slice(0, 500) });
        }
    },
    send(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = ++this.id;
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`${method}: timeout`));
            }, 20000);
            this.pending.set(id, (data) => {
                clearTimeout(timer);
                if (data.error) reject(new Error(`${method}: ${data.error.message}`));
                else resolve(data.result);
            });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    },
};

const evaluate = async (body) => {
    const result = await cdp.send('Runtime.evaluate', { expression: `JSON.stringify((function(){ ${body} })())`, returnByValue: true });
    if (result.wasThrown) throw new Error(`eval: ${JSON.stringify(result.result && result.result.description)}`);
    return result.result.value === undefined ? undefined : JSON.parse(result.result.value);
};

const waitFor = async (body, timeoutMs, intervalMs = 500) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            if (await evaluate(body) === true) return Date.now() - started;
        } catch {
            // page reloading
        }
        await sleep(intervalMs);
    }
    return null;
};

const screenshot = async (name) => {
    try {
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
        return `${name}.png`;
    } catch (error) {
        return `failed: ${error.message}`;
    }
};

// Page helpers (ES5 for Chromium 53), installed again after a reload.
const PAGE_HELPERS = `
    window.__f41b = window.__f41b || {};
    var h = window.__f41b;
    h.local = function (element, name) {
        var className = element && typeof element.className === 'string' ? element.className : '';
        return className.split(/\\s+/).some(function (token) { return new RegExp('^' + name + '-[\\\\w-]{5}$').test(token); });
    };
    h.closest = function (element, name) {
        for (var node = element; node && node.nodeType === 1; node = node.parentNode) if (h.local(node, name)) return node;
        return null;
    };
    h.route = function () {
        var routes = document.querySelectorAll('.routes-container > .route-container');
        for (var i = routes.length - 1; i >= 0; i--) if (routes[i].getClientRects().length) return routes[i];
        return null;
    };
    h.list = function (route, names) {
        for (var i = 0; i < names.length; i++) {
            var found = Array.prototype.filter.call(route.querySelectorAll('[class*="' + names[i] + '-"]'), function (e) { return h.local(e, names[i]); });
            if (found.length) return found[0];
        }
        return null;
    };
    h.state = function () {
        var active = document.activeElement;
        var route = h.route();
        var rect = active && active.getBoundingClientRect ? active.getBoundingClientRect() : null;
        var list = route ? h.list(route, ['meta-items-container', 'addons-list-container', 'sections-container', 'list']) : null;
        var inPortal = active && route && !route.contains(active) && active !== document.body;
        var shown = !!(rect && rect.width > 0 && rect.height > 0);
        var className = active && typeof active.className === 'string' ? active.className.trim().split(/\\s+/).slice(0, 2).join('.') : '';
        return {
            hash: location.hash,
            focused: active ? active.tagName.toLowerCase() + (className ? '.' + className : '') : null,
            text: active ? String(active.textContent || active.getAttribute('title') || '').trim().slice(0, 40) : null,
            title: active && active.getAttribute ? active.getAttribute('title') : null,
            rect: rect ? [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)] : null,
            lost: !active || active === document.body || !shown || !(route && route.contains(active)) && !inPortal,
            inNavBar: !!(active && h.closest(active, 'vertical-nav-bar-container')),
            inPortal: !!inPortal,
            inViewport: !!(rect && rect.top >= 0 && rect.bottom <= window.innerHeight + 1 && rect.left >= 0 && rect.right <= window.innerWidth + 1),
            listScroll: list ? Math.round(list.scrollTop) : null,
            listItems: list ? list.querySelectorAll('[tabindex="0"], a[href]').length : null,
            libraryItems: route && h.list(route, ['meta-items-container']) ? h.list(route, ['meta-items-container']).children.length : null,
            interfaceScale: document.documentElement.style.getPropertyValue('--interface-scale'),
            expanded: document.querySelectorAll('[aria-expanded="true"], [class*="open-"]').length,
            navigation: window.__webosNavigationF41b ? window.__webosNavigationF41b.status.last : null,
            hasFocus: document.hasFocus(),
        };
    };
    return true;
`;
const state = async () => {
    try {
        return await evaluate('return window.__f41b && window.__f41b.state ? window.__f41b.state() : null;');
    } catch (error) {
        return { error: error.message };
    }
};

const steps = [];
const record = (name, data) => {
    steps.push({ name, ...data });
    const mark = data.ok === undefined ? '-' : data.ok ? 'ok' : 'FALHOU';
    console.log(`[${mark}] ${name}${data.note ? ` (${data.note})` : ''}`);
};
const check = (name, ok, data = {}) => record(name, { ok: !!ok, ...data });

// One real key, then the state. Every key is checked for a lost focus.
const keys = [];
const press = async (key, label = '') => {
    const before = await state();
    run('node', ['webos/tools/remote.mjs', '--port', REMOTE_PORT, '--delay', '0', key]);
    await sleep(KEY_DELAY_MS);
    let after = await state();
    if (after && after.hash !== (before && before.hash)) {
        await sleep(1200);
        after = await state();
    }
    keys.push({ key, label, after });
    console.log(`  ${key.padEnd(5)} ${after ? `${after.hash} ${after.focused} "${after.text}"${after.lost ? ' LOST' : ''}` : after}`);
    return after;
};
const pressAll = async (sequence, label) => {
    let last = null;
    for (const key of sequence) last = await press(key, label);
    return last;
};

const NAV_ORDER = ['Board', 'Discover', 'Library', 'Calendar', 'Addons', 'Settings'];

// Opens a screen from the side bar: LEFT until the bar has the focus, UP/DOWN to the tab, OK.
// Every key that leaves the bar on the way is counted (nav-bar-escapes).
const openFromNavBar = async (label, expectedHash) => {
    let current = await state();
    let escapes = 0;
    for (let attempt = 0; attempt < 16 && current.title !== label; attempt++) {
        if (!current.inNavBar) {
            current = await press('LEFT', `nav:${label}`);
            continue;
        }
        const index = NAV_ORDER.indexOf(current.title);
        current = await press(index > NAV_ORDER.indexOf(label) ? 'UP' : 'DOWN', `nav:${label}`);
        if (!current.inNavBar) escapes++;
    }
    check(`nav-bar-to-${label}-without-escapes`, escapes === 0, { note: `${escapes} keys left the bar` });
    if (current.title !== label) {
        check(`nav-tab-${label}`, false, { note: String(current.title) });
        return false;
    }
    await press('OK', `nav:${label}`);
    const opened = await waitFor(`return location.hash.indexOf(${JSON.stringify(expectedHash)}) === 0;`, 15000);
    check(`open-${label}-from-nav-bar`, opened !== null, { note: (await state()).hash });
    return opened !== null;
};

// The initial focus once the screen has its content.
const initialFocus = async (name, isExpected, timeoutMs = 10000) => {
    const started = Date.now();
    let current = await state();
    while (Date.now() - started < timeoutMs && (current.lost || !isExpected(current))) {
        await sleep(500);
        current = await state();
    }
    check(`${name}-initial-focus`, !current.lost && isExpected(current), {
        note: `${current.focused} "${current.text}" after ${Date.now() - started} ms`,
        state: current,
        screenshot: await screenshot(`${name}-initial`),
    });
    return current;
};

const boot = async () => {
    const started = Date.now();
    console.log(run('webos/scripts/ares.sh', ['install']).trim());
    console.log(run('webos/scripts/ares.sh', ['launch']).trim());
    await cdp.connect();
    const boardMs = await waitFor(`
        ${PAGE_HELPERS}
        return document.querySelectorAll('a[href^="#/detail/"]').length > 0 && !!window.__webosNavigationF41b;
    `, 240000, 2000);
    // On a clean boot the emulator's Welcome app may come to the front after ours.
    let others = [];
    try {
        others = run('ares-launch', ['--device', DEVICE, '--running']).split('\n').map((line) => line.trim())
            .filter((line) => /^[a-z0-9]+(\.[a-z0-9-]+)+$/i.test(line) && line !== APP_ID);
    } catch {
        // none
    }
    others.forEach((id) => {
        try {
            run('ares-launch', ['--device', DEVICE, '--close', id]);
        } catch {
            // system apps may refuse
        }
    });
    run('webos/scripts/ares.sh', ['launch']);
    await waitFor('return document.hasFocus();', 20000);
    check('board-loaded', boardMs !== null, { note: `${Math.round((Date.now() - started) / 1000)} s after install; closed: ${others.join(', ') || '(none)'}` });
    await evaluate(PAGE_HELPERS);
    await sleep(2000);
    return boardMs !== null;
};

const applyFixture = async () => {
    // window.core is set once the core is initialized.
    const core = await waitFor('return !!window.core;', 120000, 1000);
    check('core-ready', core !== null);
    await cdp.send('Page.addScriptToEvaluateOnLoad', { scriptSource: WORKER_FILTER });
    await evaluate(`${WRITE_FIXTURE}; return true;`);
    const written = await waitFor('return !!window.__f41bFixtureResult;', 30000);
    const result = await evaluate('return window.__f41bFixtureResult;');
    check('fixture-written', written !== null && result && result.items > 100, { note: JSON.stringify(result) });
    await cdp.send('Page.reload', {});
    await sleep(3000);
    const loaded = await waitFor(`
        ${PAGE_HELPERS}
        return document.querySelectorAll('a[href^="#/detail/"]').length > 0 && !!window.__webosNavigationF41b;
    `, 120000, 2000);
    await sleep(3000);
    const fixture = await evaluate('var p = JSON.parse(localStorage.getItem("profile") || "null"); return { auth: !!(p && p.auth), swapped: window.__f41bFixture && window.__f41bFixture.swapped };');
    check('fixture-profile-logged-in', loaded !== null && fixture.auth && fixture.swapped.indexOf('PullUserFromAPI') !== -1, { note: JSON.stringify(fixture) });
};

// The side bar from a screen of another task (Board): LEFT reaches it, RIGHT comes back.
const navBarOnBoard = async () => {
    // A poster of the Board first (its initial focus is F4.1a's): into the bar, to the Discover tab
    // (next to the first row) and RIGHT.
    let current = await state();
    for (let attempt = 0; attempt < 12 && current.title !== 'Discover'; attempt++) {
        current = await press(!current.inNavBar ? 'LEFT' : NAV_ORDER.indexOf(current.title) > 1 ? 'UP' : 'DOWN', 'board');
    }
    for (let attempt = 0; attempt < 3 && !/meta-item/.test(current.focused || ''); attempt++) current = await press('RIGHT', 'board');
    current = await press('RIGHT', 'board');
    const content = current;
    check('board-poster-focused', /meta-item/.test(content.focused || ''), { note: `${content.focused} "${content.text}"` });
    // LEFT along the row (the first column is the last poster before the bar).
    let leftFrom = content;
    for (let attempt = 0; attempt < 10 && !current.inNavBar; attempt++) {
        leftFrom = current;
        current = await press('LEFT', 'board-nav');
    }
    check('board-left-reaches-nav-bar', current.inNavBar, { note: `${current.title}`, screenshot: await screenshot('board-nav-bar') });
    const back = await press('RIGHT', 'board-nav');
    check('board-right-returns-to-content', back.text === leftFrom.text && !back.lost, { note: `${back.focused} "${back.text}" (bar entered from "${leftFrom.text}")` });
};

const profileMenu = async () => {
    // Profile button: UP from the first tab goes to the top bar, then RIGHT.
    let current = await state();
    for (let attempt = 0; attempt < 8 && !current.inNavBar; attempt++) current = await press('LEFT', 'profile');
    for (let attempt = 0; attempt < 6 && current.title !== 'Board'; attempt++) current = await press('UP', 'profile');
    current = await press('UP', 'profile');
    for (let attempt = 0; attempt < 4 && !/nav-menu-popup-label/.test(current.focused || ''); attempt++) current = await press('RIGHT', 'profile');
    check('profile-button-reachable', /nav-menu-popup-label/.test(current.focused || ''), { note: current.focused });
    const opened = await press('OK', 'profile');
    await sleep(500);
    const menu = await evaluate('return document.querySelectorAll("[class*=nav-menu-container]").length;');
    const inMenu = await evaluate('var a = document.activeElement; return !!(a && window.__f41b.closest(a, "nav-menu-container"));');
    check('profile-menu-opens-with-ok', menu > 0, { note: `menus: ${menu}`, screenshot: await screenshot('profile-menu-open') });
    check('profile-menu-focus-on-first-entry', inMenu, { note: JSON.stringify((await state()).text) });
    const closed = await press('BACK', 'profile');
    const menuAfter = await evaluate('return document.querySelectorAll("[class*=nav-menu-container]").length;');
    check('profile-menu-closes-with-back', menuAfter === 0 && !closed.lost, { note: `menus: ${menuAfter}; focus ${closed.focused}; opened focus ${opened.focused}` });
};

// Walks a list with the arrows: every key must keep the focus, and DOWN must move or scroll.
const walk = async (name, key, count, { stopWhen } = {}) => {
    const visited = [];
    let current = await state();
    let lost = 0;
    let outside = 0;
    for (let index = 0; index < count; index++) {
        current = await press(key, name);
        visited.push(`${current.text}`);
        if (current.lost) lost++;
        if (!current.inViewport && !current.inPortal) outside++;
        if (stopWhen && stopWhen(current, visited)) break;
    }
    check(`${name}-focus-kept`, lost === 0, { note: `${visited.length} keys, lost ${lost}` });
    check(`${name}-focus-visible`, outside === 0, { note: `outside the screen ${outside}` });
    return { current, visited };
};

const guestScenario = async () => {
    await navBarOnBoard();
    await profileMenu();

    // Library and Calendar placeholders.
    if (await openFromNavBar('Library', '#/library')) {
        await initialFocus('library-guest', (s) => /Log in/.test(s.text));
        const left = await press('LEFT', 'library-guest');
        check('library-guest-left-to-nav-bar', left.inNavBar, { note: left.title });
        const right = await press('RIGHT', 'library-guest');
        check('library-guest-right-back', /Log in/.test(right.text), { note: right.text });
    }
    if (await openFromNavBar('Calendar', '#/calendar')) {
        await initialFocus('calendar-guest', (s) => /Log in/.test(s.text));
    }

    // Addons: the list, the filters above it, a details modal and Back.
    if (await openFromNavBar('Addons', '#/addons')) {
        const first = await initialFocus('addons', (s) => /addon-/.test(s.focused || '') && !s.inNavBar);
        const down = await walk('addons-down', 'DOWN', 12);
        check('addons-list-scrolled', down.current.listScroll > 0, { note: `scrollTop ${down.current.listScroll}`, screenshot: await screenshot('addons-scrolled') });
        const up = await walk('addons-up', 'UP', 14, { stopWhen: (s) => !/addon-/.test(s.focused || '') });
        check('addons-up-reaches-filters', !/addon-/.test(up.current.focused || '') && !up.current.lost, { note: `${up.current.focused} "${up.current.text}"` });
        const back = await press('DOWN', 'addons');
        check('addons-down-back-to-first', back.text === first.text, { note: back.text });
        await press('OK', 'addons-modal');
        const modal = await waitFor('return document.querySelectorAll("[class*=modal-dialog-container]").length > 0;', 10000);
        check('addons-details-opens', modal !== null, { screenshot: await screenshot('addons-modal') });
        const closed = await press('BACK', 'addons-modal');
        check('addons-details-back-restores-focus', closed.text === first.text && !closed.lost, { note: `${closed.focused} "${closed.text}"` });
    }

    // Settings: menu, every row down to the end, toggles, zoom steps, the language list.
    if (await openFromNavBar('Settings', '#/settings')) {
        await initialFocus('settings', (s) => s.text === 'General');
        const menu = await walk('settings-menu', 'DOWN', 4);
        check('settings-menu-reachable', menu.visited.indexOf('Diagnostics') !== -1, { note: menu.visited.join(' | ') });
        await pressAll(['UP', 'UP', 'UP', 'UP'], 'settings-menu');
        const content = await press('RIGHT', 'settings');
        check('settings-right-into-content', !content.inNavBar && /link|button|toggle/.test(content.focused || ''), { note: `${content.focused} "${content.text}"` });
        // Stops when DOWN no longer changes anything (the end of the list keeps the key).
        const positions = [];
        const rows = await walk('settings-rows', 'DOWN', 80, {
            stopWhen: (s) => {
                positions.push(`${s.text}|${s.rect}|${s.listScroll}`);
                return positions.length > 2 && positions.slice(-3).every((position) => position === positions[positions.length - 1]);
            },
        });
        const toggles = keys.filter((entry) => entry.label === 'settings-rows' && /toggle-container/.test(entry.after.focused || '')).length;
        const ticks = keys.filter((entry) => entry.label === 'settings-rows' && /^\d+%$/.test(entry.after.text || '') && /button\.label/.test(entry.after.focused || '')).length;
        check('settings-toggles-reachable', toggles >= 3, { note: `${toggles} toggles focused` });
        check('settings-zoom-steps-reachable', ticks >= 1, { note: `${ticks} zoom steps focused` });
        check('settings-zoom-unchanged-by-arrows', rows.current.interfaceScale === '1.75', { note: `--interface-scale ${rows.current.interfaceScale}` });
        check('settings-end-reached', rows.current.listScroll > 0, { note: `scrollTop ${rows.current.listScroll}`, screenshot: await screenshot('settings-end') });
        // The subtitle color buttons (#RRGGBBAA values, which Chromium 53 drops): their color shows.
        const colors = await evaluate('return Array.prototype.map.call(document.querySelectorAll("[class*=color-input-container]"), function (b) { return { title: b.getAttribute("title"), background: getComputedStyle(b).backgroundColor }; });');
        const white = colors.filter((color) => /^#FFFFFFFF$/i.test(color.title || ''))[0];
        check('settings-subtitle-color-shown', white && /rgba?\(255, 255, 255/.test(white.background), { note: JSON.stringify(colors) });
        const offered = await evaluate('return Array.prototype.map.call(document.querySelectorAll("[class*=sections-container] [class*=ticks] button"), function (b) { return b.textContent; });');
        check('settings-zoom-steps-tv-only', JSON.stringify(offered) === JSON.stringify(['100%', '125%']), { note: JSON.stringify(offered) });
        const top = await walk('settings-rows-up', 'UP', 70, { stopWhen: (s) => s.inNavBar || /submit-button|search/.test(s.focused || '') || s.text === 'General' });
        check('settings-up-leaves-list-at-top', !top.current.lost, { note: `${top.current.focused} "${top.current.text}"` });

        // Zoom: the steps with LEFT/RIGHT and OK.
        let current = await press('DOWN', 'settings-zoom');
        for (let index = 0; index < 20 && !/^100%$/.test(current.text || ''); index++) current = await press('DOWN', 'settings-zoom');
        current = await press('RIGHT', 'settings-zoom');
        await press('OK', 'settings-zoom');
        await sleep(1500);
        const zoomed = await state();
        check('settings-zoom-125-with-ok', zoomed.interfaceScale === '2.1875' && !zoomed.lost && zoomed.inViewport && zoomed.text === '125%', { note: `${zoomed.interfaceScale} focus "${zoomed.text}" ${zoomed.rect}`, screenshot: await screenshot('settings-zoom-125') });
        const navBar125 = await evaluate('return Array.prototype.map.call(window.__f41b.route().querySelectorAll("[class*=nav-tab-button-container]"), function (a) { var r = a.getBoundingClientRect(); return r.bottom <= window.innerHeight; });');
        check('settings-zoom-125-nav-bar-on-screen', navBar125.length === 6 && navBar125.every(Boolean), { note: JSON.stringify(navBar125) });
        current = await pressAll(['LEFT', 'OK'], 'settings-zoom');
        await sleep(1500);
        const restored = await state();
        check('settings-zoom-back-to-100', restored.interfaceScale === '1.75' && !restored.lost, { note: `${restored.interfaceScale} focus "${restored.text}"` });

        // The interface language list: open, walk, Back.
        current = await press('UP', 'settings-language');
        for (let index = 0; index < 6 && !/multiselect|button-/.test(current.focused || '') && current.text !== 'English'; index++) current = await press('UP', 'settings-language');
        check('settings-language-reachable', current.text === 'English', { note: `${current.focused} "${current.text}"` });
        await press('OK', 'settings-language');
        const list = await walk('settings-language-list', 'DOWN', 12);
        check('settings-language-list-walks', new Set(list.visited).size >= 10, { note: list.visited.join(' | '), screenshot: await screenshot('settings-language-list') });
        const closed = await press('BACK', 'settings-language');
        check('settings-language-back-closes', closed.text === 'English' && !closed.lost, { note: `${closed.focused} "${closed.text}"` });
    }
};

const libraryScenario = async () => {
    await applyFixture();
    if (await openFromNavBar('Library', '#/library')) {
        const first = await initialFocus('library', (s) => /meta-item/.test(s.focused || ''));
        check('library-first-page', first.libraryItems === 100, { note: `${first.libraryItems} items` });
        const down = await walk('library-down', 'DOWN', 30, { stopWhen: (s) => s.libraryItems > 100 });
        check('library-next-page-on-demand', down.current.libraryItems > 100, { note: `${down.current.libraryItems} items after ${down.visited.length} DOWN`, screenshot: await screenshot('library-next-page') });
        const rows = keys.filter((entry) => entry.label === 'library-down').map((entry) => entry.after.text);
        check('library-down-moves-every-key', new Set(rows).size === rows.length, { note: `${new Set(rows).size} distinct of ${rows.length}` });
        const up = await walk('library-up', 'UP', 3);
        const upRows = keys.filter((entry) => entry.label === 'library-up').map((entry) => entry.after.text);
        check('library-up-moves-every-key', new Set(upRows).size === 3, { note: upRows.join(' | ') });
        const chosen = await press('RIGHT', 'library');
        await press('OK', 'library-detail');
        const detail = await waitFor('return /^#\\/detail\\//.test(location.hash);', 20000);
        check('library-opens-detail', detail !== null, { note: (await state()).hash });
        await sleep(3000);
        const back = await press('BACK', 'library-detail');
        await sleep(1000);
        const restored = await state();
        check('library-back-restores-focus', restored.text === chosen.text && restored.hash.indexOf('#/library') === 0 && !restored.lost, {
            note: `left "${chosen.text}" (scroll ${chosen.listScroll}), back on "${restored.text}" (scroll ${restored.listScroll}); first ${back.focused}`,
            screenshot: await screenshot('library-back-restored'),
        });
        const left = await walk('library-left', 'LEFT', 6, { stopWhen: (s) => s.inNavBar });
        check('library-left-to-nav-bar', left.current.inNavBar, { note: left.current.title });
        const right = await press('RIGHT', 'library');
        check('library-right-back-to-item', /meta-item/.test(right.focused || ''), { note: right.text });
    }

    if (await openFromNavBar('Calendar', '#/calendar')) {
        const today = await initialFocus('calendar', (s) => /cell-/.test(s.focused || ''), 20000);
        await waitFor('return document.querySelectorAll("[class*=episode-]").length > 0;', 20000);
        const grid = await pressAll(['UP', 'DOWN'], 'calendar-grid');
        check('calendar-grid-arrows', /cell-/.test(grid.focused || '') && grid.text === today.text, { note: `${today.text} -> ${grid.text}` });
        // A day with episodes other than today: reached with the arrows, OK selects it and the list
        // on the right (the upstream episode preview) scrolls to it.
        const target = await evaluate(`
            var h = window.__f41b;
            var cells = Array.prototype.filter.call(document.querySelectorAll('[class*="cell-"]'), function (c) { return h.local(c, 'cell'); });
            var withItems = cells.filter(function (c) {
                return Array.prototype.some.call(c.querySelectorAll('[class*="item-"]'), function (i) { return h.local(i, 'item'); }) && !h.local(c, 'today');
            });
            return withItems.map(function (c) { return c.textContent.trim(); });
        `);
        record('calendar-days-with-episodes', { note: JSON.stringify(target) });
        const day = target && target.length ? target[Math.floor(target.length / 2)] : null;
        let current = await state();
        for (let index = 0; index < 20 && day && current.text !== day; index++) {
            const move = await evaluate(`
                var h = window.__f41b;
                var cells = Array.prototype.filter.call(document.querySelectorAll('[class*="cell-"]'), function (c) { return h.local(c, 'cell'); });
                var to = cells.filter(function (c) { return c.textContent.trim() === ${JSON.stringify(day)}; })[0].getBoundingClientRect();
                var from = document.activeElement.getBoundingClientRect();
                if (to.top >= from.bottom - 1) return 'DOWN';
                if (to.bottom <= from.top + 1) return 'UP';
                return to.left > from.left ? 'RIGHT' : 'LEFT';
            `);
            current = await press(move, 'calendar-grid');
            if (!/cell-/.test(current.focused || '')) break;
        }
        check('calendar-grid-reaches-day', day !== null && current.text === day, { note: `day ${day}: ${current.focused} "${current.text}"` });
        await press('OK', 'calendar-select');
        await sleep(2000);
        const selected = await evaluate(`
            var h = window.__f41b;
            return Array.prototype.filter.call(document.querySelectorAll('[class*="item-"]'), function (e) { return h.local(e, 'item') && h.local(e, 'active'); })
                .map(function (e) { var r = e.getBoundingClientRect(); return { text: e.textContent.trim().slice(0, 30), top: Math.round(r.top) }; });
        `);
        check('calendar-ok-selects-day-in-list', selected.length === 1 && selected[0].top >= 0 && selected[0].top < 1080, { note: `day ${day}: ${JSON.stringify(selected)}`, screenshot: await screenshot('calendar-selected') });
        current = await state();
        for (let index = 0; index < 8 && !/episode-/.test(current.focused || ''); index++) current = await press('RIGHT', 'calendar-list');
        check('calendar-right-into-episode-list', /episode-/.test(current.focused || ''), { note: `${current.focused} "${current.text}"` });
        const list = await walk('calendar-list', 'DOWN', 6);
        check('calendar-list-walks', !list.current.lost, { note: list.visited.join(' | '), screenshot: await screenshot('calendar-list') });
    }
};

const SCENARIOS = { guest: guestScenario, library: libraryScenario };

try {
    if (!SCENARIOS[SCENARIO]) throw new Error(`unknown scenario ${SCENARIO}`);
    if (await boot()) await SCENARIOS[SCENARIO]();
} catch (error) {
    record('error', { ok: false, note: error.stack || error.message });
}
const failed = steps.filter((step) => step.ok === false);
const lostKeys = keys.filter((entry) => entry.after && entry.after.lost);
fs.writeFileSync(path.join(OUT, `f41b-${SCENARIO}.json`), JSON.stringify({
    date: new Date().toISOString(),
    failed: failed.map((step) => step.name),
    keysPressed: keys.length,
    keysWithFocusLost: lostKeys.length,
    steps,
    keys,
    console: cdp.console,
}, null, 2));
console.log(`\n${steps.filter((step) => step.ok === true).length} ok, ${failed.length} falharam, ${keys.length} teclas (${lostKeys.length} sem foco), ${cdp.console.length} erros/avisos no console -> ${path.join(OUT, `f41b-${SCENARIO}.json`)}`);
if (cdp.socket) cdp.socket.close();
process.exit(failed.length === 0 ? 0 : 1);
