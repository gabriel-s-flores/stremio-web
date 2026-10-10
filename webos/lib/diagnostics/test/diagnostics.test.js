const {
    VARIANT_KEY, MEDIA_TYPES, collectDiagnostics, formatReport, getSection, getRequestedVariant, setRequestedVariant,
} = require('..');
const registry = require('../registry');
const { PREFER_KEY } = require('../../../core/loader');

const TV_UA = 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/53.0.2785.34 Safari/537.36 WebAppManager';

const fakeStorage = (initial) => {
    const items = { ...initial };
    return {
        items,
        getItem: (key) => (key in items ? items[key] : null),
        setItem: (key, value) => { items[key] = String(value); },
        removeItem: (key) => { delete items[key]; },
    };
};

// Luna double like the one of the platform tests: answers[method] is { result } | { error } | 'hang'.
const fakeLuna = (answers) => (service, { method, onSuccess, onFailure }) => {
    const answer = answers[method];
    if (!answer || answer === 'hang') return;
    setTimeout(() => (answer.error ? onFailure({ errorText: answer.error }) : onSuccess({ returnValue: true, ...answer.result })), 0);
};

// What the emulator answered: no edidType, "DTS HD".
const EMULATOR_CAPABILITIES = {
    available: true,
    dolbyVision: false,
    dolbyAtmos: false,
    edidType: null,
    dts: 'DTS HD',
    soundModeType: null,
    model: { name: 'WEBOS4.0', firmware: '04.00.00', sdk: '04.00.00', uhd: false },
    missing: ['tv.model.edidType', 'tv.model.soundModeType'],
    errors: [],
};

const CORE_STATUS = {
    ok: true,
    stage: 'ready',
    variant: 'wasm2js',
    reason: 'preferred',
    prefer: 'wasm2js',
    preferSource: 'default',
    preferConfig: null,
    error: null,
    hasWebAssembly: true,
    wasmBytes: null,
    memoryBytes: 33554432,
    timings: { wasm2jsLoadMs: 1200.5, wasm2jsInstantiateMs: 3400 },
};

const makeWindow = (overrides) => ({
    navigator: { userAgent: TV_UA, language: 'en-US', onLine: true, hardwareConcurrency: 2 },
    screen: { width: 1920, height: 1080 },
    devicePixelRatio: 1,
    innerWidth: 1920,
    innerHeight: 1080,
    localStorage: fakeStorage({}),
    performance: {
        now: () => 20000,
        timing: { navigationStart: 1000, domContentLoadedEventEnd: 1800, loadEventEnd: 2500 },
        memory: { usedJSHeapSize: 52428800, totalJSHeapSize: 104857600, jsHeapSizeLimit: 1073741824 },
    },
    document: {
        createElement: () => ({
            canPlayType: (type) => (/avc1|mp4a|ac-3/.test(type) ? 'probably' : /matroska/.test(type) ? 'maybe' : ''),
        }),
    },
    MediaSource: { isTypeSupported: (type) => /avc1/.test(type) },
    WebAssembly: {
        validate: () => true,
        Module: function Module() {},
        Instance: function Instance() {},
        Memory: function Memory() {},
        Table: function Table() {},
        compile: () => Promise.resolve({}),
    },
    ...overrides,
});

const collect = (options) => collectDiagnostics({
    window: makeWindow(),
    app: { version: '5.0.0-beta.41', commit: 'abc1234', coreVersion: '0.65.0-mvp' },
    getCoreStatus: () => Promise.resolve(CORE_STATUS),
    readCapabilities: () => Promise.resolve(EMULATOR_CAPABILITIES),
    request: fakeLuna({ getCurrentMemState: { error: 'denied' } }),
    registry,
    timeoutMs: 50,
    now: () => new Date('2026-10-10T12:00:00Z'),
    ...options,
});

beforeEach(() => registry.reset());

describe('collectDiagnostics', () => {
    it('reports app, environment, core, boot times, WebAssembly, TV, media and memory', async () => {
        registry.mark('coreInitStart', 250.04);
        registry.mark('coreReady', 12000.26);
        registry.mark('boardMounted', 14000);
        registry.mark('boardFirstItem', 26000);
        const readCapabilities = jest.fn(() => Promise.resolve(EMULATOR_CAPABILITIES));
        const report = await collect({ readCapabilities });
        // a fresh Luna read, not the cache of the boot (F3.1)
        expect(readCapabilities).toHaveBeenCalledWith(true);

        expect(report.generatedAt).toBe('2026-10-10T12:00:00.000Z');
        expect(report.sections.map((section) => section.id)).toEqual([
            'app', 'environment', 'core', 'boot', 'webAssembly', 'tv', 'media', 'memory', 'persistence', 'certificateProxy',
        ]);
        expect(getSection(report, 'app')).toEqual({ version: '5.0.0-beta.41', commit: 'abc1234', coreVersion: '0.65.0-mvp' });
        expect(getSection(report, 'environment')).toMatchObject({
            userAgent: TV_UA, chromium: '53.0.2785.34', isWebOS: true, screen: { width: 1920, height: 1080, pixelRatio: 1 },
        });
        expect(getSection(report, 'core')).toMatchObject({
            available: true, variant: 'wasm2js', reason: 'preferred', requested: null, memoryBytes: 33554432,
        });
        expect(getSection(report, 'boot')).toEqual({
            domContentLoadedMs: 800,
            loadMs: 1500,
            coreInitStartMs: 250,
            coreReadyMs: 12000.3,
            boardMountedMs: 14000,
            boardFirstItemMs: 26000,
            openedAtMs: 20000,
            observer: { callbacks: 0, ms: 0 },
        });
        expect(getSection(report, 'webAssembly')).toEqual({
            available: true, validate: true, module: true, instance: true, memory: true, table: true, compile: true,
        });
        expect(getSection(report, 'tv')).toMatchObject({
            available: true, dolbyVision: false, dolbyAtmos: false, edidType: null, dts: 'DTS HD',
        });
        expect(getSection(report, 'memory').jsHeap).toEqual({ usedMB: 50, totalMB: 100, limitMB: 1024 });
    });

    it('asks canPlayType and MSE for every row of the C8 table', async () => {
        const media = getSection(await collect(), 'media');
        expect(media.entries).toHaveLength(MEDIA_TYPES.length);
        const labels = media.entries.map((entry) => entry.label).join('|');
        ['HEVC Main10', 'DV P5 (dvh1.05)', 'DV P8 (dvhe.08)', 'E-AC-3 / JOC', 'AC-3', 'TrueHD', 'DTS (dtsc)', 'AV1', 'MKV'].forEach((label) => {
            expect(labels).toContain(label);
        });
        expect(media.entries.find((entry) => entry.label === 'H.264 High')).toMatchObject({ canPlayType: 'probably', mse: true });
        expect(media.entries.find((entry) => entry.label === 'MKV')).toMatchObject({ canPlayType: 'maybe', mse: false });
        expect(media.entries.find((entry) => entry.label === 'TrueHD (mlpa)').canPlayType).toBe('');
    });

    it('covers every codec and container the task names', () => {
        const types = MEDIA_TYPES.map((entry) => entry.type).join('\n');
        ['hvc1.2.4', 'dvhe.', 'dvh1.', 'ec-3', 'ac-3', 'mlpa', 'dtsc', 'av01', 'x-matroska'].forEach((needle) => {
            expect(types).toContain(needle);
        });
    });

    it('never rejects: a failing source becomes an error in its own section', async () => {
        const report = await collect({
            getCoreStatus: () => Promise.reject(new Error('bridge is gone')),
            readCapabilities: () => Promise.reject(new Error('luna is gone')),
            window: makeWindow({ WebAssembly: undefined, document: { createElement: () => { throw new Error('no video'); } } }),
        });
        expect(getSection(report, 'core')).toMatchObject({ available: false, error: 'bridge is gone' });
        expect(getSection(report, 'tv')).toMatchObject({ available: false, error: 'luna is gone' });
        expect(getSection(report, 'webAssembly')).toEqual({ available: false });
        expect(getSection(report, 'media')).toEqual({ error: 'no video' });
        expect(getSection(report, 'app')).toBeDefined();
        const text = formatReport(report);
        expect(text).toContain('Loader status: unavailable: bridge is gone');
        expect(text).toContain('Error: no video');
        expect(text).toContain('WebAssembly: not available');
    });

    it('reports a missing WebAssembly and the requested core variant', async () => {
        const window = makeWindow({ WebAssembly: undefined, localStorage: fakeStorage({ [VARIANT_KEY]: 'wasm' }) });
        const report = await collect({ window });
        expect(getSection(report, 'webAssembly')).toEqual({ available: false });
        expect(getSection(report, 'core').requested).toBe('wasm');
    });

    it('survives a core status that reports a failure and a bridge without the method', async () => {
        const failed = await collect({ getCoreStatus: () => Promise.resolve({ ...CORE_STATUS, ok: false, stage: 'wasm-compile', error: 'invalid local type' }) });
        expect(formatReport(failed)).toContain('Loader state: failed (wasm-compile)');
        expect(formatReport(failed)).toContain('Loader error: invalid local type');
        const windowWithoutMethod = makeWindow({ core: {} });
        const missing = await collectDiagnostics({
            window: windowWithoutMethod, readCapabilities: () => Promise.resolve(EMULATOR_CAPABILITIES), request: null, registry,
        });
        expect(getSection(missing, 'core').available).toBe(false);
        expect(getSection(missing, 'core').error).toContain('getCoreLoaderStatus');
    });

    it('reads the status from window.core by default', async () => {
        const window = makeWindow({ core: { getCoreLoaderStatus: () => Promise.resolve(CORE_STATUS) } });
        const report = await collectDiagnostics({ window, readCapabilities: () => Promise.resolve(EMULATOR_CAPABILITIES), request: null, registry });
        expect(getSection(report, 'core').variant).toBe('wasm2js');
    });

    it('leaves the Luna memory manager answer in the memory section', async () => {
        const denied = getSection(await collect(), 'memory');
        expect(denied.memoryManager).toEqual({ available: false, error: 'denied' });
        const answered = getSection(await collect({
            request: fakeLuna({ getCurrentMemState: { result: { state: 'normal' } } }),
        }), 'memory');
        expect(answered.memoryManager.available).toBe(true);
        expect(JSON.parse(answered.memoryManager.state)).toEqual({ returnValue: true, state: 'normal' });
        const hung = getSection(await collect({ request: fakeLuna({ getCurrentMemState: 'hang' }) }), 'memory');
        expect(hung.memoryManager).toEqual({ available: false, error: 'timeout' });
        const noBridge = getSection(await collect({ request: null }), 'memory');
        expect(noBridge.memoryManager.available).toBe(false);
    });

    describe('persistence section (the F3.5 mirror)', () => {
        const status = {
            appId: 'io.github.gabrielsflores.stremio', result: { reason: 'localStorage-ok' }, flushes: 2,
            lastFlush: { keys: 3, snapshot: true }, error: null, broken: false, holding: false, pending: 0,
        };

        it('reports the mirror status and what the IndexedDB copy holds', async () => {
            const persist = {
                status: () => status,
                inspect: () => Promise.resolve({ meta: { epoch: 'e1' }, keys: { profile: 10, library: 5 }, chars: 15 }),
            };
            const report = await collect({ window: makeWindow({ __stremioPersist: persist }) });
            expect(getSection(report, 'persistence')).toEqual({
                available: true, status, copy: { keys: 2, chars: 15, meta: { epoch: 'e1' } },
            });
            const text = formatReport(report);
            expect(text).toContain('Boot result: {"reason":"localStorage-ok"}');
            expect(text).toContain('Copy writes: 2 flushes, 0 pending');
            expect(text).toContain('Copy in IndexedDB: 2 keys, 15 chars');
        });

        it('survives an unreadable copy and a missing mirror', async () => {
            const stuck = { status: () => ({ ...status, holding: true }), inspect: () => new Promise(() => {}) };
            const unreadable = await collect({ window: makeWindow({ __stremioPersist: stuck }), timeoutMs: 20 });
            expect(getSection(unreadable, 'persistence')).toMatchObject({ available: true, copy: null, copyError: 'timeout' });
            expect(formatReport(unreadable)).toContain('holding (core not initialised yet)');
            expect(formatReport(unreadable)).toContain('Copy in IndexedDB: unreadable: timeout');
            const missing = await collect();
            expect(getSection(missing, 'persistence')).toEqual({ available: false });
            expect(formatReport(missing)).toContain('localStorage mirror: not installed');
        });
    });

    describe('certificate proxy section (F3.7)', () => {
        const pageStatus = (overrides) => ({
            mode: 'proxy', ready: true, port: 47443, error: null, firmware: '4.0|WEBOS4.0|UA', detectedAt: 1,
            starts: 1, failures: 0, learned: ['example.org'], hosts: ['images.metahub.space', 'example.org'], ...overrides,
        });
        const serviceReply = {
            pid: 321, uptimeMs: 65000, rss: 31457280, heapTotal: 20971520, heapUsed: 10485760, strategy: 'agent-ca',
            node: 'v0.12.2', openssl: '1.0.2', listening: true, listenError: null, subscribers: 1,
            stats: { requests: 12, tlsErrors: { CERT_HAS_EXPIRED: 1 } }, log: ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'],
        };

        it('says so when the page module is missing', async () => {
            const report = await collect();
            expect(getSection(report, 'certificateProxy')).toEqual({ integrated: false });
            expect(formatReport(report)).toContain('[Certificate proxy]\nStatus: not integrated (window.__webosTlsProxy is missing)');
        });

        it('in proxy mode asks the service over Luna: pid, memory, counters and the last log lines', async () => {
            const asked = [];
            const request = (service, call) => {
                asked.push([service, call.method]);
                fakeLuna({ status: { result: serviceReply }, getCurrentMemState: { error: 'denied' } })(service, call);
            };
            const report = await collect({ window: makeWindow({ __webosTlsProxy: { status: () => pageStatus() } }), request });
            expect(asked).toContainEqual(['luna://io.github.gabrielsflores.stremio.tlsproxy', 'status']);
            const data = getSection(report, 'certificateProxy');
            expect(data.service).toMatchObject({ available: true, pid: 321, rssMB: 30, heapUsedMB: 10, strategy: 'agent-ca', log: ['l2', 'l3', 'l4', 'l5', 'l6'] });
            const text = formatReport(report);
            expect(text).toContain('Mode: proxy (the TV lacks the Let\'s Encrypt roots)');
            expect(text).toContain('Service: up on port 47443');
            expect(text).toContain('Known hosts / learned: 2 / example.org');
            expect(text).toContain('Service pid / uptime: 321 / 65 s');
            expect(text).toContain('Service memory (RSS / heap): 30 MB / 10 MB');
            expect(text).toContain('Service counters: {"requests":12,"tlsErrors":{"CERT_HAS_EXPIRED":1}}');
            expect(text).toContain('Service log (last 5): l2 | l3 | l4 | l5 | l6');
        });

        it('does not wake an idle service: direct mode and a service that is not up are not asked', async () => {
            const asked = [];
            const request = (service, call) => { asked.push(call.method); };
            const direct = await collect({ window: makeWindow({ __webosTlsProxy: { status: () => pageStatus({ mode: 'direct', ready: false, port: null }) } }), request });
            expect(formatReport(direct)).toContain('Service diagnostics: skipped: the TV trusts the Let\'s Encrypt roots');
            const down = await collect({ window: makeWindow({ __webosTlsProxy: { status: () => pageStatus({ ready: false, error: 'start failed' }) } }), request });
            expect(formatReport(down)).toContain('Service: not up: start failed');
            expect(asked).not.toContain('status');
        });

        it('keeps the page side when the service does not answer', async () => {
            const window = makeWindow({ __webosTlsProxy: { status: () => pageStatus() } });
            const denied = await collect({ window, request: fakeLuna({ status: { error: 'Denied method call' }, getCurrentMemState: { error: 'denied' } }) });
            expect(getSection(denied, 'certificateProxy').service).toEqual({ available: false, error: 'Denied method call' });
            expect(formatReport(denied)).toContain('Service diagnostics: unavailable: Denied method call');
            const noBridge = await collect({ window, request: null });
            expect(formatReport(noBridge)).toContain('skipped: webOS.service is not available');
        });

        it('uses the id of the service the F3.7 package declares', () => {
            const fs = require('fs');
            const path = require('path');
            const services = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'tlsproxy', 'service', 'services.json'), 'utf8'));
            expect(`luna://${services.id}`).toBe('luna://io.github.gabrielsflores.stremio.tlsproxy');
        });
    });

    it('has an extension point: other modules register sections, and a built-in id is replaced', async () => {
        registry.registerSection('certificateProxy', 'Certificate proxy', () => Promise.resolve({ running: true, port: 8123, hosts: ['images.metahub.space'] }));
        registry.registerSection('other', 'Other', () => { throw new Error('boom'); });
        const registered = await collect();
        const text = formatReport(registered);
        expect(registered.sections.filter((candidate) => candidate.id === 'certificateProxy')).toHaveLength(1);
        expect(registered.sections.map((section) => section.id).slice(-2)).toEqual(['certificateProxy', 'other']);
        expect(text).toContain('[Certificate proxy]\nrunning: true\nport: 8123\nhosts.0: images.metahub.space');
        expect(text).toContain('[Other]\nerror: boom');
    });
});

describe('formatReport', () => {
    it('writes one titled block per section with the values of the emulator', async () => {
        const text = formatReport(await collect());
        expect(text.startsWith('Stremio webOS diagnostics\nGenerated: 2026-10-10T12:00:00.000Z\n')).toBe(true);
        [
            '[App]', 'App version: 5.0.0-beta.41', 'Build (commit): abc1234', 'Core version: 0.65.0-mvp',
            'Variant in use: wasm2js', 'Reason: preferred', 'Preferred: wasm2js (default)',
            'Requested (webos.coreVariant): —', 'Core ready: not reached',
            'WebAssembly: available', 'Dolby Vision (supportDolbyHDRContents): no', 'edidType: —', 'DTS (hw.dtsType): DTS HD',
            'Video · H.264 High: canPlayType=probably mse=yes',
            'Audio · TrueHD (mlpa): canPlayType=no mse=no',
            'JS heap used / total / limit: 50 MB / 100 MB / 1024 MB',
        ].forEach((line) => expect(text).toContain(line));
        expect(text.endsWith('\n')).toBe(true);
    });

    it('is plain JSON-friendly data underneath', async () => {
        const report = await collect();
        expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    });
});

describe('core variant switch', () => {
    it('uses the key the core loader reads', () => {
        expect(VARIANT_KEY).toBe(PREFER_KEY);
    });

    it('sets, reads and clears the requested variant', () => {
        const storage = fakeStorage({});
        expect(getRequestedVariant(storage)).toBeNull();
        setRequestedVariant(storage, 'wasm');
        expect(storage.items).toEqual({ [VARIANT_KEY]: 'wasm' });
        expect(getRequestedVariant(storage)).toBe('wasm');
        setRequestedVariant(storage, 'wasm2js');
        expect(getRequestedVariant(storage)).toBe('wasm2js');
        setRequestedVariant(storage, null);
        expect(storage.items).toEqual({});
    });

    it('refuses an unknown variant and survives a throwing storage', () => {
        const storage = fakeStorage({});
        expect(() => setRequestedVariant(storage, 'wasm64')).toThrow('unknown core variant');
        expect(storage.items).toEqual({});
        expect(getRequestedVariant({ getItem: () => { throw new Error('denied'); } })).toBeNull();
    });
});

describe('registry', () => {
    it('keeps the first mark of a name and rounds to 0.1 ms', () => {
        registry.mark('coreReady', 100.04);
        registry.mark('coreReady', 200);
        expect(registry.getMarks()).toEqual({ coreReady: 100 });
    });

    it('marks when the selector first shows up and stops watching', () => {
        let found = false;
        let callback = null;
        const observer = { observe: jest.fn(), disconnect: jest.fn() };
        function FakeObserver(cb) { callback = cb; return observer; }
        let time = 1000;
        const root = { querySelector: () => found };
        const stop = registry.markWhenFound(root, '[class*="meta-item-container"]', 'boardFirstItem', { MutationObserver: FakeObserver, now: () => (time += 1) });
        expect(observer.observe).toHaveBeenCalledWith(root, { childList: true, subtree: true });
        expect(registry.getMarks()).toEqual({});
        callback();
        expect(registry.getMarks()).toEqual({});
        found = true;
        callback();
        expect(registry.getMarks().boardFirstItem).toBeGreaterThan(1000);
        expect(observer.disconnect).toHaveBeenCalledTimes(1);
        expect(registry.getObserverStats().callbacks).toBe(3);
        stop();
        expect(observer.disconnect).toHaveBeenCalledTimes(1);
    });

    it('marks right away when the element is already there, and does nothing without an observer', () => {
        const FakeObserver = jest.fn();
        registry.markWhenFound({ querySelector: () => true }, 'x', 'now', { MutationObserver: FakeObserver, now: () => 5 });
        expect(registry.getMarks()).toEqual({ now: 5 });
        expect(FakeObserver).not.toHaveBeenCalled();
        const stop = registry.markWhenFound(null, 'x', 'never');
        expect(stop()).toBeUndefined();
        expect(registry.getMarks()).toEqual({ now: 5 });
    });

    it('replaces a section registered twice under the same id', () => {
        registry.registerSection('a', 'A', () => 1);
        registry.registerSection('a', 'A2', () => 2);
        expect(registry.getSections().map((section) => section.title)).toEqual(['A2']);
    });
});

describe('remote shortcut', () => {
    const { COLOR_KEYS, SEQUENCE, createSequenceMatcher, installDiagnosticsShortcut } = require('../shortcut');

    it('matches the four colour keys in order within the gap', () => {
        const match = createSequenceMatcher(SEQUENCE, 2500);
        expect(SEQUENCE).toEqual([403, 404, 405, 406]);
        expect([403, 404, 405].map((key, index) => match(key, index * 500))).toEqual([false, false, false]);
        expect(match(406, 1500)).toBe(true);
        // starts over after a match
        expect(match(406, 1600)).toBe(false);
    });

    it('restarts on a wrong key or a long pause, and a repeated first key counts as the first', () => {
        const match = createSequenceMatcher(SEQUENCE, 2500);
        [403, 404].forEach((key, index) => match(key, index * 100));
        expect(match(13, 300)).toBe(false); // OK key in the middle
        expect(match(405, 400)).toBe(false);
        expect(match(406, 500)).toBe(false);
        // red, red, green, yellow, blue
        [403, 403, 404, 405].forEach((key, index) => match(key, 1000 + index * 100));
        expect(match(406, 1500)).toBe(true);
        // pause longer than the gap between yellow and blue
        [403, 404, 405].forEach((key, index) => match(key, 10000 + index * 100));
        expect(match(406, 10200 + 2600)).toBe(false);
    });

    it('listens on the window and opens the screen; stops listening when asked', () => {
        const listeners = {};
        const win = {
            addEventListener: (type, fn, capture) => { listeners[type] = { fn, capture }; },
            removeEventListener: (type) => { delete listeners[type]; },
            location: { hash: '#/' },
        };
        const stop = installDiagnosticsShortcut(win);
        expect(listeners.keydown.capture).toBe(true);
        Object.values(COLOR_KEYS).forEach((keyCode) => listeners.keydown.fn({ keyCode }));
        expect(win.location.hash).toBe('#/webos-diagnostics');
        win.location.hash = '#/';
        Object.values(COLOR_KEYS).forEach((keyCode) => listeners.keydown.fn({ keyCode, repeat: true }));
        expect(win.location.hash).toBe('#/');
        stop();
        expect(listeners.keydown).toBeUndefined();
    });

    it('does nothing without a window', () => {
        expect(installDiagnosticsShortcut(null, {})).toBeInstanceOf(Function);
    });
});

describe('remote shortcut inside the router (ShortcutHandler)', () => {
    const loadHandler = () => {
        const effects = [];
        const navigate = jest.fn();
        jest.resetModules();
        jest.doMock('react', () => ({ useRef: (value) => ({ current: value }), useEffect: (fn) => effects.push(fn) }));
        jest.doMock('react-router', () => ({ useNavigate: () => navigate }));
        const ShortcutHandler = require('../ShortcutHandler');
        return { ShortcutHandler, effects, navigate };
    };

    afterEach(() => {
        jest.dontMock('react');
        jest.dontMock('react-router');
        delete global.window;
    });

    it('opens the screen with the router navigate(), not with location.hash', () => {
        const listeners = {};
        global.window = {
            addEventListener: (type, fn) => { listeners[type] = fn; },
            removeEventListener: (type) => { delete listeners[type]; },
            location: { hash: '#/metadetails/movie/tt1' },
        };
        const { ShortcutHandler, effects, navigate } = loadHandler();
        expect(ShortcutHandler()).toBeNull();
        const stop = effects[0]();
        [403, 404, 405, 406].forEach((keyCode) => listeners.keydown({ keyCode }));
        expect(navigate).toHaveBeenCalledWith('/webos-diagnostics');
        expect(window.location.hash).toBe('#/metadetails/movie/tt1');
        // already on the screen: nothing to do
        window.location.hash = '#/webos-diagnostics';
        navigate.mockClear();
        [403, 404, 405, 406].forEach((keyCode) => listeners.keydown({ keyCode }));
        expect(navigate).not.toHaveBeenCalled();
        stop();
        expect(listeners.keydown).toBeUndefined();
    });
});

describe('diagnostics route layer', () => {
    const fs = require('fs');
    const path = require('path');
    const read = (file) => fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', file), 'utf8');
    const views = (source) => (source.match(/\bview: (\d+)/g) || []).map((match) => Number(match.replace('view: ', '')));

    it('is above every upstream route, the Player included, so it never replaces one of them', () => {
        const upstream = views(read('src/router/routerPaths.tsx'));
        const [diagnostics] = views(read('src/router/routerPaths.webos.js'));
        expect(upstream.length).toBeGreaterThan(5);
        expect(diagnostics).toBeGreaterThan(Math.max(...upstream));
    });

    it('is opened by the shortcut handler mounted next to BackNavigation, inside the router', () => {
        expect(read('src/App/index.webos.js')).toMatch(/<BackNavigation \/>[\s\S]*<DiagnosticsShortcut \/>/);
    });
});
