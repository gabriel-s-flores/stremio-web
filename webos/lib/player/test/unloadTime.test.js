/**
 * @jest-environment jsdom
 */
// useVideo.webos.js (F5.7): after unload() the pipeline guard keeps the old stream in the state for
// about a second (quiet release). Its time must not reach the Player meanwhile: the Player reports
// it as the time of the next video, and the core keeps it as the position of the next episode.

const path = require('path');
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;

const PLAYER_DIR = path.join(__dirname, '..', '..', '..', '..', 'src', 'routes', 'Player');

// The upstream hook with a state the test drives, like stremio-video's propChanged events.
jest.mock('../../../../src/routes/Player/useVideo.js', () => {
    const MockReact = require('react');
    const controls = { setState: null, unload: jest.fn(), load: jest.fn() };
    const useVideo = () => {
        const [state, setState] = MockReact.useState({ stream: null, time: null, duration: null, playbackSpeed: 1 });
        controls.setState = setState;
        return {
            state,
            containerRef: { current: null },
            load: controls.load,
            unload: controls.unload,
            addExtraSubtitlesTracks: () => {},
            setPlaybackSpeed: () => {},
        };
    };
    useVideo.controls = controls;
    return useVideo;
});

jest.mock('../../../../webos/tlsproxy/page', () => ({ __esModule: true, default: { proxify: (url) => url } }));

const { controls } = require(path.join(PLAYER_DIR, 'useVideo.js'));
const useVideo = require(path.join(PLAYER_DIR, 'useVideo.webos.js'));

let video;
let root;
const Probe = () => {
    video = useVideo();
    return null;
};
const set = (patch) => act(() => controls.setState((state) => ({ ...state, ...patch })));

beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    root = createRoot(document.createElement('div'));
    act(() => root.render(React.createElement(Probe)));
    controls.unload.mockClear();
});

afterEach(() => {
    act(() => root.unmount());
});

describe('useVideo.webos unload', () => {
    const episode1 = { url: 'http://media/ep1.mp4' };
    const episode2 = { url: 'http://media/ep2.mp4' };

    it('the stream being unloaded has no time until the unload really happens', () => {
        set({ stream: episode1, time: 568000, duration: 600000 });
        expect(video.state.time).toBe(568000);
        act(() => video.unload());
        expect(controls.unload).toHaveBeenCalledTimes(1);
        expect(video.state.time).toBeNull();
        expect(video.state.duration).toBeNull();
        // The guard pauses the element: one more timeupdate of the old stream.
        set({ time: 568200, paused: true });
        expect(video.state.time).toBeNull();
        expect(video.state.paused).toBe(true);
        // The real unload (stream null), then the next stream.
        set({ stream: null, time: null, duration: null });
        set({ stream: episode2, time: 0, duration: 90000 });
        expect(video.state.time).toBe(0);
        expect(video.state.duration).toBe(90000);
    });

    it('an unload with nothing loaded hides nothing afterwards', () => {
        act(() => video.unload());
        set({ stream: episode2, time: 1000, duration: 90000 });
        expect(video.state.time).toBe(1000);
    });

    it('still reports no playback speed', () => {
        set({ stream: episode1, time: 5000, playbackSpeed: 1 });
        expect(video.state.playbackSpeed).toBeNull();
        act(() => video.unload());
        expect(video.state.playbackSpeed).toBeNull();
    });
});
