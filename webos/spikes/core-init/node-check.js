#!/usr/bin/env node
// Sobe uma variante do spike (build/variants/NOME) no Node com o webos/core/loader.js da F0.6, como
// o webos/tests/core-loader/core.test.js faz com o vendor, e lê o ctx de convidado:
//   node webos/spikes/core-init/node-check.js build/variants/NOME wasm|wasm2js
// Não substitui o emulador; só pega uma variante quebrada antes de gastar uma reserva.
const fs = require('fs');
const path = require('path');
const Module = require('module');

const [dir, mode] = process.argv.slice(2);
if (!dir || !['wasm', 'wasm2js'].includes(mode)) {
    console.error('uso: node-check.js <pasta-da-variante> wasm|wasm2js');
    process.exit(2);
}
const VARIANT = path.resolve(dir);
const BASE = 'file:///app/';
const readFile = (url) => fs.readFileSync(path.join(VARIANT, url.slice(BASE.length)));

global.XMLHttpRequest = class {
    open(_method, url) { this.url = url; }
    send() {
        setTimeout(() => {
            const bytes = readFile(this.url);
            this.status = 0;
            this.response = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            this.onload();
        }, 0);
    }
};
const storage = {};
const intervals = [];
const setIntervalNative = global.setInterval;
Object.assign(global, {
    self: global,
    WorkerGlobalScope: Object,
    location: { href: BASE + 'worker.js' },
    document: { baseURI: BASE + 'worker.js' },
    importScripts: (url) => new Function('module', readFile(url).toString('utf8'))(undefined),
    setInterval: (...args) => { const id = setIntervalNative(...args); intervals.push(id); return id; },
    fetch: (url) => Promise.reject(new TypeError('sem rede: ' + url)),
    app_version: 'f011-node-check',
    shell_version: null,
    get_location_hash: () => Promise.resolve(''),
    local_storage_get_item: async (key) => (key in storage ? storage[key] : null),
    local_storage_set_item: async (key, value) => { storage[key] = value; },
    local_storage_remove_item: async (key) => { delete storage[key]; }
});
if (mode === 'wasm2js') delete global.WebAssembly;
console.log = console.warn = () => {};

(async () => {
    const start = Date.now();
    const loader = require('../../core/loader');
    // A glue da variante resolve os próprios requires (@babel/runtime) a partir do repo.
    const gluePath = path.join(VARIANT, 'stremio_core_web.js');
    const glue = new Module(gluePath, module);
    glue.filename = gluePath;
    glue.paths = Module._nodeModulePaths(path.join(__dirname, '..', '..', 'vendor', 'stremio-core-web'));
    glue._compile(fs.readFileSync(gluePath, 'utf8'), gluePath);
    const api = glue.exports;
    await api.default(loader.loadCore());
    await api.initialize_runtime(() => {});
    const ctx = api.get_state('ctx');
    const status = loader.getStatus();
    const ok = status.variant === mode && ctx.profile.auth === null &&
        ctx.profile.addons.some((a) => a.manifest.id === 'com.linvo.cinemeta') && status.memoryBytes > 1966080;
    process.stdout.write(JSON.stringify({ ok, mode, variant: status.variant, reason: status.reason,
        timings: status.timings, memoryBytes: status.memoryBytes, ms: Date.now() - start }) + '\n');
    intervals.forEach(clearInterval);
    process.exit(ok ? 0 : 1);
})().catch((err) => {
    process.stdout.write(JSON.stringify({ ok: false, mode, error: String(err && err.stack || err) }) + '\n');
    process.exit(1);
});
