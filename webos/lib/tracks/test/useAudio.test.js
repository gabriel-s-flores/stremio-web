/**
 * @jest-environment jsdom
 */
/* global describe, it, expect, beforeAll, beforeEach, afterEach, jest */
// src/routes/Player/useAudio.webos.js with its effects running: the track it selects on its own
// (C8 rules over the probe of the stream) and what a menu choice saves.

const path = require('path');
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;
const { probeFixture } = require('../../c8-rules/test/helpers');

jest.mock('../probe-cache', () => {
    const results = {};
    return { probeCache: { peek: (url) => results[url] || null, results } };
});

const { probeCache } = require('../probe-cache');
const { buildAudioTracks } = require('../index');
const { evaluate } = require('../../c8-rules');
const useAudio = require(path.join(__dirname, '..', '..', '..', '..', 'src', 'routes', 'Player', 'useAudio.webos.js')).default;

const URL = 'http://10.0.2.2:8099/redirect/t2_multi.mkv';
const ELEMENT = [{ language: 'en', label: '', enabled: true }, { language: 'pt', label: '', enabled: false }, { language: 'en', label: '', enabled: false }];

global.IS_REACT_ACT_ENVIRONMENT = true;

let kit = null;
beforeAll(async () => {
    kit = await probeFixture('kit-multi-mkv');
});

let container;
let root;
let latest;
const Harness = (props) => {
    latest = useAudio(props);
    return null;
};
const render = (props) => act(() => {
    root.render(React.createElement(Harness, props));
});

const makeProps = ({ withProbe = true, audioLanguage = 'eng', audioPreference = null, streamState = null, tracks } = {}) => {
    if (withProbe) probeCache.results[URL] = kit;
    else delete probeCache.results[URL];
    const audioTracks = tracks || buildAudioTracks({ probe: withProbe ? kit : null, rules: withProbe ? evaluate({ probe: kit }) : null, elementTracks: ELEMENT, selectedIndex: 0 });
    return {
        player: { streamState, audioPreference },
        video: { state: { stream: { url: URL }, audioTracks, selectedAudioTrackId: 'EMBEDDED_0' }, setAudioTrack: jest.fn() },
        settings: { audioLanguage },
        streamStateChanged: jest.fn(),
        audioPreferenceChanged: jest.fn(),
    };
};

beforeEach(() => {
    container = document.createElement('div');
    root = createRoot(container);
});
afterEach(() => {
    act(() => root.unmount());
});

describe('useAudio.webos', () => {
    it('t2_multi.mkv with the setting in English: the AC-3 5.1 English track (best codec in the language)', () => {
        const props = makeProps({ audioLanguage: 'eng' });
        render(props);
        expect(props.video.setAudioTrack.mock.calls).toEqual([['EMBEDDED_2']]);
    });

    it('the stream audio preference comes before the global setting', () => {
        const props = makeProps({ audioLanguage: 'eng', audioPreference: { language: 'por' } });
        render(props);
        expect(props.video.setAudioTrack.mock.calls).toEqual([['EMBEDDED_1']]);
    });

    it('the track saved for the stream wins', () => {
        const props = makeProps({ audioLanguage: 'eng', streamState: { audioTrack: { id: 'EMBEDDED_0', language: 'eng' } } });
        render(props);
        expect(props.video.setAudioTrack.mock.calls).toEqual([['EMBEDDED_0']]);
    });

    it('without the probe: the first track in the preferred language', () => {
        const props = makeProps({ withProbe: false, audioLanguage: 'por' });
        render(props);
        expect(props.video.setAudioTrack.mock.calls).toEqual([['EMBEDDED_1']]);
    });

    it('selects once, not again on every render with the same choice', () => {
        const props = makeProps({ audioLanguage: 'eng' });
        render(props);
        render({ ...props, video: { ...props.video, state: { ...props.video.state, audioTracks: props.video.state.audioTracks.slice() } } });
        expect(props.video.setAudioTrack).toHaveBeenCalledTimes(1);
    });

    it('a menu choice switches, saves the stream state and the preference, and locks the automatic choice', () => {
        const props = makeProps({ audioLanguage: 'eng' });
        render(props);
        act(() => latest('EMBEDDED_1'));
        expect(props.video.setAudioTrack.mock.calls).toEqual([['EMBEDDED_2'], ['EMBEDDED_1']]);
        expect(props.streamStateChanged).toHaveBeenCalledWith({ audioTrack: { id: 'EMBEDDED_1', language: 'por' } });
        expect(props.audioPreferenceChanged).toHaveBeenCalledWith({ language: 'por' });
        render({ ...props, video: { ...props.video, state: { ...props.video.state, selectedAudioTrackId: 'EMBEDDED_1' } } });
        expect(props.video.setAudioTrack).toHaveBeenCalledTimes(2);
    });

    it('a menu choice of an unknown id does nothing', () => {
        const props = makeProps();
        render(props);
        act(() => latest('EMBEDDED_9'));
        expect(props.streamStateChanged).not.toHaveBeenCalled();
    });

    it('no stream, or no tracks yet: no selection', () => {
        const props = makeProps({ tracks: [] });
        render(props);
        render({ ...props, video: { ...props.video, state: { ...props.video.state, stream: null } } });
        expect(props.video.setAudioTrack).not.toHaveBeenCalled();
    });

    it('saves the language code the upstream saves (langs "2": "bn" from video.audioTracks -> "ben")', () => {
        const tracks = buildAudioTracks({ probe: null, rules: null, elementTracks: [{ language: 'en', label: '', enabled: true }, { language: 'bn', label: '', enabled: false }], selectedIndex: 0 });
        const props = makeProps({ withProbe: false, tracks });
        render(props);
        act(() => latest('EMBEDDED_1'));
        expect(props.streamStateChanged).toHaveBeenCalledWith({ audioTrack: { id: 'EMBEDDED_1', language: 'ben' } });
        expect(props.audioPreferenceChanged).toHaveBeenCalledWith({ language: 'ben' });
    });

    it('a saved preference in another code form matches the track ("ben" preference, "bn" track)', () => {
        const tracks = buildAudioTracks({ probe: null, rules: null, elementTracks: [{ language: 'en', label: '', enabled: true }, { language: 'bn', label: '', enabled: false }], selectedIndex: 0 });
        const props = makeProps({ withProbe: false, tracks, audioLanguage: 'eng', audioPreference: { language: 'ben' } });
        render(props);
        expect(props.video.setAudioTrack.mock.calls).toEqual([['EMBEDDED_1']]);
    });
});
