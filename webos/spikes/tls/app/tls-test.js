/*
 * App de teste da F0.7 (ES5, roda no Chromium 53). Compara, para hosts Let's Encrypt:
 *   - acesso direto (esperado: net::ERR_INSECURE_RESPONSE);
 *   - opção (a): serviço JS do próprio app (proxy em 127.0.0.1 com as raízes ISRG);
 *   - opção (b): proxy de imagens de terceiros (wsrv.nl, cadeia GTS/GlobalSign), só alternativa.
 * Resultados em window.__tls (lidos por cdp.mjs); window.__tls.complete marca o fim.
 */
(function () {
    'use strict';

    var SERVICE = 'luna://io.github.gabrielsflores.webostls.service';
    var POSTER = 'https://images.metahub.space/poster/medium/tt0111161/img';
    var LE_API = 'https://debrid-link.com/api/v2/downloader/domains';
    var GTS_API = 'https://v3-cinemeta.strem.io/manifest.json';
    // 24 títulos populares: 12 em sequência (latência por pôster) e 12 em paralelo (vazão).
    var IMDB = ['tt0068646', 'tt0468569', 'tt0071562', 'tt0050083', 'tt0108052', 'tt0167260',
        'tt0110912', 'tt0120737', 'tt0060196', 'tt0109830', 'tt0137523', 'tt0167261',
        'tt1375666', 'tt0080684', 'tt0133093', 'tt0099685', 'tt0073486', 'tt0114369',
        'tt0047478', 'tt0038650', 'tt0102926', 'tt0120815', 'tt0816692', 'tt0317248'];
    var RUN = Date.now().toString(36);

    var T = window.__tls = { started: Date.now(), log: [], images: {}, fetches: {}, bench: {}, memory: {}, complete: false };
    var subscription = null;
    var proxy = null;

    function log(msg) {
        T.log.push(((Date.now() - T.started) / 1000).toFixed(2) + 's ' + msg);
    }

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
    }

    function luna(uri, params, cb) {
        var bridge = new PalmServiceBridge();
        bridge.onservicecallback = function (msg) {
            var data;
            try { data = JSON.parse(msg); } catch (e) { data = { returnValue: false, errorText: String(msg) }; }
            cb(data);
        };
        bridge.call(uri, JSON.stringify(params || {}));
        return bridge;
    }

    function proxied(target, bust) {
        return 'http://127.0.0.1:' + proxy.port + '/proxy?t=' + proxy.token +
            (bust ? '&_=' + RUN + '-' + bust : '') + '&url=' + encodeURIComponent(target);
    }

    function wsrv(target) {
        return 'https://wsrv.nl/?url=' + encodeURIComponent(target.replace(/^https:\/\//, ''));
    }

    function posterUrl(id) {
        return 'https://images.metahub.space/poster/medium/' + id + '/img';
    }

    function loadImage(src, timeoutMs) {
        return new Promise(function (resolve) {
            var img = new Image();
            var t0 = performance.now();
            var timer = setTimeout(function () { done(false, 'timeout'); }, timeoutMs || 20000);
            function done(ok, why) {
                clearTimeout(timer);
                img.onload = img.onerror = null;
                resolve({ ok: ok, ms: Math.round(performance.now() - t0), width: img.naturalWidth, height: img.naturalHeight, why: why, img: img });
            }
            img.onload = function () { done(img.naturalWidth > 0, 'load'); };
            img.onerror = function () { done(false, 'error'); };
            img.src = src;
        });
    }

    function timedFetch(url) {
        var t0 = performance.now();
        return fetch(url).then(function (res) {
            return res.text().then(function (body) {
                return { ok: res.ok, status: res.status, type: res.headers.get('content-type'), bytes: body.length, ms: Math.round(performance.now() - t0), upstreamMs: Number(res.headers.get('x-proxy-upstream-ms')) || null, body: body };
            });
        }, function (err) {
            return { ok: false, error: String(err), ms: Math.round(performance.now() - t0) };
        });
    }

    function serviceStatus() {
        return fetch('http://127.0.0.1:' + proxy.port + '/status').then(function (r) { return r.json(); });
    }

    function stat(list) {
        var s = list.slice().sort(function (a, b) { return a - b; });
        var sum = s.reduce(function (a, b) { return a + b; }, 0);
        return { n: s.length, min: s[0], median: s[Math.floor(s.length / 2)], p90: s[Math.min(s.length - 1, Math.floor(s.length * 0.9))], max: s[s.length - 1], mean: Math.round(sum / (s.length || 1)) };
    }

    function sequential(items, fn) {
        var out = [];
        return items.reduce(function (p, item, i) {
            return p.then(function () { return fn(item, i).then(function (r) { out.push(r); }); });
        }, Promise.resolve()).then(function () { return out; });
    }

    function posterTile(name, src) {
        var tile = el('div', 'tile');
        var label = el('div', 'label wait', name + ': carregando…');
        tile.appendChild(label);
        document.getElementById('posters').appendChild(tile);
        return loadImage(src).then(function (r) {
            T.images[name] = { src: src, ok: r.ok, ms: r.ms, width: r.width, height: r.height, why: r.why };
            r.img.alt = name;
            tile.insertBefore(r.img, label);
            label.className = 'label ' + (r.ok ? 'ok' : 'bad');
            label.textContent = name + ': ' + (r.ok ? 'OK ' + r.width + 'x' + r.height + ' em ' + r.ms + ' ms' : 'FALHOU (' + r.why + ')');
            log('img ' + name + ' ' + (r.ok ? 'ok' : r.why) + ' ' + r.ms + 'ms');
        });
    }

    function fetchBox(name, url, summarize) {
        var box = el('div', 'box');
        var pre = el('pre', 'wait', name + ': …');
        box.appendChild(pre);
        document.getElementById('fetches').appendChild(box);
        return timedFetch(url).then(function (r) {
            var summary = r.error ? r.error : summarize(r);
            T.fetches[name] = { url: url, ok: r.ok, status: r.status, type: r.type, bytes: r.bytes, ms: r.ms, error: r.error, summary: summary };
            pre.className = r.ok ? 'ok' : 'bad';
            pre.textContent = name + ': ' + (r.ok ? 'HTTP ' + r.status + ' em ' + r.ms + ' ms · ' : 'FALHOU · ') + summary;
            log('fetch ' + name + ' ' + (r.ok ? r.status : r.error) + ' ' + r.ms + 'ms');
        });
    }

    function domainsSummary(r) {
        try {
            var data = JSON.parse(r.body);
            return 'success=' + data.success + ', ' + (data.value || []).length + ' domínios (' + r.type + ')';
        } catch (e) {
            return r.type + ', ' + r.bytes + ' bytes';
        }
    }

    function bench() {
        var pre = document.getElementById('bench');
        var thumbs = document.getElementById('thumbs');
        var seqIds = IMDB.slice(0, 12);
        var parIds = IMDB.slice(12);
        function show(r) {
            var img = r.img;
            if (r.ok) thumbs.appendChild(img);
            return r;
        }
        return serviceStatus().then(function (s) {
            T.memory.afterStart = s;
            log('serviço: ' + s.node + ', OpenSSL ' + s.openssl + ', estratégia ' + s.strategy + ', rss ' + Math.round(s.rss / 1048576) + ' MB');
            pre.textContent = 'serviço pronto: ' + s.node + ' / OpenSSL ' + s.openssl + ' / ' + s.strategy + '\nlote sequencial…';
            return sequential(seqIds, function (id, i) { return loadImage(proxied(posterUrl(id), 's' + i)).then(show); });
        }).then(function (seq) {
            T.bench.proxySequential = { ok: seq.filter(function (r) { return r.ok; }).length, first: seq[0].ms, ms: stat(seq.slice(1).map(function (r) { return r.ms; })), all: seq.map(function (r) { return r.ms; }) };
            pre.textContent += '\nlote paralelo…';
            var t0 = performance.now();
            return Promise.all(parIds.map(function (id, i) { return loadImage(proxied(posterUrl(id), 'p' + i)).then(show); })).then(function (par) {
                T.bench.proxyParallel = { ok: par.filter(function (r) { return r.ok; }).length, n: par.length, wallMs: Math.round(performance.now() - t0), ms: stat(par.map(function (r) { return r.ms; })) };
            });
        }).then(function () {
            return serviceStatus().then(function (s) { T.memory.afterPosters = s; });
        }).then(function () {
            pre.textContent += '\nalternativa wsrv.nl…';
            return sequential(seqIds, function (id) { return loadImage(wsrv(posterUrl(id))); }).then(function (seq) {
                T.bench.wsrvSequential = { ok: seq.filter(function (r) { return r.ok; }).length, first: seq[0].ms, ms: stat(seq.slice(1).map(function (r) { return r.ms; })), all: seq.map(function (r) { return r.ms; }) };
            });
        }).then(function () {
            // Custo do salto local: mesmo recurso (host GTS, que funciona direto) com e sem o serviço.
            pre.textContent += '\nsobrecarga do salto local…';
            var n = [0, 1, 2, 3, 4, 5, 6, 7];
            return sequential(n, function (i) { return timedFetch(GTS_API + '?_=' + RUN + 'd' + i); }).then(function (direct) {
                return sequential(n, function (i) { return timedFetch(proxied(GTS_API + '?_=' + RUN + 'p' + i)); }).then(function (viaProxy) {
                    T.bench.overheadGts = {
                        direct: stat(direct.slice(1).map(function (r) { return r.ms; })),
                        proxy: stat(viaProxy.slice(1).map(function (r) { return r.ms; })),
                        proxyUpstream: stat(viaProxy.slice(1).map(function (r) { return r.upstreamMs || 0; })),
                        directOk: direct.filter(function (r) { return r.ok; }).length,
                        proxyOk: viaProxy.filter(function (r) { return r.ok; }).length
                    };
                });
            });
        }).then(function () {
            // Estabilidade: o combo que expôs a falha intermitente do <img> com o repasse em
            // pedaços (pôster tt0111161 pelo serviço + wsrv + fetch pelo serviço, ao mesmo tempo).
            pre.textContent += '\nestabilidade (20 rodadas)…';
            var rounds = [];
            for (var i = 0; i < 20; i++) rounds.push(i);
            return sequential(rounds, function (i) {
                return Promise.all([
                    loadImage(proxied(POSTER, 'st' + i)),
                    loadImage(wsrv(POSTER) + '&_=' + RUN + i),
                    timedFetch(proxied(GTS_API + '?_=' + RUN + 'st' + i))
                ]);
            }).then(function (res) {
                T.bench.stability = { rounds: res.length, proxyImgOk: res.filter(function (r) { return r[0].ok; }).length, wsrvOk: res.filter(function (r) { return r[1].ok; }).length, fetchOk: res.filter(function (r) { return r[2].ok; }).length };
            });
        }).then(function () {
            return serviceStatus().then(function (s) { T.memory.afterAll = s; });
        }).then(function () {
            var b = T.bench;
            var m = T.memory;
            var mb = function (x) { return (x / 1048576).toFixed(1) + ' MB'; };
            pre.className = 'ok';
            pre.textContent =
                'serviço: ' + m.afterAll.node + ' / OpenSSL ' + m.afterAll.openssl + ' / ' + m.afterAll.strategy + '\n' +
                'pelo serviço, sequencial: ' + b.proxySequential.ok + '/12 ok · 1º (TLS frio) ' + b.proxySequential.first + ' ms · mediana ' + b.proxySequential.ms.median + ' ms · p90 ' + b.proxySequential.ms.p90 + ' ms\n' +
                'pelo serviço, 12 em paralelo: ' + b.proxyParallel.ok + '/12 ok em ' + b.proxyParallel.wallMs + ' ms\n' +
                'wsrv.nl (terceiro), sequencial: ' + b.wsrvSequential.ok + '/12 ok · mediana ' + b.wsrvSequential.ms.median + ' ms · p90 ' + b.wsrvSequential.ms.p90 + ' ms\n' +
                'estabilidade (img pelo serviço + wsrv + fetch, simultâneos): ' + b.stability.proxyImgOk + '/' + b.stability.rounds + ' pôsteres ok\n' +
                'salto local (cinemeta, GTS): direto mediana ' + b.overheadGts.direct.median + ' ms · pelo serviço ' + b.overheadGts.proxy.median + ' ms\n' +
                'memória do serviço (rss): após start ' + mb(m.afterStart.rss) + ' · após pôsteres ' + mb(m.afterPosters.rss) + ' · fim ' + mb(m.afterAll.rss) +
                ' · heapUsed ' + mb(m.afterAll.heapUsed);
        });
    }

    function startService() {
        return new Promise(function (resolve, reject) {
            var t0 = performance.now();
            var timer = setTimeout(function () { reject(new Error('timeout no luna start')); }, 20000);
            // Assinatura mantida aberta: é o que segura o serviço vivo enquanto o app roda.
            subscription = luna(SERVICE + '/start', { subscribe: true }, function (r) {
                clearTimeout(timer);
                T.service = r;
                T.serviceStartMs = Math.round(performance.now() - t0);
                log('luna start ' + JSON.stringify(r) + ' em ' + T.serviceStartMs + 'ms');
                if (r.returnValue && r.listening) resolve(r);
                else reject(new Error('start: ' + JSON.stringify(r)));
            });
        });
    }

    document.getElementById('env').textContent = navigator.userAgent;
    log('ua ' + navigator.userAgent);

    // Com ares-launch -p '{"hold":true}' o app espera window.__tlsGo() (cdp-net.mjs --go), para
    // o log de rede do CDP cobrir também a primeira passada, com o serviço ainda frio.
    var launchParams = {};
    try { launchParams = JSON.parse(window.PalmSystem && PalmSystem.launchParams || '{}'); } catch (e) { launchParams = {}; }
    var go = new Promise(function (resolve) {
        if (!launchParams.hold) { resolve(); return; }
        log('hold: aguardando __tlsGo()');
        window.__tlsGo = function () { log('go'); resolve(); return true; };
    });

    var direct = go.then(function () { return Promise.all([
        posterTile('direto', POSTER),
        fetchBox('direto (sem serviço)', LE_API, domainsSummary),
        fetchBox('controle GTS direto (cinemeta)', GTS_API, function (r) { return r.type + ', ' + r.bytes + ' bytes'; })
    ]); });

    direct.then(function () {
        return startService();
    }).then(function (r) {
        proxy = r;
        return Promise.all([
            posterTile('via serviço (a)', proxied(POSTER)),
            posterTile('wsrv.nl (b)', wsrv(POSTER)),
            fetchBox('via serviço (a)', proxied(LE_API), domainsSummary)
        ]);
    }).then(bench).then(function () {
        T.complete = true;
        log('fim');
    }, function (err) {
        T.error = String(err && err.stack || err);
        T.complete = true;
        log('erro ' + T.error);
        var pre = document.getElementById('bench');
        pre.className = 'bad';
        pre.textContent = 'ERRO: ' + T.error;
    });
    // Carga longa para a memória do serviço: n pôsteres (6 em paralelo, URLs sempre novas), com
    // amostras de /status a cada 50. Chamado pelo run.sh quando SOAK=n.
    window.__tlsSoak = function (n) {
        var samples = [];
        var done = 0;
        var errors = 0;
        var t0 = performance.now();
        function sample() {
            return serviceStatus().then(function (s) {
                samples.push({ loads: done, rss: s.rss, heapUsed: s.heapUsed, heapTotal: s.heapTotal });
            });
        }
        function batch(start) {
            var ids = [];
            for (var i = start; i < Math.min(n, start + 6); i++) ids.push(i);
            return Promise.all(ids.map(function (i) {
                return loadImage(proxied(posterUrl(IMDB[i % IMDB.length]), 'soak' + i)).then(function (r) {
                    done++;
                    if (!r.ok) errors++;
                });
            }));
        }
        function loop(start) {
            if (start >= n) return sample();
            return batch(start).then(function () {
                return (Math.floor((start + 6) / 50) > Math.floor(start / 50) ? sample() : Promise.resolve()).then(function () { return loop(start + 6); });
            });
        }
        return sample().then(function () { return loop(0); }).then(function () {
            T.soak = { n: n, errors: errors, seconds: Math.round(performance.now() - t0) / 1000, samples: samples };
            return JSON.stringify(T.soak);
        });
    };

    // Mantém a referência viva (o GC da ponte cancelaria a assinatura).
    window.__tlsSubscription = function () { return subscription; };
})();
