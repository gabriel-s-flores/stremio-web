// Lógica do espelho do localStorage no IndexedDB (F3.5, webos/persistence/mirror.js), com um
// IndexedDB falso e os timers falsos do jest (o tempo só anda quando o teste manda: nada depende do
// relógio real nem da carga do host). Os casos B* são os do break.sh do revisor da F0.8 (revisões
// c1–c3); os M*, os do mirror-test.sh do spike (webos/spikes/persistence); os R*, os achados da
// revisão F3.5 c1.

const { createDisk, openPage, tick, useFakeClock, failingCore, APP_ID, TIMINGS } = require('./fake-env');
const { EPOCH_KEY, NO_RESTORE_KEY, SKIPPED_KEY, DB_PREFIX } = require('../../persistence/mirror');

const USER_STATE = {
    schema_version: '15',
    profile: '{"addons":["torrentio-debrid"],"settings":{"interfaceLanguage":"por"}}',
    library: 'BIBLIOTECA_DO_USUARIO',
    library_recent: 'RECENTES',
    installation_id: 'inst-1',
    'webos.coreVariant': 'wasm',
};

// O usuário usou o app: estado gravado pelo core depois do init, já espelhado.
async function seed(disk, state = USER_STATE) {
    const page = openPage(disk);
    await page.boot((ls) => {
        Object.keys(state).forEach((k) => ls.setItem(k, state[k]));
    });
    await page.settle();
    return page;
}

const appKeys = (obj) => Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith('stremio_webos_persist_')));

describe('webos persistence mirror', () => {
    useFakeClock();

    test('the database name carries the app id', () => {
        const page = openPage(createDisk());
        expect(page.dbName).toBe(`${DB_PREFIX}${APP_ID}`);
    });

    test('first install: nothing to restore, the copy follows localStorage after init', async () => {
        const disk = createDisk();
        const page = openPage(disk);
        const r = await page.boot();
        expect(r).toMatchObject({ restored: false, reason: 'nothing-to-restore' });
        await page.settle();
        const copy = page.copy();
        expect(copy.kv).toEqual({ schema_version: '15' });
        expect(copy.meta).toMatchObject({ appId: APP_ID, state: 'valid', pendingRestore: false });
        expect(page.localStorage.getItem(EPOCH_KEY)).toBe(copy.meta.epoch);
    });

    test('usual boot (essential keys present) resolves at once, without opening IndexedDB', async () => {
        const disk = createDisk();
        await seed(disk);
        disk.reopen();
        const opensBefore = disk.idb.opens;
        const page = openPage(disk);
        const r = await page.ready();
        expect(r).toMatchObject({ restored: false, reason: 'localStorage-ok', fast: true, keys: 6, waitedMs: 0 });
        expect(disk.idb.opens).toBe(opensBefore);
    });

    test('a guest that never changed anything (no profile) boots fast once its storage is linked to a copy', async () => {
        const disk = createDisk();
        const first = openPage(disk);
        expect((await first.boot()).reason).toBe('nothing-to-restore');
        await first.settle();
        expect(first.localStorage.getItem(EPOCH_KEY)).not.toBeNull();
        disk.reopen();
        const opensBefore = disk.idb.opens;
        const page = openPage(disk);
        const r = await page.ready();
        expect(r).toMatchObject({ reason: 'localStorage-ok', fast: true, keys: 1, waitedMs: 0 });
        expect(disk.idb.opens).toBe(opensBefore);
    });

    test('the epoch key alone does not count: an otherwise empty localStorage is restored', async () => {
        const disk = createDisk();
        const page0 = await seed(disk);
        const epoch = page0.localStorage.getItem(EPOCH_KEY);
        disk.reinstall();
        disk.local.set(EPOCH_KEY, epoch);
        expect((await openPage(disk).boot()).reason).toBe('restored');
    });

    test('the timeout counts from ready(), not from start(): a busy page before init is no idb-timeout', async () => {
        const disk = createDisk();
        await seed(disk);
        disk.reinstall();
        disk.idb.openDelay = TIMINGS.timeoutMs + 40;
        const page = openPage(disk);
        page.mirror.start();
        await tick(TIMINGS.timeoutMs * 2);          // a página montando, antes do init
        const r = await page.ready();
        expect(r).toMatchObject({ restored: true, reason: 'restored', ms: TIMINGS.timeoutMs * 2 });
        expect(r.waitedMs).toBeLessThan(TIMINGS.timeoutMs);
    });

    test('a hung IndexedDB makes init wait exactly timeoutMs from ready(), whatever happened before', async () => {
        const disk = createDisk();
        disk.idb.mode = 'hang';
        const page = openPage(disk);
        page.mirror.start();
        await tick(TIMINGS.timeoutMs * 2);
        expect(page.mirror.getStatus().result).toBeNull();
        const r = await page.ready();
        expect(r).toMatchObject({ reason: 'idb-timeout', waitedMs: TIMINGS.timeoutMs, ms: TIMINGS.timeoutMs * 3 });
    });

    test('all localStorage keys are mirrored (webos.coreVariant included), our own keys are not', async () => {
        const disk = createDisk();
        const page = await seed(disk);
        const copy = page.copy();
        expect(copy.kv).toEqual(USER_STATE);
        expect(Object.keys(copy.kv).some((k) => k.startsWith('stremio_webos_persist_'))).toBe(false);
    });

    test('R6 #22: a write to one of our own keys is not tracked nor mirrored', async () => {
        const disk = createDisk();
        const page = await seed(disk);
        page.localStorage.setItem('stremio_webos_persist_qualquer', 'x');
        page.localStorage.setItem(SKIPPED_KEY, '1');
        expect(page.mirror.getStatus().pending).toBe(0);
        await tick(TIMINGS.flushMs * 3);
        expect(Object.keys(page.copy().kv).some((k) => k.startsWith('stremio_webos_persist_'))).toBe(false);
    });

    test('nothing reaches IndexedDB before the core init succeeds; then writes go in batches', async () => {
        const disk = createDisk();
        const page = openPage(disk);
        let release;
        const booting = page.run((async () => {
            page.mirror.start();
            await page.mirror.ready();
            page.localStorage.setItem('schema_version', '15');
            page.localStorage.setItem('profile', 'P1');
            await new Promise((resolve) => { release = resolve; });
            await page.mirror.initSucceeded();
        })());
        await tick(TIMINGS.settleMs * 3);
        expect(page.copy().kv).toEqual({});
        release();
        await booting;
        await page.settle();
        expect(page.copy().kv).toEqual({ schema_version: '15', profile: 'P1' });

        const flushes = page.mirror.getStatus().flushes;
        page.localStorage.setItem('profile', 'P2');
        page.localStorage.setItem('profile', 'P3');
        page.localStorage.setItem('library', 'L1');
        page.localStorage.removeItem('schema_version');
        expect(page.copy().kv.profile).toBe('P1');
        await tick(TIMINGS.flushMs + 50);
        expect(page.copy().kv).toEqual({ profile: 'P3', library: 'L1' });
        expect(page.mirror.getStatus().flushes).toBe(flushes + 1);
    });

    test('R6 #20: the snapshot after init waits settleMs, then runs', async () => {
        const disk = createDisk();
        const page = openPage(disk);
        await page.boot((ls) => { ls.setItem('schema_version', '15'); });
        await tick(TIMINGS.settleMs - 1);
        expect(page.copy().kv).toEqual({});
        await tick(50);
        expect(page.copy().kv).toEqual({ schema_version: '15' });
    });

    test('pagehide and visibilitychange flush at once', async () => {
        const disk = createDisk();
        await seed(disk);
        disk.reopen();
        const page = openPage(disk, { flushMs: 60000 });   // só o evento explica a gravação
        await page.boot();
        await page.settle();
        page.localStorage.setItem('library', 'NOVA');
        page.events.fire('pagehide');
        await tick(40);
        expect(page.copy().kv.library).toBe('NOVA');
        page.localStorage.setItem('library', 'OUTRA');
        page.doc.fire('visibilitychange');                  // visível: não grava
        await tick(40);
        expect(page.copy().kv.library).toBe('NOVA');
        page.doc.hidden = true;
        page.doc.fire('visibilitychange');
        await tick(40);
        expect(page.copy().kv.library).toBe('OUTRA');
    });

    test('update and reboot keep localStorage: the copy is not used (localStorage-ok)', async () => {
        const disk = createDisk();
        await seed(disk);
        disk.reopen();
        const page = openPage(disk);
        const r = await page.boot();
        expect(r.reason).toBe('localStorage-ok');
        expect(appKeys(page.ls())).toEqual(USER_STATE);
    });

    test('uninstall + reinstall: restores addons, settings, library and the core variant', async () => {
        const disk = createDisk();
        await seed(disk);
        disk.reinstall();
        const page = openPage(disk);
        const r = await page.ready();
        expect(r).toMatchObject({ restored: true, reason: 'restored', keys: 6 });
        expect(appKeys(page.ls())).toEqual(USER_STATE);
        expect(page.copy().meta.pendingRestore).toBe(true);
        await page.run(page.mirror.initSucceeded());
        expect(page.copy().meta.pendingRestore).toBe(false);
    });

    test('M7: partial localStorage without the essential keys is merged, never overwritten', async () => {
        const disk = createDisk();
        await seed(disk);
        disk.reinstall();
        disk.local.set('library', 'BIBLIOTECA_LOCAL');
        const page = openPage(disk);
        const r = await page.boot();
        expect(r).toMatchObject({ restored: true, reason: 'merged', keys: 5 });
        expect(page.localStorage.getItem('library')).toBe('BIBLIOTECA_LOCAL');
        expect(page.localStorage.getItem('profile')).toBe(USER_STATE.profile);
    });

    test('M8 / R3 (E2): essential keys from another epoch are the truth; the copy keeps what they lack, for good', async () => {
        const disk = createDisk();
        await seed(disk);
        disk.reinstall();
        disk.local.set('schema_version', '15');
        disk.local.set('profile', 'PERFIL_NOVO');
        const page = openPage(disk);
        expect((await page.boot()).reason).toBe('localStorage-ok');
        await page.settle();
        expect(page.copy().kv).toMatchObject({ profile: 'PERFIL_NOVO', library: 'BIBLIOTECA_DO_USUARIO' });
        // Boots seguintes (agora com a mesma época): a biblioteca continua na cópia.
        for (let i = 0; i < 2; i++) {
            disk.reopen();
            const next = openPage(disk);
            expect((await next.boot()).reason).toBe('localStorage-ok');
            await next.settle();
            expect(next.copy().kv.library).toBe('BIBLIOTECA_DO_USUARIO');
        }
    });

    test('R3 (E1): same epoch, localStorage lost the profile and the library -> the copy keeps them', async () => {
        const disk = createDisk();
        await seed(disk);
        disk.local.delete('profile');                 // perda parcial (ex.: corte de energia)
        disk.local.delete('library');
        disk.reopen();
        const page = openPage(disk);
        const r = await page.boot();
        expect(r).toMatchObject({ reason: 'localStorage-ok', fast: true });
        await page.settle();
        expect(page.copy().kv).toMatchObject({ profile: USER_STATE.profile, library: 'BIBLIOTECA_DO_USUARIO' });
        // E se o localStorage sumir depois, a restauração traz tudo de volta.
        disk.reinstall();
        const again = openPage(disk);
        expect((await again.boot()).reason).toBe('restored');
        expect(appKeys(again.ls())).toEqual(USER_STATE);
    });

    test('a key the core removes (removeItem) is removed from the copy too', async () => {
        const disk = createDisk();
        const page = await seed(disk);
        page.localStorage.removeItem('library_recent');
        await tick(TIMINGS.flushMs + 50);
        expect(page.copy().kv.library_recent).toBeUndefined();
        // ...também quando a remoção acontece antes do snapshot adiado.
        disk.reopen();
        const next = openPage(disk);
        await next.boot((ls) => { ls.removeItem('library'); });
        await next.settle();
        expect(next.copy().kv.library).toBeUndefined();
        expect(next.copy().kv.profile).toBe(USER_STATE.profile);
    });

    test('R4 (E3): a key that does not fit during a restore stays in the copy', async () => {
        const disk = createDisk();
        await seed(disk);
        disk.reinstall();
        disk.rejectKeys.add('library');
        const page = openPage(disk);
        const r = await page.boot();
        expect(r).toMatchObject({ restored: true, reason: 'restored', keys: 5, failed: 1 });
        expect(page.localStorage.getItem('library')).toBeNull();
        await page.settle();
        expect(page.copy().kv.library).toBe('BIBLIOTECA_DO_USUARIO');
        disk.reopen();
        const next = openPage(disk);
        await next.boot();
        await next.settle();
        expect(next.copy().kv.library).toBe('BIBLIOTECA_DO_USUARIO');
        // Quando couber de novo, uma reinstalação a traz de volta.
        disk.rejectKeys.clear();
        disk.reinstall();
        const later = openPage(disk);
        await later.boot();
        expect(later.localStorage.getItem('library')).toBe('BIBLIOTECA_DO_USUARIO');
    });

    test('a copy written by another app id is dropped (app-mismatch)', async () => {
        const disk = createDisk();
        const page0 = await seed(disk);
        const db = disk.idb.databases.get(page0.dbName);
        db.stores.meta.set('meta', { ...db.stores.meta.get('meta'), appId: 'outro.app' });
        disk.reinstall();
        const page = openPage(disk);
        const r = await page.boot();
        expect(r.reason).toBe('app-mismatch');
        expect(page.localStorage.getItem('profile')).toBeNull();
        await page.settle();
        expect(page.copy().kv).toEqual({ schema_version: '15' });
        expect(page.copy().meta.appId).toBe(APP_ID);
    });

    describe('"Clear data" (Error.tsx: localStorage.clear() and reload() in the same handler)', () => {
        test('the reload does not restore and the copy is wiped (clear-data)', async () => {
            const disk = createDisk();
            const page = await seed(disk);
            page.localStorage.clear();
            expect(page.sessionStorage.getItem(NO_RESTORE_KEY)).toBe('1');
            const reloaded = openPage(disk);           // reload(): mesmo sessionStorage
            const r = await reloaded.boot();
            expect(r).toMatchObject({ restored: false, reason: 'clear-data' });
            expect(appKeys(reloaded.ls())).toEqual({ schema_version: '15' });
            expect(reloaded.localStorage.getItem(NO_RESTORE_KEY)).toBeNull();
            expect(reloaded.sessionStorage.getItem(NO_RESTORE_KEY)).toBeNull();
            await reloaded.settle();
            expect(reloaded.copy().kv).toEqual({ schema_version: '15' });
        });

        test('control: the same reload without the marker WOULD restore the bad state', async () => {
            const disk = createDisk();
            await seed(disk);
            disk.local.clear();                        // clear() que não passa pelo espelho
            const r = await openPage(disk).boot();
            expect(r.reason).toBe('restored');
        });

        test('the marker survives closing the app before the reload, and a hung IndexedDB', async () => {
            const disk = createDisk();
            const page = await seed(disk);
            disk.idb.mode = 'hang';
            page.localStorage.clear();                  // a limpeza assíncrona da cópia nunca termina
            disk.reopen();                              // sessionStorage perdido
            const stuck = openPage(disk);
            const r1 = await stuck.boot();
            expect(r1.reason).toBe('idb-timeout');
            expect(stuck.localStorage.getItem(SKIPPED_KEY)).toBeNull();
            disk.idb.mode = 'ok';
            disk.reopen();
            const page2 = openPage(disk);
            const r2 = await page2.boot();
            expect(r2.reason).toBe('clear-data');
            expect(page2.localStorage.getItem('library')).toBeNull();
        });
    });

    test('B4: init fails right after a restore -> the copy is dropped; Clear data; reinstall is clean', async () => {
        const disk = createDisk();
        await seed(disk);
        disk.reinstall();
        const page = openPage(disk);
        const r = await page.boot(failingCore);
        expect(r.reason).toBe('restored');
        expect(page.initError).toBeDefined();
        expect(page.copy().kv).toEqual({});
        page.localStorage.clear();
        expect((await openPage(disk).boot()).reason).toBe('clear-data');
        disk.reinstall();
        expect((await openPage(disk).boot()).reason).toBe('nothing-to-restore');
    });

    test('B4b: init fails on a boot without restore -> copy kept; Clear data breaks the loop', async () => {
        const disk = createDisk();
        await seed(disk);
        disk.reopen();
        const page = openPage(disk);
        const r = await page.boot(failingCore);
        expect(r.reason).toBe('localStorage-ok');
        expect(page.copy().kv.library).toBe('BIBLIOTECA_DO_USUARIO');
        page.localStorage.clear();
        const reloaded = openPage(disk);
        expect((await reloaded.boot()).reason).toBe('clear-data');
        disk.reinstall();
        expect((await openPage(disk).boot()).reason).toBe('nothing-to-restore');
    });

    test('B1: pendingRestore survives reopening before init confirms; the next loss does not restore again', async () => {
        const disk = createDisk();
        await seed(disk);
        disk.reinstall();
        const page = openPage(disk);
        expect((await page.ready()).reason).toBe('restored');   // o app fecha antes do init terminar
        disk.reopen();
        const reopened = openPage(disk);
        expect((await reopened.ready()).reason).toBe('localStorage-ok');
        expect(reopened.copy().meta.pendingRestore).toBe(true);
        disk.reinstall();                                        // perde o localStorage de novo
        const r = await openPage(disk).boot();
        expect(r).toMatchObject({ restored: false, reason: 'unconfirmed-restore' });
    });

    test('B5: IndexedDB open fails -> idb-error, the core still starts, the mirror stays off', async () => {
        const disk = createDisk();
        disk.idb.mode = 'fail';
        const page = openPage(disk);
        let coreRan = false;
        const r = await page.boot((ls) => { coreRan = true; ls.setItem('schema_version', '15'); });
        expect(r).toMatchObject({ restored: false, reason: 'idb-error' });
        expect(coreRan).toBe(true);
        expect(page.mirror.getStatus().broken).toBe(true);
        disk.idb.mode = 'ok';
        page.localStorage.setItem('profile', 'X');
        await page.settle();
        expect(disk.idb.databases.size).toBe(0);
        // A promessa rejeitada do open não fica guardada: uma nova tentativa na mesma página abre.
        await expect(page.run(page.mirror.wipe())).resolves.toBeUndefined();
    });

    test('B5b: IndexedDB open never answers -> idb-timeout, init waits exactly timeoutMs', async () => {
        const disk = createDisk();
        disk.idb.mode = 'hang';
        const page = openPage(disk);
        const r = await page.boot();
        expect(r).toMatchObject({ reason: 'idb-timeout', waitedMs: TIMINGS.timeoutMs });
    });

    test('B5c/B6: slow IndexedDB during a restore, profile changed in that session -> the library is not lost', async () => {
        const disk = createDisk();
        await seed(disk);
        disk.reinstall();
        disk.idb.openDelay = TIMINGS.timeoutMs + 60;
        const page = openPage(disk);
        // O init roda com o localStorage vazio; nessa sessão o core grava um perfil novo.
        const r = await page.boot((ls) => {
            ls.setItem('schema_version', '15');
            ls.setItem('profile', 'PERFIL_NOVO');
        });
        expect(r.reason).toBe('idb-timeout');
        expect(page.localStorage.getItem(SKIPPED_KEY)).toBe('1');
        await tick(200);
        // B5c: a restauração tardia não mexeu no localStorage e a cópia boa continua lá.
        expect(page.localStorage.getItem('library')).toBeNull();
        expect(page.copy().kv.library).toBe('BIBLIOTECA_DO_USUARIO');
        expect(page.copy().meta.pendingRestore).toBe(false);
        await page.settle();
        expect(page.copy().kv.profile).toBe(USER_STATE.profile);       // o espelho ficou desligado

        disk.idb.openDelay = 0;
        disk.reopen();
        const boot1 = openPage(disk);
        const r1 = await boot1.boot();
        expect(r1).toMatchObject({ restored: true, reason: 'restored-after-skip' });
        expect(appKeys(boot1.ls())).toEqual(USER_STATE);
        expect(boot1.localStorage.getItem(SKIPPED_KEY)).toBeNull();
        await boot1.settle();

        disk.reopen();
        const boot2 = openPage(disk);
        expect((await boot2.boot()).reason).toBe('localStorage-ok');
        await boot2.settle();
        expect(boot2.localStorage.getItem('library')).toBe('BIBLIOTECA_DO_USUARIO');
        expect(boot2.copy().kv.library).toBe('BIBLIOTECA_DO_USUARIO');
    });

    test('R2: the timeout expires while the pendingRestore write is in flight -> localStorage untouched, mark undone', async () => {
        const disk = createDisk();
        await seed(disk);
        disk.reinstall();
        disk.idb.commitDelay = TIMINGS.timeoutMs + 50;   // abrir e ler são rápidos; gravar demora
        const page = openPage(disk);
        const r = await page.boot((ls) => { ls.setItem('schema_version', '15'); });
        expect(r.reason).toBe('idb-timeout');
        await tick((TIMINGS.timeoutMs + 50) * 3);       // a marca commita, e depois a reversão
        expect(page.copy().meta.pendingRestore).toBe(false);
        expect(appKeys(page.ls())).toEqual({ schema_version: '15' });
        expect(page.localStorage.getItem(EPOCH_KEY)).toBeNull();
        expect(page.copy().kv.library).toBe('BIBLIOTECA_DO_USUARIO');
    });

    test('R5 (E5): skipped marker + an undone-too-late pendingRestore -> restored-after-skip, the copy is kept', async () => {
        const disk = createDisk();
        const page0 = await seed(disk);
        // O estado em que a janela do achado 5 deixa o app: o prazo venceu com a marca pendingRestore em
        // voo, o app fechou antes da reversão; o core rodou sem a cópia e gravou um estado novo.
        const db = disk.idb.databases.get(page0.dbName);
        db.stores.meta.set('meta', { ...db.stores.meta.get('meta'), pendingRestore: true });
        disk.reinstall();
        disk.local.set('schema_version', '15');
        disk.local.set('profile', 'PERFIL_DA_SESSAO_PULADA');
        disk.local.set(SKIPPED_KEY, '1');
        const page = openPage(disk);
        const r = await page.boot();
        expect(r).toMatchObject({ restored: true, reason: 'restored-after-skip' });
        expect(appKeys(page.ls())).toEqual(USER_STATE);
        await page.settle();
        expect(page.copy().meta.pendingRestore).toBe(false);
        expect(page.copy().kv.library).toBe('BIBLIOTECA_DO_USUARIO');
    });

    test('timeout on a first install leaves no bad marker: the next boot keeps what the session wrote', async () => {
        const disk = createDisk();
        disk.idb.mode = 'hang';
        const page = openPage(disk);
        expect((await page.boot()).reason).toBe('idb-timeout');
        disk.idb.mode = 'ok';
        disk.reopen();
        const next = openPage(disk);
        expect((await next.boot()).reason).toBe('localStorage-ok');
        expect(next.localStorage.getItem('schema_version')).toBe('15');
        expect(next.localStorage.getItem(SKIPPED_KEY)).toBeNull();
    });

    test('resetMirror drops the copy and keeps localStorage', async () => {
        const disk = createDisk();
        await seed(disk);
        disk.reopen();
        const page = openPage(disk, { reset: true });
        const r = await page.ready();
        expect(r.reason).toBe('reset');
        expect(page.copy().kv).toEqual({});
        expect(appKeys(page.ls())).toEqual(USER_STATE);
    });

    test('a failed batch is retried with the next one', async () => {
        const disk = createDisk();
        const page = await seed(disk);
        disk.idb.failTx = true;
        page.localStorage.setItem('library', 'L2');
        await tick(TIMINGS.flushMs + 50);
        expect(page.mirror.getStatus().error).toMatch(/falha simulada/);
        disk.idb.failTx = false;
        page.localStorage.setItem('profile', 'P2');
        await tick(TIMINGS.flushMs + 50);
        expect(page.copy().kv).toMatchObject({ library: 'L2', profile: 'P2' });
    });

    test('a database created by someone else without the stores is repaired, not left broken', async () => {
        const disk = createDisk();
        const name = openPage(disk).dbName;
        // Um indexedDB.open(nome) sem versão, antes do espelho: banco v1 sem stores.
        await openPage(disk).run(new Promise((resolve) => { disk.idb.open(name).onsuccess = resolve; }));
        expect(disk.idb.databases.get(name)).toMatchObject({ version: 1, stores: {} });
        const page = await seed(disk);
        expect(page.mirror.getStatus().broken).toBe(false);
        expect(page.copy().kv).toEqual(USER_STATE);
        expect(disk.idb.databases.get(name).version).toBe(2);
    });

    test('inspect() reports the copy without changing it', async () => {
        const disk = createDisk();
        const page = await seed(disk);
        const info = await page.run(page.mirror.inspect());
        expect(info.meta).toMatchObject({ appId: APP_ID, pendingRestore: false });
        expect(info.keys).toEqual(Object.fromEntries(Object.entries(USER_STATE).map(([k, v]) => [k, v.length])));
    });

    test('R6 #17: only localStorage writes are tracked, not sessionStorage', async () => {
        const disk = createDisk();
        const page = await seed(disk);
        page.sessionStorage.setItem('foo', 'bar');
        expect(page.mirror.getStatus().pending).toBe(0);
        await tick(TIMINGS.flushMs + 50);
        expect(page.copy().kv.foo).toBeUndefined();
    });
});
