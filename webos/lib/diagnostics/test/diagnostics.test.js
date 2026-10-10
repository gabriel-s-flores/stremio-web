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
        const report = await collect();

        expect(report.generatedAt).toBe('2026-10-10T12:00:00.000Z');
        expect(report.sections.map((section) => section.id)).toEqual([
            'app', 'environment', 'core', 'boot', 'webAssembly', 'tv', 'media', 'memory', 'certificateProxy',
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

    it('has an extension point: the certificate proxy placeholder and registered sections', async () => {
        const placeholder = await collect();
        const section = placeholder.sections.find((candidate) => candidate.id === 'certificateProxy');
        expect(section.data).toEqual({ integrated: false });
        expect(formatReport(placeholder)).toContain('[Certificate proxy]\nStatus: not integrated yet');

        registry.registerSection('certificateProxy', 'Certificate proxy', () => Promise.resolve({ running: true, port: 8123, hosts: ['images.metahub.space'] }));
        registry.registerSection('other', 'Other', () => { throw new Error('boom'); });
        const registered = await collect();
        const text = formatReport(registered);
        expect(registered.sections.filter((candidate) => candidate.id === 'certificateProxy')).toHaveLength(1);
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
