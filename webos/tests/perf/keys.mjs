#!/usr/bin/env node
// Arrow key latency on the Board and the time to open Details (F8.2), A/B of IPKs in ONE reservation.
//
//   webos/tools/emu-run --profile c8 --timeout 50 -- node webos/tests/perf/keys.mjs --out <dir> --rounds 2 <a.ipk> <b.ipk> ...
//
// Per round, each IPK in turn (the list reversed in the even rounds: ABBA): install, launch, wait for the
// Board and its catalogs, then
// - keys: a fixed walk of arrows on the Board, sent like on the TV (CDP Input.dispatchKeyEvent, F8 notes,
//   Diagnosis 2). For each key, on the page's clock: the keydown (event.timeStamp), the focusin it caused,
//   and the second animation frame after the key (the frame that shows the new focus): `frameMs`;
// - profile (--profile-keys N, default 8): a CPU profile over N more arrows, self time per function;
// - trace (--trace-keys N, default 4): a timeline trace over N more arrows: time in style recalc, layout,
//   paint, and the JavaScript that forced a layout (the call frame of each forced Layout);
// - details (--details N, default 3): OK on a poster of the first row (another one each time), timed from
//   the keydown to the route (#/detail), the info column, the title (the logo image loaded or the name
//   shown) and the streams column (a stream or a message); on the same clock, the Load of MetaDetails sent
//   to the core, the first meta_details state with the meta ready, the logo's download (Resource Timing),
//   every core call of the page meanwhile (`calls`) and, before the OK, the round trip of a small getState
//   (is the worker busy?). Then Back. --profile-details N / --trace-details N: a CPU profile / a timeline
//   trace over the Nth opening. The first opening after the boot is reported apart (`first`).
// Writes <dir>/keys.json (every round) and prints the medians per IPK.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { APP_ID, connect, median, parseArgs, sleep } from './lib.mjs';

const args = parseArgs(process.argv.slice(2));
const IPKS = args._.map((p) => path.resolve(p));
const OUT = path.resolve(args.out || 'perf-keys');
const ROUNDS = Number(args.rounds || 1);
const QUIET_S = Number(args.quiet || 20);
const PROFILE_KEYS = Number(args['profile-keys'] ?? 8);
const TRACE_KEYS = Number(args['trace-keys'] ?? 4);
const DETAILS = Number(args.details ?? 3);
// --profile-details N: a CPU profile over the Nth opening of Details (from the OK to the title).
const PROFILE_DETAILS = Number(args['profile-details'] || 0);
// --trace-details N: a timeline trace over the Nth opening of Details.
const TRACE_DETAILS = Number(args['trace-details'] || 0);
const GAP_MS = Number(args.gap || 1500);
const { EMU_DEVICE: DEVICE, EMU_CDP_PORT: CDP_PORT } = process.env;
if (!DEVICE || !CDP_PORT || IPKS.length === 0) {
    console.error('usage (inside webos/tools/emu-run): keys.mjs --out <dir> [--rounds N] <ipk>...');
    process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(`[${new Date().toTimeString().slice(0, 8)}]`, ...a);

// The walk: along the first rows and back, down and up across rows (a row still loading only peeks: no
// focus change, kept apart in the results).
const WALK = ['right', 'right', 'right', 'right', 'down', 'right', 'right', 'down', 'left', 'left', 'down', 'right',
    'up', 'up', 'right', 'right', 'down', 'down', 'left', 'up', 'left', 'left', 'up', 'right'];
const CODES = { left: 37, up: 38, right: 39, down: 40, enter: 13 };
const NAMES = { left: 'ArrowLeft', up: 'ArrowUp', right: 'ArrowRight', down: 'ArrowDown', enter: 'Enter' };

const ROUTE = `document.querySelector('.routes-container > .route-container:last-child')`;
const BOARD_READY = `(function () { var h = location.hash; if (h !== '' && h !== '#/') return false; var route = ${ROUTE};
    return !!route && !!route.querySelector('[class*="board-content"] [class*="meta-item-container"]') && document.activeElement !== document.body; })()`;

// Page side: one record per key (window.__f82.keys), and the Details timer.
const HOOK = `(function () {
    if (window.__f82) return 'already';
    var f = window.__f82 = { keys: [], details: null };
    var describe = function (el) {
        if (!el || el === document.body) return 'body';
        var c = typeof el.className === 'string' ? el.className.split(' ')[0] : '';
        return el.tagName.toLowerCase() + (c ? '.' + c : '') + (el.title ? ' "' + el.title.slice(0, 24) + '"' : '');
    };
    var visible = function (el) { if (!el) return false; var r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    window.addEventListener('keydown', function (e) {
        var now = performance.now();
        // Chromium 53: timeStamp is on the performance.now() clock; else fall back to the handler time.
        var t0 = e.timeStamp > 0 && e.timeStamp <= now && now - e.timeStamp < 5000 ? e.timeStamp : now;
        if (e.keyCode === 13 && f.details && f.details.t0 === null) { f.details.t0 = t0; return; }
        if (e.keyCode < 37 || e.keyCode > 40) return;
        var from = document.activeElement;
        var k = f.cur = { code: e.keyCode, t0: t0, handlerAt: now - t0, from: describe(from) };
        f.keys.push(k);
        requestAnimationFrame(function () {
            k.frame1 = performance.now() - t0;
            requestAnimationFrame(function () {
                k.frameMs = performance.now() - t0;
                k.to = describe(document.activeElement);
                k.moved = document.activeElement !== from;
            });
        });
    }, true);
    document.addEventListener('focusin', function () {
        var k = f.cur; if (k && k.focusMs === undefined) k.focusMs = performance.now() - k.t0;
    }, true);
    // The core calls of Details, on the same clock: the Load of MetaDetails sent to the worker, and the
    // first meta_details state with the meta item ready (what the page renders the title from).
    var core = window.core;
    if (core && !core.__f82) {
        core.__f82 = true;
        var dispatch = core.dispatch, getState = core.getState;
        core.dispatch = function (action) {
            var d = f.details;
            if (d && d.t0 !== null && d.calls) d.calls.push(['dispatch', action && (action.action + (action.args && action.args.model ? ':' + action.args.model : '')), Math.round(performance.now() - d.t0)]);
            if (d && d.t0 !== null && d.loadMs === undefined && action && action.action === 'Load' && action.args && action.args.model === 'MetaDetails') d.loadMs = performance.now() - d.t0;
            return dispatch.apply(this, arguments);
        };
        core.getState = function (model) {
            var r = getState.apply(this, arguments), d = f.details;
            if (d && d.t0 !== null && d.calls && r && r.then) {
                var call = ['getState', model, Math.round(performance.now() - d.t0)];
                d.calls.push(call);
                r.then(function () { call.push(Math.round(performance.now() - d.t0)); }, function () {});
            }
            if (model === 'meta_details' && d && d.t0 !== null && r && r.then) {
                var asked = performance.now() - d.t0;
                r.then(function (state) {
                    var item = state && state.metaItem;
                    if (d.metaReadyMs === undefined && item && item.content && item.content.type === 'Ready') { d.metaAskedMs = asked; d.metaReadyMs = performance.now() - d.t0; }
                }, function () {});
            }
            return r;
        };
    }
    // Details: armed before the OK; checked on every frame from the keydown.
    f.armDetails = function () {
        // calls: the core calls of the page while Details opens ([kind, model or action, sent at, answered at]).
        var d = f.details = { t0: null, calls: [] };
        var frame = function () {
            if (f.details !== d) return;
            if (d.t0 !== null) {
                var t = performance.now() - d.t0, route = ${ROUTE};
                if (d.routeMs === undefined && /^#\\/detail\\//.test(location.hash) && route && route.querySelector('[class*="metadetails-container"]')) d.routeMs = t;
                if (d.routeMs !== undefined && d.infoMs === undefined && route && visible(route.querySelector('[class*="meta-info-container"]'))) d.infoMs = t;
                if (d.routeMs !== undefined && d.titleMs === undefined && route) {
                    var logo = route.querySelector('img[class*="logo-"]'), name = route.querySelector('[class*="logo-placeholder"]');
                    if (logo && d.logoElementMs === undefined) { d.logoElementMs = t; d.logoSrc = logo.src; }
                    if ((logo && logo.complete && logo.naturalWidth > 0 && visible(logo)) || (name && visible(name) && name.textContent)) d.titleMs = t;
                }
                if (d.routeMs !== undefined && d.listMs === undefined && route) {
                    var list = route.querySelector('[class*="streams-list-container"], [class*="videos-list-container"]');
                    if (list && list.querySelector('[class*="stream-container"], [class*="video-container"], [class*="message-container"]')) d.listMs = t;
                }
                if ((d.titleMs !== undefined && d.listMs !== undefined) || t > 30000) {
                    // The logo's download, on the same clock (Resource Timing): how much of the title is network.
                    var entry = d.logoSrc && performance.getEntriesByName ? performance.getEntriesByName(d.logoSrc).pop() : null;
                    if (entry) { d.logoFetchStartMs = entry.startTime - d.t0; d.logoResponseEndMs = entry.responseEnd - d.t0; }
                    d.done = true; return;
                }
            }
            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
        return true;
    };
    return 'installed';
})()`;

let session;
const evaluate = (expr, ms = 60000) => session.evaluate(expr, ms);
const key = async (name) => {
    const code = CODES[name];
    await session.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key: NAMES[name] });
    await session.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key: NAMES[name] });
};

// Self time per function of a CPU profile (Chromium 53: nodes with children ids, or a head tree).
const profileSummary = (profile) => {
    const flat = [];
    const walk = (n) => { flat.push(n); (n.children || []).forEach((c) => (typeof c === 'object' ? walk(c) : null)); };
    if (profile.nodes) flat.push(...profile.nodes); else walk(profile.head);
    const nodes = new Map(flat.map((n) => [n.id, n]));
    const self = new Map();
    // Chromium 53: startTime/endTime in seconds (newer: microseconds).
    const spanMs = (profile.endTime - profile.startTime) * (profile.endTime - profile.startTime < 1e5 ? 1000 : 1e-3);
    const dt = spanMs / profile.samples.length;
    for (const s of profile.samples) {
        const n = nodes.get(s);
        const cf = n.callFrame || n;
        const k = `${cf.functionName || '(anon)'} ${String(cf.url || '').split('/').pop()}:${cf.lineNumber}`;
        self.set(k, (self.get(k) || 0) + dt);
    }
    return { totalMs: Math.round(spanMs), top: [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => [k, Math.round(v)]) };
};

// A timeline trace: totals of the rendering events, and the JS frames that forced a layout.
const RENDERING = ['Layout', 'UpdateLayoutTree', 'RecalculateStyles', 'Paint', 'CompositeLayers', 'UpdateLayerTree', 'EventDispatch', 'HitTest', 'ScrollLayer'];
const traceSummary = (events, keys) => {
    const total = {};
    const count = {};
    const forced = new Map();
    const add = (name, ms, args) => {
        total[name] = (total[name] || 0) + ms;
        count[name] = (count[name] || 0) + 1;
        const stack = args && args.beginData && args.beginData.stackTrace;
        if (name !== 'EventDispatch' && name !== 'Paint' && stack && stack.length) {
            const k = `${name} <- ${stack.slice(0, 4).map((f) => `${f.functionName || '(anon)'}@${f.columnNumber}`).join(' < ')}`;
            const v = forced.get(k) || { n: 0, ms: 0 };
            v.n++; v.ms += ms;
            forced.set(k, v);
        }
    };
    // Chromium 53 has both complete events (X) and begin/end pairs (B, E) per thread.
    const open = new Map();
    for (const e of events) {
        if (!RENDERING.includes(e.name)) continue;
        const thread = `${e.pid}:${e.tid}:${e.name}`;
        if (e.ph === 'X' && typeof e.dur === 'number') add(e.name, e.dur / 1000, e.args);
        else if (e.ph === 'B') (open.get(thread) || open.set(thread, []).get(thread)).push(e);
        else if (e.ph === 'E') {
            const begin = (open.get(thread) || []).pop();
            if (begin) add(e.name, (e.ts - begin.ts) / 1000, begin.args);
        }
    }
    const perKey = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round((v / keys) * 10) / 10]));
    return { keys, msPerKey: perKey(total), countPerKey: perKey(count),
        forced: [...forced.entries()].sort((a, b) => b[1].ms - a[1].ms).slice(0, 15).map(([k, v]) => ({ at: k, n: v.n, ms: Math.round(v.ms) })) };
};

const TRACE_CATEGORIES = 'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.stack';
const startTrace = async () => {
    session.events.length = 0;
    await session.send('Tracing.start', { categories: TRACE_CATEGORIES, options: '' });
};
const stopTrace = async (file) => {
    await session.send('Tracing.end');
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline && !session.events.some((m) => m.method === 'Tracing.tracingComplete')) await sleep(200);
    const events = session.events.filter((m) => m.method === 'Tracing.dataCollected').flatMap((m) => m.params.value);
    if (file) fs.writeFileSync(file, JSON.stringify(events));
    return events;
};
const trace = async (n, file) => {
    await startTrace();
    for (let i = 0; i < n; i++) { await key(i % 2 ? 'left' : 'right'); await sleep(GAP_MS); }
    return traceSummary(await stopTrace(file), n);
};

async function round(ipk, label) {
    log(`[${label}] install ${path.basename(ipk)}`);
    try { execFileSync('ares-install', ['-d', DEVICE, '--remove', APP_ID], { stdio: 'ignore' }); } catch (e) { /* not installed */ }
    execFileSync('ares-install', ['-d', DEVICE, ipk], { stdio: 'ignore' });
    await sleep(3000);
    execFileSync('ares-launch', ['-d', DEVICE, APP_ID], { stdio: 'ignore' });
    session = await connect(CDP_PORT, APP_ID, 90000);
    const start = Date.now();
    for (;;) {
        try { if (await evaluate(BOARD_READY, 15000)) break; } catch (e) { /* the document is being replaced */ }
        if (Date.now() - start > 360000) throw new Error('the Board never showed up');
        await sleep(1000);
    }
    log(`[${label}] Board after ${Math.round((Date.now() - start) / 1000)} s; quiet ${QUIET_S} s`);
    await sleep(QUIET_S * 1000);
    await evaluate(HOOK);
    const result = { ipk: path.basename(ipk), label, nodes: await evaluate("document.getElementsByTagName('*').length") };

    for (const k of WALK) { await key(k); await sleep(GAP_MS); }
    result.keys = JSON.parse(await evaluate('JSON.stringify(window.__f82.keys)'));
    const moved = result.keys.filter((k) => k.moved);
    result.keySummary = {
        n: result.keys.length, moved: moved.length,
        focusMedian: median(moved.map((k) => k.focusMs)), frameMedian: median(moved.map((k) => k.frameMs)),
        frameMax: Math.max(...moved.map((k) => k.frameMs)),
        horizontalFrameMedian: median(moved.filter((k) => k.code === 37 || k.code === 39).map((k) => k.frameMs)),
        verticalFrameMedian: median(moved.filter((k) => k.code === 38 || k.code === 40).map((k) => k.frameMs)),
    };
    log(`[${label}] keys`, JSON.stringify(result.keySummary));

    if (PROFILE_KEYS > 0) {
        await session.send('Profiler.enable');
        await session.send('Profiler.setSamplingInterval', { interval: 500 });
        await session.send('Profiler.start');
        for (let i = 0; i < PROFILE_KEYS; i++) { await key(i % 2 ? 'left' : 'right'); await sleep(GAP_MS); }
        const { profile } = await session.send('Profiler.stop');
        await session.send('Profiler.disable');
        fs.writeFileSync(path.join(OUT, `${label}.cpuprofile`), JSON.stringify(profile));
        result.profile = profileSummary(profile);
        log(`[${label}] profile top`, result.profile.top.slice(0, 6).map(([k, v]) => `${v} ${k}`).join(' | '));
    }
    if (TRACE_KEYS > 0) {
        result.trace = await trace(TRACE_KEYS, path.join(OUT, `${label}.trace.json`)).catch((e) => ({ error: String(e.message) }));
        log(`[${label}] trace per key`, JSON.stringify(result.trace.msPerKey || result.trace));
    }

    result.details = [];
    for (let i = 0; i < DETAILS; i++) {
        // A poster of the first row (another one each time): the walk may end on the top bar.
        const poster = await evaluate(`(function () {
            var row = document.querySelector('[class*="board-content"] [class*="meta-items-container"]');
            var links = row ? row.querySelectorAll('[class*="meta-item-link"]') : [];
            var link = links[${i + 1}] || links[0];
            if (!link) return null;
            link.focus();
            return document.activeElement === link ? link.title || 'poster' : null;
        })()`);
        if (!poster) log(`[${label}] details ${i + 1}: no poster to focus`);
        await sleep(GAP_MS);
        // Is the core worker busy? The round trip of a small getState just before the OK.
        const workerRttMs = await evaluate(`(function () { var t = performance.now(); return window.core.getState('ctx').then(function () { return Math.round(performance.now() - t); }); })()`).catch(() => null);
        await evaluate('window.__f82.armDetails()');
        const profiling = PROFILE_DETAILS === i + 1;
        const tracing = TRACE_DETAILS === i + 1;
        if (tracing) await startTrace();
        if (profiling) {
            await session.send('Profiler.enable');
            await session.send('Profiler.setSamplingInterval', { interval: 500 });
            await session.send('Profiler.start');
        }
        await key('enter');
        const deadline = Date.now() + 45000;
        let d = null;
        while (Date.now() < deadline) {
            d = JSON.parse(await evaluate('JSON.stringify(window.__f82.details)').catch(() => 'null'));
            if (d && d.done) break;
            await sleep(500);
        }
        if (tracing) {
            result.detailsTrace = traceSummary(await stopTrace(path.join(OUT, `${label}.details.trace.json`)), 1);
            log(`[${label}] details trace`, JSON.stringify(result.detailsTrace.msPerKey));
        }
        if (profiling) {
            const { profile } = await session.send('Profiler.stop');
            await session.send('Profiler.disable');
            fs.writeFileSync(path.join(OUT, `${label}.details.cpuprofile`), JSON.stringify(profile));
            result.detailsProfile = profileSummary(profile);
            log(`[${label}] details profile top`, result.detailsProfile.top.slice(0, 8).map(([k, v]) => `${v} ${k}`).join(' | '));
        }
        if (d) { d.poster = poster; d.workerRttMs = workerRttMs; delete d.logoSrc; }
        result.details.push(d);
        log(`[${label}] details ${i + 1}`, JSON.stringify(d));
        await sleep(4000);
        // Back: the remote's Back arrives as a history step on the emulator (perf/README).
        await evaluate('history.back(), true');
        const back = Date.now();
        while (Date.now() - back < 30000 && !(await evaluate(BOARD_READY).catch(() => false))) await sleep(500);
        await sleep(3000);
    }
    result.detailsSummary = {
        // The first opening after the boot apart: the core worker may still be loading the Board.
        first: result.details[0] && { routeMs: result.details[0].routeMs, titleMs: result.details[0].titleMs, workerRttMs: result.details[0].workerRttMs },
        routeMedian: median(result.details.map((d) => d && d.routeMs)),
        titleMedian: median(result.details.map((d) => d && d.titleMs)),
        listMedian: median(result.details.map((d) => d && d.listMs)),
    };
    log(`[${label}] details`, JSON.stringify(result.detailsSummary));
    session.close();
    try { execFileSync('ares-launch', ['-d', DEVICE, '--close', APP_ID], { stdio: 'ignore' }); } catch (e) { /* closed */ }
    await sleep(3000);
    return result;
}

const results = [];
const save = () => fs.writeFileSync(path.join(OUT, 'keys.json'), `${JSON.stringify({ profile: process.env.EMU_PROFILE || null, instance: process.env.EMU_INSTANCE, results }, null, 2)}\n`);
for (let r = 1; r <= ROUNDS; r++) {
    const order = r % 2 ? IPKS : [...IPKS].reverse();
    for (const ipk of order) {
        const label = `r${r}-${path.basename(ipk, '.ipk')}`;
        try {
            results.push(await round(ipk, label));
        } catch (e) {
            log(`[${label}] failed: ${e.message}`);
            results.push({ ipk: path.basename(ipk), label, error: String(e.message) });
            try { session && session.close(); } catch (x) { /* closed */ }
        }
        save();
    }
}
for (const ipk of IPKS) {
    const mine = results.filter((x) => x.ipk === path.basename(ipk) && !x.error);
    const all = (pick) => median(mine.flatMap(pick));
    log(path.basename(ipk), JSON.stringify({
        rounds: mine.length,
        keyFrameMedian: all((x) => x.keys.filter((k) => k.moved).map((k) => k.frameMs)),
        keyFocusMedian: all((x) => x.keys.filter((k) => k.moved).map((k) => k.focusMs)),
        detailsRoute: all((x) => x.details.map((d) => d && d.routeMs)),
        detailsTitle: all((x) => x.details.map((d) => d && d.titleMs)),
        detailsList: all((x) => x.details.map((d) => d && d.listMs)),
    }));
}
