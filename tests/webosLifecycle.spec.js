const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');
const { parseDeepLink, parseLaunchDeepLink } = require('../src/common/parseDeepLink');
const context = { exports: {}, process: { env: {} } };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/common/Platform/webos/adapter.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const { createWebOSAdapter } = context.exports;
const setup = (host = {}, enabled = true) => {
    const events = {};
    const target = { hidden: false, addEventListener: (name, fn) => { events[name] = fn; }, removeEventListener: name => { delete events[name]; } };
    const adapter = createWebOSAdapter(enabled, () => host, target);
    return { adapter, target, events, emit: (name, detail) => events[name]({ detail }) };
};
test.each([
    ['stremio:///metadetails/movie/tt123', '/metadetails/movie/tt123'],
    ['stremio:///discover?x=a%20b&x=c', '/discover?x=a%20b&x=c'],
    ['stremio://addon.example/manifest.json', '/addons?addon=https%3A%2F%2Faddon.example%2Fmanifest.json'],
    ['stremio://addon.example/manifest.json?token=a%2Bb', '/addons?addon=https%3A%2F%2Faddon.example%2Fmanifest.json%3Ftoken%3Da%252Bb']
])('parse %s', (uri, expected) => expect(parseDeepLink(uri)).toBe(expected));
test.each([undefined, null, {}, [], 7, '', 'https://addon.example', 'stremio:', 'stremio:discover', 'stremio://', 'stremio:////evil', 'stremio://user:pass@host/path', 'stremio:///bad%zz', 'stremio:///bad path'])('ignore invalid %p', value => expect(parseDeepLink(value)).toBeNull());
test.each(['uri', 'contentTarget', 'contentId'])('alias %s requires full URI', key => {
    expect(parseLaunchDeepLink({ [key]: 'tt123' })).toBeNull();
    expect(parseLaunchDeepLink({ [key]: 'stremio:///library' })).toBe('/library');
    expect(parseLaunchDeepLink({ url: 'https://bad', [key]: 'stremio:///library' })).toBeNull();
});
test('detail wins; initial launch queued once; relaunches delivered separately', () => {
    const s = setup({ PalmSystem: { launchParams: '{"url":"stremio:///old"}' } });
    s.emit('webOSLaunch', { url: 'stremio:///library' });
    s.emit('webOSLaunch', { url: 'stremio:///library' });
    const listener = jest.fn(), unsub = s.adapter.subscribeLifecycle(listener);
    expect(listener.mock.calls).toEqual([[{ type: 'launch', params: { url: 'stremio:///library' } }]]);
    s.emit('webOSRelaunch', { url: 'stremio:///discover' });
    s.emit('webOSRelaunch', {});
    expect(listener.mock.calls.slice(1)).toEqual([[{ type: 'relaunch', params: { url: 'stremio:///discover' } }], [{ type: 'relaunch', params: {} }]]);
    unsub();
    s.adapter.subscribeLifecycle(listener)();
    expect(listener).toHaveBeenCalledTimes(3);
});
test('one-event queue keeps latest relaunch', () => {
    const s = setup();
    s.emit('webOSLaunch', { url: 'stremio:///library' });
    s.emit('webOSRelaunch', { url: 'stremio:///discover' });
    const listener = jest.fn(); s.adapter.subscribeLifecycle(listener);
    expect(listener).toHaveBeenCalledWith({ type: 'relaunch', params: { url: 'stremio:///discover' } });
    expect(listener).toHaveBeenCalledTimes(1);
});
test.each([
    { webOSDev: { launchParams: () => ({ url: 'stremio:///library' }) } },
    { webOSDev: { launchParams: () => '{"url":"stremio:///library"}' } },
    { PalmSystem: { launchParams: '{"url":"stremio:///library"}' } },
    { webOSDev: { launchParams: () => { throw Error(); } }, PalmSystem: { launchParams: '{"url":"stremio:///library"}' } }
])('fallback initial launch and dedup %p', host => {
    const s = setup(host), listener = jest.fn();
    s.adapter.subscribeLifecycle(listener);
    s.emit('webOSLaunch');
    expect(listener.mock.calls).toEqual([[{ type: 'launch', params: { url: 'stremio:///library' } }]]);
});
test.each([undefined, null, 'bad', '[]', 7])('malformed detail without native APIs %p', detail => {
    const s = setup(), listener = jest.fn(); s.adapter.subscribeLifecycle(listener);
    s.emit('webOSLaunch', detail); s.emit('webOSRelaunch', detail);
    expect(listener.mock.calls).toEqual([[{ type: 'launch', params: {} }], [{ type: 'relaunch', params: {} }]]);
});
test('visibility notifications, unsubscribe and disposal', () => {
    const s = setup(), listener = jest.fn(), unsub = s.adapter.subscribeVisibility(listener);
    expect(s.adapter.getHidden()).toBe(false);
    s.target.hidden = true; s.events.visibilitychange(); s.events.visibilitychange();
    expect(s.adapter.getHidden()).toBe(true); expect(listener).toHaveBeenCalledTimes(1);
    s.target.hidden = false; s.events.visibilitychange();
    expect(s.adapter.getHidden()).toBe(false); expect(listener).toHaveBeenCalledTimes(2);
    unsub(); s.target.hidden = true; s.events.visibilitychange(); expect(listener).toHaveBeenCalledTimes(2);
    s.adapter.dispose(); expect(s.events).toEqual({});
});
test('disabled adapter does not register events or deliver fallback', () => {
    const s = setup({ PalmSystem: { launchParams: '{}' } }, false), listener = jest.fn();
    s.adapter.subscribeLifecycle(listener); expect(listener).not.toHaveBeenCalled(); expect(s.events).toEqual({});
});
const effects = file => {
    const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
    const result = [];
    const visit = node => { if (ts.isCallExpression(node) && node.expression.getText(ast) === 'React.useEffect') result.push(node.arguments[0].getText(ast)); ts.forEachChild(node, visit); };
    visit(ast); return result;
};
test('actual App lifecycle effect replaces routes and ignores empty/invalid relaunch', () => {
    const effect = effects('src/App/App.js').find(text => text.includes('subscribeLifecycle'));
    const s = setup(), navigate = jest.fn();
    s.emit('webOSLaunch', { url: 'stremio:///library' });
    const cleanup = vm.runInNewContext(`(${effect})()`, { webos: s.adapter, parseLaunchDeepLink, navigate });
    s.emit('webOSRelaunch', {}); s.emit('webOSRelaunch', { url: 'https://bad' });
    s.emit('webOSRelaunch', { uri: 'stremio:///discover?q=1' });
    expect(navigate.mock.calls).toEqual([['/library', { replace: true }], ['/discover?q=1', { replace: true }]]);
    cleanup(); s.emit('webOSRelaunch', { url: 'stremio:///library' }); expect(navigate).toHaveBeenCalledTimes(2);
});
test.each([true, false])('actual Player pause effect honors setting %p and desktop', enabled => {
    const effect = effects('src/routes/Player/Player.js').find(text => text.includes('settings.pauseOnMinimize'));
    const onPauseRequested = jest.fn();
    const platform = { webos: { hidden: true }, shell: { state: {} } };
    const run = () => vm.runInNewContext(`(${effect})()`, { settings: { pauseOnMinimize: enabled }, platform, onPauseRequested });
    run(); expect(onPauseRequested).toHaveBeenCalledTimes(enabled ? 1 : 0);
    platform.webos.hidden = false; run(); expect(onPauseRequested).toHaveBeenCalledTimes(enabled ? 1 : 0);
    platform.shell.state.windowHidden = true; run(); expect(onPauseRequested).toHaveBeenCalledTimes(enabled ? 2 : 0);
    platform.shell.state = { windowClosed: true }; run(); expect(onPauseRequested).toHaveBeenCalledTimes(enabled ? 3 : 0);
});
test('Chromium 68 opaque custom-scheme URL semantics do not affect routes', () => {
    const legacyURL = function (value) {
        if (value.startsWith('stremio:')) return { protocol: 'stremio:', hostname: '', pathname: value.slice(8), search: '', hash: '' };
        return new URL(value);
    };
    const ctx = { module: { exports: {} }, URL: legacyURL };
    vm.runInNewContext(fs.readFileSync('src/common/parseDeepLink.js', 'utf8'), ctx);
    expect(ctx.module.exports.parseDeepLink('stremio:///settings')).toBe('/settings');
    expect(ctx.module.exports.parseDeepLink('stremio://addon.example/manifest.json')).toBe('/addons?addon=https%3A%2F%2Faddon.example%2Fmanifest.json');
});
