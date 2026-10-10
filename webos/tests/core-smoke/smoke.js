// Smoke do core vendorizado no webOS TV 4.0: sobe o worker como o app (createTransport), mede o
// init, lê o ctx e carrega catálogos do Cinemeta como convidado. O resultado fica em
// window.__smoke (lido pelo run via CDP). ES5: roda no Chromium 53 sem Babel.
// Com o parâmetro de lançamento {"mode": "baseline"}, a mesma página sobe um worker vazio, sem o
// core: é a linha de base da memória.
var Bridge = require('../../vendor/stremio-core-web/bridge.js');

var CINEMETA = 'https://v3-cinemeta.strem.io/manifest.json';
var TIMEOUT_MS = 45000;
var launchParams = {};
try {
    launchParams = JSON.parse((window.PalmSystem && window.PalmSystem.launchParams) || '{}') || {};
} catch (_e) {
    launchParams = {};
}
var BASELINE = launchParams.mode === 'baseline';
var R = window.__smoke = {
    mode: BASELINE ? 'baseline' : 'core',
    done: false,
    ok: false,
    userAgent: navigator.userAgent,
    hasWebAssembly: typeof WebAssembly === 'object',
    timings: {},
    marks: [],
    events: { NewState: 0, CoreEvent: [] },
    errors: []
};
var t0 = performance.now();

function since(start) { return Math.round((performance.now() - start) * 10) / 10; }
function show() {
    if (BASELINE) {
        document.getElementById('summary').innerHTML = '<b>Linha de base ' + (R.done ? (R.ok ? 'OK' : 'FALHOU') : '…') +
            '</b> · worker sem o core';
        document.getElementById('out').textContent = JSON.stringify(R, null, 1);
        return;
    }
    var lines = [
        '<b>Core ' + (R.done ? (R.ok ? 'OK' : 'FALHOU') : '…') + '</b> · init ' + (R.timings.initMs || '?') +
            ' ms · catálogo ' + (R.discover ? R.discover.items + ' itens em ' + R.discover.ms + ' ms' : '…'),
        'Board: ' + (R.board ? R.board.ready + '/' + R.board.catalogs + ' catálogos prontos, ' + R.board.items + ' itens' : '…')
    ];
    document.getElementById('summary').innerHTML = lines.join('<br>');
    document.getElementById('out').textContent = JSON.stringify(R, null, 1);
}
function fail(stage, err) {
    R.errors.push({ stage: stage, error: String(err && (err.stack || err.message) || err) });
}
window.onerror = function (msg, src, line) { fail('window.onerror', msg + ' @' + src + ':' + line); };

// O worker chama de volta location.hash, localStorage e onCoreEvent pelo Bridge, como no app.
window.onCoreEvent = function (event) {
    if (event.name === 'NewState') R.events.NewState += 1;
    else if (event.name === 'CoreEvent' && R.events.CoreEvent.length < 20) R.events.CoreEvent.push(event.args.event);
};

var worker = new Worker(BASELINE ? 'baseline-worker.js' : 'worker.js');
worker.onerror = function (e) { fail('worker.onerror', e.message + ' @' + e.filename + ':' + e.lineno); };
worker.addEventListener('message', function (e) {
    var m = e.data && e.data.smokeMark;
    if (m) R.marks.push(m.name + ' @' + Math.round(m.t) + ' ms (worker) / ' + since(t0) + ' ms (página)');
});
var bridge = window.__smokeBridge = new Bridge(window, worker);
function call(path, args) { return bridge.call(path, args || []); }
function dispatch(action, field) { return call(['dispatch'], [action, field, location.hash]); }

// Repete getState(field) até check(state) devolver algo ou estourar o tempo.
function poll(field, check, start) {
    return call(['getState'], [field]).then(function (state) {
        var res = check(state);
        if (res) return res;
        if (performance.now() - start > TIMEOUT_MS) throw new Error('timeout esperando ' + field);
        return new Promise(function (resolve) { setTimeout(resolve, 200); }).then(function () {
            return poll(field, check, start);
        });
    });
}

function names(items) {
    return items.slice(0, 5).map(function (m) { return m.name; });
}

function checkDiscover(state) {
    var catalog = state && state.catalog;
    var content = catalog && catalog.content;
    if (!content || content.type === 'Loading') return null;
    if (content.type !== 'Ready') return { type: content.type, error: JSON.stringify(content.content).slice(0, 300) };
    return { type: 'Ready', items: content.content.length, first: names(content.content) };
}

function checkBoard(state) {
    var catalogs = (state && state.catalogs) || [];
    var settled = catalogs.filter(function (c) { return c.content && c.content.type !== 'Loading'; });
    if (!catalogs.length || settled.length < Math.min(catalogs.length, 6)) return null;
    var ready = settled.filter(function (c) { return c.content.type === 'Ready'; });
    return {
        catalogs: catalogs.length,
        ready: ready.length,
        items: ready.reduce(function (n, c) { return n + c.content.content.length; }, 0),
        first: ready.length ? names(ready[0].content.content) : []
    };
}

function finish() {
    if (performance.memory) {
        R.pageMemory = {
            usedJSHeapSize: performance.memory.usedJSHeapSize,
            totalJSHeapSize: performance.memory.totalJSHeapSize,
            jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
        };
    }
    R.timings.totalMs = since(t0);
    R.done = true;
    show();
}

function runBaseline() {
    worker.addEventListener('message', function (e) {
        if (e.data && e.data.baselinePong) {
            R.ok = R.errors.length === 0;
            finish();
        }
    });
    worker.postMessage({ baselinePing: true });
}

function runCore() {
    var tInit = performance.now();
    call(['init'], [{ appVersion: 'core-smoke', shellVersion: null }]).then(function () {
        R.timings.initMs = since(tInit);
        R.marks.push('init-ok / ' + since(t0) + ' ms (página)');
        return call(['smokeStats']);
    }).then(function (stats) {
        R.worker = stats;
        var t = performance.now();
        return call(['getState'], ['ctx']).then(function (ctx) {
            R.timings.getStateCtxMs = since(t);
            R.ctx = {
                keys: Object.keys(ctx),
                guest: !ctx.profile || ctx.profile.auth === null,
                addons: ctx.profile ? ctx.profile.addons.map(function (a) { return a.manifest.id; }) : []
            };
        });
    }).then(function () {
        var t = performance.now();
        return dispatch({
            action: 'Load',
            args: {
                model: 'CatalogWithFiltersSelection',
                args: { request: { base: CINEMETA, path: { resource: 'catalog', type: 'movie', id: 'top', extra: [] } } }
            }
        }, 'discover').then(function () {
            return poll('discover', checkDiscover, t);
        }).then(function (res) {
            res.ms = since(t);
            res.request = 'cinemeta catalog/movie/top';
            R.discover = res;
            show();
        });
    }).then(function () {
        var t = performance.now();
        return dispatch({ action: 'Load', args: { model: 'CatalogsWithExtra', args: { extra: [] } } }, 'board').then(function () {
            return dispatch({ action: 'CatalogsWithExtra', args: { action: 'LoadRange', args: { start: 0, end: 6 } } }, 'board');
        }).then(function () {
            return poll('board', checkBoard, t);
        }).then(function (res) {
            res.ms = since(t);
            R.board = res;
        });
    }).then(function () {
        return call(['smokeStats']);
    }).then(function (stats) {
        R.worker = stats;
        R.ok = R.discover.type === 'Ready' && R.discover.items > 0 &&
            R.board.catalogs > 0 && R.board.ready === R.board.catalogs && R.errors.length === 0;
    }, function (err) {
        fail('fluxo', err);
    }).then(finish);
}

show();
if (BASELINE) runBaseline();
else runCore();
