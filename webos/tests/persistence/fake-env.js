// Ambiente falso para os testes do espelho (webos/persistence/mirror.js): um IndexedDB em memória
// (assíncrono, com transações que só valem no commit) e um "disco" que sobrevive a recarregar,
// reabrir e reinstalar o app, como no emulador.
//
//   const disk = createDisk();
//   const page = openPage(disk);   // uma carga da página: Storage novo (protótipo próprio), mirror novo
//   disk.reopen();                 // fechar e abrir o app: o sessionStorage some
//   disk.reinstall();              // desinstalar + reinstalar: o localStorage some, o IndexedDB fica
//   disk.idb.mode = 'fail' | 'hang' | 'ok'; disk.idb.openDelay = ms; disk.idb.failTx = true

const { createMirror } = require('../../persistence/mirror');

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

function createFakeIndexedDB() {
    const databases = new Map();   // nome -> { version, stores: { kv: Map, meta: Map } }
    const fake = { mode: 'ok', openDelay: 0, failTx: false, opens: 0, databases };

    function request() {
        return { result: undefined, error: null, onsuccess: null, onerror: null };
    }

    function makeDb(name) {
        const entry = databases.get(name);
        return {
            get version() { return entry.version; },
            objectStoreNames: { contains: (store) => Object.prototype.hasOwnProperty.call(entry.stores, store) },
            close() {},
            createObjectStore(store) {
                entry.stores[store] = new Map();
            },
            transaction(names, mode) {
                if (fake.failTx) throw Object.assign(new Error('falha simulada'), { name: 'UnknownError' });
                // Trabalha numa cópia e só grava no "disco" no commit.
                const work = {};
                Object.keys(entry.stores).forEach((s) => { work[s] = new Map(entry.stores[s]); });
                const queue = [];
                let finished = false;
                const t = { oncomplete: null, onerror: null, onabort: null, error: null };
                const run = () => {
                    if (finished) return;
                    if (queue.length) {
                        const op = queue.shift();
                        try {
                            op();
                        } catch (e) {
                            finished = true;
                            t.error = e;
                            if (t.onabort) t.onabort();
                            return;
                        }
                        setTimeout(run, 0);
                        return;
                    }
                    finished = true;
                    Object.keys(work).forEach((s) => { entry.stores[s] = work[s]; });
                    if (t.oncomplete) t.oncomplete();
                };
                const enqueue = (fn) => {
                    const req = request();
                    queue.push(() => {
                        req.result = fn();
                        if (req.onsuccess) req.onsuccess({ target: req });
                    });
                    return req;
                };
                const readonly = mode !== 'readwrite';
                const write = (fn) => () => {
                    if (readonly) throw Object.assign(new Error('ReadOnlyError'), { name: 'ReadOnlyError' });
                    return fn();
                };
                t.objectStore = (s) => {
                    if (!names.includes(s)) throw new Error(`store fora da transação: ${s}`);
                    const map = work[s];
                    return {
                        get: (k) => enqueue(() => map.get(k)),
                        count: () => enqueue(() => map.size),
                        put: (v, k) => enqueue(write(() => { map.set(k, v); return k; })),
                        delete: (k) => enqueue(write(() => { map.delete(k); })),
                        clear: () => enqueue(write(() => { map.clear(); })),
                        openCursor: () => {
                            const req = request();
                            const keys = [...map.keys()].sort();
                            let i = 0;
                            const step = () => {
                                const k = keys[i];
                                req.result = i < keys.length
                                    ? { key: k, value: map.get(k), continue: () => { i++; queue.push(step); } }
                                    : null;
                                if (req.onsuccess) req.onsuccess({ target: req });
                            };
                            queue.push(step);
                            return req;
                        },
                    };
                };
                t.abort = () => {
                    finished = true;
                    if (t.onabort) setTimeout(() => t.onabort(), 0);
                };
                setTimeout(run, 0);
                return t;
            },
        };
    }

    fake.open = (name, version) => {
        fake.opens++;
        const req = request();
        req.onupgradeneeded = null;
        req.onblocked = null;
        if (fake.mode === 'hang') return req;
        setTimeout(() => {
            if (fake.mode === 'fail') {
                req.error = new Error('open falhou (simulado)');
                if (req.onerror) req.onerror();
                return;
            }
            if (!databases.has(name)) databases.set(name, { version: 0, stores: {} });
            const entry = databases.get(name);
            const target = version || entry.version || 1;
            if (target < entry.version) {
                req.error = Object.assign(new Error('VersionError'), { name: 'VersionError' });
                if (req.onerror) req.onerror();
                return;
            }
            req.result = makeDb(name);
            if (target > entry.version) {
                entry.version = target;
                if (req.onupgradeneeded) req.onupgradeneeded();
            }
            setTimeout(() => { if (req.onsuccess) req.onsuccess(); }, fake.openDelay);
        }, 0);
        return req;
    };

    // Leitura direta do "disco", para as verificações.
    fake.dump = (name) => {
        const entry = databases.get(name);
        if (!entry) return { kv: {}, meta: null };
        return {
            kv: Object.fromEntries(entry.stores.kv || []),
            meta: (entry.stores.meta && entry.stores.meta.get('meta')) || null,
        };
    };
    return fake;
}

// Um Storage com protótipo próprio por página: o mirror embrulha o protótipo, como no navegador.
function makeStorageClass() {
    class FakeStorage {
        constructor(data) {
            Object.defineProperty(this, '_d', { value: data });
        }
        get length() { return this._d.size; }
        key(i) { return [...this._d.keys()][i] ?? null; }
        getItem(k) { return this._d.has(String(k)) ? this._d.get(String(k)) : null; }
        setItem(k, v) { this._d.set(String(k), String(v)); }
        removeItem(k) { this._d.delete(String(k)); }
        clear() { this._d.clear(); }
    }
    return FakeStorage;
}

function createDisk() {
    const disk = {
        local: new Map(),
        session: new Map(),
        idb: createFakeIndexedDB(),
        reopen() { disk.session = new Map(); },
        reinstall() { disk.local = new Map(); disk.session = new Map(); },
    };
    return disk;
}

const APP_ID = 'io.github.gabrielsflores.stremio';
const TIMINGS = { timeoutMs: 120, flushMs: 15, settleMs: 25 };

function listeners() {
    const map = {};
    return {
        hidden: false,
        addEventListener: (name, fn) => { (map[name] = map[name] || []).push(fn); },
        fire: (name) => (map[name] || []).forEach((fn) => fn()),
    };
}

function openPage(disk, options = {}) {
    const Storage = makeStorageClass();
    const localStorage = new Storage(disk.local);
    const sessionStorage = new Storage(disk.session);
    const events = listeners();
    const doc = listeners();
    const mirror = createMirror({
        appId: APP_ID,
        localStorage,
        sessionStorage,
        indexedDB: disk.idb,
        storageProto: Storage.prototype,
        events,
        document: doc,
        ...TIMINGS,
        ...options,
    });
    const page = { mirror, localStorage, sessionStorage, events, doc, dbName: mirror.dbName };
    // O fluxo do createTransport.webos.js: start() -> init do core -> initSucceeded/initFailed.
    // core(ls) simula o init; lança para simular a falha.
    page.boot = async (core = defaultCore) => {
        mirror.start();
        const result = await mirror.ready();
        page.result = result;
        try {
            await core(localStorage);
        } catch (e) {
            page.initError = e;
            await mirror.initFailed();
            return result;
        }
        await mirror.initSucceeded();
        return result;
    };
    page.copy = () => disk.idb.dump(mirror.dbName);
    page.ls = () => {
        const out = {};
        for (let i = 0; i < localStorage.length; i++) out[localStorage.key(i)] = localStorage.getItem(localStorage.key(i));
        return out;
    };
    // Espera o snapshot adiado e os lotes.
    page.settle = () => tick(TIMINGS.settleMs + TIMINGS.flushMs + 40);
    return page;
}

// O init do core 0.65.0 num localStorage vazio só grava schema_version (a migração).
function defaultCore(ls) {
    if (ls.getItem('schema_version') === null) ls.setItem('schema_version', '15');
}

function failingCore() {
    throw new Error('StorageSchemaVersionUpgrade (simulado)');
}

module.exports = { createDisk, openPage, tick, defaultCore, failingCore, APP_ID, TIMINGS };
