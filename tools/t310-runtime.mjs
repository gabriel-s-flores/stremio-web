import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { connect } from './t33-cdp.mjs';

const directory = path.resolve(process.argv[2] || fs.readFileSync('tests/webos/t310-fixture-path.txt', 'utf8').replace(/^\uFEFF/, '').trim());
const map = JSON.parse(fs.readFileSync(path.join(directory, 'fixture.js.map'), 'utf8'));
const realSources = map.sources.filter(source => source.includes('/src/'));
for (const component of ['FileDrop/FileDrop.tsx', 'Discord/Discord.tsx', 'UpdaterBanner/UpdaterBanner.tsx', 'Settings/Settings.tsx', 'Menu/Menu.tsx', 'Interface/Interface.tsx', 'Player/Player.tsx', 'Shortcuts/Shortcuts.tsx']) {
    assert.ok(realSources.some(source => source.endsWith('/' + component)), 'Real component bundled: ' + component);
}
assert.ok(!map.sources.some(source => /stremio-core-web|\/src\/core\//.test(source)), 'No WASM core boot in fixture');
const { runChecks } = createRequire(import.meta.url)('es-check');
assert.equal(runChecks([{ ecmaVersion: 'es2018', files: [path.join(directory, 'fixture.js').replace(/\\/g, '/')] }]).success, true, 'ES2018 fixture');
fs.writeFileSync('tests/webos/t310-fixture-artifact.json', JSON.stringify({
    date: new Date().toISOString(), realSources, coreBundled: false, es2018: true,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, 'fixture.js'))).digest('hex'),
}, null, 2) + '\n');
const browser = process.env.T310_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'stremio-t310-browser-'));
const server = http.createServer((req, res) => {
    const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(directory, relative);
    if (!file.startsWith(directory + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
    res.end(fs.readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const child = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const delay = () => new Promise(resolve => setTimeout(resolve, 100));
let cdp;
const failures = [];
try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) await delay();
    const endpoint = 'http://127.0.0.1:' + fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
    const runtimeErrors = [];
    cdp = await connect('about:blank', endpoint, event => {
        if (event.method === 'Runtime.exceptionThrown' || event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') runtimeErrors.push(event);
    });
    await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
    const version = await cdp.send('Browser.getVersion');
    for (const [mode, url] of [
        ['hosted', `http://127.0.0.1:${server.address().port}/index.html`],
        ['packaged', pathToFileURL(path.join(directory, 'index.html')).href],
    ]) {
        const report = { mode, date: new Date().toISOString(), browser: version.product, runtime: 'isolated React fixture; desktop Chromium, not webOS emulator', checks: {} };
        runtimeErrors.length = 0;
        try {
            await cdp.send('Page.navigate', { url });
            for (let i = 0; i < 150; i++) {
                if (await cdp.evaluate('!!(window.__t310 && window.__t310.ready)')) break;
                await delay();
            }
            assert.equal(await cdp.evaluate('!!window.__t310.ready'), true, 'Fixture boot');
            // Exercise drag events, impossible shell events, activity updates and a rerender.
            await cdp.evaluate(`(async function(){['dragstart','dragover','dragleave','drop'].forEach(function(type){window.dispatchEvent(new Event(type,{cancelable:true}))});__t310.emit('autoupdater-show-notif');__t310.emit('discord-status',{connected:true});__t310.render();await new Promise(r=>setTimeout(r,200));})()`);
            report.tv = await cdp.evaluate('__t310.snapshot()');
            const check = (name, value) => { report.checks[name] = value; assert.equal(value, true, name); };
            check('tvNoDragListeners', report.tv.dragAdds.length === 0);
            check('tvNoInputOrOverlay', report.tv.fileInputs === 0 && report.tv.fileOverlays === 0);
            check('tvNoShellCalls', report.tv.shellCalls.length === 0);
            check('tvNoDesktopControls', report.tv.desktopControls.length === 0 && report.tv.shortcutsButtons === 0 && report.tv.shortcutsSections === 0 && !report.tv.updater);
            check('tvChildrenAndGamepadPreserved', report.tv.child && report.tv.gamepad);
            check('correctProtocol', report.tv.protocol === (mode === 'hosted' ? 'http:' : 'file:'));
            await cdp.evaluate('__t310.unmount()');
            report.tvCleanup = await cdp.evaluate('__t310.snapshot()');
            check('tvCleanupNoCalls', report.tvCleanup.dragRemoves.length === 0 && report.tvCleanup.shellCalls.length === 0);
            await cdp.evaluate('__t310.mount("desktop")');
            report.desktop = await cdp.evaluate('__t310.snapshot()');
            check('desktopFileDrop', report.desktop.fileInputs === 1 && report.desktop.fileOverlays === 1 && report.desktop.dragAdds.join(',') === 'dragstart,dragover,dragleave');
            check('desktopControls', report.desktop.desktopControls.length === 6 && report.desktop.shortcutsButtons === 1 && report.desktop.shortcutsSections === 1);
            check('desktopDiscordConnect', report.desktop.shellCalls.some(([op, name]) => op === 'send' && name === 'discord-connect'));
            await cdp.evaluate(`(async function(){__t310.emit('autoupdater-show-notif');__t310.emit('discord-status',{connected:true});window.dispatchEvent(new Event('dragover',{cancelable:true}));await new Promise(r=>setTimeout(r,200));})()`);
            check('desktopDragVisual', await cdp.evaluate(`document.querySelector('.file-drop-container').classList.contains('active')`));
            check('desktopUpdaterNotification', (await cdp.evaluate('__t310.snapshot()')).updaterVisible);
            await cdp.evaluate(`document.querySelector('[data-test="install"]').click()`);
            report.desktopAfterEvents = await cdp.evaluate('__t310.snapshot()');
            check('desktopUpdaterInstall', report.desktopAfterEvents.shellCalls.some(([op, name]) => op === 'send' && name === 'autoupdater-notif-clicked'));
            check('desktopDiscordActivity', report.desktopAfterEvents.shellCalls.some(([op, name]) => op === 'send' && name === 'discord-set-activity'));
            await cdp.evaluate(`(async function(){__t310.player=true;__t310.render();await new Promise(r=>setTimeout(r,200));})()`);
            check('desktopPlayerHidesUpdater', !(await cdp.evaluate('__t310.snapshot()')).updaterVisible);
            await cdp.evaluate('__t310.unmount()');
            report.desktopCleanup = await cdp.evaluate('__t310.snapshot()');
            check('desktopDragCleanup', report.desktopCleanup.dragRemoves.join(',') === report.desktopCleanup.dragAdds.join(','));
            for (const name of ['discord-status', 'autoupdater-show-notif']) {
                const calls = report.desktopCleanup.shellCalls.filter(([, event]) => event === name);
                check('cleanup-' + name, calls.filter(([op]) => op === 'on').length === calls.filter(([op]) => op === 'off').length);
            }
            // A second TV mount must remain inert after exercising the active components.
            await cdp.evaluate('__t310.mount("webos")');
            report.tvRemount = await cdp.evaluate('__t310.snapshot()');
            check('tvRemountInert', report.tvRemount.dragAdds.length === 0 && report.tvRemount.shellCalls.length === 0 && report.tvRemount.fileInputs === 0);
            check('zeroErrors', report.tvRemount.errors.length === 0 && report.tvRemount.unhandledrejections.length === 0 && runtimeErrors.length === 0);
            report.passed = true;
        } catch (error) { report.passed = false; report.failure = error.message; failures.push(mode); }
        report.runtimeErrors = runtimeErrors.slice();
        fs.writeFileSync(`tests/webos/t310-runtime-${mode}.json`, JSON.stringify(report, null, 2) + '\n');
        console.log(mode, report.passed ? 'PASS' : report.failure);
    }
} finally {
    if (cdp) { await cdp.send('Browser.close').catch(() => {}); cdp.close(); }
    child.kill(); server.close();
}
process.exitCode = failures.length ? 1 : 0;
