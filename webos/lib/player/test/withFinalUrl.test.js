/* global describe, it, expect, jest */
// withFinalUrl against a double of the inner video: the pipeline gets the final URL, what is
// dispatched while it is resolved waits, and the rest of the app keeps seeing the original link.

const { withFinalUrl, readFinalUrlSetting, FINAL_URL_KEY } = require('../withFinalUrl');

const RESOLVER = 'http://10.0.2.2:8099/redirect/t1_h264_aac.mp4';
const FINAL = 'http://10.0.2.2:8099/t1_h264_aac.mp4';
const OTHER = 'http://10.0.2.2:8099/redirect/t6_h264_aac.mkv';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const load = (url) => ({ type: 'command', commandName: 'load', commandArgs: { stream: { url, name: 'RD' }, autoplay: true, time: 2304 } });
const UNLOAD = { type: 'command', commandName: 'unload' };
const DESTROY = { type: 'command', commandName: 'destroy' };
const setProp = (propName, propValue) => ({ type: 'setProp', propName, propValue });

// The final URL service with answers the test gives: resolve() stays pending until answer(url).
const createFinalUrls = (known) => {
    const pending = [];
    const finalUrls = {
        known: Object.assign({}, known),
        resolve: jest.fn((url) => new Promise((resolve) => {
            pending.push({ url, answer: (finalUrl, source) => resolve({ url: finalUrl, source: source || 'redirect', ms: 300, host: '10.0.2.2:8099' }) });
        })),
        peek: (url) => finalUrls.known[url] || null,
        forget: jest.fn((url) => {
            delete finalUrls.known[url];
        }),
    };
    return { finalUrls, pending };
};

const createInner = () => {
    const record = { actions: [], listeners: {} };
    function Inner() {
        this.on = (eventName, listener) => {
            record.listeners[eventName] = (record.listeners[eventName] || []).concat(listener);
        };
        this.dispatch = (action) => record.actions.push(action);
    }
    Inner.manifest = { name: 'WebOsVideo', props: ['stream'], commands: ['load', 'unload', 'destroy'], events: ['propValue', 'propChanged', 'error'] };
    Inner.canPlayStream = () => Promise.resolve(true);
    record.emit = (eventName, ...args) => (record.listeners[eventName] || []).forEach((listener) => listener(...args));
    return { Inner, record };
};

const setup = (known) => {
    const { Inner, record } = createInner();
    const { finalUrls, pending } = createFinalUrls(known);
    const logs = [];
    const log = { info: (message) => logs.push(message), warn: (message) => logs.push(message) };
    const Video = withFinalUrl(Inner, { finalUrls, log });
    const video = new Video({ containerElement: {} });
    const summary = () => record.actions.map((action) => (action.type === 'command' ?
        action.commandName + (action.commandName === 'load' ? ' ' + action.commandArgs.stream.url : '') :
        action.type + ':' + action.propName));
    return { video, record, finalUrls, pending, logs, summary, Video, Inner };
};

describe('withFinalUrl', () => {
    it('loads the final URL; what was dispatched meanwhile goes after it, in order', async () => {
        const { video, record, pending, logs, summary } = setup();
        video.dispatch({ type: 'observeProp', propName: 'stream' });
        video.dispatch(UNLOAD);
        video.dispatch(load(RESOLVER));
        video.dispatch(setProp('volume', 50));
        video.dispatch(setProp('paused', false));
        // The observe and the unload (the guard's quiet release of the previous stream) go at once.
        expect(summary()).toEqual(['observeProp:stream', 'unload']);
        pending[0].answer(FINAL);
        await flush();
        expect(summary()).toEqual(['observeProp:stream', 'unload', 'load ' + FINAL, 'setProp:volume', 'setProp:paused']);
        // The rest of the load arguments stay (the resume position, autoplay, the stream's other fields).
        expect(record.actions[2].commandArgs).toEqual({ stream: { url: FINAL, name: 'RD' }, autoplay: true, time: 2304 });
        expect(logs).toEqual(['[webos] player: final URL redirect in 300 ms (10.0.2.2:8099)']);
        expect(logs.join('\n')).not.toMatch(/t1_h264/);
    });

    it('a final URL already known (a probe followed the redirect) loads at once', () => {
        const { video, finalUrls, summary } = setup({ [RESOLVER]: FINAL });
        video.dispatch(load(RESOLVER));
        video.dispatch(setProp('paused', false));
        expect(summary()).toEqual(['load ' + FINAL, 'setProp:paused']);
        expect(finalUrls.resolve).not.toHaveBeenCalled();
    });

    it('the resolver failed or was slow: the original load, untouched', async () => {
        const { video, record, pending } = setup();
        const action = load(RESOLVER);
        video.dispatch(action);
        pending[0].answer(RESOLVER, 'timeout');
        await flush();
        expect(record.actions).toEqual([action]);
    });

    it('an unload, a destroy or another load drops the load still waiting and what waited for it', async () => {
        const unloaded = setup();
        unloaded.video.dispatch(load(RESOLVER));
        unloaded.video.dispatch(setProp('paused', false));
        unloaded.video.dispatch(UNLOAD);
        unloaded.pending[0].answer(FINAL);
        await flush();
        expect(unloaded.summary()).toEqual(['unload']);

        const destroyed = setup();
        destroyed.video.dispatch(load(RESOLVER));
        destroyed.video.dispatch(DESTROY);
        destroyed.pending[0].answer(FINAL);
        await flush();
        expect(destroyed.summary()).toEqual(['destroy']);
        expect(() => destroyed.video.dispatch(UNLOAD)).toThrow('Video is destroyed');

        const replaced = setup();
        replaced.video.dispatch(load(RESOLVER));
        replaced.video.dispatch(load(OTHER));
        replaced.pending[1].answer(OTHER.replace('/redirect', ''));
        replaced.pending[0].answer(FINAL);
        await flush();
        expect(replaced.summary()).toEqual(['load ' + OTHER.replace('/redirect', '')]);
    });

    it('a load without a URL goes straight to the inner video (its own UNSUPPORTED_STREAM error)', () => {
        const { video, summary, finalUrls } = setup();
        video.dispatch({ type: 'command', commandName: 'load', commandArgs: { stream: { ytId: 'x' } } });
        expect(summary()).toEqual(['load undefined']);
        expect(finalUrls.resolve).not.toHaveBeenCalled();
    });

    it('the app sees the original link: the stream prop (same object each time) and the stream of the errors', async () => {
        const { video, record, pending } = setup();
        const props = [];
        const errors = [];
        video.on('propChanged', (propName, propValue) => props.push([propName, propValue]));
        video.on('propValue', (propName, propValue) => props.push([propName, propValue]));
        video.on('error', (error) => errors.push(error));
        video.dispatch(load(RESOLVER));
        pending[0].answer(FINAL);
        await flush();
        const innerStream = Object.freeze({ url: FINAL, name: 'RD' });
        record.emit('propChanged', 'stream', innerStream);
        record.emit('propValue', 'stream', innerStream);
        record.emit('propChanged', 'time', 12);
        record.emit('propChanged', 'stream', null);
        expect(props[0]).toEqual(['stream', { url: RESOLVER, name: 'RD' }]);
        expect(props[1][1]).toBe(props[0][1]);
        expect(props.slice(2)).toEqual([['time', 12], ['stream', null]]);
        record.emit('error', { code: 3, critical: true, stream: innerStream });
        record.emit('error', { code: 70, critical: false });
        expect(errors).toEqual([{ code: 3, critical: true, stream: { url: RESOLVER, name: 'RD' } }, { code: 70, critical: false }]);
    });

    it('a critical error forgets the final URL: the next load of the stream asks the resolver again', async () => {
        const { video, record, finalUrls } = setup({ [RESOLVER]: FINAL });
        video.dispatch(load(RESOLVER));
        record.emit('error', { code: 70, critical: false });
        expect(finalUrls.forget).not.toHaveBeenCalled();
        record.emit('error', { code: 83, critical: true });
        expect(finalUrls.forget).toHaveBeenCalledWith(RESOLVER);
        video.dispatch(UNLOAD);
        video.dispatch(load(RESOLVER));
        expect(finalUrls.resolve).toHaveBeenCalledWith(RESOLVER);
    });

    it('keeps the inner video\'s static API', () => {
        const { Video, Inner } = setup();
        expect(Video.manifest).toBe(Inner.manifest);
        expect(Video.canPlayStream).toBe(Inner.canPlayStream);
    });

    it('readFinalUrlSetting: on unless the localStorage key is "off"', () => {
        const storage = (value) => ({ getItem: (key) => (key === FINAL_URL_KEY ? value : null) });
        expect(FINAL_URL_KEY).toBe('webos.player.finalUrl');
        expect(readFinalUrlSetting(null)).toBe(true);
        expect(readFinalUrlSetting(storage(null))).toBe(true);
        expect(readFinalUrlSetting(storage('off'))).toBe(false);
        expect(readFinalUrlSetting({ getItem: () => { throw new Error('denied'); } })).toBe(true);
    });
});
