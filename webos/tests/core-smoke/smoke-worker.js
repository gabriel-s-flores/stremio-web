// Entrada do worker do smoke: instrumenta fetch e WebAssembly.instantiate e carrega o worker
// vendorizado sem alterações (o mesmo que o app usa). ES5: roda no Chromium 53 sem Babel.
var stats = { fetches: [], instantiate: null };
var wasmMemory = null;
// Marcos enviados à página na hora (o Bridge ignora mensagens sem request/response): se o worker
// travar ou o app cair, a página guarda até onde ele chegou.
function mark(name) {
    self.postMessage({ smokeMark: { name: name, t: performance.now() } });
}
mark('worker-start');

var nativeFetch = self.fetch;
function xhrResponse(url) {
    return new Promise(function (resolve, reject) {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url);
        xhr.responseType = 'arraybuffer';
        xhr.onload = function () {
            resolve(new Response(xhr.response, { status: 200, headers: { 'Content-Type': 'application/wasm' } }));
        };
        xhr.onerror = function () { reject(new TypeError('XHR falhou: ' + url)); };
        xhr.send();
    });
}
self.fetch = function (input, init) {
    var url = String(input && input.url || input);
    var entry = { url: url, start: performance.now() };
    stats.fetches.push(entry);
    mark('fetch ' + url);
    return nativeFetch.call(self, input, init).then(function (res) {
        entry.via = 'fetch';
        entry.status = res.status;
        entry.ms = performance.now() - entry.start;
        mark('fetch-ok ' + res.status);
        return res;
    }, function (err) {
        entry.fetchError = String(err);
        // fetch() não aceita file:// no Chromium 53; o pacote do app roda de file://.
        if (!/^file:/.test(new URL(url, self.location.href).href)) throw err;
        mark('fetch-error ' + err);
        return xhrResponse(url).then(function (res) {
            entry.via = 'xhr';
            entry.ms = performance.now() - entry.start;
            mark('xhr-ok');
            return res;
        });
    });
};

var nativeInstantiate = WebAssembly.instantiate;
WebAssembly.instantiate = function (source) {
    var start = performance.now();
    var info = stats.instantiate = { bytes: source && source.byteLength, start: start };
    mark('instantiate-start ' + info.bytes);
    return nativeInstantiate.apply(WebAssembly, arguments).then(function (result) {
        info.ms = performance.now() - start;
        mark('instantiate-ok');
        wasmMemory = (result.instance || result).exports.memory;
        return result;
    });
};

self.smokeStats = function () {
    stats.instantiateStreaming = typeof WebAssembly.instantiateStreaming === 'function';
    stats.wasmMemoryBytes = wasmMemory ? wasmMemory.buffer.byteLength : null;
    stats.workerNow = performance.now();
    return stats;
};

require('../../vendor/stremio-core-web/worker.js');
