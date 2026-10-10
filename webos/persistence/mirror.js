// Persistência do app no webOS (F3.5): espelho do localStorage num IndexedDB.
//
// O core do Stremio grava tudo no localStorage (perfil, addons, configurações, biblioteca). No
// emulador ele sobrevive a atualização e reboot, mas não a desinstalar e reinstalar, e a doc da LG
// diz que até a atualização o apaga (webos/spikes/persistence/README.md, F0.8). O IndexedDB
// sobreviveu a tudo. Este módulo guarda no IndexedDB uma cópia de TODAS as chaves do localStorage
// (sem lista fixa) e só repõe o localStorage, antes do init do core, quando ele está vazio ou
// parcial. O localStorage continua sendo o que o core lê; o código do core não muda.
//
// Uso (src/core/createTransport.webos.js):
//   var mirror = createMirror({ appId: id });
//   mirror.start()                  na carga do módulo: começa o trabalho (abre o IndexedDB se precisar)
//   mirror.ready()                  quando o init vai rodar; resolve { restored, reason, keys, ms, waitedMs },
//                                   NUNCA rejeita, e o init nunca espera mais que timeoutMs (3 s)
//     .then(transport.init)
//     .then(mirror.initSucceeded,   confirma uma restauração e libera o espelho das escritas
//           mirror.initFailed)      o init falhou logo depois de uma restauração: apaga a cópia
//
// Regras do start() (as do README da F0.8, com a correção do achado B6 da revisão c3):
//   0. Caminho rápido: sem marcadores e com as chaves essenciais (schema_version e profile) ou com a
//      época de uma cópia, o localStorage é a verdade e o ready() resolve na hora, SEM abrir o
//      IndexedDB. É o boot comum (um convidado que nunca mudou nada não tem profile, mas tem a época
//      depois do primeiro lote), que assim não espera nada. A cópia é atualizada depois do init
//      (snapshot adiado), que acrescenta e atualiza, mas nunca apaga o que falta no localStorage.
//   1. Marcador de "Limpar dados" (ou ?resetMirror): não restaura e apaga a cópia (clear-data, reset).
//   2. Marcador de restauração pulada (ver abaixo): a cópia vale mais que o localStorage, que veio
//      de uma sessão que começou sem ela; restaura a cópia por cima (restored-after-skip).
//   3. O localStorage tem a época da cópia, ou não há cópia: ele é a verdade (localStorage-ok). "Verdade"
//      quer dizer que o core lê ele como está; a cópia não perde o que ele não tem (ver o flush()).
//   4. Sem cópia (nothing-to-restore); cópia de outro app (app-mismatch, descarta); restauração
//      anterior não confirmada (unconfirmed-restore, descarta em vez de repetir; com o marcador de
//      restauração pulada, a marca é de uma sessão que rodou sem a cópia, e vale a regra 2).
//   5. Senão restaura (localStorage vazio: restored) ou mescla só as chaves que faltam (merged).
//      Grava pendingRestore = true e espera o commit ANTES de mexer no localStorage.
// IndexedDB com erro ou sem resposta: idb-error / idb-timeout; o app segue só com o localStorage e
// o espelho das escritas fica desligado nesta sessão. Se o localStorage não tinha as chaves
// essenciais, grava o marcador SKIPPED_KEY (síncrono): o core vai começar sem a cópia e gravar um
// estado novo, que no boot seguinte não pode ser tomado por verdade (achado B6 da revisão F0.8 c3).
// Uma restauração que termina depois do timeout não mexe em nada.
//
// Escritas: Storage.prototype.setItem/removeItem embrulhados marcam a chave (só no localStorage);
// o lote grava ~1 s depois, relendo o valor atual de cada chave, e também em pagehide e
// visibilitychange. Nada vai para o IndexedDB antes de o init do core dar certo: o primeiro lote é
// o snapshot completo, settleMs (5 s) depois do init, fora do caminho do boot.
// "Limpar dados" (src/core/Error/Error.tsx: localStorage.clear() e reload() no mesmo handler): o
// clear() embrulhado grava o marcador NO_RESTORE_KEY de forma síncrona (sessionStorage e o próprio
// localStorage) e só então dispara a limpeza assíncrona da cópia; o marcador vence no próximo boot.
//
// ES5: roda no Chromium 53 sem Babel. Dependências injetáveis para os testes (webos/tests/persistence).

var PREFIX = 'stremio_webos_persist_';                // chaves nossas: nunca vão para a cópia
var EPOCH_KEY = PREFIX + 'epoch';                      // liga o localStorage à cópia que o acompanha
var NO_RESTORE_KEY = PREFIX + 'no_restore';            // "Limpar dados": não restaurar, apagar a cópia
var SKIPPED_KEY = PREFIX + 'skipped';                  // o core começou sem consultar a cópia
var ESSENTIAL_KEYS = ['schema_version', 'profile'];
var DB_PREFIX = 'stremio-webos-persist:';              // o IndexedDB é compartilhado por todos os apps file://

function isInternal(key) {
    return typeof key === 'string' && key.indexOf(PREFIX) === 0;
}

function newEpoch() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function errorText(err) {
    return String((err && (err.message || err.name)) || err);
}

function createMirror(options) {
    var opts = options || {};
    var g = typeof window === 'object' ? window : {};
    var appId = String(opts.appId || 'unknown');
    var ls = opts.localStorage || g.localStorage;
    var ss = opts.sessionStorage !== undefined ? opts.sessionStorage : g.sessionStorage;
    var idb = opts.indexedDB !== undefined ? opts.indexedDB : g.indexedDB;
    var proto = opts.storageProto || (g.Storage && g.Storage.prototype);
    var events = opts.events !== undefined ? opts.events : g;          // pagehide
    var doc = opts.document !== undefined ? opts.document : g.document; // visibilitychange
    var timeoutMs = opts.timeoutMs || 3000;
    var flushMs = opts.flushMs || 1000;
    var settleMs = opts.settleMs || 5000;
    var resetRequested = !!opts.reset;
    var now = opts.now || function () { return Date.now(); };
    var dbName = DB_PREFIX + appId;

    var orig = proto ? { setItem: proto.setItem, removeItem: proto.removeItem, clear: proto.clear } : null;
    var dbPromise = null;
    var work = null;              // o trabalho do boot, começado no start()
    var settled = null;           // o resultado entregue ao init (ready())
    var fastResult = null;
    var giveUp = function (r) { return r; };
    var t0 = 0;
    var epoch = null;
    var broken = false;          // IndexedDB com problema nesta sessão: espelho desligado
    var aborted = false;         // o timeout do start() já liberou o init
    var holding = true;          // nada vai para a cópia antes de o init do core dar certo
    var restoredThisBoot = false;
    var snapshotPending = false;
    var dirty = {};
    var timer = null;
    var status = { appId: appId, dbName: dbName, result: null, flushes: 0, lastFlush: null, error: null };

    // ---- localStorage ----
    function lsGet(key) {
        try { return ls.getItem(key); } catch (e) { return null; }
    }
    function lsSet(key, value) {
        try { orig.setItem.call(ls, key, value); return true; } catch (e) { return false; }
    }
    function lsRemove(key) {
        try { orig.removeItem.call(ls, key); } catch (e) { /* ignora */ }
    }
    function lsAppKeys() {
        var keys = [], i, k;
        for (i = 0; i < ls.length; i++) {
            k = ls.key(i);
            if (k !== null && !isInternal(k)) keys.push(k);
        }
        return keys;
    }
    function hasEssential(keys) {
        return ESSENTIAL_KEYS.every(function (k) { return keys.indexOf(k) >= 0; });
    }
    function stampEpoch() {
        if (epoch) lsSet(EPOCH_KEY, epoch);
    }
    function noRestoreMarked() {
        var marked = lsGet(NO_RESTORE_KEY) === '1';
        try { marked = marked || (ss && ss.getItem(NO_RESTORE_KEY) === '1'); } catch (e) { /* sem sessionStorage */ }
        return marked;
    }
    function clearNoRestore() {
        lsRemove(NO_RESTORE_KEY);
        try { if (ss) ss.removeItem(NO_RESTORE_KEY); } catch (e) { /* sem sessionStorage */ }
    }

    // ---- IndexedDB ----
    var STORES = ['kv', 'meta'];
    function missingStores(db) {
        return STORES.filter(function (name) { return !db.objectStoreNames.contains(name); });
    }
    // Abre na versão atual (ou cria a 1). Se o banco existe sem as stores (alguém o abriu sem versão
    // antes de nós), reabre com a versão seguinte para criá-las, em vez de ficar quebrado para sempre.
    function openVersion(version, resolve, reject) {
        var req = version ? idb.open(dbName, version) : idb.open(dbName);
        req.onupgradeneeded = function () {
            missingStores(req.result).forEach(function (name) { req.result.createObjectStore(name); });
        };
        req.onsuccess = function () {
            var db = req.result;
            if (missingStores(db).length) {
                db.close();
                if (version) reject(new Error('stores ausentes no IndexedDB'));
                else openVersion(db.version + 1, resolve, reject);
                return;
            }
            db.onversionchange = function () {   // não bloquear quem precisar subir a versão
                db.close();
                dbPromise = null;
            };
            resolve(db);
        };
        req.onerror = function () { reject(req.error || new Error('indexedDB.open falhou')); };
        req.onblocked = function () { reject(new Error('indexedDB.open bloqueado')); };
    }
    function openDb() {
        if (dbPromise) return dbPromise;
        var p = new Promise(function (resolve, reject) {
            if (!idb) throw new Error('sem indexedDB');
            openVersion(0, resolve, reject);
        });
        dbPromise = p;
        // Não guarda uma promessa rejeitada: a próxima operação tenta abrir de novo.
        p.then(null, function () { if (dbPromise === p) dbPromise = null; });
        return p;
    }
    // fn(kv, meta) numa transação; resolve com o retorno de fn quando ela COMMITA.
    function tx(mode, fn) {
        return openDb().then(function (db) {
            return new Promise(function (resolve, reject) {
                var t = db.transaction(['kv', 'meta'], mode), out;
                t.oncomplete = function () { resolve(out); };
                t.onerror = t.onabort = function () { reject(t.error || new Error('transação abortada')); };
                try {
                    out = fn(t.objectStore('kv'), t.objectStore('meta'));
                } catch (e) {
                    try { t.abort(); } catch (e2) { /* já terminou */ }
                    reject(e);
                }
            });
        });
    }
    function readMeta() {
        return tx('readonly', function (kv, meta) {
            var out = { meta: null, count: 0 };
            var m = meta.get('meta'), c = kv.count();
            m.onsuccess = function () { out.meta = m.result || null; };
            c.onsuccess = function () { out.count = c.result; };
            return out;
        });
    }
    function readKv() {
        return tx('readonly', function (kv) {
            var out = {};
            kv.openCursor().onsuccess = function (ev) {
                var cursor = ev.target.result;
                if (cursor) {
                    out[cursor.key] = cursor.value;
                    cursor['continue']();
                }
            };
            return out;
        });
    }
    function metaRecord(pendingRestore) {
        return {
            appId: appId,
            state: 'valid',
            epoch: epoch,
            pendingRestore: !!pendingRestore,
            updatedAt: new Date(now()).toISOString()
        };
    }
    function wipe() {
        dirty = {};
        snapshotPending = false;
        clearTimeout(timer);
        timer = null;
        epoch = newEpoch();
        lsRemove(EPOCH_KEY);
        return tx('readwrite', function (kv, meta) {
            kv.clear();
            meta.clear();
        });
    }

    // ---- boot ----
    function result(reason, extra) {
        var r = { restored: false, reason: reason, keys: 0 }, k;
        for (k in extra || {}) if (Object.prototype.hasOwnProperty.call(extra, k)) r[k] = extra[k];
        return r;
    }
    function timedOut() {
        return result('idb-timeout');
    }

    // Copia a cópia para o localStorage. overwrite: a cópia vence (e o que o localStorage tem a mais
    // sai); senão só acrescenta as chaves que faltam.
    function restore(kvData, overwrite, hadKeys) {
        return tx('readwrite', function (kv, meta) {
            meta.put(metaRecord(true), 'meta');
        }).then(function () {
            if (aborted) {
                // O init já começou sem a cópia: desfaz a marca e não toca no localStorage.
                return tx('readwrite', function (kv, meta) {
                    meta.put(metaRecord(false), 'meta');
                }).then(timedOut, timedOut);
            }
            var n = 0, failed = 0;
            if (overwrite) {
                lsAppKeys().forEach(function (k) {
                    if (!Object.prototype.hasOwnProperty.call(kvData, k)) lsRemove(k);
                });
            }
            Object.keys(kvData).forEach(function (k) {
                if (!overwrite && lsGet(k) !== null) return;   // não pisa no que o localStorage já tem
                if (lsSet(k, kvData[k])) n++; else failed++;
            });
            stampEpoch();
            lsRemove(SKIPPED_KEY);
            restoredThisBoot = true;
            var reason = overwrite ? 'restored-after-skip' : (hadKeys ? 'merged' : 'restored');
            return result(reason, failed ? { restored: true, keys: n, failed: failed } : { restored: true, keys: n });
        });
    }

    function boot(noRestore, skipped, keys) {
        return readMeta().then(function (snap) {
            if (aborted) return timedOut();
            var meta = snap.meta;
            var valid = !!(meta && meta.state === 'valid' && snap.count > 0);
            var pending = !!(meta && meta.pendingRestore);
            epoch = (meta && meta.epoch) || newEpoch();
            var sameEpoch = valid && lsGet(EPOCH_KEY) === meta.epoch;

            if (noRestore) {
                return wipe().then(function () {
                    clearNoRestore();
                    lsRemove(SKIPPED_KEY);
                    return result(resetRequested ? 'reset' : 'clear-data');
                });
            }
            function drop(reason) {
                return wipe().then(function () {
                    lsRemove(SKIPPED_KEY);
                    return result(reason);
                });
            }
            // Aqui o localStorage não tem as chaves essenciais (senão seria o caminho rápido), a não ser
            // com o marcador de restauração pulada, que tira dele o posto de verdade.
            if (!skipped && keys.length > 0 && (sameEpoch || !valid)) {
                return result('localStorage-ok', { keys: keys.length });
            }
            if (!valid) {
                lsRemove(SKIPPED_KEY);
                return keys.length ? result('localStorage-ok', { keys: keys.length }) : result('nothing-to-restore');
            }
            if (meta.appId !== appId) return drop('app-mismatch');
            // pendingRestore com o marcador de restauração pulada não é "uma restauração derrubou o
            // init": o init rodou SEM a cópia (o prazo venceu com a marca em voo e o app fechou antes de
            // desfazê-la). Descartar aqui apagaria a cópia boa; restaura por cima.
            if (pending && !skipped) return drop('unconfirmed-restore');
            return readKv().then(function (kvData) {
                if (aborted) return timedOut();
                return restore(kvData, skipped, keys.length > 0);
            });
        });
    }

    // Começa o trabalho já na carga do app (o IndexedDB abre enquanto a página monta), sem prazo.
    function start() {
        if (work) return;
        t0 = now();
        install();
        var keys = lsAppKeys();
        var noRestore = resetRequested || noRestoreMarked();
        var skipped = lsGet(SKIPPED_KEY) === '1';
        // Caminho rápido: as chaves essenciais, ou a época de uma cópia (este localStorage já foi
        // espelhado; a época é conferida no snapshot depois do init, que só mescla se ela não bater).
        if (!noRestore && !skipped && (hasEssential(keys) || (keys.length > 0 && lsGet(EPOCH_KEY) !== null))) {
            fastResult = result('localStorage-ok', { keys: keys.length, fast: true });
            work = Promise.resolve({ ok: fastResult });
            return;
        }
        // O core vai começar sem consultar a cópia: o próximo boot não pode confiar no que ele gravar.
        giveUp = function (r) {
            aborted = true;
            broken = true;
            if (!noRestore) lsSet(SKIPPED_KEY, '1');
            return r;
        };
        work = boot(noRestore, skipped, keys).then(function (r) {
            return { ok: r };
        }, function (e) {
            status.error = errorText(e);
            return { error: result('idb-error', { error: status.error }) };
        });
    }
    // O init do core pede o resultado: resolve { restored, reason, keys, ms, waitedMs }, NUNCA
    // rejeita, e o init nunca espera mais que timeoutMs. O prazo conta a partir daqui, não da carga:
    // na TV a página fica ocupada montando antes do init, e isso não pode virar um idb-timeout falso.
    function ready() {
        start();
        if (settled) return settled;
        var asked = now();
        settled = new Promise(function (resolve) {
            var finished = false;
            var finish = function (r) {
                if (finished) return;
                finished = true;
                resolve(r);
            };
            var t = setTimeout(function () { finish(giveUp(timedOut())); }, timeoutMs);
            work.then(function (o) {
                clearTimeout(t);
                finish(o.error ? giveUp(o.error) : o.ok);
            });
        }).then(function (r) {
            r.ms = Math.round(now() - t0);
            r.waitedMs = Math.round(now() - asked);
            status.result = r;
            return r;
        });
        return settled;
    }

    // ---- espelho das escritas ----
    function schedule(ms) {
        if (holding || broken || timer) return;
        timer = setTimeout(flush, ms);
    }
    function track(key) {
        if (isInternal(key) || broken || aborted) return;
        dirty[key] = 1;
        schedule(flushMs);
    }
    function flush() {
        clearTimeout(timer);
        timer = null;
        if (holding || broken) return Promise.resolve();
        var snapshot = snapshotPending, batch = dirty;
        var keys = Object.keys(batch);
        if (snapshot) {
            // Todas as chaves de agora, mais as removidas pelo removeItem desde o boot.
            keys = lsAppKeys().concat(keys.filter(function (k) { return lsGet(k) === null; }));
        }
        if (!keys.length && !snapshot) return Promise.resolve();
        dirty = {};
        snapshotPending = false;
        var t0 = now(), replaced = false;
        return tx('readwrite', function (kv, meta) {
            var m = meta.get('meta');
            m.onsuccess = function () {
                var cur = m.result;
                var same = !!(cur && cur.appId === appId && cur.state === 'valid' && cur.epoch);
                if (same) epoch = cur.epoch;
                else if (!epoch) epoch = newEpoch();
                // A cópia nunca perde uma chave só porque ela falta no localStorage: ele pode ter perdido
                // dados (corte de energia, uma chave que não coube na restauração, uma sessão que começou
                // sem a cópia) e a cópia é o único lugar que os tem. Ela só perde chaves por remoção
                // rastreada (removeItem espelhado), "Limpar dados", wipe() ou initFailed(). A única
                // limpeza é quando ela não é uma cópia válida deste app.
                if (snapshot && !same) {
                    kv.clear();
                    replaced = true;
                }
                // keys = as do localStorage agora + as marcadas pelo removeItem: uma chave sem valor aqui
                // só pode ser uma remoção rastreada.
                keys.forEach(function (k) {
                    var v = lsGet(k);               // o valor mais recente, não o do momento da escrita
                    if (v === null) kv['delete'](k); else kv.put(v, k);
                });
                // Só roda depois de o init dar certo: a restauração, se houve, está confirmada.
                meta.put(metaRecord(false), 'meta');
            };
        }).then(function () {
            stampEpoch();
            status.flushes++;
            status.lastFlush = { at: new Date(now()).toISOString(), keys: keys.length, snapshot: snapshot, replaced: replaced, ms: Math.round(now() - t0) };
        }, function (e) {
            status.error = errorText(e);
            Object.keys(batch).forEach(function (k) { dirty[k] = 1; });
            if (snapshot) snapshotPending = true;
        });
    }
    function onClear() {
        // O reload() do botão "Limpar dados" vem logo depois: o marcador tem que ser síncrono.
        try { if (ss) ss.setItem(NO_RESTORE_KEY, '1'); } catch (e) { /* sem sessionStorage */ }
        lsSet(NO_RESTORE_KEY, '1');
        if (!broken) wipe().then(null, function () { /* o marcador já garante o resultado */ });
    }
    var installed = false;
    function install() {
        if (installed || !orig) return;
        installed = true;
        proto.setItem = function (key, value) {
            orig.setItem.call(this, key, value);
            if (this === ls) track(String(key));
        };
        proto.removeItem = function (key) {
            orig.removeItem.call(this, key);
            if (this === ls) track(String(key));
        };
        proto.clear = function () {
            orig.clear.call(this);
            if (this === ls) onClear();
        };
        if (events && events.addEventListener) events.addEventListener('pagehide', flush);
        if (doc && doc.addEventListener) {
            doc.addEventListener('visibilitychange', function () { if (doc.hidden) flush(); });
        }
    }

    // ---- depois do init do core ----
    function confirm() {
        return tx('readwrite', function (kv, meta) {
            var m = meta.get('meta');
            m.onsuccess = function () {
                var cur = m.result;
                if (cur && cur.pendingRestore) {
                    cur.pendingRestore = false;
                    meta.put(cur, 'meta');
                }
            };
        });
    }
    function initSucceeded() {
        if (broken) return Promise.resolve();
        holding = false;
        snapshotPending = true;
        var confirmed = confirm().then(null, function (e) { status.error = errorText(e); });
        schedule(settleMs);
        return confirmed;
    }
    function initFailed() {
        // Restaurou e o init falhou: a cópia é o estado ruim, não restaurar de novo.
        if (!restoredThisBoot || broken) return Promise.resolve();
        return wipe().then(null, function (e) { status.error = errorText(e); });
    }

    // Só leitura, para diagnóstico (F3.6) e sondas: o meta e o tamanho de cada chave da cópia.
    function inspect() {
        return tx('readonly', function (kv, meta) {
            var out = { meta: null, keys: {}, chars: 0 };
            var m = meta.get('meta');
            m.onsuccess = function () { out.meta = m.result || null; };
            kv.openCursor().onsuccess = function (ev) {
                var cursor = ev.target.result;
                if (cursor) {
                    out.keys[cursor.key] = String(cursor.value).length;
                    out.chars += String(cursor.value).length;
                    cursor['continue']();
                }
            };
            return out;
        });
    }

    function getStatus() {
        var s = JSON.parse(JSON.stringify(status));
        s.broken = broken;
        s.holding = holding;
        s.pending = Object.keys(dirty).length;
        return s;
    }

    return {
        start: start,
        ready: ready,
        initSucceeded: initSucceeded,
        initFailed: initFailed,
        flush: flush,
        wipe: wipe,
        inspect: inspect,
        getStatus: getStatus,
        dbName: dbName
    };
}

module.exports = {
    createMirror: createMirror,
    EPOCH_KEY: EPOCH_KEY,
    NO_RESTORE_KEY: NO_RESTORE_KEY,
    SKIPPED_KEY: SKIPPED_KEY,
    ESSENTIAL_KEYS: ESSENTIAL_KEYS,
    DB_PREFIX: DB_PREFIX
};
