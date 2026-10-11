#!/usr/bin/env node
// System keyboard and external links on the emulator (F3.4): real remote keys
// (webos/tools/remote.mjs, port 19001) on the packaged app, the state read over CDP after each
// step. Run from the repo root, inside an emu-run reservation, after `pnpm webos:package`:
//   webos/tools/emu-run --timeout 15 -- node webos/tests/keyboard/emulator/run.mjs <out-dir> [keyboard|links]
// Writes <out-dir>/f34-<scenario>.json (every step with its state) and screenshots; the folder must
// be under $HOME (the VM screenshots are written by QEMU, in a flatpak).
//
// - keyboard: the search field and the addon URL field. OK on the field opens the keyboard instead
//   of submitting, the keyboard's Enter submits and closes it with the focus kept, Back is the
//   system's (F3.2). The emulator only opens the keyboard for a focus() after the app received a
//   key from the remote, hides it on any remote key and cannot press its keys, so "the Enter of the
//   keyboard" is the same keyCode injected over CDP while the keyboard is up (webos/keyboard/README.md).
// - links: a link of the profile menu (OK on it), window.open, a magnet link, the QR code read back
//   from the screenshot with zbarimg, Back and the focus, clipboard and mediaSession.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] || 'f34-emulator');
const SCENARIO = process.argv[3] || 'keyboard';
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
// A key injected into the page over CDP (keyCode as the page sees it), not through the system.
const injectKey = (key) => cdp('key', key);
const screenshot = (name) => {
    const file = path.join(OUT, `${name}.png`);
    try {
        cdp('screenshot', file);
        return path.basename(file);
    } catch (error) {
        return `failed: ${error.message.split('\n')[0]}`;
    }
};
// The whole VM screen: the only capture that shows the system keyboard.
const vmScreenshot = (name) => {
    const file = path.join(OUT, `${name}-vm.png`);
    try {
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
const closeOtherApps = () => runningApps().filter((id) => id !== APP_ID).forEach((id) => {
    try {
        run('ares-launch', ['--device', DEVICE, '--close', id]);
    } catch {
        // system apps may refuse to close
    }
});

const steps = [];
const record = (name, data) => {
    steps.push({ name, ...data });
    const mark = data.ok === undefined ? '-' : data.ok ? 'ok' : 'FALHOU';
    console.log(`[${mark}] ${name}${data.note ? ` (${data.note})` : ''}`);
};
// Records the step as ok when every named condition holds; the failing ones go in the note.
const check = (name, conditions, extra = {}) => {
    const failing = Object.keys(conditions).filter((key) => !conditions[key]);
    record(name, { ok: failing.length === 0, note: failing.join('; '), ...extra });
    return failing.length === 0;
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
    if (!window.__f34) {
        window.__f34 = { kb: [], keys: [], popstates: 0 };
        window.addEventListener('popstate', function () { window.__f34.popstates++; });
        document.addEventListener('keyboardStateChange', function (event) {
            window.__f34.kb.push(event.detail && event.detail.visibility);
        });
        window.addEventListener('keydown', function (event) { window.__f34.keys.push(event.keyCode); }, true);
    }
    window.__f34.describe = function (element) {
        if (!element) return null;
        if (element === document.body) return 'body';
        return element.tagName.toLowerCase() + (element.id ? '#' + element.id : '') +
            (typeof element.className === 'string' && element.className ? '.' + element.className.trim().split(/\\s+/).slice(0, 2).join('.') : '');
    };
    window.__f34.state = function () {
        var active = document.activeElement;
        var dialog = document.querySelector('[role="dialog"][aria-labelledby="webos-external-link-title"]');
        var svg = dialog && dialog.querySelector('svg');
        return {
            hash: location.hash,
            idx: window.history.state ? window.history.state.idx : null,
            popstates: window.__f34.popstates,
            kbEvents: window.__f34.kb.slice(),
            kbVisible: window.__f34.kb.length ? window.__f34.kb[window.__f34.kb.length - 1] : false,
            keys: window.__f34.keys.slice(-6),
            focused: window.__f34.describe(active),
            focusedHref: active && active.getAttribute ? active.getAttribute('href') : null,
            value: active && typeof active.value === 'string' ? active.value : null,
            readOnly: active && active.tagName === 'INPUT' ? active.readOnly : null,
            exitDialog: !!document.getElementById('webos-exit-dialog-title'),
            linkDialog: dialog ? {
                title: dialog.querySelector('#webos-external-link-title').textContent,
                url: dialog.querySelector('[class*="url"]').textContent,
                qr: svg ? svg.getAttribute('viewBox') : null,
                button: dialog.querySelector('button').textContent
            } : null,
            hasFocus: document.hasFocus()
        };
    };
    return true;
`;
const state = () => evaluate('return window.__f34.state();');

const boot = async () => {
    const env = { ...process.env, WEBOS_DEVICE: DEVICE };
    console.log(run('webos/scripts/ares.sh', ['install'], { env }).trim());
    console.log(run('webos/scripts/ares.sh', ['launch'], { env }).trim());
    const boardMs = await waitFor(`
        ${PAGE_HELPERS}
        return document.querySelectorAll('a[href^="#/metadetails"], a[href^="#/detail/"]').length > 0 && !!window.__webosBack;
    `, 240000, 2000);
    evaluate(PAGE_HELPERS);
    closeOtherApps();
    run('webos/scripts/ares.sh', ['launch'], { env });
    const focusMs = await waitFor('return document.hasFocus();', 20000);
    record('boot', { ok: boardMs !== null && focusMs !== null, note: `Board ${boardMs} ms, focus ${focusMs} ms`, state: state() });
    if (boardMs === null) {
        return false;
    }
    await sleep(3000);
    record('environment', {
        data: evaluate(`
            return {
                userAgent: navigator.userAgent,
                clipboard: typeof navigator.clipboard,
                mediaSession: typeof navigator.mediaSession,
                keyboardMethods: ['keyboardShow', 'keyboardHide', 'setManualKeyboardEnabled'].filter(function (name) { return typeof window.PalmSystem[name] === 'function'; }),
                isKeyboardVisible: window.PalmSystem.isKeyboardVisible
            };
        `),
    });
    screenshot('00-board');
    return true;
};

// Clicks the first element matching the expression, the way OK on a focused element does.
const click = (name, expression) => {
    const result = evaluate(`
        var element = ${expression};
        if (!element) return 'not found';
        element.focus && element.focus();
        element.click();
        return window.__f34.describe(element);
    `);
    record(name, { note: String(result), ok: result !== 'not found' });
    return result !== 'not found';
};

const keyboardScenario = async () => {
    // The system only opens the keyboard for focus() after the app got a key from the remote.
    // Measured, not asserted: the focus the search route takes by itself does not open it yet.
    click('01-open-search', 'document.querySelector("[class*=search-bar-container]")');
    await waitFor('return location.hash.indexOf("#/search") === 0;', 30000);
    await sleep(2500);
    const before = state();
    record('02-search-before-any-key', { data: before, note: `keyboard events: ${JSON.stringify(before.kbEvents)}`, screenshot: screenshot('02-search-before-any-key'), vm: vmScreenshot('02-search-before-any-key') });

    remote('INFO');
    await sleep(800);
    evaluate('var input = document.querySelector(".route-container:last-child input"); input.blur(); input.focus(); return true;');
    await sleep(2500);
    const opened = state();
    check('03-keyboard-opens-on-focus-after-a-key', {
        'keyboard visible': opened.kbVisible === true,
        'focus on the search field': /^input/.test(opened.focused || ''),
    }, { data: opened, vm: vmScreenshot('03-keyboard-open') });

    // Typing: digits of the remote reach the field (and hide the emulator's keyboard).
    remote('1', '2', '3');
    await sleep(1000);
    const typed = state();
    check('04-remote-digits-type-in-the-field', { 'value 123': typed.value === '123', 'still on #/search': typed.hash === '#/search' }, { data: typed, screenshot: screenshot('04-typed') });

    // OK with the keyboard down: does not submit, opens the keyboard.
    const beforeOk = state();
    remote('OK');
    await sleep(2500);
    const afterOk = state();
    check('05-ok-on-field-opens-keyboard-and-does-not-submit', {
        'no submit (hash unchanged)': afterOk.hash === beforeOk.hash && afterOk.hash === '#/search',
        'no new history entry': afterOk.idx === beforeOk.idx,
        'keyboard opened again': afterOk.kbVisible === true && afterOk.kbEvents.length > beforeOk.kbEvents.length,
        'focus kept on the field': /^input/.test(afterOk.focused || ''),
        'value kept': afterOk.value === '123',
    }, { before: beforeOk, after: afterOk, screenshot: screenshot('05-ok-opens-keyboard'), vm: vmScreenshot('05-ok-opens-keyboard') });

    // The keyboard's own Enter (injected over CDP while the keyboard is up): submits and closes it.
    const beforeEnter = state();
    injectKey('OK');
    await sleep(2500);
    const afterEnter = state();
    check('06-keyboard-enter-submits-and-closes-it-keeping-the-focus', {
        'submitted': afterEnter.hash === '#/search?search=123',
        'one history entry': afterEnter.idx === beforeEnter.idx + 1,
        'keyboard closed': afterEnter.kbVisible === false,
        'focus kept on the field': /^input/.test(afterEnter.focused || ''),
        'field editable again': afterEnter.readOnly === false,
    }, { before: beforeEnter, after: afterEnter, screenshot: screenshot('06-submitted'), vm: vmScreenshot('06-submitted') });

    // With the keyboard down, the arrows leave the field for the rest of the screen.
    remote('DOWN');
    await sleep(1000);
    const down = state();
    check('07-arrows-leave-the-field-after-submit', { 'focus left the field': !/^input/.test(down.focused || '') && down.focused !== 'body' }, { data: down, screenshot: screenshot('07-arrow-down') });

    // Back to the field: OK opens the keyboard, Back hides it (the system's), the next Back leaves (F3.2).
    remote('UP');
    await sleep(800);
    evaluate('var input = document.querySelector(".route-container:last-child input"); input.focus(); return true;');
    await sleep(2000);
    const refocused = state();
    record('08-field-focused-again', { data: refocused, note: `keyboard ${refocused.kbVisible ? 'opened by the focus' : 'down'}` });
    if (!refocused.kbVisible) {
        remote('OK');
        await sleep(2000);
    }
    const kbUp = state();
    const backBefore = state();
    remote('BACK');
    await sleep(2500);
    const backAfter = state();
    check('09-back-hides-the-keyboard-and-keeps-the-field', {
        'keyboard was up': kbUp.kbVisible === true,
        'keyboard hidden': backAfter.kbVisible === false,
        'still on the search route': backAfter.hash.indexOf('#/search') === 0,
        'no navigation': backAfter.popstates === backBefore.popstates,
    }, { before: backBefore, after: backAfter, vm: vmScreenshot('09-back-hides-keyboard') });

    // The addon URL field: autofocus in a modal of the Addons route.
    remote('BACK');
    await sleep(1500);
    click('10-open-addons', 'document.querySelector("a[href=\\"#/addons\\"]")');
    await waitFor('return location.hash.indexOf("#/addons") === 0;', 30000);
    await sleep(3000);
    if (click('11-open-add-addon-modal', 'document.querySelector("[class*=add-button-container]")')) {
        await sleep(2500);
        const modal = state();
        record('12-addon-url-field', { data: modal, note: `focused ${modal.focused}, keyboard ${modal.kbVisible}`, screenshot: screenshot('12-add-addon-modal'), vm: vmScreenshot('12-add-addon-modal') });
        evaluate('var input = document.querySelector("input[class*=addon-url-input]"); input.value = ""; input.focus(); return true;');
        remote('OK');
        await sleep(2500);
        const addonOk = state();
        check('13-ok-on-addon-url-field-opens-the-keyboard', { 'keyboard visible': addonOk.kbVisible === true, 'field focused': /^input/.test(addonOk.focused || '') }, { data: addonOk, vm: vmScreenshot('13-addon-ok') });
    }
};

const FOCUS_LINK = (href) => `
    var link = document.querySelector('a[href="${href}"]');
    if (!link) return 'not found';
    link.focus();
    return window.__f34.describe(link);
`;

const linksScenario = async () => {
    remote('INFO');
    await sleep(500);
    // The profile menu holds Help, Terms and Privacy as target=_blank links.
    if (!click('01-open-profile-menu', 'document.querySelector("[class*=menu-button-container]")')) {
        return;
    }
    await sleep(1000);
    const focusResult = evaluate(FOCUS_LINK('https://www.stremio.com/tos'));
    record('02-terms-link-focused', { ok: focusResult !== 'not found', note: String(focusResult), screenshot: screenshot('02-profile-menu') });
    const before = state();
    remote('OK');
    await sleep(1500);
    const opened = state();
    check('03-ok-on-link-shows-qr-dialog-and-does-not-navigate', {
        'dialog open': !!opened.linkDialog,
        'the link': opened.linkDialog && opened.linkDialog.url === 'https://www.stremio.com/tos',
        'a QR code': opened.linkDialog && /^0 0 \d+ \d+$/.test(opened.linkDialog.qr || ''),
        'title is the translation': opened.linkDialog && opened.linkDialog.title === 'Scan the QR code or go to',
        'focus on Close': /^button/.test(opened.focused || ''),
        'still in the app (hash unchanged)': opened.hash === before.hash,
        'page still alive': opened.hasFocus === true,
    }, { before, after: opened, screenshot: screenshot('03-qr-dialog') });

    // Read the QR code back from the screenshot, as a phone would.
    let decoded = '';
    try {
        decoded = run('zbarimg', ['--raw', '-q', path.join(OUT, '03-qr-dialog.png')]).replace(/\n$/, '');
    } catch (error) {
        decoded = `zbarimg failed: ${String(error.stdout || error.message).slice(0, 80)}`;
    }
    check('04-qr-code-decodes-from-the-screenshot', { 'zbarimg reads the link': decoded === 'https://www.stremio.com/tos' }, { note: decoded, decoded });

    // The dialog owns the remote: arrows, digits and Enter-less keys do not reach the page behind.
    remote('LEFT', 'DOWN', '1', '2');
    await sleep(800);
    const keysHeld = state();
    check('05-keys-stay-in-the-dialog', {
        'dialog still open': !!keysHeld.linkDialog,
        'focus on Close': /^button/.test(keysHeld.focused || ''),
        'no navigation': keysHeld.hash === before.hash,
    }, { data: keysHeld });

    const popBefore = state();
    remote('BACK');
    await sleep(1500);
    const closed = state();
    check('06-back-closes-the-dialog-and-returns-the-focus-to-the-link', {
        'dialog closed': !closed.linkDialog,
        'focus back on the link': closed.focusedHref === 'https://www.stremio.com/tos',
        'no navigation': closed.hash === popBefore.hash && closed.popstates === popBefore.popstates,
        'no quit dialog': !closed.exitDialog,
    }, { before: popBefore, after: closed, screenshot: screenshot('06-after-back') });

    // OK on the focused Close button closes it too.
    remote('OK');
    await sleep(1200);
    const reopened = state();
    remote('OK');
    await sleep(1200);
    const closedByOk = state();
    check('07-ok-on-close-closes-the-dialog', { 'reopened by OK on the link': !!reopened.linkDialog, 'closed by OK on Close': !closedByOk.linkDialog, 'focus back on the link': closedByOk.focusedHref === 'https://www.stremio.com/tos' }, { reopened, closedByOk });

    // window.open (Platform.openExternal, the login and "configure" buttons) and a magnet link.
    const urlBefore = evaluate('return location.href;');
    evaluate('window.__opened = window.open("https://www.stremio.com/warning#" + encodeURIComponent("https://example.com/configure?x=1&y=2"), "_blank"); return true;');
    await sleep(1000);
    const viaOpen = state();
    check('08-window-open-shows-the-qr-code', {
        'dialog open with the link': !!viaOpen.linkDialog && viaOpen.linkDialog.url === 'https://www.stremio.com/warning#https%3A%2F%2Fexample.com%2Fconfigure%3Fx%3D1%26y%3D2',
        'window.open returned null': evaluate('return window.__opened === null;') === true,
        'page not navigated': evaluate('return location.href;') === urlBefore,
    }, { data: viaOpen, screenshot: screenshot('08-window-open') });
    remote('BACK');
    await sleep(1000);
    const magnet = evaluate(`
        var a = document.createElement('a');
        a.href = 'magnet:?xt=urn:btih:abc';
        a.target = '_blank';
        document.body.appendChild(a);
        var event = new MouseEvent('click', { bubbles: true, cancelable: true });
        a.dispatchEvent(event);
        a.remove();
        return { prevented: event.defaultPrevented, url: location.href };
    `);
    await sleep(500);
    const afterMagnet = state();
    check('09-magnet-link-is-disabled', { 'click cancelled': magnet.prevented === true, 'no dialog': !afterMagnet.linkDialog, 'page not navigated': magnet.url === urlBefore }, { data: magnet });

    // The debts of the F1.6: clipboard and mediaSession.
    const clipboard = evaluate(`
        var out = { clipboard: typeof navigator.clipboard, writeText: typeof (navigator.clipboard || {}).writeText, mediaSession: typeof navigator.mediaSession };
        try {
            var p = navigator.clipboard.writeText('x');
            out.returnsPromise = !!(p && typeof p.then === 'function');
            out.threw = false;
        } catch (error) {
            out.threw = String(error);
        }
        return out;
    `);
    check('10-navigator-clipboard-does-not-throw', { 'clipboard exists': clipboard.clipboard === 'object', 'writeText returns a promise': clipboard.returnsPromise === true, 'no TypeError': clipboard.threw === false }, { data: clipboard });
    const outcome = evaluate(`
        window.__clip = 'pending';
        navigator.clipboard.writeText('x').then(function () { window.__clip = 'resolved'; }, function (error) { window.__clip = 'rejected:' + error.name; });
        return true;
    `);
    await sleep(500);
    record('11-clipboard-outcome', { note: String(evaluate('return window.__clip;')), outcome });
};

const SCENARIOS = { keyboard: keyboardScenario, links: linksScenario };

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
fs.writeFileSync(path.join(OUT, `f34-${SCENARIO}.json`), JSON.stringify({ date: new Date().toISOString(), failed: failed.map((step) => step.name), steps }, null, 2));
console.log(`\n${steps.filter((step) => step.ok === true).length} ok, ${failed.length} falharam -> ${path.join(OUT, `f34-${SCENARIO}.json`)}`);
process.exit(failed.length === 0 ? 0 : 1);
