import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { connect } from './t33-cdp.mjs';

const [mode, endpoint, hint] = process.argv.slice(2);
if (!['hosted', 'packaged'].includes(mode) || !endpoint || !hint) throw Error('Usage: node tools/t39-runtime.mjs hosted|packaged CDP_ENDPOINT EXACT_URL_HINT');
const report = { mode, date: new Date().toISOString(), checks: {}, unhandledStart: 0 };
const c = await connect(hint, endpoint);
const wait = () => new Promise((resolve) => setTimeout(resolve, 700));
const key = async (k, code, number) => {
    for (const type of ['keyDown', 'keyUp']) await c.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: number });
    await wait();
};
const clickTest = async (test) => {
    await c.evaluate(`document.querySelector('[data-test="${test}"]').click()`);
    await wait();
};
const logText = () => c.evaluate(`document.querySelector('[data-test="log"]').textContent`);
const launch = (id) => execFileSync(process.execPath, [path.join(process.env.APPDATA, 'npm/node_modules/@webos-tools/cli/bin/ares-launch.js'), '-d', 'emulator', id], { timeout: 30000, stdio: 'pipe' });
try {
    await c.evaluate(`window.__t39InitialHash=location.hash;window.__t39Unhandled=0;window.addEventListener('unhandledrejection',()=>{window.__t39Unhandled++})`);
    // Write matrix.
    for (const test of ['write-available', 'write-missing-api', 'write-missing-method', 'write-sync', 'write-reject']) {
        await clickTest(test);
    }
    // Read matrix.
    for (const test of ['read-available', 'read-missing-api', 'read-missing-method', 'read-sync', 'read-reject', 'read-invalid']) {
        await clickTest(test);
    }
    // Selection matrix.
    for (const test of ['selection-approved', 'selection-denied', 'selection-missing']) {
        await clickTest(test);
    }
    const log = await logText();
    const expectLines = [
        'write:available:resolved',
        'write:missing-api:rejected',
        'write:missing-method:rejected',
        'write:sync:rejected',
        'write:reject:rejected',
        'read:available:resolved:https://example.org/t39?play=1',
        'read:missing-api:rejected',
        'read:missing-method:rejected',
        'read:sync:rejected',
        'read:reject:rejected',
        'read:invalid:rejected',
        'selection:approved:true',
        'selection:denied:false',
        'selection:missing:false',
    ];
    for (const line of expectLines) {
        report.checks[line] = log.includes(line);
    }
    // Fallback modal: selection, focus restore, Escape/Back, no navigation.
    await clickTest('fallback-open');
    report.checks.fallbackVisible = await c.evaluate(`!!document.querySelector('[data-test="clipboard-fallback-input"]')`);
    report.checks.fallbackReadonly = await c.evaluate(`document.querySelector('[data-test="clipboard-fallback-input"]').readOnly===true`);
    report.checks.fallbackSelection = await c.evaluate(`(function(){var i=document.querySelector('[data-test="clipboard-fallback-input"]');try{i.focus();i.click()}catch(e){}return i.selectionStart===0&&i.selectionEnd===i.value.length})()`);
    report.checks.fallbackStatus = await c.evaluate(`document.querySelector('[data-test="clipboard-fallback-status"]').textContent.length>0`);
    await key('Escape', 'Escape', 27);
    report.checks.fallbackEscape = await c.evaluate(`!document.querySelector('[data-test="clipboard-fallback-input"]')&&location.hash===window.__t39InitialHash&&document.activeElement.dataset.test==='fallback-open'`);
    await clickTest('fallback-open');
    // Back key 461 closes without navigation.
    for (const type of ['keyDown', 'keyUp']) await c.send('Input.dispatchKeyEvent', { type, key: 'Back', code: 'Back', windowsVirtualKeyCode: 461 });
    await wait();
    report.checks.fallbackBack = await c.evaluate(`!document.querySelector('[data-test="clipboard-fallback-input"]')&&location.hash===window.__t39InitialHash`);
    // Play modal matrix: http, magnet, empty, invalid.
    const playCase = async (value, expectHandled) => {
        await clickTest('play-open');
        await c.evaluate(`(function(v){var i=document.querySelector('[data-test="play-url-input"]');i.focus();document.execCommand&&document.execCommand('selectAll');i.value='';document.execCommand&&0;i.dispatchEvent(new Event('input',{bubbles:true}));var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;setter.call(i,v);i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'a',bubbles:true}));})(${JSON.stringify(value)})`);
        // Type via CDP for React controlled input reliability.
        await c.evaluate(`document.querySelector('[data-test="play-url-input"]').focus()`);
        // Clear then insert text.
        await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
        await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
        await c.evaluate(`(function(v){var i=document.querySelector('[data-test="play-url-input"]');var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;setter.call(i,v);i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));})(${JSON.stringify(value)})`);
        await wait();
        await c.evaluate(`Array.from(document.querySelectorAll('.modal-container [tabindex]')).find(function(e){return e.textContent==='Play URL/Magnet link'}).click()`);
        await wait();
        const state = await c.evaluate(`({open:!!document.querySelector('[data-test="play-url-input"]'),status:document.querySelector('[data-test="play-url-status"]').textContent,result:document.querySelector('[data-test="play-result"]').textContent,hash:location.hash})`);
        return state;
    };
    const httpState = await playCase('https://example.org/t39?play=1', true);
    report.checks.playHttpCloses = !httpState.open && httpState.result.includes('handled:http') && httpState.hash === await c.evaluate(`window.__t39InitialHash`);
    const magnetState = await playCase('magnet:?xt=urn:btih:63946b3d0c3d2c8e8f9a0b1c2d3e4f5a6b7c8d9e0&dn=t39', true);
    report.checks.playMagnetCloses = !magnetState.open && magnetState.result.includes('handled:magnet');
    const emptyState = await playCase('', false);
    report.checks.playEmptyStays = emptyState.open && emptyState.status.length > 0;
    await key('Escape', 'Escape', 27);
    const invalidState = await playCase('not a url', false);
    report.checks.playInvalidStays = invalidState.open && invalidState.status.length > 0;
    await key('Escape', 'Escape', 27);
    report.checks.playNoNavigation = await c.evaluate(`location.hash===window.__t39InitialHash`);
    report.checks.noUnhandled = (await c.evaluate(`window.__t39Unhandled`)) === 0;
    // Lifecycle with sibling app (same pattern as T3.8, browser absent here).
    launch('com.stremio.webos.t39.' + (mode === 'hosted' ? 'packaged' : 'hosted'));
    await wait();
    launch('com.stremio.webos.t39.' + mode);
    await wait();
    report.visibility = await c.evaluate(`document.querySelector('[data-test="visibility"]').textContent`);
    report.checks.lifecycleWithSiblingApp = report.visibility.includes('hidden') && report.visibility.endsWith('visible');
    report.checks.routePreserved = await c.evaluate(`location.hash===window.__t39InitialHash`);
    report.seamPassed = Object.values(report.checks).every(Boolean);
    report.acceptance = report.seamPassed ? 'passed' : 'incomplete';
} finally {
    c.close();
    fs.writeFileSync(`tests/webos/t39-runtime-${mode}.json`, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
}
