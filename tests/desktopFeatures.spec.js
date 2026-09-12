const fs = require('fs');
const vm = require('vm');
const ts = require('typescript');
const React = require('react');

function harness({ isTV = false, isMobile = false, active = false, name = 'windows' } = {}) {
    const effects = [], cleanups = [], states = [], contexts = [];
    const window = { addEventListener: jest.fn(), removeEventListener: jest.fn(), setInterval: jest.fn(), clearInterval: jest.fn() };
    const shell = { active, on: jest.fn(), off: jest.fn(), send: jest.fn(), state: {}, capabilities: { gpuVideoProcessing: true } };
    const platform = { isTV, isMobile, name, shell };
    const react = { ...React,
        useEffect: fn => effects.push(fn), useLayoutEffect: () => {},
        useMemo: fn => fn(), useCallback: fn => fn, useRef: value => ({ current: value }),
        useState: value => { const set = jest.fn(); states.push(set); return [value, set]; },
        useContext: context => context._currentValue,
        createContext: value => { const context = React.createContext(value); contexts.push(context); return context; }
    };
    const common = {
        usePlatform: () => platform, useProfile: () => ({ settings: { discordRpcEnabled: true } }),
        useBinaryState: () => [true, jest.fn(), jest.fn()], useRouteFocused: () => false,
        useStreamingServer: () => ({}), withCoreSuspender: component => component,
    };
    const load = (file, extra = {}) => {
        const exports = {};
        const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
            fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true }
        }).outputText;
        vm.runInNewContext(source, { exports, window, console, process, DataTransfer: class { files = []; }, require: id => {
            if (id in extra) return extra[id];
            if (id === 'react') return react;
            if (id === 'stremio/common' || id === '../Platform') return common;
            if (id === '../useProfile') return common.useProfile;
            if (id === 'react-i18next') return { useTranslation: () => ({ t: key => key }) };
            if (id === 'react-router') return { useMatch: () => null };
            if (id.endsWith('.less')) return new Proxy({}, { get: (_, key) => key });
            if (id === 'stremio/components') return { Button: 'button', MainNavBars: 'main', UpdateBanner: 'update-banner', Toggle: 'toggle', MultiselectMenu: 'select', ColorInput: 'color' };
            if (id === '../components') return { Section: 'section', Option: 'option', Category: 'category' };
            if (id === './constants' || id === '../constants') return { SECTIONS: { GENERAL: 'general', INTERFACE: 'interface', PLAYER: 'player', STREAMING: 'streaming', SHORTCUTS: 'shortcuts' } };
            if (id.startsWith('./use')) return () => ({});
            if (/^\.\/(Menu|General|Interface|Player|Streaming|Shortcuts|Info)$/.test(id)) return id.slice(2).toLowerCase();
            return require(id);
        } });
        return exports;
    };
    return { load, platform, shell, window, states, contexts,
        commit: () => effects.splice(0).forEach(fn => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup); }),
        unmount: () => cleanups.splice(0).forEach(fn => fn()) };
}
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree)
    ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];

test('TV FileDrop preserves a stable no-op context and children without input, state or drag effects', () => {
    const h = harness({ isTV: true, name: 'webos' });
    const { FileDropProvider } = h.load('src/common/FileDrop/FileDrop.tsx', { './utils': {} });
    const first = FileDropProvider({ children: 'content' });
    const listener = jest.fn();
    first.props.value.on('*', listener);
    first.props.value.off('*', listener);
    expect(FileDropProvider({ children: 'content' }).props.value).toBe(first.props.value);
    expect(first.props.children).toBe('content');
    expect(nodes(first).some(node => node.type === 'input')).toBe(false);
    expect(h.states).toHaveLength(0);
    h.commit(); h.unmount();
    expect(h.window.addEventListener).not.toHaveBeenCalled();
    expect(h.window.removeEventListener).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
});

test.each([false, true])('FileDrop preserves input, drag state, file delivery and cleanup (mobile=%s)', async isMobile => {
    const h = harness({ isMobile });
    const { FileDropProvider } = h.load('src/common/FileDrop/FileDrop.tsx', { './utils': { isFileTypeSupported: () => true } });
    const wrapper = FileDropProvider({ children: 'content' });
    const tree = wrapper.type(wrapper.props);
    const input = nodes(tree).find(node => node.type === 'input');
    expect(input.props.type).toBe('file');
    const listener = jest.fn(), removed = jest.fn();
    tree.props.value.on('*', listener);
    tree.props.value.on('removed', removed);
    tree.props.value.off('removed', removed);
    h.commit();
    expect(h.window.addEventListener.mock.calls.map(([name]) => name)).toEqual(['dragstart', 'dragover', 'dragleave']);
    const event = { preventDefault: jest.fn() };
    h.window.addEventListener.mock.calls[1][1](event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(h.states[0]).toHaveBeenLastCalledWith(true);
    h.window.addEventListener.mock.calls[2][1](event);
    expect(h.states[0]).toHaveBeenLastCalledWith(false);
    const buffer = new ArrayBuffer(2), file = { arrayBuffer: () => Promise.resolve(buffer) };
    input.props.onChange({ preventDefault: jest.fn(), target: { files: [file] } });
    await Promise.resolve();
    expect(listener).toHaveBeenCalledWith(file, buffer, true);
    expect(removed).not.toHaveBeenCalled();
    h.unmount();
    expect(h.window.removeEventListener.mock.calls).toEqual(h.window.addEventListener.mock.calls);
});

test.each([false, true])('Discord inactive shell has no listeners, sends or retry timer (TV=%s)', isTV => {
    const h = harness({ isTV });
    const { DiscordProvider } = h.load('src/common/Discord/Discord.tsx');
    const tree = DiscordProvider({ children: 'content' });
    expect(tree.props.value.available).toBe(false);
    tree.props.value.setActivity({ state: 'Playing' });
    h.commit(); h.unmount();
    expect(h.shell.on).not.toHaveBeenCalled();
    expect(h.shell.off).not.toHaveBeenCalled();
    expect(h.shell.send).not.toHaveBeenCalled();
    expect(h.window.setInterval).not.toHaveBeenCalled();
});

test.each([false, true])('Discord uses shell.active alone, including a synthetic TV with active shell (%s)', isTV => {
    const h = harness({ isTV, active: true });
    h.load('src/common/Discord/Discord.tsx').DiscordProvider({ children: null });
    h.commit();
    expect(h.shell.on).toHaveBeenCalledWith('discord-status', expect.any(Function));
    expect(h.shell.send).toHaveBeenCalledWith('discord-connect', {});
    h.unmount();
    expect(h.shell.off.mock.calls).toEqual(h.shell.on.mock.calls);
});

test.each([false, true])('Updater inactive shell has no banner or subscription even with visible state (TV=%s)', isTV => {
    const h = harness({ isTV });
    expect(h.load('src/App/UpdaterBanner/UpdaterBanner.tsx').default({ className: 'test' })).toBeNull();
    h.commit(); h.unmount();
    expect(h.shell.on).not.toHaveBeenCalled();
    expect(h.shell.off).not.toHaveBeenCalled();
    expect(h.shell.send).not.toHaveBeenCalled();
});

test('Updater desktop retains notification, install action and cleanup', () => {
    const h = harness({ active: true });
    const tree = h.load('src/App/UpdaterBanner/UpdaterBanner.tsx').default({ className: 'test' });
    h.commit();
    expect(h.shell.on).toHaveBeenCalledWith('autoupdater-show-notif', expect.any(Function));
    expect(tree.props.visible).toBe(true);
    tree.props.onAction();
    expect(h.shell.send).toHaveBeenCalledWith('autoupdater-notif-clicked');
    h.unmount();
    expect(h.shell.off.mock.calls).toEqual(h.shell.on.mock.calls);
});

test.each([[true, false, false], [false, true, false], [false, false, true]])('Settings TV=%s mobile=%s shortcuts=%s', (isTV, isMobile, expected) => {
    const h = harness({ isTV, isMobile });
    const menu = h.load('src/routes/Settings/Menu/Menu.tsx').default({});
    const settings = h.load('src/routes/Settings/Settings.tsx').default();
    expect(nodes(menu).some(node => node.props['data-section'] === 'shortcuts')).toBe(expected);
    expect(nodes(settings).some(node => node.type === 'shortcuts')).toBe(expected);
});

test.each([false, true])('Existing shell Settings gates remain intact (active=%s)', active => {
    const h = harness({ active, isTV: !active });
    const labels = ['SETTINGS_QUIT_ON_CLOSE', 'SETTINGS_FULLSCREEN_EXIT', 'SETTINGS_HWDEC', 'SETTINGS_GPU_VIDEO_PROCESSING', 'SETTINGS_VIDEO_MODE', 'SETTINGS_PAUSE_MINIMIZED'];
    const trees = ['Interface', 'Player'].flatMap(section => nodes(h.load(`src/routes/Settings/${section}/${section}.tsx`).default.render({ profile: {} }, null)));
    labels.forEach(label => expect(trees.some(node => node.props.label === label)).toBe(active));
    expect(trees.some(node => node.props.label === 'SETTINGS_GAMEPAD')).toBe(true);
});

test.each([false, true])('Apple script is rendered only for desktop HTML (webos=%s)', webos => {
    const loader = require('html-webpack-plugin/lib/loader');
    const source = loader.call({ getOptions: () => ({}), loaders: [{ normal: loader }], loaderIndex: 0, resourcePath: 'index.html' }, fs.readFileSync('src/index.html', 'utf8'));
    const module = { exports: {} };
    vm.runInNewContext(source, { module, require });
    const html = module.exports({ htmlWebpackPlugin: { options: { webos }, tags: { headTags: '', bodyTags: '' } } });
    expect(html.includes('appleid.auth.js')).toBe(!webos);
    expect(html.includes('cast_sender.js')).toBe(true);
});
