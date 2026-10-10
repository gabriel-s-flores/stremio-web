// Entrada do worker do smoke: carrega o worker vendorizado sem alterações (o mesmo que o app usa),
// com o require do .wasm trocado pelo carregador de webos/core (alias no webpack.config.js), que
// escolhe WASM ou wasm2js. ES5: roda no Chromium 53 sem Babel.
// Cenários, pelo fragmento da URL do worker (a página escolhe pelo parâmetro de lançamento):
//   (nenhum)               WebAssembly do Chromium 53 → espera a variante wasm;
//   #webassembly=hidden    apaga o WebAssembly do worker antes de qualquer código do core → wasm2js;
//   #wasm=npm              o carregador lê o .wasm do npm (pós-MVP), que o V8 5.8 recusa no
//                          compile → wasm2js por falha de compilação;
//   #instantiate=fail      o instantiate nativo recebe imports vazios e o V8 5.8 recusa o link de
//                          verdade (module is not an object or function), depois de um compile
//                          bem-sucedido → wasm2js por falha de instanciação.
var params = {};
self.location.hash.replace(/^#/, '').split('&').forEach(function (pair) {
    var kv = pair.split('=');
    if (kv[0]) params[kv[0]] = kv[1] || '';
});
var hidden = params.webassembly === 'hidden';
if (hidden) {
    try {
        delete self.WebAssembly;
    } catch (_e) {
        // não configurável: cai na atribuição abaixo
    }
    if (typeof WebAssembly !== 'undefined') self.WebAssembly = undefined;
}

// Marcos enviados à página na hora (o Bridge ignora mensagens sem request/response): se o worker
// travar ou o app cair, a página guarda até onde ele chegou.
function mark(name) {
    self.postMessage({ smokeMark: { name: name, t: performance.now() } });
}
mark('worker-start' + (hidden ? ' (WebAssembly escondido: ' + typeof WebAssembly + ')' : ''));

if (params.instantiate === 'fail') {
    var nativeInstantiate = WebAssembly.instantiate;
    WebAssembly.instantiate = function (module) {
        return nativeInstantiate.call(WebAssembly, module, {});
    };
}

var loader = require('../../core/loader.js');
// Os cenários do smoke testam o caminho com WASM preferido e as quedas para o wasm2js; o app
// prefere o wasm2js (loader.defaults).
loader.defaults.prefer = 'wasm';
loader.defaults.onStep = function (name, detail) {
    mark('loader ' + name + (detail ? ' ' + detail : ''));
};
if (params.wasm === 'npm') loader.defaults.wasmUrl = 'npm_stremio_core_web_bg.wasm';

self.smokeStats = function () {
    return {
        params: params,
        hasWebAssembly: typeof WebAssembly === 'object' && WebAssembly !== null,
        loader: loader.getStatus(),
        workerNow: performance.now()
    };
};

require('../../vendor/stremio-core-web/worker.js');
