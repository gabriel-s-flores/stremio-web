// Carregador do core no worker: escolhe em runtime o core WebAssembly (MVP) ou o wasm2js.
//
// O worker.js vendorizado chama initialize_api(require('./stremio_core_web_bg.wasm')). No build
// webOS esse require aponta para webos/core/wasm-module.js (alias), que devolve loadCore(): uma
// promessa de um objeto com webosInstantiate(imports). A glue vendorizada (correção 4 do
// SOURCE.md) entrega os imports a ele em vez de chamar WebAssembly.instantiate.
//
// Escolha:
//   - sem o objeto WebAssembly                → wasm2js ("no-webassembly");
//   - WebAssembly.compile do .wasm falha      → wasm2js ("compile-failed");
//   - WebAssembly.instantiate falha           → wasm2js ("instantiate-failed");
//   - senão                                   → WASM ("webassembly").
// Falha ao ler um arquivo do pacote não cai no wasm2js: é erro de empacotamento e rejeita.
//
// Os bytes do .wasm vêm por XHR: no Chromium 53, fetch() de file:// é recusado no worker, e o
// pacote do app roda de file://. O wasm2js é um script clássico (define self.stremio_core_web_wasm2js)
// e entra por importScripts só quando escolhido.
//
// O estado (variante, motivo, erro e tempos) fica em getStatus() e, no worker, em
// self.getCoreLoaderStatus(), que a página lê pelo Bridge: bridge.call(['getCoreLoaderStatus']).
// ES5: roda no Chromium 53 sem Babel.

/* global importScripts */

var WASM2JS_GLOBAL = 'stremio_core_web_wasm2js';

var defaults = {
    // Relativos ao worker; o build copia os dois arquivos para a pasta dele.
    wasmUrl: 'stremio_core_web_bg.wasm',
    wasm2jsUrl: 'stremio_core_web_bg.wasm2js.js',
    // Chamado a cada etapa com (nome, detalhe): marcos para diagnóstico.
    onStep: null
};

var status = {
    variant: null,
    reason: null,
    error: null,
    hasWebAssembly: null,
    wasmUrl: null,
    wasm2jsUrl: null,
    wasmBytes: null,
    timings: {},
    memoryBytes: null
};
var memory = null;

function now() {
    return typeof performance === 'object' ? performance.now() : Date.now();
}

function round(ms) {
    return Math.round(ms * 10) / 10;
}

function errorText(err) {
    return String(err && (err.message || err) || err);
}

function resolveUrl(url) {
    var base = typeof self === 'object' && self.location ? self.location.href : undefined;
    return base ? new URL(url, base).href : url;
}

function readBytes(url) {
    return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url);
        xhr.responseType = 'arraybuffer';
        xhr.onload = function () {
            // file:// responde com status 0.
            if ((xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) && xhr.response) resolve(xhr.response);
            else reject(new Error('XHR ' + xhr.status + ': ' + url));
        };
        xhr.onerror = function () { reject(new Error('XHR falhou: ' + url)); };
        xhr.send();
    });
}

function step(options, name, detail) {
    if (typeof options.onStep === 'function') {
        try {
            options.onStep(name, detail);
        } catch (_e) {
            // Diagnóstico não pode derrubar o carregamento.
        }
    }
}

function choose(variant, reason, err) {
    status.variant = variant;
    status.reason = reason;
    status.error = err ? errorText(err) : null;
}

function instantiateWasm2js(options, imports) {
    var start = now();
    step(options, 'wasm2js-load', status.wasm2jsUrl);
    var root = typeof self === 'object' ? self : {};
    if (typeof root[WASM2JS_GLOBAL] !== 'function') importScripts(status.wasm2jsUrl);
    var factory = root[WASM2JS_GLOBAL];
    if (typeof factory !== 'function') throw new Error('o wasm2js não definiu ' + WASM2JS_GLOBAL + ': ' + status.wasm2jsUrl);
    status.timings.wasm2jsLoadMs = round(now() - start);
    start = now();
    step(options, 'wasm2js-instantiate');
    var exports = factory(imports);
    delete root[WASM2JS_GLOBAL];
    status.timings.wasm2jsInstantiateMs = round(now() - start);
    memory = exports.memory;
    step(options, 'wasm2js-ok');
    return { instance: { exports: exports }, module: undefined };
}

function wasm2jsSource(options) {
    return {
        webosInstantiate: function (imports) {
            return new Promise(function (resolve) {
                resolve(instantiateWasm2js(options, imports));
            });
        }
    };
}

function wasmSource(options, module) {
    return {
        webosInstantiate: function (imports) {
            var start = now();
            step(options, 'wasm-instantiate');
            return WebAssembly.instantiate(module, imports).then(function (instance) {
                status.timings.instantiateMs = round(now() - start);
                memory = instance.exports.memory;
                step(options, 'wasm-ok');
                return { instance: instance, module: module };
            }, function (err) {
                // Nada do core rodou ainda (a glue só chama __wbindgen_start depois): dá para trocar.
                choose('wasm2js', 'instantiate-failed', err);
                step(options, 'fallback', status.reason + ': ' + status.error);
                return instantiateWasm2js(options, imports);
            });
        }
    };
}

// Devolve a promessa do objeto que a glue recebe em initialize_api. options sobrepõe defaults.
function loadCore(options) {
    var opts = {};
    var key;
    for (key in defaults) opts[key] = defaults[key];
    for (key in options || {}) opts[key] = options[key];
    var start = now();
    status.hasWebAssembly = typeof WebAssembly === 'object' && WebAssembly !== null &&
        typeof WebAssembly.compile === 'function' && typeof WebAssembly.instantiate === 'function';
    status.wasmUrl = resolveUrl(opts.wasmUrl);
    status.wasm2jsUrl = resolveUrl(opts.wasm2jsUrl);
    step(opts, 'start', status.hasWebAssembly ? 'WebAssembly presente' : 'sem WebAssembly');

    if (!status.hasWebAssembly) {
        choose('wasm2js', 'no-webassembly', null);
        step(opts, 'fallback', status.reason);
        return Promise.resolve(wasm2jsSource(opts));
    }

    return readBytes(status.wasmUrl).then(function (bytes) {
        status.timings.readMs = round(now() - start);
        status.wasmBytes = bytes.byteLength;
        var compileStart = now();
        step(opts, 'wasm-compile', bytes.byteLength + ' bytes');
        return WebAssembly.compile(bytes).then(function (module) {
            status.timings.compileMs = round(now() - compileStart);
            choose('wasm', 'webassembly', null);
            return wasmSource(opts, module);
        }, function (err) {
            status.timings.compileMs = round(now() - compileStart);
            choose('wasm2js', 'compile-failed', err);
            step(opts, 'fallback', status.reason + ': ' + status.error);
            return wasm2jsSource(opts);
        });
    });
}

function getStatus() {
    status.memoryBytes = memory && memory.buffer ? memory.buffer.byteLength : null;
    return JSON.parse(JSON.stringify(status));
}

if (typeof self === 'object' && self) self.getCoreLoaderStatus = getStatus;

module.exports = {
    defaults: defaults,
    loadCore: loadCore,
    getStatus: getStatus
};
