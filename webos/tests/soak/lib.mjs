// Shared pieces of the endurance run (F7.3, webos/tests/soak): a CDP session on the app page that survives the
// renderer being killed (it reconnects and counts the restart), the Magic Remote pointer through CDP, the
// remote keys, and the memory sample taken at the same moment of every cycle (renderer RSS by kind from
// /proc/<pid>/status, the page's JS heap after a GC, DOM nodes, event listeners, images, the core's memory).
// Builds on webos/tests/perf/lib.mjs (F7.1).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { APP_ID, PAGE_MEMORY, connect, remoteKey, sleep, statusSnapshot } from '../perf/lib.mjs';

export { APP_ID, remoteKey, sleep };

export const stamp = () => new Date().toTimeString().slice(0, 8);
export const log = (...a) => console.log(`[${stamp()}]`, ...a);

// Page side: an id that changes with every load of the document (a reload or a relaunch shows up as a new
// id), the errors of the page, and a cheap "what has the focus" helper.
const PAGE_SOAK = `(function () {
    if (window.__soak) return 'already installed';
    var s = window.__soak = { id: String(Math.random()).slice(2, 10), bootedAt: Date.now(), errors: [] };
    window.addEventListener('error', function (e) { if (s.errors.length < 50) s.errors.push(String(e.message).slice(0, 200)); });
    window.addEventListener('unhandledrejection', function (e) { if (s.errors.length < 50) s.errors.push('rejection: ' + String(e.reason && (e.reason.message || e.reason)).slice(0, 200)); });
    s.focus = function () { var a = document.activeElement; if (!a || a === document.body) return 'body'; return a.tagName.toLowerCase() + '.' + String(a.className).split(' ')[0].slice(0, 40); };
    s.center = function (selector, index) {
        // The side bar and the top bar both have the links, one of them hidden (no size): the index counts the visible ones.
        var els = document.querySelectorAll(selector), el = null, seen = 0, r = null;
        for (var i = 0; i < els.length; i++) {
            var b = els[i].getBoundingClientRect();
            if (!b.width || !b.height) continue;
            if (seen++ === (index || 0)) { el = els[i]; r = b; break; }
        }
        if (!el) return null;
        // The html zoom of the TV scale (F2.6): CDP input is in screen pixels.
        var f = window.innerWidth / document.documentElement.getBoundingClientRect().width;
        return { x: Math.round((r.left + r.width / 2) * f), y: Math.round((r.top + r.height / 2) * f) };
    };
    return 'installed';
})()`;

export function createSoak({ ipk, out, port = process.env.EMU_CDP_PORT, device = process.env.EMU_DEVICE }) {
    if (!port || !device) throw new Error('run inside webos/tools/emu-run');
    fs.mkdirSync(out, { recursive: true });
    const samplesFile = path.join(out, 'samples.jsonl');
    const eventsFile = path.join(out, 'events.jsonl');
    const startedAt = Date.now();
    const soak = {
        session: null,
        startedAt,
        restarts: [],
        samples: [],
        pointerVisible: false,
        lastPid: null,
    };
    const note = (kind, extra = {}) => {
        const entry = { kind, t: Date.now(), min: Math.round(((Date.now() - startedAt) / 60000) * 10) / 10, ...extra };
        fs.appendFileSync(eventsFile, `${JSON.stringify(entry)}\n`);
        return entry;
    };
    soak.note = note;

    // ---- the page ------------------------------------------------------------------------------
    soak.evaluate = (expression, ms = 30000) => soak.session.evaluate(expression, ms);
    soak.send = (method, params, ms = 30000) => soak.session.send(method, params, ms);

    soak.attach = async (waitMs = 120000) => {
        if (soak.session) { try { soak.session.close(); } catch (e) { /* gone */ } }
        soak.session = await connect(port, APP_ID, waitMs);
        for (let i = 0; i < 60; i++) {
            try {
                await soak.evaluate(PAGE_SOAK, 15000);
                soak.pageId = await soak.evaluate('window.__soak.id', 15000);
                return;
            } catch (e) { await sleep(1000); }
        }
        throw new Error('could not install the soak helpers');
    };

    soak.boardUp = (timeoutS = 360) => soak.waitFor(`!!(window.core && window.core.dispatch) && !!document.querySelector('[class*="board-content"] [class*="meta-item-container"]')`, timeoutS, 1000, true);

    // Polls an expression (a statement-free JS expression) until it is truthy; false on timeout.
    soak.waitFor = async (expression, seconds, everyMs = 500, tolerant = false) => {
        const deadline = Date.now() + seconds * 1000;
        while (Date.now() < deadline) {
            try {
                if (await soak.evaluate(`!!(${expression})`, 15000)) return true;
            } catch (e) {
                if (!tolerant) { /* a busy or dead page: the check below sorts it out */ }
            }
            await sleep(everyMs);
        }
        return false;
    };

    soak.launch = async () => {
        execFileSync('ares-launch', ['-d', device, APP_ID], { stdio: 'ignore' });
        await soak.attach(90000);
        if (!(await soak.boardUp())) throw new Error('the Board never showed up');
    };

    // Is it the same document as before? A new id, or a page that does not answer, is a restart (the renderer
    // killed by the OOM, or the app relaunched). Reconnects, waits for the Board and records it.
    soak.ensure = async (context) => {
        let alive = false;
        try { alive = (await soak.evaluate('window.__soak && window.__soak.id', 20000)) === soak.pageId; } catch (e) { alive = false; }
        if (alive) return true;
        const entry = note('restart', { context, lastPid: soak.lastPid, lastSample: soak.samples.length ? soak.samples[soak.samples.length - 1].proc : null });
        log('RESTART detected', JSON.stringify(entry));
        soak.restarts.push(entry);
        soak.pointerVisible = false;
        await soak.attach(180000);
        // The system may have relaunched the app already; otherwise launch it.
        let board = await soak.boardUp(150);
        if (!board) {
            try { execFileSync('ares-launch', ['-d', device, APP_ID], { stdio: 'ignore' }); } catch (e) { /* ignore */ }
            await soak.attach(120000);
            board = await soak.boardUp(240);
        }
        note('restart-recovered', { board });
        return false;
    };

    // ---- input ---------------------------------------------------------------------------------
    // webOS fires cursorStateChange {visibility:false} on the first arrow after the pointer was shown
    // (webos/magic-remote): the emulator does not, so the run does it before an arrow key.
    soak.cursorState = (visible) => soak.evaluate(`document.dispatchEvent(new CustomEvent('cursorStateChange', { detail: { visibility: ${visible} } })); true`, 10000)
        .then(() => { soak.pointerVisible = visible; }, () => {});
    soak.key = async (...keys) => {
        if (soak.pointerVisible) await soak.cursorState(false);
        await remoteKey(...keys);
    };
    soak.keys = async (names, gapMs = 450) => {
        for (const name of names) { await soak.key(name); await sleep(gapMs); }
    };
    soak.mouse = (event) => soak.send('Input.dispatchMouseEvent', { button: 'none', ...event }, 15000);
    soak.moveTo = async (point) => {
        if (!soak.pointerVisible) await soak.cursorState(true);
        await soak.mouse({ type: 'mouseMoved', x: point.x, y: point.y });
    };
    soak.centerOf = async (selector, index = 0) => {
        const raw = await soak.evaluate(`JSON.stringify(window.__soak.center(${JSON.stringify(selector)}, ${index}))`, 15000);
        return raw ? JSON.parse(raw) : null;
    };
    // The Magic Remote pointer: move over the element, then press and release (a click).
    soak.pointerClick = async (selector, index = 0) => {
        const point = await soak.centerOf(selector, index);
        if (!point) return false;
        await soak.moveTo({ x: point.x - 6, y: point.y - 4 });
        await sleep(120);
        await soak.moveTo(point);
        await sleep(150);
        await soak.mouse({ type: 'mousePressed', button: 'left', clickCount: 1, x: point.x, y: point.y });
        await sleep(60);
        await soak.mouse({ type: 'mouseReleased', button: 'left', clickCount: 1, x: point.x, y: point.y });
        return true;
    };
    // Raw DOM keys (the letters of the Player shortcuts: the remote has no letters).
    soak.domKey = async (keyCode) => {
        for (const type of ['rawKeyDown', 'keyUp']) {
            await soak.send('Input.dispatchKeyEvent', { type, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode }, 10000);
        }
    };

    // ---- measurements --------------------------------------------------------------------------
    // One sample: a GC first, so that the JS heap is what is retained, not what is waiting to be collected.
    soak.sample = async (label, extra = {}) => {
        const entry = { label, t: Date.now(), min: Math.round(((Date.now() - startedAt) / 60000) * 10) / 10, ...extra };
        try { await soak.send('HeapProfiler.collectGarbage', {}, 30000); } catch (e) { entry.gcError = String(e.message).slice(0, 80); }
        try { entry.page = JSON.parse(await soak.evaluate(PAGE_MEMORY, 30000)); } catch (e) { entry.pageError = String(e.message).slice(0, 80); }
        try { entry.counters = await soak.send('Memory.getDOMCounters', {}, 15000); } catch (e) { entry.countersError = String(e.message).slice(0, 80); }
        try {
            const core = await soak.evaluate('window.core.getCoreLoaderStatus().then(function(s){ return s && s.memoryBytes; })', 20000);
            entry.coreMB = core ? Math.round(core / 104857.6) / 10 : null;
        } catch (e) { entry.coreError = String(e.message).slice(0, 80); }
        entry.proc = statusSnapshot();
        if (entry.proc.pid) {
            if (soak.lastPid && soak.lastPid !== entry.proc.pid) note('renderer-pid-changed', { from: soak.lastPid, to: entry.proc.pid });
            soak.lastPid = entry.proc.pid;
        }
        soak.samples.push(entry);
        fs.appendFileSync(samplesFile, `${JSON.stringify(entry)}\n`);
        const p = entry.proc, g = entry.page || {}, c = entry.counters || {};
        log('sample', label, p.error || `rss ${p.rssMB} (anon ${p.anonMB}, file ${p.fileMB}, shmem ${p.shmemMB}) MB`, `heap ${g.usedHeapMB} MB, nodes ${c.nodes}/${g.domNodes}, listeners ${c.jsEventListeners}, docs ${c.documents}, imgs ${g.images}, core ${entry.coreMB} MB`);
        return entry;
    };

    // The heap of the core's worker (the JS side of wasm2js and the Rust core's glue), which performance.memory
    // cannot see: a V8 heap snapshot of the worker through the inspector's Worker domain (Chromium 53 takes
    // Worker.sendMessageToWorker without connectToWorker). ~10 MB of JSON; takes a minute or two in c8, and the
    // worker allocates while it builds it: take it at the ends of a run, not between samples. Saves the raw
    // snapshot (gzip) and a summary: total self size and the biggest constructors.
    soak.workerSnapshot = async (label, timeoutMs = 600000) => {
        const s = soak.session;
        // disable + enable: the inspector announces the live workers again on enable.
        await soak.send('Worker.disable', {}, 15000).catch(() => {});
        s.events.length = 0;
        await soak.send('Worker.enable', {}, 15000).catch(() => {});
        await sleep(2000);
        const live = new Map();
        for (const e of s.events) {
            if (e.method === 'Worker.workerCreated') live.set(e.params.workerId, e.params);
            if (e.method === 'Worker.workerTerminated') live.delete(e.params.workerId);
        }
        const wid = [...live.keys()].pop();
        if (!wid) return { label, error: 'no live worker' };
        let id = 1000 + Math.floor(Math.random() * 1000);
        const send = (method, params = {}) => { id++; return s.send('Worker.sendMessageToWorker', { workerId: wid, message: JSON.stringify({ id, method, params }) }, 30000).then(() => id); };
        await send('HeapProfiler.enable');
        await sleep(1000);
        s.events.length = 0;
        const t0 = Date.now();
        const snapshotId = await send('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
        let done = false;
        const chunks = [];
        let taken = 0;
        while (!done && Date.now() - t0 < timeoutMs) {
            await sleep(1500);
            const batch = s.events.splice(0, s.events.length);
            for (const e of batch) {
                if (e.method !== 'Worker.dispatchMessageFromWorker') continue;
                const m = JSON.parse(e.params.message);
                if (m.method === 'HeapProfiler.addHeapSnapshotChunk') chunks.push(m.params.chunk);
                else if (m.id === snapshotId) done = true;
            }
            taken = chunks.length;
        }
        if (!done) return { label, error: `snapshot not finished in ${timeoutMs} ms (${taken} chunks)` };
        const raw = chunks.join('');
        fs.writeFileSync(path.join(out, `worker-heap-${label}.heapsnapshot.gz`), zlib.gzipSync(raw));
        const snap = JSON.parse(raw);
        const fields = snap.snapshot.meta.node_fields;
        const stride = fields.length;
        const iName = fields.indexOf('name'); const iSize = fields.indexOf('self_size'); const iType = fields.indexOf('type');
        const types = snap.snapshot.meta.node_types[0];
        const by = new Map();
        let total = 0;
        for (let i = 0; i < snap.nodes.length; i += stride) {
            const size = snap.nodes[i + iSize];
            total += size;
            const type = types[snap.nodes[i + iType]];
            const name = type === 'string' || type === 'concatenated string' || type === 'sliced string' ? `(${type})` : snap.strings[snap.nodes[i + iName]];
            const key = `${type}:${String(name).slice(0, 60)}`;
            const e = by.get(key) || { key, count: 0, bytes: 0 };
            e.count++; e.bytes += size; by.set(key, e);
        }
        const top = [...by.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 40);
        const summary = { label, at: Date.now(), min: Math.round(((Date.now() - startedAt) / 60000) * 10) / 10, seconds: Math.round((Date.now() - t0) / 1000), nodes: snap.nodes.length / stride, totalMB: Math.round(total / 104857.6) / 10, top };
        fs.writeFileSync(path.join(out, `worker-heap-${label}.json`), `${JSON.stringify(summary, null, 2)}\n`);
        log('worker heap', label, `${summary.totalMB} MB in ${summary.nodes} nodes, ${summary.seconds} s`);
        return summary;
    };
    return soak;
}

// Waits for a host-side condition on the clock, logging nothing: used to hold a scenario for N minutes.
export const minutesSince = (t) => (Date.now() - t) / 60000;
