/*
 * Implementação de REFERÊNCIA da persistência recomendada para a F3.5 (ES5, Chromium 53).
 * Não é a F3.5: serve para provar no emulador, com IndexedDB real, a lógica do README
 * (restaurar, não restaurar após "Limpar dados", não entrar em laço, validar o appId).
 *
 * Modelo: o localStorage continua sendo a fonte da verdade que o core lê. O IndexedDB guarda uma cópia
 * (uma entrada por chave, sem lista fixa) e só serve para repor o localStorage quando ele estiver
 * VAZIO no boot, ou seja, depois de desinstalar + reinstalar.
 *
 *   __mirror.boot()      antes de iniciar o core. Resolve { restored, reason, keys }.
 *   __mirror.watch()     depois do boot: passa a copiar setItem/removeItem e a tratar clear().
 *   __mirror.confirm()   depois que o init do core deu certo (encerra a "restauração pendente").
 *   __mirror.discard()   o init falhou logo depois de uma restauração: apaga a cópia.
 *   __mirror.wipe()      reset por fora do fluxo normal (tela de diagnóstico / flag).
 *   __mirror.flush()     grava já as mudanças pendentes (também roda em pagehide/visibilitychange).
 */
(function () {
    'use strict';
    var APP_ID = window.PERSIST_APP_ID || 'unknown';
    var DB_NAME = 'stremio-webos-persist:' + APP_ID;        // o IndexedDB é compartilhado por todos os apps file://
    var NO_RESTORE = 'stremio_webos_persist_no_restore';    // sessionStorage: sobrevive ao reload() imediato
    var FLUSH_MS = 1000;

    var dirty = {}, timer = null, watching = false, pendingRestore = false, dbPromise = null;
    var ls = window.localStorage;
    var proto = window.Storage && Storage.prototype;
    var orig = proto ? { setItem: proto.setItem, removeItem: proto.removeItem, clear: proto.clear } : null;

    function openDb() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise(function (resolve, reject) {
            var req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = function () { req.result.createObjectStore('kv'); req.result.createObjectStore('meta'); };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error); };
            req.onblocked = function () { reject(new Error('blocked')); };
        });
        return dbPromise;
    }
    // Executa fn(kv, meta) numa transação readwrite e resolve quando ela COMMITA.
    function tx(fn) {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var t = db.transaction(['kv', 'meta'], 'readwrite'), out;
                try { out = fn(t.objectStore('kv'), t.objectStore('meta'), t); } catch (e) { reject(e); return; }
                t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
                t.onerror = t.onabort = function () { reject(t.error || new Error('tx abortada')); };
            });
        });
    }
    function readAll() {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var t = db.transaction(['kv', 'meta'], 'readonly'), snap = { kv: {}, meta: null };
                t.objectStore('kv').openCursor().onsuccess = function (ev) {
                    var c = ev.target.result;
                    if (c) { snap.kv[c.key] = c.value; c.continue(); }
                };
                var m = t.objectStore('meta').get('meta');
                m.onsuccess = function () { snap.meta = m.result || null; };
                t.oncomplete = function () { resolve(snap); };
                t.onerror = t.onabort = function () { reject(t.error); };
            });
        });
    }
    function lsKeys() {
        var keys = [], i;
        for (i = 0; i < ls.length; i++) keys.push(ls.key(i));
        return keys;
    }
    function metaRecord(extra) {
        var m = { appId: APP_ID, state: 'valid', pendingRestore: false, updatedAt: new Date().toISOString() }, k;
        for (k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) m[k] = extra[k];
        return m;
    }
    // Substitui toda a cópia pelo conteúdo atual do localStorage.
    function snapshotFromLs() {
        return tx(function (kv, meta) {
            kv.clear();
            lsKeys().forEach(function (k) { kv.put(ls.getItem(k), k); });
            meta.put(metaRecord({ pendingRestore: pendingRestore }), 'meta');
        });
    }
    function wipe() {
        pendingRestore = false;
        dirty = {}; clearTimeout(timer); timer = null;
        return tx(function (kv, meta) { kv.clear(); meta.clear(); });
    }

    function boot() {
        var noRestore = false;
        try { noRestore = sessionStorage.getItem(NO_RESTORE) === '1'; sessionStorage.removeItem(NO_RESTORE); } catch (e) { /* sem sessionStorage */ }
        return readAll().then(function (snap) {
            var keys = lsKeys(), res;
            if (noRestore) {                      // "Limpar dados": o usuário quer começar do zero
                return wipe().then(function () { return { restored: false, reason: 'clear-data', keys: 0 }; });
            }
            if (keys.length > 0) {                // o localStorage tem dados: ele é a verdade
                return snapshotFromLs().then(function () { return { restored: false, reason: 'localStorage-ok', keys: keys.length }; });
            }
            if (!snap.meta || snap.meta.state !== 'valid' || Object.keys(snap.kv).length === 0) {
                return { restored: false, reason: 'nothing-to-restore', keys: 0 };
            }
            if (snap.meta.appId !== APP_ID) {     // cópia de outro app/build que usa o mesmo IndexedDB
                return wipe().then(function () { return { restored: false, reason: 'app-mismatch', keys: 0 }; });
            }
            if (snap.meta.pendingRestore) {       // já restaurou uma vez e o init não chegou a confirmar: não repetir
                return wipe().then(function () { return { restored: false, reason: 'unconfirmed-restore', keys: 0 }; });
            }
            // Marca a restauração como pendente e SÓ DEPOIS copia para o localStorage.
            return tx(function (kv, meta) { meta.put(metaRecord({ pendingRestore: true }), 'meta'); }).then(function () {
                Object.keys(snap.kv).forEach(function (k) { ls.setItem(k, snap.kv[k]); });
                pendingRestore = true;
                res = { restored: true, reason: 'restored', keys: Object.keys(snap.kv).length };
                return res;
            });
        });
    }
    function confirm() { pendingRestore = false; return tx(function (kv, meta) { meta.put(metaRecord({ pendingRestore: false }), 'meta'); }); }
    function discard() { return wipe(); }

    // ---- espelho das escritas ----
    function schedule() { if (!timer) timer = setTimeout(flush, FLUSH_MS); }
    function flush() {
        clearTimeout(timer); timer = null;
        var batch = dirty; dirty = {};
        var keys = Object.keys(batch);
        if (!keys.length) return Promise.resolve();
        return tx(function (kv, meta) {
            keys.forEach(function (k) {
                var v = ls.getItem(k);                 // o valor mais recente, não o do momento da chamada
                if (v === null) kv.delete(k); else kv.put(v, k);
            });
            meta.put(metaRecord({ pendingRestore: pendingRestore }), 'meta');
        }).catch(function () { keys.forEach(function (k) { dirty[k] = 1; }); });
    }
    function watch() {
        if (watching || !orig) return;
        watching = true;
        proto.setItem = function (k, v) {
            orig.setItem.call(this, k, v);
            if (this === ls) { dirty[k] = 1; schedule(); }
        };
        proto.removeItem = function (k) {
            orig.removeItem.call(this, k);
            if (this === ls) { dirty[k] = 1; schedule(); }
        };
        proto.clear = function () {
            orig.clear.call(this);
            if (this === ls) {
                // O reload() do botão "Limpar dados" vem logo depois: o marcador tem que ser SÍNCRONO.
                try { sessionStorage.setItem(NO_RESTORE, '1'); } catch (e) { /* sem sessionStorage */ }
                wipe();
            }
        };
        window.addEventListener('pagehide', flush);
        document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); });
    }

    window.__mirror = {
        boot: boot, watch: watch, confirm: confirm, discard: discard, wipe: wipe, flush: flush,
        dbName: DB_NAME, noRestoreKey: NO_RESTORE,
        // só para os testes
        rawClear: orig && orig.clear,   // clear() original, sem o tratamento do espelho
        read: readAll,
        lsDump: function () { var o = {}; lsKeys().forEach(function (k) { o[k] = ls.getItem(k); }); return o; }
    };
})();
