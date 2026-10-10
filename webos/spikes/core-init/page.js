// Página do spike de init do core (F0.11). Faz o mesmo fluxo do webos/tests/core-smoke (init, ctx,
// catálogo do Cinemeta e Board como convidado) e mede o que a UI vê enquanto o core sobe:
//   - firstPaintMs: a primeira pintura da página (splash), em ms desde o navigationStart;
//   - cachedBoardPaintMs: o Board da execução anterior (localStorage) pintado antes do core;
//   - liveBoardPaintMs: o Board com dados do core pintado;
//   - mainThread: atrasos do setInterval de 50 ms e quadros de requestAnimationFrame, por janela
//     (antes do init, durante o init, depois), para ver se a página trava enquanto o worker compila;
//   - stages: as etapas do carregador e do core, no relógio da página.
// Parâmetros de lançamento: {"webassembly":"hidden"} esconde o WebAssembly no worker (wasm2js);
// {"early":true} faz o worker começar a carregar o core antes da mensagem init; {"cache":"idb"} liga
// o experimento do WebAssembly.Module guardado no IndexedDB (worker.js); {"nocore":true} não sobe o
// worker (piso do sistema para a 1ª tela, usado pelo screen-timeline). Resultado em window.__f011
// (lido pelo run via CDP).
// ES5: roda no Chromium 53 sem Babel.
var Bridge = require('../../vendor/stremio-core-web/bridge.js');

var CINEMETA = 'https://v3-cinemeta.strem.io/manifest.json';
var TIMEOUT_MS = 90000;
var BOARD_KEY = 'f011.board';
var params = {};
try {
    params = JSON.parse((window.PalmSystem && window.PalmSystem.launchParams) || '{}') || {};
} catch (_e) {
    params = {};
}
var HIDDEN = params.webassembly === 'hidden';
var EXPECT = HIDDEN ? { variant: 'wasm2js', reason: 'no-webassembly' } : { variant: 'wasm', reason: 'webassembly' };
var R = window.__f011 = {
    scenario: HIDDEN ? 'hidden' : 'wasm',
    early: !!params.early,
    expect: EXPECT,
    done: false,
    ok: false,
    userAgent: navigator.userAgent,
    navigationStart: performance.timing.navigationStart,
    timings: { headMs: window.__early && round(window.__early.headMs) },
    stages: [],
    errors: []
};

function round(ms) { return Math.round(ms * 10) / 10; }
function now() { return performance.now(); }
function stage(name, t) { R.stages.push({ name: name, ms: round(t === undefined ? now() : t) }); }
function fail(where, err) { R.errors.push({ stage: where, error: String(err && (err.stack || err.message) || err) }); }
window.onerror = function (msg, src, line) { fail('window.onerror', msg + ' @' + src + ':' + line); };

// Pinta e chama cb depois da pintura (dois requestAnimationFrame).
function afterPaint(cb) {
    requestAnimationFrame(function () { requestAnimationFrame(function () { cb(now()); }); });
}

// --- Responsividade da página: setInterval de 50 ms e quadros de requestAnimationFrame.
var beats = [];
var frames = [];
var lastBeat = now();
setInterval(function () {
    var t = now();
    beats.push([round(lastBeat), round(t - lastBeat)]);
    lastBeat = t;
}, 50);
(function frame() {
    frames.push(now());
    requestAnimationFrame(frame);
})();

function windowStats(from, to) {
    var gaps = beats.filter(function (b) { return b[0] >= from && b[0] < to; }).map(function (b) { return b[1]; });
    var fr = frames.filter(function (t) { return t >= from && t < to; });
    var maxFrameGap = 0;
    for (var i = 1; i < fr.length; i++) maxFrameGap = Math.max(maxFrameGap, fr[i] - fr[i - 1]);
    gaps.sort(function (a, b) { return a - b; });
    var secs = (to - from) / 1000;
    return {
        fromMs: round(from),
        toMs: round(to),
        beats: gaps.length,
        // Atraso do setInterval além dos 50 ms previstos.
        beatDelayP50Ms: gaps.length ? round(gaps[Math.floor(gaps.length * 0.5)] - 50) : null,
        beatDelayP95Ms: gaps.length ? round(gaps[Math.floor(gaps.length * 0.95)] - 50) : null,
        beatDelayMaxMs: gaps.length ? round(gaps[gaps.length - 1] - 50) : null,
        beatsOver250Ms: gaps.filter(function (g) { return g > 300; }).length,
        fps: secs > 0 ? round(fr.length / secs) : null,
        maxFrameGapMs: round(maxFrameGap)
    };
}

// --- Board: o salvo da execução anterior (cache) e o vivo, do core.
function renderBoard(board, label) {
    var html = '';
    board.rows.forEach(function (row) {
        html += '<div class="row"><h3>' + row.name + '</h3><div class="cards">';
        row.items.forEach(function (item) { html += '<span class="card">' + item + '</span>'; });
        html += '</div></div>';
    });
    document.getElementById('board').innerHTML = html;
    document.getElementById('splash').innerHTML = '<b>Stremio</b> · ' + label;
}

function show() {
    var lines = [
        'cenário ' + R.scenario + (R.early ? ' (early)' : '') + ' · ' + (R.loader ? R.loader.variant + ' (' + R.loader.reason + ')' : '…'),
        'init ' + (R.timings.initMs || '…') + ' ms · 1ª pintura ' + (R.timings.firstPaintMs || '…') + ' ms · Board do cache ' +
            (R.timings.cachedBoardPaintMs || '—') + ' ms · Board vivo ' + (R.timings.liveBoardPaintMs || '…') + ' ms',
        R.done ? (R.ok ? 'OK' : 'FALHOU ' + JSON.stringify(R.errors).slice(0, 300)) : ''
    ];
    document.getElementById('status').textContent = lines.join('\n');
}

afterPaint(function (t) {
    R.timings.firstPaintMs = round(t);
    show();
});
var cached = null;
try {
    cached = JSON.parse(localStorage.getItem(BOARD_KEY) || 'null');
} catch (_e) {
    cached = null;
}
if (cached && cached.rows) {
    renderBoard(cached, 'Board do cache (o core ainda está subindo)');
    afterPaint(function (t) {
        R.timings.cachedBoardPaintMs = round(t);
        show();
    });
}

// --- Worker e core.
if (params.nocore) {
    R.scenario = 'nocore';
    R.ok = true;
    afterPaint(function () { setTimeout(function () { R.done = true; show(); }, 1000); });
} else {
    startCore();
}

function startCore() {
    window.onCoreEvent = function () {};
    var hash = [HIDDEN ? 'webassembly=hidden' : '', params.early ? 'early=1' : '', params.cache ? 'cache=' + params.cache : '']
        .filter(Boolean).join('&');
    stage('worker-new');
    var worker = new Worker('worker.js' + (hash ? '#' + hash : ''));
    worker.onerror = function (e) { fail('worker.onerror', e.message + ' @' + e.filename + ':' + e.lineno); };
    worker.addEventListener('message', function (e) {
        var m = e.data && e.data.f011Mark;
        if (m) R.stages.push({ name: m.name, ms: round(now()), workerMs: round(m.t) });
    });
    var bridge = new Bridge(window, worker);
    function call(path, args) { return bridge.call(path, args || []); }
    function dispatch(action, field) { return call(['dispatch'], [action, field, location.hash]); }
    function poll(field, check, start) {
        return call(['getState'], [field]).then(function (state) {
            var res = check(state);
            if (res) return res;
            if (now() - start > TIMEOUT_MS) throw new Error('timeout esperando ' + field);
            return new Promise(function (resolve) { setTimeout(resolve, 200); }).then(function () {
                return poll(field, check, start);
            });
        });
    }
    function checkDiscover(state) {
        var content = state && state.catalog && state.catalog.content;
        if (!content || content.type === 'Loading') return null;
        if (content.type !== 'Ready') return { type: content.type };
        return { type: 'Ready', items: content.content.length };
    }
    function checkBoard(state) {
        var catalogs = (state && state.catalogs) || [];
        var settled = catalogs.filter(function (c) { return c.content && c.content.type !== 'Loading'; });
        if (!catalogs.length || settled.length < Math.min(catalogs.length, 6)) return null;
        var ready = settled.filter(function (c) { return c.content.type === 'Ready'; });
        return {
            catalogs: catalogs.length,
            ready: ready.length,
            rows: ready.map(function (c) {
                return {
                    name: (c.request && c.request.path && (c.request.path.type + ' / ' + c.request.path.id)) || '?',
                    items: c.content.content.slice(0, 10).map(function (m) { return m.name; })
                };
            })
        };
    }

    var tInit = now();
    stage('init-call', tInit);
    call(['init'], [{ appVersion: 'f011-core-init', shellVersion: null }]).then(function () {
        R.timings.initMs = round(now() - tInit);
        R.timings.initDoneMs = round(now());
        stage('init-done');
        return call(['f011Stats']);
    }).then(function (stats) {
        R.worker = stats;
        R.loader = stats.loader;
        show();
        var t = now();
        return call(['getState'], ['ctx']).then(function (ctx) {
            R.timings.getStateCtxMs = round(now() - t);
            R.ctx = { guest: !ctx.profile || ctx.profile.auth === null };
        });
    }).then(function () {
        var t = now();
        return dispatch({
            action: 'Load',
            args: {
                model: 'CatalogWithFiltersSelection',
                args: { request: { base: CINEMETA, path: { resource: 'catalog', type: 'movie', id: 'top', extra: [] } } }
            }
        }, 'discover').then(function () {
            return poll('discover', checkDiscover, t);
        }).then(function (res) {
            res.ms = round(now() - t);
            R.discover = res;
        });
    }).then(function () {
        var t = now();
        return dispatch({ action: 'Load', args: { model: 'CatalogsWithExtra', args: { extra: [] } } }, 'board').then(function () {
            return dispatch({ action: 'CatalogsWithExtra', args: { action: 'LoadRange', args: { start: 0, end: 6 } } }, 'board');
        }).then(function () {
            return poll('board', checkBoard, t);
        }).then(function (res) {
            R.board = { catalogs: res.catalogs, ready: res.ready, ms: round(now() - t) };
            R.timings.boardReadyMs = round(now());
            renderBoard(res, 'Board do core');
            try {
                localStorage.setItem(BOARD_KEY, JSON.stringify({ savedAt: Date.now(), rows: res.rows }));
            } catch (err) {
                fail('localStorage', err);
            }
            return new Promise(function (resolve) {
                afterPaint(function (tp) {
                    R.timings.liveBoardPaintMs = round(tp);
                    resolve();
                });
            });
        });
    }).then(function () {
        return call(['f011Stats']);
    }).then(function (stats) {
        R.worker = stats;
        R.loader = stats.loader;
        R.ok = R.discover.type === 'Ready' && R.discover.items > 0 && R.board.catalogs > 0 &&
            R.board.ready === R.board.catalogs && R.errors.length === 0 &&
            stats.loader.variant === EXPECT.variant && stats.loader.reason === EXPECT.reason;
    }, function (err) {
        fail('fluxo', err);
    }).then(function () {
        var initStart = tInit;
        var initEnd = R.timings.initDoneMs || now();
        R.mainThread = {
            beforeInit: windowStats(0, initStart),
            duringInit: windowStats(initStart, initEnd),
            afterInit: windowStats(initEnd, now())
        };
        if (performance.memory) R.pageMemory = { usedJSHeapSize: performance.memory.usedJSHeapSize };
        R.timings.totalMs = round(now());
        R.done = true;
        show();
    });
}
