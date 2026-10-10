// Entrada do worker do spike de init (F0.11): o worker vendorizado sem alterações, com o require do
// .wasm trocado pelo carregador da F0.6 (webos/core/wasm-module.js, alias no webpack.config.js), que
// escolhe WASM ou wasm2js. Os arquivos do core vêm da variante do build (build/variants/NOME).
// Opções pelo fragmento da URL do worker (a página repassa os parâmetros de lançamento):
//   webassembly=hidden  apaga o WebAssembly antes de qualquer código do core (wasm2js);
//   early=1             começa a carregar o core já na subida do worker, sem esperar o init;
//   cache=idb           experimento: guarda o WebAssembly.Module compilado no IndexedDB e, nos
//                       lançamentos seguintes, entrega o módulo guardado ao carregador em vez de
//                       compilar (WebAssembly.compile embrulhado só neste worker).
// ES5: roda no Chromium 53 sem Babel.
var params = {};
self.location.hash.replace(/^#/, '').split('&').forEach(function (pair) {
    var kv = pair.split('=');
    if (kv[0]) params[kv[0]] = kv[1] || '';
});
if (params.webassembly === 'hidden') {
    try {
        delete self.WebAssembly;
    } catch (_e) {
        // não configurável: cai na atribuição abaixo
    }
    if (typeof WebAssembly !== 'undefined') self.WebAssembly = undefined;
}

function mark(name) {
    self.postMessage({ f011Mark: { name: name, t: performance.now() } });
}
mark('worker-start');

var cacheInfo = null;
if (params.cache === 'idb' && typeof WebAssembly === 'object') cacheInfo = installModuleCache();

var loader = require('../../core/loader.js');
loader.defaults.onStep = function (name, detail) {
    mark('loader ' + name + (detail ? ' ' + detail : ''));
};
if (params.early) {
    // O mesmo módulo que o worker.js vendorizado pede no init: o webpack o avalia uma vez só.
    mark('early-require');
    require('../../core/wasm-module.js');
}

self.f011Stats = function () {
    return {
        params: params,
        loader: loader.getStatus(),
        moduleCache: cacheInfo,
        workerNow: performance.now()
    };
};

// --- Experimento: WebAssembly.Module no IndexedDB (structured clone de módulos wasm).
function idb(mode, fn) {
    return new Promise(function (resolve, reject) {
        var open = indexedDB.open('f011-core', 1);
        open.onupgradeneeded = function () { open.result.createObjectStore('modules'); };
        open.onerror = function () { reject(open.error); };
        open.onsuccess = function () {
            var db = open.result;
            var tx;
            var req;
            try {
                tx = db.transaction('modules', mode);
                req = fn(tx.objectStore('modules'));
            } catch (err) {
                db.close();
                reject(err);
                return;
            }
            tx.oncomplete = function () { db.close(); resolve(req && req.result); };
            tx.onerror = tx.onabort = function () { db.close(); reject(tx.error || (req && req.error)); };
        };
    });
}

function installModuleCache() {
    var info = { key: 'core', hit: false, getMs: null, putMs: null, putError: null, getError: null };
    var nativeCompile = WebAssembly.compile;
    WebAssembly.compile = function (bytes) {
        var start = performance.now();
        return idb('readonly', function (store) { return store.get(info.key); }).then(function (cached) {
            info.getMs = Math.round(performance.now() - start);
            info.gotType = Object.prototype.toString.call(cached);
            if (cached instanceof WebAssembly.Module) {
                info.hit = true;
                mark('module-cache hit');
                return cached;
            }
            return null;
        }, function (err) {
            info.getError = String(err && (err.message || err.name) || err);
            return null;
        }).then(function (cached) {
            if (cached) return cached;
            return nativeCompile.call(WebAssembly, bytes).then(function (module) {
                var putStart = performance.now();
                mark('module-cache put');
                idb('readwrite', function (store) { return store.put(module, info.key); }).then(function () {
                    info.putMs = Math.round(performance.now() - putStart);
                    mark('module-cache put-ok');
                }, function (err) {
                    info.putError = String(err && (err.message || err.name) || err);
                    mark('module-cache put-error ' + info.putError);
                });
                return module;
            });
        });
    };
    return info;
}

require('../../vendor/stremio-core-web/worker.js');
