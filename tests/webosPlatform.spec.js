const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');
const compile = file => ts.transpileModule(fs.readFileSync(`src/common/Platform/webos/${file}.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
}).outputText;
const exportsFor = (file, globals = {}) => {
    const context = { exports: {}, process: { env: {} }, ...globals };
    vm.runInNewContext(compile(file), context);
    return context.exports;
};
const { createWebOSAdapter } = exportsFor('adapter');
const read = adapter => new Promise(resolve => adapter.readDeviceInfo(resolve));

test('deviceInfo callback is asynchronous and preserves receiver', async () => {
    const webOS = { deviceInfo: jest.fn(function (cb) { expect(this).toBe(webOS); setTimeout(() => cb({ modelName: 'WEBOS5.0', sdkVersion: '5.0.0', version: '02.00.30' }), 0); }) };
    const adapter = createWebOSAdapter(true, () => ({ webOS }));
    expect(adapter.isActive()).toBe(true);
    expect(await read(adapter)).toEqual({ modelName: 'WEBOS5.0', sdkVersion: '5.0.0' });
});
test('PalmSystem JSON fallback', async () => {
    expect(await read(createWebOSAdapter(true, () => ({ PalmSystem: { deviceInfo: JSON.stringify({ modelName: 'TV', sdkVersion: '5.0.0', platformVersion: '02.00.30' }) } })))).toEqual({ modelName: 'TV', sdkVersion: '5.0.0' });
});
test.each([null, {}, { returnValue: false, modelName: 'TV' }, { modelName: 7, version: {} }])('invalid response %p', async info => {
    expect(await read(createWebOSAdapter(true, () => ({ webOS: { deviceInfo: cb => cb(info) } })))).toBeNull();
});
test('partial response retains available fields', async () => {
    expect(await read(createWebOSAdapter(true, () => ({ webOS: { deviceInfo: cb => cb({ modelName: 'TV', version: '02.00.30', platformVersion: '02.00.30' }) } })))).toEqual({ modelName: 'TV', sdkVersion: null });
});
test('API exception and malformed JSON return null', async () => {
    for (const host of [{ webOS: { deviceInfo: () => { throw Error(); } } }, { PalmSystem: { deviceInfo: '{' } }]) {
        expect(await read(createWebOSAdapter(true, () => host))).toBeNull();
    }
});
test('Back prefers webOS and preserves receiver, then falls back to PalmSystem', () => {
    const webOS = { platformBack: jest.fn(function () { expect(this).toBe(webOS); }) };
    const PalmSystem = { platformBack: jest.fn(function () { expect(this).toBe(PalmSystem); }) };
    const adapter = createWebOSAdapter(true, () => ({ webOS, PalmSystem }));
    expect(adapter.backAvailable()).toBe(true);
    expect(adapter.platformBack()).toBe(true);
    expect(PalmSystem.platformBack).not.toHaveBeenCalled();
    webOS.platformBack.mockImplementation(() => { throw Error(); });
    expect(adapter.platformBack()).toBe(true);
    delete webOS.platformBack;
    expect(adapter.platformBack()).toBe(true);
    PalmSystem.platformBack.mockImplementation(() => { throw Error(); });
    expect(adapter.platformBack()).toBe(false);
});
test('absent globals and throwing global access are safe', async () => {
    for (const resolve of [() => null, () => ({}), () => { throw Error(); }]) {
        const adapter = createWebOSAdapter(true, resolve);
        expect(adapter.isActive()).toBe(false);
        expect(adapter.backAvailable()).toBe(false);
        expect(adapter.platformBack()).toBe(false);
        expect(await read(adapter)).toBeNull();
    }
    expect(createWebOSAdapter(true).platformBack()).toBe(false);
});
test('desktop never accesses native globals, even when present', async () => {
    const resolve = jest.fn(() => { throw Error('must not access'); });
    const adapter = createWebOSAdapter(false, resolve);
    expect(adapter.isActive()).toBe(false);
    expect(adapter.backAvailable()).toBe(false);
    expect(adapter.platformBack()).toBe(false);
    expect(await read(adapter)).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
});
test('globals are resolved at operation time', () => {
    let host = {};
    const adapter = createWebOSAdapter(true, () => host);
    expect(adapter.isActive()).toBe(false);
    host = { webOS: { platformBack: jest.fn() } };
    expect(adapter.isActive()).toBe(true);
    expect(adapter.platformBack()).toBe(true);
});
test('hook ignores callbacks after cleanup and exposes stable Back', () => {
    let effect, callback;
    const setter = jest.fn();
    const adapter = { isActive: () => true, readDeviceInfo: cb => { callback = cb; }, platformBack: jest.fn() };
    const hook = exportsFor('useWebOS', { require: id => id === 'react' ? {
        useSyncExternalStore: () => false, useState: () => [null, setter], useEffect: fn => { effect = fn; }
    } : { webOSAdapter: adapter } }).default;
    expect(hook()).toEqual({ active: true, hidden: false, subscribeLifecycle: undefined, deviceInfo: null, platformBack: adapter.platformBack });
    const cleanup = effect();
    callback({ modelName: 'TV', sdkVersion: null });
    expect(setter).toHaveBeenCalledTimes(1);
    cleanup();
    callback(null);
    expect(setter).toHaveBeenCalledTimes(1);
});
