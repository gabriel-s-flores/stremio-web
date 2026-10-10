/*
 * Sonda de persistência (F0.8). ES5 puro: roda no Chromium 53 do webOS TV 4.
 *
 * A cada abertura, para cada armazenamento:
 *   1. LÊ o marcador gravado antes ("found" + a versão que o gravou);
 *   2. se não existir, GRAVA um marcador com a versão atual (nunca sobrescreve).
 * Assim a sonda v1 grava, a v2 (instalada por cima) só lê, e o relatório diz quem escreveu cada dado.
 *
 * Resultado em window.__persist (completo quando .complete === true). Sem rede, sem dependências.
 */
(function () {
    'use strict';
    var VERSION = window.PERSIST_VERSION || '?';
    var APP_ID = window.PERSIST_APP_ID || '?';
    var NOW = new Date().toISOString();
    var R = window.__persist = {
        version: VERSION, appId: APP_ID, openedAt: NOW, complete: false,
        origin: location.origin, href: location.href, stores: {}, core: {}, notes: []
    };
    var pending = 0;

    // Valores parecidos com os do core (chaves de stremio-core/src/constants.rs).
    var CORE_KEYS = ['installation_id', 'schema_version', 'profile', 'library', 'library_recent', 'streams',
        'search_history', 'streaming_server_urls', 'notifications', 'calendar', 'dismissed_events'];
    var BIG_KB = 1024;

    function track(name) { pending++; return function () { if (--pending === 0) finish(); }; }
    function marker() { return JSON.stringify({ writer: VERSION, app: APP_ID, t: NOW }); }
    function parse(s) { try { return JSON.parse(s); } catch (e) { return null; } }
    function bigString(kb) { var s = '', chunk = new Array(1025).join('x'), i; for (i = 0; i < kb; i++) s += chunk; return s; }
    function checksum(s) { var h = 0, i; for (i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0; return h; }
    function entry(name, supported) { return (R.stores[name] = { supported: supported, found: false }); }
    function foundFrom(e, raw) {
        var m = parse(raw);
        e.found = !!m; e.writer = m ? m.writer : null; e.writtenAt = m ? m.t : null; e.writerApp = m ? m.app : null;
    }

    // ---------- localStorage ----------
    (function () {
        var e = entry('localStorage', typeof localStorage !== 'undefined');
        try {
            var raw = localStorage.getItem('persist_marker');
            foundFrom(e, raw);
            // chaves do core
            var present = [], missing = [], k;
            for (k = 0; k < CORE_KEYS.length; k++) (localStorage.getItem('core_' + CORE_KEYS[k]) !== null ? present : missing).push(CORE_KEYS[k]);
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
                e.wrote = true;
            }
            // Cota: escreve blocos de 256 KB até falhar e remove tudo no fim.
            var total = 0, chunk = bigString(256), n = 0;
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
        var done = track('idb');
        var settled = false;
        function end(msg) { if (settled) return; settled = true; if (msg) e.error = msg; done(); }
        setTimeout(function () { end('timeout'); }, 8000);
        try {
            var req = indexedDB.open('persist_probe', 1);
            req.onupgradeneeded = function () { req.result.createObjectStore('kv'); e.created = true; };
            req.onerror = function () { end('open: ' + (req.error && req.error.name)); };
            req.onblocked = function () { end('blocked'); };
            req.onsuccess = function () {
                var db = req.result;
                try {
                    var tx = db.transaction('kv', 'readwrite'), st = tx.objectStore('kv');
                    var g = st.get('marker'), gb = st.get('big');
                    tx.oncomplete = function () { db.close(); end(); };
                    tx.onerror = tx.onabort = function () { end('tx: ' + (tx.error && tx.error.name)); };
                    g.onsuccess = function () {
                        foundFrom(e, g.result || null);
                        if (!e.found) { st.put(marker(), 'marker'); var b = bigString(BIG_KB); st.put(b, 'big'); st.put(String(checksum(b)), 'big_sum'); e.wrote = true; }
                    };
                    gb.onsuccess = function () { e.big = gb.result ? { kb: Math.round(gb.result.length / 1024) } : null; };
                } catch (err2) { end(String(err2)); }
            };
        } catch (err) { end(String(err)); }
    })();

    // ---------- WebSQL ----------
    (function () {
        var e = entry('webSQL', typeof openDatabase === 'function');
        if (typeof openDatabase !== 'function') return;
        var done = track('websql');
        var settled = false;
        function end(msg) { if (settled) return; settled = true; if (msg) e.error = msg; done(); }
        setTimeout(function () { end('timeout'); }, 8000);
        try {
            var db = openDatabase('persist_probe', '1.0', 'persist probe', 2 * 1024 * 1024);
            db.transaction(function (tx) {
                tx.executeSql('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)');
                tx.executeSql('SELECT v FROM kv WHERE k = ?', ['marker'], function (t, rs) {
                    foundFrom(e, rs.rows.length ? rs.rows.item(0).v : null);
                    if (!e.found) { t.executeSql('INSERT OR REPLACE INTO kv VALUES (?, ?)', ['marker', marker()]); e.wrote = true; }
                });
            }, function (err) { end('tx: ' + (err && err.message)); }, function () { end(); });
        } catch (err) { end(String(err)); }
    })();

    // ---------- Cache API ----------
    (function () {
        var e = entry('cacheAPI', !!window.caches);
        if (!window.caches) return;
        var done = track('cache');
        var settled = false;
        function end(msg) { if (settled) return; settled = true; if (msg) e.error = msg; done(); }
        setTimeout(function () { end('timeout'); }, 8000);
        try {
            caches.open('persist_probe').then(function (c) {
                return c.match('/persist_marker').then(function (resp) {
                    if (resp) return resp.text().then(function (t) { foundFrom(e, t); });
                }).then(function () {
                    if (!e.found) { e.wrote = true; return c.put('/persist_marker', new Response(marker())); }
                });
            }).then(function () { end(); }, function (err) { end(String(err)); });
        } catch (err) { end(String(err)); }
    })();

    // ---------- FileSystem API (webkitRequestFileSystem) ----------
    (function () {
        var e = entry('fileSystem', typeof webkitRequestFileSystem === 'function');
        if (typeof webkitRequestFileSystem !== 'function') return;
        var done = track('fs');
        var settled = false;
        function end(msg) { if (settled) return; settled = true; if (msg) e.error = msg; done(); }
        setTimeout(function () { end('timeout'); }, 8000);
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
        try {
            if (navigator.webkitPersistentStorage) {
                navigator.webkitPersistentStorage.requestQuota(1024 * 1024, function () { open(1); }, function (err) { end('requestQuota: ' + (err && err.name)); });
            } else { open(1); }
        } catch (err) { end(String(err)); }
    })();

    // ---------- Luna db8 (armazenamento do sistema, por app) ----------
    (function () {
        var e = entry('lunaDb8', typeof PalmServiceBridge === 'function');
        if (typeof PalmServiceBridge !== 'function') return;
        var done = track('db8');
        var settled = false;
        function end(msg) { if (settled) return; settled = true; if (msg) e.error = msg; done(); }
        setTimeout(function () { end('timeout'); }, 8000);
        function call(uri, params, cb) {
            var b = new PalmServiceBridge();
            b.onservicecallback = function (m) { cb(parse(m) || { raw: m }); };
            b.call(uri, JSON.stringify(params));
        }
        var KIND = APP_ID + ':1';
        try {
            call('luna://com.webos.service.db/find', { query: { from: KIND } }, function (res) {
                e.findReply = res;
                if (res.returnValue && res.results && res.results.length) {
                    foundFrom(e, res.results[0].marker); end(); return;
                }
                // sem o kind (ou negado): tenta registrar e gravar
                call('luna://com.webos.service.db/putKind', { id: KIND, owner: APP_ID, schema: { type: 'object', properties: { marker: { type: 'string' } } }, indexes: [] }, function (pk) {
                    e.putKindReply = pk;
                    call('luna://com.webos.service.db/put', { objects: [{ _kind: KIND, marker: marker() }] }, function (p) {
                        e.putReply = p; e.wrote = !!p.returnValue; end();
                    });
                });
            });
        } catch (err) { end(String(err)); }
    })();

    // ---------- fim ----------
    function finish() {
        // sessionStorage vive enquanto o app está aberto: guarda o relatório do PRIMEIRO carregamento
        // da sessão, porque um recarregamento (ex.: relançamento do webOS) acharia os dados que o
        // próprio primeiro carregamento acabou de gravar.
        try {
            var prev = parse(sessionStorage.getItem('persist_session_log')) || { loads: [], first: null };
            var summary = {};
            Object.keys(R.stores).forEach(function (k) { summary[k] = R.stores[k].supported ? (R.stores[k].found ? R.stores[k].writer : false) : null; });
            prev.loads.push({ openedAt: NOW, found: summary });
            if (!prev.first) prev.first = { openedAt: NOW, found: summary, core: R.core, big: R.stores.localStorage.big };
            sessionStorage.setItem('persist_session_log', JSON.stringify(prev));
            R.session = { loadCount: prev.loads.length, firstLoad: prev.first, loads: prev.loads };
        } catch (e) { R.session = { error: String(e) }; }
        R.complete = true;
        render();
    }
    function render() {
        document.getElementById('title').textContent = 'Persist Probe ' + VERSION;
        document.getElementById('sub').textContent = APP_ID + '  ·  ' + R.origin + '  ·  ' + NOW;
        var html = '<tr><th>armazenamento</th><th>achou dado antigo?</th><th>gravado por</th><th>obs.</th></tr>', k, e, cls, obs;
        for (k in R.stores) {
            if (!Object.prototype.hasOwnProperty.call(R.stores, k)) continue;
            e = R.stores[k];
            cls = !e.supported ? 'na' : (e.found ? 'yes' : 'no');
            obs = e.error ? 'erro: ' + e.error : (e.wrote ? 'gravou agora' : '');
            html += '<tr class="' + cls + '"><td>' + k + '</td><td>' + (e.supported ? (e.found ? 'SIM' : 'não') : 'sem API') + '</td><td>' + (e.writer || '-') + '</td><td>' + obs + '</td></tr>';
        }
        document.getElementById('tbl').innerHTML = html;
    }
    window.addEventListener('load', function () {
        // garante o fim mesmo que nenhum armazenamento assíncrono tenha sido iniciado
        if (pending === 0) finish();
    });
})();
