/* global describe, it, expect, beforeEach */
// The pipeline guard against a double of WebOsVideo (same calls on the element as the upstream
// one) and of the <video> element, on a manual clock: when the pipeline is released, how many
// pipelines a load creates, and the start watchdog.

const { withPipelineGuard, keepVideosConnected, RELEASE_SETTLE_MS, START_TIMEOUT_MS, SUBTITLE_SELECT_SETTLE_MS } = require('../withPipelineGuard');

const URL_A = 'http://10.0.2.2:8099/redirect/t1_h264_aac.mp4';
const URL_B = 'http://10.0.2.2:8099/redirect/t6_h264_aac.mkv';

// Timers on a manual clock.
const createClock = () => {
    const clock = { t: 0, timers: [], seq: 0 };
    clock.now = () => clock.t;
    clock.setTimeout = (fn, ms) => {
        const timer = { id: ++clock.seq, at: clock.t + ms, fn };
        clock.timers.push(timer);
        return timer.id;
    };
    clock.clearTimeout = (id) => {
        clock.timers = clock.timers.filter((timer) => timer.id !== id);
    };
    clock.advance = (ms) => {
        const end = clock.t + ms;
        for (;;) {
            const due = clock.timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at || a.id - b.id)[0];
            if (!due) break;
            clock.timers = clock.timers.filter((timer) => timer !== due);
            clock.t = due.at;
            due.fn();
        }
        clock.t = end;
    };
    return clock;
};

// <video> double: `load` lives on the prototype, like HTMLMediaElement.prototype.load. `log` keeps
// what reached the pipeline: a pipeline starts on `src =` and on load() with a src, and is
// released by load() without one.
const elementProto = {
    load() {
        if (this.hasAttribute('src')) {
            this.log.push('restart ' + this.attributes.src);
        } else {
            this.mediaId = null;
            this.log.push('release');
        }
    },
};
const createElement = () => {
    const element = Object.create(elementProto);
    Object.assign(element, { attributes: {}, paused: true, readyState: 0, networkState: 0, handlers: {}, log: [] });
    Object.defineProperty(element, 'src', {
        get: () => element.attributes.src || '',
        set: (value) => {
            element.attributes.src = String(value);
            element.mediaId = 'id:' + value;
            element.log.push('start ' + value);
        },
    });
    element.hasAttribute = (name) => Object.prototype.hasOwnProperty.call(element.attributes, name);
    element.removeAttribute = (name) => {
        delete element.attributes[name];
    };
    element.addEventListener = (name, handler) => {
        element.handlers[name] = (element.handlers[name] || []).concat(handler);
    };
    element.removeEventListener = (name, handler) => {
        element.handlers[name] = (element.handlers[name] || []).filter((entry) => entry !== handler);
    };
    element.fire = (name) => (element.handlers[name] || []).forEach((handler) => handler());
    element.play = () => {
        element.paused = false;
        element.log.push('play');
        element.fire('play');
        return Promise.resolve();
    };
    element.pause = () => {
        element.paused = true;
        element.log.push('pause');
        element.fire('pause');
    };
    // The pipeline got going: what the guard waits for.
    element.started = () => {
        element.readyState = 4;
        element.fire('loadedmetadata');
        element.fire('playing');
    };
    return element;
};

// WebOsVideo double: the element calls of stremio-video 0.0.98 (src, then load() + play() when the
// mediaId shows up; unload = removeAttribute('src') + load(); destroy = unload + removeChild).
const createWebOsVideo = (clock, record) => {
    function FakeWebOsVideo(options) {
        const element = createElement();
        options.containerElement.appendChild(element);
        const listeners = {};
        record.instances.push({ element, listeners });
        let destroyed = false;
        this.on = (eventName, listener) => {
            if (destroyed) throw new Error('Video is destroyed');
            listeners[eventName] = (listeners[eventName] || []).concat(listener);
        };
        this.dispatch = (action) => {
            if (destroyed) throw new Error('Video is destroyed');
            record.actions.push(action.type === 'command' ? action.commandName : action.type + ':' + action.propName);
            // Embedded subtitles: Luna selectTrack 500 ms later, with the mediaId of that moment.
            if (action.type === 'setProp' && action.propName === 'selectedSubtitlesTrackId' && /^EMBEDDED_/.test(action.propValue)) {
                clock.setTimeout(() => record.selectTracks.push(element.mediaId), 500);
            }
            if (action.type !== 'command') return;
            if (action.commandName === 'load') {
                element.src = action.commandArgs.stream.url;
                clock.setTimeout(() => {
                    element.load();
                    element.play();
                }, 300);
            } else if (action.commandName === 'unload' || action.commandName === 'destroy') {
                element.removeAttribute('src');
                element.load();
                if (action.commandName === 'destroy') {
                    destroyed = true;
                    if (element.parentNode !== options.containerElement) throw new Error('NotFoundError: not a child of the container');
                    options.containerElement.removeChild(element);
                }
            }
        };
    }
    FakeWebOsVideo.manifest = { name: 'WebOsVideo', props: [], commands: ['load', 'unload', 'destroy'], events: ['error'] };
    FakeWebOsVideo.canPlayStream = () => Promise.resolve(true);
    return FakeWebOsVideo;
};

// A node that holds children (the Player's container, the body, the holder).
const createNode = () => {
    const node = { children: [], attributes: {}, style: {} };
    node.appendChild = (child) => {
        if (child.parentNode) child.parentNode.removeChild(child);
        node.children.push(child);
        child.parentNode = node;
        return child;
    };
    node.removeChild = (child) => {
        node.children = node.children.filter((entry) => entry !== child);
        child.parentNode = null;
        return child;
    };
    node.setAttribute = (name, value) => {
        node.attributes[name] = value;
    };
    node.hasAttribute = (name) => Object.prototype.hasOwnProperty.call(node.attributes, name);
    node.querySelectorAll = (selector) => node.children.filter((child) => (selector === 'video' ? child.log !== undefined : false));
    node.querySelector = () => node.children.filter((child) => child.hasAttribute && child.hasAttribute('data-webos-releasing-videos'))[0] || null;
    return node;
};
const createContainer = createNode;
const createDocument = () => ({ body: createNode(), createElement: () => createNode() });

const load = (url) => ({ type: 'command', commandName: 'load', commandArgs: { stream: { url }, autoplay: true, time: 0 } });
const UNLOAD = { type: 'command', commandName: 'unload' };
const DESTROY = { type: 'command', commandName: 'destroy' };

describe('withPipelineGuard', () => {
    let clock;
    let record;
    let Guarded;
    let logs;

    const setup = (options) => {
        clock = createClock();
        record = { instances: [], actions: [], selectTracks: [] };
        logs = [];
        const log = { info: (message) => logs.push(message), warn: (message) => logs.push(message) };
        Guarded = withPipelineGuard(createWebOsVideo(clock, record), Object.assign({
            log,
            now: clock.now,
            setTimeout: clock.setTimeout,
            clearTimeout: clock.clearTimeout,
        }, options));
    };
    const create = () => {
        const containerElement = createContainer();
        const video = new Guarded({ containerElement });
        return { video, element: record.instances[record.instances.length - 1].element, containerElement };
    };
    // A stream that started playing.
    const playing = (url) => {
        const created = create();
        created.video.dispatch(load(url));
        clock.advance(300);
        created.element.started();
        return created;
    };

    beforeEach(() => setup());

    it('keeps the manifest and canPlayStream of the decorated video', () => {
        expect(Guarded.manifest.name).toBe('WebOsVideo');
        expect(typeof Guarded.canPlayStream).toBe('function');
    });

    it('creates one pipeline per load: the load() WebOsVideo calls after setting src is dropped', () => {
        const { element } = playing(URL_A);
        expect(element.log).toEqual(['start ' + URL_A, 'play']);
        expect(logs.join('\n')).toMatch(/repeated load\(\) calls dropped: 1/);
    });

    it('pauses a playing video on unload and releases the pipeline RELEASE_SETTLE_MS later', () => {
        const { video, element } = playing(URL_A);
        element.log.length = 0;
        video.dispatch(UNLOAD);
        expect(element.log).toEqual(['pause']);
        clock.advance(RELEASE_SETTLE_MS - 1);
        expect(element.log).toEqual(['pause']);
        clock.advance(1);
        expect(element.log).toEqual(['pause', 'release']);
    });

    it('runs the actions dispatched during the release afterwards, in order (unload + load = a stream switch)', () => {
        const { video, element } = playing(URL_A);
        element.log.length = 0;
        record.actions.length = 0;
        video.dispatch(UNLOAD);
        video.dispatch(load(URL_B));
        video.dispatch({ type: 'setProp', propName: 'volume', propValue: 50 });
        expect(record.actions).toEqual([]);
        clock.advance(RELEASE_SETTLE_MS);
        expect(record.actions).toEqual(['unload', 'load', 'setProp:volume']);
        expect(element.log).toEqual(['pause', 'release', 'start ' + URL_B]);
        clock.advance(300);
        expect(element.log).toEqual(['pause', 'release', 'start ' + URL_B, 'play']);
    });

    it('releases at once when the video has been paused for RELEASE_SETTLE_MS already', () => {
        const { video, element } = playing(URL_A);
        element.pause();
        clock.advance(RELEASE_SETTLE_MS);
        element.log.length = 0;
        video.dispatch(UNLOAD);
        video.dispatch(load(URL_B));
        expect(element.log).toEqual(['release', 'start ' + URL_B]);
    });

    it('releases at once after the end of the video', () => {
        const { video, element } = playing(URL_A);
        element.paused = true;
        element.fire('ended');
        clock.advance(RELEASE_SETTLE_MS);
        element.log.length = 0;
        video.dispatch(UNLOAD);
        expect(element.log).toEqual(['release']);
    });

    it('releases a load over a playing stream first, quietly', () => {
        const { video, element } = playing(URL_A);
        element.log.length = 0;
        video.dispatch(load(URL_B));
        expect(element.log).toEqual(['pause']);
        clock.advance(RELEASE_SETTLE_MS);
        expect(element.log).toEqual(['pause', 'release', 'start ' + URL_B]);
    });

    it('does not wait when there is no pipeline', () => {
        const { video, element } = create();
        video.dispatch(UNLOAD);
        video.dispatch(load(URL_A));
        expect(element.log).toEqual(['release', 'start ' + URL_A]);
    });

    it('destroys at once for the caller, and releases the pipeline quietly before the inner destroy', () => {
        const { video, element } = playing(URL_A);
        element.log.length = 0;
        video.dispatch(DESTROY);
        expect(() => video.dispatch(UNLOAD)).toThrow('Video is destroyed');
        expect(() => video.on('error', () => null)).toThrow('Video is destroyed');
        expect(element.log).toEqual(['pause']);
        expect(record.actions).not.toContain('destroy');
        clock.advance(RELEASE_SETTLE_MS);
        expect(record.actions).toContain('destroy');
        expect(element.log).toEqual(['pause', 'release']);
        // The element gets its own load() back.
        expect(Object.prototype.hasOwnProperty.call(element, 'load')).toBe(false);
    });

    it('starts a load no sooner than loadGapMs after the last release of any guarded video', () => {
        setup({ loadGapMs: 500 });
        const first = playing(URL_A);
        first.element.pause();
        clock.advance(RELEASE_SETTLE_MS);
        first.video.dispatch(DESTROY);
        clock.advance(100);
        const second = create();
        second.video.dispatch(load(URL_B));
        expect(second.element.log).toEqual([]);
        clock.advance(399);
        expect(second.element.log).toEqual([]);
        clock.advance(1);
        expect(second.element.log).toEqual(['start ' + URL_B]);
    });

    it('a new video loads only after the release of a destroyed one still settling (the Player remounts on a switch)', () => {
        const first = playing(URL_A);
        first.element.log.length = 0;
        first.video.dispatch(DESTROY);
        clock.advance(200);
        const second = create();
        second.video.dispatch(load(URL_B));
        expect(second.element.log).toEqual([]);
        clock.advance(RELEASE_SETTLE_MS - 200);
        expect(first.element.log).toEqual(['pause', 'release']);
        expect(second.element.log).toEqual([]);
        clock.advance(50);
        expect(second.element.log).toEqual(['start ' + URL_B]);
        // Nothing left in progress: the next switch is not held back.
        const third = create();
        third.video.dispatch(load(URL_A));
        expect(third.element.log).toEqual(['start ' + URL_A]);
    });

    it('the delayed subtitle selectTrack reaches the pipeline it was meant for, not the next stream', () => {
        const selectSubtitles = { type: 'setProp', propName: 'selectedSubtitlesTrackId', propValue: 'EMBEDDED_1' };
        // While playing: the release waits RELEASE_SETTLE_MS anyway.
        const { video, element } = playing(URL_A);
        video.dispatch(selectSubtitles);
        clock.advance(100);
        video.dispatch(UNLOAD);
        video.dispatch(load(URL_B));
        clock.advance(2000);
        expect(record.selectTracks).toEqual(['id:' + URL_A]);
        expect(element.log).toContain('start ' + URL_B);
        // Paused for long (the release would be immediate): it still waits for the selection.
        element.started();
        element.pause();
        clock.advance(RELEASE_SETTLE_MS);
        element.log.length = 0;
        video.dispatch(selectSubtitles);
        video.dispatch(UNLOAD);
        video.dispatch(load(URL_A));
        expect(element.log).toEqual([]);
        clock.advance(SUBTITLE_SELECT_SETTLE_MS);
        expect(record.selectTracks).toEqual(['id:' + URL_A, 'id:' + URL_B]);
        expect(element.log).toEqual(['release', 'start ' + URL_A]);
    });

    it('the Player unmounts: the <video> stays in the document, paused, until the guard releases it', () => {
        const doc = createDocument();
        const { video, element, containerElement } = playing(URL_A);
        element.log.length = 0;
        // Layout effect cleanup, before React removes the container; then the destroy (passive effect).
        expect(keepVideosConnected(containerElement, doc)).toBe(1);
        const holder = doc.body.children[0];
        expect(holder.style.display).toBe('none');
        expect(element.parentNode).toBe(holder);
        expect(element.log).toEqual(['pause']);
        video.dispatch(DESTROY);
        clock.advance(RELEASE_SETTLE_MS - 1);
        expect(element.parentNode).toBe(holder);
        expect(element.log).toEqual(['pause']);
        clock.advance(1);
        // Released while still in the document, then back in its container for WebOsVideo's destroy.
        expect(element.log).toEqual(['pause', 'release', 'release']);
        expect(record.actions).toContain('destroy');
        expect(element.parentNode).toBeNull();
        expect(holder.children).toEqual([]);
    });

    it('keepVideosConnected leaves alone what the guard does not hold: no pipeline, or another container', () => {
        const doc = createDocument();
        const idle = create();
        expect(keepVideosConnected(idle.containerElement, doc)).toBe(0);
        const other = createContainer();
        other.appendChild(createElement());
        other.children[0].attributes.src = URL_A;
        expect(keepVideosConnected(other, doc)).toBe(0);
        expect(keepVideosConnected(null, doc)).toBe(0);
        expect(doc.body.children).toEqual([]);
    });

    it('reloads a stream that does not start, then reports STREAM_FAILED_TO_LOAD', () => {
        const { video, element } = create();
        const errors = [];
        video.on('error', (error) => errors.push(error));
        video.dispatch(load(URL_A));
        clock.advance(300);
        element.log.length = 0;
        clock.advance(START_TIMEOUT_MS - 300);
        // The reload: quiet release, then the same src again.
        expect(element.log).toEqual(['pause']);
        clock.advance(RELEASE_SETTLE_MS);
        expect(element.log).toEqual(['pause', 'release', 'start ' + URL_A, 'play']);
        expect(errors).toEqual([]);
        clock.advance(START_TIMEOUT_MS);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({ code: 3, critical: true, stream: { url: URL_A } });
        clock.advance(RELEASE_SETTLE_MS);
        expect(element.hasAttribute('src')).toBe(false);
        expect(record.actions.filter((action) => action === 'unload')).toHaveLength(1);
        expect(logs.join('\n')).toMatch(/reloading the stream \(1\/1\)[\s\S]*stream failed to load/);
    });

    it('stops the watchdog once the stream starts, also after a reload', () => {
        const { video, element } = create();
        const errors = [];
        video.on('error', (error) => errors.push(error));
        video.dispatch(load(URL_A));
        clock.advance(START_TIMEOUT_MS + RELEASE_SETTLE_MS);
        element.started();
        clock.advance(10 * START_TIMEOUT_MS);
        expect(errors).toEqual([]);
        expect(logs.join('\n')).toMatch(/after 1 reload\(s\)/);
    });

    it('drops the watchdog of a stream that was unloaded', () => {
        const { video } = create();
        const errors = [];
        video.on('error', (error) => errors.push(error));
        video.dispatch(load(URL_A));
        video.dispatch(UNLOAD);
        clock.advance(10 * START_TIMEOUT_MS);
        expect(errors).toEqual([]);
    });
});

describe('pipelineGuardEnabled', () => {
    const { pipelineGuardEnabled, GUARD_KEY } = require('../withPipelineGuard');
    const storage = (value) => ({ getItem: (key) => (key === GUARD_KEY ? value : null) });

    it('is on unless webos.pipelineGuard is "off"', () => {
        expect(GUARD_KEY).toBe('webos.pipelineGuard');
        expect(pipelineGuardEnabled(storage(null))).toBe(true);
        expect(pipelineGuardEnabled(storage('on'))).toBe(true);
        expect(pipelineGuardEnabled(storage('off'))).toBe(false);
        expect(pipelineGuardEnabled(null)).toBe(true);
        expect(pipelineGuardEnabled({ getItem: () => { throw new Error('denied'); } })).toBe(true);
    });
});
