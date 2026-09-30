const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');
jest.mock('thread-loader', () => ({ warmup: jest.fn() }));
const config = require('../webpack.config');

test.each([true, 'true', '1'])('disabled flag %p removes generator and replaces updater', flag => {
    const result = config({ WEBOS: '1', SERVICE_WORKER_DISABLED: flag }, { mode: 'production' });
    expect(result.plugins.some(p => p.constructor.name === 'GenerateSW')).toBe(false);
    const replacement = result.plugins.find(p => p.constructor.name === 'NormalModuleReplacementPlugin');
    expect(replacement.resourceRegExp.test('./App/WebUpdateScreen')).toBe(true);
    expect(replacement.newResource.replace(/\\/g, '/')).toMatch(/WebUpdateScreen\/disabled.js$/);
    expect(result.plugins.find(p => p.constructor.name === 'EnvironmentPlugin').defaultValues.SERVICE_WORKER_DISABLED).toBe(true);
});
test.each([undefined, false, 'false', '0'])('hosted flag %p preserves updater', flag => {
    const result = config({ SERVICE_WORKER_DISABLED: flag }, { mode: 'production' });
    expect(result.plugins.some(p => p.constructor.name === 'GenerateSW')).toBe(true);
    expect(result.plugins.some(p => p.constructor.name === 'NormalModuleReplacementPlugin')).toBe(false);
    expect(result.plugins.find(p => p.constructor.name === 'EnvironmentPlugin').defaultValues.SERVICE_WORKER_DISABLED).toBe(false);
});
test.each([['https:', true, true], ['http:', false, false], ['file:', false, false], ['file:', true, false], ['http:', true, true]])('origin %s secure=%s selects updater=%s', (protocol, secure, enabled) => {
    const source = ts.transpileModule(fs.readFileSync('src/App/WebUpdateScreen/index.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const active = () => {}, disabled = () => null;
    const context = { exports: {}, window: { isSecureContext: secure, location: { protocol } }, require: name => ({ default: name === './disabled' ? disabled : active }) };
    vm.runInNewContext(source, context);
    expect(context.exports.default).toBe(enabled ? active : disabled);
});


const hookSource = ts.transpileModule(fs.readFileSync('src/App/WebUpdateScreen/useServiceWorkerUpdater.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
}).outputText;
function updater() {
    const states = [], refs = [], effects = [], listeners = {};
    let si = 0, ri = 0, mounted = false;
    const workbox = { register: jest.fn(() => Promise.resolve()), update: jest.fn(() => Promise.resolve()), messageSkipWaiting: jest.fn(), addEventListener: jest.fn((name, fn) => { listeners[name] = fn; }), removeEventListener: jest.fn() };
    const reload = jest.fn();
    const shell = { active: false, on: jest.fn(), off: jest.fn() };
    const context = {
        exports: {}, process: { env: { NODE_ENV: 'production' } },
        navigator: { serviceWorker: { controller: {} } },
        window: { location: { reload } }, document: { addEventListener: jest.fn(), removeEventListener: jest.fn() },
        setTimeout, clearTimeout, Date, console,
        require: name => {
            if (name === 'react') return {
                useState: initial => { const i = si++; if (!(i in states)) states[i] = initial; return [states[i], next => { states[i] = next; }]; },
                useRef: initial => { const i = ri++; return refs[i] || (refs[i] = { current: initial }); },
                useCallback: fn => fn, useEffect: fn => { if (!mounted) effects.push(fn); }
            };
            if (name === 'workbox-window') return { Workbox: function () { return workbox; } };
            if (name === 'stremio/common') return { usePlatform: () => ({ shell }) };
            if (name === 'stremio/common/usePWA') return { default: () => [false, false] };
            throw Error(name);
        }
    };
    vm.runInNewContext(hookSource, context);
    const render = () => { si = 0; ri = 0; return context.exports.default(); };
    render(); const cleanup = effects.map(fn => fn()); mounted = true;
    return { render, workbox, listeners, reload, cleanup: () => cleanup.forEach(fn => fn?.()) };
}
test('Workbox waiting -> explicit apply -> controlling reload, with cleanup', async () => {
    jest.useFakeTimers();
    try {
        const h = updater(); await Promise.resolve();
        expect(h.workbox.register).toHaveBeenCalledTimes(1);
        h.listeners.waiting({ wasWaitingBeforeRegister: false });
        expect(h.render().state).toEqual({ status: 'ready', autoApply: false });
        h.render().applyUpdate();
        expect(h.render().state.status).toBe('applying');
        expect(h.workbox.messageSkipWaiting).toHaveBeenCalledTimes(1);
        h.listeners.controlling({ isUpdate: true });
        expect(h.reload).toHaveBeenCalledTimes(1);
        h.cleanup(); expect(jest.getTimerCount()).toBe(0);
        expect(h.workbox.removeEventListener).toHaveBeenCalledTimes(2);
    } finally { jest.useRealTimers(); }
});
test('initial control does not reload; external update offers reload; activation timeout permits retry', () => {
    jest.useFakeTimers();
    try {
        const h = updater();
        h.listeners.controlling({ isUpdate: false });
        expect(h.render().state.status).toBe('idle');
        h.listeners.controlling({ isUpdate: true });
        expect(h.render().state.status).toBe('reload-ready');
        expect(h.reload).not.toHaveBeenCalled();
        h.listeners.waiting({}); h.render().applyUpdate();
        jest.advanceTimersByTime(15000);
        expect(h.render().state.status).toBe('failed');
        h.render().applyUpdate();
        expect(h.workbox.messageSkipWaiting).toHaveBeenCalledTimes(2);
        h.cleanup();
    } finally { jest.useRealTimers(); }
});

test('webOS waits for the updater while desktop retains automatic activation', () => {
    for (const webos of [false, true]) {
        const sw = config({ WEBOS: webos }, { mode: 'production' }).plugins.find(p => p.constructor.name === 'GenerateSW');
        expect(sw.config.skipWaiting).toBe(!webos);
    }
});
