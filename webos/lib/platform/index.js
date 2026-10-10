// webOS platform (F3.1): runtime detection, the platform name the app and stremio-video expect, and
// the TV capabilities read through Luna (configs + system info), cached and error tolerant.
// API and output format: see README.md in this folder.

const PLATFORM_NAME = 'webOS';

// "Web0S" (zero) is what the TV's Chromium sends; the OSes below are the same family.
const USER_AGENT_PATTERN = /(web|hpw)[o0]s/i;

const CONFIG_SERVICE = 'luna://com.webos.service.config';
const SYSTEM_PROPERTY_SERVICE = 'luna://com.webos.service.tv.systemproperty';

// One getConfigs call. Names the TV does not know come back in `missingConfigs` (the emulator has
// no tv.model.edidType, for instance), which is not an error.
const CONFIG_NAMES = [
    'tv.config.supportDolbyHDRContents',
    'tv.config.supportDolbyTVATMOS',
    'tv.model.edidType',
    'tv.model.soundModeType',
    'tv.hw.dtsType',
];
const SYSTEM_KEYS = ['modelName', 'firmwareVersion', 'sdkVersion', 'UHD'];

const DEFAULT_TIMEOUT_MS = 5000;

const isWebOS = (win) => {
    const target = win || (typeof window !== 'undefined' ? window : null);
    if (!target) return false;
    const userAgent = target.navigator && target.navigator.userAgent;
    return USER_AGENT_PATTERN.test(typeof userAgent === 'string' ? userAgent : '') ||
        !!target.PalmSystem || !!target.webOS;
};

const getPlatformName = (win) => (isWebOS(win) ? PLATFORM_NAME : null);

const asString = (value) => (typeof value === 'string' && value !== '' ? value : null);
const asBoolean = (value) => (typeof value === 'boolean' ? value : null);
// systemproperty returns booleans as the strings "true"/"false".
const asBooleanLike = (value) => (value === 'true' ? true : value === 'false' ? false : asBoolean(value));

// One Luna call that always settles: onSuccess/onFailure/timeout/exception all end in the same shape.
const callLuna = (service, method, parameters, request, timeoutMs) => new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (outcome) => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimeout(timer);
        resolve(outcome);
    };
    timer = setTimeout(() => finish({ ok: false, error: 'timeout' }), timeoutMs);
    try {
        request(service, {
            method,
            parameters,
            onSuccess: (result) => finish({ ok: true, result: result || {} }),
            onFailure: (error) => finish({ ok: false, error: (error && (error.errorText || error.errorCode)) || 'failure' }),
        });
    } catch (error) {
        finish({ ok: false, error: String((error && error.message) || error) });
    }
});

const defaultRequest = (win) => {
    const target = win || (typeof window !== 'undefined' ? window : null);
    const service = target && target.webOS && target.webOS.service;
    return service && typeof service.request === 'function' ? service.request.bind(service) : null;
};

const parseCapabilities = (configs, system) => {
    const values = (configs.ok && configs.result.configs) || {};
    const info = system.ok ? system.result : {};
    const edidType = asString(values['tv.model.edidType']);
    const dtsType = asString(values['tv.hw.dtsType']);
    return {
        platform: PLATFORM_NAME,
        available: configs.ok || system.ok,
        // tv.config.supportDolbyHDRContents: webOSTV.js deviceInfo calls this "dolbyVision".
        dolbyVision: asBoolean(values['tv.config.supportDolbyHDRContents']),
        // The TV's own Atmos support. webOSTV.js also needs ARC/eARC for the real output; the app has
        // TV speakers only (P2), so this is the answer that matters.
        dolbyAtmos: asBoolean(values['tv.config.supportDolbyTVATMOS']),
        // The same value WebOsVideo reads to un-hide DTS/TrueHD (substring match, lower case).
        edidType,
        dts: dtsType,
        soundModeType: asString(values['tv.model.soundModeType']),
        model: {
            name: asString(info.modelName),
            firmware: asString(info.firmwareVersion),
            sdk: asString(info.sdkVersion),
            uhd: asBooleanLike(info.UHD),
        },
        missing: (configs.ok && Array.isArray(configs.result.missingConfigs)) ? configs.result.missingConfigs.slice() : [],
        errors: [
            configs.ok ? null : 'getConfigs: ' + configs.error,
            system.ok ? null : 'getSystemInfo: ' + system.error,
        ].filter(Boolean),
    };
};

// Reader with its own cache. `request` is `webOS.service.request`-compatible (injected in tests).
// readCapabilities() never rejects. A read where Luna answered nothing is not cached, so a later
// call (the bridge may not have been ready) tries again.
const createCapabilitiesReader = (options) => {
    const settings = options || {};
    const timeoutMs = settings.timeoutMs || DEFAULT_TIMEOUT_MS;
    let cached = null;
    let pending = null;

    const read = () => {
        const request = settings.request || defaultRequest(settings.window);
        if (!request) {
            return Promise.resolve(parseCapabilities(
                { ok: false, error: 'webOS.service is not available' },
                { ok: false, error: 'webOS.service is not available' }
            ));
        }
        return Promise.all([
            callLuna(CONFIG_SERVICE, 'getConfigs', { configNames: CONFIG_NAMES }, request, timeoutMs),
            callLuna(SYSTEM_PROPERTY_SERVICE, 'getSystemInfo', { keys: SYSTEM_KEYS }, request, timeoutMs),
        ]).then((outcomes) => parseCapabilities(outcomes[0], outcomes[1]));
    };

    const readCapabilities = (force) => {
        if (cached && !force) return Promise.resolve(cached);
        if (pending && !force) return pending;
        const current = read().then((capabilities) => {
            if (pending === current) pending = null;
            if (capabilities.available) cached = capabilities;
            return capabilities;
        });
        pending = current;
        return current;
    };

    return {
        readCapabilities,
        // null until a read succeeded.
        getCapabilities: () => cached,
        reset: () => {
            cached = null;
            pending = null;
        },
    };
};

const defaultReader = createCapabilitiesReader();

// Starts the default read once the page has loaded, off the boot path (a Luna round trip is
// asynchronous, but the core is busy parsing at that point and the Board has priority).
// `platformName` is what the app resolved for Platform.name. Both it and the outcome are published
// on `window.__webos` (for CDP probes and the diagnostics screen) and logged once.
const startCapabilitiesRead = (win, platformName) => {
    const target = win || (typeof window !== 'undefined' ? window : null);
    if (!target || !isWebOS(target)) return;
    const state = { platform: platformName || PLATFORM_NAME, capabilities: null };
    target.__webos = state;
    const start = () => {
        defaultReader.readCapabilities().then((capabilities) => {
            state.capabilities = capabilities;
            // eslint-disable-next-line no-console
            console.info('[webos] platform=' + state.platform + ' capabilities=' + JSON.stringify(capabilities));
        });
    };
    if (target.document && target.document.readyState !== 'complete') {
        target.addEventListener('load', () => setTimeout(start, 0));
    } else {
        setTimeout(start, 0);
    }
};

module.exports = {
    PLATFORM_NAME,
    CONFIG_NAMES,
    SYSTEM_KEYS,
    isWebOS,
    getPlatformName,
    createCapabilitiesReader,
    readCapabilities: defaultReader.readCapabilities,
    getCapabilities: defaultReader.getCapabilities,
    startCapabilitiesRead,
};
