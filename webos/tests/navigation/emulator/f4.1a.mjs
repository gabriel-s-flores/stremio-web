#!/usr/bin/env node
// Remote navigation of the Board, Discover and Search (F4.1a) on the emulator: real remote keys
// (webos/tools/remote.mjs) on the packaged app, the focus and the scroll positions read over CDP after
// each press. Run from the repo root, inside an emu-run reservation, after `pnpm webos:package`:
//   webos/tools/emu-run --timeout 15 -- node webos/tests/navigation/emulator/f4.1a.mjs <out-dir> [board|discover|search|all]
// Writes <out-dir>/f4.1a-<scenario>.json (every step, its checks and the state after it) and page
// screenshots (the 1920x1080 page, with the TV scale of F2.6); the output folder must be under $HOME.
//
// Every key is a real remote key, with two exceptions, both outside this task:
// - Discover is opened with a click on the nav bar link (over CDP), as long as the vertical nav bar
//   is not reachable with the arrows (F4.1b makes it so);
// - the search text is typed over CDP and submitted with an Enter key event: the system keyboard
//   is F3.4's.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] || 'navigation-emulator');
const SCENARIOS = (process.argv[3] || 'all') === 'all' ? ['board', 'discover', 'search'] : [process.argv[3]];
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..', '..');
const APP_ID = 'io.github.gabrielsflores.stremio';
const { EMU_DEVICE: DEVICE, EMU_CDP_PORT: CDP_PORT, EMU_REMOTE_PORT: REMOTE_PORT } = process.env;
if (!DEVICE || !CDP_PORT || !REMOTE_PORT) {
    console.error('run inside webos/tools/emu-run');
    process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', cwd: REPO, ...options });
const cdp = (...args) => run('node', ['webos/tools/cdp.mjs', '--port', CDP_PORT, '--target', APP_ID, ...args]).trim();
const evaluate = (body) => {
    const output = cdp('eval', `JSON.stringify((function(){ ${body} })())`);
    try {
        return JSON.parse(output);
    } catch {
        return output;
    }
};

// Page helpers (ES2015 for Chromium 53): what has the focus, where, and the scroll of the lists.
const HELPERS = `
    if (!window.__f41a) {
        window.__f41a = { keyboard: [] };
        document.addEventListener('keyboardStateChange', function (event) {
            window.__f41a.keyboard.push(event.detail && event.detail.visibility);
        });
    }
    var local = function (root, name) {
        var pattern = new RegExp('^' + name + '-[A-Za-z0-9_-]{5}$');
        return Array.prototype.slice.call(root.querySelectorAll('[class*="' + name + '-"]')).filter(function (element) {
            return String(element.className).split(/\\s+/).some(function (token) { return pattern.test(token); });
        })[0] || null;
    };
    window.__f41a.state = function () {
        var route = document.querySelector('.routes-container > .route-container:last-child');
        var active = document.activeElement;
        var rect = active && active !== document.body ? active.getBoundingClientRect() : null;
        var list = route && (local(route, 'board-content') || local(route, 'search-content'));
        var grid = route && local(route, 'meta-items-container');
        var row = null;
        var strip = null;
        if (list && active && list.contains(active)) {
            for (row = active; row && row.parentElement !== list; row = row.parentElement) {}
            strip = row && local(row, 'meta-items-container');
        }
        var stripRect = strip ? strip.getBoundingClientRect() : null;
        var routeRect = route ? route.getBoundingClientRect() : null;
        var rows = list ? Array.prototype.slice.call(list.children) : [];
        return {
            hash: location.hash,
            focused: active === document.body ? 'body' : active ? active.tagName.toLowerCase() + '.' + String(active.className).split(' ')[0] : null,
            title: active && active !== document.body ? (active.getAttribute('title') || active.textContent || active.value || '').trim().slice(0, 40) : null,
            rect: rect ? [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)] : null,
            inRoute: !!(route && active && route.contains(active)),
            onScreen: !!(rect && routeRect && rect.left >= routeRect.left && rect.right <= routeRect.right + 1 && rect.top >= routeRect.top && rect.bottom <= routeRect.bottom + 1),
            inStrip: !!(rect && stripRect && rect.left >= stripRect.left - 1 && rect.right <= stripRect.right + 1),
            row: row ? rows.indexOf(row) : null,
            rowTop: row && list ? Math.round(row.offsetTop - list.scrollTop) : null,
            column: strip && active ? Array.prototype.indexOf.call(strip.children, active.parentElement) : null,
            listScroll: list ? Math.round(list.scrollTop) : null,
            listAtEnd: list ? list.scrollTop >= list.scrollHeight - list.clientHeight - 1 : null,
            stripScroll: strip ? Math.round(strip.scrollLeft) : null,
            gridScroll: grid && !list ? Math.round(grid.scrollTop) : null,
            gridItems: grid && !list ? grid.querySelectorAll('a').length : null,
            gridIndex: grid && !list && active && grid.contains(active) ? Array.prototype.indexOf.call(grid.children, active.parentElement) : null,
            keyboard: window.__f41a.keyboard.length ? window.__f41a.keyboard[window.__f41a.keyboard.length - 1] : null,
            keyboardVisible: !!(window.PalmSystem && window.PalmSystem.isKeyboardVisible),
            menuOpen: !!(route && local(route, 'menu-container')),
            inMenu: !!(route && local(route, 'menu-container') && local(route, 'menu-container').contains(active)),
            errors: (window.__f41aErrors || []).length,
        };
    };
    if (!window.__f41aErrors) {
        window.__f41aErrors = [];
        window.addEventListener('error', function (event) { window.__f41aErrors.push(String(event.message)); });
    }
    return true;
`;
const state = () => evaluate('return window.__f41a.state();');

const report = { scenario: null, steps: [] };
let failures = 0;
const record = (name, after, checks = {}, extra = {}) => {
    const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([check]) => check);
    failures += failed.length;
    report.steps.push({ name, ok: failed.length === 0, failed, checks: Object.keys(checks), after, ...extra });
    console.log(`[${failed.length === 0 ? 'ok' : 'FALHOU'}] ${name}${failed.length ? ` (${failed.join('; ')})` : ''} — ${after.focused} "${after.title}" ${after.hash}`);
    return after;
};

const shot = (name) => {
    const file = path.join(OUT, `${report.scenario}-${name}.png`);
    try {
        cdp('screenshot', file);
    } catch (error) {
        console.log(`captura falhou: ${error.message.split('\n')[0]}`);
    }
    return path.basename(file);
};

// One real remote key, then the state once the app settled.
// leaves: the key opens a screen of another task (MetaDetails, F4.1c), whose focus is not checked.
const key = async (name, keyName, checkFn = () => ({}), { settleMs = 900, screenshot = false, leaves = false } = {}) => {
    const before = state();
    run('node', ['webos/tools/remote.mjs', '--port', REMOTE_PORT, '--delay', '0', keyName]);
    await sleep(settleMs);
    const after = state();
    const focusCheck = leaves ? {} : {
        'focus on an element of the visible route (not body)': after.focused !== 'body' && after.focused !== null && (after.inRoute || after.keyboardVisible),
    };
    return record(name, after, {
        ...focusCheck,
        'no page errors': after.errors === before.errors,
        ...checkFn(before, after),
    }, { key: keyName, screenshot: screenshot ? shot(name) : undefined });
};

// Back until the Board, at most `max` presses: history entries in between are F3.2's and the
// upstream's (MetaDetails goes back to its origin with replace, which leaves the origin twice; a
// submitted search is one more entry), so the number of presses is recorded, not checked.
const backToBoard = async (name, checkFn, max = 4) => {
    let s = state();
    let presses = 0;
    while (presses < max && !(s.hash === '#/' || s.hash === '')) {
        presses++;
        s = await key(`${name}-${presses}`, 'BACK', (b, a) => ({
            'Back does not open the system keyboard': a.keyboard !== true || b.keyboard === true,
        }), { settleMs: 2500 });
    }
    return record(name, s, {
        'Board': s.hash === '#/' || s.hash === '',
        ...checkFn(s),
    }, { presses, screenshot: shot(name) });
};

const waitFor = async (body, timeoutMs, intervalMs = 500) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            if (evaluate(body) === true) return Date.now() - started;
        } catch {
            // the page may not be up yet
        }
        await sleep(intervalMs);
    }
    return null;
};

const launch = async () => {
    run('webos/scripts/ares.sh', ['install'], { env: { ...process.env, WEBOS_DEVICE: DEVICE } });
    run('webos/scripts/ares.sh', ['launch'], { env: { ...process.env, WEBOS_DEVICE: DEVICE } });
    await waitFor('return typeof document !== "undefined";', 60000);
    evaluate(HELPERS);
    const ms = await waitFor('return !!document.querySelector(".routes-container") && document.activeElement !== document.body;', 180000, 1000);
    evaluate(HELPERS);
    return ms;
};

// Board: initial focus, the strip of a row to its end and back, every row down and up, the top
// bar and back, a title opened and Back to it.
const board = async () => {
    const bootMs = await launch();
    await sleep(3000);
    let s = state();
    s = record('initial-focus', s, {
        'initial focus on the first item of the first row': s.row === 0 && s.column === 0 && s.onScreen,
    }, { bootMs, screenshot: shot('initial-focus') });
    for (let index = 1; index <= 9; index++) {
        s = await key(`right-${index}`, 'RIGHT', (b, a) => ({
            'next item of the row': a.row === b.row && a.column === b.column + 1,
            'item fully shown in its strip': a.inStrip,
        }), { screenshot: index === 9 });
    }
    s = await key('right-past-the-end', 'RIGHT', (b, a) => ({ 'stays on the last item': a.column === b.column && a.row === b.row }));
    for (let index = 1; index <= 9; index++) {
        s = await key(`left-${index}`, 'LEFT', (b, a) => ({ 'previous item': a.column === b.column - 1, 'item fully shown in its strip': a.inStrip }));
    }
    record('strip-back-to-start', s, { 'strip scrolled back to 0': s.stripScroll === 0 });
    s = await key('right-to-column-2', 'RIGHT');
    s = await key('right-to-column-3', 'RIGHT');
    let rows = 0;
    for (let index = 1; index <= 12; index++) {
        const b = state();
        s = await key(`down-${index}`, 'DOWN', (before, after) => (after.row === before.row ? {
            'last row: stays': true,
        } : {
            'next row with items': after.row > before.row,
            'same column on screen': Math.abs(after.rect[0] - before.rect[0]) < 30,
            'row title in view (row at the top of the list, or the list at its end)': after.rowTop >= 0 && (after.rowTop < 40 || after.listAtEnd),
            'item on screen': after.onScreen,
        }), { screenshot: index === 2 });
        if (s.row === b.row) break;
        rows++;
    }
    record('rows-walked', s, { 'went down at least 4 rows': rows >= 4 });
    for (let index = 1; index <= rows; index++) {
        s = await key(`up-${index}`, 'UP', (b, a) => ({ 'previous row': a.row < b.row, 'item on screen': a.onScreen }));
    }
    s = await key('up-to-top-bar', 'UP', (b, a) => ({ 'top bar (search)': /submit-button-container/.test(a.focused) }));
    s = await key('down-from-top-bar', 'DOWN', (b, a) => ({ 'back to the item it came from': a.row === 0 && a.column === 2 }));
    s = await key('down-to-row-2', 'DOWN');
    s = await key('down-to-row-3', 'DOWN');
    s = await key('right-to-column-4', 'RIGHT');
    const left = s;
    s = await key('ok-opens-details', 'OK', (b, a) => ({ 'details opened': /^#\/(detail|metadetails)\//.test(a.hash) }), { settleMs: 3000, leaves: true });
    s = await key('back-restores-focus', 'BACK', (b, a) => ({
        'back on the Board': a.hash === '#/' || a.hash === '',
        'same item focused': a.title === left.title && a.row === left.row && a.column === left.column,
        'same scroll': a.listScroll === left.listScroll && a.stripScroll === left.stripScroll,
    }), { settleMs: 2500, screenshot: true });
};

const discover = async () => {
    await launch();
    await sleep(3000);
    evaluate('document.querySelector(\'a[href="#/discover"]\').click(); return true;');
    await waitFor('return location.hash.indexOf("#/discover") === 0 && document.activeElement !== document.body && !!document.activeElement.getAttribute("href");', 30000);
    await sleep(1500);
    let s = state();
    s = record('initial-focus', s, {
        'initial focus on the first item of the grid': s.gridIndex === 0 && s.onScreen,
    }, { screenshot: shot('initial-focus') });
    s = await key('right-1', 'RIGHT', (b, a) => ({ 'next item': a.gridIndex === 1 }));
    const firstPage = s.gridItems;
    let loadedMore = false;
    for (let index = 1; index <= 40 && !loadedMore; index++) {
        s = await key(`down-${index}`, 'DOWN', (b, a) => (a.gridIndex === b.gridIndex ? {
            'last line: waits for the next page': a.gridScroll >= b.gridScroll,
        } : {
            // A shorter last line: its nearest item, to the left.
            'next line, same column (or the nearest item of a shorter line)': a.gridIndex > b.gridIndex &&
                (Math.abs(a.rect[0] - b.rect[0]) < 30 || (a.rect[0] < b.rect[0] && a.gridIndex === b.gridItems - 1)),
            'item on screen': a.onScreen,
        }), { screenshot: index === 3 });
        if (s.gridItems > firstPage) loadedMore = true;
    }
    s = await key('down-into-next-page', 'DOWN', (b, a) => ({ 'next page loaded': a.gridItems > firstPage, 'item on screen': a.onScreen }), { settleMs: 2000, screenshot: true });
    record('page-loaded', s, { 'more items after the end of the first page': loadedMore || s.gridItems > firstPage });
    s = await key('up-1', 'UP', (b, a) => ({ 'line above': a.gridIndex < b.gridIndex, 'item on screen': a.onScreen }));
    const left = s;
    s = await key('ok-opens-details', 'OK', (b, a) => ({ 'details opened': /^#\/(detail|metadetails)\//.test(a.hash) }), { settleMs: 3000, leaves: true });
    s = await key('back-restores-focus', 'BACK', (b, a) => ({
        'back on Discover': a.hash.indexOf('#/discover') === 0,
        'same item focused': a.gridIndex === left.gridIndex && a.title === left.title,
        'same scroll': a.gridScroll === left.gridScroll,
    }), { settleMs: 2500, screenshot: true });
    for (let index = 1; index <= 60 && s.gridIndex > 2; index++) {
        s = await key(`up-to-top-${index}`, 'UP', (b, a) => ({ 'line above': a.gridIndex < b.gridIndex }), { settleMs: 600 });
    }
    s = await key('up-to-filters', 'UP', (b, a) => ({ 'a filter above the item': a.gridIndex === null && a.inRoute && /button/.test(a.focused) }), { screenshot: true });
    s = await key('down-from-filters', 'DOWN', (b, a) => ({ 'back to the grid item': a.gridIndex !== null && a.gridIndex <= 2 }));
    // Discover was opened from a Board item (the nav bar link was clicked over CDP): Back comes back to it.
    s = await backToBoard('back-to-board', (a) => ({ 'focus back on the Board item': a.row === 0 && a.column === 0 }));
};

const search = async () => {
    await launch();
    await sleep(3000);
    let s = await key('up-to-search', 'UP', (b, a) => ({ 'search button of the top bar': /submit-button-container/.test(a.focused) }));
    s = await key('ok-opens-search', 'OK', (b, a) => ({ 'Search': a.hash.indexOf('#/search') === 0, 'search field focused': a.focused.indexOf('input') === 0 }), { settleMs: 3000, screenshot: true });
    // Typing is the keyboard's (F3.4): the text goes in over CDP, Enter submits it.
    evaluate('var input = document.activeElement; var set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(input, "star"); input.dispatchEvent(new Event("input", { bubbles: true })); return true;');
    cdp('key', 'ENTER');
    const resultsMs = await waitFor('var list = document.querySelector(".route-container:last-child [class*=search-content-]"); return !!list && list.querySelectorAll("a[href]").length > 0;', 60000);
    await sleep(2000);
    record('results', state(), { 'results shown': resultsMs !== null }, { screenshot: shot('results') });
    // The system takes this Back if the keyboard is up (it hides the keyboard; F3.2).
    if (state().keyboardVisible || state().keyboard === true) {
        run('node', ['webos/tools/remote.mjs', '--port', REMOTE_PORT, '--delay', '0', 'BACK']);
        await sleep(1500);
    }
    s = await key('down-to-results', 'DOWN', (b, a) => ({ 'first result': a.row !== null && a.column === 0 }));
    for (let index = 1; index <= 6; index++) {
        s = await key(`right-${index}`, 'RIGHT', (b, a) => ({ 'next result': a.column === b.column + 1 || a.column === b.column, 'item fully shown in its strip': a.inStrip }));
    }
    let rows = 0;
    for (let index = 1; index <= 6; index++) {
        const b = state();
        s = await key(`down-${index}`, 'DOWN', (before, after) => (after.row === before.row ? { 'last row: stays': true } : {
            'next row with items': after.row > before.row,
            'row title in view (row at the top of the list, or the list at its end)': after.rowTop >= 0 && (after.rowTop < 40 || after.listAtEnd),
            'item on screen': after.onScreen,
        }), { settleMs: 1500, screenshot: index === 2 });
        if (s.row === b.row) break;
        rows++;
    }
    record('result-rows-walked', s, { 'went down at least 1 row': rows >= 1 });
    const left = s;
    s = await key('ok-opens-details', 'OK', (b, a) => ({ 'details opened': /^#\/(detail|metadetails)\//.test(a.hash) }), { settleMs: 3000, leaves: true });
    s = await key('back-restores-focus', 'BACK', (b, a) => ({
        'back on Search': a.hash.indexOf('#/search') === 0,
        'same result focused (not the search field)': a.title === left.title && a.row === left.row,
        'keyboard not opened': !a.keyboardVisible || a.keyboard === false,
    }), { settleMs: 3000, screenshot: true });
    for (let index = 1; index <= rows; index++) {
        s = await key(`up-${index}`, 'UP', (b, a) => ({ 'previous row': a.row < b.row }));
    }
    s = await key('up-to-field', 'UP', (b, a) => ({ 'search field': a.focused.indexOf('input') === 0 }), { settleMs: 2000, screenshot: true });
    if (state().keyboardVisible || state().keyboard === true) {
        run('node', ['webos/tools/remote.mjs', '--port', REMOTE_PORT, '--delay', '0', 'BACK']);
        await sleep(1500);
    }
    s = await key('down-from-field', 'DOWN', (b, a) => ({ 'back to the result it came from': a.row === 0 }));
    // The history and suggestions menu of the SearchBar (cycle 1, A1): typing in the field opens it
    // under the field, over the first row. DOWN goes into it, and DOWN on its last entry goes on to
    // the results and closes it.
    s = await key('up-to-field-again', 'UP', (b, a) => ({ 'search field': a.focused.indexOf('input') === 0 }), { settleMs: 2000 });
    evaluate('var input = document.activeElement; var set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(input, "sta"); input.dispatchEvent(new Event("input", { bubbles: true })); return true;');
    await sleep(2000);
    if (state().keyboardVisible || state().keyboard === true) {
        run('node', ['webos/tools/remote.mjs', '--port', REMOTE_PORT, '--delay', '0', 'BACK']);
        await sleep(1500);
    }
    s = state();
    s = record('menu-open', s, { 'menu open under the field, field focused': s.menuOpen && s.focused.indexOf('input') === 0 }, { screenshot: shot('menu-open') });
    s = await key('down-into-menu', 'DOWN', (b, a) => ({ 'an entry of the menu': a.inMenu }), { screenshot: true });
    for (let index = 1; index <= 10 && s.inMenu; index++) {
        s = await key(`down-in-menu-${index}`, 'DOWN', (b, a) => (a.inMenu ? { 'next entry of the menu': a.title !== b.title } : {
            'out of the menu, to the results': a.row !== null,
            'menu closed': !a.menuOpen,
        }));
    }
    record('menu-left', s, { 'left the menu to the results, menu closed': s.row !== null && !s.menuOpen }, { screenshot: shot('menu-left') });
    s = await backToBoard('back-to-board', (a) => ({ 'focus back on the search button': /submit-button-container/.test(a.focused) }));
};

const SCENARIO_FNS = { board, discover, search };
for (const scenario of SCENARIOS) {
    report.scenario = scenario;
    report.steps = [];
    failures = 0;
    try {
        await SCENARIO_FNS[scenario]();
    } catch (error) {
        failures++;
        report.steps.push({ name: 'error', ok: false, failed: [error.message] });
        console.log(`[FALHOU] erro: ${error.message}`);
    }
    report.failures = failures;
    fs.writeFileSync(path.join(OUT, `f4.1a-${scenario}.json`), JSON.stringify(report, null, 2));
    console.log(`${scenario}: ${failures === 0 ? 'ok' : `${failures} falha(s)`}`);
    try {
        run('ares-launch', ['--device', DEVICE, '--close', APP_ID]);
    } catch {
        // already closed
    }
    await sleep(2000);
}
