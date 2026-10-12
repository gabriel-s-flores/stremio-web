#!/usr/bin/env node
// Opening Details of a film with 224 streams and a large library (F8.6), A/B of IPKs in ONE reservation:
//
//   webos/tools/emu-run --profile c8 --timeout 60 -- node webos/tests/perf/details.mjs --out <dir> [--rounds 2]
//        [--openings 3] [--profile-opening N] [--quiet 45] <a.ipk> <b.ipk> ...
//
// The TV case (F8 notes, 2026-10-12): Torrentio + AllDebrid answers 224 streams (121 KB) for the film, the
// TV has `library` 198 KB and `library_recent` 118 KB, and meta and streams showed up together after
// 25-47 s. Here: the local addon `--set torrentio` (224 Torrentio-like streams, webos/tests/addon) and
// library-fixture.js (~200 KB + ~125 KB), the meta from Cinemeta (network, as on the TV).
//
// Per round, each IPK in turn (reversed in the even rounds: ABBA): install, launch, put the library in
// localStorage and install the addon, relaunch (the core reads the library at init), wait for the Board
// and `--quiet` s, then N openings of #/detail/movie/tt15047880/tt15047880 by hash (like
// tarefas/F8/bin/abrir-detalhes.sh on the TV), back to the Board between them. Per opening, on the page's
// clock from the hash change:
// - metaMs (the info column with text, the TV script's criterion), titleMs (the logo or the name shown),
//   streamMs (the first stream in the list), streamsAt (how many streams the list had at the end);
// - every call between the page and the worker (Worker.prototype.postMessage: getState/dispatch with the
//   model, sent and answered at; and what the worker asks the page: onCoreEvent, localStorage.setItem with
//   the key and size);
// - the CPU ticks of the renderer's threads over the opening (guest /proc, 10 ms each): the core worker's
//   thread is the one that tells how busy the core was;
// - --profile-opening N: a CPU profile of the worker (CDP Worker domain, like tarefas/F8/bin/perfil-worker.mjs)
//   over the Nth opening, saved as <label>.worker.cpuprofile (symbolize with webos/tests/perf/symbolize.mjs).
//   It works on the TV; on the emulator (c8 or not) the worker's Profiler.stop never came back (F8.6).
// Writes <dir>/details.json and prints the medians per IPK.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { APP_ID, REPO, connect, median, parseArgs, sleep, statusSnapshot } from './lib.mjs';

const require = createRequire(import.meta.url);
const { libraryFixture } = require('./library-fixture.js');

const args = parseArgs(process.argv.slice(2));
const IPKS = args._.map((p) => path.resolve(p));
const OUT = path.resolve(args.out || 'perf-details');
const ROUNDS = Number(args.rounds || 1);
const OPENINGS = Number(args.openings || 3);
const PROFILE_OPENING = Number(args['profile-opening'] || 0);
const QUIET_S = Number(args.quiet || 45);
const IDLE_WAIT_S = Number(args['idle-wait'] || 120);
// The worker profiler's sampling interval (µs): 1000 like the TV profile.
const PROFILE_INTERVAL_US = Number(args['profile-interval'] || 1000);
const HASH = args.hash || '#/detail/movie/tt15047880/tt15047880';
const { EMU_DEVICE: DEVICE, EMU_CDP_PORT: CDP_PORT } = process.env;
if (!DEVICE || !CDP_PORT || IPKS.length === 0) {
    console.error('usage (inside webos/tools/emu-run): details.mjs --out <dir> [--rounds N] <ipk>...');
    process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(`[${new Date().toTimeString().slice(0, 8)}]`, ...a);

// The local addon with the 224 streams (stopped at the end).
const addonInfo = path.join(OUT, 'addon.json');
fs.rmSync(addonInfo, { force: true });
const addon = spawn(process.execPath, [path.join(REPO, 'webos/tests/addon/server.mjs'), '--set', 'torrentio', '--info', addonInfo],
    { stdio: ['ignore', fs.openSync(path.join(OUT, 'addon.log'), 'w'), 'inherit'] });
process.on('exit', () => addon.kill('SIGTERM'));
for (let i = 0; i < 100 && !fs.existsSync(addonInfo); i++) await sleep(100);
const { manifestUrl } = JSON.parse(fs.readFileSync(addonInfo, 'utf8'));
const LIBRARY = libraryFixture();

const ROUTE = `document.querySelector('.routes-container > .route-container:last-child')`;
const BOARD_READY = `(function () { var h = location.hash; if (h !== '' && h !== '#/') return false; var route = ${ROUTE};
    return !!route && !!route.querySelector('[class*="board-content"] [class*="meta-item-container"]'); })()`;

// Page side: the calls between page and worker, and the opening's timer.
const HOOK = `(function () {
    if (window.__f86) return 'already';
    var f = window.__f86 = { calls: null, t0: 0 };
    var now = function () { return Math.round(performance.now() - f.t0); };
    var watched = new WeakSet ? new WeakSet() : null;
    var pending = {};
    var post = Worker.prototype.postMessage;
    var onMessage = function (e) {
        var d = e.data || {}, calls = f.calls;
        if (!calls) return;
        if (d.response && pending[d.response.id]) { pending[d.response.id].push(now()); delete pending[d.response.id]; }
        if (d.request) {
            var p = d.request.path.join('.'), a = d.request.args || [];
            var entry = ['worker', p, now()];
            if (p === 'onCoreEvent' && a[0]) entry.push(a[0].name + (a[0].args && a[0].args.event ? ':' + a[0].args.event : '') + (a[0].name === 'NewState' ? ':' + a[0].args.join('+') : ''));
            if (p === 'localStorage.setItem') entry.push(a[0] + ':' + String(a[1]).length);
            calls.push(entry);
        }
    };
    Worker.prototype.postMessage = function (message) {
        if (watched && !watched.has(this)) { watched.add(this); this.addEventListener('message', onMessage); }
        var r = message && message.request, calls = f.calls;
        if (r && calls) {
            var entry = ['page', r.path.join('.'), now()];
            var a = r.args || [];
            if (r.path[0] === 'getState') entry.push(a[0]);
            else if (r.path[0] === 'dispatch') entry.push((a[0] && a[0].action) + (a[0] && a[0].args && a[0].args.model ? ':' + a[0].args.model : '') + (a[0] && a[0].args && a[0].args.action ? ':' + a[0].args.action : ''));
            else entry.push('');
            calls.push(entry);
            pending[r.id] = entry;
        }
        return post.apply(this, arguments);
    };
    var visible = function (el) { if (!el) return false; var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    f.open = function (hash) {
        var m = f.m = {};
        f.calls = [];
        f.t0 = performance.now();
        location.hash = hash;
        var iv = setInterval(function () {
            var t = now(), route = ${ROUTE};
            var mi = document.querySelector('[class*="meta-info-container"]');
            if (m.metaMs === undefined && mi && mi.textContent.trim().length > 5) m.metaMs = t;
            if (m.titleMs === undefined && route) {
                var logo = route.querySelector('img[class*="logo-"]'), name = route.querySelector('[class*="logo-placeholder"]');
                if ((logo && logo.complete && logo.naturalWidth > 0 && visible(logo)) || (name && visible(name) && name.textContent)) m.titleMs = t;
            }
            if (m.streamMs === undefined && document.querySelector('[class*="stream-container"]')) m.streamMs = t;
            if ((m.metaMs !== undefined && m.streamMs !== undefined) || t > 90000) {
                m.doneMs = t;
                clearInterval(iv);
            }
        }, 50);
        return true;
    };
    return 'installed';
})()`;

const results = [];
let session;
const evaluate = (expr, ms = 60000) => session.evaluate(expr, ms);

// The worker's profiler through the page target (Chromium 53: Worker domain).
let workerId = null;
let wid = 0;
const wsend = async (method, params = {}, timeoutMs = 120000) => {
    const id = ++wid;
    const from = session.events.length;
    // Chromium 53 may never answer the command itself: only the worker's answer is awaited (as
    // tarefas/F8/bin/perfil-worker.mjs does on the TV).
    session.send('Worker.sendMessageToWorker', { workerId, message: JSON.stringify({ id, method, params }) }, timeoutMs).catch(() => {});
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        for (let i = from; i < session.events.length; i++) {
            const e = session.events[i];
            if (e.method === 'Worker.dispatchMessageFromWorker') {
                const msg = JSON.parse(e.params.message);
                if (msg.id === id) return msg.result || msg.error;
            }
        }
        await sleep(100);
    }
    throw new Error(`worker timeout: ${method}`);
};
const attachWorker = async () => {
    session.events.length = 0;
    await session.send('Worker.enable');
    for (let i = 0; i < 50 && !workerId; i++) {
        const e = session.events.find((x) => x.method === 'Worker.workerCreated');
        if (e) workerId = e.params.workerId;
        else await sleep(100);
    }
    if (!workerId) throw new Error('no worker');
    session.send('Worker.connectToWorker', { workerId }, 10000).catch(() => {});
    await sleep(500);
};

const ticks = () => {
    const s = statusSnapshot();
    return s.threadTicks || {};
};
const tickDelta = (a, b) => Object.fromEntries(Object.keys(b).map((k) => [k, (b[k] || 0) - (a[k] || 0)]).filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]));

const launch = async () => {
    execFileSync('ares-launch', ['-d', DEVICE, APP_ID], { stdio: 'ignore' });
    session = await connect(CDP_PORT, APP_ID, 90000);
    workerId = null;
    const start = Date.now();
    for (;;) {
        try { if (await evaluate(BOARD_READY, 15000)) break; } catch (e) { /* the document is being replaced */ }
        if (Date.now() - start > 360000) throw new Error('the Board never showed up');
        await sleep(1000);
    }
    return Math.round((Date.now() - start) / 1000);
};
const close = async () => {
    try { session && session.close(); } catch (e) { /* closed */ }
    try { execFileSync('ares-launch', ['-d', DEVICE, '--close', APP_ID], { stdio: 'ignore' }); } catch (e) { /* closed */ }
    await sleep(4000);
};

async function round(ipk, label) {
    log(`[${label}] install ${path.basename(ipk)}`);
    try { execFileSync('ares-install', ['-d', DEVICE, '--remove', APP_ID], { stdio: 'ignore' }); } catch (e) { /* not installed */ }
    execFileSync('ares-install', ['-d', DEVICE, ipk], { stdio: 'ignore' });
    await sleep(3000);
    log(`[${label}] first launch: Board after ${await launch()} s; seeding the library and the addon`);
    await evaluate(`(function () {
        localStorage.setItem('library', ${JSON.stringify(LIBRARY.library)});
        localStorage.setItem('library_recent', ${JSON.stringify(LIBRARY.library_recent)});
        return true;
    })()`);
    await evaluate(`fetch(${JSON.stringify(manifestUrl)}).then(function (r) { return r.json(); }).then(function (manifest) {
        return window.core.dispatch({ action: 'Ctx', args: { action: 'InstallAddon', args: { transportUrl: ${JSON.stringify(manifestUrl)}, manifest: manifest, flags: { official: false, protected: false } } } });
    }).then(function () { return true; })`);
    await sleep(6000);
    await evaluate('window.__stremioPersist && window.__stremioPersist.flush ? Promise.resolve(window.__stremioPersist.flush()).then(function () { return true; }) : true').catch(() => null);
    await sleep(2000);
    await close();
    const boardS = await launch();
    const check = await evaluate(`Promise.all([window.core.getState('ctx'), window.core.getState('continue_watching_preview')]).then(function (s) {
        return { addons: s[0].profile.addons.map(function (a) { return a.manifest.id; }), continueWatching: s[1].items.length,
            library: (localStorage.getItem('library') || '').length, libraryRecent: (localStorage.getItem('library_recent') || '').length };
    })`);
    log(`[${label}] Board after ${boardS} s`, JSON.stringify(check));
    if (!check.addons.includes('io.github.gabrielsflores.webos.test-debrid') || check.continueWatching === 0) throw new Error(`fixture not in place: ${JSON.stringify(check)}`);
    log(`[${label}] quiet ${QUIET_S} s`);
    await sleep(QUIET_S * 1000);
    await evaluate(HOOK);
    const result = { ipk: path.basename(ipk), label, boardS, fixture: check, openings: [] };
    // Saved after every opening (a stuck opening keeps the ones before it).
    results.push(result);
    for (let i = 1; i <= OPENINGS; i++) {
        const workerRttMs = await evaluate(`(function () { var t = performance.now(); return window.core.getState('streaming_server').then(function () { return Math.round(performance.now() - t); }); })()`).catch(() => null);
        const profiling = PROFILE_OPENING === i;
        if (profiling) {
            await attachWorker();
            await wsend('Profiler.enable');
            await wsend('Profiler.setSamplingInterval', { interval: PROFILE_INTERVAL_US });
            await wsend('Profiler.start');
        }
        const before = ticks();
        await evaluate(`window.__f86.open(${JSON.stringify(HASH)})`);
        const start = Date.now();
        let m = null;
        while (Date.now() - start < 95000) {
            await sleep(500);
            m = JSON.parse(await evaluate('JSON.stringify(window.__f86.m)').catch(() => 'null'));
            if (m && m.doneMs !== undefined) break;
        }
        // The profile ends with the opening (meta and first stream on screen): the Chromium 53 worker takes
        // long to serialize a long profile, and on the emulator Profiler.stop may never come back.
        let profile = null;
        if (profiling) {
            const r = await wsend('Profiler.stop', {}, 600000);
            profile = r && r.profile;
            if (profile) fs.writeFileSync(path.join(OUT, `${label}.worker.cpuprofile`), JSON.stringify(profile));
            await wsend('Profiler.disable').catch(() => null);
        }
        // Until the worker is idle again (a small getState answers fast), for the CPU ticks of the whole opening.
        // At most IDLE_WAIT_S (the profiler slows the worker a lot on the c8).
        let idleMs = null;
        while (Date.now() - start < (95 + IDLE_WAIT_S) * 1000) {
            const rtt = await evaluate(`(function () { var t = performance.now(); return window.core.getState('streaming_server').then(function () { return Math.round(performance.now() - t); }); })()`, 15000).catch(() => 9999);
            if (rtt < 150) { idleMs = Date.now() - start; break; }
            await sleep(1000);
        }
        const after = ticks();
        const page = JSON.parse(await evaluate(`JSON.stringify({ calls: window.__f86.calls, streams: document.querySelectorAll('[class*="stream-container"]').length })`));
        const calls = page.calls;
        const count = (side, p, model) => calls.filter((c) => c[0] === side && c[1] === p && (model === undefined || c[3] === model)).length;
        const opening = {
            n: i, ...m, workerRttMs, idleMs, streamsAt: page.streams,
            ticks: tickDelta(before, after),
            getState: Object.fromEntries([...new Set(calls.filter((c) => c[1] === 'getState').map((c) => c[3]))].map((model) => [model, count('page', 'getState', model)])),
            newState: calls.filter((c) => c[1] === 'onCoreEvent' && /^NewState/.test(c[3] || '')).length,
            setItem: calls.filter((c) => c[1] === 'localStorage.setItem').map((c) => c[3]),
            calls,
            profiled: profiling ? `${label}.worker.cpuprofile` : undefined,
        };
        result.openings.push(opening);
        save();
        log(`[${label}] opening ${i}`, JSON.stringify({ metaMs: opening.metaMs, titleMs: opening.titleMs, streamMs: opening.streamMs, idleMs, streamsAt: opening.streamsAt, getState: opening.getState, newState: opening.newState, setItem: opening.setItem, ticks: opening.ticks }));
        if (i === 1) {
            try {
                const shot = await session.send('Page.captureScreenshot', {}, 30000);
                fs.writeFileSync(path.join(OUT, `${label}.details.png`), Buffer.from(shot.data, 'base64'));
            } catch (e) { /* no screenshot */ }
        }
        await evaluate(`(location.hash = '#/', true)`);
        const back = Date.now();
        while (Date.now() - back < 60000 && !(await evaluate(BOARD_READY).catch(() => false))) await sleep(500);
        await sleep(5000);
    }
    await close();
    return result;
}

const save = () => fs.writeFileSync(path.join(OUT, 'details.json'), `${JSON.stringify({ profile: process.env.EMU_PROFILE || null, instance: process.env.EMU_INSTANCE, hash: HASH, results }, null, 1)}\n`);
for (let r = 1; r <= ROUNDS; r++) {
    const order = r % 2 ? IPKS : [...IPKS].reverse();
    for (const ipk of order) {
        const label = `r${r}-${path.basename(ipk, '.ipk')}`;
        try {
            await round(ipk, label);
        } catch (e) {
            log(`[${label}] failed: ${e.message}`);
            try {
                const shot = await session.send('Page.captureScreenshot', {}, 20000);
                fs.writeFileSync(path.join(OUT, `${label}.failed.png`), Buffer.from(shot.data, 'base64'));
            } catch (x) { /* no screenshot */ }
            const partial = results.find((x) => x.label === label);
            if (partial) partial.error = String(e.message); else results.push({ ipk: path.basename(ipk), label, error: String(e.message) });
            await close();
        }
        save();
    }
}
const workerTicks = (o) => {
    // The core worker's thread: the one named like a worker, else the busiest besides the main one.
    const entries = Object.entries(o.ticks || {});
    const worker = entries.find(([k]) => /worker/i.test(k));
    return worker ? worker[1] : null;
};
for (const ipk of IPKS) {
    const mine = results.filter((x) => x.ipk === path.basename(ipk) && x.openings && x.openings.length > 0);
    const all = (pick) => median(mine.flatMap((x) => x.openings.map(pick)).filter((v) => typeof v === 'number'));
    log(path.basename(ipk), JSON.stringify({
        rounds: mine.length,
        metaMs: all((o) => o.metaMs), titleMs: all((o) => o.titleMs), streamMs: all((o) => o.streamMs), idleMs: all((o) => o.idleMs),
        workerCpuMs: all((o) => (workerTicks(o) === null ? null : workerTicks(o) * 10)),
        getStateMetaDetails: all((o) => o.getState.meta_details), getStateCtx: all((o) => o.getState.ctx || 0),
    }));
}
addon.kill('SIGTERM');
process.exit(0);
