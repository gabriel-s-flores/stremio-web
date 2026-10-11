/**
 * @jest-environment jsdom
 */
/* global describe, it, expect, jest */
// F3.7b: the state of useVideo.webos.js changes at every timeupdate, the add-on subtitle tracks do not.
// The tracks the Player reads (restored to the add-on URLs) keep their reference between timeupdates:
// SubtitlesMenu and OptionsMenu are React.memo, and the subtitle selection effect depends on the array.

const path = require('path');
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;

const PLAYER_DIR = path.join(__dirname, '..', '..', '..', '..', 'src', 'routes', 'Player');

jest.mock('../../../../src/routes/Player/useVideo.js', () => {
    const upstream = {
        events: new (require('eventemitter3'))(),
        state: { playbackSpeed: 1, time: 0, extraSubtitlesTracks: [] },
        load: jest.fn(),
        addExtraSubtitlesTracks: jest.fn(),
        setPlaybackSpeed: jest.fn(),
    };
    const useVideo = () => upstream;
    useVideo.upstream = upstream;
    return useVideo;
});
jest.mock('../../../../webos/tlsproxy/page', () => ({ __esModule: true, default: { proxify: (url) => url } }));

const upstream = require(path.join(PLAYER_DIR, 'useVideo.js')).upstream;
const useVideo = require(path.join(PLAYER_DIR, 'useVideo.webos.js'));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PROXY = 'http://127.0.0.1:47443/proxy?t=x&url=' + encodeURIComponent('https://debrid-link.com/a.srt');

const mount = async () => {
    const seen = [];
    const Probe = () => {
        seen.push(useVideo());
        return null;
    };
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => root.render(React.createElement(Probe)));
    return {
        seen,
        rerender: () => act(async () => root.render(React.createElement(Probe))),
        unmount: () => act(async () => root.unmount()),
    };
};

describe('useVideo.webos state', () => {
    it('keeps the restored subtitle tracks (same array) between timeupdates, and renews them when the tracks change', async () => {
        const tracks = [{ id: 'a', url: PROXY, lang: 'eng' }];
        upstream.state = { playbackSpeed: 1, time: 1000, extraSubtitlesTracks: tracks };
        const probe = await mount();
        const first = probe.seen[probe.seen.length - 1].state;
        expect(first.extraSubtitlesTracks[0].url).toBe('https://debrid-link.com/a.srt');

        // timeupdate: a new state object with the very same tracks array
        upstream.state = { ...upstream.state, time: 2000 };
        await probe.rerender();
        const second = probe.seen[probe.seen.length - 1].state;
        expect(second).not.toBe(first);
        expect(second.time).toBe(2000);
        expect(second.extraSubtitlesTracks).toBe(first.extraSubtitlesTracks);
        expect(second.extraSubtitlesTracks[0]).toBe(first.extraSubtitlesTracks[0]);

        // the pipeline reports other tracks: a new restored array
        upstream.state = { ...upstream.state, time: 3000, extraSubtitlesTracks: tracks.concat({ id: 'b', url: 'https://example.com/b.srt', lang: 'por' }) };
        await probe.rerender();
        const third = probe.seen[probe.seen.length - 1].state;
        expect(third.extraSubtitlesTracks).not.toBe(first.extraSubtitlesTracks);
        expect(third.extraSubtitlesTracks).toHaveLength(2);
        expect(third.extraSubtitlesTracks[0].url).toBe('https://debrid-link.com/a.srt');
        await probe.unmount();
    });

    it('without proxy URLs the tracks are the pipeline\'s own array, also between timeupdates', async () => {
        const tracks = [{ id: 'b', url: 'https://example.com/b.srt', lang: 'por' }];
        upstream.state = { playbackSpeed: 1, time: 1000, extraSubtitlesTracks: tracks };
        const probe = await mount();
        upstream.state = { ...upstream.state, time: 2000 };
        await probe.rerender();
        const states = probe.seen.map((value) => value.state);
        expect(states[states.length - 1].extraSubtitlesTracks).toBe(tracks);
        await probe.unmount();
    });
});
