#!/usr/bin/env node
// The vendored core in Node from the app's boot to opening a title (F8.7): how much core work the boot
// leaves running when the user opens Details, and how much the opening itself costs.
//
//   node webos/tests/perf/boot-bench.js [--vendor <dir>] [--wasm2js <file>] [--app upstream|webos]
//        [--open-after board|idle|<ms>] [--latency <ms>] [--cache <dir>] [--offline] [--notifications fresh]
//        [--serial] [--repeat N] [--passes N] [--openings N] [--warm-up] [--json <out.json>]
//   node --cpu-prof --cpu-prof-dir <dir> webos/tests/perf/boot-bench.js --vendor <core built with --profiling> ...
//
// - Storage: the TV-like library (library-fixture.js, real IMDb ids, so the notifications pull gets real
//   metas), no `notifications` bucket (the pull runs at boot) unless --notifications fresh, the default
//   guest profile plus a local Torrentio-like addon (224 streams, torrentio.js).
// - Network: every request outside the local addon is recorded once in --cache (default
//   ~/webos-tv-sdk/run/f87/net-cache) and replayed from it afterwards, after --latency ms (default 150),
//   so two runs see the same answers; --offline fails a request that is not in the cache.
// - The page, like the app: the Ctx actions of App.js at boot (--app upstream: PullAddonsFromAPI,
//   PullUserFromAPI, SyncLibraryWithAPI and PullNotifications; --app webos: what the webOS app sends,
//   webos/lib/boot-pulls), the Board (Load CatalogsWithExtra and LoadRange of the first rows) and one
//   get_state per watched model and NewState (the F7.2 coalescing).
// - The opening: Load MetaDetails of the first movie of the Board's first catalog, --open-after the first
//   Board row (`board`), once the core is idle (`idle`) or N ms after the boot started. Timed on the
//   same clock: the meta Ready and the first stream Ready reach the page (the get_state that brings them).
// --serial: the answers reach the core one at a time, each timed alone (attribution, not end to end).
// The core's time is measured from JS: every dispatch and get_state, and the "futures" (fetch answers
// handled inside the wasm) as the time of each task in which the core ran. Prints and writes (--json)
// the summary and the timeline.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
// v58.mjs (Node 8, the V8 of the TV) gives its own performance; perf_hooks only exists from Node 8.5.
const performance = global.performance || require('perf_hooks').performance;
const { libraryFixture } = require('./library-fixture');
const { torrentioStreams } = require('../addon/torrentio');

const args = process.argv.slice(2);
const option = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index !== -1 && index + 1 < args.length ? args[index + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const VENDOR = path.resolve(option('vendor', path.join(__dirname, '..', '..', 'vendor', 'stremio-core-web')));
const WASM2JS = option('wasm2js', null);
const APP = option('app', 'upstream');
const OPEN_AFTER = option('open-after', 'board');
const LATENCY = Number(option('latency', 150));
const CACHE = path.resolve(option('cache', path.join(os.homedir(), 'webos-tv-sdk', 'run', 'f87', 'net-cache')));
const OFFLINE = flag('offline');
const BASE = 'file:///app/';
const ADDON = 'http://fixture.addon/manifest.json';
const MANIFEST = {
    id: 'io.github.gabrielsflores.webos.test-torrentio',
    version: '1.0.0',
    name: 'Torrentio de teste',
    resources: ['stream'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: [],
};

const readFile = (url) => {
    const name = url.slice(BASE.length);
    if (WASM2JS && name.endsWith('.wasm2js.js')) return fs.readFileSync(WASM2JS);
    return fs.readFileSync(path.join(VENDOR, name));
};

const t0 = performance.now();
const now = () => Math.round(performance.now() - t0);
const timeline = [];
const note = (entry) => {
    timeline.push({ at: now(), ...entry });
    // BENCH_TRACE=1: the timeline as it happens, on stderr.
    if (process.env.BENCH_TRACE) process.stderr.write(`${JSON.stringify(timeline[timeline.length - 1])}\n`);
};

// The time the core ran, per kind: wrapped calls (dispatch, get_state) and the tasks in which a fetch
// answer was handed to the wasm (the futures: deserialize, update of every model, effects).
const busy = { dispatch: 0, getState: 0, futures: 0 };
const futuresBy = {};

const storage = { schema_version: '25' };
Object.assign(storage, libraryFixture());
if (flag('notifications') && option('notifications', '') === 'fresh') {
    storage.notifications = JSON.stringify({ uid: null, items: {}, lastUpdated: new Date().toISOString(), created: new Date().toISOString() });
}

class XMLHttpRequest {
    open(_method, url) {
        this.url = url;
    }

    send() {
        setTimeout(() => {
            const bytes = readFile(this.url);
            this.status = 0;
            this.response = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            this.onload();
        }, 0);
    }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const realFetch = global.fetch;
const fromEntries = (entries) => entries.reduce((o, [k, v]) => Object.assign(o, { [k]: v }), {});
if (!fs.existsSync(CACHE)) fs.mkdirSync(CACHE, { recursive: true });
const cached = async (url) => {
    const file = path.join(CACHE, `${crypto.createHash('sha1').update(url).digest('hex')}.json`);
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
    if (OFFLINE) return { url, error: 'offline' };
    let entry;
    try {
        const response = await realFetch(url, { redirect: 'follow' });
        entry = { url, status: response.status, body: await response.text() };
    } catch (error) {
        entry = { url, error: String(error && error.message) };
    }
    fs.writeFileSync(file, JSON.stringify(entry));
    return entry;
};
// Which answer is this (for the per-kind futures time)?
const kindOf = (url) => {
    if (url.startsWith('http://fixture.addon/stream/')) return 'streams';
    if (/lastVideosIds=/.test(url)) return 'notifications';
    if (/\/catalog\//.test(url)) return 'catalog';
    if (/\/meta\//.test(url)) return 'meta';
    if (/api\.strem\.io/.test(url)) return 'api';
    return 'other';
};
const SERIAL = flag('serial');
let gate = Promise.resolve();
global.self = global;
// The page's calls reach the worker as `message` events (webos/lib/meta-first watches them).
const messageListeners = [];
global.addEventListener = (name, fn) => { if (name === 'message') messageListeners.push(fn); };
const pageMessage = (path, args) => messageListeners.forEach((fn) => fn({ data: { request: { id: 'bench', path, args } } }));
global.WorkerGlobalScope = Object;
global.location = { href: `${BASE}worker.js` };
global.document = { baseURI: `${BASE}worker.js` };
global.XMLHttpRequest = XMLHttpRequest;
global.importScripts = (url) => new Function('module', readFile(url).toString('utf8'))(undefined);
global.fetch = async (request) => {
    const url = typeof request === 'string' ? request : request.url;
    const kind = kindOf(url);
    note({ fetch: kind, url: url.length > 140 ? `${url.slice(0, 140)}…` : url });
    let entry;
    if (url === ADDON) entry = { status: 200, body: JSON.stringify(MANIFEST) };
    else if (url.startsWith('http://fixture.addon/stream/')) entry = { status: 200, body: JSON.stringify({ streams: torrentioStreams('http://10.0.2.2:1', { count: 224 }), cacheMaxAge: 0 }) };
    else entry = await cached(url);
    await sleep(LATENCY);
    if (entry.error) {
        note({ answer: kind, error: entry.error });
        // The core handles the failure in the microtasks after the rejection: time them too.
        const start = performance.now();
        const others = busy.getState + busy.dispatch;
        setImmediate(() => {
            const ms = performance.now() - start - (busy.getState + busy.dispatch - others);
            busy.futures += ms;
            futuresBy.failed = (futuresBy.failed || 0) + ms;
            note({ handled: 'failed', ms: Math.round(ms) });
        });
        throw new TypeError(`Failed to fetch (${entry.error})`);
    }
    note({ answer: kind, status: entry.status, bytes: entry.body.length });
    const response = new Response(entry.body, { status: entry.status, headers: { 'content-type': 'application/json' } });
    // The core reads the text and handles it in the same task: time that task. With --serial the answers
    // reach the core one at a time (the next one waits until this one was handled), so that each time is
    // one answer's; otherwise answers that resolve together are timed together.
    const text = response.text.bind(response);
    response.text = () => {
        const previous = SERIAL ? gate : Promise.resolve();
        let release;
        if (SERIAL) gate = new Promise((resolve) => { release = resolve; });
        return previous.then(() => text()).then((body) => {
            const start = performance.now();
            // The page's getState and dispatch calls that ran in between are timed on their own.
            const others = busy.getState + busy.dispatch;
            setImmediate(() => {
                const ms = performance.now() - start - (busy.getState + busy.dispatch - others);
                busy.futures += ms;
                futuresBy[kind] = (futuresBy[kind] || 0) + ms;
                if (ms > 5) note({ handled: kind, ms: Math.round(ms), bytes: body.length });
                if (release) release();
            });
            return body;
        });
    };
    return response;
};
global.app_version = 'boot-bench';
global.shell_version = null;
global.get_location_hash = async () => '#/';
global.local_storage_get_item = async (key) => (key in storage ? storage[key] : null);
global.local_storage_set_item = async (key, value) => {
    note({ setItem: key, bytes: String(value).length });
    storage[key] = value;
};
global.local_storage_remove_item = async (key) => {
    delete storage[key];
};
console.log = () => {};
console.info = () => {};
console.warn = () => {};
if (!process.env.BENCH_TRACE) console.error = () => {};
const print = (...a) => process.stdout.write(`${a.join(' ')}\n`);
// A browser only logs an unhandled rejection: count them (the summary has the number).
let unhandledRejections = 0;
process.on('unhandledRejection', (reason) => {
    unhandledRejections += 1;
    note({ unhandledRejection: String(reason && reason.message ? reason.message : reason).slice(0, 120) });
});

(async () => {
    // The webOS worker entry (webos/tlsproxy/worker-entry.js) wraps fetch before the core: the catalog trim (F7.2).
    // The tlsproxy itself only matters on the TV (https hosts without the Let's Encrypt chain).
    const { install: installCatalogTrim } = require('../../lib/catalog-trim/index.js');
    installCatalogTrim(global);
    // F8.7: and the meta of a title before its streams.
    require('../../lib/meta-first/index.js').install(global);
    const loader = require('../../core/loader');
    const glue = require(path.join(VENDOR, 'stremio_core_web.js'));
    await glue.default(loader.loadConfigured());
    note({ step: 'loaded', variant: loader.getStatus().variant });

    const timed = (kind, fn) => {
        const start = performance.now();
        try {
            return fn();
        } finally {
            busy[kind] += performance.now() - start;
        }
    };
    const dispatch = (action, field = null, hash = '#/') => {
        const start = performance.now();
        timed('dispatch', () => glue.dispatch(action, field, hash));
        const ms = performance.now() - start;
        note({ dispatch: action.action + (action.args && action.args.action ? `:${action.args.action}` : '') + (action.args && action.args.model ? `:${action.args.model}` : ''), field, ms: Math.round(ms * 10) / 10 });
    };
    const watched = new Set(['ctx', 'board', 'continue_watching_preview', 'streaming_server']);
    const last = {};
    const getState = (model, reason) => {
        pageMessage(['getState'], [model]);
        const start = performance.now();
        const state = last[model] = timed('getState', () => glue.get_state(model));
        const ms = performance.now() - start;
        note({ getState: model, reason, ms: Math.round(ms * 10) / 10, bytes: JSON.stringify(state).length });
        return state;
    };
    let onState = () => {};
    const asked = new Set();
    await glue.initialize_runtime((event) => {
        if (event.name === 'NewState') {
            note({ newState: event.args });
            // The page asks on a later task (postMessage), one get_state per watched model; NewState events that
            // come before that task share it (webos/lib/core-calls, F7.2).
            const models = event.args.filter((m) => watched.has(m));
            const first = asked.size === 0;
            models.forEach((m) => asked.add(m));
            if (models.length && first) {
                setTimeout(() => {
                    const all = [...asked];
                    asked.clear();
                    all.forEach((m) => getState(m, 'NewState'));
                    onState();
                }, 0);
            }
        } else if (event.name === 'CoreEvent') {
            note({ coreEvent: event.args && event.args.event });
        }
    });
    note({ step: 'runtime' });

    // The local addon in the profile (on the TV: Torrentio + AllDebrid), before the boot of the page.
    dispatch({ action: 'Ctx', args: { action: 'InstallAddon', args: { transportUrl: ADDON, manifest: MANIFEST, flags: { official: false, protected: false } } } });
    await sleep(LATENCY + 100);
    timeline.length = 0;
    Object.keys(busy).forEach((k) => { busy[k] = 0; });
    Object.keys(futuresBy).forEach((k) => { delete futuresBy[k]; });
    const boot = performance.now();
    note({ step: 'boot' });

    // App.js
    ['ctx', 'continue_watching_preview', 'streaming_server'].forEach((m) => getState(m, 'mount'));
    if (APP === 'upstream') {
        dispatch({ action: 'Ctx', args: { action: 'PullAddonsFromAPI' } });
        dispatch({ action: 'Ctx', args: { action: 'PullUserFromAPI', args: {} } });
        dispatch({ action: 'Ctx', args: { action: 'SyncLibraryWithAPI' } });
        dispatch({ action: 'Ctx', args: { action: 'PullNotifications' } });
    } else if (APP !== 'webos') {
        throw new Error(`--app ${APP}?`);
    }
    // Board (useBoard + useVisibleCatalogs: the first rows and the preload).
    dispatch({ action: 'Load', args: { model: 'CatalogsWithExtra', args: { extra: [] } } }, 'board');
    getState('board', 'mount');
    dispatch({ action: 'CatalogsWithExtra', args: { action: 'LoadRange', args: { start: 0, end: 8 } } }, 'board');

    const firstMovie = () => {
        const catalogs = (last.board && last.board.catalogs) || [];
        for (const catalog of catalogs) {
            const content = catalog && catalog.content;
            if (content && content.type === 'Ready') {
                const item = content.content.find((m) => m.type === 'movie');
                if (item) return item.id;
            }
        }
        return null;
    };
    // Waits for: the first Board row; or the core idle (no fetch pending and nothing ran for 300 ms).
    let pending = 0;
    const innerFetch = global.fetch;
    global.fetch = (...a) => {
        pending += 1;
        const done = (value) => { pending -= 1; return value; };
        return innerFetch(...a).then(done, (error) => { done(); throw error; });
    };
    let boardAt = null;
    for (let i = 0; i < 4000 && !firstMovie(); i++) await sleep(5);
    boardAt = Math.round(performance.now() - boot);
    note({ step: 'board', movie: firstMovie() });
    if (OPEN_AFTER === 'idle') {
        let quietSince = performance.now();
        let lastLen = timeline.length;
        while (performance.now() - quietSince < 300) {
            await sleep(20);
            if (pending > 0 || timeline.length !== lastLen) {
                quietSince = performance.now();
                lastLen = timeline.length;
            }
        }
    } else if (OPEN_AFTER !== 'board') {
        await sleep(Math.max(0, Number(OPEN_AFTER) - (performance.now() - boot)));
    }
    const bootBusy = { ...busy, futuresBy: { ...futuresBy } };
    Object.keys(bootBusy).forEach((k) => { if (typeof bootBusy[k] === 'number') bootBusy[k] = Math.round(bootBusy[k]); });
    Object.keys(bootBusy.futuresBy).forEach((k) => { bootBusy.futuresBy[k] = Math.round(bootBusy.futuresBy[k]); });

    // --warm-up: the core's webos_warm_up (webos/core/warm-up.patch) once the boot is done, as the page does
    // when idle; what it changed in the core (it must change nothing) and what the page saw meanwhile.
    let warmUp;
    if (flag('warm-up')) {
        const models = ['ctx', 'board', 'meta_details', 'continue_watching_preview', 'library', 'player'];
        const snapshot = () => models.map((m) => JSON.stringify(glue.get_state(m)));
        const before = snapshot();
        const from = timeline.length;
        const start = performance.now();
        const titles = option('warm-up-skip', null) ? -1 : glue.webos_warm_up();
        const ms = Math.round(performance.now() - start);
        await sleep(LATENCY + 200);
        const seen = timeline.slice(from).filter((e) => e.newState || e.coreEvent || e.setItem || e.fetch);
        const after = snapshot();
        warmUp = { titles, ms, sameState: after.every((x, i) => x === before[i]), changed: models.filter((m, i) => after[i] !== before[i]), seen };
        note({ step: 'warm-up', ms, titles });
    }

    // The opening (useMetaDetails on Details): the page now watches meta_details too. --openings N: N
    // different movies of the Board, one after the other (the first one pays the lazy compilation).
    const movies = () => {
        const out = [];
        ((last.board && last.board.catalogs) || []).forEach((catalog) => {
            const content = catalog && catalog.content;
            if (content && content.type === 'Ready') content.content.forEach((m) => { if (m.type === 'movie' && out.indexOf(m.id) === -1) out.push(m.id); });
        });
        return out;
    };
    watched.add('meta_details');
    const openings = [];
    const openOne = async (id) => {
        const hash = `#/detail/movie/${id}/${id}`;
        const open = performance.now();
        const before = { ...busy };
        note({ step: 'open', id });
        const marks = {};
        onState = () => {
            const s = last.meta_details;
            if (!s || !s.selected || !s.selected.metaPath || s.selected.metaPath.id !== id) return;
            const t = Math.round(performance.now() - open);
            if (marks.metaMs === undefined && s.metaItem && s.metaItem.content && s.metaItem.content.type === 'Ready') marks.metaMs = t;
            const streams = s.streams && s.streams.find((x) => x.addon.manifest.id === MANIFEST.id);
            if (marks.streamMs === undefined && streams && streams.content && streams.content.type === 'Ready') marks.streamMs = t;
        };
        dispatch({
            action: 'Load',
            args: {
                model: 'MetaDetails',
                args: {
                    metaPath: { resource: 'meta', type: 'movie', id, extra: [] },
                    streamPath: { resource: 'stream', type: 'movie', id, extra: [] },
                    guessStream: true,
                },
            },
        }, 'meta_details', hash);
        getState('meta_details', 'mount');
        for (let i = 0; i < 3000 && (marks.metaMs === undefined || marks.streamMs === undefined); i++) await sleep(10);
        // Until idle, for the whole opening's core time.
        await sleep(Math.max(1500, LATENCY * 4));
        const core = fromEntries(Object.keys(before).map((k) => [k, Math.round(busy[k] - before[k])]));
        openings.push({ id, openAtMs: Math.round(open - boot), metaMs: marks.metaMs, streamMs: marks.streamMs, coreMs: core });
    };
    const ids = movies().slice(0, Number(option('openings', 1)));
    for (const id of ids) await openOne(id);
    const { id, openAtMs, metaMs, streamMs, coreMs: openBusy } = openings[0];
    // --passes N: the cost of one message through every model of the core (a Ctx action a guest's core does
    // nothing with: what each addon answer pays before its own work), N times.
    const passes = [];
    for (let i = 0; i < Number(option('passes', 0)); i++) {
        const start = performance.now();
        glue.dispatch({ action: 'Ctx', args: { action: 'PullAddonsFromAPI' } }, null, '#/');
        passes.push(performance.now() - start);
    }
    passes.sort((a, b) => a - b);
    // --repeat N: the cost of one get_state of the opened Details (meta and 224 streams), N times.
    const repeated = [];
    for (let i = 0; i < Number(option('repeat', 0)); i++) {
        const start = performance.now();
        glue.get_state('meta_details');
        repeated.push(performance.now() - start);
    }
    repeated.sort((a, b) => a - b);
    const summary = {
        vendor: path.basename(VENDOR),
        app: APP,
        openAfter: OPEN_AFTER,
        latency: LATENCY,
        boardMs: boardAt,
        openAtMs,
        movie: id,
        metaMs,
        streamMs,
        openings,
        warmUp,
        unhandledRejections,
        passMs: passes.length ? Math.round(passes[passes.length >> 1] * 100) / 100 : undefined,
        getStateMetaDetailsMs: repeated.length ? Math.round(repeated[repeated.length >> 1] * 10) / 10 : undefined,
        getStateMetaDetailsBytes: repeated.length ? JSON.stringify(glue.get_state('meta_details')).length : undefined,
        coreBeforeOpenMs: bootBusy,
        coreDuringOpenMs: openBusy,
        coreTotalMs: fromEntries(Object.entries(busy).map(([k, v]) => [k, Math.round(v)])),
        futuresByKind: fromEntries(Object.entries(futuresBy).map(([k, v]) => [k, Math.round(v)])),
        dispatches: timeline.filter((e) => e.dispatch).length,
        newState: timeline.filter((e) => e.newState).length,
        getState: fromEntries([...new Set(timeline.filter((e) => e.getState).map((e) => e.getState))].map((m) => [m, timeline.filter((e) => e.getState === m).length])),
        setItem: timeline.filter((e) => e.setItem).map((e) => `${e.setItem}:${e.bytes}`),
        fetches: timeline.filter((e) => e.answer).map((e) => `${e.answer}:${e.bytes || e.error}`),
    };
    print(JSON.stringify(summary, null, 1));
    const out = option('json', null);
    if (out) fs.writeFileSync(out, JSON.stringify({ summary, timeline }, null, 1));
    process.exit(0);
})().catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : JSON.stringify(error)}\n`);
    process.exit(1);
});
