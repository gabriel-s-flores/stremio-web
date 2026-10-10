/*
 * Sonda de persistência (F0.8). ES5 puro: roda no Chromium 53 do webOS TV 4.
 *
 * A cada abertura, para cada armazenamento:
 *   1. LÊ o marcador gravado antes ("found", quem gravou e QUANDO: "writtenAt");
 *   2. se não existir, GRAVA um marcador com a versão atual (nunca sobrescreve).
 * Assim a sonda v1 grava, a v2 (instalada por cima) só lê, e o relatório diz quem escreveu cada dado.
 *
 * "survived" = achou o marcador E ele foi gravado ANTES de esta sessão do app começar. A sessão é
 * rastreada no sessionStorage, de forma síncrona no início do script (um recarregamento da página,
 * como o relançamento que o webOS faz após o ares-install, continua na mesma sessão e não conta como
 * dado antigo). Não depende do relógio do host.
 *
 * Resultado em window.__persist (completo quando .complete === true).
 * Funções para os cenários: __persistRun() (repete a leitura/gravação), __persistReset() (apaga o que a
 * sonda gravou, inclusive o banco do IndexedDB e o kind do db8), __persistBump() (sobrescreve o contador).
 */
(function () {
    'use strict';
    var VERSION = window.PERSIST_VERSION || '?';
    var APP_ID = window.PERSIST_APP_ID || '?';
    if (window.PERSIST_MODE === 'mirror') { window.__persist = { mode: 'mirror', complete: true }; return; }

    // Chaves que o core 0.65.0 realmente usa (stremio-core/src/constants.rs + env.rs).
    // `calendar` está declarada no core mas nada a lê ou grava na 0.65.0.
    var CORE_KEYS = ['installation_id', 'schema_version', 'profile', 'library', 'library_recent', 'streams',
        'search_history', 'streaming_server_urls', 'notifications', 'dismissed_events'];
    var BIG_KB = 1024;
    var KIND = APP_ID + ':1';
    var R = null;
    var pending = 0;
    var NOW = '';

    function parse(s) { try { return JSON.parse(s); } catch (e) { return null; } }
    function bigString(kb) { var s = '', chunk = new Array(1025).join('x'), i; for (i = 0; i < kb; i++) s += chunk; return s; }
    function checksum(s) { var h = 0, i; for (i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return h; }
    function marker() { return JSON.stringify({ writer: VERSION, app: APP_ID, t: NOW }); }

    // ---------- sessão: registrada ANTES de qualquer leitura ou gravação ----------
    var FIRST_NOW = new Date().toISOString();
    var SESSION = (function () {
        var s = { start: FIRST_NOW, loadIndex: 1 };
        try {
            var p = parse(sessionStorage.getItem('persist_session'));
            if (p && p.start) { s.start = p.start; s.loadIndex = p.loads + 1; }
            sessionStorage.setItem('persist_session', JSON.stringify({ start: s.start, loads: s.loadIndex }));
        } catch (e) { s.error = String(e); }
        return s;
    })();

    function track() { pending++; return function () { if (--pending === 0) finish(); }; }
    function entry(name, supported) { return (R.stores[name] = { supported: supported, found: false }); }
    function foundFrom(e, raw) {
        var m = parse(raw);
        e.found = !!m; e.writer = m ? m.writer : null; e.writtenAt = m ? m.t : null; e.writerApp = m ? m.app : null;
        e.survived = !!(m && m.t < SESSION.start);
    }
    function guard(name, fn) {
        // Armazenamento assíncrono: uma única chamada a done(), com timeout.
        var done = track(), settled = false;
        function end(msg) { if (settled) return; settled = true; if (msg) R.stores[name].error = msg; done(); }
        setTimeout(function () { end('timeout'); }, 8000);
        try { fn(end); } catch (err) { end(String(err)); }
    }
    function lunaCall(uri, params, cb) {
        var b = new PalmServiceBridge();
        b.onservicecallback = function (m) { cb(parse(m) || { raw: m }); };
        b.call(uri, JSON.stringify(params));
    }

    function run() {
        NOW = new Date().toISOString();
        pending = 0;
        R = window.__persist = {
            version: VERSION, appId: APP_ID, openedAt: NOW, complete: false,
            origin: location.origin, href: location.href, session: SESSION, stores: {}, core: {}, counters: {}
        };
        var k;

        // ---------- localStorage ----------
        (function () {
            var e = entry('localStorage', typeof localStorage !== 'undefined');
            try {
                foundFrom(e, localStorage.getItem('persist_marker'));
                var present = [], missing = [], key;
                for (k = 0; k < CORE_KEYS.length; k++) {
                    key = CORE_KEYS[k];
                    (localStorage.getItem('core_' + key) !== null ? present : missing).push(key);
                }
                R.core = { present: present, missing: missing };
                var big = localStorage.getItem('persist_big');
                e.big = big === null ? null : { kb: Math.round(big.length / 1024), checksumOk: checksum(big) === Number(localStorage.getItem('persist_big_sum')) };
                e.keyCount = localStorage.length;
                if (!e.found) {
                    localStorage.setItem('persist_marker', marker());
                    for (k = 0; k < CORE_KEYS.length; k++) {
                        localStorage.setItem('core_' + CORE_KEYS[k], JSON.stringify({ writer: VERSION, key: CORE_KEYS[k], payload: 'x' }));
                    }
                    var b = bigString(BIG_KB);
                    localStorage.setItem('persist_big', b);
                    localStorage.setItem('persist_big_sum', String(checksum(b)));
                    localStorage.setItem('persist_counter', '1');
                    e.wrote = true;
                }
                R.counters.localStorage = Number(localStorage.getItem('persist_counter'));
                // Cota: escreve blocos de 256 KB até falhar e remove tudo no fim.
                var total = 0, chunk = bigString(256), n;
                try { for (n = 0; n < 40; n++) { localStorage.setItem('persist_quota_' + n, chunk); total += 256; } } catch (qe) { /* cota */ }
                for (k = 0; k < 40; k++) localStorage.removeItem('persist_quota_' + k);
                e.quotaKbExtra = total;
            } catch (err) { e.error = String(err); }
        })();

        // ---------- sessionStorage ----------
        (function () {
            var e = entry('sessionStorage', typeof sessionStorage !== 'undefined');
            try {
                foundFrom(e, sessionStorage.getItem('persist_marker'));
                if (!e.found) { sessionStorage.setItem('persist_marker', marker()); e.wrote = true; }
            } catch (err) { e.error = String(err); }
        })();

        // ---------- cookies ----------
        (function () {
            var e = entry('cookie_persistent', typeof document.cookie === 'string');
            var s = entry('cookie_session', typeof document.cookie === 'string');
            try {
                var jar = document.cookie || '';
                R.cookieJar = jar;
                var m = /(?:^|; )persist_cookie=([^;]*)/.exec(jar);
                foundFrom(e, m ? decodeURIComponent(m[1]) : null);
                var ms = /(?:^|; )persist_session=([^;]*)/.exec(jar);
                foundFrom(s, ms ? decodeURIComponent(ms[1]) : null);
                if (!e.found) { document.cookie = 'persist_cookie=' + encodeURIComponent(marker()) + '; max-age=315360000; path=/'; }
                if (!s.found) { document.cookie = 'persist_session=' + encodeURIComponent(marker()) + '; path=/'; }
                e.visibleRightAfterWrite = /persist_cookie=/.test(document.cookie);
            } catch (err) { e.error = String(err); }
        })();

        // ---------- IndexedDB ----------
        (function () {
            var e = entry('indexedDB', !!window.indexedDB);
            if (!window.indexedDB) return;
            guard('indexedDB', function (end) {
                var req = indexedDB.open('persist_probe', 1);
                req.onupgradeneeded = function () { req.result.createObjectStore('kv'); e.created = true; };
                req.onerror = function () { end('open: ' + (req.error && req.error.name)); };
                req.onblocked = function () { end('blocked'); };
                req.onsuccess = function () {
                    var db = req.result;
                    try {
                        var tx = db.transaction('kv', 'readwrite'), st = tx.objectStore('kv');
                        var g = st.get('marker'), gb = st.get('big'), gc = st.get('counter');
                        tx.oncomplete = function () { db.close(); end(); };
                        tx.onerror = tx.onabort = function () { end('tx: ' + (tx.error && tx.error.name)); };
                        gb.onsuccess = function () { e.big = gb.result ? { kb: Math.round(gb.result.length / 1024) } : null; };
                        gc.onsuccess = function () { R.counters.indexedDB = gc.result || 1; };
                        g.onsuccess = function () {
                            foundFrom(e, g.result || null);
                            if (!e.found) {
                                st.put(marker(), 'marker');
                                var b = bigString(BIG_KB);
                                st.put(b, 'big'); st.put(String(checksum(b)), 'big_sum'); st.put(1, 'counter');
                                e.wrote = true;
                            }
                        };
                    } catch (err2) { end(String(err2)); }
                };
            });
        })();

        // ---------- WebSQL ----------
        (function () {
            var e = entry('webSQL', typeof openDatabase === 'function');
            if (typeof openDatabase !== 'function') return;
            guard('webSQL', function (end) {
                var db = openDatabase('persist_probe', '1.0', 'persist probe', 2 * 1024 * 1024);
                db.transaction(function (tx) {
                    tx.executeSql('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)');
                    tx.executeSql('SELECT v FROM kv WHERE k = ?', ['marker'], function (t, rs) {
                        foundFrom(e, rs.rows.length ? rs.rows.item(0).v : null);
                        if (!e.found) { t.executeSql('INSERT OR REPLACE INTO kv VALUES (?, ?)', ['marker', marker()]); e.wrote = true; }
                    });
                }, function (err) { end('tx: ' + (err && err.message)); }, function () { end(); });
            });
        })();

        // ---------- Cache API ----------
        (function () {
            var e = entry('cacheAPI', !!window.caches);
            if (!window.caches) return;
            guard('cacheAPI', function (end) {
                caches.open('persist_probe').then(function (c) {
                    return c.match('/persist_marker').then(function (resp) {
                        if (resp) return resp.text().then(function (t) { foundFrom(e, t); });
                    }).then(function () {
                        if (!e.found) { e.wrote = true; return c.put('/persist_marker', new Response(marker())); }
                    });
                }).then(function () { end(); }, function (err) { end(String(err)); });
            });
        })();

        // ---------- FileSystem API (webkitRequestFileSystem) ----------
        (function () {
            var e = entry('fileSystem', typeof webkitRequestFileSystem === 'function');
            if (typeof webkitRequestFileSystem !== 'function') return;
            guard('fileSystem', function (end) {
                function open(type) {
                    webkitRequestFileSystem(type, 1024 * 1024, function (fs) {
                        fs.root.getFile('persist_marker.txt', { create: false }, function (fe) {
                            fe.file(function (f) {
                                var r = new FileReader();
                                r.onload = function () { foundFrom(e, r.result); end(); };
                                r.onerror = function () { end('read'); };
                                r.readAsText(f);
                            }, function () { end('file()'); });
                        }, function () {
                            fs.root.getFile('persist_marker.txt', { create: true }, function (fe) {
                                fe.createWriter(function (w) {
                                    w.onwriteend = function () { e.wrote = true; end(); };
                                    w.onerror = function () { end('write'); };
                                    w.write(new Blob([marker()], { type: 'text/plain' }));
                                }, function () { end('createWriter'); });
                            }, function (err) { end('create: ' + (err && err.name)); });
                        });
                    }, function (err) { end('requestFileSystem: ' + (err && err.name)); });
                }
                if (navigator.webkitPersistentStorage) {
                    navigator.webkitPersistentStorage.requestQuota(1024 * 1024, function () { open(1); }, function (err) { end('requestQuota: ' + (err && err.name)); });
                } else { open(1); }
            });
        })();

        // ---------- Luna db8 (armazenamento do sistema, por app) ----------
        (function () {
            var e = entry('lunaDb8', typeof PalmServiceBridge === 'function');
            if (typeof PalmServiceBridge !== 'function') return;
            guard('lunaDb8', function (end) {
                lunaCall('luna://com.webos.service.db/find', { query: { from: KIND } }, function (res) {
                    e.findReply = res;
                    if (res.returnValue && res.results && res.results.length) {
                        foundFrom(e, res.results[0].marker);
                        R.counters.lunaDb8 = res.results[0].counter || 1;
                        end(); return;
                    }
                    // sem o kind (ou negado): tenta registrar e gravar
                    lunaCall('luna://com.webos.service.db/putKind', { id: KIND, owner: APP_ID, schema: { type: 'object', properties: { marker: { type: 'string' }, counter: { type: 'number' } } }, indexes: [] }, function (pk) {
                        e.putKindReply = pk;
                        lunaCall('luna://com.webos.service.db/put', { objects: [{ _kind: KIND, marker: marker(), counter: 1 }] }, function (p) {
                            e.putReply = p; e.wrote = !!p.returnValue; R.counters.lunaDb8 = 1; end();
                        });
                    });
                });
            });
        })();

        if (pending === 0) finish();
    }

    // ---------- fim ----------
    function finish() {
        R.complete = true;
        R.writesDoneAt = Date.now();
        render();
    }
    function render() {
        document.getElementById('title').textContent = 'Persist Probe ' + VERSION;
        document.getElementById('sub').textContent = APP_ID + '  ·  ' + R.origin + '  ·  ' + NOW + '  ·  carga ' + SESSION.loadIndex + ' da sessão';
        var html = '<tr><th>armazenamento</th><th>sobreviveu?</th><th>gravado por</th><th>obs.</th></tr>', name, e, cls, obs;
        for (name in R.stores) {
            if (!Object.prototype.hasOwnProperty.call(R.stores, name)) continue;
            e = R.stores[name];
            cls = !e.supported ? 'na' : (e.survived ? 'yes' : 'no');
            obs = e.error ? 'erro: ' + e.error : (e.wrote ? 'gravou agora' : (e.found && !e.survived ? 'gravado nesta sessão' : ''));
            html += '<tr class="' + cls + '"><td>' + name + '</td><td>' + (e.supported ? (e.survived ? 'SIM' : 'não') : 'sem API') + '</td><td>' + (e.writer || '-') + '</td><td>' + obs + '</td></tr>';
        }
        document.getElementById('tbl').innerHTML = html;
    }

    // ---------- auxiliares dos cenários ----------
    // Apaga tudo o que a sonda gravou, inclusive o banco do IndexedDB e o kind do db8.
    window.__persistReset = function () {
        return new Promise(function (resolve) {
            var out = {}, left = 2;
            function one(name) { return function (v) { out[name] = v; if (--left === 0) resolve(out); }; }
            var i, keys = [];
            for (i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
            keys.forEach(function (key) { if (/^(persist_|core_)/.test(key)) localStorage.removeItem(key); });
            out.localStorage = 'limpo';
            var idb = one('indexedDB'), db8 = one('lunaDb8');
            try {
                var d = indexedDB.deleteDatabase('persist_probe');
                d.onsuccess = function () { idb('apagado'); };
                d.onerror = function () { idb('erro ' + (d.error && d.error.name)); };
                d.onblocked = function () { idb('bloqueado'); };
            } catch (e1) { idb(String(e1)); }
            try {
                lunaCall('luna://com.webos.service.db/delKind', { id: KIND }, function (r) { db8(r); });
            } catch (e2) { db8(String(e2)); }
            setTimeout(function () { resolve(out); }, 6000);
        });
    };
    // Sobrescreve o contador nos três armazenamentos (o espelho da F3.5 sobrescreve registros o tempo todo).
    window.__persistBump = function () {
        return new Promise(function (resolve) {
            var out = {}, left = 3, doneAll = false;
            function fin(name, v) { out[name] = v; if (--left === 0 && !doneAll) { doneAll = true; out.doneAt = Date.now(); resolve(out); } }
            var n = Number(localStorage.getItem('persist_counter') || 0) + 1;
            localStorage.setItem('persist_counter', String(n));
            fin('localStorage', n);
            var req = indexedDB.open('persist_probe', 1);
            req.onerror = function () { fin('indexedDB', 'erro'); };
            req.onsuccess = function () {
                var db = req.result, tx = db.transaction('kv', 'readwrite'), st = tx.objectStore('kv'), g = st.get('counter'), v = 0;
                g.onsuccess = function () { v = (g.result || 0) + 1; st.put(v, 'counter'); };
                tx.oncomplete = function () { db.close(); fin('indexedDB', v); };
                tx.onerror = tx.onabort = function () { fin('indexedDB', 'erro tx'); };
            };
            lunaCall('luna://com.webos.service.db/find', { query: { from: KIND } }, function (res) {
                var cur = res.results && res.results[0] ? (res.results[0].counter || 1) : 0, next = cur + 1;
                lunaCall('luna://com.webos.service.db/merge', { query: { from: KIND }, props: { counter: next } }, function (m) {
                    fin('lunaDb8', m.returnValue ? next : 'erro ' + JSON.stringify(m));
                });
            });
            setTimeout(function () { if (!doneAll) { doneAll = true; out.timeout = true; resolve(out); } }, 8000);
        });
    };
    window.__persistRun = run;

    run();
})();
