// Shared helpers of the F7.1 measurements (webos/tests/perf): one persistent CDP session on the app
// page, remote keys, and a page-side timer, so that a step is timed on ONE clock (the page's
// performance.now()) from the key event to the moment the screen is ready, and the latency of
// the CDP calls (slow with --profile c8) never enters the number.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const APP_ID = 'io.github.gabrielsflores.stremio';
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');

export const median = (values) => {
    const sorted = values.filter((v) => typeof v === 'number').sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = sorted.length >> 1;
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

// Connects to the first inspector target whose url contains `match`.
export async function connect(port, match = APP_ID, waitMs = 60000) {
    const deadline = Date.now() + waitMs;
    let target = null;
    while (Date.now() < deadline && !target) {
        try {
            const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
            target = targets.find((t) => (t.url || '').includes(match) && t.webSocketDebuggerUrl);
        } catch (e) { /* inspector not up yet */ }
        if (!target) await sleep(200);
    }
    if (!target) throw new Error(`no inspector target for ${match} on ${port}`);
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true });
        ws.addEventListener('error', reject, { once: true });
    });
    let nextId = 1;
    const pending = new Map();
    const events = [];
    ws.addEventListener('message', (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
        } else if (msg.method) {
            events.push(msg);
        }
    });
    const send = (method, params = {}, timeoutMs = 60000) => new Promise((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
        pending.set(id, {
            resolve: (r) => { clearTimeout(timer); resolve(r); },
            reject: (e) => { clearTimeout(timer); reject(e); },
        });
        ws.send(JSON.stringify({ id, method, params }));
    });
    // Evaluates an expression (ES2015: Chromium 53) and returns its value. The Chromium 53 inspector has
    // no awaitPromise, so a Promise result is parked in a global and polled (as webos/tools/cdp.mjs does).
    // A statement list (not a single expression) is run as is, without the Promise handling.
    const evaluate = async (expression, timeoutMs = 60000) => {
        const slot = `__lib_${Date.now()}_${nextId}`;
        const wrapped = `(function(){var s='${slot}';var v=(${expression});` +
            `if(v&&typeof v.then==='function'){window[s]={done:false};v.then(function(r){window[s]={done:true,ok:true,value:r};},function(e){window[s]={done:true,ok:false,value:String(e&&e.stack||e)};});return {__pending:s};}` +
            'return {__value:v};})()';
        let r = await send('Runtime.evaluate', { expression: wrapped, returnByValue: true }, timeoutMs);
        if (r.exceptionDetails && /SyntaxError/.test(JSON.stringify(r.exceptionDetails))) {
            r = await send('Runtime.evaluate', { expression, returnByValue: true }, timeoutMs);
            if (r.exceptionDetails) throw new Error(`page exception: ${r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text}`);
            return r.result && r.result.value;
        }
        if (r.exceptionDetails) throw new Error(`page exception: ${r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text}`);
        const out = r.result && r.result.value;
        if (!out || !out.__pending) return out ? out.__value : undefined;
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const poll = await send('Runtime.evaluate', { expression: `window['${slot}']`, returnByValue: true }, timeoutMs);
            const state = poll.result && poll.result.value;
            if (state && state.done) {
                await send('Runtime.evaluate', { expression: `delete window['${slot}']` }, timeoutMs);
                if (!state.ok) throw new Error(`page promise rejected: ${state.value}`);
                return state.value;
            }
            await sleep(200);
        }
        throw new Error('timeout waiting for the page Promise');
    };
    return { evaluate, send, events, close: () => ws.close(), url: target.url };
}

// Real remote keys through the emulator's remote service (webos/tools/remote.mjs).
export function remoteKey(...keys) {
    const port = process.env.EMU_REMOTE_PORT;
    if (!port) throw new Error('EMU_REMOTE_PORT not set: run inside webos/tools/emu-run');
    return new Promise((resolve, reject) => {
        const child = spawn('node', [path.join(REPO, 'webos/tools/remote.mjs'), '--port', port, '--delay', '0', ...keys], { stdio: 'ignore' });
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`remote.mjs ${keys.join(' ')} exited ${code}`))));
    });
}

// Page side of the timer. `arm(name, condition, options)` registers a measurement whose t0 is set by
// the next input event: a keydown (a remote key) or an explicit window.__f71.start() (the page helpers
// for clicks call it right before the click). A requestAnimationFrame loop evaluates `condition` (a
// function source) after each frame, and the step ends at the first frame where it returns truthy,
// all on the page's performance.now(). Results land in window.__f71.results[name] =
// { ms, at, frames } or { timeout: true }.
export const PAGE_TIMER = `(function () {
    if (window.__f71) return 'already installed';
    var f = window.__f71 = { results: {}, armed: {}, errors: [] };
    window.addEventListener('error', function (e) { f.errors.push(String(e.message)); });
    f.start = function () {
        var t = performance.now();
        Object.keys(f.armed).forEach(function (n) { if (f.armed[n].t0 === null) f.armed[n].t0 = t; });
    };
    document.addEventListener('keydown', function () { f.start(); }, true);
    // The system Back key does not reach the page as a keydown on the emulator (it arrives as a history
    // step), so a history/hash change also starts the armed steps.
    window.addEventListener('popstate', function () { f.start(); }, true);
    window.addEventListener('hashchange', function () { f.start(); }, true);
    // A timeline of the page's own memory numbers (V8 heap, DOM, images, wasm memory of the core), every ms milliseconds.
    f.timeline = [];
    f.monitor = function (ms) {
        if (f.monitorId) return;
        f.monitorId = setInterval(function () {
            var m = performance.memory || {};
            var e = { t: Math.round(performance.now()), wall: Date.now(), heapMB: Math.round((m.usedJSHeapSize || 0) / 104857.6) / 10, totalMB: Math.round((m.totalJSHeapSize || 0) / 104857.6) / 10,
                nodes: document.getElementsByTagName('*').length, imgs: document.images.length, hash: location.hash };
            f.timeline.push(e);
            // The calls to the core worker still waiting for an answer (a backlog of getState/dispatch messages
            // would sit in memory), counted by wrapping the transport once it exists.
            if (window.core && !window.core.__f71wrapped) {
                var core = window.core, st = f.core = { calls: 0, pending: 0, maxPending: 0, byMethod: {}, byModel: {} };
                core.__f71wrapped = true;
                ['getState', 'dispatch', 'analytics', 'encodeStream', 'decodeStream'].forEach(function (name) {
                    var original = core[name];
                    if (typeof original !== 'function') return;
                    core[name] = function () {
                        st.calls++; st.pending++; if (st.pending > st.maxPending) st.maxPending = st.pending;
                        st.byMethod[name] = (st.byMethod[name] || 0) + 1;
                        if (name === 'getState') st.byModel[arguments[0]] = (st.byModel[arguments[0]] || 0) + 1;
                        var done = function () { st.pending--; };
                        var r = original.apply(this, arguments);
                        if (r && typeof r.then === 'function') r.then(done, done); else done();
                        return r;
                    };
                });
            }
            if (f.core) { e.coreCalls = f.core.calls; e.corePending = f.core.pending; e.coreMaxPending = f.core.maxPending; }
            if (window.core && window.core.getCoreLoaderStatus) {
                window.core.getCoreLoaderStatus().then(function (st) { e.coreMB = st && st.memoryBytes ? Math.round(st.memoryBytes / 104857.6) / 10 : null; }, function () {});
            }
        }, ms);
    };
    f.arm = function (name, conditionSource, opts) {
        opts = opts || {};
        var cond = new Function('return (' + conditionSource + ')()');
        var step = f.armed[name] = { t0: null, frames: 0, timeoutMs: opts.timeoutMs || 120000 };
        delete f.results[name];
        function frame() {
            if (f.armed[name] !== step) return;
            var t = performance.now();
            if (step.t0 !== null) {
                step.frames++;
                var ok = false;
                try { ok = !!cond(); } catch (e) { ok = false; }
                if (ok) { f.results[name] = { ms: Math.round((t - step.t0) * 10) / 10, at: Math.round(t), frames: step.frames }; delete f.armed[name]; return; }
                if (t - step.t0 > step.timeoutMs) { f.results[name] = { timeout: true, ms: Math.round(t - step.t0) }; delete f.armed[name]; return; }
            }
            requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
        return true;
    };
    return 'installed';
})()`;

// Waits (host side) for window.__f71.results[name].
export async function waitResult(session, name, timeoutMs = 180000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const r = await session.evaluate(`JSON.stringify(window.__f71.results[${JSON.stringify(name)}] || null)`).catch(() => null);
        if (r && r !== 'null') return JSON.parse(r);
        await sleep(400);
    }
    return { timeout: true, hostTimeout: true };
}

// Appends one phase mark (host clock, ms) for the memory analysis.
export function phaseWriter(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    return (name, extra = {}) => fs.appendFileSync(file, `${JSON.stringify({ name, t: Date.now(), ...extra })}\n`);
}

export function parseArgs(argv) {
    const args = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith('--')) {
            const key = argv[i].slice(2);
            const next = argv[i + 1];
            if (next === undefined || next.startsWith('--')) args[key] = true; else { args[key] = next; i++; }
        } else {
            args._.push(argv[i]);
        }
    }
    return args;
}

// Where the app renderer's RSS lives, from /proc/<pid>/status of the guest (the kernel is 4.8: RssAnon,
// RssFile and RssShmem exist; /proc/<pid>/smaps is not readable by the developer user).
// Returns { pid, rssMB, anonMB, fileMB, shmemMB, dataMB } for the WebAppMgr renderer with the most RSS.
export function statusSnapshot() {
    const port = process.env.EMU_SSH_PORT;
    if (!port) throw new Error('EMU_SSH_PORT not set: run inside webos/tools/emu-run');
    // Also the CPU ticks (utime+stime) of the renderer's threads by name: who works while the memory grows.
    const remote = "p=$(ps -eo pid,rss,args | grep -e '--type=renderer' | grep -v grep | sort -k2 -n | tail -1 | awk '{print $1}'); echo pid $p; grep -E 'VmRSS|RssAnon|RssFile|RssShmem|VmData' /proc/$p/status; for t in /proc/$p/task/*; do echo thread $(tr ' ' '_' < $t/comm) $(awk '{print $14+$15}' $t/stat); done";
    const r = spawnSync('ssh', ['-q', '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'HostKeyAlgorithms=+ssh-rsa',
        '-o', 'PubkeyAcceptedAlgorithms=+ssh-rsa', '-o', 'BatchMode=yes', '-i', path.join(process.env.HOME, 'webos-tv-sdk/run/ares_webos_emul'),
        '-p', port, 'developer@127.0.0.1', remote], { encoding: 'utf8', timeout: 60000 });
    if (r.status !== 0) return { error: `ssh exited ${r.status}: ${(r.stderr || '').slice(0, 200)}` };
    const kb = (name) => { const m = new RegExp(`${name}:\\s*(\\d+)`).exec(r.stdout); return m ? Math.round((Number(m[1]) / 1024) * 10) / 10 : null; };
    const threads = {};
    for (const m of r.stdout.matchAll(/^thread (\S+) (\d+)$/gm)) threads[m[1]] = (threads[m[1]] || 0) + Number(m[2]);
    return { pid: (/pid (\d+)/.exec(r.stdout) || [])[1] || null, rssMB: kb('VmRSS'), anonMB: kb('RssAnon'), fileMB: kb('RssFile'), shmemMB: kb('RssShmem'), dataMB: kb('VmData'), threadTicks: threads };
}

// What the page itself can tell about its memory: V8 heap, DOM, images (decoded size estimated as
// width x height x 4 of every loaded <img>, plus the CSS background images in the document).
export const PAGE_MEMORY = `(function () {
    var mem = performance.memory || {};
    var imgs = document.images, decoded = 0, loaded = 0;
    for (var i = 0; i < imgs.length; i++) { if (imgs[i].complete && imgs[i].naturalWidth) { loaded++; decoded += imgs[i].naturalWidth * imgs[i].naturalHeight * 4; } }
    var bg = 0, els = document.getElementsByTagName('*'), bgBytes = 0;
    for (var j = 0; j < els.length && j < 20000; j++) { var b = els[j].style && els[j].style.backgroundImage; if (b && b !== 'none') bg++; }
    var routes = document.querySelectorAll('.routes-container > .route-container').length;
    return JSON.stringify({
        usedHeapMB: Math.round((mem.usedJSHeapSize || 0) / 104857.6) / 10, totalHeapMB: Math.round((mem.totalJSHeapSize || 0) / 104857.6) / 10,
        domNodes: els.length, images: imgs.length, imagesLoaded: loaded, imagesDecodedEstMB: Math.round(decoded / 104857.6) / 10,
        inlineBackgrounds: bg, routeContainers: routes, videos: document.getElementsByTagName('video').length, hash: location.hash
    });
})()`;

// The compositor layers of the page (LayerTree domain): how many, and how much memory their backing store
// would take if every layer that draws content were fully rastered (width x height x 4 bytes). An upper
// bound for software raster (the emulator has no GPU); the real tile memory is smaller.
export async function layerStats(session, waitMs = 1500) {
    session.events.length = 0;
    try {
        await session.send('LayerTree.disable', {}, 10000).catch(() => {});
        await session.send('LayerTree.enable', {}, 10000);
    } catch (e) {
        return { error: String(e.message) };
    }
    const deadline = Date.now() + waitMs;
    let layers = null;
    while (Date.now() < deadline && !layers) {
        const ev = session.events.find((m) => m.method === 'LayerTree.layerTreeDidChange');
        if (ev && ev.params && ev.params.layers) layers = ev.params.layers;
        else await sleep(100);
    }
    await session.send('LayerTree.disable', {}, 10000).catch(() => {});
    if (!layers) return { error: 'no layerTreeDidChange event' };
    const drawing = layers.filter((l) => l.drawsContent);
    const area = (list) => list.reduce((a, l) => a + l.width * l.height, 0);
    return {
        layers: layers.length, drawing: drawing.length,
        drawingAreaMpx: Math.round(area(drawing) / 1e5) / 10, drawingMB: Math.round((area(drawing) * 4) / 104857.6) / 10,
        biggest: drawing.sort((a, b) => b.width * b.height - a.width * a.height).slice(0, 5).map((l) => `${Math.round(l.width)}x${Math.round(l.height)}`),
    };
}
