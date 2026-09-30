// Existing CDP target only. CDP_HTTP defaults to the webOS emulator endpoint.
// node tools/t25-focus-runner.mjs <webos|desktop> <target-hint> [route-name]
import fs from 'node:fs';

const [mode, hint, only] = process.argv.slice(2);
if (!['webos', 'desktop'].includes(mode) || !hint) throw new Error('Usage: <webos|desktop> <target-hint> [route-name]');
const endpoint = process.env.CDP_HTTP || 'http://127.0.0.1:9998';
const targets = await (await fetch(`${endpoint}/json`, { signal: AbortSignal.timeout(10000) })).json();
const target = targets.find((t) => [t.id, t.url, t.title].some((v) => v?.includes(hint)));
if (!target) throw new Error(`No target matching ${hint}`);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map();
ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const job = pending.get(message.id);
    if (job) { pending.delete(message.id); clearTimeout(job.timer); message.error ? job.reject(message.error) : job.resolve(message.result); }
};
function send(method, params = {}) {
    return new Promise((resolve, reject) => {
        const messageId = ++id;
        const timer = setTimeout(() => { pending.delete(messageId); reject(new Error(`Timeout: ${method}`)); }, 180000);
        pending.set(messageId, { resolve, reject, timer });
        ws.send(JSON.stringify({ id: messageId, method, params }));
    });
}
async function evaluate(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const routes = [
    ['board', '#/'], ['discover', '#/discover'], ['library', '#/library'], ['calendar', '#/calendar'],
    ['metadetails', '#/detail/movie/tt11561116/tt11561116'], ['search', '#/search'],
    ['settings', '#/settings'], ['addons', '#/addons'], ['intro', '#/intro'],
    ...(mode === 'webos' || ['player', 'fixture'].includes(only) ? [['player', '#/debug/player'], ['fixture', '#/debug/focus']] : []),
];
const reports = [];
const probe = fs.readFileSync('tools/t25-focus-probe.js', 'utf8');
fs.mkdirSync('tests/webos', { recursive: true });
async function capture(name) {
    await evaluate(`window.__t25FocusExpectedBuild = ${JSON.stringify(mode)}`);
    const report = await evaluate(probe);
    if (!Array.isArray(report?.failures)) throw new Error('Invalid probe report');
    fs.writeFileSync(`tests/webos/t25-${name}.${mode}.json`, JSON.stringify(report, null, 2) + '\n');
    // Preserve representative focused surfaces, including failures for diagnosis.
    const indices = [...new Set([0, ...report.samples.filter((s) => s.fixtureCase || s.failures.length).map((s) => s.index)])];
    for (const index of indices) {
        if (!report.samples.some((s) => s.index === index)) continue;
        if (!await evaluate(`window.__t25FocusProbe.select(${index})`)) continue;
        await delay(180);
        const { data } = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(`tests/webos/t25-${name}-${index}.${mode}.png`, Buffer.from(data, 'base64'));
    }
    reports.push({ name, count: report.samples.length, failures: report.failures, clipping: report.samples.filter((s) => s.clipping.length).map((s) => ({ index: s.index, clipping: s.clipping })) });
    console.log(`${mode} ${name}: ${report.samples.length} controls; ${report.failures.length} failures`);
}
try {
    await send('Page.enable');
    // Rebuilds share the Git hash in asset URLs; never measure the previous CSS.
    await send('Network.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Network.setBypassServiceWorker', { bypass: true });
    await send('Page.reload', { ignoreCache: true });
    await delay(4000);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1919, y: 1079 });
    for (const [name, route] of routes.filter(([name]) => !only || name === only)) {
        await evaluate(`location.hash = ${JSON.stringify(route)}`);
        await delay(3500);
        await capture(name);
        if (name === 'fixture') {
            await evaluate(`document.querySelector('[data-focus-case="menu"] button').click()`);
            await delay(400);
            await evaluate(`document.querySelector('button[class*="option-container-"]').parentElement.setAttribute('data-t25-probe-root', '')`);
            await capture('fixture-menu');
            await evaluate(`document.querySelector('[data-t25-probe-root] button').click()`);
            await evaluate(`document.querySelector('[data-focus-case="modal"] [tabindex]').click()`);
            await delay(400);
            await evaluate(`document.querySelector('[class*="modal-dialog-container-"]').setAttribute('data-t25-probe-root', '')`);
            await capture('fixture-modal');
            await evaluate(`Array.from(document.querySelectorAll('[data-t25-probe-root] [tabindex]')).pop().click()`);
            await delay(300);
            await evaluate(`document.querySelector('[data-focus-case="buttons"] [tabindex]').focus()`);
            const navigation = [];
            for (const [key, keyCode] of [['ArrowRight', 39], ['ArrowRight', 39], ['ArrowDown', 40], ['ArrowLeft', 37]]) {
                await evaluate('window.__t25PreviousFocus = document.activeElement; true');
                await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: keyCode });
                await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: keyCode });
                await delay(200);
                const moved = await evaluate('document.activeElement !== window.__t25PreviousFocus');
                const after = await evaluate('window.__t25FocusProbe.active()');
                navigation.push({ key, moved, after });
            }
            await evaluate('delete window.__t25PreviousFocus');
            fs.writeFileSync(`tests/webos/t25-navigation.${mode}.json`, JSON.stringify({ note: 'Existing spatial navigation, CDP key events; not a physical remote certification', steps: navigation }, null, 2) + '\n');
        }
    }
} finally {
    fs.writeFileSync(`tests/webos/t25-summary${only ? '-' + only : ''}.${mode}.json`, JSON.stringify({ date: new Date().toISOString(), endpoint, results: reports }, null, 2) + '\n');
    ws.close();
}
if (!reports.length || reports.some((r) => r.failures.length)) process.exitCode = 1;
