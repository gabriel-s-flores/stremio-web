// Worker do parse-bench: importScripts de uma forma do wasm2js e, com call=1, a chamada de asmFunc
// com imports falsos (Proxy: toda função importada vira um no-op). Mede cada parte. ES5.
var params = {};
self.location.hash.replace(/^#/, '').split('&').forEach(function (pair) {
    var kv = pair.split('=');
    if (kv[0]) params[kv[0]] = decodeURIComponent(kv[1] || '');
});
var r = { call: params.call === '1', where: 'worker' };
var t0 = performance.now();
try {
    importScripts(params.file);
    r.importMs = Math.round(performance.now() - t0);
    var f = self.stremio_core_web_wasm2js;
    if (typeof f !== 'function' && typeof self.stremio_core_web_wasm2js_factory === 'function') {
        var t1 = performance.now();
        f = self.stremio_core_web_wasm2js_factory();
        r.factoryMs = Math.round(performance.now() - t1);
    }
    if (r.call && typeof f === 'function') {
        var noop = function () { return 0; };
        var mod = new Proxy({}, { get: function () { return noop; } });
        var t2 = performance.now();
        var exports = f(new Proxy({}, { get: function () { return mod; } }));
        r.asmFuncMs = Math.round(performance.now() - t2);
        r.exports = Object.keys(exports).length;
    }
} catch (err) {
    r.error = String(err && (err.stack || err.message) || err).slice(0, 500);
}
r.totalMs = Math.round(performance.now() - t0);
self.postMessage(r);
