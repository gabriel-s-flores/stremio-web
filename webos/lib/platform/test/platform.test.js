const { PLATFORM_NAME, isWebOS, getPlatformName, createCapabilitiesReader, CONFIG_NAMES } = require('..');

const TV_UA = 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/53.0.2785.34 Safari/537.36 WebAppManager';
const DESKTOP_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

// Luna double: answers per method; `answers[method]` is { result } | { error } | 'hang' | 'throw'.
const fakeLuna = (answers) => {
    const calls = [];
    const request = (service, { method, parameters, onSuccess, onFailure }) => {
        calls.push({ service, method, parameters });
        const answer = answers[method];
        if (answer === 'hang') return;
        if (answer === 'throw') throw new Error('bridge exploded');
        setTimeout(() => (answer.error ? onFailure({ errorCode: -1, errorText: answer.error, returnValue: false }) : onSuccess({ returnValue: true, ...answer.result })), 0);
    };
    return { request, calls };
};

// What the emulator answered (probe 2026-10-09): no tv.model.edidType.
const EMULATOR = {
    getConfigs: {
        result: {
            configs: { 'tv.config.supportDolbyHDRContents': false, 'tv.config.supportDolbyTVATMOS': false, 'tv.hw.dtsType': 'DTS HD' },
            missingConfigs: ['tv.model.edidType', 'tv.model.soundModeType'],
        },
    },
    getSystemInfo: { result: { modelName: 'WEBOS4.0', firmwareVersion: '04.00.00', sdkVersion: '04.00.00', UHD: 'false' } },
};

describe('isWebOS', () => {
    it('recognises the TV user agent', () => {
        expect(isWebOS({ navigator: { userAgent: TV_UA } })).toBe(true);
        expect(getPlatformName({ navigator: { userAgent: TV_UA } })).toBe('webOS');
        expect(PLATFORM_NAME).toBe('webOS');
    });

    it('recognises PalmSystem or webOS globals even with another user agent', () => {
        expect(isWebOS({ navigator: { userAgent: DESKTOP_UA }, PalmSystem: {} })).toBe(true);
        expect(isWebOS({ navigator: { userAgent: DESKTOP_UA }, webOS: {} })).toBe(true);
    });

    it('is false on desktop', () => {
        expect(isWebOS({ navigator: { userAgent: DESKTOP_UA } })).toBe(false);
        expect(getPlatformName({ navigator: { userAgent: DESKTOP_UA } })).toBeNull();
        expect(isWebOS({})).toBe(false);
    });
});

describe('capabilities reader', () => {
    it('reads the emulator answers and tolerates the missing configs', async () => {
        const luna = fakeLuna(EMULATOR);
        const reader = createCapabilitiesReader({ request: luna.request });
        const capabilities = await reader.readCapabilities();
        expect(capabilities).toEqual({
            platform: 'webOS',
            available: true,
            dolbyVision: false,
            dolbyAtmos: false,
            edidType: null,
            dts: 'DTS HD',
            soundModeType: null,
            model: { name: 'WEBOS4.0', firmware: '04.00.00', sdk: '04.00.00', uhd: false },
            missing: ['tv.model.edidType', 'tv.model.soundModeType'],
            errors: [],
        });
        expect(luna.calls[0]).toEqual({
            service: 'luna://com.webos.service.config',
            method: 'getConfigs',
            parameters: { configNames: CONFIG_NAMES },
        });
    });

    it('never calls com.webos.media or subscribes', async () => {
        const luna = fakeLuna(EMULATOR);
        await createCapabilitiesReader({ request: luna.request }).readCapabilities();
        luna.calls.forEach((call) => {
            expect(call.service).not.toMatch(/com\.webos\.media/);
            expect(call.parameters.subscribe).toBeUndefined();
        });
    });

    it('reads the values of a TV with Dolby Vision, Atmos and the EDID', async () => {
        const luna = fakeLuna({
            ...EMULATOR,
            getConfigs: {
                result: {
                    configs: {
                        'tv.config.supportDolbyHDRContents': true,
                        'tv.config.supportDolbyTVATMOS': true,
                        'tv.model.edidType': 'DTS,TrueHD',
                        'tv.model.soundModeType': 'Dolby Atmos',
                        'tv.hw.dtsType': 'DTS HD',
                    },
                },
            },
        });
        const capabilities = await createCapabilitiesReader({ request: luna.request }).readCapabilities();
        expect(capabilities).toMatchObject({ dolbyVision: true, dolbyAtmos: true, edidType: 'DTS,TrueHD', soundModeType: 'Dolby Atmos' });
        expect(capabilities.missing).toEqual([]);
    });

    it('caches the result and shares the read in flight', async () => {
        const luna = fakeLuna(EMULATOR);
        const reader = createCapabilitiesReader({ request: luna.request });
        expect(reader.getCapabilities()).toBeNull();
        const [first, second] = await Promise.all([reader.readCapabilities(), reader.readCapabilities()]);
        expect(second).toBe(first);
        expect(await reader.readCapabilities()).toBe(first);
        expect(reader.getCapabilities()).toBe(first);
        expect(luna.calls).toHaveLength(2);
        await reader.readCapabilities(true);
        expect(luna.calls).toHaveLength(4);
    });

    it('keeps what one source gave when the other fails', async () => {
        const luna = fakeLuna({ ...EMULATOR, getSystemInfo: { error: 'Not permitted' } });
        const capabilities = await createCapabilitiesReader({ request: luna.request }).readCapabilities();
        expect(capabilities.available).toBe(true);
        expect(capabilities.dts).toBe('DTS HD');
        expect(capabilities.model).toEqual({ name: null, firmware: null, sdk: null, uhd: null });
        expect(capabilities.errors).toEqual(['getSystemInfo: Not permitted']);
    });

    it('resolves (does not reject) when Luna fails, and does not cache the failure', async () => {
        const answers = { getConfigs: { error: 'down' }, getSystemInfo: { error: 'down' } };
        const luna = fakeLuna(answers);
        const reader = createCapabilitiesReader({ request: luna.request });
        const failed = await reader.readCapabilities();
        expect(failed).toMatchObject({ available: false, dolbyVision: null, edidType: null, dts: null });
        expect(failed.errors).toHaveLength(2);
        expect(reader.getCapabilities()).toBeNull();

        Object.assign(answers, EMULATOR);
        const retried = await reader.readCapabilities();
        expect(retried.available).toBe(true);
        expect(reader.getCapabilities()).toBe(retried);
    });

    it('survives a request that throws or never answers', async () => {
        const throwing = fakeLuna({ getConfigs: 'throw', getSystemInfo: 'throw' });
        const thrown = await createCapabilitiesReader({ request: throwing.request }).readCapabilities();
        expect(thrown.available).toBe(false);
        expect(thrown.errors[0]).toMatch(/bridge exploded/);

        const hanging = fakeLuna({ getConfigs: 'hang', getSystemInfo: EMULATOR.getSystemInfo });
        const timedOut = await createCapabilitiesReader({ request: hanging.request, timeoutMs: 20 }).readCapabilities();
        expect(timedOut.available).toBe(true);
        expect(timedOut.errors).toEqual(['getConfigs: timeout']);
    });

    it('resolves when webOS.service does not exist (desktop)', async () => {
        const capabilities = await createCapabilitiesReader({ window: {} }).readCapabilities();
        expect(capabilities).toMatchObject({ available: false, platform: 'webOS' });
        expect(capabilities.errors[0]).toMatch(/not available/);
    });

    it('uses webOS.service.request of the given window by default', async () => {
        const luna = fakeLuna(EMULATOR);
        const win = { webOS: { service: { request: luna.request } } };
        const capabilities = await createCapabilitiesReader({ window: win }).readCapabilities();
        expect(capabilities.available).toBe(true);
    });
});

describe('startCapabilitiesRead', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('does nothing outside webOS', () => {
        const win = { navigator: { userAgent: DESKTOP_UA } };
        require('..').startCapabilitiesRead(win, 'linux');
        expect(win.__webos).toBeUndefined();
    });

    it('publishes the platform right away and the capabilities once read', async () => {
        const luna = fakeLuna(EMULATOR);
        const listeners = {};
        const win = {
            navigator: { userAgent: TV_UA },
            document: { readyState: 'loading' },
            webOS: { service: { request: luna.request } },
            addEventListener: (type, listener) => { listeners[type] = listener; },
        };
        global.window = win;
        jest.isolateModules(() => {
            const info = jest.spyOn(console, 'info').mockImplementation(() => {});
            require('..').startCapabilitiesRead(win, 'webOS');
            expect(win.__webos).toEqual({ platform: 'webOS', capabilities: null });
            expect(luna.calls).toHaveLength(0);
            listeners.load();
            jest.runOnlyPendingTimers();
            expect(luna.calls).toHaveLength(2);
            info.mockRestore();
        });
        delete global.window;
    });
});
