// O core vendorizado (glue + webos/core/loader.js) sobe no Node nas duas variantes, WASM e wasm2js,
// com a preferência lida do localStorage como no app, e lê o ctx de convidado. Pega regressões nas
// correções da glue (SOURCE.md) e no artefato wasm2js sem o emulador; o smoke no emulador
// (webos/tests/core-smoke) continua sendo a prova no Chromium 53.
const fs = require('fs');
const path = require('path');

const VENDOR = path.join(__dirname, '..', '..', 'vendor', 'stremio-core-web');
const BASE = 'file:///app/';

function readFile(url) {
    return fs.readFileSync(path.join(VENDOR, url.slice(BASE.length)));
}

class XMLHttpRequest {
    open(method, url) {
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

// O runtime do core arma setInterval permanentes; o teste os desliga no fim.
const intervals = [];
const setIntervalNative = global.setInterval;

async function startCore(hideWebAssembly, configured) {
    const saved = { WebAssembly: global.WebAssembly };
    const storage = configured ? { 'webos.coreVariant': configured } : {};
    global.self = global;
    // O core exige rodar num worker (env.rs: "worker global scope is not available").
    global.WorkerGlobalScope = Object;
    global.location = { href: BASE + 'worker.js' };
    global.document = { baseURI: BASE + 'worker.js' };
    global.XMLHttpRequest = XMLHttpRequest;
    // Como no worker: o script clássico do wasm2js define o global stremio_core_web_wasm2js.
    global.importScripts = (url) => new Function('module', readFile(url).toString('utf8'))(undefined);
    global.setInterval = (...args) => {
        const id = setIntervalNative(...args);
        intervals.push(id);
        return id;
    };
    global.fetch = (url) => Promise.reject(new TypeError('sem rede no teste: ' + url));
    global.app_version = 'core-test';
    global.shell_version = null;
    global.get_location_hash = () => Promise.resolve('');
    global.local_storage_get_item = async (key) => (key in storage ? storage[key] : null);
    global.local_storage_set_item = async (key, value) => { storage[key] = value; };
    global.local_storage_remove_item = async (key) => { delete storage[key]; };
    if (hideWebAssembly) delete global.WebAssembly;
    try {
        let glue;
        let loader;
        jest.isolateModules(() => {
            loader = require('../../core/loader');
            glue = require('../../vendor/stremio-core-web/stremio_core_web.js');
        });
        await glue.default(loader.loadConfigured());
        await glue.initialize_runtime(jest.fn());
        return { ctx: glue.get_state('ctx'), status: loader.getStatus() };
    } finally {
        global.WebAssembly = saved.WebAssembly;
    }
}

describe('vendored core', () => {
    beforeEach(() => {
        // O core registra no console as chamadas de rede recusadas (servidor de streaming etc.).
        jest.spyOn(console, 'log').mockImplementation(jest.fn());
        jest.spyOn(console, 'error').mockImplementation(jest.fn());
        jest.spyOn(console, 'warn').mockImplementation(jest.fn());
    });

    afterEach(() => {
        jest.restoreAllMocks();
        intervals.splice(0).forEach(clearInterval);
    });

    test.each([
        ['wasm2js', 'default', false, null, 'preferred'],
        ['wasm', 'configured', false, 'wasm', 'webassembly'],
        ['wasm2js', 'configured as wasm without WebAssembly', true, 'wasm', 'no-webassembly']
    ])('starts as %s (%s) and reads the guest ctx', async (variant, _name, hide, configured, reason) => {
        const { ctx, status } = await startCore(hide, configured);
        expect(status).toMatchObject({ variant, reason, error: null, prefer: configured || 'wasm2js' });
        expect(Object.keys(ctx)).toEqual(expect.arrayContaining(['profile', 'notifications', 'searchHistory']));
        expect(ctx.profile.auth).toBeNull();
        expect(ctx.profile.addons.map((addon) => addon.manifest.id)).toContain('com.linvo.cinemeta');
        // O core cresceu a memória além da inicial: a glue acompanhou a troca de buffer.
        expect(status.memoryBytes).toBeGreaterThan(1966080);
    }, 60000);
});
