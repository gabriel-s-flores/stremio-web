// Página do parse-bench (spike F0.11). Decompõe o tempo do wasm2js no V8 5.8: importScripts (parse),
// chamada da fábrica e execução de asmFunc, para cada forma de embrulho. O pacote leva só o arquivo
// da F0.6 (w2js-factory.js); as outras formas saem dele aqui, em memória, antes de o worker subir
// (Blob URL), para o IPK não ter 5 × 32 MB:
//   factory     o arquivo da F0.6 (a fábrica é chamada no importScripts);
//   noinvoke    o mesmo texto sem chamar a fábrica: só a pré-análise do arquivo;
//   eager       a fábrica e asmFunc entre parênteses (build-variant --wrap eager);
//   flat        sem fábrica: helpers e asmFunc no topo do script;
//   flat-eager  sem fábrica, asmFunc entre parênteses no topo.
// Parâmetros de lançamento: {"form":"eager","call":true} (call: chama asmFunc com imports falsos);
// {"where":"page"} carrega o arquivo da F0.6 por <script> na página, para ver se o cache de código
// do V8 para file:// vale para scripts da página. Resultado em window.__bench. ES5.
var FILE = 'w2js-factory.js';
var params = {};
try {
    params = JSON.parse((window.PalmSystem && window.PalmSystem.launchParams) || '{}') || {};
} catch (_e) {
    params = {};
}
var form = params.form || 'factory';
window.__bench = { done: false, params: params };
var start = performance.now();
function finish(result) {
    window.__bench.result = result;
    window.__bench.pageMs = Math.round(performance.now() - start);
    window.__bench.done = true;
    document.body.textContent = JSON.stringify(window.__bench);
}
function fakeImports() {
    var noop = function () { return 0; };
    var mod = new Proxy({}, { get: function () { return noop; } });
    return new Proxy({}, { get: function () { return mod; } });
}

function makeForm(text, name) {
    var OPEN = "})(typeof self !== 'undefined' ? self : this, function () {\n";
    var CLOSE = '\nreturn asmFunc;\n});';
    var ASM = '\nfunction asmFunc(imports) {\n';
    var bodyStart = text.indexOf(OPEN) + OPEN.length;
    var bodyEnd = text.lastIndexOf(CLOSE) + 1;
    var body = text.slice(bodyStart, bodyEnd);
    var asm = body.indexOf(ASM);
    var asmEnd = body.lastIndexOf('\n}\n');
    if (bodyStart < OPEN.length || bodyEnd < 1 || asm < 0 || asmEnd < asm) throw new Error('formato inesperado');
    var eager = body.slice(0, asm) + '\nvar asmFunc = (function asmFunc(imports) {\n' + body.slice(asm + ASM.length, asmEnd) +
        '\n});\n' + body.slice(asmEnd + 3);
    var G = 'self.stremio_core_web_wasm2js';
    return {
        noinvoke: '(function (root, factory) { root.stremio_core_web_wasm2js_factory = factory; })(self, function () {\n' +
            body + 'return asmFunc;\n});\n',
        eager: '(function (root, factory) { root.stremio_core_web_wasm2js = factory(); })(self, (function () {\n' +
            eager + 'return asmFunc;\n}));\n',
        flat: body + G + ' = asmFunc;\n',
        'flat-eager': eager + G + ' = asmFunc;\n'
    }[name];
}

function runWorker(url) {
    var worker = new Worker('bench-worker.js#file=' + encodeURIComponent(url) + '&call=' + (params.call ? 1 : 0));
    worker.onmessage = function (e) {
        e.data.form = form;
        e.data.prepareMs = window.__bench.prepareMs;
        finish(e.data);
    };
    worker.onerror = function (e) { finish({ form: form, error: e.message }); };
}

if (params.where === 'page') {
    var r = { form: 'factory', call: !!params.call, where: 'page' };
    var script = document.createElement('script');
    script.src = FILE;
    script.onload = function () {
        r.importMs = Math.round(performance.now() - start);
        if (r.call) {
            var t2 = performance.now();
            window.stremio_core_web_wasm2js(fakeImports());
            r.asmFuncMs = Math.round(performance.now() - t2);
        }
        r.totalMs = Math.round(performance.now() - start);
        finish(r);
    };
    script.onerror = function () { finish({ error: 'script falhou: ' + FILE }); };
    document.head.appendChild(script);
} else if (form === 'factory') {
    runWorker(FILE);
} else {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', FILE);
    xhr.onload = function () {
        try {
            var text = makeForm(xhr.responseText, form);
            var url = URL.createObjectURL(new Blob([text], { type: 'application/javascript' }));
            window.__bench.prepareMs = Math.round(performance.now() - start);
            text = null;
            start = performance.now();
            // Dá um tempo para o GC da página antes de medir.
            setTimeout(function () { start = performance.now(); runWorker(url); }, 3000);
        } catch (err) {
            finish({ form: form, error: String(err) });
        }
    };
    xhr.onerror = function () { finish({ form: form, error: 'XHR falhou' }); };
    xhr.send();
}
