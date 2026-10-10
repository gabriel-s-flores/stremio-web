// Carregador do core no worker: escolhe em runtime o core WebAssembly (MVP) ou o wasm2js.
//
// O worker.js vendorizado chama initialize_api(require('./stremio_core_web_bg.wasm')). No build
// webOS esse require aponta para webos/core/wasm-module.js (alias), que devolve loadCore(): uma
// promessa de um objeto com webosInstantiate(imports). A glue vendorizada (correção 4 do
// SOURCE.md) entrega os imports a ele em vez de chamar WebAssembly.instantiate.
//
// Variante preferida (opção prefer): wasm2js por padrão no webOS 4 (gate G0: no perfil C8 o wasm2js
// inicializa em ~9 s e o WASM em 20–25 s, com pico de memória maior). A chave PREFER_KEY do
// localStorage da página ("wasm" ou "wasm2js") troca a preferência: loadConfigured() a lê pelo Bridge.
//
// Escolha com wasm2js preferido:
//   - wasm2js carrega e instancia            → wasm2js ("preferred");
//   - wasm2js falha e há WebAssembly          → WASM ("wasm2js-failed").
// Escolha com WASM preferido:
//   - sem o objeto WebAssembly                → wasm2js ("no-webassembly");
//   - WebAssembly.compile do .wasm falha      → wasm2js ("compile-failed");
//   - WebAssembly.instantiate falha           → wasm2js ("instantiate-failed");
//   - senão                                   → WASM ("webassembly").
// Falha ao ler um arquivo do pacote não cai na outra variante: é erro de empacotamento e rejeita.
//
// Os bytes do .wasm vêm por XHR: no Chromium 53, fetch() de file:// é recusado no worker, e o
// pacote do app roda de file://. O wasm2js é um script clássico (define self.stremio_core_web_wasm2js)
// e entra por importScripts só quando escolhido.
//
// O estado (variante, motivo, erro, etapa e tempos) fica em getStatus() e, no worker, em
// self.getCoreLoaderStatus(), que a página lê pelo Bridge: bridge.call(['getCoreLoaderStatus']).
// ok: null enquanto carrega, true com o core instanciado, false se uma etapa falhou (stage diz
// qual e error, o porquê).
//
// Memória: o WebAssembly.Module compilado (código nativo do wasm inteiro, ~100 MB no V8 5.8) só
// pode ficar vivo enquanto a glue o usa. A promessa de loadCore() fica no cache de módulos do
// webpack enquanto o worker viver, então o objeto entregue à glue é de uso único e solta o Module
// na primeira chamada; se o instantiate falha, nada mais o segura antes de subir o wasm2js.
// ES5: roda no Chromium 53 sem Babel.

/* global importScripts */

var WASM2JS_GLOBAL = 'stremio_core_web_wasm2js';
// Chave do localStorage da página com a variante pedida: "wasm" ou "wasm2js".
var PREFER_KEY = 'webos.coreVariant';
var VARIANTS = { wasm: true, wasm2js: true };

var defaults = {
    // Relativos ao worker; o build copia os dois arquivos para a pasta dele.
    wasmUrl: 'stremio_core_web_bg.wasm',
    wasm2jsUrl: 'stremio_core_web_bg.wasm2js.js',
    // Variante tentada primeiro: "wasm2js" ou "wasm".
    prefer: 'wasm2js',
    // Chamado a cada etapa com (nome, detalhe): marcos para diagnóstico.
    onStep: null
};

var status = {
    ok: null,
    stage: null,
    variant: null,
    reason: null,
    // Variante preferida, de onde veio ("default" ou "config") e o valor lido da configuração.
    prefer: null,
    preferSource: null,
    preferConfig: null,
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

// Marca a etapa em andamento: se ela falhar, o status diz onde.
function enter(options, stage, detail) {
    status.stage = stage;
    step(options, stage, detail);
}

function fail(err) {
    status.ok = false;
    status.error = errorText(err);
    throw err;
}

function choose(variant, reason, err) {
    status.variant = variant;
    status.reason = reason;
    status.error = err ? errorText(err) : null;
}

function instantiateWasm2js(options, imports) {
    var start = now();
    enter(options, 'wasm2js-load', status.wasm2jsUrl);
    var root = typeof self === 'object' ? self : {};
    if (typeof root[WASM2JS_GLOBAL] !== 'function') importScripts(status.wasm2jsUrl);
    var factory = root[WASM2JS_GLOBAL];
    if (typeof factory !== 'function') throw new Error('o wasm2js não definiu ' + WASM2JS_GLOBAL + ': ' + status.wasm2jsUrl);
    status.timings.wasm2jsLoadMs = round(now() - start);
    start = now();
    enter(options, 'wasm2js-instantiate');
    var exports = factory(imports);
    delete root[WASM2JS_GLOBAL];
    status.timings.wasm2jsInstantiateMs = round(now() - start);
    memory = exports.memory;
    ready(options, 'wasm2js-ok');
    return { instance: { exports: exports }, module: undefined };
}

function ready(options, name) {
    status.ok = true;
    status.stage = 'ready';
    step(options, name);
}

// Lê e compila o .wasm. Falha na leitura rejeita; falha no compile vai para onCompileError.
function compileWasm(options, onCompileError) {
    var start = now();
    enter(options, 'wasm-read', status.wasmUrl);
    return readBytes(status.wasmUrl).then(function (bytes) {
        status.timings.readMs = round(now() - start);
        status.wasmBytes = bytes.byteLength;
        var compileStart = now();
        enter(options, 'wasm-compile', bytes.byteLength + ' bytes');
        return WebAssembly.compile(bytes).then(function (module) {
            status.timings.compileMs = round(now() - compileStart);
            return module;
        }, function (err) {
            status.timings.compileMs = round(now() - compileStart);
            return onCompileError(err);
        });
    });
}

function instantiateWasm(options, module, imports) {
    var start = now();
    enter(options, 'wasm-instantiate');
    return WebAssembly.instantiate(module, imports).then(function (instance) {
        status.timings.instantiateMs = round(now() - start);
        memory = instance.exports.memory;
        ready(options, 'wasm-ok');
        return { instance: instance, module: module };
    }, function (err) {
        // Solta o Module: senão o código nativo do wasm fica vivo junto com o wasm2js.
        module = null;
        status.timings.instantiateMs = round(now() - start);
        throw err;
    });
}

// fallbackToWasm: com o wasm2js preferido e WebAssembly presente, uma falha do wasm2js tenta o WASM.
function wasm2jsSource(options, fallbackToWasm) {
    return {
        webosInstantiate: function (imports) {
            return new Promise(function (resolve) {
                resolve(instantiateWasm2js(options, imports));
            }).then(null, function (err) {
                if (!fallbackToWasm) throw err;
                // Nada do core rodou ainda (a glue só chama __wbindgen_start depois): dá para trocar.
                if (typeof self === 'object' && self) delete self[WASM2JS_GLOBAL];
                choose('wasm', 'wasm2js-failed', err);
                step(options, 'fallback', status.reason + ': ' + status.error);
                return compileWasm(options, function (compileErr) {
                    throw compileErr;
                }).then(function (module) {
                    return instantiateWasm(options, module, imports);
                });
            }).then(null, fail);
        }
    };
}

function wasmSource(options, compiled) {
    return {
        webosInstantiate: function (imports) {
            // Uso único: o objeto deixa de segurar o Module (veja o cabeçalho).
            var module = compiled;
            compiled = null;
            if (!module) return Promise.reject(new Error('webosInstantiate já foi chamado'));
            return instantiateWasm(options, module, imports).then(null, function (err) {
                // Nada do core rodou ainda (a glue só chama __wbindgen_start depois): dá para trocar.
                module = null;
                choose('wasm2js', 'instantiate-failed', err);
                step(options, 'fallback', status.reason + ': ' + status.error);
                return instantiateWasm2js(options, imports);
            }).then(null, fail);
        }
    };
}

// Devolve a promessa do objeto que a glue recebe em initialize_api. options sobrepõe defaults
// (preferSource e preferConfig vêm de loadConfigured e só vão para o status).
function loadCore(options) {
    var opts = {};
    var key;
    for (key in defaults) opts[key] = defaults[key];
    for (key in options || {}) opts[key] = options[key];
    if (!VARIANTS[opts.prefer]) return Promise.reject(new Error('prefer inválido: ' + opts.prefer));
    status.ok = null;
    status.stage = 'start';
    status.prefer = opts.prefer;
    status.preferSource = opts.preferSource || 'default';
    status.preferConfig = opts.preferConfig === undefined ? null : opts.preferConfig;
    status.hasWebAssembly = typeof WebAssembly === 'object' && WebAssembly !== null &&
        typeof WebAssembly.compile === 'function' && typeof WebAssembly.instantiate === 'function';
    status.wasmUrl = resolveUrl(opts.wasmUrl);
    status.wasm2jsUrl = resolveUrl(opts.wasm2jsUrl);
    step(opts, 'start', (status.hasWebAssembly ? 'WebAssembly presente' : 'sem WebAssembly') +
        ', prefere ' + status.prefer + ' (' + status.preferSource + ')');

    if (opts.prefer === 'wasm2js') {
        choose('wasm2js', 'preferred', null);
        return Promise.resolve(wasm2jsSource(opts, status.hasWebAssembly));
    }

    if (!status.hasWebAssembly) {
        choose('wasm2js', 'no-webassembly', null);
        step(opts, 'fallback', status.reason);
        return Promise.resolve(wasm2jsSource(opts, false));
    }

    return compileWasm(opts, function (err) {
        choose('wasm2js', 'compile-failed', err);
        step(opts, 'fallback', status.reason + ': ' + status.error);
        return null;
    }).then(function (module) {
        if (!module) return wasm2jsSource(opts, false);
        choose('wasm', 'webassembly', null);
        return wasmSource(opts, module);
    }).then(null, fail);
}

// Variante pedida na configuração: PREFER_KEY no localStorage da página, lida pelo Bridge com
// self.local_storage_get_item (o worker.js a define no init, antes de pedir o core). Sem a função,
// sem a chave, com um valor desconhecido ou se a leitura falhar, vale defaults.prefer.
function readPreference() {
    var get = typeof self === 'object' && self ? self.local_storage_get_item : null;
    if (typeof get !== 'function') return Promise.resolve(null);
    return new Promise(function (resolve) {
        resolve(get.call(self, PREFER_KEY));
    }).then(function (value) {
        return typeof value === 'string' ? value : null;
    }, function () {
        return null;
    });
}

// loadCore com a preferência da configuração (o que o wasm-module.js usa no app).
function loadConfigured(options) {
    return readPreference().then(function (value) {
        var opts = {};
        for (var key in options || {}) opts[key] = options[key];
        opts.preferConfig = value;
        if (VARIANTS[value]) {
            opts.prefer = value;
            opts.preferSource = 'config';
        }
        return loadCore(opts);
    });
}

function getStatus() {
    status.memoryBytes = memory && memory.buffer ? memory.buffer.byteLength : null;
    return JSON.parse(JSON.stringify(status));
}

if (typeof self === 'object' && self) self.getCoreLoaderStatus = getStatus;

module.exports = {
    defaults: defaults,
    PREFER_KEY: PREFER_KEY,
    loadCore: loadCore,
    loadConfigured: loadConfigured,
    getStatus: getStatus
};
