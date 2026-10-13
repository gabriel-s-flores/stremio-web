#!/usr/bin/env node
// Opening Details of a film with 224 streams and a large library (F8.6), A/B of IPKs in ONE reservation:
//
//   webos/tools/emu-run --profile c8 --timeout 60 -- node webos/tests/perf/details.mjs --out <dir> [--rounds 2]
//        [--openings 3] [--profile-opening N] [--quiet 45 | --quiet 8,90] [--from-board] <a.ipk> <b.ipk> ...
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
// - in the details route on top only: titleMs (the logo or the name shown: the preview of the poster
//   opened, F8.6, or the real meta), metaMs (the REAL meta: the summary of the info column shown),
//   streamMs (the first stream in the list), streamsAt (how many streams the list had at the end);
//   tvMetaMs: the criterion of the TV script (tarefas/F8/bin/abrir-detalhes.sh: the first info column
//   of the document with text), kept to compare with the TV, where it counts the preview too;
// - every call between the page and the worker (Worker.prototype.postMessage: getState/dispatch with the
//   model, sent and answered at; and what the worker asks the page: onCoreEvent, localStorage.setItem with
//   the key and size);
// - the CPU ticks of the renderer's threads over the opening (guest /proc, 10 ms each): the core worker's
//   thread is the one that tells how busy the core was;
// - --profile-opening N: a CPU profile of the worker (CDP Worker domain, like tarefas/F8/bin/perfil-worker.mjs)
//   over the Nth opening, saved as <label>.worker.cpuprofile (symbolize with webos/tests/perf/symbolize.mjs).
//   It works on the TV; on the emulator (c8 or not) the worker's Profiler.stop never came back (F8.6).
// F8.7:
// - --quiet 8,90: one launch per value (the Board, then that many seconds, then the openings), each with the
//   state seeded again before it: the library, and no `notifications` bucket, so that every boot pulls the
//   notifications like the TV (Cinemeta lastVideosIds, real ids in library-fixture.js);
// - --from-board: the opening is a click on the first movie of the first catalog row of the Board (the
//   remote's OK on a poster: the poster stays under Details, so the optimistic title of F8.6 shows), not a
//   hash change; the movie is whatever Cinemeta's first catalog has, the local addon answers its 224 streams;
// - every call between page and worker is recorded from the launch (at < 0: before the opening).
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
// --page-profile-opening N: a CPU profile of the page (main thread) over the Nth opening of each launch (F8.7).
const PAGE_PROFILE_OPENING = Number(args['page-profile-opening'] || 0);
const QUIETS = String(args.quiet || 45).split(',').map(Number);
const FROM_BOARD = !!args['from-board'];
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
    if (!route) return false;
    // A poster of a catalog row: Continue Watching (the library) shows before the catalogs answer.
    var rows = route.querySelectorAll('[class*="board-content"] [class*="board-row"]');
    for (var i = 0; i < rows.length; i++) if (!/continue-watching/.test(rows[i].className) && rows[i].querySelector('[class*="meta-item-container"]')) return true;
    return false; })()`;

// Page side: the calls between page and worker, and the opening's timer.
const HOOK = `(function () {
    if (window.__f86) return 'already';
    var f = window.__f86 = { calls: [], t0: performance.now() };
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
    // The first movie of the first catalog row of the Board (not Continue Watching).
    f.firstPoster = function () {
        var rows = document.querySelectorAll('[class*="board-content"] [class*="board-row"]');
        for (var i = 0; i < rows.length; i++) {
            if (/continue-watching/.test(rows[i].className)) continue;
            var a = rows[i].querySelector('a[href^="#/detail/movie/"]');
            if (a) return a;
        }
        return null;
    };
    f.open = function (hash) {
        var m = f.m = {};
        var before = f.calls.map(function (c) { return [c[0], c[1], c[2] - Math.round(performance.now() - f.t0)].concat(c.slice(3)); });
        f.calls = before;
        f.t0 = performance.now();
        if (hash) location.hash = hash;
        else {
            var poster = f.firstPoster();
            m.href = poster && poster.getAttribute('href');
            poster.click();
        }
        var iv = setInterval(function () {
            var t = now(), top = ${ROUTE};
            // The details route once it is the one on top (before, the last route is still the Board).
            var route = top && top.querySelector('[class*="metadetails-container"]') ? top : null;
            var mi = document.querySelector('[class*="meta-info-container"]');
            if (m.tvMetaMs === undefined && mi && mi.textContent.trim().length > 5) m.tvMetaMs = t;
            var summary = route && route.querySelector('[class*="meta-preview-container"] [class*="description-container"]');
            if (m.metaMs === undefined && summary && visible(summary) && summary.textContent.trim().length > 5) m.metaMs = t;
            if (m.titleMs === undefined && route) {
                var logo = route.querySelector('img[class*="logo-"]'), name = route.querySelector('[class*="logo-placeholder"]');
                if ((logo && logo.complete && logo.naturalWidth > 0 && visible(logo)) || (name && visible(name) && name.textContent)) m.titleMs = t;
            }
            if (m.streamMs === undefined && route && route.querySelector('[class*="stream-container"]')) m.streamMs = t;
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

// The state before a measured launch: the TV-like library and no notifications bucket (the boot pulls them).
const SEED = `(function () {
    localStorage.setItem('library', ${JSON.stringify(LIBRARY.library)});
    localStorage.setItem('library_recent', ${JSON.stringify(LIBRARY.library_recent)});
    localStorage.removeItem('notifications');
    return true;
})()`;

async function measuredLaunch(result, label, quiet) {
    const boardS = await launch();
    // The page side as early as possible: the calls of the boot too.
    await evaluate(HOOK);
    // The fixture check goes to the worker, which may be busy with the boot: not awaited here (it would push
    // the opening past the boot's work), read after the openings.
    await evaluate(`(window.__f86.check = null, Promise.all([window.core.getState('ctx'), window.core.getState('continue_watching_preview')]).then(function (s) {
        window.__f86.check = { addons: s[0].profile.addons.map(function (a) { return a.manifest.id; }), continueWatching: s[1].items.length,
            library: (localStorage.getItem('library') || '').length, libraryRecent: (localStorage.getItem('library_recent') || '').length };
    }), true)`);
    log(`[${label}] Board after ${boardS} s; quiet ${quiet} s`);
    const launchInfo = { quiet, boardS };
    result.launches.push(launchInfo);
    await sleep(quiet * 1000);
    for (let i = 1; i <= OPENINGS; i++) {
        // How busy the worker is right before the opening: a small getState, not awaited (read at the end).
        await evaluate(`(function () { var f = window.__f86, t = performance.now(); f.rtt = null; window.core.getState('streaming_server').then(function () { f.rtt = Math.round(performance.now() - t); }); return true; })()`);
        const profiling = PROFILE_OPENING === i;
        if (profiling) {
            await attachWorker();
            await wsend('Profiler.enable');
            await wsend('Profiler.setSamplingInterval', { interval: PROFILE_INTERVAL_US });
            await wsend('Profiler.start');
        }
        const pageProfiling = PAGE_PROFILE_OPENING === i;
        if (pageProfiling) {
            await session.send('Profiler.enable');
            await session.send('Profiler.setSamplingInterval', { interval: 1000 });
            await session.send('Profiler.start');
        }
        const before = ticks();
        await evaluate(`window.__f86.open(${FROM_BOARD ? 'null' : JSON.stringify(HASH)})`);
        const start = Date.now();
        let m = null;
        let previewShot = i !== 1;
        while (Date.now() - start < 95000) {
            await sleep(500);
            m = JSON.parse(await evaluate('JSON.stringify(window.__f86.m)').catch(() => 'null'));
            if (m && m.doneMs !== undefined) break;
            // The first opening, once: the screen with the title and no real meta yet (the preview, F8.6).
            if (!previewShot && m && m.titleMs !== undefined && m.metaMs === undefined) {
                previewShot = true;
                try {
                    const shot = await session.send('Page.captureScreenshot', {}, 30000);
                    fs.writeFileSync(path.join(OUT, `${label}.preview.png`), Buffer.from(shot.data, 'base64'));
                } catch (e) { /* no screenshot */ }
            }
        }
        if (pageProfiling) {
            const r = await session.send('Profiler.stop', {}, 300000).catch(() => null);
            if (r && r.profile) fs.writeFileSync(path.join(OUT, `${label}-q${quiet}.page.cpuprofile`), JSON.stringify(r.profile));
            await session.send('Profiler.disable').catch(() => null);
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
        const page = JSON.parse(await evaluate(`JSON.stringify({ calls: window.__f86.calls, rtt: window.__f86.rtt, streams: document.querySelectorAll('[class*="stream-container"]').length })`));
        const workerRttMs = page.rtt;
        const calls = page.calls;
        const count = (side, p, model) => calls.filter((c) => c[0] === side && c[1] === p && (model === undefined || c[3] === model)).length;
        const opening = {
            n: i, quiet, ...m, workerRttMs, idleMs, streamsAt: page.streams,
            ticks: tickDelta(before, after),
            getState: Object.fromEntries([...new Set(calls.filter((c) => c[1] === 'getState').map((c) => c[3]))].map((model) => [model, count('page', 'getState', model)])),
            newState: calls.filter((c) => c[1] === 'onCoreEvent' && /^NewState/.test(c[3] || '')).length,
            setItem: calls.filter((c) => c[1] === 'localStorage.setItem').map((c) => c[3]),
            calls,
            profiled: profiling ? `${label}.worker.cpuprofile` : undefined,
        };
        result.openings.push(opening);
        if (!launchInfo.fixture) {
            launchInfo.fixture = await evaluate('window.__f86.check').catch(() => null);
            const check = launchInfo.fixture;
            if (!check || !check.addons.includes('io.github.gabrielsflores.webos.test-debrid') || check.continueWatching === 0) throw new Error(`fixture not in place: ${JSON.stringify(check)}`);
        }
        save();
        log(`[${label}] opening ${i}`, JSON.stringify({ titleMs: opening.titleMs, metaMs: opening.metaMs, tvMetaMs: opening.tvMetaMs, streamMs: opening.streamMs, idleMs, streamsAt: opening.streamsAt, getState: opening.getState, newState: opening.newState, setItem: opening.setItem, ticks: opening.ticks }));
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
}

async function round(ipk, label) {
    log(`[${label}] install ${path.basename(ipk)}`);
    try { execFileSync('ares-install', ['-d', DEVICE, '--remove', APP_ID], { stdio: 'ignore' }); } catch (e) { /* not installed */ }
    execFileSync('ares-install', ['-d', DEVICE, ipk], { stdio: 'ignore' });
    await sleep(3000);
    log(`[${label}] first launch: Board after ${await launch()} s; seeding the library and the addon`);
    await evaluate(SEED);
    await evaluate(`fetch(${JSON.stringify(manifestUrl)}).then(function (r) { return r.json(); }).then(function (manifest) {
        return window.core.dispatch({ action: 'Ctx', args: { action: 'InstallAddon', args: { transportUrl: ${JSON.stringify(manifestUrl)}, manifest: manifest, flags: { official: false, protected: false } } } });
    }).then(function () { return true; })`);
    await sleep(6000);
    await evaluate('window.__stremioPersist && window.__stremioPersist.flush ? Promise.resolve(window.__stremioPersist.flush()).then(function () { return true; }) : true').catch(() => null);
    await sleep(2000);
    await close();
    const result = { ipk: path.basename(ipk), label, launches: [], openings: [] };
    // Saved after every opening (a stuck opening keeps the ones before it).
    results.push(result);
    for (const quiet of QUIETS) {
        await measuredLaunch(result, label, quiet);
        // The same state for the next launch: the library again and no notifications (the core wrote them).
        await evaluate(SEED).catch(() => null);
        await sleep(3000);
        await close();
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
    for (const quiet of QUIETS) {
        const mine = results.filter((x) => x.ipk === path.basename(ipk) && x.openings && x.openings.length > 0);
        const pick = (fn, first) => median(mine.flatMap((x) => x.openings.filter((o) => o.quiet === quiet && (!first || o.n === 1)).map(fn)).filter((v) => typeof v === 'number'));
        const row = (first) => ({
            titleMs: pick((o) => o.titleMs, first), metaMs: pick((o) => o.metaMs, first), streamMs: pick((o) => o.streamMs, first), idleMs: pick((o) => o.idleMs, first),
            workerRttMs: pick((o) => o.workerRttMs, first), workerCpuMs: pick((o) => (workerTicks(o) === null ? null : workerTicks(o) * 10), first),
        });
        log(path.basename(ipk), `quiet ${quiet}`, JSON.stringify({ rounds: mine.length, first: row(true), all: row(false) }));
    }
}
addon.kill('SIGTERM');
process.exit(0);
