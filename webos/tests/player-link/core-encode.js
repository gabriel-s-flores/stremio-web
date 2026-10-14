#!/usr/bin/env node
// A core in Node opening Details (F8.7): prints, as JSON, the meta_details the page gets and, for each stream of
// the list, the core's own encoding of it (encode_stream, the Stream::encode of the player link).
// player-link.test.js compares webos/lib/player-link with them, and with the npm core, which still builds
// `deepLinks.player` for every stream of the list (the oracle of the link).
//
//   node webos/tests/player-link/core-encode.js [--core vendor|npm] [--scenario ready|loading|err|series]
//
// Scenarios: a movie whose meta (Cinemeta) is ready, still loading (the request never answers), failed (404),
// and an episode of a series (the video id is not the meta id). The stream addon answers varied streams.
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const option = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const CORE = option('core', 'vendor');
const SCENARIO = option('scenario', 'ready');
const VENDOR = CORE === 'npm'
    ? path.join(__dirname, '..', '..', '..', 'node_modules', '@stremio', 'stremio-core-web')
    : path.join(__dirname, '..', '..', 'vendor', 'stremio-core-web');
const BASE = 'file:///app/';
const ADDON = 'http://addon.example/manifest.json';
const MANIFEST = { id: 'test.streams', version: '1.0.0', name: 'Streams', resources: ['stream'], types: ['movie', 'series'], idPrefixes: ['tt'], catalogs: [] };
const STREAMS = [
    { url: 'http://domain.root/some/path' },
    { name: '[AD+] Torrentio\n4k DV | HDR', title: 'Movie.2026.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR.H.265-FLUX.mkv\n👤 42 💾 18.3 GB ⚙️ TorrentGalaxy\nMulti Audio / 🇬🇧 / 🇮🇹', url: 'https://debrid.example/resolve/alldebrid/KEY/0123456789abcdef/Movie%202026.mkv', behaviorHints: { bingeGroup: 'torrentio|4k|DV', filename: 'Movie.2026.mkv', videoSize: 19650000000, notWebReady: true, proxyHeaders: { request: { 'User-Agent': 'x "y"' } } } },
    { ytId: 'aqz-KE-bpKQ', name: 'Trailer' },
    { externalUrl: 'https://www.netflix.com/watch/1', name: 'Netflix', description: 'Watch on Netflix' },
    { url: 'https://cdn.example/a.mp4', subtitles: [{ id: 'pt', url: 'https://subs.example/pt.srt', lang: 'por' }], description: 'Com legenda \\ e "aspas" e é' },
    { url: 'https://cdn.example/b.m3u8', name: 'x'.repeat(40000) },
];
const SERIES = SCENARIO === 'series';
const TYPE = SERIES ? 'series' : 'movie';
const META_ID = SERIES ? 'tt2' : 'tt1';
const VIDEO_ID = SERIES ? 'tt2:1:2' : 'tt1';
const META = SERIES
    ? { id: 'tt2', type: 'series', name: 'Series', videos: [1, 2, 3].map((e) => ({ id: `tt2:1:${e}`, name: `Episode ${e}`, season: 1, episode: e, released: '2025-01-01T00:00:00.000Z' })) }
    : { id: 'tt1', type: 'movie', name: 'Movie', trailerStreams: [{ ytId: 'aqz-KE-bpKQ', title: 'Trailer' }] };

class XMLHttpRequest {
    open(_method, url) {
        this.url = url;
    }

    send() {
        setTimeout(() => {
            const bytes = fs.readFileSync(path.join(VENDOR, this.url.slice(BASE.length)));
            this.status = 0;
            this.response = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            this.onload();
        }, 0);
    }
}
const storage = { schema_version: '25', 'webos.coreVariant': 'wasm' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
global.self = global;
global.WorkerGlobalScope = Object;
global.location = { href: `${BASE}worker.js` };
global.document = { baseURI: `${BASE}worker.js` };
global.XMLHttpRequest = XMLHttpRequest;
global.importScripts = (url) => new Function('module', fs.readFileSync(path.join(VENDOR, url.slice(BASE.length))).toString('utf8'))(undefined);
global.fetch = async (request) => {
    const url = typeof request === 'string' ? request : request.url;
    if (url === ADDON) return json(MANIFEST);
    if (url.startsWith('http://addon.example/stream/')) return json({ streams: STREAMS });
    if (url.includes(`/meta/${TYPE}/${META_ID}.json`)) {
        if (SCENARIO === 'loading') return new Promise(() => {});
        if (SCENARIO === 'err') return json({ err: 'not found' }, 404);
        return json({ meta: META });
    }
    return json({ err: 'not found' }, 404);
};
global.app_version = 'core-encode';
global.shell_version = null;
global.get_location_hash = async () => '#/';
global.local_storage_get_item = async (key) => (key in storage ? storage[key] : null);
global.local_storage_set_item = async (key, value) => {
    storage[key] = value;
};
global.local_storage_remove_item = async (key) => {
    delete storage[key];
};
console.log = () => {};
console.info = () => {};
console.warn = () => {};
console.error = () => {};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
    const glue = require(path.join(VENDOR, 'stremio_core_web.js'));
    if (CORE === 'npm') {
        await glue.default(fs.readFileSync(path.join(VENDOR, 'stremio_core_web_bg.wasm')));
    } else {
        await glue.default(require('../../core/loader').loadConfigured());
    }
    await glue.initialize_runtime(() => {});
    glue.dispatch({ action: 'Ctx', args: { action: 'InstallAddon', args: { transportUrl: ADDON, manifest: MANIFEST, flags: { official: false, protected: false } } } }, null, '#/');
    await sleep(200);
    glue.dispatch({
        action: 'Load',
        args: { model: 'MetaDetails', args: { metaPath: { resource: 'meta', type: TYPE, id: META_ID, extra: [] }, streamPath: { resource: 'stream', type: TYPE, id: VIDEO_ID, extra: [] }, guessStream: true } },
    }, 'meta_details', `#/detail/${TYPE}/${META_ID}/${VIDEO_ID}`);
    await sleep(500);
    const metaDetails = glue.get_state('meta_details');
    const group = metaDetails.streams.find((g) => g.addon.manifest.id === MANIFEST.id);
    const encoded = group.content.content.map((stream) => {
        const core = Object.assign({}, stream);
        delete core.progress;
        delete core.deepLinks;
        delete core.lastUsed;
        return glue.encode_stream(core);
    });
    // Exit once the pipe took it all (an exit right after the write cuts a long answer).
    process.stdout.write(JSON.stringify({ core: CORE, scenario: SCENARIO, metaDetails, encoded }), () => process.exit(0));
})().catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : JSON.stringify(error)}\n`);
    process.exit(1);
});
