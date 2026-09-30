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

const directory = path.resolve(process.argv[2] || fs.readFileSync('tests/webos/t311-fixture-path.txt', 'utf8').replace(/^\uFEFF/, '').trim());
const map = JSON.parse(fs.readFileSync(path.join(directory, 'fixture.js.map'), 'utf8'));
const sources = map.sources.filter(source => source.includes('/src/'));
for (const component of ['Intro/Intro.js', 'CredentialsTextInput/CredentialsTextInput.js', 'PasswordResetModal/PasswordResetModal.js', 'Intro/useFacebookLogin.ts', 'Intro/useAppleLogin.ts', 'TextInput/TextInput.tsx', 'Checkbox/Checkbox.tsx', 'Button/Button.tsx']) {
    assert.ok(sources.some(source => source.endsWith('/' + component)), 'Real component: ' + component);
}
assert.ok(!map.sources.some(source => /stremio-core-web|\/src\/core\//.test(source)));
const { runChecks } = createRequire(import.meta.url)('es-check');
assert.equal(runChecks([{ ecmaVersion: 'es2018', files: [path.join(directory, 'fixture.js').replace(/\\/g, '/')] }]).success, true);
fs.writeFileSync('tests/webos/t311-fixture-artifact.json', JSON.stringify({ sources, coreBundled: false, es2018: true,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, 'fixture.js'))).digest('hex') }, null, 2) + '\n');
const browser = process.env.T311_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'stremio-t311-browser-'));
const server = http.createServer((req, res) => {
    const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(directory, relative);
    if (!file.startsWith(directory + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    res.end(fs.readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const child = spawn(browser, ['--headless=new', '--disable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const delay = () => new Promise(resolve => setTimeout(resolve, 100));
let cdp, failed = false;
try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) await delay();
    const endpoint = 'http://127.0.0.1:' + fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
    let runtimeErrors = 0;
    cdp = await connect('about:blank', endpoint, event => { if (event.method === 'Runtime.exceptionThrown') runtimeErrors++; });
    await cdp.send('Runtime.enable'); await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    const version = await cdp.send('Browser.getVersion');
    const suite = fs.readFileSync('tools/t311-browser-checks.js', 'utf8');
    for (const [mode, url] of [['hosted', `http://127.0.0.1:${server.address().port}/index.html`], ['packaged', pathToFileURL(path.join(directory, 'index.html')).href]]) {
        runtimeErrors = 0;
        const report = { mode, date: new Date().toISOString(), browser: version.product, emulator: false, completeApp: false };
        try {
            await cdp.evaluate('if(window.__t311) window.__t311.ready = false');
            await cdp.send('Page.navigate', { url });
            for (let i = 0; i < 150; i++) { if (await cdp.evaluate('!!(window.__t311 && window.__t311.ready)')) break; await delay(); }
            assert.equal(await cdp.evaluate('!!(window.__t311 && window.__t311.ready)'), true);
            // Keep the promise rooted and poll completion; do not put the whole
            // suite inside the shared CDP helper's single-request timeout.
            await cdp.evaluate(suite + '\nvoid (__t311.run = t311BrowserChecks().then(result => { __t311.result = result; __t311.finished = true; }, () => { __t311.result = { passed:false, checks:__t311.checks, harnessFailure:true }; __t311.finished = true; }))');
            for (let i = 0; i < 300; i++) { if (await cdp.evaluate('!!__t311.finished')) break; await delay(); }
            assert.equal(await cdp.evaluate('!!__t311.finished'), true);
            Object.assign(report, await cdp.evaluate('__t311.result'));
            report.runtimeErrors = runtimeErrors;
            report.passed = report.passed && runtimeErrors === 0;
        } catch (error) {
            report.passed = false; report.harnessFailure = true;
            report.failureKinds = { nullAccess: /null/.test(error.message), referenceError: /ReferenceError/.test(error.message), typeError: /TypeError/.test(error.message) };
            report.diagnostics = await cdp.evaluate('({ready:!!__t311.ready, errors:__t311.errors, consoleErrors:__t311.consoleErrors, checks:__t311.checks || {}})');
        }
        fs.writeFileSync(`tests/webos/t311-runtime-${mode}.json`, JSON.stringify(report, null, 2) + '\n');
        console.log(mode, report.passed ? 'PASS' : 'FAIL', Object.entries(report.checks || {}).filter(([, value]) => !value).map(([name]) => name));
        failed ||= !report.passed;
    }
} finally {
    if (cdp) { await cdp.send('Browser.close').catch(() => {}); cdp.close(); }
    child.kill(); server.close();
}
process.exitCode = failed ? 1 : 0;
