#!/usr/bin/env node
// The vendored core in Node, opening one film's Details like the page does (F8.6): how much each
// get_state and each addon answer costs inside the core, without the emulator.
//
//   node webos/tests/perf/core-bench.js [--variant wasm2js|wasm] [--wasm2js <file>] [--vendor <dir>]
//        [--no-library] [--streams N] [--repeat N] [--json <out.json>]
//   node --cpu-prof --cpu-prof-dir <dir> webos/tests/perf/core-bench.js --wasm2js <named.wasm2js.js> ...
//
// - The storage starts with the large library of the TV (library-fixture.js) unless --no-library, and
//   a local addon with N Torrentio-like streams (torrentio.js, default 224) is installed.
// - fetch is local: the Cinemeta meta from webos/tests/perf/fixtures/, the streams from torrentio.js,
//   404 for anything else (catalogs, notifications).
// - Like the page's useModelState (with the F7.2 coalescing): on each NewState, one get_state per
//   model the Details page watches (meta_details, ctx, streaming_server) that is in the event.
// - --wasm2js loads another wasm2js file (for example one built with the function names, to profile).
// Prints and writes (--json) the timeline: every event and get_state with its time and answer size,
// and then N repeated get_state of each model (the cost of one answer).
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
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
const VARIANT = option('variant', 'wasm2js');
const STREAMS = Number(option('streams', 224));
const REPEAT = Number(option('repeat', 5));
const BASE = 'file:///app/';
const ADDON = 'http://fixture.addon/manifest.json';
const META_ID = 'tt15047880';
const META = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `meta-${META_ID}.json`), 'utf8'));
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
};

// The schema of the core 0.65.0 (constants.rs SCHEMA_VERSION): without it the core migrates and drops the buckets.
const storage = { schema_version: '25' };
if (!flag('no-library')) Object.assign(storage, libraryFixture());
if (VARIANT === 'wasm') storage['webos.coreVariant'] = 'wasm';

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

const json = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
});
global.self = global;
global.WorkerGlobalScope = Object;
global.location = { href: `${BASE}worker.js` };
global.document = { baseURI: `${BASE}worker.js` };
global.XMLHttpRequest = XMLHttpRequest;
global.importScripts = (url) => new Function('module', readFile(url).toString('utf8'))(undefined);
global.fetch = async (request) => {
    const url = typeof request === 'string' ? request : request.url;
    // The answer arrives on a later task, like the network.
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (url === ADDON) return json(MANIFEST);
    if (url.startsWith('http://fixture.addon/stream/')) {
        const body = JSON.stringify({ streams: torrentioStreams('http://10.0.2.2:1', { count: STREAMS }), cacheMaxAge: 0 });
        note({ fetch: 'streams', bytes: body.length });
        return json(body);
    }
    if (url.includes(`/meta/movie/${META_ID}.json`)) {
        note({ fetch: 'meta' });
        return json(META);
    }
    return json({ err: 'not found' }, 404);
};
global.app_version = 'core-bench';
global.shell_version = null;
global.get_location_hash = async () => `#/detail/movie/${META_ID}/${META_ID}`;
global.local_storage_get_item = async (key) => (key in storage ? storage[key] : null);
global.local_storage_set_item = async (key, value) => {
    note({ setItem: key, bytes: String(value).length });
    storage[key] = value;
};
global.local_storage_remove_item = async (key) => {
    delete storage[key];
};
// Logs of the core (refused requests and so on) stay out of the output.
console.log = () => {};
console.info = () => {};
console.warn = () => {};
const print = (...a) => process.stdout.write(`${a.join(' ')}\n`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
    const loader = require('../../core/loader');
    const glue = require(path.join(VENDOR, 'stremio_core_web.js'));
    await glue.default(loader.loadConfigured());
    const status = loader.getStatus();
    note({ step: 'loaded', variant: status.variant });

    // The page's subscribers on Details, coalesced (F7.2): one get_state per model and NewState.
    const WATCHED = ['meta_details', 'ctx', 'streaming_server'];
    let watching = false;
    const last = {};
    const getState = (model, reason) => {
        const start = performance.now();
        const state = last[model] = glue.get_state(model);
        const ms = performance.now() - start;
        const bytes = JSON.stringify(state).length;
        note({ getState: model, reason, ms: Math.round(ms * 10) / 10, bytes });
        return state;
    };
    const events = [];
    await glue.initialize_runtime((event) => {
        events.push(event);
        if (event.name === 'NewState') {
            note({ newState: event.args });
            if (watching) {
                // The page asks on a later task (postMessage), like the bridge.
                setTimeout(() => WATCHED.filter((m) => event.args.includes(m)).forEach((m) => getState(m, 'NewState')), 0);
            }
        } else if (event.name === 'CoreEvent') {
            note({ coreEvent: event.args && event.args.event });
        }
    });
    note({ step: 'runtime' });
    const cw = glue.get_state('continue_watching_preview');
    note({ step: 'library', continueWatching: cw && cw.items ? cw.items.length : null });

    const manifest = MANIFEST;
    glue.dispatch({ action: 'Ctx', args: { action: 'InstallAddon', args: { transportUrl: ADDON, manifest, flags: { official: false, protected: false } } } }, null, '#/');
    await sleep(200);
    const ctx = glue.get_state('ctx');
    note({ step: 'addons', addons: ctx.profile.addons.map((a) => a.manifest.id) });

    // Open Details (the action of useMetaDetails).
    watching = true;
    const load = performance.now();
    note({ step: 'Load MetaDetails' });
    glue.dispatch({
        action: 'Load',
        args: {
            model: 'MetaDetails',
            args: {
                metaPath: { resource: 'meta', type: 'movie', id: META_ID, extra: [] },
                streamPath: { resource: 'stream', type: 'movie', id: META_ID, extra: [] },
                guessStream: true,
            },
        },
    }, 'meta_details', `#/detail/movie/${META_ID}/${META_ID}`);
    WATCHED.forEach((m) => getState(m, 'mount'));
    // Done when the page has the meta and the streams (no get_state of its own: it would cost like the page's).
    const ready = (s) => s && s.metaItem && s.metaItem.content.type === 'Ready'
        && s.streams.some((x) => x.addon.manifest.id === MANIFEST.id && x.content.type === 'Ready');
    for (let i = 0; i < 400 && !ready(last.meta_details); i++) await sleep(25);
    await sleep(1000);
    const state = last.meta_details;
    watching = false;
    const openMs = Math.round(performance.now() - load);
    const streams = state.streams.find((s) => s.addon.manifest.id === MANIFEST.id);
    note({ step: 'open', ms: openMs, streams: streams && streams.content.type === 'Ready' ? streams.content.content.length : null });

    // The cost of one answer of each model, repeated.
    const repeated = {};
    for (const model of ['meta_details', 'ctx', 'streaming_server', 'continue_watching_preview']) {
        const times = [];
        let bytes = 0;
        for (let i = 0; i < REPEAT; i++) {
            const start = performance.now();
            const s = glue.get_state(model);
            times.push(performance.now() - start);
            bytes = JSON.stringify(s).length;
        }
        times.sort((a, b) => a - b);
        repeated[model] = { medianMs: Math.round(times[Math.floor(times.length / 2)] * 10) / 10, bytes };
    }
    const calls = timeline.filter((e) => e.getState);
    const summary = {
        variant: status.variant,
        wasm2js: WASM2JS ? path.basename(WASM2JS) : null,
        library: !flag('no-library'),
        streams: STREAMS,
        openMs,
        getStateDuringOpen: WATCHED.map((m) => ({
            model: m,
            n: calls.filter((c) => c.getState === m).length,
            ms: Math.round(calls.filter((c) => c.getState === m).reduce((a, c) => a + c.ms, 0)),
        })),
        newStateEvents: timeline.filter((e) => e.newState).length,
        setItem: timeline.filter((e) => e.setItem).map((e) => `${e.setItem}:${e.bytes}`),
        repeated,
    };
    print(JSON.stringify(summary, null, 1));
    const out = option('json', null);
    if (out) fs.writeFileSync(out, JSON.stringify({ summary, timeline }, null, 1));
    process.exit(0);
})().catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : JSON.stringify(error)}\n`);
    process.exit(1);
});
