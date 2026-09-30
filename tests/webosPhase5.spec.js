const { React, loader, mount } = require('./helpers/tvDom');
const EventEmitter = require('eventemitter3');
const { getTVPlayerErrorKey } = require('../src/routes/Player/tvPlaybackPolicy');
const { decodeMagnet } = require('../src/common/decodeMagnet');

const hash = '0123456789abcdef0123456789abcdef01234567';

test('malformed magnets do not throw or masquerade as playable torrents', () => {
    for (const value of ['magnet:?xt=urn:btih:%', '', 'https://example.org/video.mp4', null]) {
        expect(() => decodeMagnet(value)).not.toThrow();
        expect(decodeMagnet(value)?.infoHash).toBeUndefined();
    }
    expect(decodeMagnet(`magnet:?xt=urn:btih:${hash}`).infoHash).toBe(hash);
});

test.each([[83, 'TV_PLAYER_CODEC_ERROR'], [82, 'TV_PLAYER_CODEC_ERROR'], [81, 'TV_PLAYER_NETWORK_ERROR'], [70, 'TV_PLAYER_SUBTITLE_ERROR'], [10000, null]])('maps library error %s to actionable TV message', (code, key) => {
    expect(getTVPlayerErrorKey(code)).toBe(key);
});

test('real published torrent converter sends create and playback URL to the selected remote server', async () => {
    const convert = require('@stremio/stremio-video/src/withStreamingServer/convertStream');
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ guessedFileIdx: 2 }) });
    try {
        const result = await convert('http://192.168.1.10:11470', { url: `magnet:?xt=urn:btih:${hash}` });
        expect(global.fetch).toHaveBeenCalledWith(`http://192.168.1.10:11470/${hash}/create`, expect.objectContaining({ method: 'POST' }));
        expect(result.url).toBe(`http://192.168.1.10:11470/${hash}/2`);
        expect(result.infoHash).toBe(hash);
        global.fetch.mockResolvedValue({ ok: false, status: 503, statusText: 'Unavailable' });
        await expect(convert('http://192.168.1.10:11470', { infoHash: hash })).rejects.toThrow('503');
    } finally { global.fetch = originalFetch; }
});

test('hook instances isolate events and destroy once on unmount', () => {
    const instances = [];
    class Video extends EventEmitter {
        constructor() { super(); instances.push(this); }
        dispatch() {}
        destroy() { this.removeAllListeners(); }
    }
    const useVideo = loader(true, { '@stremio/stremio-video': Video })('src/routes/Player/useVideo.js');
    const hooks = [];
    const Fixture = ({ index }) => { hooks[index] = useVideo(); return React.createElement('div', { ref: hooks[index].containerRef }); };
    const view = mount(React.createElement(React.Fragment, {}, React.createElement(Fixture, { index: 0 }), React.createElement(Fixture, { index: 1 })));
    const listener = jest.fn();
    hooks[0].events.on('ended', listener);
    instances[1].emit('ended');
    expect(listener).not.toHaveBeenCalled();
    instances[0].emit('ended');
    expect(listener).toHaveBeenCalledTimes(1);
    const destroy = instances.map(instance => jest.spyOn(instance, 'destroy'));
    view.unmount();
    destroy.forEach(spy => expect(spy).toHaveBeenCalledTimes(1));
    hooks.forEach(hook => expect(hook.events.eventNames()).toEqual([]));
});

test('torrent failure clears timer and loading toast; retry starts a fresh request', () => {
    jest.useFakeTimers();
    const server = { torrent: null };
    const toast = { show: jest.fn().mockReturnValue('loading'), remove: jest.fn() };
    const dispatch = jest.fn();
    const useTorrent = loader(true, {
        'stremio/core': { useCore: () => ({ transport: { dispatch } }) },
        'stremio/common/useStreamingServer': () => server,
        'stremio/common/Toast/useToast': () => toast,
        'react-i18next': { useTranslation: () => ({ t: key => key }) }
    })('src/common/useTorrent.js');
    let torrent;
    const Fixture = () => { torrent = useTorrent(); return null; };
    const view = mount(React.createElement(Fixture));
    try {
        torrent.createTorrentFromMagnet(`magnet:?xt=urn:btih:${hash}`);
        server.torrent = [hash, { type: 'Err' }];
        view.render(React.createElement(Fixture));
        expect(toast.remove).toHaveBeenCalledWith('loading');
        expect(toast.show).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'error' }));
        expect(jest.getTimerCount()).toBe(0);
        torrent.createTorrentFromMagnet(`magnet:?xt=urn:btih:${hash}`);
        expect(dispatch).toHaveBeenCalledTimes(2);
        jest.advanceTimersByTime(20000);
        expect(toast.show).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'error' }));
        expect(jest.getTimerCount()).toBe(0);
    } finally { view.unmount(); jest.useRealTimers(); }
});

describe('published WebOsVideo lifecycle with webOS build patch (simulated DOM/Luna)', () => {
    let Video, container, load, play;
    beforeEach(() => {
        jest.useFakeTimers();
        const fs = require('fs');
        const { createRequire } = require('module');
        const file = require.resolve('@stremio/stremio-video/src/WebOsVideo/WebOsVideo');
        const patch = require('../tools/webos-video-lifecycle-loader.cjs');
        const module = { exports: {} };
        new Function('require', 'module', 'exports', patch(fs.readFileSync(file, 'utf8')))(createRequire(file), module, module.exports);
        Video = module.exports;
        window.webOS = { service: { request: jest.fn() } };
        load = jest.spyOn(window.HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
        play = jest.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
        container = document.createElement('div');
        document.body.appendChild(container);
    });
    afterEach(() => {
        load.mockRestore(); play.mockRestore(); container.remove(); delete window.webOS;
        jest.useRealTimers();
    });
    const command = (video, commandName, commandArgs) => video.dispatch({ type: 'command', commandName, commandArgs });
    test('unload/destroy before mediaId cancels deferred play and removes video/style', () => {
        for (let episode = 0; episode < 3; episode++) {
            const video = new Video({ containerElement: container });
            command(video, 'load', { stream: { url: 'https://example.org/video.mp4' }, time: 12345 });
            expect(container.querySelectorAll('video')).toHaveLength(1);
            expect(jest.getTimerCount()).toBe(1);
            command(video, 'unload');
            expect(jest.getTimerCount()).toBe(0);
            jest.advanceTimersByTime(2000);
            expect(play).not.toHaveBeenCalled();
            command(video, 'destroy');
            expect(container.children).toHaveLength(0);
        }
    });
    test('reusing the implementation resets loaded before each episode', () => {
        const video = new Video({ containerElement: container });
        const props = jest.fn(); video.on('propChanged', props);
        video.dispatch({ type: 'observeProp', propName: 'loaded' });
        command(video, 'load', { stream: { url: 'https://example.org/one.mp4' } });
        container.querySelector('video').dispatchEvent(new window.Event('playing'));
        expect(props).toHaveBeenLastCalledWith('loaded', true);
        command(video, 'unload');
        expect(props).toHaveBeenLastCalledWith('loaded', null);
        command(video, 'load', { stream: { url: 'https://example.org/two.mp4' } });
        expect(props).toHaveBeenLastCalledWith('loaded', false);
        command(video, 'destroy');
    });
    test('DOM events preserve time/duration in ms, buffering, ended and friendly codec code', () => {
        const video = new Video({ containerElement: container });
        const props = jest.fn(), ended = jest.fn(), error = jest.fn();
        video.on('propChanged', props); video.on('ended', ended); video.on('error', error);
        for (const propName of ['time', 'duration', 'buffering']) video.dispatch({ type: 'observeProp', propName });
        command(video, 'load', { stream: { url: 'https://example.org/video.mp4' }, time: 12345 });
        const element = container.querySelector('video');
        element.currentTime = 12.345;
        Object.defineProperty(element, 'duration', { configurable: true, value: 7201 });
        element.dispatchEvent(new window.Event('timeupdate'));
        element.dispatchEvent(new window.Event('durationchange'));
        expect(props).toHaveBeenCalledWith('time', 12345);
        expect(props).toHaveBeenCalledWith('duration', 7201000);
        element.dispatchEvent(new window.Event('waiting'));
        expect(props.mock.calls.some(([name]) => name === 'buffering')).toBe(true);
        element.dispatchEvent(new window.Event('ended'));
        expect(ended).toHaveBeenCalledTimes(1);
        Object.defineProperty(element, 'error', { configurable: true, value: { code: 4 } });
        element.dispatchEvent(new window.Event('error'));
        expect(error).toHaveBeenCalledWith(expect.objectContaining({ code: 83, critical: true }));
        command(video, 'destroy');
    });
});

test.each(['webos', 'windows'])('TV error offers retry/another stream, desktop retains external playlist (%s)', name => {
    const onRetry = jest.fn(), onChooseStream = jest.fn();
    const Button = ({ children, ...props }) => React.createElement('button', props, children);
    const ErrorView = loader(name === 'webos', {
        'stremio/common': { usePlatform: () => ({ name }) },
        'stremio/components': { Button },
        'stremio/components/ExternalLink': { default: ({ children }) => React.createElement('a', {}, children) },
        'react-i18next': { useTranslation: () => ({ t: key => key }) },
        '@stremio/stremio-icons/react': { default: () => null }
    })('src/routes/Player/Error/Error.js');
    const view = mount(React.createElement(ErrorView, { code: 83, message: 'Unsupported', onRetry, onChooseStream, stream: { deepLinks: { externalPlayer: { playlist: 'https://example.org/list', fileName: 'list.m3u8' } } } }));
    try {
        if (name === 'webos') {
            expect(view.container.querySelector('a')).toBeNull();
            expect(view.container.textContent).toContain('TV_PLAYER_CODEC_ERROR');
            const buttons = view.container.querySelectorAll('button');
            React.act(() => buttons[0].click()); React.act(() => buttons[1].click());
            expect(onRetry).toHaveBeenCalledTimes(1); expect(onChooseStream).toHaveBeenCalledTimes(1);
        } else {
            expect(view.container.querySelector('a')).not.toBeNull();
            expect(view.container.querySelectorAll('button')).toHaveLength(0);
        }
    } finally { view.unmount(); }
});

test.each(['webos', 'windows'])('control bar applies TV speed/cast/system-volume policy (%s)', name => {
    const platform = { name, isMobile: false, shell: { active: false } };
    const cast = { active: false, on() {}, off() {} };
    const Bar = loader(name === 'webos', {
        'stremio/common': { usePlatform: () => platform, useBinaryState: () => [true, () => {}, () => {}, () => {}] },
        'stremio/services': { useServices: () => ({ chromecast: cast }) },
        'stremio/components': { Button: ({ children, ...props }) => React.createElement('button', props, children) },
        '@stremio/stremio-icons/react': { default: ({ name }) => React.createElement('i', { 'data-icon': name }) },
        './SeekBar': () => null,
        './VolumeSlider': () => React.createElement('input', { 'data-volume': true })
    })('src/routes/Player/ControlBar/ControlBar.js');
    const view = mount(React.createElement(Bar, { speedSupported: name !== 'webos', nextVideo: null, playbackSpeed: 1 }));
    try {
        for (const icon of ['speed', 'cast']) expect(!!view.container.querySelector(`[data-icon="${icon}"]`)).toBe(name !== 'webos');
        expect(!!view.container.querySelector('[data-volume]')).toBe(name !== 'webos');
        expect(view.container.querySelector('[data-icon="volume-off"]')).not.toBeNull();
    } finally { view.unmount(); }
});

test('server URL configuration trims HTTP(S) addresses and rejects non-network schemes', () => {
    const dispatch = jest.fn(), toast = { show: jest.fn() };
    const useURLs = loader(true, {
        'stremio/core': { useCore: () => ({ transport: { dispatch } }) },
        'stremio/common': { useModelState: () => ({ streamingServerUrls: [] }), useToast: () => toast },
        'stremio/common/useProfile': () => ({ settings: {} })
    })('src/routes/Settings/Streaming/URLsManager/useStreamingServerUrls.js').default;
    let manager;
    const Fixture = () => { manager = useURLs(); return null; };
    const view = mount(React.createElement(Fixture));
    try {
        for (const url of ['file:///tmp/server', 'javascript:alert(1)', 'ftp://example.org', 'not a URL']) manager.addServerUrl(url);
        expect(dispatch).not.toHaveBeenCalled();
        manager.addServerUrl('  http://192.168.1.10:11470  ');
        expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ args: { action: 'AddServerUrl', args: 'http://192.168.1.10:11470' } }));
        manager.addServerUrl('https://example.org:11470');
        expect(dispatch).toHaveBeenCalledTimes(2);
    } finally { view.unmount(); }
});

test('Player resumes load when the same remote URL becomes Ready and reloads a changed transport', () => {
    const fs = require('fs'), ts = require('typescript'), vm = require('vm');
    const ast = ts.createSourceFile('Player.jsx', fs.readFileSync('src/routes/Player/Player.js', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
    let loadEffect;
    const visit = node => {
        if (ts.isCallExpression(node) && node.expression.getText(ast) === 'React.useEffect' && node.arguments[0].getText(ast).includes('video.load(')) loadEffect = node.getText(ast);
        ts.forEachChild(node, visit);
    };
    visit(ast);
    const video = { load: jest.fn(), unload: jest.fn() };
    const context = {
        React, video, window, setError() {}, cancelKeyboardSeek() {}, onError: jest.fn(),
        videoPlatform: 'webOS', getVideoPlatformError: () => null,
        player: { selected: {}, stream: { type: 'Ready', content: { url: 'https://example.org/video.mp4' } }, libraryItem: null },
        streamSubtitles: [], forceTranscoding: false, casting: false, retryAttempt: 0,
        settings: {}, platform: { name: 'webos', shell: { active: false, capabilities: {} } }, services: { chromecast: { active: false } }
    };
    const Fixture = ({ server }) => {
        vm.runInNewContext(`(${loadEffect})`, { ...context, streamingServer: server });
        return null;
    };
    const server = { baseUrl: 'http://192.168.1.10:11470', selected: { transportUrl: 'http://192.168.1.10:11470' }, settings: { type: 'Loading' } };
    const view = mount(React.createElement(Fixture, { server }));
    try {
        expect(video.load).not.toHaveBeenCalled();
        view.render(React.createElement(Fixture, { server: { ...server, settings: { type: 'Ready' } } }));
        expect(video.load).toHaveBeenCalledTimes(1);
        view.render(React.createElement(Fixture, { server: { ...server, settings: { type: 'Ready' }, selected: { transportUrl: 'https://remote.example.org' } } }));
        expect(video.load).toHaveBeenCalledTimes(2);
        expect(video.load).toHaveBeenLastCalledWith(expect.objectContaining({ streamingServerURL: 'https://remote.example.org' }), expect.any(Object));
    } finally { view.unmount(); }
});
