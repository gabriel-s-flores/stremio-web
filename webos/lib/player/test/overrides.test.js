// The Player overrides (useVideo.webos.js, ControlBar.webos.js) against upstream doubles: what they
// pass on and what they change. The real upstream files need the app's webpack aliases; their
// shape is checked by upstream.test.js.

const path = require('path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const PLAYER_DIR = path.join(__dirname, '..', '..', '..', '..', 'src', 'routes', 'Player');

jest.mock('../../../../src/routes/Player/useVideo.js', () => {
    const upstream = {
        state: { playbackSpeed: 1, time: 5000, duration: 20000 },
        load: jest.fn(),
        addExtraSubtitlesTracks: jest.fn(),
        setPlaybackSpeed: jest.fn(),
        setPaused: jest.fn(),
    };
    const useVideo = () => upstream;
    useVideo.upstream = upstream;
    return useVideo;
});

// The tlsproxy of the page (F3.7): debrid-link.com is a known Let's Encrypt host.
jest.mock('../../../../webos/tlsproxy/page', () => ({
    __esModule: true,
    default: {
        proxify: (url) => (url.indexOf('https://debrid-link.com/') === 0 ? 'http://127.0.0.1:47443/proxy?t=x&url=' + encodeURIComponent(url) : url),
    },
}));

// Same parts of the upstream render the override relies on: the speed button opens the menu
// through onClick, and the seek bar label divides the remaining time by playbackSpeed.
jest.mock('../../../../src/routes/Player/ControlBar/ControlBar.js', () => {
    const MockReact = require('react');
    const h = MockReact.createElement;
    const ControlBar = MockReact.forwardRef((props, ref) => h('div', { ref, id: 'bar' },
        h('span', { id: 'remaining' }, String((props.duration - props.time) / props.playbackSpeed)),
        h('div', { id: 'buttons' },
            h('button', { id: 'play', onClick: props.onPlayRequested }),
            h('button', { id: 'speed', onClick: props.onToggleSpeedMenu, className: props.playbackSpeed === null ? 'disabled' : '' }),
            h('button', { id: 'audio', onClick: props.onToggleAudioMenu }),
        ),
    ));
    ControlBar.propTypes = { time: () => null };
    return ControlBar;
});

const upstreamVideo = require(path.join(PLAYER_DIR, 'useVideo.js')).upstream;
const useVideo = require(path.join(PLAYER_DIR, 'useVideo.webos.js'));
const ControlBar = require(path.join(PLAYER_DIR, 'ControlBar', 'ControlBar.webos.js'));

const renderHook = (hook) => {
    let result = null;
    const Probe = () => {
        result = hook();
        return null;
    };
    renderToStaticMarkup(React.createElement(Probe));
    return result;
};

describe('useVideo.webos', () => {
    beforeEach(() => {
        upstreamVideo.load.mockClear();
        upstreamVideo.addExtraSubtitlesTracks.mockClear();
        upstreamVideo.setPlaybackSpeed.mockClear();
    });

    it('reports no playback speed and keeps the rest of the state', () => {
        const video = renderHook(useVideo);
        expect(video.state.playbackSpeed).toBeNull();
        expect(video.state.time).toBe(5000);
        expect(video.state.duration).toBe(20000);
        expect(upstreamVideo.state.playbackSpeed).toBe(1);
    });

    it('ignores speed changes', () => {
        const video = renderHook(useVideo);
        video.setPlaybackSpeed(2);
        expect(upstreamVideo.setPlaybackSpeed).not.toHaveBeenCalled();
    });

    it('loads with the webOS arguments and passes the options through', () => {
        const video = renderHook(useVideo);
        const options = { shellTransport: null };
        video.load({ stream: { url: 'https://example.com/a.mkv' }, forceTranscoding: true, maxAudioChannels: 2, streamingServerURL: 'http://127.0.0.1:11470/', platform: 'webOS' }, options);
        expect(upstreamVideo.load).toHaveBeenCalledTimes(1);
        const [args, passedOptions] = upstreamVideo.load.mock.calls[0];
        expect(args).toEqual({ stream: { url: 'https://example.com/a.mkv' }, forceTranscoding: false, maxAudioChannels: 32, streamingServerURL: null, assSubtitlesStyling: false, platform: 'webOS' });
        expect(passedOptions).toBe(options);
    });

    it('turns the ASS styling off (libass is a stub on webOS)', () => {
        const video = renderHook(useVideo);
        video.load({ stream: { url: 'https://example.com/a.mkv' }, assSubtitlesStyling: true });
        expect(upstreamVideo.load.mock.calls[0][0].assSubtitlesStyling).toBe(false);
    });

    it('sends the add-on subtitles of Let\'s Encrypt hosts through the tlsproxy', () => {
        const video = renderHook(useVideo);
        const other = { id: 'b', url: 'https://opensubtitles.example/b.srt', lang: 'por' };
        video.addExtraSubtitlesTracks([{ id: 'a', url: 'https://debrid-link.com/a.srt', lang: 'eng' }, other]);
        const [tracks] = upstreamVideo.addExtraSubtitlesTracks.mock.calls[0];
        expect(tracks[0]).toEqual({ id: 'a', url: 'http://127.0.0.1:47443/proxy?t=x&url=' + encodeURIComponent('https://debrid-link.com/a.srt'), lang: 'eng' });
        expect(tracks[1]).toBe(other);
    });

    it('also the subtitles that come with the stream; the stream stays the same object without them', () => {
        const video = renderHook(useVideo);
        const plain = { url: 'https://example.com/a.mkv', subtitles: [{ id: 'b', url: 'https://example.com/b.srt', lang: 'por' }] };
        video.load({ stream: plain });
        expect(upstreamVideo.load.mock.calls[0][0].stream).toBe(plain);
        video.load({ stream: { url: 'https://example.com/a.mkv', subtitles: [{ id: 'a', url: 'https://debrid-link.com/a.srt', lang: 'eng' }] } });
        expect(upstreamVideo.load.mock.calls[1][0].stream.subtitles[0].url).toBe('http://127.0.0.1:47443/proxy?t=x&url=' + encodeURIComponent('https://debrid-link.com/a.srt'));
    });

    it('keeps the other upstream commands', () => {
        const video = renderHook(useVideo);
        expect(video.setPaused).toBe(upstreamVideo.setPaused);
    });
});

describe('ControlBar.webos', () => {
    const onToggleSpeedMenu = () => {};
    const props = { time: 5000, duration: 20000, playbackSpeed: null, onToggleSpeedMenu, onPlayRequested: () => {}, onToggleAudioMenu: () => {} };
    const markup = () => renderToStaticMarkup(React.createElement(ControlBar, props));

    it('drops the speed button and keeps the others', () => {
        expect(markup()).not.toContain('id="speed"');
        expect(markup()).toContain('id="play"');
        expect(markup()).toContain('id="audio"');
    });

    it('renders the bar at the native rate, so the remaining time is a number (not Infinity)', () => {
        expect(markup()).toContain('<span id="remaining">15000</span>');
    });

    it('keeps the upstream propTypes', () => {
        expect(ControlBar.propTypes).toBe(require(path.join(PLAYER_DIR, 'ControlBar', 'ControlBar.js')).propTypes);
    });
});
