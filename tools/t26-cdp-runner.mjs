// CDP smoke and targeted focus; uses an explicitly selected local test browser.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
const publicRoot = path.join(os.tmpdir(), 'stremio-t26');
const server = http.createServer((req, res) => {
    let file = path.join(publicRoot, decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
    if (!file.startsWith(publicRoot + path.sep)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(8096, '127.0.0.1', resolve));
const endpoint = process.env.CDP_HTTP || 'http://127.0.0.1:9226';
const targets = await (await fetch(endpoint + '/json')).json();
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(resolve => { ws.onopen = resolve; });
let id = 0;
const jobs = new Map();
ws.onmessage = ({ data }) => { const m = JSON.parse(data); const j = jobs.get(m.id); if (j) { jobs.delete(m.id); clearTimeout(j.timer); m.error ? j.reject(m.error) : j.resolve(m.result); } };
const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; const timer = setTimeout(() => { jobs.delete(n); reject(Error('CDP timeout: ' + method)); }, 30000); jobs.set(n, { resolve, reject, timer }); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { browser: await (await fetch(endpoint + '/json/version')).json(), smoke: [], focus: [], css: {} };
const errors = [];
ws.addEventListener('message', ({ data }) => { const m = JSON.parse(data); if (m.method === 'Runtime.exceptionThrown') errors.push({url:m.params.exceptionDetails.url,text:m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}); });
try {
    await send('Page.enable'); await send('Page.bringToFront'); await send('Emulation.setFocusEmulationEnabled', { enabled: true }); await send('Runtime.enable'); await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
    for (const mode of (process.env.FOCUS_ONLY ? [] : ['desktop', 'webos'])) {
        const dir = path.join(os.tmpdir(), 'stremio-t26', mode);
        const css = fs.readdirSync(dir, { recursive: true }).filter(f => f.endsWith('.css')).map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
        report.css[mode] = { snapType: /scroll-snap-type:/.test(css), snapAlign: /scroll-snap-align:/.test(css), calendarTop: /scroll-padding-top:/.test(css), logicalPadding: /scroll-padding-block-start:/.test(css) };
        await send('Network.setUserAgentOverride', { userAgent: mode === 'webos' ? 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/68.0.3440.106 Safari/537.36 WebAppManager' : report.browser['User-Agent'] });
        await send('Page.navigate', { url: `http://127.0.0.1:8096/${mode}/` }); await delay(4000);
        for (const route of ['/', '/discover', '/library', '/calendar', '/detail/movie/tt11561116/tt11561116', '/search', '/settings', '/addons', '/intro']) {
            await evaluate(`location.hash = ${JSON.stringify('#' + route)}`); await delay(1200);
            report.smoke.push({ mode, requested: route, ...await evaluate('({hash:location.hash,width:innerWidth,height:innerHeight,elements:document.body.querySelectorAll("*").length,text:document.body.innerText.slice(0,160)})') });
        }
        const shot = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`tests/webos/t26-smoke-${mode}.png`, Buffer.from(shot.data, 'base64'));
    }
    for (const platform of ['webos', 'desktop']) {
        await send('Network.setUserAgentOverride', { userAgent: platform === 'webos' ? 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 Chrome/68.0.3440.106 Safari/537.36 WebAppManager' : report.browser['User-Agent'] });
        await send('Page.navigate', { url: 'http://127.0.0.1:8096/fixture/?platform=' + platform + '#/debug/focus' }); await delay(4000);
        await evaluate(`(() => {
            var root = document.querySelector('[data-t26-fixture]'); if (!root) throw Error('Missing fixture');
            var row = root.querySelector('[class*="meta-items-container-"]'); window.t26Row = row;
            row.style.overflowX = 'auto'; row.style.overflowY = 'hidden';
            Array.from(row.children).forEach(function(item) { item.style.flex = '0 0 180px'; });
            window.t26Events = []; row.addEventListener('focusin', function(e){t26Events.push(e.target.className);}); window.t26Calls = []; var native = Element.prototype.scrollIntoView;
            Element.prototype.scrollIntoView = function(options) { window.t26Calls.push({card:Array.from(row.children).indexOf(this), options:options}); return native.call(this,options); };
        })()`);
        for (const index of [0, 2, 5]) for (const secondary of [false, true]) {
            await evaluate(`(() => { document.activeElement.blur(); t26Row.scrollLeft = ${index < 3 ? 10000 : 0}; t26Calls.length = 0; var card = t26Row.children[${index}]; var control = card.querySelector(${JSON.stringify(secondary ? '[class*="menu-label-container-"]' : '[class*="meta-item-link-"]')}); if (!control) throw Error('Missing card control'); control.focus({preventScroll:true}); })()`);
            await delay(700);
            const sample = await evaluate(`(() => { var c=t26Row.children[${index}], r=c.getBoundingClientRect(), p=t26Row.getBoundingClientRect(); return {hasFocus:document.hasFocus(),events:t26Events,ua:navigator.userAgent,calls:t26Calls, scrollLeft:t26Row.scrollLeft, overflow:t26Row.scrollWidth>t26Row.clientWidth, visible:r.left>=p.left-1&&r.right<=p.right+1, focused:c.contains(document.activeElement)}; })()`);
            report.focus.push({ platform, index, secondary, ...sample });
        }
        const shot = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`tests/webos/t26-focus-${platform}.png`, Buffer.from(shot.data, 'base64'));
        await evaluate(`(() => { document.activeElement.blur(); Array.from(t26Row.children).forEach(function(c){c.style.flex='1 1 0';c.style.minWidth='0';}); t26Row.style.width='1700px'; t26Calls.length=0; t26Row.children[0].querySelector('[class*="meta-item-link-"]').focus({preventScroll:true}); })()`);
        report.focus.push({ platform, noOverflow: true, ...await evaluate('({overflow:t26Row.scrollWidth>t26Row.clientWidth,calls:t26Calls})') });

    }
    report.errors = errors;
    report.failures = report.focus.filter(s => s.noOverflow ? s.overflow || s.calls.length : !s.focused || (s.platform === 'webos' ? !s.visible || s.calls.length !== 1 || s.calls[0].card !== s.index || JSON.stringify(s.calls[0].options) !== JSON.stringify({behavior:'smooth',block:'nearest',inline:'nearest'}) : s.calls.length !== 0));
    for (const s of report.smoke) if (s.width !== 1920 || s.height !== 1080 || s.elements < 50 || /ERR_CONNECTION|404 Not Found/.test(s.text)) report.failures.push(s);
    if (report.css.webos && (report.css.webos.snapType || report.css.webos.snapAlign || !report.css.desktop.snapType || !report.css.desktop.snapAlign)) report.failures.push('compiled snap mismatch');
    for (const error of errors) if (error.text !== 'AbortError: Transition was skipped') report.failures.push(error);
    for (const css of Object.values(report.css)) if (!css.calendarTop || css.logicalPadding) report.failures.push('compiled Calendar mismatch');
    console.log(JSON.stringify({smoke:report.smoke.length,focus:report.focus.length,failures:report.failures,errors}, null, 2));
    if (report.failures.length) process.exitCode = 1;
} finally { fs.writeFileSync('tests/webos/t26-cdp.json', JSON.stringify(report,null,2)+'\n'); ws.close(); server.close(); }
