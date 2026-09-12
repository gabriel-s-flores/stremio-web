const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');
const React = require('react');
const resolve = require('../src/common/Platform/resolveExternalUrl');
const safeOpen = require('../src/common/Platform/safeOpenExternal');
const { WHITELISTED_HOSTS } = require('../src/common/CONSTANTS');
const safe = url => resolve(url, WHITELISTED_HOSTS);

test.each(['https://www.stremio.com/tos', 'https://stremio.com/privacy', 'https://sub.stremio.com/path?q=1#test'])('allowed URL is unchanged: %s', url => {
    expect(safe(url)).toBe(url);
});
test('untrusted URL only goes in the warning fragment, never its request path/query', () => {
    const original = 'https://stremio.com.evil.test/private?token=secret&x=1';
    const url = safe(original);
    expect(url).toBe('https://www.stremio.com/warning#' + encodeURIComponent(original));
    expect(safe(url)).toBe(url);
    expect(new URL(url).origin + new URL(url).pathname + new URL(url).search).toBe('https://www.stremio.com/warning');
    const open = jest.fn();
    safeOpen(original, WHITELISTED_HOSTS, { open });
    expect(open).toHaveBeenCalledWith(url, '_blank');
    expect(open).not.toHaveBeenCalledWith(original, '_blank');
});
test.each(['invalid', '', '#/settings', null, {}, 'https://'])('invalid input rejected: %p', url => {
    const open = jest.fn();
    expect(safe(url)).toBeNull();
    expect(safeOpen(url, WHITELISTED_HOSTS, { open })).toBe(false);
    expect(open).not.toHaveBeenCalled();
});
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file.endsWith('.js') ? file + 'x' : file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true }
}).outputText;
const context = { exports: {}, process: { env: {} } };
vm.runInNewContext(compile('src/common/Platform/webos/adapter.ts'), context);
const { createWebOSAdapter } = context.exports;
test('browser launch preserves service receiver and failure callback', () => {
    let options;
    const service = { request: jest.fn(function (uri, args) {
        expect(this).toBe(service);
        expect(uri).toBe('luna://com.webos.applicationManager');
        options = args;
    }) };
    const failure = jest.fn();
    createWebOSAdapter(true, () => ({ webOS: { service } })).openBrowser('https://www.stremio.com', failure);
    expect(options.method).toBe('launch');
    expect(options.parameters).toEqual({ id: 'com.webos.app.browser', params: { target: 'https://www.stremio.com' } });
    expect(failure).not.toHaveBeenCalled();
    options.onFailure({ errorText: 'private URL must not be forwarded' });
    options.onFailure();
    expect(failure).toHaveBeenCalledTimes(1);
    expect(failure).toHaveBeenCalledWith();
});
test.each([null, {}, { webOS: {} }, { webOS: { service: { request: () => { throw Error('native'); } } } }])('missing bridge/synchronous error: %p', host => {
    const failure = jest.fn();
    expect(() => createWebOSAdapter(true, () => host).openBrowser('safe', failure)).not.toThrow();
    expect(failure).toHaveBeenCalledTimes(1);
});
test('desktop does not resolve webOS globals', () => {
    const host = jest.fn(() => { throw Error(); });
    createWebOSAdapter(false, host).openBrowser('safe', jest.fn());
    expect(host).not.toHaveBeenCalled();
});
const renderLink = (name, props) => {
    const platform = { name, openExternal: jest.fn() };
    const context = { exports: {}, require: id => {
        if (id === 'react') return React;
        if (id === '../Button') return { default: 'Button', __esModule: true };
        return { usePlatform: () => platform };
    } };
    vm.runInNewContext(compile('src/components/ExternalLink/index.tsx'), context);
    return { element: context.exports.default.render(props, null), platform };
};
const event = () => ({ defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });
test('desktop retains native link properties and callback', () => {
    const click = jest.fn(), props = { href: 'https://example.com', target: '_blank', download: 'video', onClick: click };
    const { element, platform } = renderLink('windows', props), e = event();
    expect(element.props).toMatchObject({ href: props.href, target: props.target, download: props.download });
    element.props.onClick(e);
    expect(click).toHaveBeenCalledWith(e);
    expect(e.defaultPrevented).toBe(false);
    expect(platform.openExternal).not.toHaveBeenCalled();
});
test('webOS delegates once and honors caller cancellation', () => {
    for (const cancel of [false, true]) {
        const click = jest.fn(e => { if (cancel) e.preventDefault(); });
        const { element, platform } = renderLink('webos', { href: 'safe', onClick: click });
        const e = event(); element.props.onClick(e);
        expect(e.defaultPrevented).toBe(true);
        expect(click).toHaveBeenCalledTimes(1);
        expect(platform.openExternal).toHaveBeenCalledTimes(cancel ? 0 : 1);
    }
});

test('Platform keeps safe failure URLs and ignores stale native callbacks', () => {
    const state = [], refs = [];
    let stateIndex = 0, refIndex = 0;
    const openBrowser = jest.fn();
    const mockReact = { ...React,
        useState: initial => {
            const index = stateIndex++;
            if (!(index in state)) state[index] = initial;
            return [state[index], value => { state[index] = value; }];
        },
        useRef: initial => { const index = refIndex++; return refs[index] || (refs[index] = { current: initial }); },
        useCallback: fn => fn
    };
    const context = { exports: {}, require: id => {
        if (id === 'react') return mockReact;
        if (id.endsWith('/CONSTANTS')) return { WHITELISTED_HOSTS };
        if (id === './resolveExternalUrl') return resolve;
        if (id === './safeOpenExternal') return safeOpen;
        if (id === './device') return { name: 'webos', isTV: true, isMobile: false };
        if (id === './webos/adapter') return { webOSAdapter: { openBrowser } };
        if (id === './webos') return { useWebOS: () => ({}) };
        if (id === './shell/useShell') return () => ({});
        throw Error(id);
    } };
    vm.runInNewContext(compile('src/common/Platform/Platform.tsx'), context);
    const render = () => {
        stateIndex = refIndex = 0;
        return context.exports.PlatformProvider({ children: null }).props.value;
    };
    render().openExternal('https://untrusted.test/private?secret=1');
    const [url, fail] = openBrowser.mock.calls[0];
    expect(url).toBe(safe('https://untrusted.test/private?secret=1'));
    fail();
    expect(render().externalLinkFailure).toBe(url);
    render().dismissExternalLinkFailure();
    fail();
    expect(render().externalLinkFailure).toBeNull();
    render().openExternal('https://www.stremio.com/tos');
    fail();
    expect(render().externalLinkFailure).toBeNull();
    render().openExternal('invalid');
    expect(openBrowser).toHaveBeenCalledTimes(2);
});
