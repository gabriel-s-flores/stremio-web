/* global describe, it, expect, beforeAll, beforeEach, jest */
// The WebOsVideo decorator against a double of WebOsVideo and of the <video> element: what it
// lists, what it switches on the element and what it passes through.

const { probeFixture } = require('../../c8-rules/test/helpers');
const withC8Tracks = require('../withC8Tracks');

const URL = 'http://10.0.2.2:8099/redirect/t2_multi.mkv';

// AudioTrackList double: array-like, with events.
const createTrackList = (languages, enabledIndex) => {
    const list = { length: 0, handlers: {} };
    list.addEventListener = (name, handler) => {
        list.handlers[name] = (list.handlers[name] || []).concat(handler);
    };
    list.removeEventListener = (name, handler) => {
        list.handlers[name] = (list.handlers[name] || []).filter((entry) => entry !== handler);
    };
    list.fire = (name) => (list.handlers[name] || []).forEach((handler) => handler());
    list.set = (codes, enabled) => {
        for (let i = 0; i < list.length; i++) delete list[i];
        codes.forEach((language, i) => {
            list[i] = { language, label: '', enabled: i === enabled };
        });
        list.length = codes.length;
    };
    list.set(languages, enabledIndex);
    return list;
};

const createElement = (audioTracks) => {
    const element = { audioTracks, handlers: {} };
    element.addEventListener = (name, handler) => {
        element.handlers[name] = (element.handlers[name] || []).concat(handler);
    };
    element.removeEventListener = (name, handler) => {
        element.handlers[name] = (element.handlers[name] || []).filter((entry) => entry !== handler);
    };
    element.fire = (name) => (element.handlers[name] || []).forEach((handler) => handler());
    return element;
};

// WebOsVideo double: records the actions, emits on demand.
const createInnerVideo = () => {
    function Inner() {
        const handlers = {};
        Inner.instance = this;
        this.actions = [];
        this.on = (name, handler) => {
            handlers[name] = (handlers[name] || []).concat(handler);
        };
        this.emit = (name, ...args) => (handlers[name] || []).forEach((handler) => handler(...args));
        this.dispatch = (action) => this.actions.push(action);
    }
    Inner.manifest = {
        name: 'WebOsVideo',
        props: ['stream', 'audioTracks', 'selectedAudioTrackId', 'subtitlesTracks', 'selectedSubtitlesTrackId', 'time'],
        commands: ['load', 'unload', 'destroy'],
        events: ['propValue', 'propChanged', 'ended', 'error', 'subtitlesTrackLoaded', 'audioTrackLoaded'],
    };
    Inner.canPlayStream = () => Promise.resolve(true);
    return Inner;
};

const deferred = () => {
    const out = {};
    out.promise = new Promise((resolve, reject) => Object.assign(out, { resolve, reject }));
    return out;
};
const commands = (inner) => inner.actions.filter((action) => action.type === 'command').map((action) => action.commandName);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

let kit = null;
beforeAll(async () => {
    kit = await probeFixture('kit-multi-mkv');
});

const setup = (options) => {
    const opts = options || {};
    const Inner = createInnerVideo();
    const probe = deferred();
    const probeCache = { get: jest.fn(() => probe.promise), peek: jest.fn(() => null) };
    const trackList = createTrackList(opts.languages || [], opts.enabled === undefined ? null : opts.enabled);
    const element = createElement(trackList);
    const containerElement = { querySelector: () => element };
    const Video = withC8Tracks(Inner, { probeCache });
    const video = new Video({ containerElement });
    const events = [];
    ['propValue', 'propChanged', 'audioTrackLoaded', 'ended', 'error'].forEach((name) => {
        video.on(name, (...args) => events.push([name].concat(args)));
    });
    ['audioTracks', 'selectedAudioTrackId', 'subtitlesTracks', 'time'].forEach((propName) => {
        video.dispatch({ type: 'observeProp', propName });
    });
    const last = (propName) => events.filter((event) => event[0].startsWith('prop') && event[1] === propName).slice(-1)[0][2];
    const load = () => video.dispatch({ type: 'command', commandName: 'load', commandArgs: { stream: { url: URL } } });
    const play = () => element.fire('playing');
    const enabled = () => Array.from({ length: trackList.length }, (_, i) => trackList[i].enabled);
    return { Inner, inner: Inner.instance, probe, probeCache, trackList, element, video, events, last, load, play, enabled };
};

describe('withC8Tracks', () => {
    let t;
    beforeEach(() => {
        t = setup({ languages: ['en', 'pt', 'en'], enabled: 0 });
    });

    it('keeps the manifest and canPlayStream of WebOsVideo (withHTMLSubtitles reads the name)', () => {
        const Video = withC8Tracks(t.Inner, { probeCache: t.probeCache });
        expect(Video.manifest).toBe(t.Inner.manifest);
        expect(Video.canPlayStream).toBe(t.Inner.canPlayStream);
    });

    it('load: WebOsVideo loads first, then the probe starts (without waiting), once per load', () => {
        t.load();
        expect(commands(t.inner)).toEqual(['load']);
        expect(t.probeCache.get).toHaveBeenCalledTimes(1);
        expect(t.probeCache.get).toHaveBeenCalledWith(URL);
        // the element already lists its tracks: they show up at once (language only)
        expect(t.last('audioTracks').map((track) => [track.id, track.lang])).toEqual([['EMBEDDED_0', 'en'], ['EMBEDDED_1', 'pt'], ['EMBEDDED_2', 'en']]);
        expect(t.last('selectedAudioTrackId')).toBe('EMBEDDED_0');
        t.play();
        expect(t.probeCache.get).toHaveBeenCalledTimes(1);
    });

    it('a probe already in the cache is used at load, without a request', () => {
        t.probeCache.peek.mockReturnValue(kit);
        t.load();
        expect(t.probeCache.peek).toHaveBeenCalledWith(URL);
        expect(t.last('audioTracks').map((track) => track.label)).toEqual(['English AAC · AAC 1.0', 'Portugues AAC · AAC 1.0', 'AC3 5.1']);
        t.play();
        expect(t.probeCache.get).not.toHaveBeenCalled();
        expect(t.last('subtitlesTracks').length).toBe(2);
    });

    it('probe done: the menu gets the file languages and codecs; the subtitles once the video plays', async () => {
        t.load();
        t.probe.resolve(kit);
        await flush();
        expect(t.last('audioTracks').length).toBe(3);
        expect(t.last('subtitlesTracks')).toEqual([]);
        t.play();
        expect(t.last('audioTracks').map((track) => [track.id, track.lang, track.label, track.mode])).toEqual([
            ['EMBEDDED_0', 'eng', 'English AAC · AAC 1.0', 'showing'],
            ['EMBEDDED_1', 'por', 'Portugues AAC · AAC 1.0', 'disabled'],
            ['EMBEDDED_2', 'eng', 'AC3 5.1', 'disabled'],
        ]);
        expect(t.last('subtitlesTracks').map((track) => [track.id, track.lang])).toEqual([['EMBEDDED_0', 'eng'], ['EMBEDDED_1', 'por']]);
    });

    it('switch: enables the chosen track, disables the others, and does not go to WebOsVideo (no Luna)', async () => {
        t.load();
        t.play();
        t.probe.resolve(kit);
        await flush();
        t.video.dispatch({ type: 'setProp', propName: 'selectedAudioTrackId', propValue: 'EMBEDDED_1' });
        expect([0, 1, 2].map((i) => t.trackList[i].enabled)).toEqual([false, true, false]);
        expect(t.inner.actions.filter((action) => action.type === 'setProp')).toEqual([]);
        expect(t.last('selectedAudioTrackId')).toBe('EMBEDDED_1');
        expect(t.last('audioTracks').map((track) => track.mode)).toEqual(['disabled', 'showing', 'disabled']);
        expect(t.events.filter((event) => event[0] === 'audioTrackLoaded').map((event) => event[1].id)).toEqual(['EMBEDDED_1']);
    });

    it('switch to an unknown id or before a load: ignored', () => {
        t.video.dispatch({ type: 'setProp', propName: 'selectedAudioTrackId', propValue: 'EMBEDDED_1' });
        expect(t.trackList[1].enabled).toBe(false);
        t.load();
        t.play();
        t.video.dispatch({ type: 'setProp', propName: 'selectedAudioTrackId', propValue: 'EMBEDDED_7' });
        t.video.dispatch({ type: 'setProp', propName: 'selectedAudioTrackId', propValue: 'EXCLUSIVE_1' });
        expect([0, 1, 2].map((i) => t.trackList[i].enabled)).toEqual([true, false, false]);
    });

    it('switch before the video plays: shown as selected, applied on the first playing (the pipeline is left alone while it starts)', async () => {
        t = setup({ languages: [] });
        t.probeCache.peek.mockReturnValue(kit);
        t.load();
        t.video.dispatch({ type: 'setProp', propName: 'selectedAudioTrackId', propValue: 'EMBEDDED_2' });
        expect(t.last('selectedAudioTrackId')).toBe('EMBEDDED_2');
        t.trackList.set(['en', 'pt', 'en'], 0);
        t.trackList.fire('addtrack');
        t.element.fire('loadedmetadata');
        expect(t.enabled()).toEqual([true, false, false]);
        expect(t.last('selectedAudioTrackId')).toBe('EMBEDDED_2');
        t.play();
        expect(t.enabled()).toEqual([false, false, true]);
        expect(t.last('selectedAudioTrackId')).toBe('EMBEDDED_2');
        expect(t.last('audioTracks').map((track) => track.mode)).toEqual(['disabled', 'disabled', 'showing']);
    });

    it('switch after the video played but before the element lists its tracks: applied when they show up', async () => {
        t = setup({ languages: [] });
        t.load();
        t.play();
        t.probe.resolve(kit);
        await flush();
        t.video.dispatch({ type: 'setProp', propName: 'selectedAudioTrackId', propValue: 'EMBEDDED_1' });
        t.trackList.set(['en', 'pt', 'en'], 0);
        t.trackList.fire('addtrack');
        expect(t.enabled()).toEqual([false, true, false]);
    });

    it('a new load waits for its own first playing', async () => {
        t.load();
        t.play();
        t.load();
        t.video.dispatch({ type: 'setProp', propName: 'selectedAudioTrackId', propValue: 'EMBEDDED_1' });
        expect(t.enabled()).toEqual([true, false, false]);
        t.play();
        expect(t.enabled()).toEqual([false, true, false]);
    });

    it('follows changes made on the element itself', async () => {
        t.load();
        t.trackList.set(['en', 'pt', 'en'], 2);
        t.trackList.fire('change');
        expect(t.last('selectedAudioTrackId')).toBe('EMBEDDED_2');
    });

    it('probe failure: the element list stays', async () => {
        t.load();
        t.play();
        t.probe.reject(Object.assign(new Error('x'), { code: 'TIMEOUT' }));
        await flush();
        expect(t.last('audioTracks').map((track) => track.lang)).toEqual(['en', 'pt', 'en']);
        expect(t.last('subtitlesTracks')).toEqual([]);
    });

    it('the WebOsVideo track props are replaced; the others pass through', () => {
        t.load();
        const before = t.events.length;
        t.inner.emit('propChanged', 'audioTracks', [{ id: 'EMBEDDED_0' }]);
        t.inner.emit('propChanged', 'subtitlesTracks', []);
        t.inner.emit('propValue', 'selectedAudioTrackId', 'EMBEDDED_0');
        expect(t.events.length).toBe(before);
        t.inner.emit('propChanged', 'time', 1000);
        t.inner.emit('ended');
        t.inner.emit('error', { code: 1 });
        expect(t.events.slice(before)).toEqual([['propChanged', 'time', 1000], ['ended'], ['error', { code: 1 }]]);
        // observing a track prop answers here and does not reach WebOsVideo
        expect(t.inner.actions.filter((action) => action.type === 'observeProp').map((action) => action.propName)).toEqual(['time']);
    });

    it('only publishes a prop when it changes', () => {
        t.load();
        const count = () => t.events.filter((event) => event[0] === 'propChanged' && event[1] === 'audioTracks').length;
        const before = count();
        t.trackList.fire('change');
        expect(count()).toBe(before);
    });

    it('unload, or WebOsVideo unloading on its own after an error: empty lists, a late probe is dropped', async () => {
        t.load();
        t.play();
        t.video.dispatch({ type: 'command', commandName: 'unload' });
        expect(commands(t.inner)).toEqual(['load', 'unload']);
        expect(t.last('audioTracks')).toEqual([]);
        expect(t.last('selectedAudioTrackId')).toBeNull();
        t.probe.resolve(kit);
        await flush();
        expect(t.last('subtitlesTracks')).toEqual([]);

        const u = setup({ languages: ['en'], enabled: 0 });
        u.load();
        expect(u.last('audioTracks').length).toBe(1);
        u.inner.emit('propChanged', 'stream', null);
        expect(u.last('audioTracks')).toEqual([]);
    });

    it('a probe that resolves after the next load is dropped', async () => {
        const first = deferred();
        const second = deferred();
        t.probeCache.get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
        t.load();
        t.play();
        t.load();
        t.play();
        first.resolve(kit);
        await flush();
        expect(t.last('subtitlesTracks')).toEqual([]);
        second.resolve(kit);
        await flush();
        expect(t.last('subtitlesTracks').length).toBe(2);
    });

    it('destroy: removes its listeners and destroys WebOsVideo', () => {
        t.load();
        t.video.dispatch({ type: 'command', commandName: 'destroy' });
        expect(commands(t.inner)).toEqual(['load', 'destroy']);
        expect(t.trackList.handlers.change).toEqual([]);
        expect(t.element.handlers.loadedmetadata).toEqual([]);
        expect(t.element.handlers.playing).toEqual([]);
        expect(() => t.video.dispatch({ type: 'command', commandName: 'unload' })).toThrow('Video is destroyed');
    });
});
