// Existing authenticated targets only. Never overrides UA or clears storage.
// node tools/t210-visual-regression-runner.mjs <private-config.json>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const out = path.resolve('tests/webos');
const routes = [ ['board', '/'], ['discover', '/discover'], ['library', '/library'],
    ['calendar', '/calendar'], ['metadetails', '/detail/movie/tt11561116/tt11561116'],
    ['search', '/search'], ['player', '/debug/player'], ['settings', '/settings'],
    ['addons', '/addons'], ['intro', '/intro'] ];
const summary = { started: new Date().toISOString(), status: 'blocked', targets: {}, pairs: [], failures: [],
    review: 'pending manual side-by-side review; no pixel threshold', acceptedDifferences: [],
    preflightArtifact: 't210-emulator-preflight.json (separate observation; not a validated gallery target)' };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const json = (file, value) => fs.writeFileSync(path.join(out, file), JSON.stringify(value, null, 2) + '\n');
const get = async url => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw Error('CDP HTTP ' + response.status);
        return await response.json();
    } finally { clearTimeout(timer); }
};
// Do not persist console arguments, query strings, storage values or DOM text.
const safeURL = value => { try { const u = new URL(value); return u.origin + u.pathname + u.hash.split('?')[0]; } catch { return '[invalid URL]'; } };
async function connect(endpoint, targetId, events) {
    const targets = await get(endpoint + '/json');
    const target = targets.find(t => t.type === 'page' && t.id === targetId);
    if (!target) throw Error('Exact page target ID required');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('CDP connection timeout')), 10000);
        ws.onopen = () => { clearTimeout(timer); resolve(); };
        ws.onerror = () => { clearTimeout(timer); reject(Error('CDP connection failed')); };
    });
    let id = 0;
    const pending = new Map();
    ws.onmessage = ({ data }) => {
        const m = JSON.parse(data), job = pending.get(m.id);
        if (job) { clearTimeout(job.timer); pending.delete(m.id); m.error ? job.reject(Error(m.error.message)) : job.resolve(m.result); }
        else if (m.method) events(m.method, m.params);
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
        const n = ++id, timer = setTimeout(() => { pending.delete(n); reject(Error('CDP timeout: ' + method)); }, 180000);
        pending.set(n, { resolve, reject, timer }); ws.send(JSON.stringify({ id: n, method, params }));
    });
    return { target, send, close: () => { for (const j of pending.values()) { clearTimeout(j.timer); j.reject(Error('CDP closed')); } ws.close(); },
        evaluate: async expression => {
            const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
            if (r.exceptionDetails) throw Error('Probe evaluation failed');
            return r.result.value;
        } };
}
fs.mkdirSync(out, { recursive: true });
try {
    summary.availability = await Promise.all([9226, 9998].map(async port => {
        try { const v = await get(`http://127.0.0.1:${port}/json/version`); return { port, available: true, browser: v.Browser }; }
        catch { return { port, available: false }; }
    }));
    if (!process.argv[2]) throw Error('Private config required: webos/desktop endpoint, targetId, origin, buildDirectory, sessionProbe');
    const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    for (const mode of ['webos', 'desktop']) {
        const cfg = config[mode];
        if (!cfg?.endpoint || !cfg.targetId || !cfg.origin || !cfg.buildDirectory || !cfg.sessionProbe) throw Error('Incomplete ' + mode + ' configuration');
        const report = summary.targets[mode] = { routes: [], errors: [], assets: [] };
        const assets = new Map();
        let currentRoute = 'boot';
        const cdp = await connect(cfg.endpoint, cfg.targetId, (method, p) => {
            if (method === 'Network.responseReceived') {
                if (p.response.status >= 400) report.errors.push({ route: currentRoute, type: 'http', status: p.response.status, url: safeURL(p.response.url) });
                if (/\/(scripts\/main.js|styles\/main.css)$/.test(p.response.url)) assets.set(p.requestId, p.response.url);
            }
            if (method === 'Network.loadingFailed') report.errors.push({ route: currentRoute, type: 'network', canceled: !!p.canceled });
            if (method === 'Runtime.exceptionThrown' || (method === 'Runtime.consoleAPICalled' && p.type === 'error') || (method === 'Log.entryAdded' && p.entry.level === 'error')) {
                report.errors.push({ route: currentRoute, type: method, detail: 'Content withheld to avoid persisting session data' });
            }
        });
        try {
            report.runtime = await cdp.send('Browser.getVersion');
            report.browser = report.runtime.product;
            // LG WAM leaves product empty. Require the native V8 + revision tuple as
            // corroboration; a Chrome 68 UA override on modern Chrome cannot pass.
            const lg68 = !report.browser && report.runtime.jsVersion === '6.8.275.26' &&
                report.runtime.revision === '@cbd6ac4848a540ea6646d4f79700cf531e4eb9f9' &&
                /Chrome\/68\.0\.3440\.106\b/.test(report.runtime.userAgent);
            if (lg68) report.browser = 'Chrome/68.0.3440.106';
            report.versionEvidence = lg68 ? 'LG WAM native CDP revision + V8 + UA' : 'Browser.getVersion product';
            if (mode === 'webos' && !/^(Chrome|Chromium)\/68\.0\.3440\.106$/.test(report.browser)) throw Error('Real Chromium 68.0.3440.106 required');
            report.targetId = cdp.target.id;
            if (new URL(cdp.target.url).origin !== cfg.origin) throw Error('Target origin mismatch');
            for (const domain of ['Page', 'Runtime', 'Network', 'Log']) await cdp.send(domain + '.enable');
            await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
            await cdp.send('Network.setBypassServiceWorker', { bypass: true });
            await cdp.send('Page.reload', { ignoreCache: true });
            await sleep(5000);
            report.viewport = await cdp.evaluate('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,scale:window.visualViewport ? visualViewport.scale : null})');
            if (report.viewport.width !== 1920 || report.viewport.height !== 1080 || report.viewport.dpr !== 1 || report.viewport.scale !== 1) throw Error('Native 1920x1080 viewport and scale 1 required');
            for (const [requestId, url] of assets) {
                const body = await cdp.send('Network.getResponseBody', { requestId });
                const relative = new URL(url).pathname.replace(/^\//, '');
                const local = path.resolve(cfg.buildDirectory, relative);
                if (!local.startsWith(path.resolve(cfg.buildDirectory) + path.sep)) throw Error('Invalid asset path');
                const decoded = Buffer.from(body.body, body.base64Encoded ? 'base64' : 'utf8');
                const actual = hash(decoded);
                if (actual !== hash(fs.readFileSync(local))) throw Error('Served build differs from disk');
                if (relative.endsWith('/scripts/main.js') && !decoded.toString('utf8').includes('data-webos-player-fixture')) throw Error('Single debug build with Player fixture required');
                report.assets.push({ path: relative, sha256: actual });
            }
            if (report.assets.length !== 2) throw Error('Both served main.js and main.css must be verified');
            const shoot = async name => {
                const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
                fs.writeFileSync(path.join(out, `t210-${name}.${mode}.png`), Buffer.from(data, 'base64'));
            };
            const focus = async name => {
                await cdp.evaluate(`window.__t25FocusExpectedBuild = '${mode}'`);
                const probe = await cdp.evaluate(fs.readFileSync('tools/t25-focus-probe.js', 'utf8'));
                await cdp.evaluate('window.__t25FocusProbe.select(0)');
                await sleep(300); await shoot(name + '-focus');
                return { controls: probe.samples.length, failures: probe.failures.map(f => typeof f === 'string' ? f : { index: f.index, errors: f.errors }) };
            };
            for (const [name, route] of routes) {
                currentRoute = name;
                await cdp.evaluate(`location.hash = ${JSON.stringify('#' + route)}`);
                await sleep(4000);
                const state = await cdp.evaluate(`({url:location.href, content:document.body.innerText.trim().length,
                    catalog:Array.from(document.querySelectorAll('[class*="meta-item"] img')).filter(function(i){return i.complete && i.naturalWidth && i.getBoundingClientRect().width > 0;}).length,
                    player:!!document.querySelector('[data-webos-player-fixture]'), overflow:document.documentElement.scrollWidth>innerWidth})`);
                const session = await cdp.evaluate(cfg.sessionProbe);
                // Probe returns only a boolean and a non-secret, pseudonymous session label.
                const r = { name, url: safeURL(state.url), authenticated: session?.authenticated === true,
                    sessionHash: session?.identity ? hash(String(session.identity)) : null, catalog: state.catalog, failures: [] };
                if (new URL(state.url).hash !== '#' + route) r.failures.push('unexpected redirect');
                if (!state.content) r.failures.push('empty route');
                if (state.overflow) r.failures.push('document overflow');
                if (name === 'board' && !state.catalog) r.failures.push('catalog not visible');
                if (['library', 'calendar'].includes(name) && !r.authenticated) r.failures.push('authentication required');
                if (!r.sessionHash) r.failures.push('session identity unverified');
                if (name === 'player' && !state.player) r.failures.push('debug Player fixture missing');
                await shoot(name);
                r.focus = await focus(name);
                if (mode === 'webos') {
                    const layout = await cdp.evaluate(fs.readFileSync('tools/t28-layout-probe.js', 'utf8'));
                    r.layout = { viewport: layout.viewport, insets: layout.insets, failures: layout.failures,
                        controls: layout.samples.length, documentOverflowX: layout.documentOverflowX };
                    await cdp.evaluate("var frame = document.getElementById('t28-safe-frame'); if (frame) frame.remove();");
                }
                report.routes.push(r);
            }
            currentRoute = 'focus-fixture';
            await cdp.evaluate("location.hash = '#/debug/focus'"); await sleep(2000);
            report.fixture = { rings: await focus('fixture') };
            for (const [name, action, selector] of [
                ['menu', "document.querySelector('[data-focus-case=menu] button').click()", 'button[class*="option-container-"]'],
                ['modal', "document.querySelector('[data-focus-case=modal] [tabindex]').click()", '[class*="modal-dialog-container-"]']
            ]) {
                await cdp.evaluate("location.hash = '#/debug/focus'"); await cdp.send('Page.reload', { ignoreCache: true }); await sleep(2000);
                await cdp.evaluate(action); await sleep(400);
                await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})${name === 'menu' ? '.parentElement' : ''}.setAttribute('data-t25-probe-root','')`);
                await shoot('fixture-' + name); report.fixture[name] = await focus('fixture-' + name);
            }
            const strict = spawnSync(process.execPath, ['scripts/verify-webos-ui.mjs', cfg.buildDirectory,
                '--cdp-http', cfg.endpoint, '--cdp', cfg.targetId, '--route', '#/debug/player', '--player', '--strict-player',
                '--expected-player', 'PlayerDebugFixture', '--output', path.join(out, `t210-player-strict.${mode}.json`),
                '--screenshots', path.join(out, `t210-player-strict-${mode}`)], { encoding: 'utf8', timeout: 240000, windowsHide: true });
            report.strictPlayerExitCode = strict.status;
        } finally { cdp.close(); }
    }
    for (const [name] of routes) {
        const w = summary.targets.webos.routes.find(r => r.name === name), d = summary.targets.desktop.routes.find(r => r.name === name);
        summary.pairs.push({ name, sessionMatches: !!w.sessionHash && w.sessionHash === d.sessionHash, review: 'pending' });
    }
    for (const [mode, report] of Object.entries(summary.targets)) {
        if (report.errors.length || report.strictPlayerExitCode !== 0 || report.routes.some(r => r.failures.length || r.focus.failures.length || r.layout?.failures.length) ||
            Object.values(report.fixture).some(f => f.failures.length)) summary.failures.push(mode + ': runtime/fixture failures require review');
    }
    if (summary.pairs.some(p => !p.sessionMatches)) summary.failures.push('Desktop/webOS session mismatch');
    summary.status = summary.failures.length ? 'collected-with-failures' : 'awaiting-review';
    const rows = routes.map(([name]) => [name, name + '-focus']).flat().map(name => `<tr><th>${name}</th><td><img src="t210-${name}.desktop.png"></td><td><img src="t210-${name}.webos.png"></td></tr>`).join('\n');
    fs.writeFileSync(path.join(out, 't210-gallery.html'), `<!doctype html><meta charset="utf-8"><title>T2.10 — revisão manual</title><style>body{background:#222;color:white;font:16px sans-serif}table{width:100%}td{width:48%}img{width:100%}</style><h1>T2.10 — desktop / webOS</h1><p>Revisão manual pendente. Sem limiar de pixels.</p><table>${rows}</table>`);
} catch (error) { summary.failures.push(error.message); }
finally { json('t210-summary.json', summary); }
// Collection is never equivalent to visual approval.
process.exitCode = summary.status === 'blocked' ? 1 : 2;
