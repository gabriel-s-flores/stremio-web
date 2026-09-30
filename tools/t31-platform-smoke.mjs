import fs from 'node:fs';
const [endpoint, hint, label] = process.argv.slice(2);
if (!endpoint || !hint || !label) throw Error('usage: node tools/t31-platform-smoke.mjs <CDP URL> <target hint> <label>');
const targets = await (await fetch(endpoint + '/json', { signal: AbortSignal.timeout(5000) })).json();
const target = targets.find(t => t.type === 'page' && (t.id === hint || t.url.includes(hint)));
if (!target) throw Error('Target not found');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map();
const errors = [];
ws.onmessage = ({ data }) => {
    const message = JSON.parse(data), job = pending.get(message.id);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') errors.push(message.params.entry);
    if (job) { pending.delete(message.id); clearTimeout(job.timer); message.error ? job.reject(Error(message.error.message)) : job.resolve(message.result); }
};
const send = (method, params = {}) => new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(Error('CDP timeout: ' + method)); }, 15000);
    pending.set(key, { resolve, reject, timer }); ws.send(JSON.stringify({ id: key, method, params }));
});
const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
};
try {
    const version = await send('Browser.getVersion');
    await send('Runtime.enable');
    await send('Log.enable');
    await evaluate("location.hash = '#/debug'");
    await send('Page.reload', { ignoreCache: true });
    let result;
    for (let i = 0; i < 45; i++) {
        result = await evaluate(`(function () {
            var metrics = {}; Array.prototype.forEach.call(document.querySelectorAll('dt'), function (dt) { metrics[dt.textContent] = dt.nextElementSibling.textContent; });
            return { userAgent: navigator.userAgent, url: location.href, name: metrics['platform.name'], isTV: metrics.isTV, isMobile: metrics.isMobile,
                viewport: { width: innerWidth, height: innerHeight, meta: (document.querySelector('meta[name="viewport"]') || {}).content } };
        })()`);
        if (result.name) break;
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const passed = result.name === 'webos' && result.isTV === 'true' && result.isMobile === 'false' && result.viewport.width === 1920 && result.viewport.height === 1080;
    fs.writeFileSync(`tests/webos/t31-runtime-${label}.json`, JSON.stringify({ date: new Date().toISOString(), version, ...result, errors, passed }, null, 2));
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`tests/webos/t31-runtime-${label}.png`, Buffer.from(screenshot.data, 'base64'));
    console.log(JSON.stringify({ version, ...result, errors, passed }, null, 2));
    if (!passed) process.exitCode = 1;
} finally { ws.close(); setTimeout(() => process.exit(process.exitCode || 0), 100); }

