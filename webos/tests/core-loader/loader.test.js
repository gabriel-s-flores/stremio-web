// Escolha do carregador do core (webos/core/loader.js): WASM ou wasm2js, com WebAssembly, XHR e
// importScripts simulados. A integração com o core real fica em core.test.js.

const WASM_BYTES = new Uint8Array([0, 97, 115, 109]).buffer;

function fakeXhr(responses) {
    return class XMLHttpRequest {
        open(method, url) {
            this.url = url;
        }

        send() {
            setTimeout(() => {
                if (!(this.url in responses)) {
                    this.onerror();
                    return;
                }
                this.status = 0;
                this.response = responses[this.url];
                this.onload();
            }, 0);
        }
    };
}

describe('core loader', () => {
    const saved = {};
    const imports = { './stremio_core_web_bg.js': {} };
    let scope;
    let wasm2jsExports;
    let factory;

    function load() {
        let loader;
        jest.isolateModules(() => {
            loader = require('../../core/loader');
        });
        return loader;
    }

    beforeEach(() => {
        for (const key of ['self', 'WebAssembly', 'XMLHttpRequest', 'importScripts']) saved[key] = global[key];
        wasm2jsExports = { memory: { buffer: new ArrayBuffer(3 * 65536) }, start: jest.fn() };
        factory = jest.fn(() => wasm2jsExports);
        scope = { location: { href: 'file:///media/developer/apps/app/worker.js#x' } };
        global.self = scope;
        global.XMLHttpRequest = fakeXhr({ 'file:///media/developer/apps/app/stremio_core_web_bg.wasm': WASM_BYTES });
        global.importScripts = jest.fn(() => { scope.stremio_core_web_wasm2js = factory; });
    });

    afterEach(() => {
        for (const key of Object.keys(saved)) global[key] = saved[key];
    });

    test('uses wasm2js when WebAssembly is missing, without reading the .wasm', async () => {
        delete global.WebAssembly;
        global.XMLHttpRequest = jest.fn();
        const loader = load();
        const source = await loader.loadCore();
        expect(global.XMLHttpRequest).not.toHaveBeenCalled();
        expect(global.importScripts).not.toHaveBeenCalled();

        const result = await source.webosInstantiate(imports);
        expect(global.importScripts).toHaveBeenCalledWith('file:///media/developer/apps/app/stremio_core_web_bg.wasm2js.js');
        expect(factory).toHaveBeenCalledWith(imports);
        expect(result.instance.exports).toBe(wasm2jsExports);
        expect(scope.stremio_core_web_wasm2js).toBeUndefined();

        const status = scope.getCoreLoaderStatus();
        expect(status).toMatchObject({ variant: 'wasm2js', reason: 'no-webassembly', error: null, hasWebAssembly: false });
        expect(status.memoryBytes).toBe(3 * 65536);
    });

    test('uses WebAssembly when compile and instantiate succeed', async () => {
        const module = {};
        const instance = { exports: { memory: { buffer: new ArrayBuffer(65536) } } };
        global.WebAssembly = {
            compile: jest.fn(() => Promise.resolve(module)),
            instantiate: jest.fn(() => Promise.resolve(instance))
        };
        const loader = load();
        const result = await (await loader.loadCore()).webosInstantiate(imports);
        expect(global.WebAssembly.compile).toHaveBeenCalledWith(WASM_BYTES);
        expect(global.WebAssembly.instantiate).toHaveBeenCalledWith(module, imports);
        expect(result).toEqual({ instance, module });
        expect(global.importScripts).not.toHaveBeenCalled();
        expect(loader.getStatus()).toMatchObject({
            variant: 'wasm', reason: 'webassembly', error: null, hasWebAssembly: true, wasmBytes: 4, memoryBytes: 65536
        });
    });

    test('falls back to wasm2js when compile fails', async () => {
        global.WebAssembly = {
            compile: () => Promise.reject(new Error('invalid local type')),
            instantiate: jest.fn()
        };
        const loader = load();
        const result = await (await loader.loadCore()).webosInstantiate(imports);
        expect(global.WebAssembly.instantiate).not.toHaveBeenCalled();
        expect(result.instance.exports).toBe(wasm2jsExports);
        expect(loader.getStatus()).toMatchObject({ variant: 'wasm2js', reason: 'compile-failed', error: 'invalid local type' });
    });

    test('falls back to wasm2js when instantiate fails', async () => {
        global.WebAssembly = {
            compile: () => Promise.resolve({}),
            instantiate: () => Promise.reject(new Error('out of memory'))
        };
        const loader = load();
        const result = await (await loader.loadCore()).webosInstantiate(imports);
        expect(factory).toHaveBeenCalledWith(imports);
        expect(result.instance.exports).toBe(wasm2jsExports);
        expect(loader.getStatus()).toMatchObject({ variant: 'wasm2js', reason: 'instantiate-failed', error: 'out of memory' });
    });

    test('rejects when the .wasm cannot be read instead of hiding a packaging error', async () => {
        global.WebAssembly = { compile: jest.fn(), instantiate: jest.fn() };
        const loader = load();
        await expect(loader.loadCore({ wasmUrl: 'missing.wasm' })).rejects.toThrow('missing.wasm');
        expect(global.WebAssembly.compile).not.toHaveBeenCalled();
        expect(global.importScripts).not.toHaveBeenCalled();
    });

    test('takes URLs and step listener from defaults and options', async () => {
        delete global.WebAssembly;
        const steps = [];
        const loader = load();
        loader.defaults.onStep = (name) => steps.push(name);
        loader.defaults.wasm2jsUrl = 'core/w2js.js';
        await (await loader.loadCore({ wasm2jsUrl: 'other/w2js.js' })).webosInstantiate(imports);
        expect(global.importScripts).toHaveBeenCalledWith('file:///media/developer/apps/app/other/w2js.js');
        expect(steps).toEqual(['start', 'fallback', 'wasm2js-load', 'wasm2js-instantiate', 'wasm2js-ok']);
    });
});
