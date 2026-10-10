/*
 * Implementação de REFERÊNCIA da persistência recomendada para a F3.5 (ES5, Chromium 53).
 * Não é a F3.5: serve para provar no emulador, com IndexedDB real, a lógica do README
 * (restaurar, não restaurar após "Limpar dados", não entrar em laço, validar o appId, não travar o app
 * se o IndexedDB falhar, não sobrescrever a cópia boa com um localStorage parcial).
 *
 * Modelo: o localStorage continua sendo o que o core lê. O IndexedDB guarda uma cópia (uma entrada por
 * chave, sem lista fixa) e só repõe o localStorage quando ele está VAZIO ou é PARCIAL no boot, ou seja,
 * depois de desinstalar + reinstalar. O localStorage só é "a verdade" se tiver as chaves essenciais
 * (schema_version e profile) OU o marcador de época da cópia (stremio_webos_persist_epoch).
 *
 *   __mirror.bootSafe(ms)  antes de iniciar o core. NUNCA rejeita nem trava: resolve { restored, reason, keys }
 *                          com reason 'idb-error' / 'idb-timeout' se o IndexedDB não responder.
 *   __mirror.boot()        o mesmo, sem timeout (usado pelos testes).
 *   __mirror.watch()       depois do boot: passa a copiar setItem/removeItem e a tratar clear().
 *   __mirror.confirm()     depois que o init do core deu certo (encerra a "restauração pendente").
 *   __mirror.discard()     o init falhou logo depois de uma restauração: apaga a cópia.
 *   __mirror.wipe()        reset por fora do fluxo normal (tela de diagnóstico / flag).
 *   __mirror.flush()       grava já as mudanças pendentes (também roda em pagehide/visibilitychange).
 */
(function () {
    'use strict';
    var APP_ID = window.PERSIST_APP_ID || 'unknown';
    var DB_NAME = 'stremio-webos-persist:' + APP_ID;        // o IndexedDB é compartilhado por todos os apps file://
    var NO_RESTORE = 'stremio_webos_persist_no_restore';    // sessionStorage: sobrevive ao reload() imediato
    var EPOCH_KEY = 'stremio_webos_persist_epoch';          // localStorage: liga o localStorage a esta cópia
    var FLUSH_MS = 1000;

    var dirty = {}, timer = null, watching = false, pendingRestore = false, dbPromise = null;
    var epoch = null, broken = false, bootAborted = false;
    var ls = window.localStorage;
    var proto = window.Storage && Storage.prototype;
    var orig = proto ? { setItem: proto.setItem, removeItem: proto.removeItem, clear: proto.clear } : null;

    function newEpoch() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
    function openDb() {
        if (dbPromise) return dbPromise;
        var p = new Promise(function (resolve, reject) {
            var req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = function () { req.result.createObjectStore('kv'); req.result.createObjectStore('meta'); };
            req.onsuccess = function () { resolve(req.result); };
            req.onerror = function () { reject(req.error || new Error('indexedDB.open falhou')); };
            req.onblocked = function () { reject(new Error('blocked')); };
        });
        dbPromise = p;
        p.catch(function () { if (dbPromise === p) dbPromise = null; });   // não guarda uma promessa rejeitada
        return p;
    }
    // Executa fn(kv, meta) numa transação readwrite e resolve quando ela COMMITA.
    function tx(fn) {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var t = db.transaction(['kv', 'meta'], 'readwrite');
                try { fn(t.objectStore('kv'), t.objectStore('meta')); } catch (e) { reject(e); return; }
                t.oncomplete = function () { resolve(); };
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
    function lsKeys() {          // as chaves do app (sem a chave de época, que é nossa)
        var keys = [], i, k;
        for (i = 0; i < ls.length; i++) { k = ls.key(i); if (k !== EPOCH_KEY) keys.push(k); }
        return keys;
    }
    function metaRecord(extra) {
        var m = { appId: APP_ID, state: 'valid', epoch: epoch, pendingRestore: pendingRestore, updatedAt: new Date().toISOString() }, k;
        for (k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) m[k] = extra[k];
        return m;
    }
    function stampEpoch() { if (orig && epoch) orig.setItem.call(ls, EPOCH_KEY, epoch); }
    // Grava o localStorage atual na cópia. replace=true apaga o que a cópia tem a mais; false só acrescenta/atualiza.
    function snapshotFromLs(replace) {
        return tx(function (kv, meta) {
            if (replace) kv.clear();
            lsKeys().forEach(function (k) { kv.put(ls.getItem(k), k); });
            meta.put(metaRecord({}), 'meta');
        }).then(stampEpoch);
    }
    function wipe() {
        pendingRestore = false;
        dirty = {}; clearTimeout(timer); timer = null;
        epoch = newEpoch();
        try { if (orig) orig.removeItem.call(ls, EPOCH_KEY); } catch (e) { /* ignora */ }
        return tx(function (kv, meta) { kv.clear(); meta.clear(); });
    }

    function boot() {
        var noRestore = false;
        try { noRestore = sessionStorage.getItem(NO_RESTORE) === '1'; sessionStorage.removeItem(NO_RESTORE); } catch (e) { /* sem sessionStorage */ }
        return readAll().then(function (snap) {
            var keys = lsKeys(), meta = snap.meta, mirrorKeys = Object.keys(snap.kv);
            var hasMirror = !!(meta && meta.state === 'valid' && mirrorKeys.length > 0);
            epoch = meta && meta.epoch ? meta.epoch : newEpoch();
            pendingRestore = !!(meta && meta.pendingRestore);        // só confirm()/discard()/wipe() zeram
            if (noRestore) {                      // "Limpar dados": o usuário quer começar do zero
                return wipe().then(function () { return { restored: false, reason: 'clear-data', keys: 0 }; });
            }
            var essential = keys.indexOf('schema_version') >= 0 && keys.indexOf('profile') >= 0;
            var sameEpoch = hasMirror && ls.getItem(EPOCH_KEY) === meta.epoch;
            if (keys.length > 0 && (essential || sameEpoch || !hasMirror)) {
                // O localStorage é a verdade. Se ele continua a cópia (mesma época) ou não há cópia, a cópia vira
                // um retrato exato dele; senão (só tem as chaves essenciais) só acrescenta, sem apagar a cópia.
                return snapshotFromLs(sameEpoch || !hasMirror).then(function () {
                    return { restored: false, reason: 'localStorage-ok', keys: keys.length };
                });
            }
            if (!hasMirror) return { restored: false, reason: 'nothing-to-restore', keys: 0 };
            if (meta.appId !== APP_ID) {          // cópia de outro app/build que usa o mesmo IndexedDB
                return wipe().then(function () { return { restored: false, reason: 'app-mismatch', keys: 0 }; });
            }
            if (pendingRestore) {                 // já restaurou uma vez e o init não confirmou: não repetir
                return wipe().then(function () { return { restored: false, reason: 'unconfirmed-restore', keys: 0 }; });
            }
            if (bootAborted) return { restored: false, reason: 'idb-timeout', keys: 0 };
            // localStorage vazio, ou parcial sem as chaves essenciais e de outra época: restaura/mescla.
            // Marca a restauração como pendente e SÓ DEPOIS copia para o localStorage.
            return tx(function (kv, m) { m.put(metaRecord({ pendingRestore: true }), 'meta'); }).then(function () {
                if (bootAborted) {                // o timeout já liberou o init: não mexer no localStorage agora
                    return tx(function (kv, m) { m.put(metaRecord({ pendingRestore: false }), 'meta'); }).then(function () {
                        return { restored: false, reason: 'idb-timeout', keys: 0 };
                    });
                }
                var n = 0;
                mirrorKeys.forEach(function (k) {
                    if (ls.getItem(k) === null) { orig.setItem.call(ls, k, snap.kv[k]); n++; }   // não pisa no que o localStorage já tem
                });
                stampEpoch();
                pendingRestore = true;
                return { restored: true, reason: keys.length === 0 ? 'restored' : 'merged', keys: n };
            });
        });
    }
    // Entrada recomendada: nunca rejeita e nunca passa de `ms`, para o init do core sempre rodar.
    function bootSafe(ms) {
        var timer2;
        bootAborted = false;
        var timeout = new Promise(function (resolve) {
            timer2 = setTimeout(function () { bootAborted = true; broken = true; resolve({ restored: false, reason: 'idb-timeout', keys: 0 }); }, ms || 3000);
        });
        var safe = boot().then(function (r) { return r; }, function (e) {
            broken = true;
            return { restored: false, reason: 'idb-error', keys: 0, error: String((e && e.message) || e) };
        });
        return Promise.race([safe, timeout]).then(function (r) { clearTimeout(timer2); return r; });
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
        if (!epoch) epoch = newEpoch();
        stampEpoch();
        return tx(function (kv, meta) {
            keys.forEach(function (k) {
                var v = ls.getItem(k);                 // o valor mais recente, não o do momento da chamada
                if (v === null) kv.delete(k); else kv.put(v, k);
            });
            meta.put(metaRecord({}), 'meta');
        }).catch(function () { keys.forEach(function (k) { dirty[k] = 1; }); });
    }
    function watch() {
        if (watching || !orig || broken) return;       // IndexedDB com problema: o app segue só com o localStorage
        watching = true;
        proto.setItem = function (k, v) {
            orig.setItem.call(this, k, v);
            if (this === ls && k !== EPOCH_KEY) { dirty[k] = 1; schedule(); }
        };
        proto.removeItem = function (k) {
            orig.removeItem.call(this, k);
            if (this === ls && k !== EPOCH_KEY) { dirty[k] = 1; schedule(); }
        };
        proto.clear = function () {
            orig.clear.call(this);
            if (this === ls) {
                // O reload() do botão "Limpar dados" vem logo depois: o marcador tem que ser SÍNCRONO.
                try { sessionStorage.setItem(NO_RESTORE, '1'); } catch (e) { /* sem sessionStorage */ }
                wipe().catch(function () { /* o marcador já garante o resultado */ });
            }
        };
        window.addEventListener('pagehide', flush);
        document.addEventListener('visibilitychange', function () { if (document.hidden) flush(); });
    }

    window.__mirror = {
        boot: boot, bootSafe: bootSafe, watch: watch, confirm: confirm, discard: discard, wipe: wipe, flush: flush,
        dbName: DB_NAME, noRestoreKey: NO_RESTORE, epochKey: EPOCH_KEY,
        // só para os testes
        rawClear: orig && orig.clear,   // clear() original, sem o tratamento do espelho
        rawSetItem: orig && orig.setItem,
        read: readAll,
        lsDump: function () { var o = {}; lsKeys().forEach(function (k) { o[k] = ls.getItem(k); }); return o; }
    };
})();
