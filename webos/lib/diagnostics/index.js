// Diagnostics report (F3.6): collects what the TV, the Chromium and the app expose, for the
// diagnostics screen (src/routes/WebosDiagnostics) and for the Phase 8 session on the real C8.
// Nothing here runs at boot: the screen loads this module lazily and calls collectDiagnostics()
// when it opens. API and output format: see README.md in this folder.

const { callLuna, defaultRequest, isWebOS, readCapabilities: readDefaultCapabilities } = require('../platform');
const defaultRegistry = require('./registry');
const { MEDIA_TYPES } = require('./canplay');

// localStorage key of the core variant the loader reads (webos/core/loader.js PREFER_KEY; a test
// keeps the two equal, since importing the loader here would load worker code in the page).
const VARIANT_KEY = 'webos.coreVariant';
const VARIANTS = ['wasm2js', 'wasm'];

const MEMORY_MANAGER_SERVICE = 'luna://com.webos.memorymanager';
// The certificate proxy service (F3.7, webos/tlsproxy/service/services.json; a test keeps the id in sync).
const TLSPROXY_SERVICE = 'luna://io.github.gabrielsflores.stremio.tlsproxy';
const DEFAULT_TIMEOUT_MS = 3000;
const MB = 1048576;

const EMPTY_WASM_MODULE = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

const errorText = (error) => String((error && error.message) || error);
const toMB = (bytes) => (typeof bytes === 'number' ? Math.round(bytes / MB * 10) / 10 : null);
const orNull = (value) => (value === undefined ? null : value);

// A section that fails reports the error instead of rejecting the whole report.
const attempt = (fn) => new Promise((resolve) => resolve(fn())).then(
    (data) => data,
    (error) => ({ error: errorText(error) })
);

const getRequestedVariant = (storage) => {
    try {
        const value = storage.getItem(VARIANT_KEY);
        return typeof value === 'string' ? value : null;
    } catch (error) {
        return null;
    }
};

// `variant` is "wasm", "wasm2js" or null (remove the key: the loader default applies).
const setRequestedVariant = (storage, variant) => {
    if (variant !== null && VARIANTS.indexOf(variant) === -1) throw new Error('unknown core variant: ' + variant);
    if (variant === null) storage.removeItem(VARIANT_KEY);
    else storage.setItem(VARIANT_KEY, variant);
};

const collectApp = (context) => Promise.resolve({
    version: orNull(context.app.version),
    commit: orNull(context.app.commit),
    coreVersion: orNull(context.app.coreVersion),
});

const collectEnvironment = (context) => {
    const win = context.window;
    const nav = win.navigator || {};
    const screen = win.screen || {};
    const userAgent = typeof nav.userAgent === 'string' ? nav.userAgent : null;
    const chromium = userAgent && /Chrome\/([\d.]+)/.exec(userAgent);
    return Promise.resolve({
        userAgent,
        chromium: chromium ? chromium[1] : null,
        isWebOS: isWebOS(win),
        platform: (win.__webos && win.__webos.platform) || null,
        language: orNull(nav.language),
        screen: screen.width ? { width: screen.width, height: screen.height, pixelRatio: win.devicePixelRatio || 1 } : null,
        window: { innerWidth: orNull(win.innerWidth), innerHeight: orNull(win.innerHeight) },
        online: typeof nav.onLine === 'boolean' ? nav.onLine : null,
        hardwareConcurrency: orNull(nav.hardwareConcurrency),
        deviceMemoryGB: orNull(nav.deviceMemory),
    });
};

// The status of the loader that runs in the worker (webos/core/loader.js getStatus()), read
// through the Bridge, plus the variant the localStorage asks for on the next start.
const collectCore = (context) => new Promise((resolve) => resolve(context.getCoreStatus())).then(
    (status) => status || { unavailable: 'no status' },
    (error) => ({ unavailable: errorText(error) })
).then((status) => {
    const requested = context.window.localStorage ? getRequestedVariant(context.window.localStorage) : null;
    if (status.unavailable) return { requested, available: false, error: status.unavailable };
    return {
        requested,
        available: true,
        ok: orNull(status.ok),
        stage: orNull(status.stage),
        variant: orNull(status.variant),
        reason: orNull(status.reason),
        // The failure the loader recorded, not an error of this collector.
        error: orNull(status.error),
        prefer: orNull(status.prefer),
        preferSource: orNull(status.preferSource),
        preferConfig: orNull(status.preferConfig),
        hasWebAssembly: orNull(status.hasWebAssembly),
        wasmBytes: orNull(status.wasmBytes),
        memoryBytes: orNull(status.memoryBytes),
        timings: status.timings || {},
    };
});

const collectBoot = (context) => {
    const timing = context.window.performance && context.window.performance.timing;
    const since = (value) => (timing && timing.navigationStart && value > 0 ? value - timing.navigationStart : null);
    const marks = context.registry.getMarks();
    const sinceNow = context.window.performance && typeof context.window.performance.now === 'function' ?
        Math.round(context.window.performance.now()) : null;
    return Promise.resolve({
        domContentLoadedMs: timing ? since(timing.domContentLoadedEventEnd) : null,
        loadMs: timing ? since(timing.loadEventEnd) : null,
        coreInitStartMs: orNull(marks.coreInitStart),
        coreReadyMs: orNull(marks.coreReady),
        boardMountedMs: orNull(marks.boardMounted),
        boardFirstItemMs: orNull(marks.boardFirstItem),
        openedAtMs: sinceNow,
        observer: context.registry.getObserverStats(),
    });
};

const collectWebAssembly = (context) => {
    const WA = context.window.WebAssembly;
    if (!WA || typeof WA !== 'object') return Promise.resolve({ available: false });
    const bytes = new Uint8Array(EMPTY_WASM_MODULE);
    const probe = (fn) => {
        try {
            return !!fn();
        } catch (error) {
            return false;
        }
    };
    const data = {
        available: true,
        validate: typeof WA.validate === 'function' ? probe(() => WA.validate(bytes)) : null,
        module: probe(() => new WA.Module(bytes)),
        instance: probe(() => new WA.Instance(new WA.Module(bytes))),
        memory: probe(() => new WA.Memory({ initial: 1 })),
        table: probe(() => new WA.Table({ element: 'anyfunc', initial: 1 })),
    };
    if (typeof WA.compile !== 'function') return Promise.resolve(Object.assign(data, { compile: null }));
    return attempt(() => WA.compile(bytes).then(() => true, () => false)).then((compile) => Object.assign(data, { compile }));
};

const collectTv = (context) => attempt(() => context.readCapabilities(true)).then((capabilities) => {
    if (!capabilities || capabilities.error) return { available: false, error: (capabilities && capabilities.error) || 'no capabilities' };
    return {
        available: capabilities.available,
        dolbyVision: capabilities.dolbyVision,
        dolbyAtmos: capabilities.dolbyAtmos,
        edidType: capabilities.edidType,
        dts: capabilities.dts,
        soundModeType: capabilities.soundModeType,
        model: capabilities.model,
        missing: capabilities.missing,
        errors: capabilities.errors,
    };
});

const collectMedia = (context) => Promise.resolve().then(() => {
    const doc = context.window.document;
    const video = doc && doc.createElement ? doc.createElement('video') : null;
    const MediaSourceApi = context.window.MediaSource;
    const hasMse = !!MediaSourceApi && typeof MediaSourceApi.isTypeSupported === 'function';
    const ask = (fn) => {
        try {
            return fn();
        } catch (error) {
            return 'error';
        }
    };
    return {
        mse: hasMse,
        entries: MEDIA_TYPES.map((entry) => ({
            group: entry.group,
            label: entry.label,
            type: entry.type,
            // "" (no), "maybe" or "probably"; null when there is no video element.
            canPlayType: video ? ask(() => video.canPlayType(entry.type)) : null,
            mse: hasMse ? ask(() => MediaSourceApi.isTypeSupported(entry.type)) : null,
        })),
    };
});

const collectMemory = (context) => {
    const win = context.window;
    const jsHeap = win.performance && win.performance.memory;
    const data = {
        // Quantized by the Chromium 53 (F1.6): good for trends, not for exact values. The process
        // RSS (what the webOS memory manager judges) is only visible over SSH on the emulator/TV.
        jsHeap: jsHeap ? {
            usedMB: toMB(jsHeap.usedJSHeapSize),
            totalMB: toMB(jsHeap.totalJSHeapSize),
            limitMB: toMB(jsHeap.jsHeapSizeLimit),
        } : null,
        deviceMemoryGB: orNull(win.navigator && win.navigator.deviceMemory),
    };
    const request = context.request;
    if (!request) return Promise.resolve(Object.assign(data, { memoryManager: { available: false, error: 'webOS.service is not available' } }));
    return callLuna(MEMORY_MANAGER_SERVICE, 'getCurrentMemState', {}, request, context.timeoutMs).then((outcome) => {
        const memoryManager = outcome.ok ?
            { available: true, state: JSON.stringify(outcome.result).slice(0, 400) } :
            { available: false, error: outcome.error };
        return Object.assign(data, { memoryManager });
    });
};

const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((value) => {
        clearTimeout(timer);
        resolve(value);
    }, (error) => {
        clearTimeout(timer);
        reject(error);
    });
});

// The localStorage mirror of F3.5 (webos/persistence/mirror.js): window.__stremioPersist.
const collectPersistence = (context) => {
    const persist = context.window.__stremioPersist;
    if (!persist || typeof persist.status !== 'function') return Promise.resolve({ available: false });
    const status = persist.status();
    if (typeof persist.inspect !== 'function') return Promise.resolve({ available: true, status, copy: null });
    return withTimeout(Promise.resolve(persist.inspect()), context.timeoutMs).then(
        (copy) => ({
            available: true,
            status,
            copy: { keys: Object.keys(copy.keys || {}).length, chars: orNull(copy.chars), meta: orNull(copy.meta) },
        }),
        (error) => ({ available: true, status, copy: null, copyError: errorText(error) })
    );
};

// The certificate proxy (F3.7, webos/tlsproxy): the page side (window.__webosTlsProxy.status(), no
// token) and, when the proxy is in use, the service's own diagnostics over Luna (pid, memory, TLS
// error counters, log). Asking an idle service would start it, so a direct-mode TV is not asked.
const collectCertificateProxy = (context) => {
    const bridge = context.window.__webosTlsProxy;
    if (!bridge || typeof bridge.status !== 'function') return Promise.resolve({ integrated: false });
    const page = bridge.status();
    const skipped = (reason) => ({ integrated: true, page, service: { available: false, skipped: reason } });
    if (page.mode !== 'proxy') return Promise.resolve(skipped('the TV trusts the Let\'s Encrypt roots: the service is not in use'));
    if (!page.ready) return Promise.resolve(skipped('the service is not up yet'));
    if (!context.request) return Promise.resolve(skipped('webOS.service is not available'));
    return callLuna(TLSPROXY_SERVICE, 'status', {}, context.request, context.timeoutMs).then((outcome) => {
        if (!outcome.ok) return { integrated: true, page, service: { available: false, error: outcome.error } };
        const reply = outcome.result;
        return {
            integrated: true,
            page,
            service: {
                available: true,
                pid: orNull(reply.pid),
                uptimeMs: orNull(reply.uptimeMs),
                rssMB: toMB(reply.rss),
                heapUsedMB: toMB(reply.heapUsed),
                strategy: orNull(reply.strategy),
                node: orNull(reply.node),
                openssl: orNull(reply.openssl),
                listening: orNull(reply.listening),
                listenError: orNull(reply.listenError),
                subscribers: orNull(reply.subscribers),
                stats: orNull(reply.stats),
                log: Array.isArray(reply.log) ? reply.log.slice(-5) : [],
            },
        };
    });
};

// Sections registered by other modules (webos/lib/diagnostics/registry.js). A registered section
// replaces the built-in one with the same id; the others are appended after the built-in ones.
const collectExtensions = (context) => Promise.all(context.registry.getSections().map((section) => (
    attempt(() => section.collect()).then((data) => ({ id: section.id, title: section.title, data }))
)));

const yesNo = (value) => (value === null || value === undefined ? 'unknown' : value === true ? 'yes' : value === false ? 'no' : String(value));
const ms = (value) => (typeof value === 'number' ? value + ' ms' : 'not reached');
const mb = (value) => (typeof value === 'number' ? value + ' MB' : 'unknown');
const text = (value) => (value === null || value === undefined || value === '' ? '—' : String(value));

const formatTimings = (timings) => {
    const names = Object.keys(timings || {});
    return names.length ? names.map((name) => name + '=' + timings[name]).join(', ') : '—';
};

const flatten = (value, prefix) => {
    if (value === null || typeof value !== 'object') return [[prefix || 'value', text(value)]];
    return Object.keys(value).reduce((rows, key) => {
        const child = value[key];
        const label = prefix ? prefix + '.' + key : key;
        return rows.concat(child !== null && typeof child === 'object' ? flatten(child, label) : [[label, text(child)]]);
    }, []);
};

// [label, value] rows of each section, in the order the screen and the text report show them.
const json = (value) => (value === null || value === undefined ? '—' : JSON.stringify(value));

const SECTION_ROWS = {
    app: (d) => [
        ['App version', text(d.version)],
        ['Build (commit)', text(d.commit)],
        ['Core version', text(d.coreVersion)],
    ],
    environment: (d) => [
        ['User agent', text(d.userAgent)],
        ['Chromium', text(d.chromium)],
        ['webOS detected', yesNo(d.isWebOS)],
        ['Platform name', text(d.platform)],
        ['Language', text(d.language)],
        ['Screen', d.screen ? d.screen.width + 'x' + d.screen.height + ' @' + d.screen.pixelRatio : 'unknown'],
        ['Window', d.window.innerWidth + 'x' + d.window.innerHeight],
        ['Online', yesNo(d.online)],
        ['CPU threads', text(d.hardwareConcurrency)],
        ['Device memory', d.deviceMemoryGB === null ? 'not exposed' : d.deviceMemoryGB + ' GB'],
    ],
    core: (d) => (d.available ? [
        ['Variant in use', text(d.variant)],
        ['Reason', text(d.reason)],
        ['Loader state', (d.ok === true ? 'ready' : d.ok === false ? 'failed' : 'loading') + ' (' + text(d.stage) + ')'],
        ['Loader error', text(d.error)],
        ['Preferred', text(d.prefer) + ' (' + text(d.preferSource) + ')'],
        ['Requested (' + VARIANT_KEY + ')', text(d.requested)],
        ['Worker has WebAssembly', yesNo(d.hasWebAssembly)],
        ['Loader timings', formatTimings(d.timings)],
        ['Core memory', d.memoryBytes === null ? 'unknown' : toMB(d.memoryBytes) + ' MB'],
    ] : [
        ['Loader status', 'unavailable: ' + text(d.error)],
        ['Requested (' + VARIANT_KEY + ')', text(d.requested)],
    ]),
    boot: (d) => [
        ['DOMContentLoaded', ms(d.domContentLoadedMs)],
        ['Page load', ms(d.loadMs)],
        ['Core init started', ms(d.coreInitStartMs)],
        ['Core ready', ms(d.coreReadyMs)],
        ['Board mounted', ms(d.boardMountedMs)],
        ['Board first item', ms(d.boardFirstItemMs)],
        ['Screen opened at', ms(d.openedAtMs)],
        ['Board watcher cost', d.observer.callbacks + ' callbacks, ' + d.observer.ms + ' ms'],
    ],
    webAssembly: (d) => (d.available ? [
        ['WebAssembly', 'available'],
        ['validate / Module / Instance', [d.validate, d.module, d.instance].map(yesNo).join(' / ')],
        ['compile (async)', yesNo(d.compile)],
        ['Memory / Table', [d.memory, d.table].map(yesNo).join(' / ')],
    ] : [['WebAssembly', 'not available']]),
    tv: (d) => (d.available ? [
        ['Dolby Vision (supportDolbyHDRContents)', yesNo(d.dolbyVision)],
        ['Dolby Atmos (supportDolbyTVATMOS)', yesNo(d.dolbyAtmos)],
        ['edidType', text(d.edidType)],
        ['DTS (hw.dtsType)', text(d.dts)],
        ['Sound mode', text(d.soundModeType)],
        ['Model / firmware / SDK', [d.model.name, d.model.firmware, d.model.sdk].map(text).join(' / ')],
        ['UHD', yesNo(d.model.uhd)],
        ['Configs the TV does not know', d.missing.length ? d.missing.join(', ') : '—'],
        ['Luna errors', d.errors.length ? d.errors.join('; ') : '—'],
    ] : [['Luna', 'unavailable: ' + text([d.error].concat(d.errors || []).filter(Boolean).join('; '))]]),
    media: (d) => [['MSE', d.mse ? 'available' : 'not available']].concat(d.entries.map((entry) => [
        entry.group + ' · ' + entry.label,
        'canPlayType=' + (entry.canPlayType === '' ? 'no' : text(entry.canPlayType)) + (entry.mse === null ? '' : ' mse=' + yesNo(entry.mse)),
    ])),
    persistence: (d) => (d.available ? [
        ['Boot result', json(d.status.result)],
        ['Copy writes', d.status.flushes + ' flushes, ' + d.status.pending + ' pending' +
            (d.status.holding ? ', holding (core not initialised yet)' : '') + (d.status.broken ? ', IndexedDB broken' : '')],
        ['Last flush', json(d.status.lastFlush)],
        ['Mirror error', text(d.status.error)],
        ['Copy in IndexedDB', d.copy ? d.copy.keys + ' keys, ' + d.copy.chars + ' chars' : 'unreadable: ' + text(d.copyError)],
        ['Copy meta', d.copy ? json(d.copy.meta) : '—'],
    ] : [['localStorage mirror', 'not installed (window.__stremioPersist missing)']]),
    certificateProxy: (d) => {
        if (!d.integrated) return [['Status', 'not integrated (window.__webosTlsProxy is missing)']];
        const page = d.page;
        const rows = [
            ['Mode', page.mode === 'proxy' ? 'proxy (the TV lacks the Let\'s Encrypt roots)' : text(page.mode)],
            ['Service', page.mode === 'proxy' ? (page.ready ? 'up on port ' + page.port : 'not up' + (page.error ? ': ' + text(page.error) : '')) : 'not needed'],
            ['Service starts / failures', page.starts + ' / ' + page.failures],
            ['Detected for', text(page.firmware)],
            ['Known hosts / learned', page.hosts.length + ' / ' + (page.learned.length ? page.learned.join(', ') : '—')],
        ];
        const service = d.service;
        if (service.available) {
            rows.push(
                ['Service pid / uptime', service.pid + ' / ' + Math.round(service.uptimeMs / 1000) + ' s'],
                ['Service memory (RSS / heap)', mb(service.rssMB) + ' / ' + mb(service.heapUsedMB)],
                ['Service runtime', [service.node, 'OpenSSL ' + text(service.openssl), service.strategy].map(text).join(' · ')],
                ['Service listening', yesNo(service.listening) + (service.listenError ? ' (' + service.listenError + ')' : '') + ', ' + text(service.subscribers) + ' subscribers'],
                ['Service counters', json(service.stats)],
                ['Service log (last 5)', service.log.length ? service.log.join(' | ') : '—']
            );
        } else {
            rows.push(['Service diagnostics', service.skipped ? 'skipped: ' + service.skipped : 'unavailable: ' + text(service.error)]);
        }
        return rows;
    },
    memory: (d) => [
        ['JS heap used / total / limit', d.jsHeap ? [d.jsHeap.usedMB, d.jsHeap.totalMB, d.jsHeap.limitMB].map(mb).join(' / ') : 'not exposed'],
        ['Device memory', d.deviceMemoryGB === null ? 'not exposed' : d.deviceMemoryGB + ' GB'],
        ['Memory manager (Luna)', d.memoryManager.available ? d.memoryManager.state : 'unavailable: ' + text(d.memoryManager.error)],
    ],
};

const SECTION_TITLES = {
    app: 'App',
    environment: 'Environment',
    core: 'Core',
    boot: 'Boot times',
    webAssembly: 'WebAssembly',
    tv: 'TV capabilities (Luna)',
    media: 'Media (canPlayType)',
    memory: 'Memory',
    persistence: 'Persistence (localStorage mirror)',
    certificateProxy: 'Certificate proxy',
};

const SECTION_ORDER = ['app', 'environment', 'core', 'boot', 'webAssembly', 'tv', 'media', 'memory', 'persistence', 'certificateProxy'];

const COLLECTORS = {
    app: collectApp,
    environment: collectEnvironment,
    core: collectCore,
    boot: collectBoot,
    webAssembly: collectWebAssembly,
    tv: collectTv,
    media: collectMedia,
    memory: collectMemory,
    persistence: collectPersistence,
    certificateProxy: collectCertificateProxy,
};

// `rows` of a section whose data is {error}: the rows builders expect real data.
const rowsFor = (id, data) => {
    if (data && data.error && Object.keys(data).length === 1) return [['Error', data.error]];
    try {
        return SECTION_ROWS[id](data);
    } catch (error) {
        return [['Error', 'cannot format: ' + errorText(error)]];
    }
};

// Never rejects. options (all optional, injected in tests): window, app { version, commit,
// coreVersion }, getCoreStatus(), readCapabilities(force), request (webOS.service.request
// compatible), registry, timeoutMs, now() -> Date.
const collectDiagnostics = (options) => {
    const settings = options || {};
    const win = settings.window || (typeof window !== 'undefined' ? window : {});
    const context = {
        window: win,
        app: settings.app || {},
        registry: settings.registry || defaultRegistry,
        request: settings.request === undefined ? defaultRequest(win) : settings.request,
        timeoutMs: settings.timeoutMs || DEFAULT_TIMEOUT_MS,
        readCapabilities: settings.readCapabilities || readDefaultCapabilities,
        getCoreStatus: settings.getCoreStatus || (() => (
            win.core && typeof win.core.getCoreLoaderStatus === 'function' ?
                win.core.getCoreLoaderStatus() : Promise.reject(new Error('the core transport has no getCoreLoaderStatus'))
        )),
    };
    const generatedAt = settings.now ? settings.now() : new Date();
    return Promise.all(SECTION_ORDER.map((id) => attempt(() => COLLECTORS[id](context)))).then((results) => {
        return attempt(() => collectExtensions(context)).then((extensions) => {
            const registered = Array.isArray(extensions) ? extensions : [];
            const fromRegistry = (extension) => ({
                id: extension.id,
                title: extension.title,
                data: extension.data,
                rows: flatten(extension.data),
            });
            const sections = SECTION_ORDER.map((id, index) => {
                const replacement = registered.filter((extension) => extension.id === id)[0];
                return replacement ? fromRegistry(replacement) : {
                    id,
                    title: SECTION_TITLES[id],
                    data: results[index],
                    rows: rowsFor(id, results[index]),
                };
            });
            registered
                .filter((extension) => SECTION_ORDER.indexOf(extension.id) === -1)
                .forEach((extension) => sections.push(fromRegistry(extension)));
            return { generatedAt: generatedAt.toISOString(), sections };
        });
    });
};

// The plain text of a report, for the selectable block (and the console).
const formatReport = (report) => {
    const lines = ['Stremio webOS diagnostics', 'Generated: ' + report.generatedAt];
    report.sections.forEach((section) => {
        lines.push('', '[' + section.title + ']');
        section.rows.forEach((row) => lines.push(row[0] + ': ' + row[1]));
    });
    return lines.join('\n') + '\n';
};

// The data of one section by id, for tests and probes.
const getSection = (report, id) => {
    const section = report.sections.filter((candidate) => candidate.id === id)[0];
    return section ? section.data : undefined;
};

module.exports = {
    VARIANT_KEY,
    VARIANTS,
    MEDIA_TYPES,
    collectDiagnostics,
    formatReport,
    getSection,
    getRequestedVariant,
    setRequestedVariant,
};
