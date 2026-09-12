// Dedicated local browser by default. CDP_HTTP + TARGET_HINT attach to emulator/TV.
// Build with build:webos:debug for the existing idle Player fixture.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';

const out = 'tests/webos';
const root = path.resolve(process.env.T28_BUILD || 'build');
const endpoint = process.env.CDP_HTTP || 'http://127.0.0.1:9228';
const local = !process.env.CDP_HTTP;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = local ? http.createServer((req, res) => {
    let file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
}) : null;
let browser, ws;
const reports = [];
const summary = { runtime: local ? 'local Chrome; not webOS validation' : 'external CDP target', reports };
try {
    if (local) {
        await new Promise(resolve => server.listen(8098, '127.0.0.1', resolve));
        browser = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
            '--headless=new', '--remote-debugging-port=9228', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'stremio-t28-')),
            '--no-first-run', '--no-default-browser-check', '--window-size=1920,1080', 'about:blank'
        ], { windowsHide: true, stdio: 'ignore' });
        await delay(2000);
    }
    const targets = await (await fetch(endpoint + '/json', { signal: AbortSignal.timeout(10000) })).json();
    const target = targets.find(t => t.type === 'page' && (local || [t.id, t.title, t.url].some(v => v && v.includes(process.env.TARGET_HINT))));
    if (!target) throw Error('Set TARGET_HINT to an explicit emulator/TV page');
    summary.browser = await (await fetch(endpoint + '/json/version')).json();
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let id = 0;
    const jobs = new Map();
    ws.onmessage = ({ data }) => { const m = JSON.parse(data), j = jobs.get(m.id); if (j) { jobs.delete(m.id); clearTimeout(j.timer); m.error ? j.reject(m.error) : j.resolve(m.result); } };
    const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; const timer = setTimeout(() => { jobs.delete(n); reject(Error('CDP timeout: ' + method)); }, 60000); jobs.set(n, { resolve, reject, timer }); ws.send(JSON.stringify({ id: n, method, params })); });
    const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Network.setBypassServiceWorker', { bypass: true });
    if (local) {
        await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
        await send('Emulation.setFocusEmulationEnabled', { enabled: true });
        await send('Network.setUserAgentOverride', { userAgent: 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/68.0.3440.106 Safari/537.36 WebAppManager' });
        await send('Page.navigate', { url: 'http://127.0.0.1:8098/' });
    } else await send('Page.reload', { ignoreCache: true });
    await delay(5000);
    const probe = fs.readFileSync('tools/t28-layout-probe.js', 'utf8');
    for (const [name, route] of [
        ['board', '/'], ['discover', '/discover'], ['library', '/library'], ['calendar', '/calendar'],
        ['metadetails', '/detail/movie/tt11561116/tt11561116'], ['search', '/search'], ['player-idle-fixture', '/debug/player'],
        ['settings', '/settings'], ['addons', '/addons'], ['intro', '/intro']
    ]) {
        if (process.env.T28_ROUTE && name !== process.env.T28_ROUTE) continue;
        await evaluate(`location.hash = ${JSON.stringify('#' + route)}`); await delay(2200);
        await evaluate(`(() => { var old = document.getElementById('t28-safe-frame'); if (old) old.remove(); var frame = document.createElement('div'); frame.id = 't28-safe-frame'; frame.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px dashed #00ffad;left:var(--safe-area-inset-left);right:var(--safe-area-inset-right);top:var(--safe-area-inset-top);bottom:var(--safe-area-inset-bottom)'; document.body.appendChild(frame); })()`);
        const initial = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(`${out}/t28-${name}.png`, Buffer.from(initial.data, 'base64'));
        const report = await evaluate(probe);
        report.requestedRoute = route;
        if (new URL(report.url).hash.split('?')[0] !== '#' + route) report.failures.push('route redirected');
        if (Object.values(report.insets).some(v => !Number.isFinite(v)) || report.insets.left !== 48 || report.insets.top !== 27) report.failures.push('unexpected default insets');
        fs.writeFileSync(`${out}/t28-${name}.json`, JSON.stringify(report, null, 2) + '\n');
        await evaluate(`(() => { var controls = Array.from(document.querySelectorAll('button,input,[tabindex]')); var first = controls.find(el => { var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top >= 27 && r.bottom <= 1053 && r.left >= 48 && r.right <= 1872; }); if (first) first.focus(); })()`);
        await delay(300);
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(`${out}/t28-${name}-focus.png`, Buffer.from(shot.data, 'base64'));
        reports.push({ name, controls: report.samples.length, smallText: report.typography.filter(t => t.fontSize < 21.5).length, failures: report.failures });
        console.log(JSON.stringify(reports[reports.length - 1]));
    }
    if (reports.some(r => r.failures.length)) process.exitCode = 1;
} catch (error) {
    summary.error = String(error); process.exitCode = 1; console.error(error);
} finally {
    fs.writeFileSync(`${out}/t28-runtime-summary${process.env.T28_ROUTE ? '-' + process.env.T28_ROUTE : ''}.json`, JSON.stringify(summary, null, 2) + '\n');
    if (ws) ws.close();
    if (browser) browser.kill();
    if (server) server.close();
}
