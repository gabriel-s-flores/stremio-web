// Real local Chrome, or CDP_HTTP + TARGET_HINT for an existing webOS target.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';

const local = !process.env.CDP_HTTP;
const endpoint = process.env.CDP_HTTP || 'http://127.0.0.1:9229';
const label = process.env.T29_LABEL || (local ? 'chrome' : 'external');
const prefix = `tests/webos/t29-${label}`;
const root = path.resolve(process.env.T29_BUILD || 'build');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const errors = [], fontResponses = [], requests = new Map();
const report = { local, errors, fontResponses };
let server, browser, ws;
try {
    if (local) {
        server = http.createServer((req, res) => {
            let file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
            if (!file.startsWith(root + path.sep) && file !== root) return res.writeHead(403).end();
            if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
            if (!fs.existsSync(file)) return res.writeHead(404).end();
            res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream');
            fs.createReadStream(file).pipe(res);
        });
        await new Promise(resolve => server.listen(8099, '127.0.0.1', resolve));
        browser = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
            '--headless=new', '--remote-debugging-port=9229', '--user-data-dir=' + fs.mkdtempSync(path.join(os.tmpdir(), 'stremio-t29-')),
            '--no-first-run', '--no-default-browser-check', '--window-size=1920,1080', 'about:blank'
        ], { windowsHide: true, stdio: 'ignore' });
        browser.on('error', error => { report.launchError = String(error); });
        await delay(2000);
    }
    const targets = await (await fetch(endpoint + '/json', { signal: AbortSignal.timeout(10000) })).json();
    const target = targets.find(t => t.type === 'page' && (local || (process.env.TARGET_HINT && [t.id, t.title, t.url].some(v => v && v.includes(process.env.TARGET_HINT)))));
    if (!target) throw Error('Set TARGET_HINT to an explicit emulator/TV page');
    report.browser = await (await fetch(endpoint + '/json/version')).json();
    report.chromium68 = /(?:Chrome|Chromium)\/68\./.test(report.browser.Browser);
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
    let id = 0;
    const jobs = new Map();
    ws.onmessage = ({ data }) => {
        const m = JSON.parse(data), j = jobs.get(m.id), p = m.params;
        if (j) { jobs.delete(m.id); clearTimeout(j.timer); m.error ? j.reject(m.error) : j.resolve(m.result); }
        if (m.method === 'Network.requestWillBeSent') requests.set(p.requestId, p.request.url);
        if (m.method === 'Runtime.exceptionThrown') errors.push({ type: 'exception', detail: p.exceptionDetails.text });
        if (m.method === 'Runtime.consoleAPICalled' && p.type === 'error') errors.push({ type: 'console', detail: p.args.map(a => a.value || a.description).join(' ') });
        if (m.method === 'Log.entryAdded' && p.entry.level === 'error') errors.push({ type: 'log', detail: p.entry.text });
        if (m.method === 'Network.loadingFailed') errors.push({ type: 'network', url: requests.get(p.requestId), detail: p.errorText });
        if (m.method === 'Network.responseReceived') {
            const r = p.response;
            if (/\.(ttf|woff2)(?:$|\?)/.test(r.url)) fontResponses.push({ url: r.url, status: r.status, mimeType: r.mimeType });
            if (r.status >= 400) errors.push({ type: 'http', url: r.url, status: r.status });
        }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const n = ++id;
        const timer = setTimeout(() => { jobs.delete(n); reject(Error('CDP timeout: ' + method)); }, 30000);
        jobs.set(n, { resolve, reject, timer }); ws.send(JSON.stringify({ id: n, method, params }));
    });
    const evaluate = async expression => {
        const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
        return r.result.value;
    };
    await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Log.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Network.setBypassServiceWorker', { bypass: true });
    if (local) {
        await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
        await send('Emulation.setFocusEmulationEnabled', { enabled: true });
        await send('Page.navigate', { url: 'http://127.0.0.1:8099/#/debug/fonts-icons' });
    } else {
        await evaluate("location.hash = '#/debug/fonts-icons'");
        await send('Page.reload', { ignoreCache: true });
    }
    for (let attempt = 0; attempt < 40; attempt++) {
        if (await evaluate("!!document.querySelector('[data-webos-fonts-icons-fixture]')")) break;
        await delay(500);
    }
    Object.assign(report, await evaluate(fs.readFileSync('tools/t29-fonts-icons-probe.js', 'utf8')));
    if (report.viewport.width !== 1920 || report.viewport.height !== 1080) report.failures.push('expected 1920x1080');
    for (const name of ['PlusJakartaSans.ttf', 'TwemojiFlags.woff2']) {
        if (!fontResponses.some(r => r.url.endsWith('/fonts/' + name) && r.status === 200)) report.failures.push('missing successful font response: ' + name);
    }
    for (const focused of [false, true]) {
        await evaluate(focused ? "document.querySelector('[data-t29-icon]').focus()" : 'document.activeElement.blur()');
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(`${prefix}${focused ? '-focus' : ''}.png`, Buffer.from(shot.data, 'base64'));
    }
    await delay(1000);
    if (errors.length) report.failures.push('console/network errors recorded');
    if (report.failures.length) process.exitCode = 1;
    console.log(JSON.stringify({ browser: report.browser.Browser, chromium68: report.chromium68, failures: report.failures, errors }));
} catch (error) {
    report.error = String(error); process.exitCode = 1; console.error(error);
} finally {
    fs.writeFileSync(`${prefix}.json`, JSON.stringify(report, null, 2) + '\n');
    if (ws) ws.close();
    if (browser) browser.kill();
    if (server) server.close();
}
